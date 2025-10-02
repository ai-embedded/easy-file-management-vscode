import { Client as BasicFtp } from 'basic-ftp';
import * as net from 'net';
import * as os from 'os';

export type FtpTransferMode = 'passive' | 'active';

interface NetworkProfile {
  behindNAT: boolean;
  hasPublicIP: boolean;
  canBindPort: boolean;
  preferredMode: FtpTransferMode;
  confidence: number; // 0-1 的信心度
}

interface TransferModeConfig {
  forceMode?: FtpTransferMode;
  enableNetworkDetection?: boolean;
  enablePortTest?: boolean;
  testTimeout?: number;
  cacheResults?: boolean;
  enableLogging?: boolean;
}

/**
 * FTP 传输模式选择器
 * 
 * 功能特性：
 * - 智能模式检测：根据网络环境自动选择最佳传输模式
 * - 网络分析：检测 NAT、防火墙等网络特性
 * - 性能优化：优先选择性能更好的传输模式
 * - 缓存机制：避免重复检测
 * - 回退策略：检测失败时使用安全默认值
 */
export class TransferModeSelector {
	private config: Required<TransferModeConfig>;
	private networkProfileCache?: NetworkProfile;
	private lastDetectionTime?: number;
	private cacheValidDuration = 300000; // 5 分钟缓存有效期

	constructor(config: TransferModeConfig = {}) {
		this.config = {
			forceMode: config.forceMode,
			enableNetworkDetection: config.enableNetworkDetection ?? true,
			enablePortTest: config.enablePortTest ?? true,
			testTimeout: config.testTimeout ?? 5000,
			cacheResults: config.cacheResults ?? true,
			enableLogging: config.enableLogging ?? true
		};
	}

	/**
   * 选择最佳传输模式
   */
	async selectOptimalTransferMode(client?: BasicFtp, serverHost?: string): Promise<FtpTransferMode> {
		// 如果强制指定模式，直接返回
		if (this.config.forceMode) {
			if (this.config.enableLogging) {
				console.log(`[TransferModeSelector] 使用强制指定模式: ${this.config.forceMode}`);
			}
			return this.config.forceMode;
		}

		try {
			// 获取网络配置文件
			const networkProfile = await this.detectNetworkProfile(client, serverHost);
      
			if (this.config.enableLogging) {
				console.log('[TransferModeSelector] 网络配置文件:', networkProfile);
			}

			// 根据网络配置选择模式
			return this.selectModeFromProfile(networkProfile);
		} catch (error) {
			if (this.config.enableLogging) {
				console.warn('[TransferModeSelector] 网络检测失败，使用默认被动模式:', error);
			}
      
			// 默认使用被动模式（更兼容）
			return 'passive';
		}
	}

	/**
   * 测试指定传输模式是否工作
   */
	async testTransferMode(client: BasicFtp, mode: FtpTransferMode): Promise<boolean> {
		try {
			if (this.config.enableLogging) {
				console.log(`[TransferModeSelector] 测试传输模式: ${mode}`);
			}

			// basic-ftp库内部处理传输模式，默认使用被动模式(PASV)
			// 对于主动模式(PORT)，由于需要复杂的网络配置（开放端口、NAT穿透等），
			// 且basic-ftp对主动模式支持有限，建议始终使用被动模式
      
			if (mode === 'active') {
				if (this.config.enableLogging) {
					console.warn('[TransferModeSelector] 主动模式(PORT)需要特殊网络配置，建议使用被动模式(PASV)');
				}
				// 主动模式在大多数NAT/防火墙环境下不可用
				return false;
			}

			// 尝试执行一个简单的列表操作来测试被动模式
			// basic-ftp默认使用被动模式，无需手动发送PASV命令
			await client.list('/');
      
			if (this.config.enableLogging) {
				console.log(`[TransferModeSelector] 传输模式 ${mode} 测试成功`);
			}
      
			return true;
		} catch (error) {
			if (this.config.enableLogging) {
				console.warn(`[TransferModeSelector] 传输模式 ${mode} 测试失败:`, error);
			}
      
			return false;
		}
	}

	/**
   * 获取当前网络配置的建议
   */
	async getNetworkRecommendation(): Promise<{
    recommendedMode: FtpTransferMode;
    reason: string;
    confidence: number;
  }> {
		const networkProfile = await this.detectNetworkProfile();
		const mode = this.selectModeFromProfile(networkProfile);
    
		let reason: string;
		if (networkProfile.behindNAT) {
			reason = '检测到 NAT 环境，建议使用被动模式';
		} else if (networkProfile.hasPublicIP && networkProfile.canBindPort) {
			reason = '检测到公网 IP 且可绑定端口，主动模式可能更高效';
		} else {
			reason = '网络环境复杂，使用被动模式更安全';
		}

		return {
			recommendedMode: mode,
			reason,
			confidence: networkProfile.confidence
		};
	}

