/**
 * 压缩率和性能影响测试
 * 测试不同压缩算法对传输性能的影响
 */

import * as fs from 'fs';
import * as path from 'path';
import { CompressionCodec, CompressionAlgorithm } from '../../shared/codec/CompressionCodec';
import { Logger } from '../../shared/utils/Logger';

const logger = new Logger('CompressionPerformanceTest');

/**
 * 测试数据类型
 */
interface TestDataType {
  name: string;
  description: string;
  generator: (size: number) => Buffer;
}

/**
 * 测试结果
 */
interface CompressionTestResult {
  dataType: string;
  dataSize: number;
  algorithm: CompressionAlgorithm;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  compressionTime: number;
  decompressionTime: number;
  throughput: number;  // MB/s
}

/**
 * 压缩性能测试类
 */
export class CompressionPerformanceTest {
	private results: CompressionTestResult[] = [];
  
	// 测试的压缩算法
	private readonly algorithms = [
		CompressionAlgorithm.NONE,
		CompressionAlgorithm.DEFLATE,
		CompressionAlgorithm.GZIP,
		CompressionAlgorithm.BROTLI
	];
  
	// 测试数据大小
	private readonly testSizes = [
		{ size: 1024, name: '1KB' },
		{ size: 10 * 1024, name: '10KB' },
		{ size: 100 * 1024, name: '100KB' },
		{ size: 1024 * 1024, name: '1MB' },
		{ size: 10 * 1024 * 1024, name: '10MB' }
	];
  
	// 测试数据类型
	private readonly dataTypes: TestDataType[] = [
		{
			name: 'JSON',
			description: 'JSON 格式数据（高可压缩性）',
			generator: this.generateJsonData.bind(this)
		},
		{
			name: 'Text',
			description: '纯文本数据（中等可压缩性）',
			generator: this.generateTextData.bind(this)
		},
		{
			name: 'Binary',
			description: '二进制数据（低可压缩性）',
			generator: this.generateBinaryData.bind(this)
		},
		{
			name: 'Random',
			description: '随机数据（几乎不可压缩）',
			generator: this.generateRandomData.bind(this)
		},
		{
			name: 'Protobuf',
			description: 'Protobuf 二进制数据',
			generator: this.generateProtobufData.bind(this)
		}
	];
  
	/**
   * 运行完整测试
   */
	async runFullTest(): Promise<void> {
		logger.info('开始压缩性能测试');
		logger.info('='.repeat(80));
    
		// 测试每种数据类型
		for (const dataType of this.dataTypes) {
			logger.info(`\n📄 数据类型: ${dataType.name}`);
			logger.info(`   ${dataType.description}`);
      
			// 测试不同大小
			for (const sizeInfo of this.testSizes) {
				logger.info(`\n  📊 数据大小: ${sizeInfo.name}`);
        
				// 生成测试数据
				const testData = dataType.generator(sizeInfo.size);
        
				// 测试每种算法
				for (const algorithm of this.algorithms) {
					if (algorithm === CompressionAlgorithm.NONE && sizeInfo.size > 1024 * 1024) {
						continue; // 跳过大文件的无压缩测试
					}
          
					await this.testCompression(dataType.name, testData, algorithm);
				}
			}
		}
    
		// 生成报告
		this.generateReport();
	}
  
	/**
   * 测试单个压缩算法
   */
	private async testCompression(
		dataType: string,
		data: Buffer,
		algorithm: CompressionAlgorithm
	): Promise<void> {
		const codec = new CompressionCodec({
			algorithm,
			threshold: 0  // 强制压缩所有数据
		});
    
		try {
			// 压缩测试
			const compressionStartTime = Date.now();
			const compressionResult = await codec.compress(data);
			const compressionTime = Date.now() - compressionStartTime;
      
			// 解压测试
			const decompressionStartTime = Date.now();
			const decompressedData = await codec.decompress(
				compressionResult.data, 
				compressionResult.algorithm
			);
			const decompressionTime = Date.now() - decompressionStartTime;
      
			// 验证数据完整性
			if (!data.equals(decompressedData)) {
				throw new Error('数据完整性验证失败');
			}
      
			// 计算吞吐量
			const totalTime = (compressionTime + decompressionTime) / 1000; // 秒
			const throughput = (data.length / (1024 * 1024)) / totalTime; // MB/s
      
			// 记录结果
			const result: CompressionTestResult = {
				dataType,
				dataSize: data.length,
				algorithm,
				originalSize: compressionResult.originalSize,
				compressedSize: compressionResult.compressedSize,
				compressionRatio: compressionResult.compressionRatio,
				compressionTime,
				decompressionTime,
				throughput
			};
      
			this.results.push(result);
      
			// 输出结果
			const reduction = ((1 - result.compressedSize / result.originalSize) * 100).toFixed(1);
			logger.info(`    ${algorithm}: ${reduction}% 减少, ${compressionTime}ms 压缩, ${decompressionTime}ms 解压, ${throughput.toFixed(2)} MB/s`);
      
		} catch (error) {
			logger.error(`    ${algorithm}: 测试失败 - ${error}`);
		}
	}
  
	/**
   * 生成 JSON 数据
   */
	private generateJsonData(size: number): Buffer {
		const obj: any = {
			timestamp: Date.now(),
			data: []
		};
    
		// 生成重复的 JSON 结构
		while (JSON.stringify(obj).length < size) {
			obj.data.push({
				id: Math.random().toString(36),
				name: 'Test Item',
				value: Math.random() * 1000,
				enabled: Math.random() > 0.5,
				metadata: {
					created: new Date().toISOString(),
					tags: ['tag1', 'tag2', 'tag3']
				}
			});
		}
    
		const jsonStr = JSON.stringify(obj);
		return Buffer.from(jsonStr.slice(0, size));
	}
  
