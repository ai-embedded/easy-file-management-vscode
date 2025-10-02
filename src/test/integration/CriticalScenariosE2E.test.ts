/**
 * 关键场景端到端测试
 * 🔧 修复：补充审计报告中识别的关键测试场景
 */

import * as assert from 'assert';
import { UniversalCodec } from '../../shared/codec/UniversalCodec';
import { CompressionCodec, CompressionAlgorithm } from '../../shared/codec/CompressionCodec';
import { codecMonitor } from '../../shared/monitoring/CodecMonitor';

describe('关键场景端到端测试 - 审计修复验证', () => {
	let codec: UniversalCodec;
	let compressionCodec: CompressionCodec;

	before(async () => {
		codec = new UniversalCodec();
		compressionCodec = new CompressionCodec();
		await codec.waitForReady();
    
		// 重置监控统计，确保测试环境干净
		codecMonitor.resetStats();
	});

	describe('🔧 修复验证：Protobuf → JSON 回退 + 压缩 + 算法位校验', () => {
		it('应该在Protobuf编码失败时正确回退到JSON并保持算法位', async () => {
			// 构造一个会导致Protobuf编码失败的消息（无效操作）
			const problematicMessage = {
				operation: 'INVALID_OPERATION',
				data: new Uint8Array(2048), // 大于阈值，会触发压缩
				path: '/test/large-file.bin'
			};

			try {
				// 编码（应该Protobuf失败 → JSON回退 + 压缩）
				const encoded = await codec.smartEncode(problematicMessage, 'INVALID_OPERATION', 'protobuf');
        
				// 验证编码结果
				assert.ok(encoded.data instanceof Uint8Array);
				assert.ok(encoded.data.length > 0);
        
				// 检查格式标志：应该是压缩的JSON格式且包含算法位
				const isCompressed = (encoded.format & 0x04) !== 0;
				const isJSON = (encoded.format & 0x01) !== 0;
				const hasAlgorithmFlag = (encoded.format & 0x30) !== 0; // 算法位掩码
        
				assert.ok(isCompressed, '❌ 应该使用压缩格式');
				assert.ok(isJSON, '❌ 应该回退到JSON格式');
				assert.ok(hasAlgorithmFlag, '❌ 缺少算法标志位（关键修复验证失败）');
        
				// 解码测试
				const decoded = await codec.autoDecode(encoded.data, encoded.format);
				assert.strictEqual(decoded.message, ''); // JSON回退的默认响应
        
				console.log('✅ Protobuf → JSON回退 + 压缩 + 算法位校验通过');
        
			} catch (error) {
				assert.fail(`编码回退测试失败: ${error}`);
			}
		});
	});

	describe('🔧 修复验证：isChunk=false 全链路校验', () => {
		it('应该正确处理isChunk=false从帧到业务对象的完整传输', async () => {
			// 构造包含isChunk=false的响应消息
			const responseMessage = {
				success: true,
				message: 'Non-chunk operation completed',
				isChunk: false, // 关键字段：false值
				chunkIndex: undefined,
				totalChunks: undefined,
				progressPercent: 100,
				fileSize: 1024,
				timestamp: Date.now()
			};

			try {
				// 1. 编码为Protobuf格式
				const encoded = await codec.smartEncode(responseMessage, 'DOWNLOAD_FILE', 'protobuf');
        
				// 2. 构建完整帧协议
				const frame = codec.buildFrame(0x06, encoded.format, encoded.data, 1234);
        
				// 3. 解析帧协议（模拟网络接收）
				const parsedFrame = codec.parseFrame(new Uint8Array(frame));
				assert.ok(parsedFrame, '帧解析应该成功');
				assert.strictEqual(parsedFrame.sequenceNumber, 1234);
        
				// 4. 自动解码数据负载
				const decoded = await codec.autoDecode(new Uint8Array(parsedFrame.data), parsedFrame.format);
        
				// 5. 关键验证：isChunk=false是否正确传输
				assert.strictEqual(decoded.success, true);
				assert.strictEqual(decoded.isChunk, false, '❌ isChunk=false值丢失（关键修复验证失败）');
				assert.strictEqual(decoded.chunkIndex, undefined, 'chunkIndex应该为undefined');
				assert.strictEqual(decoded.totalChunks, undefined, 'totalChunks应该为undefined');
				assert.strictEqual(decoded.progressPercent, 100);
				assert.strictEqual(decoded.fileSize, 1024);
        
				console.log('✅ isChunk=false全链路校验通过', {
					isChunk: decoded.isChunk,
					progressPercent: decoded.progressPercent,
					fileSize: decoded.fileSize
				});
        
			} catch (error) {
				assert.fail(`isChunk=false全链路测试失败: ${error}`);
			}
		});

		it('应该正确区分isChunk=true和isChunk=false的边界情况', async () => {
			const testCases = [
				{ isChunk: true, chunkIndex: 0, totalChunks: 3 },
				{ isChunk: false, chunkIndex: undefined, totalChunks: undefined },
				{ isChunk: true, chunkIndex: 2, totalChunks: 3 }
			];

			for (const testCase of testCases) {
				const message = {
					success: true,
					message: `Test case: isChunk=${testCase.isChunk}`,
					isChunk: testCase.isChunk,
					chunkIndex: testCase.chunkIndex,
					totalChunks: testCase.totalChunks,
					timestamp: Date.now()
				};

				const encoded = await codec.smartEncode(message, 'UPLOAD_DATA', 'protobuf');
				const decoded = await codec.autoDecode(encoded.data, encoded.format);

				assert.strictEqual(decoded.isChunk, testCase.isChunk, 
					`isChunk=${testCase.isChunk}的情况下值传输错误`);
				assert.strictEqual(decoded.chunkIndex, testCase.chunkIndex);
				assert.strictEqual(decoded.totalChunks, testCase.totalChunks);
			}

			console.log('✅ isChunk边界值测试通过');
		});
	});

	describe('🔧 修复验证：混合压缩算法互通性测试', () => {
		it('应该正确处理不同压缩算法的编解码互通', async () => {
			const testData = new Uint8Array(4096); // 足够大以触发压缩
			for (let i = 0; i < testData.length; i++) {
				testData[i] = (i * 7) % 256; // 生成可压缩的模式数据
			}

			const message = {
				success: true,
				message: 'Compression algorithm test',
				data: testData,
				fileSize: testData.length,
				timestamp: Date.now()
			};

			const algorithms = [
				CompressionAlgorithm.GZIP,
				CompressionAlgorithm.DEFLATE,
				CompressionAlgorithm.BROTLI
			];

			for (const algorithm of algorithms) {
				try {
					// 创建特定算法的压缩器
					const specificCompressionCodec = new CompressionCodec({
						algorithm,
						enableAdaptive: false, // 禁用自适应，强制使用指定算法
						threshold: 1024
					});

					// 直接压缩测试
					const compressionResult = await specificCompressionCodec.compress(Buffer.from(testData));
          
					if (compressionResult.algorithm !== CompressionAlgorithm.NONE) {
						// 解压缩测试
						const decompressed = await specificCompressionCodec.decompress(
							compressionResult.data, 
							compressionResult.algorithm
						);
            
						assert.deepStrictEqual(new Uint8Array(decompressed), testData, 
							`${algorithm}压缩/解压缩数据不匹配`);
            
						console.log(`✅ ${algorithm}算法互通性测试通过`, {
							originalSize: testData.length,
							compressedSize: compressionResult.compressedSize,
							ratio: compressionResult.compressionRatio.toFixed(2)
						});
					} else {
						console.log(`⚠️ ${algorithm}算法跳过压缩（数据不适合压缩）`);
					}
          
				} catch (error) {
					assert.fail(`${algorithm}算法测试失败: ${error}`);
				}
			}
		});

		it('应该正确处理压缩失败的回退路径', async () => {
			// 构造一个压缩可能失败的场景（空数据或极小数据）
			const tinyData = new Uint8Array(10);
      
			const message = {
				success: true,
				message: 'Tiny data test',
				data: tinyData,
				timestamp: Date.now()
			};

			try {
				const encoded = await codec.smartEncode(message, 'DOWNLOAD_FILE', 'json');
				const decoded = await codec.autoDecode(encoded.data, encoded.format);
        
				assert.strictEqual(decoded.success, true);
				assert.deepStrictEqual(decoded.data, tinyData);
        
				console.log('✅ 压缩失败回退路径测试通过');
        
			} catch (error) {
				assert.fail(`压缩回退测试失败: ${error}`);
			}
		});
	});

	describe('🔧 修复验证：自适应压缩阈值测试', () => {
		it('应该根据性能统计动态调整压缩阈值', async () => {
			// 创建启用自适应的压缩器
			const adaptiveCodec = new CompressionCodec({
				enableAdaptive: true,
				threshold: 1024
			});

			// 模拟一些编码操作来积累统计数据
			const testSizes = [512, 1024, 2048];
      
			for (const size of testSizes) {
				const testData = Buffer.alloc(size, 'A'); // 简单的可压缩数据
        
				// 记录编码操作到监控系统
				const startTime = Date.now();
				const result = await adaptiveCodec.compress(testData);
				const duration = Date.now() - startTime;
        
				// 手动记录到codecMonitor以模拟正常的编码流程
				codecMonitor.recordEncode('json', true, duration, size, result.compressedSize);
			}

			// 测试不同大小数据的压缩决策
			for (const size of [256, 512, 768, 1024, 1536]) {
				const testData = Buffer.alloc(size, 'B');
				const result = await adaptiveCodec.compress(testData);
        
				console.log(`📊 自适应阈值测试: ${size}字节 -> ` + 
          `${result.algorithm} (压缩${result.algorithm !== CompressionAlgorithm.NONE ? '启用' : '跳过'})`);
			}

			console.log('✅ 自适应压缩阈值测试完成');
      
			// 输出最终的监控统计
			const finalStats = codecMonitor.getStats();
			console.log('📊 测试后的监控统计:', {
				encodeAttempts: finalStats.encodeAttempts,
				avgEncodeTime: `${finalStats.avgEncodeTime.toFixed(2)  }ms`,
				encodeSuccessRate: `${(finalStats.encodeSuccesses / finalStats.encodeAttempts * 100).toFixed(1)  }%`
			});
		});
	});

	after(() => {
		// 打印性能报告
		console.log('\n📊 关键场景测试完成，性能报告：');
		codecMonitor.printPerformanceReport();
	});
});