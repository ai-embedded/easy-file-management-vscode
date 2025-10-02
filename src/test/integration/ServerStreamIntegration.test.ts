import * as assert from 'assert';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import { join } from 'path';
import { TcpClient } from '../../extension/tcp/TcpClient';

/**
 * 使用 Python server_script/tcp_server.py 的帧协议，验证分块上传/下载端到端
 */
describe('ServerStreamIntegration', () => {
	let server: ChildProcess;
	let client: TcpClient;
	const port = 17877;

	before(async function () {
		this.timeout(20000);
		const script = join(__dirname, '../../../server_script/tcp_server.py');
		server = spawn('python3', [script, '--port', String(port), '--path', 'server_script/tcp_test_root', '--debug']);
		server.stdout?.on('data', d => process.stdout.write(`[PySrv] ${d}`));
		server.stderr?.on('data', d => process.stderr.write(`[PySrvE] ${d}`));
		await new Promise<void>((resolve, reject) => {
			const to = setTimeout(() => reject(new Error('server start timeout')), 10000);
			const probe = () => {
				const s = net.createConnection(port, '127.0.0.1');
				s.on('connect', () => { s.destroy(); clearTimeout(to); resolve(); });
				s.on('error', () => setTimeout(probe, 300));
			};
			setTimeout(probe, 800);
		});
		client = new TcpClient();
		await client.connect({ host: '127.0.0.1', port, timeout: 5000, dataFormat: 'protobuf' });
	});

	after(async function () {
		this.timeout(5000);
		try { await client.disconnect(); } catch {}
		server?.kill('SIGTERM');
		await new Promise(r => setTimeout(r, 800));
	});

	it('chunk upload and full download should match', async function () {
		this.timeout(25000);
		const buf = Buffer.from(`hello-stream-e2e-${  'x'.repeat(10000)}`);
		const chunkSize = 4096;
		const totalChunks = Math.ceil(buf.length / chunkSize);
		const init = await client.uploadInit('/', 'hello.bin', { size: buf.length, chunkSize, totalChunks, compression: true });
		assert.ok(init.success, init.message);
		for (let i = 0; i < totalChunks; i++) {
			const start = i * chunkSize;
			const end = Math.min(start + chunkSize, buf.length);
			const resp = await client.uploadChunk(buf.slice(start, end), i, totalChunks);
			assert.ok(resp.success, resp.message);
		}
		const fin = await client.uploadComplete(totalChunks, buf.length);
		assert.ok(fin.success, fin.message);

		const blob = await client.downloadFile({ filePath: '/hello.bin', filename: 'hello.bin' });
		const out = Buffer.from(await blob.arrayBuffer());
		assert.strictEqual(out.length, buf.length);
	});
});
