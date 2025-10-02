/**
 * TCP传输配置管理器
 * 支持兼容性优先的三级配置模式和智能能力协商
 */

import * as vscode from 'vscode';
import { Logger } from '../../shared/utils/Logger';

const logger = new Logger('TcpConfigurationManager');

/**
 * 配置级别枚举
 */
export enum ConfigLevel {
    MINIMAL = 'MINIMAL',           // 基础配置 - 100%兼容
    STANDARD = 'STANDARD',         // 标准配置 - 85%兼容  
    HIGH_PERFORMANCE = 'HIGH_PERFORMANCE' // 高性能配置 - 40%兼容
}

/**
 * 设备类型枚举
 */
export enum DeviceType {
    EMBEDDED = 'embedded',         // 嵌入式设备(MCU, UART)
    INDUSTRIAL = 'industrial',     // 工控设备(树莓派, 工控机)
    SERVER = 'server'              // 高性能服务器
}

/**
 * 服务端能力接口
 */
interface ServerCapabilities {
    // 基础能力
    supportsProtobuf: boolean;
    supportsTcp: boolean;
    supportsUart: boolean;
    
    // 压缩能力
    supportsCompression: boolean;
    supportedCompressionAlgorithms: string[];
    
    // 并发能力
    maxConcurrentConnections: number;
    supportsConcurrentTransfer: boolean;
    
    // 高级功能
    supportsResumeTransfer: boolean;
    supportsAdvancedMonitoring: boolean;
    supportsPreferredCache: boolean;
    
    // 资源限制
    maxMemoryUsage: number;        // 最大内存使用(KB)
    maxCpuUsage: number;          // 最大CPU使用百分比
    
    // 协议版本
    protocolVersion: string;
}

/**
 * TCP传输配置接口
 */
export interface TcpTransferConfig {
    // 配置级别
    level: ConfigLevel;
    deviceType: DeviceType;
    
    // 连接配置
    connection: {
        maxConnections: number;
        connectionPool: boolean;
        keepAliveTimeout: number;
        tcpOptimization: boolean;
    };
    
    // 传输配置
    transfer: {
        compression: boolean;
        compressionAlgorithm: string;
        concurrency: number;
        chunkSize: number;
        maxChunkSize: number;
    };
    
    // 高级功能
    advanced: {
        predictiveCache: boolean;
        resumeTransfer: boolean;
        advancedMonitoring: boolean;
        intelligentPreload: boolean;
    };
    
    // 兼容性设置
    compatibility: {
        protocolVersion: string;
        fallbackToMinimal: boolean;
        autoNegotiation: boolean;
    };
    
    // 性能期望
    performance: {
        expectedSpeedup: string;        // 预期性能提升
        memoryUsage: string;           // 内存使用预期
        cpuUsage: string;              // CPU使用预期
    };
}

/**
 * TCP配置管理器
 */
export class TcpConfigurationManager {
	private static instance: TcpConfigurationManager;
	private currentConfig?: TcpTransferConfig;
	private serverCapabilities?: ServerCapabilities;
	private configChangeDisposable?: vscode.Disposable;
	private readonly configChangeEmitter = new vscode.EventEmitter<TcpTransferConfig>();
    
