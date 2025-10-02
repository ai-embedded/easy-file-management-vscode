import { Client as BasicFtp } from 'basic-ftp';

export interface FtpServerCapabilities {
  // 基础能力
  supportsPASV: boolean;      // 被动模式
  supportsEPSV: boolean;      // 扩展被动模式
  supportsREST: boolean;      // 断点续传
  supportsSIZE: boolean;      // 获取文件大小
  supportsMDTM: boolean;      // 获取修改时间
  
  // 扩展能力
  supportsModeZ: boolean;    // 压缩传输
  supportsMLSD: boolean;      // 机器可读目录列表
  supportsSITE: boolean;      // 扩展命令
  supportsUTF8: boolean;      // UTF8 编码支持
  supportsAPPE: boolean;      // 文件追加
  
  // 性能特征
  maxConnections: number;     // 最大连接数
  transferBufferSize: number; // 建议传输缓冲区大小
  commandResponseTime: number; // 平均命令响应时间
  
  // 服务器信息
  serverSoftware: string;     // 服务器软件信息
  serverFeatures: string[];   // 支持的特性列表
  protocolVersion: string;    // FTP 协议版本
  
  // 检测元数据
  detectionTime: number;      // 检测时间戳
  detectionReliability: number; // 检测可靠度 (0-1)
}

interface CapabilityTest {
  command: string;
  expectedCodes?: number[];
  timeout?: number;
  critical?: boolean;
  description: string;
}

interface DetectionConfig {
  testTimeout: number;
  enablePerformanceTests: boolean;
  enableExtensiveTests: boolean;
  maxConnectionTest: number;
  cacheResults: boolean;
  enableLogging: boolean;
}

/**
 * FTP 服务器能力检测器
 * 
 * 功能特性：
 * - 全面的服务器能力检测
 * - 性能特征分析
 * - 兼容性评估
 * - 智能检测策略
 * - 结果缓存管理
 * - 可靠度评分
 */
export class FtpCapabilityDetector {
	private config: DetectionConfig;
	private capabilityCache = new Map<string, { capabilities: FtpServerCapabilities; expires: number }>();
	private cacheValidDuration = 3600000; // 1 小时缓存有效期

	constructor(config: Partial<DetectionConfig> = {}) {
		this.config = {
			testTimeout: config.testTimeout ?? 10000,
			enablePerformanceTests: config.enablePerformanceTests ?? true,
			enableExtensiveTests: config.enableExtensiveTests ?? false,
			maxConnectionTest: config.maxConnectionTest ?? 5,
			cacheResults: config.cacheResults ?? true,
			enableLogging: config.enableLogging ?? true
		};
	}

	/**
   * 检测服务器能力
   */
	async detectServerCapabilities(client: BasicFtp, serverHost: string): Promise<FtpServerCapabilities> {
		const cacheKey = this.getCacheKey(serverHost, client);
    
		// 检查缓存
		if (this.config.cacheResults && this.isCacheValid(cacheKey)) {
			if (this.config.enableLogging) {
				console.log('[FtpCapabilityDetector] 使用缓存的服务器能力');
			}
			return this.capabilityCache.get(cacheKey)!.capabilities;
		}

		if (this.config.enableLogging) {
			console.log('[FtpCapabilityDetector] 开始服务器能力检测');
		}

		const startTime = Date.now();
		const capabilities = await this.performDetection(client, serverHost);
		const detectionTime = Date.now() - startTime;

		capabilities.detectionTime = startTime;
		capabilities.commandResponseTime = detectionTime / 10; // 平均命令响应时间估算

		// 缓存结果
		if (this.config.cacheResults) {
			this.capabilityCache.set(cacheKey, {
				capabilities,
				expires: Date.now() + this.cacheValidDuration
			});
		}

		if (this.config.enableLogging) {
			console.log(`[FtpCapabilityDetector] 检测完成 (${detectionTime}ms)`, capabilities);
		}

		return capabilities;
	}

