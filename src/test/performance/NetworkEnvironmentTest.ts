/**
 * 不同网络环境下的性能测试
 * 模拟各种网络条件并测试传输性能
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { TcpClient } from '../../extension/tcp/TcpClient';
import { AdaptiveChunkStrategy, NetworkQuality } from '../../shared/strategies/AdaptiveChunkStrategy';
import { Logger } from '../../shared/utils/Logger';

const logger = new Logger('NetworkEnvironmentTest');

/**
 * 网络环境配置
 */
interface NetworkEnvironment {
  name: string;
  bandwidth: number;      // 带宽（字节/秒）
  latency: number;        // 延迟（毫秒）
  packetLoss: number;     // 丢包率（0-1）
  jitter: number;         // 抖动（毫秒）
}

/**
 * 测试结果
 */
interface TestResult {
  environment: string;
  fileSize: number;
  uploadTime: number;
  downloadTime: number;
  uploadSpeed: number;
  downloadSpeed: number;
  averageChunkSize: number;
  retryCount: number;
  networkQuality: NetworkQuality;
  compressionRatio: number;
}

/**
 * 网络环境测试类
 */
export class NetworkEnvironmentTest {
	private client: TcpClient;
	private results: TestResult[] = [];
  
	// 预定义的网络环境
	private readonly environments: NetworkEnvironment[] = [
		{
			name: '局域网（优秀）',
			bandwidth: 100 * 1024 * 1024,  // 100MB/s
			latency: 1,
			packetLoss: 0,
			jitter: 0
		},
		{
			name: '宽带网络（良好）',
			bandwidth: 10 * 1024 * 1024,   // 10MB/s
			latency: 20,
			packetLoss: 0.001,
			jitter: 5
		},
		{
			name: '4G网络（中等）',
			bandwidth: 2 * 1024 * 1024,    // 2MB/s
			latency: 50,
			packetLoss: 0.01,
			jitter: 10
		},
		{
			name: '3G网络（较差）',
			bandwidth: 500 * 1024,          // 500KB/s
			latency: 100,
			packetLoss: 0.03,
			jitter: 20
		},
		{
			name: '2G网络（很差）',
			bandwidth: 50 * 1024,           // 50KB/s
			latency: 300,
			packetLoss: 0.05,
			jitter: 50
		}
	];
  
	// 测试文件大小
	private readonly testFileSizes = [
		{ size: 100 * 1024, name: '100KB' },
		{ size: 1024 * 1024, name: '1MB' },
		{ size: 10 * 1024 * 1024, name: '10MB' },
		{ size: 50 * 1024 * 1024, name: '50MB' }
	];
  
	constructor(client: TcpClient) {
		this.client = client;
	}
  
	/**
   * 运行完整测试套件
   */
	async runFullTest(): Promise<void> {
		logger.info('开始网络环境性能测试');
    
		for (const env of this.environments) {
			logger.info(`\n🌐 测试环境: ${env.name}`);
			logger.info(`  带宽: ${this.formatBytes(env.bandwidth)}/s`);
			logger.info(`  延迟: ${env.latency}ms`);
			logger.info(`  丢包率: ${(env.packetLoss * 100).toFixed(2)}%`);
      
			// 模拟网络环境
			await this.simulateNetworkEnvironment(env);
      
			// 测试不同大小的文件
			for (const fileInfo of this.testFileSizes) {
				await this.testFileTransfer(env, fileInfo);
			}
		}
    
		// 生成报告
		this.generateReport();
	}
  
	/**
   * 测试单个文件传输
   */
	private async testFileTransfer(
		env: NetworkEnvironment, 
		fileInfo: { size: number; name: string }
	): Promise<void> {
		logger.info(`  📁 测试文件: ${fileInfo.name}`);
    
		// 生成测试文件
		const testFile = this.generateTestFile(fileInfo.size);
		const filename = `test_${fileInfo.name}_${Date.now()}.bin`;
    
		try {
			// 测试上传
			const uploadStartTime = Date.now();
			const uploadResult = await this.client.uploadFile({
				targetPath: '/test',
				filename,
				buffer: testFile,
				fileSize: fileInfo.size
			});
			const uploadTime = Date.now() - uploadStartTime;
      
			// 测试下载
			const downloadStartTime = Date.now();
			const downloadResult = await this.client.downloadFile({
				filePath: `/test/${filename}`,
				filename
			});
			const downloadTime = Date.now() - downloadStartTime;
      
			// 获取自适应策略统计
			const chunkStrategy = (this.client as any).chunkStrategy as AdaptiveChunkStrategy;
			const stats = chunkStrategy.getStats();
      
			// 记录结果
			const result: TestResult = {
				environment: env.name,
				fileSize: fileInfo.size,
				uploadTime,
				downloadTime,
				uploadSpeed: fileInfo.size / (uploadTime / 1000),
				downloadSpeed: fileInfo.size / (downloadTime / 1000),
				averageChunkSize: stats.totalBytes / Math.max(stats.totalChunks, 1),
				retryCount: stats.retryCount,
				networkQuality: stats.networkQuality,
				compressionRatio: 1.0  // 将从编解码器获取
			};
      
			this.results.push(result);
      
			logger.info(`    ✅ 上传: ${this.formatBytes(result.uploadSpeed)}/s (${uploadTime}ms)`);
			logger.info(`    ✅ 下载: ${this.formatBytes(result.downloadSpeed)}/s (${downloadTime}ms)`);
			logger.info(`    📊 平均块大小: ${this.formatBytes(result.averageChunkSize)}`);
			logger.info(`    🔄 重试次数: ${result.retryCount}`);
			logger.info(`    📶 网络质量: ${result.networkQuality}`);
      
			// 清理测试文件
			await this.client.deleteFile(`/test/${filename}`);
      
			// 重置策略统计
			chunkStrategy.resetStats();
      
		} catch (error) {
			logger.error(`测试失败: ${env.name} - ${fileInfo.name}`, error);
		}
	}
  