	// 预定义配置模板
	private readonly CONFIG_TEMPLATES: Record<ConfigLevel, TcpTransferConfig> = {
		[ConfigLevel.MINIMAL]: {
			level: ConfigLevel.MINIMAL,
			deviceType: DeviceType.EMBEDDED,
			connection: {
				maxConnections: 1,
				connectionPool: false,
				keepAliveTimeout: 30000,
				tcpOptimization: false
			},
			transfer: {
				compression: false,
				compressionAlgorithm: 'none',
				concurrency: 1,
				chunkSize: 32 * 1024,    // 32KB
				maxChunkSize: 64 * 1024  // 64KB
			},
			advanced: {
				predictiveCache: false,
				resumeTransfer: false,
				advancedMonitoring: false,
				intelligentPreload: false
			},
			compatibility: {
				protocolVersion: '1.0',
				fallbackToMinimal: true,
				autoNegotiation: true
			},
			performance: {
				expectedSpeedup: '1x基准',
				memoryUsage: '<512KB',
				cpuUsage: '单核充足'
			}
		},
        
		[ConfigLevel.STANDARD]: {
			level: ConfigLevel.STANDARD,
			deviceType: DeviceType.INDUSTRIAL,
			connection: {
				maxConnections: 2,
				connectionPool: true,
				keepAliveTimeout: 60000,
				tcpOptimization: true
			},
			transfer: {
				compression: true,
				compressionAlgorithm: 'gzip',
				concurrency: 2,
				chunkSize: 128 * 1024,   // 128KB
				maxChunkSize: 512 * 1024 // 512KB
			},
			advanced: {
				predictiveCache: true,
				resumeTransfer: true,
				advancedMonitoring: false,
				intelligentPreload: false
			},
			compatibility: {
				protocolVersion: '1.1',
				fallbackToMinimal: true,
				autoNegotiation: true
			},
			performance: {
				expectedSpeedup: '2-3x提升',
				memoryUsage: '2-8MB',
				cpuUsage: '双核推荐'
			}
		},
        
		[ConfigLevel.HIGH_PERFORMANCE]: {
			level: ConfigLevel.HIGH_PERFORMANCE,
			deviceType: DeviceType.SERVER,
			connection: {
				maxConnections: 8,
				connectionPool: true,
				keepAliveTimeout: 300000,
				tcpOptimization: true
			},
			transfer: {
				compression: true,
				compressionAlgorithm: 'auto',
				concurrency: 8,
				chunkSize: 512 * 1024,   // 512KB
				maxChunkSize: 2 * 1024 * 1024 // 2MB
			},
			advanced: {
				predictiveCache: true,
				resumeTransfer: true,
				advancedMonitoring: true,
				intelligentPreload: true
			},
			compatibility: {
				protocolVersion: '2.0',
				fallbackToMinimal: true,
				autoNegotiation: true
			},
			performance: {
				expectedSpeedup: '3-5x提升',
				memoryUsage: '>32MB',
				cpuUsage: '多核优化'
			}
		}
	};
    
	private constructor() {
		// 私有构造函数，实现单例模式
	}
    
	/**
     * 获取单例实例
     */
	public static getInstance(): TcpConfigurationManager {
		if (!TcpConfigurationManager.instance) {
			TcpConfigurationManager.instance = new TcpConfigurationManager();
		}
		return TcpConfigurationManager.instance;
	}
    
