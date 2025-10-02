/**
 * Protobuf 编解码器单元测试
 */

import * as assert from 'assert';
import { ProtobufCodec, Operation } from '../../shared/codec/ProtobufCodec';
import { TypeValidator } from '../../shared/validation/TypeValidator';

describe('ProtobufCodec Tests', () => {
	let codec: ProtobufCodec;

	before(async () => {
		codec = new ProtobufCodec();
		await codec.initialize();
	});

	describe('初始化测试', () => {
		it('应该成功初始化', () => {
			assert.strictEqual(codec.isInitialized(), true);
		});

		it('应该提供正确的统计信息', () => {
			const stats = codec.getStats();
			assert.strictEqual(stats.initialized, true);
			assert.strictEqual(stats.version, '2.0.0-protobuf');
		});
	});

	describe('请求编码测试', () => {
		it('应该成功编码简单的 PING 请求', () => {
			const request = {
				operation: Operation.PING,
				path: '/test'
			};

			const encoded = codec.encodeRequest(request);
			assert.ok(encoded instanceof Uint8Array);
			assert.ok(encoded.length > 0);
		});

		it('应该成功编码包含数据的请求', () => {
			const testData = new Uint8Array([1, 2, 3, 4, 5]);
			const request = {
				operation: Operation.UPLOAD_FILE,
				path: '/test/file.txt',
				filename: 'file.txt',
				data: testData,
				fileSize: testData.length
			};

			const encoded = codec.encodeRequest(request);
			assert.ok(encoded instanceof Uint8Array);
			assert.ok(encoded.length > 0);
		});

		it('应该成功编码分块上传请求', () => {
			const request = {
				operation: Operation.UPLOAD_DATA,
				data: new Uint8Array([1, 2, 3]),
				isChunk: true,
				chunkIndex: 0,
				totalChunks: 3,
				chunkHash: 'abc123'
			};

			const encoded = codec.encodeRequest(request);
			assert.ok(encoded instanceof Uint8Array);
			assert.ok(encoded.length > 0);
		});

		it('应该拒绝无效的请求', () => {
			const invalidRequest = {
				// 缺少 operation 字段
				path: '/test'
			};

			assert.throws(() => {
				codec.encodeRequest(invalidRequest as any);
			});
		});
	});

	describe('响应解码测试', () => {
		it('应该成功解码简单响应', async () => {
			// 先编码一个响应
			const response = {
				success: true,
				message: 'Test successful',
				timestamp: Date.now()
			};

			const encoded = codec.encodeResponse(response);
			const decoded = codec.decodeResponse(encoded);

			assert.strictEqual(decoded.success, true);
			assert.strictEqual(decoded.message, 'Test successful');
			assert.ok(decoded.timestamp);
		});

		it('应该成功解码包含文件列表的响应', async () => {
			const response = {
				success: true,
				message: 'Files listed',
				files: [
					{
						name: 'test.txt',
						path: '/test.txt',
						type: 'file',
						size: 1024,
						lastModified: '2025-09-10T12:00:00Z',
						isReadonly: false
					},
					{
						name: 'folder',
						path: '/folder',
						type: 'directory',
						size: 0,
						lastModified: '2025-09-10T12:00:00Z',
						isReadonly: false
					}
				]
			};

			const encoded = codec.encodeResponse(response);
			const decoded = codec.decodeResponse(encoded);

			assert.strictEqual(decoded.success, true);
			assert.strictEqual(decoded.files?.length, 2);
			assert.strictEqual(decoded.files?.[0].name, 'test.txt');
			assert.strictEqual(decoded.files?.[1].type, 'directory');
		});

		it('应该成功解码包含二进制数据的响应', async () => {
			const testData = new Uint8Array([10, 20, 30, 40, 50]);
			const response = {
				success: true,
				message: 'File downloaded',
				data: testData,
				fileSize: testData.length
			};

			const encoded = codec.encodeResponse(response);
			const decoded = codec.decodeResponse(encoded);

			assert.strictEqual(decoded.success, true);
			assert.ok(decoded.data instanceof Uint8Array);
			assert.deepStrictEqual(decoded.data, testData);
			assert.strictEqual(decoded.fileSize, testData.length);
		});

		it('应该处理空数据', () => {
			assert.throws(() => {
				codec.decodeResponse(new Uint8Array(0));
			});
		});
	});

	describe('往返测试（编码后解码）', () => {
		it('PING 请求往返测试', async () => {
			const originalRequest = {
				operation: Operation.PING,
				clientId: 'test-client',
				version: '2.0.0'
			};

			const encoded = codec.encodeRequest(originalRequest);
			const decoded = codec.decodeRequest(encoded);

			assert.strictEqual(decoded.operation, Operation.PING);
			assert.strictEqual(decoded.clientId, 'test-client');
			assert.strictEqual(decoded.version, '2.0.0');
		});

		it('文件上传请求往返测试', async () => {
			const testData = new Uint8Array([100, 200, 255, 0, 128]);
			const originalRequest = {
				operation: Operation.UPLOAD_FILE,
				path: '/uploads',
				filename: 'binary-test.bin',
				data: testData,
				fileSize: testData.length,
				checksum: 'sha256-hash'
			};

			const encoded = codec.encodeRequest(originalRequest);
			const decoded = codec.decodeRequest(encoded);

			assert.strictEqual(decoded.operation, Operation.UPLOAD_FILE);
			assert.strictEqual(decoded.path, '/uploads');
			assert.strictEqual(decoded.filename, 'binary-test.bin');
			assert.deepStrictEqual(decoded.data, testData);
			assert.strictEqual(decoded.fileSize, testData.length);
			assert.strictEqual(decoded.checksum, 'sha256-hash');
		});

		it('复杂响应往返测试', async () => {
			const originalResponse = {
				success: true,
				message: 'Operation completed',
				files: [
					{
						name: 'document.pdf',
						path: '/docs/document.pdf',
						type: 'file',
						size: 2048576,
						lastModified: '2025-09-10T15:30:00Z',
						permissions: '644',
						isReadonly: false,
						mimeType: 'application/pdf'
					}
				],
				serverInfo: {
					name: 'Test Server',
					version: '2.0.0',
					protocol: 'Unified Protobuf Protocol',
					supportedFormats: ['json', 'protobuf'],
					rootDir: '/test/root',
					maxFileSize: 104857600,
					chunkSize: 65536,
					concurrentOperations: 4
				},
				processTimeMs: 150,
				timestamp: Date.now()
			};

			const encoded = codec.encodeResponse(originalResponse);
			const decoded = codec.decodeResponse(encoded);

			assert.strictEqual(decoded.success, true);
			assert.strictEqual(decoded.message, 'Operation completed');
			assert.strictEqual(decoded.files?.length, 1);
			assert.strictEqual(decoded.files?.[0].name, 'document.pdf');
			assert.strictEqual(decoded.files?.[0].size, 2048576);
			assert.strictEqual(decoded.serverInfo?.name, 'Test Server');
			assert.deepStrictEqual(decoded.serverInfo?.supportedFormats, ['json', 'protobuf']);
			assert.strictEqual(decoded.processTimeMs, 150);
		});
	});

	describe('性能测试', () => {
		it('应该在合理时间内编码大量数据', () => {
			const largeData = new Uint8Array(1024 * 1024); // 1MB
			for (let i = 0; i < largeData.length; i++) {
				largeData[i] = i % 256;
			}

			const request = {
				operation: Operation.UPLOAD_FILE,
				path: '/large-file.bin',
				filename: 'large-file.bin',
				data: largeData,
				fileSize: largeData.length
			};

			const startTime = Date.now();
			const encoded = codec.encodeRequest(request);
			const encodeTime = Date.now() - startTime;

			assert.ok(encoded instanceof Uint8Array);
			assert.ok(encodeTime < 1000, `编码时间过长: ${encodeTime}ms`); // 应该在1秒内完成
		});

		it('应该在合理时间内解码大量数据', () => {
			const largeData = new Uint8Array(1024 * 1024); // 1MB
			for (let i = 0; i < largeData.length; i++) {
				largeData[i] = (i * 7) % 256;
			}

			const response = {
				success: true,
				message: 'Large file downloaded',
				data: largeData,
				fileSize: largeData.length
			};

			const encoded = codec.encodeResponse(response);
      
			const startTime = Date.now();
			const decoded = codec.decodeResponse(encoded);
			const decodeTime = Date.now() - startTime;

			assert.strictEqual(decoded.success, true);
			assert.deepStrictEqual(decoded.data, largeData);
			assert.ok(decodeTime < 1000, `解码时间过长: ${decodeTime}ms`); // 应该在1秒内完成
		});
	});

	// 🔧 修复P0问题：专门测试关键字段的往返传输
	describe('关键字段往返测试（P0修复验证）', () => {
		it('分块响应字段往返测试 - isChunk, chunkIndex, totalChunks, chunkHash', () => {
			const originalResponse = {
				success: true,
				message: 'Chunk uploaded successfully',
				isChunk: true,
				chunkIndex: 5,
				totalChunks: 10,
				chunkHash: 'sha256abcdef123456',
				timestamp: Date.now()
			};

			const encoded = codec.encodeResponse(originalResponse);
			const decoded = codec.decodeResponse(encoded);

			// 验证所有分块相关字段都正确传输
			assert.strictEqual(decoded.success, true);
			assert.strictEqual(decoded.isChunk, true, '❌ isChunk字段丢失或错误');
			assert.strictEqual(decoded.chunkIndex, 5, '❌ chunkIndex字段丢失或错误');
			assert.strictEqual(decoded.totalChunks, 10, '❌ totalChunks字段丢失或错误');
			assert.strictEqual(decoded.chunkHash, 'sha256abcdef123456', '❌ chunkHash字段丢失或错误');
      
			console.log('✅ 分块字段往返测试通过:', {
				isChunk: decoded.isChunk,
				chunkIndex: decoded.chunkIndex,
				totalChunks: decoded.totalChunks,
				chunkHash: decoded.chunkHash
			});
		});

		it('进度字段往返测试 - progressPercent', () => {
			const originalResponse = {
				success: true,
				message: 'Upload progress',
				progressPercent: 67,
				fileSize: 1024000,
				timestamp: Date.now()
			};

			const encoded = codec.encodeResponse(originalResponse);
			const decoded = codec.decodeResponse(encoded);

			assert.strictEqual(decoded.success, true);
			assert.strictEqual(decoded.progressPercent, 67, '❌ progressPercent字段丢失或错误');
			assert.strictEqual(decoded.fileSize, 1024000);
      
			console.log('✅ 进度字段往返测试通过:', {
				progressPercent: decoded.progressPercent,
				fileSize: decoded.fileSize
			});
		});

		it('复合分块场景往返测试 - 所有关键字段', () => {
			const originalResponse = {
				success: true,
				message: 'Chunk operation with progress',
				isChunk: true,
				chunkIndex: 3,
				totalChunks: 8,
				chunkHash: 'hash789xyz',
				progressPercent: 37,
				fileSize: 2048000,
				processTimeMs: 120,
				acceptedChunkSize: 32768,
				timestamp: Date.now()
			};

			const encoded = codec.encodeResponse(originalResponse);
			const decoded = codec.decodeResponse(encoded);

			// 验证所有关键字段都存在且正确
			assert.strictEqual(decoded.success, true);
			assert.strictEqual(decoded.isChunk, true, '❌ isChunk字段错误');
			assert.strictEqual(decoded.chunkIndex, 3, '❌ chunkIndex字段错误');
			assert.strictEqual(decoded.totalChunks, 8, '❌ totalChunks字段错误');
			assert.strictEqual(decoded.chunkHash, 'hash789xyz', '❌ chunkHash字段错误');
			assert.strictEqual(decoded.progressPercent, 37, '❌ progressPercent字段错误');
			assert.strictEqual(decoded.fileSize, 2048000, '❌ fileSize字段错误');
			assert.strictEqual(decoded.acceptedChunkSize, 32768, '❌ acceptedChunkSize字段错误');
      
			console.log('✅ 复合分块场景往返测试通过，所有关键字段正确传输');
		});

		it('边界值测试 - 0和undefined值', () => {
			const originalResponse = {
				success: true,
				message: 'Boundary test',
				isChunk: false,  // 测试false值
				chunkIndex: 0,   // 测试0值
				totalChunks: 1,  // 测试最小值
				progressPercent: 0, // 测试0进度
				timestamp: Date.now()
			};

			const encoded = codec.encodeResponse(originalResponse);
			const decoded = codec.decodeResponse(encoded);

			assert.strictEqual(decoded.isChunk, false, '❌ false值处理错误');
			assert.strictEqual(decoded.chunkIndex, 0, '❌ 0值处理错误');
			assert.strictEqual(decoded.totalChunks, 1, '❌ 最小值处理错误');
			assert.strictEqual(decoded.progressPercent, 0, '❌ 0进度处理错误');
      
			console.log('✅ 边界值测试通过');
		});
	});

	describe('错误处理测试', () => {
		it('应该处理损坏的数据', () => {
			const corruptedData = new Uint8Array([1, 2, 3, 4, 5]); // 无效的 protobuf 数据

			assert.throws(() => {
				codec.decodeResponse(corruptedData);
			});
		});

		it('应该验证请求字段', () => {
			const invalidRequest = {
				operation: 999, // 无效的操作码
				path: '../../../etc/passwd', // 不安全的路径
				chunkIndex: -1, // 无效的分块索引
				totalChunks: 0 // 无效的总块数
			};

			assert.throws(() => {
				codec.encodeRequest(invalidRequest as any);
			});
		});
	});
});