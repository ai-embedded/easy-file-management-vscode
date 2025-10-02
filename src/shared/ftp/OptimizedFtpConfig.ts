import { FtpServerCapabilities } from '../../extension/ftp/capabilities/FtpCapabilityDetector';

/**
 * 优化的 FTP 配置接口
 * 支持三层优化架构和兼容性管理
 */
export interface OptimizedFtpConfig {
  // 服务器连接配置
  server: {
    host: string;
    port: number;
    username: string;
    password: string;
    secure?: boolean;
    
    // 服务器能力配置（可自动检测或手动设置）
    capabilities?: FtpServerCapabilities | 'auto-detect';
    
    // 兼容性设置
    compatibility: {
      strictStandardMode: boolean;  // 严格标准模式
      assumeBasicFtpOnly: boolean;  // 假设只支持基础FTP
      skipCapabilityDetection: boolean; // 跳过能力检测
    };
  };
  
  // 优化策略配置
  optimization: {
    // 第一层：通用优化（总是启用）
    standard: {
      connectionReuse: boolean;     // 连接复用
      streamProcessing: boolean;    // 流式处理
      localCache: boolean;          // 本地缓存
      clientCompression: boolean;   // 客户端压缩
      intelligentRetry: boolean;    // 智能重试
      transferModeOptimization: boolean; // 传输模式优化
    };
    
    // 第二层：扩展功能（条件启用）
    extended: {
      resumableTransfer: boolean | 'auto';  // 断点续传
      compressionTransfer: boolean | 'auto'; // 压缩传输
      multiConnection: boolean | 'auto';     // 多连接
      enhancedListing: boolean | 'auto';     // 增强目录列表
    };
    
    // 第三层：高级功能（手动启用）
    advanced: {
      hybridProtocol: boolean;      // 混合协议
      customExtensions: string[];   // 自定义扩展
    };
  };
  
  // 性能参数
  performance: {
    maxConnections: number;        // 最大连接数
    transferTimeout: number;       // 传输超时
    bufferSize: number;           // 缓冲区大小
    chunkSize: number;           // 分块大小
    maxMemoryUsage: number;      // 最大内存使用
    
    // 自适应参数
    adaptive: {
      enabled: boolean;
      adjustBasedOnSpeed: boolean;
      adjustBasedOnLatency: boolean;
      learningMode: boolean;        // 学习模式
    };
  };

  // 监控和日志
  monitoring: {
    enablePerformanceMonitoring: boolean;
    enableDetailedLogging: boolean;
    enableStatisticsCollection: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };

  // 安全设置
  security: {
    enableSecureConnection: boolean;
    validateServerCertificate: boolean;
    allowInsecureConnections: boolean;
    connectionTimeout: number;
    maxSingleFileSize: number; // 单文件最大大小限制（字节），0表示无限制
  };
}

/**
 * 预设配置类型
 */
export type FtpConfigPreset = 'conservative' | 'balanced' | 'aggressive' | 'custom';

/**
 * 配置验证结果
 */
export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  recommendations: string[];
}

/**
 * FTP 配置生成器
 * 为不同类型的服务器和使用场景生成推荐配置
 */
export class FtpConfigGenerator {
	/**
   * 为指定服务器类型生成配置
   */
	static generateConfigFor(
		serverType: 'standard' | 'advanced' | 'custom',
		preset: FtpConfigPreset = 'balanced'
	): OptimizedFtpConfig {
		const baseConfig = this.getBaseConfig();
    
		switch (serverType) {
			case 'standard':
				return this.generateStandardConfig(baseConfig, preset);
      
			case 'advanced':
				return this.generateAdvancedConfig(baseConfig, preset);
      
			case 'custom':
				return this.generateCustomConfig(baseConfig, preset);
      
			default:
				return this.generateStandardConfig(baseConfig, preset);
		}
	}

	/**
   * 基于服务器能力生成配置
   */
	static generateConfigFromCapabilities(
		capabilities: FtpServerCapabilities,
		preset: FtpConfigPreset = 'balanced'
	): OptimizedFtpConfig {
		const baseConfig = this.getBaseConfig();
    
		// 根据服务器能力调整配置
		const config = { ...baseConfig };
    
		// 设置服务器能力
		config.server.capabilities = capabilities;
		config.server.compatibility.skipCapabilityDetection = true;
    
		// 基于能力启用扩展功能
		config.optimization.extended.resumableTransfer = capabilities.supportsREST;
		config.optimization.extended.compressionTransfer = capabilities.supportsModeZ;
		config.optimization.extended.enhancedListing = capabilities.supportsMLSD;
		config.optimization.extended.multiConnection = capabilities.maxConnections > 1;
    
		// 性能参数调整
		config.performance.maxConnections = Math.min(capabilities.maxConnections || 1, 5);
		config.performance.bufferSize = capabilities.transferBufferSize || 64 * 1024;
    
		// 根据预设调整
		return this.applyPreset(config, preset);
	}