	/**
   * 测试特定命令支持
   */
	async testCommandSupport(client: BasicFtp, command: string): Promise<boolean> {
		try {
			const timeout = new Promise((resolve, reject) => {
				setTimeout(() => reject(new Error('命令测试超时')), this.config.testTimeout);
			});

			const response = await Promise.race([
				client.send(command),
				timeout
			]) as any;

			// 基于响应码严格判定
			// basic-ftp的send方法返回响应对象，包含code属性
			if (response && typeof response === 'object' && 'code' in response) {
				const code = response.code;
				// 2xx和3xx表示成功
				if (code >= 200 && code < 400) {
					return true;
				}
				// 4xx和5xx表示不支持或错误
				if (code >= 400 && code < 600) {
					if (this.config.enableLogging) {
						console.log(`[FtpCapabilityDetector] 命令 ${command} 不支持，响应码: ${code}`);
					}
					return false;
				}
			}

			// 如果没有明确的响应码，默认认为支持（但记录日志）
			if (this.config.enableLogging) {
				console.warn(`[FtpCapabilityDetector] 命令 ${command} 测试未返回明确响应码，默认视为支持`);
			}
			return true;
		} catch (error) {
			const errorMessage = (error as Error).message.toLowerCase();
      
			// 基于错误消息严格判定
			if (errorMessage.includes('unknown command') || 
          errorMessage.includes('not implemented') ||
          errorMessage.includes('command not understood') ||
          errorMessage.includes('unrecognized command') ||
          errorMessage.includes('504') || // 504 Command not implemented for that parameter
          errorMessage.includes('502') || // 502 Command not implemented
          errorMessage.includes('500')) { // 500 Syntax error, command unrecognized
				if (this.config.enableLogging) {
					console.log(`[FtpCapabilityDetector] 命令 ${command} 不支持: ${errorMessage}`);
				}
				return false;
			}
      
			// 对于超时错误，也视为不支持
			if (errorMessage.includes('timeout') || errorMessage.includes('超时')) {
				if (this.config.enableLogging) {
					console.log(`[FtpCapabilityDetector] 命令 ${command} 测试超时，视为不支持`);
				}
				return false;
			}
      
			// 其他错误默认视为不支持（更保守的策略）
			if (this.config.enableLogging) {
				console.warn(`[FtpCapabilityDetector] 命令 ${command} 测试失败，视为不支持: ${errorMessage}`);
			}
			return false;
		}
	}

	/**
   * 获取服务器特性列表
   */
	async getServerFeatures(client: BasicFtp): Promise<string[]> {
		try {
			const response = await client.send('FEAT');
			const lines = response.message.split('\n');
      
			return lines
				.slice(1, -1) // 跳过第一行和最后一行
				.map(line => line.trim().split(' ')[0])
				.filter(feature => feature.length > 0);
        
		} catch (error) {
			if (this.config.enableLogging) {
				console.warn('[FtpCapabilityDetector] FEAT 命令不支持:', error);
			}
			return [];
		}
	}

	/**
   * 清除缓存
   */
	clearCache(serverHost?: string): void {
		if (serverHost) {
			// 清除特定服务器的缓存
			const keysToDelete = Array.from(this.capabilityCache.keys())
				.filter(key => key.includes(serverHost));
			keysToDelete.forEach(key => this.capabilityCache.delete(key));
		} else {
			// 清除所有缓存
			this.capabilityCache.clear();
		}

		if (this.config.enableLogging) {
			console.log('[FtpCapabilityDetector] 已清除缓存');
		}
	}

	/**
   * 获取检测统计信息
   */
	getCacheStats(): { entries: number; hitRate: number; oldestEntry: number } {
		const entries = this.capabilityCache.size;
		let oldestEntry = Date.now();
    
		for (const { expires } of this.capabilityCache.values()) {
			if (expires < oldestEntry) {
				oldestEntry = expires;
			}
		}

		return {
			entries,
			hitRate: 0, // 需要实际跟踪命中率
			oldestEntry
		};
	}