	/**
   * 生成文本数据
   */
	private generateTextData(size: number): Buffer {
		const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog'];
		let text = '';
    
		while (text.length < size) {
			text += `${words[Math.floor(Math.random() * words.length)]  } `;
		}
    
		return Buffer.from(text.slice(0, size));
	}
  
	/**
   * 生成二进制数据
   */
	private generateBinaryData(size: number): Buffer {
		const buffer = Buffer.alloc(size);
    
		// 填充有模式的二进制数据
		for (let i = 0; i < size; i++) {
			buffer[i] = (i % 256);
		}
    
		return buffer;
	}
  
	/**
   * 生成随机数据
   */
	private generateRandomData(size: number): Buffer {
		const buffer = Buffer.alloc(size);
    
		// 填充完全随机的数据
		for (let i = 0; i < size; i++) {
			buffer[i] = Math.floor(Math.random() * 256);
		}
    
		return buffer;
	}
  
	/**
   * 生成 Protobuf 风格的二进制数据
   */
	private generateProtobufData(size: number): Buffer {
		const buffer = Buffer.alloc(size);
		let offset = 0;
    
		// 模拟 Protobuf 编码格式
		while (offset < size - 10) {
			// Field number and wire type
			buffer[offset++] = (Math.floor(Math.random() * 15) << 3) | Math.floor(Math.random() * 6);
      
			// Varint length
			const length = Math.min(Math.floor(Math.random() * 100), size - offset - 1);
			buffer[offset++] = length;
      
			// Data
			for (let i = 0; i < length && offset < size; i++) {
				buffer[offset++] = Math.floor(Math.random() * 256);
			}
		}
    
		return buffer;
	}
  
	/**
   * 生成测试报告
   */
	private generateReport(): void {
		logger.info(`\n${  '='.repeat(80)}`);
		logger.info('📊 压缩性能测试报告');
		logger.info('='.repeat(80));
    
		// 按数据类型分组
		const byDataType = new Map<string, CompressionTestResult[]>();
		for (const result of this.results) {
			if (!byDataType.has(result.dataType)) {
				byDataType.set(result.dataType, []);
			}
      byDataType.get(result.dataType)!.push(result);
		}
    
		// 输出每种数据类型的统计
		for (const [dataType, results] of byDataType) {
			logger.info(`\n📄 ${dataType} 数据类型`);
			logger.info('-'.repeat(60));
      
			// 按算法分组计算平均值
			const byAlgorithm = new Map<CompressionAlgorithm, {
        avgRatio: number;
        avgCompressionTime: number;
        avgDecompressionTime: number;
        avgThroughput: number;
      }>();
      
			for (const algorithm of this.algorithms) {
				const algorithmResults = results.filter(r => r.algorithm === algorithm);
				if (algorithmResults.length === 0) {continue;}
        
				const avgRatio = algorithmResults.reduce((a, b) => a + b.compressionRatio, 0) / algorithmResults.length;
				const avgCompressionTime = algorithmResults.reduce((a, b) => a + b.compressionTime, 0) / algorithmResults.length;
				const avgDecompressionTime = algorithmResults.reduce((a, b) => a + b.decompressionTime, 0) / algorithmResults.length;
				const avgThroughput = algorithmResults.reduce((a, b) => a + b.throughput, 0) / algorithmResults.length;
        
				byAlgorithm.set(algorithm, {
					avgRatio,
					avgCompressionTime,
					avgDecompressionTime,
					avgThroughput
				});
			}
      
			// 输出表格
			const tableData = Array.from(byAlgorithm.entries()).map(([algorithm, stats]) => ({
				'算法': algorithm,
				'平均压缩率': stats.avgRatio.toFixed(2),
				'压缩时间(ms)': stats.avgCompressionTime.toFixed(1),
				'解压时间(ms)': stats.avgDecompressionTime.toFixed(1),
				'吞吐量(MB/s)': stats.avgThroughput.toFixed(2)
			}));
      
			console.table(tableData);
		}
    
		// 推荐算法
		logger.info('\n💡 推荐方案');
		logger.info('-'.repeat(60));
    
		// JSON 数据推荐
		const jsonResults = this.results.filter(r => r.dataType === 'JSON');
		if (jsonResults.length > 0) {
			const bestJson = jsonResults.reduce((a, b) => 
				(a.compressionRatio * a.throughput > b.compressionRatio * b.throughput) ? a : b
			);
			logger.info(`  JSON 数据: ${bestJson.algorithm} (压缩率 ${bestJson.compressionRatio.toFixed(2)}, 吞吐量 ${bestJson.throughput.toFixed(2)} MB/s)`);
		}
    
		// 二进制数据推荐
		const binaryResults = this.results.filter(r => r.dataType === 'Binary' || r.dataType === 'Protobuf');
		if (binaryResults.length > 0) {
			const bestBinary = binaryResults.reduce((a, b) => 
				(a.throughput > b.throughput) ? a : b
			);
			logger.info(`  二进制数据: ${bestBinary.algorithm} (吞吐量 ${bestBinary.throughput.toFixed(2)} MB/s)`);
		}
    
		// 保存到文件
		const reportPath = path.join(process.cwd(), `compression-test-${Date.now()}.json`);
		fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
		logger.info(`\n📄 详细报告已保存到: ${reportPath}`);
	}
}

/**
 * 运行测试
 */
export async function runCompressionPerformanceTest(): Promise<void> {
	const test = new CompressionPerformanceTest();
	await test.runFullTest();
}

// 如果直接运行此文件
if (require.main === module) {
	runCompressionPerformanceTest().catch(console.error);
}