/**
 * 编解码器性能基准测试
 * JSON vs Protobuf 性能对比
 */

import * as assert from 'assert';
import { ProtobufCodec, Operation } from '../../shared/codec/ProtobufCodec';
import { UniversalCodec } from '../../shared/codec/UniversalCodec';

describe('编解码器性能基准测试', () => {
	let protobufCodec: ProtobufCodec;
	let universalCodec: UniversalCodec;

	before(async () => {
		protobufCodec = new ProtobufCodec();
		await protobufCodec.initialize();
    
		universalCodec = new UniversalCodec();
		await universalCodec.initialize();
	});

	// 测试数据生成器
	const generateTestData = {
		small: () => ({
			operation: Operation.PING,
			clientId: 'test-client',
			version: '2.0.0'
		}),
    
		medium: () => ({
			operation: Operation.LIST_FILES,
			path: '/test/directory',
			files: Array.from({ length: 100 }, (placeholder, i) => ({
				name: `file-${i}.txt`,
				path: `/test/directory/file-${i}.txt`,
				type: 'file',
				size: Math.floor(Math.random() * 10000),
				lastModified: new Date().toISOString(),
				isReadonly: false
			}))
		}),
    
		large: () => {
			const data = new Uint8Array(1024 * 1024); // 1MB
			for (let i = 0; i < data.length; i++) {
				data[i] = (i * 13 + 7) % 256;
			}
			return {
				operation: Operation.UPLOAD_FILE,
				path: '/uploads/large-file.bin',
				filename: 'large-file.bin',
				data,
				fileSize: data.length,
				checksum: 'sha256-checksum'
			};
		}
	};

	describe('编码性能对比', () => {
		it('小数据量编码性能 (PING)', async () => {
			const testData = generateTestData.small();
			const iterations = 1000;

			// Protobuf 编码测试
			const protobufStartTime = Date.now();
			let protobufTotalSize = 0;
      
			for (let i = 0; i < iterations; i++) {
				const encoded = protobufCodec.encodeRequest(testData);
				protobufTotalSize += encoded.length;
			}
      
			const protobufTime = Date.now() - protobufStartTime;

			// JSON 编码测试
			const jsonStartTime = Date.now();
			let jsonTotalSize = 0;
      
			for (let i = 0; i < iterations; i++) {
				const encoded = universalCodec.smartEncode(testData, 'PING', 'json');
				jsonTotalSize += encoded.data.length;
			}
      
			const jsonTime = Date.now() - jsonStartTime;

			// 性能比较
			console.log(`\n📊 小数据量编码性能 (${iterations} 次迭代):`);
			console.log(`  Protobuf: ${protobufTime}ms, 平均大小: ${Math.round(protobufTotalSize / iterations)} 字节`);
			console.log(`  JSON:     ${jsonTime}ms, 平均大小: ${Math.round(jsonTotalSize / iterations)} 字节`);
			console.log(`  性能提升: ${((jsonTime / protobufTime - 1) * 100).toFixed(1)}%`);
			console.log(`  大小减少: ${((jsonTotalSize / protobufTotalSize - 1) * 100).toFixed(1)}%`);

			// 验证性能
			assert.ok(protobufTime < jsonTime * 2, 'Protobuf 编码时间不应该明显慢于 JSON');
			assert.ok(protobufTotalSize <= jsonTotalSize, 'Protobuf 编码大小应该小于等于 JSON');
		});

		it('中等数据量编码性能 (文件列表)', async () => {
			const testData = generateTestData.medium();
			const iterations = 100;

			// Protobuf 编码测试
			const protobufStartTime = Date.now();
			let protobufTotalSize = 0;
      
			for (let i = 0; i < iterations; i++) {
				const encoded = universalCodec.smartEncode(testData, 'LIST_FILES', 'protobuf');
				protobufTotalSize += encoded.data.length;
			}
      
			const protobufTime = Date.now() - protobufStartTime;

			// JSON 编码测试
			const jsonStartTime = Date.now();
			let jsonTotalSize = 0;
      
			for (let i = 0; i < iterations; i++) {
				const encoded = universalCodec.smartEncode(testData, 'LIST_FILES', 'json');
				jsonTotalSize += encoded.data.length;
			}
      
			const jsonTime = Date.now() - jsonStartTime;

			// 性能比较
			console.log(`\n📊 中等数据量编码性能 (${iterations} 次迭代):`);
			console.log(`  Protobuf: ${protobufTime}ms, 平均大小: ${Math.round(protobufTotalSize / iterations)} 字节`);
			console.log(`  JSON:     ${jsonTime}ms, 平均大小: ${Math.round(jsonTotalSize / iterations)} 字节`);
			console.log(`  性能提升: ${((jsonTime / protobufTime - 1) * 100).toFixed(1)}%`);
			console.log(`  大小减少: ${((jsonTotalSize / protobufTotalSize - 1) * 100).toFixed(1)}%`);

			// 验证性能优势
			assert.ok(protobufTotalSize < jsonTotalSize * 0.8, 'Protobuf 应该显著减少数据大小');
		});

		it('大数据量编码性能 (文件上传)', async () => {
			const testData = generateTestData.large();
			const iterations = 10;

			// Protobuf 编码测试
			const protobufStartTime = Date.now();
			let protobufTotalSize = 0;
      
			for (let i = 0; i < iterations; i++) {
				const encoded = universalCodec.smartEncode(testData, 'UPLOAD_FILE', 'protobuf');
				protobufTotalSize += encoded.data.length;
			}
      
			const protobufTime = Date.now() - protobufStartTime;

			// JSON 编码测试
			const jsonStartTime = Date.now();
			let jsonTotalSize = 0;
      
			for (let i = 0; i < iterations; i++) {
				const encoded = universalCodec.smartEncode(testData, 'UPLOAD_FILE', 'json');
				jsonTotalSize += encoded.data.length;
			}
      
			const jsonTime = Date.now() - jsonStartTime;

			// 性能比较
			console.log(`\n📊 大数据量编码性能 (${iterations} 次迭代):`);
			console.log(`  Protobuf: ${protobufTime}ms, 平均大小: ${(protobufTotalSize / iterations / 1024 / 1024).toFixed(2)} MB`);
			console.log(`  JSON:     ${jsonTime}ms, 平均大小: ${(jsonTotalSize / iterations / 1024 / 1024).toFixed(2)} MB`);
			console.log(`  性能提升: ${((jsonTime / protobufTime - 1) * 100).toFixed(1)}%`);
			console.log(`  大小减少: ${((jsonTotalSize / protobufTotalSize - 1) * 100).toFixed(1)}%`);

			// 验证大文件处理能力
			assert.ok(protobufTime < 5000, 'Protobuf 大文件编码应该在 5 秒内完成');
			assert.ok(jsonTime < 10000, 'JSON 大文件编码应该在 10 秒内完成');
		});
	});

	describe('解码性能对比', () => {
		it('小数据量解码性能', async () => {
			const testData = generateTestData.small();
			const iterations = 1000;

			// 预先编码数据
			const protobufEncoded = protobufCodec.encodeRequest(testData);
			const jsonEncoded = universalCodec.smartEncode(testData, 'PING', 'json');

			// Protobuf 解码测试
			const protobufStartTime = Date.now();
      
			for (let i = 0; i < iterations; i++) {
				const decoded = protobufCodec.decodeRequest(protobufEncoded);
				assert.strictEqual(decoded.operation, Operation.PING);
			}
      
			const protobufTime = Date.now() - protobufStartTime;

			// JSON 解码测试
			const jsonStartTime = Date.now();
      
			for (let i = 0; i < iterations; i++) {
				const decoded = universalCodec.autoDecode(jsonEncoded.data, jsonEncoded.format);
				assert.strictEqual(decoded.operation, 'PING');
			}
      
			const jsonTime = Date.now() - jsonStartTime;

			console.log(`\n📊 小数据量解码性能 (${iterations} 次迭代):`);
			console.log(`  Protobuf: ${protobufTime}ms`);
			console.log(`  JSON:     ${jsonTime}ms`);
			console.log(`  性能提升: ${((jsonTime / protobufTime - 1) * 100).toFixed(1)}%`);
		});

		it('内存使用效率测试', () => {
			const testData = generateTestData.large();
      
			// 记录初始内存使用
			const initialMemory = process.memoryUsage();
      
			// Protobuf 编码
			const protobufEncoded = universalCodec.smartEncode(testData, 'UPLOAD_FILE', 'protobuf');
			const protobufMemory = process.memoryUsage();
      
			// JSON 编码
			const jsonEncoded = universalCodec.smartEncode(testData, 'UPLOAD_FILE', 'json');
			const jsonMemory = process.memoryUsage();
      
			console.log('\n📊 内存使用效率:');
			console.log(`  初始内存: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
			console.log(`  Protobuf 后: ${(protobufMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
			console.log(`  JSON 后: ${(jsonMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
			console.log(`  Protobuf 数据大小: ${(protobufEncoded.data.length / 1024 / 1024).toFixed(2)} MB`);
			console.log(`  JSON 数据大小: ${(jsonEncoded.data.length / 1024 / 1024).toFixed(2)} MB`);
		});
	});

	describe('综合性能测试', () => {
		it('往返性能测试 (编码 + 解码)', async () => {
			const testCases = [
				{ name: '小数据', data: generateTestData.small(), iterations: 500 },
				{ name: '中等数据', data: generateTestData.medium(), iterations: 50 },
				{ name: '大数据', data: generateTestData.large(), iterations: 5 }
			];

			for (const testCase of testCases) {
				console.log(`\n📊 ${testCase.name}往返性能 (${testCase.iterations} 次迭代):`);

				// Protobuf 往返测试
				const protobufStartTime = Date.now();
        
				for (let i = 0; i < testCase.iterations; i++) {
					const encoded = universalCodec.smartEncode(testCase.data, 'TEST', 'protobuf');
					const decoded = universalCodec.autoDecode(encoded.data, encoded.format);
					assert.ok(decoded.success !== undefined || decoded.operation !== undefined);
				}
        
				const protobufTime = Date.now() - protobufStartTime;

				// JSON 往返测试
				const jsonStartTime = Date.now();
        
				for (let i = 0; i < testCase.iterations; i++) {
					const encoded = universalCodec.smartEncode(testCase.data, 'TEST', 'json');
					const decoded = universalCodec.autoDecode(encoded.data, encoded.format);
					assert.ok(decoded.success !== undefined || decoded.operation !== undefined);
				}
        
				const jsonTime = Date.now() - jsonStartTime;

				console.log(`  Protobuf: ${protobufTime}ms (平均: ${(protobufTime / testCase.iterations).toFixed(2)}ms)`);
				console.log(`  JSON:     ${jsonTime}ms (平均: ${(jsonTime / testCase.iterations).toFixed(2)}ms)`);
				console.log(`  性能优势: ${((jsonTime / protobufTime - 1) * 100).toFixed(1)}%`);
			}
		});
	});

	after(() => {
		// 打印最终性能报告
		console.log(`\n${  '='.repeat(60)}`);
		console.log('📊 最终性能报告');
		console.log('='.repeat(60));
		universalCodec.printPerformanceReport();
	});
});