	// 私有方法实现

	private async performDetection(client: BasicFtp, serverHost: string): Promise<FtpServerCapabilities> {
		const capabilities: Partial<FtpServerCapabilities> = {
			serverFeatures: [],
			detectionReliability: 0
		};

		let successfulTests = 0;
		let totalTests = 0;
		let featBasedDetection = false;

		// 获取服务器信息
		try {
			const serverInfo = await this.getServerInfo(client);
			capabilities.serverSoftware = serverInfo.software;
			capabilities.protocolVersion = serverInfo.version;
		} catch (error) {
			capabilities.serverSoftware = 'Unknown';
			capabilities.protocolVersion = 'Unknown';
		}

		// 优先使用FEAT命令获取服务器特性列表
		capabilities.serverFeatures = await this.getServerFeatures(client);
    
		// 如果FEAT命令成功，基于特性列表判断支持的功能
		if (capabilities.serverFeatures && capabilities.serverFeatures.length > 0) {
			featBasedDetection = true;
			const features = capabilities.serverFeatures.map(f => f.toUpperCase());
      
			// 基于FEAT结果判断能力（更可靠）
			capabilities.supportsPASV = true; // PASV通常总是支持的
			capabilities.supportsEPSV = features.includes('EPSV');
			capabilities.supportsREST = features.includes('REST');
			capabilities.supportsSIZE = features.includes('SIZE');
			capabilities.supportsMDTM = features.includes('MDTM');
			capabilities.supportsModeZ = features.includes('MODE') && features.some(f => f.includes('Z'));
			capabilities.supportsMLSD = features.includes('MLSD') || features.includes('MLST');
			capabilities.supportsSITE = features.includes('SITE');
			capabilities.supportsUTF8 = features.includes('UTF8');
			capabilities.supportsAPPE = features.includes('APPE');
      
			if (this.config.enableLogging) {
				console.log('[FtpCapabilityDetector] 基于FEAT命令检测到的特性:', features);
			}
      
			// 统计成功测试数
			totalTests = 10;
			successfulTests = Object.keys(capabilities)
				.filter(key => key.startsWith('supports') && capabilities[key as keyof FtpServerCapabilities])
				.length;
		} else {
			// FEAT不可用，降级到直接命令测试（不太可靠）
			if (this.config.enableLogging) {
				console.log('[FtpCapabilityDetector] FEAT命令不可用，降级到直接命令测试');
			}

			// 定义能力测试
			const tests: Array<{ key: keyof FtpServerCapabilities; test: CapabilityTest }> = [
				{
					key: 'supportsPASV',
					test: { command: 'PASV', description: '被动模式支持', critical: true }
				},
				{
					key: 'supportsEPSV',
					test: { command: 'EPSV', description: '扩展被动模式支持' }
				},
				{
					key: 'supportsREST',
					test: { command: 'REST 0', description: '断点续传支持', critical: true }
				},
				{
					key: 'supportsSIZE',
					test: { command: 'SIZE /', description: '文件大小查询支持' }
				},
				{
					key: 'supportsMDTM',
					test: { command: 'MDTM /', description: '修改时间查询支持' }
				},
				{
					key: 'supportsModeZ',
					test: { command: 'MODE Z', description: '压缩传输支持' }
				},
				{
					key: 'supportsMLSD',
					test: { command: 'MLSD', description: '机器可读目录列表支持' }
				},
				{
					key: 'supportsSITE',
					test: { command: 'SITE HELP', description: '扩展命令支持' }
				},
				{
					key: 'supportsUTF8',
					test: { command: 'OPTS UTF8 ON', description: 'UTF8 编码支持' }
				},
				{
					key: 'supportsAPPE',
					test: { command: 'APPE', description: '文件追加支持' }
				}
			];

			// 执行能力测试
			for (const { key, test } of tests) {
				totalTests++;
				try {
					const result = await this.testCommandSupport(client, test.command);
					(capabilities as any)[key] = result;
        
					if (result || !test.critical) {
						successfulTests++;
					}

					if (this.config.enableLogging) {
						console.log(`[FtpCapabilityDetector] ${test.description}: ${result ? '支持' : '不支持'}`);
					}
				} catch (error) {
					(capabilities as any)[key] = false;
        
					if (this.config.enableLogging) {
						console.warn(`[FtpCapabilityDetector] ${test.description} 测试失败:`, error);
					}
				}
			}
		} // 关闭else分支

		// 性能测试
		if (this.config.enablePerformanceTests) {
			try {
				capabilities.maxConnections = await this.testMaxConnections(serverHost);
				capabilities.transferBufferSize = await this.estimateOptimalBufferSize(client);
				successfulTests += 2;
			} catch (error) {
				capabilities.maxConnections = 1;
				capabilities.transferBufferSize = 64 * 1024; // 默认 64KB
        
				if (this.config.enableLogging) {
					console.warn('[FtpCapabilityDetector] 性能测试失败:', error);
				}
			}
			totalTests += 2;
		} else {
			capabilities.maxConnections = 1;
			capabilities.transferBufferSize = 64 * 1024;
		}

		// 计算检测可靠度
		// 如果使用了FEAT命令，可靠度更高
		if (featBasedDetection) {
			// FEAT检测的基础可靠度为0.8，加上成功测试的贡献
			capabilities.detectionReliability = 0.8 + (0.2 * (successfulTests / Math.max(totalTests, 1)));
		} else {
			// 直接命令测试的可靠度较低
			capabilities.detectionReliability = 0.5 * (successfulTests / Math.max(totalTests, 1));
		}
    
		// 确保可靠度在0-1之间
		capabilities.detectionReliability = Math.min(1, Math.max(0, capabilities.detectionReliability));
    
		if (this.config.enableLogging) {
			console.log(`[FtpCapabilityDetector] 检测可靠度: ${(capabilities.detectionReliability * 100).toFixed(1)}%`);
		}

		return capabilities as FtpServerCapabilities;
	}

