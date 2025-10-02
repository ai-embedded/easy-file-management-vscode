/**
 * FTP 优化配置服务
 * 管理 FTP 优化配置的保存、加载和应用
 */

import type { 
	OptimizedFtpConfig, 
	FtpServerCapabilities, 
	ConfigValidationResult,
	FtpConfigPreset 
} from '../../shared/types/ftp';

export class FtpOptimizationService {
	private static instance: FtpOptimizationService;
	private currentConfig: OptimizedFtpConfig | null = null;
	private configStorageKey = 'ftp-optimization-config';
  
	static getInstance(): FtpOptimizationService {
		if (!this.instance) {
			this.instance = new FtpOptimizationService();
		}
		return this.instance;
	}

	/**
   * 获取默认配置
   */
	getDefaultConfig(): OptimizedFtpConfig {
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
				connectionTimeout: 30000
			}
		};
	}

	/**
   * 生成预设配置
   */
	generatePresetConfig(preset: FtpConfigPreset): OptimizedFtpConfig {
		const baseConfig = this.getDefaultConfig();
    
		switch (preset) {
			case 'conservative':
				return {
					...baseConfig,
					server: {
						...baseConfig.server,
						compatibility: {
							strictStandardMode: true,
							assumeBasicFtpOnly: true,
							skipCapabilityDetection: true
						}
					},
					optimization: {
						...baseConfig.optimization,
						standard: {
							...baseConfig.optimization.standard,
							connectionReuse: false,
							clientCompression: false
						},
						extended: {
							resumableTransfer: false,
							compressionTransfer: false,
							multiConnection: false,
							enhancedListing: false
						}
					},
					performance: {
						...baseConfig.performance,
						maxConnections: 1,
						bufferSize: 32 * 1024,
						adaptive: {
							...baseConfig.performance.adaptive,
							enabled: false
						}
					}
				};
      
			case 'aggressive':
				return {
					...baseConfig,
					optimization: {
						...baseConfig.optimization,
						extended: {
							resumableTransfer: 'auto',
							compressionTransfer: 'auto',
							multiConnection: 'auto',
							enhancedListing: 'auto'
						}
					},
					performance: {
						...baseConfig.performance,
						maxConnections: 5,
						bufferSize: 128 * 1024,
						adaptive: {
							...baseConfig.performance.adaptive,
							enabled: true,
							learningMode: true
						}
					}
				};
      
			case 'balanced':
			default:
				return baseConfig;
		}
	}

	/**
   * 根据服务器能力优化配置
   */
	optimizeConfigFromCapabilities(
		config: OptimizedFtpConfig, 
		capabilities: FtpServerCapabilities
	): OptimizedFtpConfig {
		const optimizedConfig = { ...config };
    
		// 根据服务器能力调整配置
		optimizedConfig.server.capabilities = capabilities;
		optimizedConfig.server.compatibility.skipCapabilityDetection = true;
    
		// 基于能力启用/禁用扩展功能
		optimizedConfig.optimization.extended.resumableTransfer = capabilities.supportsREST;
		optimizedConfig.optimization.extended.compressionTransfer = capabilities.supportsModeZ;
		optimizedConfig.optimization.extended.enhancedListing = capabilities.supportsMLSD;
		optimizedConfig.optimization.extended.multiConnection = capabilities.maxConnections > 1;
    
		// 性能参数调整
		optimizedConfig.performance.maxConnections = Math.min(capabilities.maxConnections || 1, 5);
		optimizedConfig.performance.bufferSize = capabilities.transferBufferSize || 64 * 1024;
    
		return optimizedConfig;
	}

	/**
   * 验证配置
   */
	validateConfig(config: OptimizedFtpConfig): ConfigValidationResult {
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

		if (!config.server.password) {
			result.errors.push('密码不能为空');
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
   * 保存配置到本地存储
   */
	async saveConfig(config: OptimizedFtpConfig): Promise<void> {
		try {
			// 验证配置
			const validation = this.validateConfig(config);
			if (!validation.isValid) {
				throw new Error(`配置验证失败: ${validation.errors.join(', ')}`);
			}

			// 保存到本地存储
			const configData = {
				config,
				savedAt: new Date().toISOString(),
				version: '1.0.0'
			};

			localStorage.setItem(this.configStorageKey, JSON.stringify(configData));
			this.currentConfig = config;

			// 通知后端保存配置
			await this.sendConfigToBackend(config);
      
			console.log('[FtpOptimizationService] 配置保存成功');
		} catch (error) {
			console.error('[FtpOptimizationService] 保存配置失败:', error);
			throw error;
		}
	}

	/**
   * 从本地存储加载配置
   */
	async loadConfig(): Promise<OptimizedFtpConfig> {
		try {
			const savedData = localStorage.getItem(this.configStorageKey);
      
			if (savedData) {
				const { config } = JSON.parse(savedData);
        
				// 验证加载的配置
				const validation = this.validateConfig(config);
				if (validation.isValid) {
					this.currentConfig = config;
					console.log('[FtpOptimizationService] 配置加载成功');
					return config;
				} else {
					console.warn('[FtpOptimizationService] 已保存的配置无效，使用默认配置');
				}
			}
		} catch (error) {
			console.error('[FtpOptimizationService] 加载配置失败:', error);
		}

		// 返回默认配置
		const defaultConfig = this.getDefaultConfig();
		this.currentConfig = defaultConfig;
		return defaultConfig;
	}

	/**
   * 获取当前配置
   */
	getCurrentConfig(): OptimizedFtpConfig | null {
		return this.currentConfig;
	}

	/**
   * 测试 FTP 连接
   */
	async testConnection(config: OptimizedFtpConfig): Promise<boolean> {
		try {
			// 发送测试连接请求到后端
			const response = await this.sendToBackend('ftp.testOptimizedConnection', {
				config: this.sanitizeConfigForTransfer(config)
			});
      
			return response.success;
		} catch (error) {
			console.error('[FtpOptimizationService] 连接测试失败:', error);
			return false;
		}
	}

	/**
   * 检测服务器能力
   */
	async detectServerCapabilities(config: OptimizedFtpConfig): Promise<FtpServerCapabilities> {
		try {
			const response = await this.sendToBackend('ftp.detectServerCapabilities', {
				config: this.sanitizeConfigForTransfer(config)
			});
      
			if (response.success) {
				return response.data as FtpServerCapabilities;
			} else {
				throw new Error(response.error || '服务器能力检测失败');
			}
		} catch (error) {
			console.error('[FtpOptimizationService] 服务器能力检测失败:', error);
			throw error;
		}
	}

	/**
   * 获取优化统计信息
   */
	async getOptimizationStats(): Promise<any> {
		try {
			const response = await this.sendToBackend('ftp.getOptimizationStats', {});
			return response.success ? response.data : null;
		} catch (error) {
			console.error('[FtpOptimizationService] 获取优化统计失败:', error);
			return null;
		}
	}

	/**
   * 重置配置为默认值
   */
	resetToDefault(): OptimizedFtpConfig {
		const defaultConfig = this.getDefaultConfig();
		this.currentConfig = defaultConfig;
    
		// 清除本地存储
		localStorage.removeItem(this.configStorageKey);
    
		return defaultConfig;
	}

	// 私有方法
  
	private async sendToBackend(command: string, data: any): Promise<any> {
		return new Promise((resolve, reject) => {
			const requestId = `${command}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
			// 设置响应监听器
			const handleMessage = (event: MessageEvent) => {
				const message = event.data;
				if (message.id === requestId) {
					window.removeEventListener('message', handleMessage);
					if (message.success) {
						resolve(message);
					} else {
						reject(new Error(message.error || '请求失败'));
					}
				}
			};
      
			window.addEventListener('message', handleMessage);
      
			// 发送请求到后端
			if (typeof acquireVsCodeApi !== 'undefined') {
				const vscode = acquireVsCodeApi();
				vscode.postMessage({
					id: requestId,
					command,
					data
				});
			} else {
				// 开发环境或测试环境
				setTimeout(() => {
					resolve({ success: true, data: null });
				}, 1000);
			}
      
			// 设置超时
			setTimeout(() => {
				window.removeEventListener('message', handleMessage);
				reject(new Error('请求超时'));
			}, 30000);
		});
	}

	private async sendConfigToBackend(config: OptimizedFtpConfig): Promise<void> {
		await this.sendToBackend('ftp.saveOptimizedConfig', {
			config: this.sanitizeConfigForTransfer(config)
		});
	}

	private sanitizeConfigForTransfer(config: OptimizedFtpConfig): any {
		// 创建配置副本，移除敏感信息用于日志记录
		const sanitized = { ...config };
    
		// 不要在日志中记录密码
		if (sanitized.server.password) {
			sanitized.server.password = '[PROTECTED]';
		}
    
		return sanitized;
	}
}

// 导出单例实例
export const ftpOptimizationService = FtpOptimizationService.getInstance();