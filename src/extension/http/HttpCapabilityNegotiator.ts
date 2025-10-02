/**
 * HTTP能力协商器
 * 实现自动检测服务器支持的协议和特性
 */

import axios, { AxiosInstance } from 'axios';
import { Logger } from '../../shared/utils/Logger';

const logger = new Logger('HttpCapabilityNegotiator');

/**
 * 服务器能力信息
 */
export interface ServerCapabilities {
  supportedFormats: string[];     // 支持的数据格式
  supportedFeatures: string[];    // 支持的功能特性
  recommendedFormat: string;      // 推荐的数据格式
  serverInfo?: {
    name?: string;
    version?: string;
  };
}

/**
 * 协商配置
 */
interface NegotiationConfig {
  timeout: number;                // 协商超时时间（毫秒）
  retryAttempts: number;         // 重试次数
  enableCaching: boolean;        // 是否启用结果缓存
  cacheExpireTime: number;       // 缓存过期时间（毫秒）
}

/**
 * HTTP能力协商器
 */
export class HttpCapabilityNegotiator {
	private capabilityCache = new Map<string, { capabilities: ServerCapabilities; expires: number }>();
	private config: NegotiationConfig;
  
	constructor(config?: Partial<NegotiationConfig>) {
		this.config = {
			timeout: config?.timeout || 5000,
			retryAttempts: config?.retryAttempts || 2,
			enableCaching: config?.enableCaching !== false,
			cacheExpireTime: config?.cacheExpireTime || 300000 // 5分钟
		};
	}
  
	/**
   * 🤝 HTTP协议协商：检测服务器支持的协议和特性
   * @param baseURL 服务器基础URL
   * @param axiosInstance 可选的axios实例
   */
	async negotiateCapabilities(
		baseURL: string, 
		axiosInstance?: AxiosInstance
	): Promise<ServerCapabilities> {
		// 检查缓存
		if (this.config.enableCaching) {
			const cached = this.getCachedCapabilities(baseURL);
			if (cached) {
				logger.debug(`使用缓存的服务器能力: ${baseURL}`);
				return cached;
			}
		}
    
		const instance = axiosInstance || axios.create({ timeout: this.config.timeout });
		let attempts = 0;
    
		while (attempts < this.config.retryAttempts) {
			try {
				logger.info(`开始协商服务器能力: ${baseURL}, 尝试 ${attempts + 1}/${this.config.retryAttempts}`);
        
				// 发送能力协商请求
				const response = await instance.options(`${baseURL}/api/capabilities`, {
					headers: {
						'Accept': 'application/json, application/x-protobuf',
						'X-Client-Capabilities': JSON.stringify([
							'json',              // JSON格式支持
							'protobuf',          // Protobuf格式支持
							'chunked-transfer',  // 分片传输
							'range-requests',    // Range请求
							'compression',       // 数据压缩
							'resume-upload',     // 断点续传
							'http2'              // HTTP/2协议
						]),
						'X-Client-Version': '2.0.0',
						'User-Agent': 'VSCode-FileManager-HTTP-Client'
					},
					validateStatus: (status) => status < 500 // 接受4xx状态码
				});
        
				// 解析服务器能力
				const capabilities = this.parseCapabilityResponse(response);
        
				// 缓存结果
				if (this.config.enableCaching) {
					this.cacheCapabilities(baseURL, capabilities);
				}
        
				logger.info('服务器能力协商成功', { 
					baseURL, 
					formats: capabilities.supportedFormats,
					features: capabilities.supportedFeatures,
					recommended: capabilities.recommendedFormat
				});
        
				return capabilities;
        
			} catch (error: any) {
				attempts++;
				logger.warn(`服务器能力协商失败 (尝试 ${attempts}/${this.config.retryAttempts}): ${error.message}`);
        
				if (attempts >= this.config.retryAttempts) {
					// 协商失败，返回保守配置
					const fallbackCapabilities = this.getFallbackCapabilities();
					logger.info(`使用回退能力配置: ${baseURL}`, fallbackCapabilities);
					return fallbackCapabilities;
				}
        
				// 重试延迟
				await this.delay(1000 * attempts);
			}
		}
    
		// 应该不会到达这里，但提供安全回退
		return this.getFallbackCapabilities();
	}
  
