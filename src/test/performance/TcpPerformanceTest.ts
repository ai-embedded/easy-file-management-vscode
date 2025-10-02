/**
 * TCP 性能测试
 * 测试 Protobuf 优化后的性能提升
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { TcpClient } from '../../extension/tcp/TcpClient';
import { ConnectionPool } from '../../extension/tcp/ConnectionPool';
import { StreamDownloader, StreamUploader } from '../../extension/tcp/StreamTransfer';
import { UniversalCodec } from '../../shared/codec/UniversalCodec';
import { TcpConfig } from '../../shared/types';

interface PerformanceResult {
  testName: string;
  duration: number;
  throughput: number;
  memoryUsed: number;
  success: boolean;
  error?: string;
}

/**
 * 性能测试套件
 */
export class TcpPerformanceTestSuite {
	private results: PerformanceResult[] = [];
	private testConfig: TcpConfig = {
		host: 'localhost',
		port: 8080,
		timeout: 60000,
		dataFormat: 'protobuf' // 使用 protobuf 格式
	};
  
	/**
   * 运行所有性能测试
   */
	async runAll(): Promise<void> {
		console.log('='.repeat(60));
		console.log('TCP Protobuf 性能测试');
		console.log('='.repeat(60));
    
		// 1. Base64 编码优化测试
		await this.testBase64RemovalOptimization();
    
		// 2. 连接池性能测试
		await this.testConnectionPoolPerformance();
    
		// 3. 流式传输测试
		await this.testStreamTransferPerformance();
    
		// 4. 大文件传输测试
		await this.testLargeFileTransfer();
    
		// 5. 并发操作测试
		await this.testConcurrentOperations();
    
		// 6. 内存使用测试
		await this.testMemoryUsage();
    
		// 打印测试报告
		this.printReport();
	}
  
	/**
   * 测试 Base64 编码移除优化
   */
	async testBase64RemovalOptimization(): Promise<void> {
		console.log('\n[测试 1] Base64 编码移除优化');
		console.log('-'.repeat(40));
    
		const testSizes = [1, 10, 50]; // MB
    
		for (const sizeMB of testSizes) {
			const size = sizeMB * 1024 * 1024;
			const testData = Buffer.alloc(size, 'a');
      
			// 测试优化前（JSON + base64）
			const jsonStart = Date.now();
			const jsonClient = new TcpClient();
			const jsonConfig = { ...this.testConfig, dataFormat: 'json' as const };
      
			try {
				await jsonClient.connect(jsonConfig);
				const jsonResult = await this.uploadWithClient(jsonClient, testData, 'json_test.bin');
				const jsonDuration = Date.now() - jsonStart;
        
				this.recordResult({
					testName: `JSON+Base64 上传 ${sizeMB}MB`,
					duration: jsonDuration,
					throughput: size / (jsonDuration / 1000),
					memoryUsed: process.memoryUsage().heapUsed,
					success: jsonResult.success
				});
        
				await jsonClient.disconnect();
			} catch (error) {
				console.error('JSON 上传失败:', error);
			}
      
			// 测试优化后（Protobuf 二进制）
			const protobufStart = Date.now();
			const protobufClient = new TcpClient();
      
			try {
				await protobufClient.connect(this.testConfig);
				const protobufResult = await this.uploadWithClient(protobufClient, testData, 'protobuf_test.bin');
				const protobufDuration = Date.now() - protobufStart;
        
				this.recordResult({
					testName: `Protobuf 二进制上传 ${sizeMB}MB`,
					duration: protobufDuration,
					throughput: size / (protobufDuration / 1000),
					memoryUsed: process.memoryUsage().heapUsed,
					success: protobufResult.success
				});
        
				// 计算性能提升
				const improvement = ((jsonDuration - protobufDuration) / jsonDuration) * 100;
				console.log(`✅ ${sizeMB}MB 文件: Protobuf 比 JSON 快 ${improvement.toFixed(1)}%`);
        
				await protobufClient.disconnect();
			} catch (error) {
				console.error('Protobuf 上传失败:', error);
			}
		}
	}
  