	/**
     * 初始化配置管理器
     */
	public async initialize(): Promise<void> {
		// 监听配置变化
		this.configChangeDisposable = vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('fileManager.tcp')) {
				logger.info('TCP传输配置已更改，重新加载...');
				this.loadConfigFromVSCode();
				this.notifyConfigChange();
			}
		});
        
		// 初始加载配置
		await this.loadConfigFromVSCode();
        
		logger.info('TCP配置管理器已初始化', {
			level: this.currentConfig?.level,
			deviceType: this.currentConfig?.deviceType
		});
	}
    
	/**
     * 销毁配置管理器
     */
	public dispose(): void {
		this.configChangeDisposable?.dispose();
		this.configChangeEmitter.dispose();
	}
    
	/**
     * 从VSCode设置加载配置
     */
	private async loadConfigFromVSCode(): Promise<void> {
		const config = vscode.workspace.getConfiguration('fileManager.tcp');
        
		// 获取用户配置的级别，默认为自动选择
		const userLevel = config.get<string>('configLevel', 'auto');
		const userDeviceType = config.get<string>('deviceType', 'auto');
		const enableAutoNegotiation = config.get<boolean>('autoNegotiation', true);
        
		if (userLevel === 'auto' && enableAutoNegotiation) {
			// 自动协商模式：检测服务端能力并选择最优配置
			logger.info('启用自动协商模式，检测服务端能力...');
			await this.negotiateOptimalConfig();
		} else if (userLevel !== 'auto') {
			// 手动指定配置级别
			const level = userLevel as ConfigLevel;
			this.currentConfig = this.createConfigFromTemplate(level);
			this.applyUserOverrides(this.currentConfig);
			logger.info(`使用手动指定配置级别: ${level}`);
		} else {
			// 默认使用MINIMAL配置
			this.currentConfig = this.createConfigFromTemplate(ConfigLevel.MINIMAL);
			logger.info('使用默认MINIMAL配置');
		}
	}
    
	/**
     * 协商最优配置
     */
	public async negotiateOptimalConfig(): Promise<void> {
		try {
			// 检测服务端能力
			this.serverCapabilities = await this.detectServerCapabilities();
            
			// 根据能力选择最优配置
			const optimalLevel = this.determineOptimalConfigLevel(this.serverCapabilities);
            
			// 创建配置
			this.currentConfig = this.createConfigFromTemplate(optimalLevel);
            
			// 根据服务端能力调整配置
			this.adaptConfigToServerCapabilities(this.currentConfig, this.serverCapabilities);
            
			// 应用用户覆盖
			this.applyUserOverrides(this.currentConfig);
            
			logger.info('配置协商完成', {
				serverCapabilities: this.serverCapabilities,
				selectedLevel: optimalLevel,
				finalConfig: this.currentConfig
			});
            
		} catch (error) {
			logger.warn('配置协商失败，降级到MINIMAL配置', error);
			await this.gracefulDowngrade(ConfigLevel.MINIMAL);
		}
	}
    
	/**
     * 检测服务端能力
     */
	private async detectServerCapabilities(): Promise<ServerCapabilities> {
		// TODO: 实现实际的服务端能力检测逻辑
		// 这里返回默认的最小能力集合
		logger.debug('检测服务端能力...');
        
		// 模拟能力检测，实际实现需要发送探测请求
		return {
			supportsProtobuf: true,
			supportsTcp: true,
			supportsUart: false,
			supportsCompression: false,  // 默认不支持，避免兼容性问题
			supportedCompressionAlgorithms: [],
			maxConcurrentConnections: 1,
			supportsConcurrentTransfer: false,
			supportsResumeTransfer: false,
			supportsAdvancedMonitoring: false,
			supportsPreferredCache: false,
			maxMemoryUsage: 512,  // 512KB
			maxCpuUsage: 50,      // 50%
			protocolVersion: '1.0'
		};
	}
    
	/**
     * 根据服务端能力确定最优配置级别
     */
	private determineOptimalConfigLevel(capabilities: ServerCapabilities): ConfigLevel {
		// 高性能配置的要求
		if (capabilities.maxMemoryUsage >= 32 * 1024 &&  // >=32MB
            capabilities.maxConcurrentConnections >= 4 &&
            capabilities.supportsCompression &&
            capabilities.supportsResumeTransfer &&
            capabilities.supportsAdvancedMonitoring) {
			return ConfigLevel.HIGH_PERFORMANCE;
		}
        
		// 标准配置的要求  
		if (capabilities.maxMemoryUsage >= 2 * 1024 &&   // >=2MB
            capabilities.maxConcurrentConnections >= 2 &&
            (capabilities.supportsCompression || capabilities.supportsResumeTransfer)) {
			return ConfigLevel.STANDARD;
		}
        
		// 默认使用最小配置
		return ConfigLevel.MINIMAL;
	}
    
	/**
     * 根据服务端能力调整配置
     */
	private adaptConfigToServerCapabilities(config: TcpTransferConfig, capabilities: ServerCapabilities): void {
		// 调整连接数
		config.connection.maxConnections = Math.min(
			config.connection.maxConnections,
			capabilities.maxConcurrentConnections
		);
        
		// 调整并发数
		config.transfer.concurrency = Math.min(
			config.transfer.concurrency,
			capabilities.maxConcurrentConnections
		);
        
		// 调整压缩设置
		if (!capabilities.supportsCompression) {
			config.transfer.compression = false;
			config.transfer.compressionAlgorithm = 'none';
		} else if (capabilities.supportedCompressionAlgorithms.length > 0) {
			// 选择支持的压缩算法
			const supportedAlgs = capabilities.supportedCompressionAlgorithms;
			if (supportedAlgs.includes('brotli')) {
				config.transfer.compressionAlgorithm = 'brotli';
			} else if (supportedAlgs.includes('gzip')) {
				config.transfer.compressionAlgorithm = 'gzip';
			} else {
				config.transfer.compressionAlgorithm = supportedAlgs[0];
			}
		}
        
		// 调整高级功能
		config.advanced.resumeTransfer = config.advanced.resumeTransfer && capabilities.supportsResumeTransfer;
		config.advanced.advancedMonitoring = config.advanced.advancedMonitoring && capabilities.supportsAdvancedMonitoring;
		config.advanced.predictiveCache = config.advanced.predictiveCache && capabilities.supportsPreferredCache;
	}
    
	/**
     * 优雅降级
     */
	public async gracefulDowngrade(targetLevel: ConfigLevel): Promise<void> {
		logger.warn(`执行优雅降级到 ${targetLevel}`);
        
		this.currentConfig = this.createConfigFromTemplate(targetLevel);
		this.applyUserOverrides(this.currentConfig);
        
		// 通知配置变更
		this.notifyConfigChange();
        
		logger.info(`已降级到 ${targetLevel} 配置`);
	}
    
	/**
     * 从模板创建配置
     */
	private createConfigFromTemplate(level: ConfigLevel): TcpTransferConfig {
		return JSON.parse(JSON.stringify(this.CONFIG_TEMPLATES[level]));
	}
    
	/**
     * 应用用户覆盖设置
     */
	private applyUserOverrides(config: TcpTransferConfig): void {
		const vscodeConfig = vscode.workspace.getConfiguration('fileManager.tcp');
        
		// 允许用户覆盖的关键配置项
		const userOverrides = {
			compression: vscodeConfig.get<boolean>('forceCompression'),
			maxConnections: vscodeConfig.get<number>('maxConnections'),
			concurrency: vscodeConfig.get<number>('maxConcurrency'),
			chunkSize: vscodeConfig.get<number>('chunkSize'),
			enableCache: vscodeConfig.get<boolean>('enableCache'),
			enableResume: vscodeConfig.get<boolean>('enableResume')
		};
        
		// 🚫 P0修复：忽略不安全的压缩覆盖，直到服务端支持
		if (userOverrides.compression !== undefined) {
			if (userOverrides.compression === true) {
				// 强制禁用压缩覆盖，记录警告
				logger.warn('⚠️ 检测到用户尝试强制启用压缩，但当前版本禁用压缩以确保协议兼容性');
				config.transfer.compression = false;
				config.transfer.compressionAlgorithm = 'none';
			} else {
				// 允许用户显式禁用压缩
				config.transfer.compression = userOverrides.compression;
			}
		}
		if (userOverrides.maxConnections !== undefined) {
			config.connection.maxConnections = Math.max(1, userOverrides.maxConnections);
		}
		if (userOverrides.concurrency !== undefined) {
			config.transfer.concurrency = Math.max(1, userOverrides.concurrency);
		}
		if (userOverrides.chunkSize !== undefined) {
			config.transfer.chunkSize = Math.max(16 * 1024, userOverrides.chunkSize * 1024);
		}
		if (userOverrides.enableCache !== undefined) {
			config.advanced.predictiveCache = userOverrides.enableCache;
		}
		if (userOverrides.enableResume !== undefined) {
			config.advanced.resumeTransfer = userOverrides.enableResume;
		}
        
		logger.debug('已应用用户覆盖配置', userOverrides);
	}
    
	/**
     * 获取当前配置
     */
	public getCurrentConfig(): TcpTransferConfig {
		if (!this.currentConfig) {
			this.currentConfig = this.createConfigFromTemplate(ConfigLevel.MINIMAL);
		}
		return this.currentConfig;
	}
    
	/**
     * 获取服务端能力信息
     */
	public getServerCapabilities(): ServerCapabilities | undefined {
		return this.serverCapabilities;
	}
    
	/**
     * 更新配置级别
     */
	public async updateConfigLevel(level: ConfigLevel): Promise<void> {
		try {
			const config = vscode.workspace.getConfiguration('fileManager.tcp');
			await config.update('configLevel', level, vscode.ConfigurationTarget.Global);
            
			this.currentConfig = this.createConfigFromTemplate(level);
			this.applyUserOverrides(this.currentConfig);
            
			this.notifyConfigChange();
            
			logger.info(`配置级别已更新为: ${level}`);
		} catch (error) {
			logger.error(`更新配置级别失败: ${level}`, error);
			throw error;
		}
	}
    
	/**
     * 验证配置有效性
     */
	public validateConfig(): { valid: boolean; errors: string[]; warnings: string[] } {
		const config = this.getCurrentConfig();
		const errors: string[] = [];
		const warnings: string[] = [];
        
		// 验证连接配置
		if (config.connection.maxConnections < 1) {
			errors.push('最大连接数不能小于1');
		}
		if (config.connection.maxConnections > 32) {
			warnings.push('连接数过多可能导致资源争抢');
		}
        
		// 验证传输配置
		if (config.transfer.concurrency < 1) {
			errors.push('并发数不能小于1');
		}
		if (config.transfer.concurrency > config.connection.maxConnections * 4) {
			warnings.push('并发数过高，可能超出连接池容量');
		}
        
		if (config.transfer.chunkSize < 16 * 1024) {
			errors.push('分片大小不能小于16KB');
		}
		if (config.transfer.chunkSize > config.transfer.maxChunkSize) {
			errors.push('分片大小不能超过最大分片大小');
		}
        
		// 验证设备兼容性
		if (config.level === ConfigLevel.HIGH_PERFORMANCE && config.deviceType === DeviceType.EMBEDDED) {
			warnings.push('嵌入式设备使用高性能配置可能导致资源不足');
		}
        
		return {
			valid: errors.length === 0,
			errors,
			warnings
		};
	}
    
	/**
     * 获取配置推荐
     */
	public getRecommendations(): {
        currentLevel: ConfigLevel;
        recommendedLevel: ConfigLevel;
        reasons: string[];
        potentialIssues: string[];
        } {
		const config = this.getCurrentConfig();
		const capabilities = this.serverCapabilities;
        
		let recommendedLevel = config.level;
		const reasons: string[] = [];
		const potentialIssues: string[] = [];
        
		if (capabilities) {
			const optimalLevel = this.determineOptimalConfigLevel(capabilities);
			if (optimalLevel !== config.level) {
				recommendedLevel = optimalLevel;
				reasons.push(`基于服务端能力，建议使用 ${optimalLevel} 配置`);
			}
		}
        
		// 检查潜在问题
		if (config.transfer.compression && (!capabilities?.supportsCompression)) {
			potentialIssues.push('启用了压缩但服务端不支持');
		}
        
		if (config.transfer.concurrency > 1 && (!capabilities?.supportsConcurrentTransfer)) {
			potentialIssues.push('启用了并发但服务端不支持');
		}
        
		return {
			currentLevel: config.level,
			recommendedLevel,
			reasons,
			potentialIssues
		};
	}
    
	/**
     * 配置变更事件
     */
	public readonly onConfigChange = this.configChangeEmitter.event;
    
	/**
     * 通知配置变更
     */
	private notifyConfigChange(): void {
		if (this.currentConfig) {
			this.configChangeEmitter.fire(this.currentConfig);
		}
	}
    
	/**
     * 获取配置摘要信息
     */
	public getConfigSummary(): {
        level: ConfigLevel;
        deviceType: DeviceType;
        features: string[];
        limitations: string[];
        performance: string;
        compatibility: string;
        } {
		const config = this.getCurrentConfig();
        
		const features: string[] = [];
		const limitations: string[] = [];
        
		// 分析启用的功能
		if (config.transfer.compression) {features.push(`压缩(${config.transfer.compressionAlgorithm})`);}
		if (config.connection.connectionPool) {features.push('连接池');}
		if (config.advanced.predictiveCache) {features.push('智能缓存');}
		if (config.advanced.resumeTransfer) {features.push('断点续传');}
		if (config.advanced.advancedMonitoring) {features.push('高级监控');}
        
		// 分析限制
		if (!config.transfer.compression) {limitations.push('无压缩');}
		if (config.connection.maxConnections === 1) {limitations.push('单连接');}
		if (config.transfer.concurrency === 1) {limitations.push('单线程');}
		if (!config.advanced.predictiveCache) {limitations.push('无智能缓存');}
        
		return {
			level: config.level,
			deviceType: config.deviceType,
			features: features.length > 0 ? features : ['基础传输'],
			limitations: limitations.length > 0 ? limitations : ['无主要限制'],
			performance: config.performance.expectedSpeedup,
			compatibility: `${config.level === ConfigLevel.MINIMAL ? '100%' : 
				config.level === ConfigLevel.STANDARD ? '85%' : '40%'}兼容`
		};
	}
}