	/**
   * 解析服务器能力响应
   */
	private parseCapabilityResponse(response: any): ServerCapabilities {
		const headers = response.headers || {};
		const data = response.data || {};
    
		// 从响应头解析能力
		const serverCapabilities = this.parseCapabilityHeaders(headers);
    
		// 从响应体解析能力（如果有）
		if (data.capabilities) {
			serverCapabilities.supportedFormats = [...serverCapabilities.supportedFormats, ...(data.capabilities.formats || [])];
			serverCapabilities.supportedFeatures = [...serverCapabilities.supportedFeatures, ...(data.capabilities.features || [])];
		}
    
		// 去重
		serverCapabilities.supportedFormats = [...new Set(serverCapabilities.supportedFormats)];
		serverCapabilities.supportedFeatures = [...new Set(serverCapabilities.supportedFeatures)];
    
		// 选择推荐格式
		serverCapabilities.recommendedFormat = this.selectOptimalFormat(serverCapabilities);
    
		return serverCapabilities;
	}
  
	/**
   * 解析能力响应头
   */
	private parseCapabilityHeaders(headers: any): ServerCapabilities {
		const capabilities: ServerCapabilities = {
			supportedFormats: ['json'], // 默认支持JSON
			supportedFeatures: [],
			recommendedFormat: 'json'
		};
    
		// 解析Accept头
		const accept = headers['accept'] || headers['Accept'] || '';
		if (accept.includes('application/x-protobuf')) {
			capabilities.supportedFormats.push('protobuf');
		}
    
		// 解析Server头
		const server = headers['server'] || headers['Server'] || '';
		if (server) {
			capabilities.serverInfo = { name: server };
		}
    
		// 解析自定义能力头
		const serverCaps = headers['x-server-capabilities'] || headers['X-Server-Capabilities'] || '';
		if (serverCaps) {
			try {
				const caps = JSON.parse(serverCaps);
				if (Array.isArray(caps.formats)) {
					capabilities.supportedFormats.push(...caps.formats);
				}
				if (Array.isArray(caps.features)) {
					capabilities.supportedFeatures.push(...caps.features);
				}
			} catch (e) {
				logger.warn('解析服务器能力头失败', e);
			}
		}
    
		// 检查常见功能支持
		const acceptRanges = headers['accept-ranges'] || headers['Accept-Ranges'] || '';
		if (acceptRanges.includes('bytes')) {
			capabilities.supportedFeatures.push('range-requests');
		}
    
		const acceptEncoding = headers['accept-encoding'] || headers['Accept-Encoding'] || '';
		if (acceptEncoding.includes('gzip')) {
			capabilities.supportedFeatures.push('compression');
		}
    
		return capabilities;
	}
  
	/**
   * 选择最优格式
   */
	private selectOptimalFormat(capabilities: ServerCapabilities): string {
		const formats = capabilities.supportedFormats;
		const features = capabilities.supportedFeatures;
    
		// 优先级：protobuf > compressed-json > json
		if (formats.includes('protobuf')) {
			return 'protobuf';
		}
		if (features.includes('compression') && formats.includes('json')) {
			return 'json-compressed';
		}
		return 'json';
	}
  
	/**
   * 获取缓存的能力
   */
	private getCachedCapabilities(baseURL: string): ServerCapabilities | null {
		const cached = this.capabilityCache.get(baseURL);
		if (cached && Date.now() < cached.expires) {
			return cached.capabilities;
		}
		// 清理过期缓存
		this.capabilityCache.delete(baseURL);
		return null;
	}
  
	/**
   * 缓存服务器能力
   */
	private cacheCapabilities(baseURL: string, capabilities: ServerCapabilities): void {
		this.capabilityCache.set(baseURL, {
			capabilities,
			expires: Date.now() + this.config.cacheExpireTime
		});
	}
  
	/**
   * 获取回退能力配置
   */
	private getFallbackCapabilities(): ServerCapabilities {
		return {
			supportedFormats: ['json'],
			supportedFeatures: [],
			recommendedFormat: 'json',
			serverInfo: {
				name: 'unknown',
				version: 'unknown'
			}
		};
	}
  
	/**
   * 延迟函数
   */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
  
	/**
   * 清理过期缓存
   */
	clearExpiredCache(): void {
		const now = Date.now();
		for (const [key, value] of this.capabilityCache.entries()) {
			if (now >= value.expires) {
				this.capabilityCache.delete(key);
			}
		}
	}
  
	/**
   * 清理所有缓存
   */
	clearAllCache(): void {
		this.capabilityCache.clear();
	}
  
	/**
   * 获取缓存统计
   */
	getCacheStats(): { size: number; entries: string[] } {
		return {
			size: this.capabilityCache.size,
			entries: Array.from(this.capabilityCache.keys())
		};
	}
}