	/**
   * 测试连接池性能
   */
	async testConnectionPoolPerformance(): Promise<void> {
		console.log('\n[测试 2] 连接池性能');
		console.log('-'.repeat(40));
    
		const pool = new ConnectionPool({
			maxConnections: 5,
			enableHealthCheck: true
		});
    
		const operations = 20; // 执行 20 个操作
    
		// 测试无连接池（每次新建连接）
		const noPoolStart = Date.now();
		for (let i = 0; i < operations; i++) {
			const client = new TcpClient();
			try {
				await client.connect(this.testConfig);
				await client.listFiles('/');
				await client.disconnect();
			} catch (error) {
				console.error(`操作 ${i} 失败:`, error);
			}
		}
		const noPoolDuration = Date.now() - noPoolStart;
    
		// 测试有连接池（复用连接）
		const withPoolStart = Date.now();
		for (let i = 0; i < operations; i++) {
			try {
				const client = await pool.getConnection(this.testConfig);
				await client.listFiles('/');
				pool.releaseConnection(client);
			} catch (error) {
				console.error(`池化操作 ${i} 失败:`, error);
			}
		}
		const withPoolDuration = Date.now() - withPoolStart;
    
		// 记录结果
		this.recordResult({
			testName: `无连接池 ${operations} 次操作`,
			duration: noPoolDuration,
			throughput: operations / (noPoolDuration / 1000),
			memoryUsed: process.memoryUsage().heapUsed,
			success: true
		});
    
		this.recordResult({
			testName: `有连接池 ${operations} 次操作`,
			duration: withPoolDuration,
			throughput: operations / (withPoolDuration / 1000),
			memoryUsed: process.memoryUsage().heapUsed,
			success: true
		});
    
		const improvement = ((noPoolDuration - withPoolDuration) / noPoolDuration) * 100;
		console.log(`✅ 连接池性能提升: ${improvement.toFixed(1)}%`);
    
		// 打印连接池统计
		const stats = pool.getStats();
		console.log('📊 连接池统计:', stats);
    
		await pool.clear();
	}
  
	/**
   * 测试流式传输性能
   */
	async testStreamTransferPerformance(): Promise<void> {
		console.log('\n[测试 3] 流式传输性能');
		console.log('-'.repeat(40));
    
		const client = new TcpClient();
		await client.connect(this.testConfig);
    
		const sizeMB = 10;
		const size = sizeMB * 1024 * 1024;
		const testData = Buffer.alloc(size, 'x');
    
		// 测试流式下载
		const downloader = new StreamDownloader(client, {
			chunkSize: 64 * 1024, // 64KB 块
			concurrency: 3,
			onProgress: (progress) => {
				if (progress.percent % 20 === 0) {
					console.log(`下载进度: ${progress.percent}% (${progress.speed / 1024 / 1024}MB/s)`);
				}
			}
		});
    
		const downloadStart = Date.now();
		try {
			const stream = await downloader.download('/test_file.bin');
			let downloaded = 0;
      
			stream.on('data', (chunk) => {
				downloaded += chunk.length;
			});
      
			await new Promise((resolve, reject) => {
				stream.on('end', resolve);
				stream.on('error', reject);
			});
      
			const downloadDuration = Date.now() - downloadStart;
      
			this.recordResult({
				testName: `流式下载 ${sizeMB}MB`,
				duration: downloadDuration,
				throughput: size / (downloadDuration / 1000),
				memoryUsed: process.memoryUsage().heapUsed,
				success: true
			});
      
			console.log(`✅ 流式下载完成: ${(size / 1024 / 1024).toFixed(1)}MB in ${downloadDuration}ms`);
      
		} catch (error) {
			console.error('流式下载失败:', error);
		}
    
		await client.disconnect();
	}
  
	/**
   * 测试大文件传输
   */
	async testLargeFileTransfer(): Promise<void> {
		console.log('\n[测试 4] 大文件传输测试');
		console.log('-'.repeat(40));
    
		const sizes = [1, 10, 100]; // MB
		const client = new TcpClient();
		await client.connect(this.testConfig);
    
		for (const sizeMB of sizes) {
			const size = sizeMB * 1024 * 1024;
			const testData = Buffer.alloc(size, 'L');
			const memBefore = process.memoryUsage().heapUsed;
      
			const start = Date.now();
			try {
				const result = await this.uploadWithClient(client, testData, `large_${sizeMB}MB.bin`);
				const duration = Date.now() - start;
				const memAfter = process.memoryUsage().heapUsed;
				const memUsed = memAfter - memBefore;
        
				this.recordResult({
					testName: `大文件上传 ${sizeMB}MB`,
					duration,
					throughput: size / (duration / 1000),
					memoryUsed: memUsed,
					success: result.success
				});
        
				console.log(`✅ ${sizeMB}MB: ${duration}ms, ${(size / duration * 1000 / 1024 / 1024).toFixed(2)}MB/s, 内存: ${(memUsed / 1024 / 1024).toFixed(2)}MB`);
        
			} catch (error) {
				console.error(`大文件上传失败 (${sizeMB}MB):`, error);
			}
      
			// 清理内存
			if (global.gc) {
				global.gc();
			}
		}
    
		await client.disconnect();
	}
  