	/**
   * 清除缓存
   */
	clearCache(): void {
		this.networkProfileCache = undefined;
		this.lastDetectionTime = undefined;
    
		if (this.config.enableLogging) {
			console.log('[TransferModeSelector] 已清除缓存');
		}
	}

	private async detectNetworkProfile(client?: BasicFtp, serverHost?: string): Promise<NetworkProfile> {
		// 检查缓存
		if (this.config.cacheResults && this.isProfileCacheValid()) {
			return this.networkProfileCache!;
		}

		const profile = await this.analyzeNetworkEnvironment(client, serverHost);
    
		// 缓存结果
		if (this.config.cacheResults) {
			this.networkProfileCache = profile;
			this.lastDetectionTime = Date.now();
		}

		return profile;
	}

	private async analyzeNetworkEnvironment(client?: BasicFtp, serverHost?: string): Promise<NetworkProfile> {
		const results = await Promise.allSettled([
			this.detectNAT(),
			this.detectPublicIP(),
			this.testPortBinding()
		]);

		const behindNAT = results[0].status === 'fulfilled' ? results[0].value : true;
		const hasPublicIP = results[1].status === 'fulfilled' ? results[1].value : false;
		const canBindPort = results[2].status === 'fulfilled' ? results[2].value : false;

		// 计算信心度
		const successfulTests = results.filter(r => r.status === 'fulfilled').length;
		const confidence = successfulTests / results.length;

		// 确定首选模式
		let preferredMode: FtpTransferMode;
		if (behindNAT || !canBindPort) {
			preferredMode = 'passive';
		} else if (hasPublicIP && canBindPort) {
			preferredMode = 'active';
		} else {
			preferredMode = 'passive'; // 默认安全选择
		}

		return {
			behindNAT,
			hasPublicIP,
			canBindPort,
			preferredMode,
			confidence
		};
	}

	private async detectNAT(): Promise<boolean> {
		try {
			const networkInterfaces = os.networkInterfaces();
      
			for (const interfaces of Object.values(networkInterfaces)) {
				if (!interfaces) {continue;}
        
				for (const iface of interfaces) {
					if (iface.family === 'IPv4' && !iface.internal) {
						const ip = iface.address;
            
						// 检查是否为私有 IP 地址
						if (this.isPrivateIP(ip)) {
							return true; // 私有 IP 表示在 NAT 后面
						}
					}
				}
			}
      
			return false;
		} catch (error) {
			if (this.config.enableLogging) {
				console.warn('[TransferModeSelector] NAT 检测失败:', error);
			}
			return true; // 检测失败时保守假设在 NAT 后面
		}
	}

	private async detectPublicIP(): Promise<boolean> {
		// 这里可以通过多种方式检测公网 IP
		// 简化实现：如果不在 NAT 后面，假设有公网 IP
		const behindNAT = await this.detectNAT();
		return !behindNAT;
	}

	private async testPortBinding(): Promise<boolean> {
		return new Promise((resolve) => {
			const testPort = 21000 + Math.floor(Math.random() * 1000);
			const server = net.createServer();
      
			const timeout = setTimeout(() => {
				server.close();
				resolve(false);
			}, this.config.testTimeout);

			server.once('listening', () => {
				clearTimeout(timeout);
				server.close();
				resolve(true);
			});

			server.once('error', () => {
				clearTimeout(timeout);
				resolve(false);
			});

			try {
				server.listen(testPort);
			} catch {
				clearTimeout(timeout);
				resolve(false);
			}
		});
	}

	private isPrivateIP(ip: string): boolean {
		const parts = ip.split('.').map(Number);
    
		// 10.0.0.0/8
		if (parts[0] === 10) {return true;}
    
		// 172.16.0.0/12
		if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {return true;}
    
		// 192.168.0.0/16
		if (parts[0] === 192 && parts[1] === 168) {return true;}
    
		// 169.254.0.0/16 (Link-local)
		if (parts[0] === 169 && parts[1] === 254) {return true;}
    
		return false;
	}

	private selectModeFromProfile(profile: NetworkProfile): FtpTransferMode {
		// 如果信心度很低，使用被动模式作为安全默认值
		if (profile.confidence < 0.5) {
			return 'passive';
		}

		return profile.preferredMode;
	}

	private isProfileCacheValid(): boolean {
		return !!(
			this.networkProfileCache &&
      this.lastDetectionTime &&
      (Date.now() - this.lastDetectionTime) < this.cacheValidDuration
		);
	}
}