	/**
   * 模拟网络环境
   */
	private async simulateNetworkEnvironment(env: NetworkEnvironment): Promise<void> {
		// 注意：这里需要系统级的网络控制工具（如 tc 在 Linux 上）
		// 或者使用代理服务器来模拟网络条件
		// 这里仅作为示例，实际实现需要根据操作系统进行适配
    
		if (process.platform === 'linux') {
			const { exec } = require('child_process');
			const interface = 'eth0';  // 需要根据实际情况调整
      
			// 使用 tc (traffic control) 模拟网络条件
			const commands = [
				// 删除现有规则
				`sudo tc qdisc del dev ${interface} root 2>/dev/null || true`,
        
				// 添加根队列
				`sudo tc qdisc add dev ${interface} root handle 1: htb default 12`,
        
				// 设置带宽限制
				`sudo tc class add dev ${interface} parent 1: classid 1:12 htb rate ${env.bandwidth}`,
        
				// 添加延迟、丢包和抖动
				`sudo tc qdisc add dev ${interface} parent 1:12 handle 20: netem delay ${env.latency}ms ${env.jitter}ms loss ${env.packetLoss * 100}%`
			];
      
			for (const cmd of commands) {
				await new Promise((resolve, reject) => {
					exec(cmd, (error: any, stdout: any, stderr: any) => {
						if (error && !cmd.includes('del')) {
							logger.warn(`网络模拟命令失败: ${cmd}`, error);
						}
						resolve(null);
					});
				});
			}
      
			logger.info('  ⚡ 网络环境模拟已应用');
      
		} else {
			logger.warn('  ⚠️ 网络环境模拟仅在 Linux 上支持，使用真实网络条件');
		}
	}
  
	/**
   * 生成测试文件
   */
	private generateTestFile(size: number): Buffer {
		const buffer = Buffer.alloc(size);
    
		// 填充随机数据（模拟真实文件）
		for (let i = 0; i < size; i += 1024) {
			const chunk = Buffer.from(Math.random().toString(36).repeat(100));
			chunk.copy(buffer, i, 0, Math.min(1024, size - i));
		}
    
		return buffer;
	}
  
	/**
   * 生成测试报告
   */
	private generateReport(): void {
		logger.info(`\n${  '='.repeat(80)}`);
		logger.info('📊 网络环境性能测试报告');
		logger.info('='.repeat(80));
    
		// 按环境分组
		const byEnvironment = new Map<string, TestResult[]>();
		for (const result of this.results) {
			if (!byEnvironment.has(result.environment)) {
				byEnvironment.set(result.environment, []);
			}
      byEnvironment.get(result.environment)!.push(result);
		}
    
		// 输出每个环境的统计
		for (const [env, results] of byEnvironment) {
			logger.info(`\n🌐 ${env}`);
			logger.info('-'.repeat(60));
      
			// 计算平均值
			const avgUploadSpeed = results.reduce((a, b) => a + b.uploadSpeed, 0) / results.length;
			const avgDownloadSpeed = results.reduce((a, b) => a + b.downloadSpeed, 0) / results.length;
			const avgChunkSize = results.reduce((a, b) => a + b.averageChunkSize, 0) / results.length;
			const totalRetries = results.reduce((a, b) => a + b.retryCount, 0);
      
			logger.info(`  平均上传速度: ${this.formatBytes(avgUploadSpeed)}/s`);
			logger.info(`  平均下载速度: ${this.formatBytes(avgDownloadSpeed)}/s`);
			logger.info(`  平均块大小: ${this.formatBytes(avgChunkSize)}`);
			logger.info(`  总重试次数: ${totalRetries}`);
      
			// 输出详细结果表格
			console.table(results.map(r => ({
				'文件大小': this.formatBytes(r.fileSize),
				'上传速度': `${this.formatBytes(r.uploadSpeed)}/s`,
				'下载速度': `${this.formatBytes(r.downloadSpeed)}/s`,
				'块大小': this.formatBytes(r.averageChunkSize),
				'重试': r.retryCount,
				'网络质量': r.networkQuality
			})));
		}
    
		// 保存到文件
		const reportPath = path.join(process.cwd(), `network-test-${Date.now()}.json`);
		fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
		logger.info(`\n📄 详细报告已保存到: ${reportPath}`);
	}
  
	/**
   * 格式化字节数
   */
	private formatBytes(bytes: number): string {
		if (bytes < 1024) {return `${bytes} B`;}
		if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(2)} KB`;}
		if (bytes < 1024 * 1024 * 1024) {return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;}
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}
}

/**
 * 运行测试
 */
export async function runNetworkEnvironmentTest(host: string, port: number): Promise<void> {
	const client = new TcpClient();
  
	try {
		// 连接到服务器
		await client.connect({
			host,
			port,
			dataFormat: 'protobuf'
		});
    
		logger.info('已连接到服务器，开始测试...\n');
    
		// 运行测试
		const test = new NetworkEnvironmentTest(client);
		await test.runFullTest();
    
	} catch (error) {
		logger.error('测试失败:', error);
	} finally {
		await client.disconnect();
	}
}

// 如果直接运行此文件
if (require.main === module) {
	const host = process.argv[2] || 'localhost';
	const port = parseInt(process.argv[3] || '8888');
  
	runNetworkEnvironmentTest(host, port).catch(console.error);
}