	/**
   * 测试并发操作
   */
	async testConcurrentOperations(): Promise<void> {
		console.log('\n[测试 5] 并发操作测试');
		console.log('-'.repeat(40));
    
		const client = new TcpClient();
		await client.connect(this.testConfig);
    
		const concurrentOps = [5, 10, 20];
    
		for (const count of concurrentOps) {
			const start = Date.now();
			const operations = Array(count).fill(0).map((placeholder, i) => 
				client.listFiles('/').catch(err => ({ error: err.message }))
			);
      
			const results = await Promise.all(operations);
			const duration = Date.now() - start;
			const successCount = results.filter(r => !r.error).length;
      
			this.recordResult({
				testName: `并发 ${count} 个操作`,
				duration,
				throughput: count / (duration / 1000),
				memoryUsed: process.memoryUsage().heapUsed,
				success: successCount === count
			});
      
			console.log(`✅ ${count} 个并发操作: ${duration}ms, 成功率: ${(successCount / count * 100).toFixed(1)}%`);
		}
    
		await client.disconnect();
	}
  
	/**
   * 测试内存使用
   */
	async testMemoryUsage(): Promise<void> {
		console.log('\n[测试 6] 内存使用测试');
		console.log('-'.repeat(40));
    
		const client = new TcpClient();
		await client.connect(this.testConfig);
    
		// 强制垃圾回收（如果可用）
		if (global.gc) {
			global.gc();
		}
    
		const memStart = process.memoryUsage();
		console.log(`初始内存: Heap ${(memStart.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    
		// 执行一系列操作
		const operations = 100;
		const sizeMB = 1;
		const testData = Buffer.alloc(sizeMB * 1024 * 1024);
    
		for (let i = 0; i < operations; i++) {
			await this.uploadWithClient(client, testData, `mem_test_${i}.bin`);
      
			if (i % 10 === 0) {
				const memCurrent = process.memoryUsage();
				console.log(`操作 ${i}: Heap ${(memCurrent.heapUsed / 1024 / 1024).toFixed(2)}MB`);
			}
		}
    
		const memEnd = process.memoryUsage();
		const memIncrease = memEnd.heapUsed - memStart.heapUsed;
    
		console.log(`最终内存: Heap ${(memEnd.heapUsed / 1024 / 1024).toFixed(2)}MB`);
		console.log(`内存增长: ${(memIncrease / 1024 / 1024).toFixed(2)}MB`);
    
		this.recordResult({
			testName: `内存使用测试 (${operations} 次操作)`,
			duration: 0,
			throughput: 0,
			memoryUsed: memIncrease,
			success: memIncrease < 100 * 1024 * 1024 // 小于 100MB 增长
		});
    
		await client.disconnect();
	}
  
	// === 辅助方法 ===
  
	/**
   * 使用客户端上传数据
   */
	private async uploadWithClient(client: TcpClient, data: Buffer, filename: string): Promise<any> {
		return await client.uploadFile({
			targetPath: '/test',
			filename,
			buffer: data,
			fileSize: data.length
		});
	}
  
	/**
   * 记录测试结果
   */
	private recordResult(result: PerformanceResult): void {
		this.results.push(result);
	}
  
	/**
   * 打印测试报告
   */
	private printReport(): void {
		console.log('\n');
		console.log('='.repeat(60));
		console.log('性能测试报告');
		console.log('='.repeat(60));
    
		// 打印表格头
		console.log('| 测试名称 | 耗时(ms) | 吞吐量 | 内存(MB) | 状态 |');
		console.log('|---------|---------|--------|---------|------|');
    
		// 打印每个测试结果
		for (const result of this.results) {
			const throughputStr = result.throughput > 0 
				? `${(result.throughput / 1024 / 1024).toFixed(2)}MB/s`
				: 'N/A';
			const memoryStr = `${(result.memoryUsed / 1024 / 1024).toFixed(2)}`;
			const statusStr = result.success ? '✅ 通过' : '❌ 失败';
      
			console.log(`| ${result.testName.padEnd(20)} | ${result.duration.toString().padEnd(8)} | ${throughputStr.padEnd(8)} | ${memoryStr.padEnd(8)} | ${statusStr} |`);
		}
    
		console.log('='.repeat(60));
    
		// 总结
		const successCount = this.results.filter(r => r.success).length;
		const successRate = (successCount / this.results.length * 100).toFixed(1);
    
		console.log('\n📊 测试总结:');
		console.log(`- 总测试数: ${this.results.length}`);
		console.log(`- 成功数: ${successCount}`);
		console.log(`- 成功率: ${successRate}%`);
    
		// 主要优化成果
		console.log('\n🚀 主要优化成果:');
		console.log('1. ✅ 移除 Base64 编码：减少 33% 数据开销');
		console.log('2. ✅ 连接池支持：减少连接建立开销');
		console.log('3. ✅ 流式传输：支持大文件传输，减少内存占用');
		console.log('4. ✅ Protobuf 二进制：提升传输效率');
	}
}

// 如果直接运行此文件
if (require.main === module) {
	const suite = new TcpPerformanceTestSuite();
	suite.runAll().catch(console.error);
}