	/**
   * 为特定使用场景生成配置
   */
	static generateConfigForScenario(
		scenario: 'bulk-upload' | 'streaming' | 'backup' | 'sync' | 'development',
		serverCapabilities?: FtpServerCapabilities
	): OptimizedFtpConfig {
		const baseConfig = serverCapabilities 
			? this.generateConfigFromCapabilities(serverCapabilities, 'balanced')
			: this.generateConfigFor('standard', 'balanced');
    
		switch (scenario) {
			case 'bulk-upload':
				return this.optimizeForBulkUpload(baseConfig);
      
			case 'streaming':
				return this.optimizeForStreaming(baseConfig);
      
			case 'backup':
				return this.optimizeForBackup(baseConfig);
      
			case 'sync':
				return this.optimizeForSync(baseConfig);
      
			case 'development':
				return this.optimizeForDevelopment(baseConfig);
      
			default:
				return baseConfig;
		}
	}

	/**
   * 验证配置
   */
	static validateConfig(config: OptimizedFtpConfig): ConfigValidationResult {
		const result: ConfigValidationResult = {
			isValid: true,
			errors: [],
			warnings: [],
			recommendations: []
		};

		// 基础验证
		if (!config.server.host) {
			result.errors.push('服务器主机地址不能为空');
			result.isValid = false;
		}

		if (!config.server.username) {
			result.errors.push('用户名不能为空');
			result.isValid = false;
		}

		if (config.server.port < 1 || config.server.port > 65535) {
			result.errors.push('端口号必须在1-65535范围内');
			result.isValid = false;
		}

		// 性能参数验证
		if (config.performance.maxConnections < 1 || config.performance.maxConnections > 10) {
			result.warnings.push('建议最大连接数在1-10之间');
		}

		if (config.performance.bufferSize < 1024) {
			result.warnings.push('缓冲区大小过小，可能影响性能');
		}

		if (config.performance.maxMemoryUsage < 10 * 1024 * 1024) {
			result.warnings.push('内存限制过低，可能导致传输失败');
		}

		// 兼容性检查
		if (config.server.compatibility.assumeBasicFtpOnly && 
        (config.optimization.extended.resumableTransfer === true ||
         config.optimization.extended.compressionTransfer === true)) {
			result.warnings.push('基础FTP模式下不建议强制启用扩展功能');
		}

		// 推荐建议
		if (config.optimization.standard.connectionReuse && config.performance.maxConnections === 1) {
			result.recommendations.push('启用连接复用时建议增加最大连接数');
		}

		if (!config.monitoring.enablePerformanceMonitoring) {
			result.recommendations.push('建议启用性能监控以便优化');
		}

		return result;
	}

	/**
   * 合并配置
   */
	static mergeConfigs(base: OptimizedFtpConfig, override: Partial<OptimizedFtpConfig>): OptimizedFtpConfig {
		return {
			server: { ...base.server, ...override.server },
			optimization: {
				standard: { ...base.optimization.standard, ...override.optimization?.standard },
				extended: { ...base.optimization.extended, ...override.optimization?.extended },
				advanced: { ...base.optimization.advanced, ...override.optimization?.advanced }
			},
			performance: { ...base.performance, ...override.performance },
			monitoring: { ...base.monitoring, ...override.monitoring },
			security: { ...base.security, ...override.security }
		};
	}

	// 私有方法

