/**
 * 服务器集成测试
 * 测试客户端与 TCP 服务器的完整通信流程
 */

import * as assert from 'assert';
import * as net from 'net';
import { TcpClient } from '../../extension/tcp/TcpClient';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';

describe('TCP 服务器集成测试', () => {
	let serverProcess: ChildProcess;
	let client: TcpClient;
	const serverPort = 18765; // 使用不同的端口避免冲突

	before(async function() {
		this.timeout(15000); // 增加超时时间

		console.log('🚀 启动 TCP 测试服务器...');
    
		// 启动 Python 测试服务器
		const serverScript = join(__dirname, '../../../server_script/tcp_server.py');
		serverProcess = spawn('python3', [
			serverScript,
			'--port', serverPort.toString(),
			'--path', 'test_tcp_root',
			'--debug'
		]);

		// 监听服务器输出
		serverProcess.stdout?.on('data', (data) => {
			console.log(`[Server] ${data.toString().trim()}`);
		});

		serverProcess.stderr?.on('data', (data) => {
			console.error(`[Server Error] ${data.toString().trim()}`);
		});

		// 等待服务器启动
		await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error('服务器启动超时'));
			}, 10000);

			const checkServer = () => {
				const socket = net.createConnection(serverPort, 'localhost');
        
				socket.on('connect', () => {
					socket.destroy();
					clearTimeout(timeout);
					console.log('✅ TCP 服务器已启动');
					resolve(void 0);
				});
        
				socket.on('error', () => {
					// 服务器还未启动，继续等待
					setTimeout(checkServer, 500);
				});
			};

			setTimeout(checkServer, 1000); // 给服务器一些启动时间
		});

		// 初始化客户端
		client = new TcpClient();
	});

	after(async () => {
		if (client) {
			try {
				await client.disconnect();
			} catch (error) {
				console.warn('客户端断开连接时出错:', error);
			}
		}

		if (serverProcess) {
			console.log('🛑 关闭 TCP 测试服务器...');
			serverProcess.kill('SIGTERM');
      
			// 等待服务器关闭
			await new Promise((resolve) => {
				serverProcess.on('close', resolve);
				setTimeout(resolve, 2000); // 最多等待2秒
			});
		}
	});

	describe('连接管理', () => {
		it('应该能够连接到服务器', async function() {
			this.timeout(10000);
      
			const config = {
				host: 'localhost',
				port: serverPort,
				timeout: 5000,
				dataFormat: 'json' as const
			};

			const connected = await client.connectWithConfig(config);
			assert.strictEqual(connected, true);
			assert.strictEqual(client.isConnected(), true);
		});

		it('应该能够进行心跳检测', async function() {
			this.timeout(5000);
      
			await client.ping(); // 不应该抛出异常
		});
	});

	describe('文件操作 - JSON 格式', () => {
		before(async function() {
			// 确保使用 JSON 格式连接
			if (!client.isConnected()) {
				const config = {
					host: 'localhost',
					port: serverPort,
					timeout: 5000,
					dataFormat: 'json' as const
				};
				await client.connectWithConfig(config);
			}
		});

		it('应该能够列出文件', async function() {
			this.timeout(10000);
      
			const files = await client.listFiles('/');
			assert.ok(Array.isArray(files));
			console.log(`📁 发现 ${files.length} 个文件/目录`);
      
			if (files.length > 0) {
				const firstFile = files[0];
				assert.ok(firstFile.name);
				assert.ok(firstFile.path);
				assert.ok(['file', 'directory'].includes(firstFile.type));
			}
		});

		it('应该能够创建目录', async function() {
			this.timeout(5000);
      
			const result = await client.createDirectory('/test-integration-dir');
			assert.strictEqual(result.success, true);
			console.log('📁 目录创建结果:', result.message);
		});

		it('应该能够上传小文件', async function() {
			this.timeout(10000);
      
			const testContent = 'Hello, TCP Integration Test!';
			const testBuffer = Buffer.from(testContent, 'utf-8');
      
			const config = {
				targetPath: '/test-integration-dir',
				filename: 'integration-test.txt',
				buffer: testBuffer,
				fileSize: testBuffer.length
			};

			const result = await client.uploadFile(config);
			assert.strictEqual(result.success, true);
			console.log('📤 文件上传结果:', result.message);
		});

		it('应该能够下载文件', async function() {
			this.timeout(10000);
      
			const config = {
				filePath: '/test-integration-dir/integration-test.txt',
				filename: 'downloaded-file.txt'
			};

			const blob = await client.downloadFile(config);
			assert.ok(blob instanceof Blob);
      
			// 验证文件内容
			const arrayBuffer = await blob.arrayBuffer();
			const content = new TextDecoder().decode(arrayBuffer);
			assert.strictEqual(content, 'Hello, TCP Integration Test!');
			console.log('📥 文件下载成功，内容验证通过');
		});

		it('应该能够重命名文件', async function() {
			this.timeout(5000);
      
			const result = await client.renameFile(
				'/test-integration-dir/integration-test.txt',
				'/test-integration-dir/renamed-test.txt'
			);
			assert.strictEqual(result.success, true);
			console.log('✏️ 文件重命名结果:', result.message);
		});

		it('应该能够删除文件', async function() {
			this.timeout(5000);
      
			const result = await client.deleteFile('/test-integration-dir/renamed-test.txt');
			assert.strictEqual(result.success, true);
			console.log('🗑️ 文件删除结果:', result.message);
		});

		it('应该能够删除目录', async function() {
			this.timeout(5000);
      
			const result = await client.deleteFile('/test-integration-dir');
			assert.strictEqual(result.success, true);
			console.log('🗑️ 目录删除结果:', result.message);
		});
	});

	describe('文件操作 - Protobuf 格式', () => {
		before(async function() {
			this.timeout(10000);
      
			// 断开当前连接
			if (client.isConnected()) {
				await client.disconnect();
			}

			// 使用 Protobuf 格式重新连接
			const config = {
				host: 'localhost',
				port: serverPort,
				timeout: 5000,
				dataFormat: 'protobuf' as const
			};

			const connected = await client.connectWithConfig(config);
			assert.strictEqual(connected, true);
			console.log('🔄 已切换到 Protobuf 格式');
		});

		it('应该能够使用 Protobuf 格式列出文件', async function() {
			this.timeout(10000);
      
			const files = await client.listFiles('/');
			assert.ok(Array.isArray(files));
			console.log(`📁 [Protobuf] 发现 ${files.length} 个文件/目录`);
		});

		it('应该能够使用 Protobuf 格式上传文件', async function() {
			this.timeout(10000);
      
			const testContent = 'Protobuf Integration Test Data';
			const testBuffer = Buffer.from(testContent, 'utf-8');
      
			const config = {
				targetPath: '/',
				filename: 'protobuf-test.txt',
				buffer: testBuffer,
				fileSize: testBuffer.length
			};

			const result = await client.uploadFile(config);
			assert.strictEqual(result.success, true);
			console.log('📤 [Protobuf] 文件上传结果:', result.message);
		});

		it('应该能够使用 Protobuf 格式下载文件', async function() {
			this.timeout(10000);
      
			const config = {
				filePath: '/protobuf-test.txt',
				filename: 'downloaded-protobuf.txt'
			};

			const blob = await client.downloadFile(config);
			const arrayBuffer = await blob.arrayBuffer();
			const content = new TextDecoder().decode(arrayBuffer);
      
			assert.strictEqual(content, 'Protobuf Integration Test Data');
			console.log('📥 [Protobuf] 文件下载成功，内容验证通过');
		});

		it('应该能够清理测试文件', async function() {
			this.timeout(5000);
      
			const result = await client.deleteFile('/protobuf-test.txt');
			assert.strictEqual(result.success, true);
			console.log('🗑️ [Protobuf] 测试文件清理完成');
		});
	});

	describe('大文件传输测试', () => {
		it('应该能够上传和下载大文件', async function() {
			this.timeout(30000);
      
			// 生成 100KB 的测试数据
			const largeData = Buffer.alloc(100 * 1024);
			for (let i = 0; i < largeData.length; i++) {
				largeData[i] = (i * 7 + 23) % 256;
			}

			console.log(`📦 准备上传大文件: ${largeData.length} 字节`);

			// 上传大文件
			const uploadConfig = {
				targetPath: '/',
				filename: 'large-test-file.bin',
				buffer: largeData,
				fileSize: largeData.length,
				onProgress: (progress: any) => {
					if (progress.percent % 25 === 0) {
						console.log(`📤 上传进度: ${progress.percent}%`);
					}
				}
			};

			const uploadResult = await client.uploadFile(uploadConfig);
			assert.strictEqual(uploadResult.success, true);
			console.log('📤 大文件上传完成:', uploadResult.message);

			// 下载大文件
			const downloadConfig = {
				filePath: '/large-test-file.bin',
				filename: 'downloaded-large-file.bin',
				onProgress: (progress: any) => {
					if (progress.percent % 50 === 0) {
						console.log(`📥 下载进度: ${progress.percent}%`);
					}
				}
			};

			const blob = await client.downloadFile(downloadConfig);
			const downloadedBuffer = Buffer.from(await blob.arrayBuffer());
      
			// 验证文件完整性
			assert.strictEqual(downloadedBuffer.length, largeData.length);
			assert.ok(downloadedBuffer.equals(largeData));
			console.log('📥 大文件下载完成，数据完整性验证通过');

			// 清理大文件
			await client.deleteFile('/large-test-file.bin');
			console.log('🗑️ 大文件清理完成');
		});
	});

	describe('错误处理测试', () => {
		it('应该正确处理不存在的文件', async function() {
			this.timeout(5000);
      
			try {
				await client.downloadFile({
					filePath: '/non-existent-file.txt',
					filename: 'should-not-exist.txt'
				});
				assert.fail('应该抛出错误');
			} catch (error) {
				console.log('✅ 正确处理了不存在文件的错误:', (error as Error).message);
			}
		});

		it('应该正确处理无效路径', async function() {
			this.timeout(5000);
      
			const result = await client.createDirectory('/../invalid-path');
			assert.strictEqual(result.success, false);
			console.log('✅ 正确拒绝了无效路径:', result.message);
		});
	});
});