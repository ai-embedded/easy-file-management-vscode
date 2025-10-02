import * as assert from 'assert';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import { join } from 'path';
import { TcpClient } from '../../extension/tcp/TcpClient';

/**
 * 流式端到端测试：验证分块上传与按范围下载
 */
describe('Stream E2E Tests (TCP server)', () => {
	let serverProcess: ChildProcess;
	let client: TcpClient;
	const serverPort = 17876;

	before(async function () {
		this.timeout(20000);

		const serverScript = join(__dirname, '../../../server_script/tcp_server.py');
		serverProcess = spawn('python3', [
			serverScript,
			'--port', String(serverPort),
			'--path', 'test_tcp_root',
			'--debug'
		]);

		serverProcess.stdout?.on('data', (d) => process.stdout.write(`[Server] ${d}`));
		serverProcess.stderr?.on('data', (d) => process.stderr.write(`[ServerE] ${d}`));

		// wait server ready
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('server start timeout')), 10000);
			const tryConnect = () => {
				const s = net.createConnection(serverPort, '127.0.0.1');
				s.on('connect', () => { s.destroy(); clearTimeout(timeout); resolve(); });
				s.on('error', () => setTimeout(tryConnect, 300));
			};
			setTimeout(tryConnect, 800);
		});

		client = new TcpClient();
		await client.connect({ host: '127.0.0.1', port: serverPort, timeout: 5000, dataFormat: 'protobuf' });
	});

	after(async function () {
		this.timeout(5000);
		try { await client.disconnect(); } catch {}
		if (serverProcess) {
			serverProcess.kill('SIGTERM');
			await new Promise((r) => setTimeout(r, 1000));
		}
	});

	it('should upload file in chunks and then download fully', async function () {
		this.timeout(30000);

		// Prepare a 128KB buffer
		const size = 128 * 1024;
		const buf = Buffer.alloc(size);
		for (let i = 0; i < buf.length; i++) {buf[i] = i % 256;}

		// Init upload
		const chunkSize = 16 * 1024;
		const totalChunks = Math.ceil(size / chunkSize);
		const initResp = await client.uploadInit('/', 'stream-e2e.bin', { size, chunkSize, totalChunks, compression: true });
		assert.ok(initResp.success, `init upload failed: ${initResp.message}`);

		// Upload chunks
		for (let i = 0; i < totalChunks; i++) {
			const start = i * chunkSize;
			const end = Math.min(start + chunkSize, size);
			const chunk = buf.slice(start, end);
			const resp = await client.uploadChunk(chunk, i, totalChunks);
			assert.ok(resp.success, `upload chunk ${i} failed: ${resp.message}`);
		}

		// Complete upload
		const endResp = await client.uploadComplete(totalChunks, size);
		assert.ok(endResp.success, `upload complete failed: ${endResp.message}`);

		// Download fully to verify
		const dl = await client.downloadFile({ filePath: '/stream-e2e.bin', filename: 'stream-e2e.bin' });
		const ab = await dl.arrayBuffer();
		const out = Buffer.from(ab);
		assert.strictEqual(out.length, buf.length, 'download size mismatch');
		assert.ok(out.equals(buf), 'downloaded content mismatch');
	});

	it('should download a range (first 32KB) via chunk API', async function () {
		this.timeout(15000);
		const first = await client.downloadChunk('/stream-e2e.bin', 0, 32 * 1024);
		assert.ok(first.success, first.message);
		assert.ok(first.data, 'no data in chunk');
	});

	it('should handle concurrent chunk downloads', async function () {
		this.timeout(30000);
    
		// 并发下载多个块
		const chunkSize = 16 * 1024;
		const promises = [];
		const chunks: { [key: number]: Buffer } = {};
    
		// 并发下载4个块
		for (let i = 0; i < 4; i++) {
			const start = i * chunkSize;
			const end = start + chunkSize;
      
			promises.push(
				client.downloadChunk('/stream-e2e.bin', start, end).then(resp => {
					assert.ok(resp.success, `Chunk ${i} download failed: ${resp.message}`);
					chunks[i] = Buffer.from(resp.data);
					return i;
				})
			);
		}
    
		// 等待所有块下载完成
		const results = await Promise.all(promises);
		assert.strictEqual(results.length, 4, 'Should download 4 chunks');
    
		// 验证每个块都已下载
		for (let i = 0; i < 4; i++) {
			assert.ok(chunks[i], `Chunk ${i} is missing`);
			assert.strictEqual(chunks[i].length, chunkSize, `Chunk ${i} size mismatch`);
		}
    
		// 验证块内容（简单检查第一个字节）
		for (let i = 0; i < 4; i++) {
			const expectedFirstByte = (i * chunkSize) % 256;
			assert.strictEqual(chunks[i][0], expectedFirstByte, `Chunk ${i} content mismatch`);
		}
	});

	it('should handle out-of-order chunk uploads', async function () {
		this.timeout(30000);
    
		// 创建测试数据
		const size = 64 * 1024;
		const buf = Buffer.alloc(size);
		for (let i = 0; i < buf.length; i++) {buf[i] = (i * 3) % 256;}
    
		// 初始化上传
		const chunkSize = 16 * 1024;
		const totalChunks = Math.ceil(size / chunkSize);
		const initResp = await client.uploadInit('/', 'out-of-order.bin', { 
			size, 
			chunkSize, 
			totalChunks, 
			compression: false 
		});
		assert.ok(initResp.success, `init upload failed: ${initResp.message}`);
    
		// 乱序上传块：3, 1, 0, 2
		const uploadOrder = [3, 1, 0, 2];
		for (const i of uploadOrder) {
			const start = i * chunkSize;
			const end = Math.min(start + chunkSize, size);
			const chunk = buf.slice(start, end);
			const resp = await client.uploadChunk(chunk, i, totalChunks);
			assert.ok(resp.success, `upload chunk ${i} failed: ${resp.message}`);
		}
    
		// 完成上传
		const endResp = await client.uploadComplete(totalChunks, size);
		assert.ok(endResp.success, `upload complete failed: ${endResp.message}`);
    
		// 下载并验证内容正确
		const dl = await client.downloadFile({ 
			filePath: '/out-of-order.bin', 
			filename: 'out-of-order.bin' 
		});
		const ab = await dl.arrayBuffer();
		const out = Buffer.from(ab);
		assert.strictEqual(out.length, buf.length, 'download size mismatch');
		assert.ok(out.equals(buf), 'out-of-order upload resulted in incorrect content');
	});

	it('should support resumable upload after interruption', async function () {
		this.timeout(30000);
    
		// 创建测试数据
		const size = 80 * 1024;
		const buf = Buffer.alloc(size);
		for (let i = 0; i < buf.length; i++) {buf[i] = (i * 7) % 256;}
    
		// 初始化上传
		const chunkSize = 16 * 1024;
		const totalChunks = Math.ceil(size / chunkSize);
		const initResp = await client.uploadInit('/', 'resumable.bin', { 
			size, 
			chunkSize, 
			totalChunks, 
			compression: false 
		});
		assert.ok(initResp.success, `init upload failed: ${initResp.message}`);
    
		// 上传前2个块
		for (let i = 0; i < 2; i++) {
			const start = i * chunkSize;
			const end = Math.min(start + chunkSize, size);
			const chunk = buf.slice(start, end);
			const resp = await client.uploadChunk(chunk, i, totalChunks);
			assert.ok(resp.success, `upload chunk ${i} failed: ${resp.message}`);
		}
    
		// 模拟中断：断开连接并重连
		await client.disconnect();
		await new Promise(resolve => setTimeout(resolve, 1000));
		await client.connect({ host: '127.0.0.1', port: serverPort, timeout: 5000, dataFormat: 'protobuf' });
    
		// 继续上传剩余块（从块2开始）
		for (let i = 2; i < totalChunks; i++) {
			const start = i * chunkSize;
			const end = Math.min(start + chunkSize, size);
			const chunk = buf.slice(start, end);
			const resp = await client.uploadChunk(chunk, i, totalChunks);
			assert.ok(resp.success, `resume upload chunk ${i} failed: ${resp.message}`);
		}
    
		// 完成上传
		const endResp = await client.uploadComplete(totalChunks, size);
		assert.ok(endResp.success, `upload complete failed: ${endResp.message}`);
    
		// 下载并验证
		const dl = await client.downloadFile({ 
			filePath: '/resumable.bin', 
			filename: 'resumable.bin' 
		});
		const ab = await dl.arrayBuffer();
		const out = Buffer.from(ab);
		assert.strictEqual(out.length, buf.length, 'resumable upload size mismatch');
		assert.ok(out.equals(buf), 'resumable upload content mismatch');
	});

	it('should handle compression correctly', async function () {
		this.timeout(20000);
    
		// 创建高度可压缩的数据（重复模式）
		const size = 100 * 1024;
		const buf = Buffer.alloc(size);
		const pattern = 'ABCDEFGHIJKLMNOP';
		for (let i = 0; i < buf.length; i++) {
			buf[i] = pattern.charCodeAt(i % pattern.length);
		}
    
		// 上传带压缩
		const result = await client.uploadFile({
			targetPath: '/',
			filename: 'compressed.bin',
			buffer: buf,
			fileSize: size
		});
		assert.ok(result.success, `compressed upload failed: ${result.message}`);
    
		// 下载并验证
		const dl = await client.downloadFile({
			filePath: '/compressed.bin',
			filename: 'compressed.bin'
		});
		const ab = await dl.arrayBuffer();
		const out = Buffer.from(ab);
		assert.strictEqual(out.length, buf.length, 'compressed file size mismatch');
		assert.ok(out.equals(buf), 'compressed file content mismatch');
	});
});