	private static getBaseConfig(): OptimizedFtpConfig {
		return {
			server: {
				host: '',
				port: 21,
				username: '',
				password: '',
				secure: false,
				capabilities: 'auto-detect',
				compatibility: {
					strictStandardMode: false,
					assumeBasicFtpOnly: false,
					skipCapabilityDetection: false
				}
			},
			optimization: {
				standard: {
					connectionReuse: true,
					streamProcessing: true,
					localCache: true,
					clientCompression: false,
					intelligentRetry: true,
					transferModeOptimization: true
				},
				extended: {
					resumableTransfer: 'auto',
					compressionTransfer: 'auto',
					multiConnection: 'auto',
					enhancedListing: 'auto'
				},
				advanced: {
					hybridProtocol: false,
					customExtensions: []
				}
			},
			performance: {
				maxConnections: 3,
				transferTimeout: 60000,
				bufferSize: 64 * 1024,
				chunkSize: 1024 * 1024,
				maxMemoryUsage: 100 * 1024 * 1024,
				adaptive: {
					enabled: true,
					adjustBasedOnSpeed: true,
					adjustBasedOnLatency: true,
					learningMode: false
				}
			},
			monitoring: {
				enablePerformanceMonitoring: true,
				enableDetailedLogging: false,
				enableStatisticsCollection: true,
				logLevel: 'info'
			},
			security: {
				enableSecureConnection: false,
				validateServerCertificate: false,
				allowInsecureConnections: true,
				connectionTimeout: 30000,
				maxSingleFileSize: 100 * 1024 * 1024 // 默认100MB限制
			}
		};
	}

	private static generateStandardConfig(base: OptimizedFtpConfig, preset: FtpConfigPreset): OptimizedFtpConfig {
		const config = { ...base };
    
		config.server.compatibility.strictStandardMode = true;
		config.optimization.extended.resumableTransfer = 'auto';
		config.optimization.extended.compressionTransfer = false;
		config.optimization.extended.multiConnection = false;
    
		return this.applyPreset(config, preset);
	}

	private static generateAdvancedConfig(base: OptimizedFtpConfig, preset: FtpConfigPreset): OptimizedFtpConfig {
		const config = { ...base };
    
		config.optimization.extended.resumableTransfer = 'auto';
		config.optimization.extended.compressionTransfer = 'auto';
		config.optimization.extended.multiConnection = 'auto';
		config.optimization.extended.enhancedListing = 'auto';
		config.performance.maxConnections = 5;
    
		return this.applyPreset(config, preset);
	}

	private static generateCustomConfig(base: OptimizedFtpConfig, preset: FtpConfigPreset): OptimizedFtpConfig {
		const config = { ...base };
    
		config.optimization.advanced.hybridProtocol = false;
		config.performance.adaptive.enabled = true;
		config.performance.adaptive.learningMode = true;
    
		return this.applyPreset(config, preset);
	}

	private static applyPreset(config: OptimizedFtpConfig, preset: FtpConfigPreset): OptimizedFtpConfig {
		switch (preset) {
			case 'conservative':
				config.optimization.standard.connectionReuse = false;
				config.optimization.extended.resumableTransfer = false;
				config.optimization.extended.compressionTransfer = false;
				config.performance.maxConnections = 1;
				config.performance.bufferSize = 32 * 1024;
				break;
      
			case 'aggressive':
				config.optimization.extended.resumableTransfer = true;
				config.optimization.extended.compressionTransfer = 'auto';
				config.optimization.extended.multiConnection = 'auto';
				config.performance.maxConnections = 5;
				config.performance.bufferSize = 128 * 1024;
				config.performance.adaptive.enabled = true;
				break;
      
			case 'balanced':
			default:
				// 使用默认配置
				break;
		}
    
		return config;
	}

	private static optimizeForBulkUpload(config: OptimizedFtpConfig): OptimizedFtpConfig {
		config.optimization.extended.resumableTransfer = 'auto';
		config.optimization.extended.multiConnection = 'auto';
		config.performance.maxConnections = 5;
		config.performance.bufferSize = 128 * 1024;
		config.performance.chunkSize = 2 * 1024 * 1024;
		return config;
	}

	private static optimizeForStreaming(config: OptimizedFtpConfig): OptimizedFtpConfig {
		config.optimization.standard.streamProcessing = true;
		config.performance.bufferSize = 32 * 1024;
		config.performance.transferTimeout = 30000;
		return config;
	}

	private static optimizeForBackup(config: OptimizedFtpConfig): OptimizedFtpConfig {
		config.optimization.extended.resumableTransfer = 'auto';
		config.optimization.extended.compressionTransfer = 'auto';
		config.optimization.standard.intelligentRetry = true;
		config.performance.transferTimeout = 300000; // 5分钟
		return config;
	}

	private static optimizeForSync(config: OptimizedFtpConfig): OptimizedFtpConfig {
		config.optimization.standard.localCache = true;
		config.optimization.extended.enhancedListing = 'auto';
		config.performance.adaptive.enabled = true;
		return config;
	}

	private static optimizeForDevelopment(config: OptimizedFtpConfig): OptimizedFtpConfig {
		config.monitoring.enableDetailedLogging = true;
		config.monitoring.logLevel = 'debug';
		config.performance.transferTimeout = 120000;
		return config;
	}
}