	private async getServerInfo(client: BasicFtp): Promise<{ software: string; version: string }> {
		try {
			const response = await client.send('SYST');
			const systemInfo = response.message.trim();
      
			// 解析系统信息
			const parts = systemInfo.split(' ');
			return {
				software: parts[0] || 'Unknown',
				version: parts[1] || 'Unknown'
			};
		} catch (error) {
			return {
				software: 'Unknown',
				version: 'Unknown'
			};
		}
	}

	private async testMaxConnections(serverHost: string): Promise<number> {
		// 简化的最大连接数测试
		// 实际实现中应该尝试建立多个连接来测试
		return Math.min(this.config.maxConnectionTest, 3); // 保守估计
	}

	private async estimateOptimalBufferSize(client: BasicFtp): Promise<number> {
		// 简化的缓冲区大小估算
		// 实际实现中可以通过小数据传输测试来优化
		return 64 * 1024; // 默认 64KB
	}

	private getCacheKey(serverHost: string, client: BasicFtp): string {
		// 生成更全面的缓存键，包含端口、安全性、用户等信息
		const clientConfig = (client as any).ftp?.config || {};
		const port = clientConfig.port || 21;
		const secure = clientConfig.secure ? 'ftps' : 'ftp';
		const user = clientConfig.user || 'anonymous';
    
		// 组合键：协议://用户@主机:端口
		return `${secure}://${user}@${serverHost}:${port}`;
	}

	private isCacheValid(key: string): boolean {
		const cached = this.capabilityCache.get(key);
		return !!(cached && cached.expires > Date.now());
	}
}
