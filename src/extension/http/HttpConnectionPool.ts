/**
 * 🚀 HTTP连接池管理器
 * 借鉴OptimizedTcpClient的连接池策略，实现HTTP连接复用和性能优化
 * 使用HTTP Agent和Keep-Alive实现连接池功能
 */

import * as http from 'http';
import * as https from 'https';
import axios, { AxiosInstance } from 'axios';
import { Logger } from '../../shared/utils/Logger';

/**
 * 连接池配置接口
 */
interface PoolConfig {
  maxSockets?: number;        // 每个目标最大连接数
  maxFreeSockets?: number;    // 最大空闲连接数
  timeout?: number;           // 连接超时
  keepAliveTimeout?: number;  // Keep-Alive超时
  freeSocketTimeout?: number; // 空闲连接超时
  enableHttp2?: boolean;      // 是否启用HTTP/2
}

/**
 * 连接池统计信息
 */
interface PoolStats {
  totalSockets: number;
  freeSockets: number;
  activeSockets: number;
  requestsTotal: number;
  connectionsCreated: number;
  connectionsReused: number;
}

/**
 * 连接池实例信息
 */
interface PooledInstance {
  instance: AxiosInstance;
  baseURL: string;
  lastUsed: number;
  requestCount: number;
  stats: PoolStats;
  agent: http.Agent | https.Agent;
}

/**
 * 🚀 HTTP连接池管理器
 */
export class HttpConnectionPool {
	private logger = new Logger('HttpConnectionPool');
	private pools: Map<string, PooledInstance> = new Map();
	private config: Required<PoolConfig>;
	private cleanupTimer?: NodeJS.Timeout;
	private readonly cleanupIntervalMs = 60000;
	private refCounts: Map<string, number> = new Map();
  
	// 全局统计
	private globalStats = {
		totalPools: 0,
		totalRequests: 0,
		totalConnections: 0,
		connectionsReused: 0,
		poolHitRate: 0
	};
  
	constructor(config: PoolConfig = {}) {
		// 设置默认配置（基于TCP连接池的经验值）
		this.config = {
			maxSockets: 8,              // 与TCP池保持一致
			maxFreeSockets: 4,          // 一半空闲连接
			timeout: 30000,             // 30秒超时
			keepAliveTimeout: 300000,   // 5分钟Keep-Alive（与TCP一致）
			freeSocketTimeout: 15000,   // 15秒空闲超时
			enableHttp2: false,         // 默认不启用HTTP/2
			...config
		};
    
		this.logger.info('🚀 HTTP连接池初始化完成');
		this.logger.info(`📊 配置: maxSockets=${this.config.maxSockets}, keepAlive=${this.config.keepAliveTimeout}ms, timeout=${this.config.timeout}ms`);
	}
  
	/**
   * 🎯 获取优化的Axios实例（从连接池或创建新实例）
   */
	async getOptimizedInstance(baseURL: string): Promise<AxiosInstance> {
		const poolKey = this.normalizeBaseURL(baseURL);
		let pooledInstance = this.pools.get(poolKey);
    
		if (!pooledInstance || this.isInstanceExpired(pooledInstance)) {
			// 创建新的连接池实例
			pooledInstance = await this.createOptimizedInstance(poolKey);
			this.pools.set(poolKey, pooledInstance);
			this.globalStats.totalPools++;
			this.globalStats.totalConnections++;
      
			this.logger.info(`🚀 创建新连接池: ${poolKey}, 总池数: ${this.pools.size}`);
		} else {
			// 复用现有实例
			this.globalStats.connectionsReused++;
			this.logger.debug(`♻️ 复用连接池: ${poolKey}, 请求数: ${pooledInstance.requestCount}`);
		}

		this.incrementRefCount(poolKey);
		this.ensureCleanupTimer();
  
		// 更新使用统计
		pooledInstance.lastUsed = Date.now();
		pooledInstance.requestCount++;
		this.globalStats.totalRequests++;
    
		// 更新命中率
		this.globalStats.poolHitRate = this.globalStats.totalRequests > 0 
			? (this.globalStats.connectionsReused / this.globalStats.totalRequests) * 100 
			: 0;
    
		return pooledInstance.instance;
	}

	releaseInstance(baseURL: string): void {
		const poolKey = this.normalizeBaseURL(baseURL);
		const remaining = this.decrementRefCount(poolKey);
		if (remaining > 0) {
			return;
		}

		const pooledInstance = this.pools.get(poolKey);
		if (!pooledInstance) {
			this.stopCleanupTimerIfIdle();
			return;
		}

		try {
			pooledInstance.agent.removeAllListeners?.();
			pooledInstance.agent.destroy();
		} catch (error) {
			this.logger.warn(`⚠️ 释放HTTP连接池失败: ${poolKey}`, error);
		}

		this.pools.delete(poolKey);
		this.globalStats.totalPools = this.pools.size;
		this.stopCleanupTimerIfIdle();
	}

	dispose(): void {
		for (const [key, pooledInstance] of this.pools.entries()) {
			try {
				pooledInstance.agent.removeAllListeners?.();
				pooledInstance.agent.destroy();
			} catch (error) {
				this.logger.warn(`⚠️ 销毁HTTP连接池失败: ${key}`, error);
			}
		}

		this.pools.clear();
		this.refCounts.clear();
		this.stopCleanupTimer();
		this.globalStats.totalPools = 0;
	}
  
	/**
   * 🚀 创建优化的Axios实例
   */
	private async createOptimizedInstance(baseURL: string): Promise<PooledInstance> {
		const isHttps = baseURL.startsWith('https:');
    
		// 🔧 创建优化的HTTP Agent（借鉴TCP优化策略）
		const agentOptions = {
			keepAlive: true,                          // 启用Keep-Alive（对应TCP的连接复用）
			keepAliveMsecs: this.config.keepAliveTimeout, // Keep-Alive超时
			maxSockets: this.config.maxSockets,      // 每个目标最大连接数
			maxFreeSockets: this.config.maxFreeSockets, // 最大空闲连接数
			timeout: this.config.timeout,            // 连接超时
			freeSocketTimeout: this.config.freeSocketTimeout, // 空闲连接超时
			scheduling: 'fifo' as const               // FIFO调度策略
		};
    
		const agent = isHttps 
			? new https.Agent(agentOptions)
			: new http.Agent(agentOptions);
    
		// 🚀 创建Axios实例（应用TCP连接池的理念）
		const instance = axios.create({
			baseURL,
			timeout: this.config.timeout,
			httpAgent: !isHttps ? agent : undefined,
			httpsAgent: isHttps ? agent : undefined,
      
			// 🔧 优化配置（基于TCP优化经验）
			maxRedirects: 5,
			maxContentLength: 100 * 1024 * 1024,    // 100MB最大内容
			maxBodyLength: 100 * 1024 * 1024,       // 100MB最大请求体
      
			// 🎯 连接复用相关配置
			validateStatus: (status) => status < 500, // 复用连接即使4xx错误
      
			// 📊 请求和响应拦截器（用于统计）
			...this.createInterceptors(baseURL)
		});
    
		// 🚀 HTTP/2支持（如果启用）
		if (this.config.enableHttp2 && isHttps) {
			try {
				// HTTP/2支持需要特殊配置
				this.logger.debug('🌐 尝试启用HTTP/2支持');
				// 这里可以添加HTTP/2特定配置
			} catch (error) {
				this.logger.warn('⚠️ HTTP/2启用失败，继续使用HTTP/1.1:', error);
			}
		}
    
		const pooledInstance: PooledInstance = {
			instance,
			baseURL,
			lastUsed: Date.now(),
			requestCount: 0,
			agent,
			stats: {
				totalSockets: 0,
				freeSockets: 0,
				activeSockets: 0,
				requestsTotal: 0,
				connectionsCreated: 0,
				connectionsReused: 0
			}
		};
    
		// 🔧 监听Agent事件（类似TCP连接池的统计）
		this.setupAgentEventListeners(agent, pooledInstance);
    
		this.logger.info(`✅ 优化HTTP实例创建成功: ${baseURL}`);
		this.logger.debug(`🔧 配置: Keep-Alive=${agentOptions.keepAlive}, MaxSockets=${agentOptions.maxSockets}, Timeout=${agentOptions.timeout}ms`);
    
		return pooledInstance;
	}
  
	/**
   * 🔧 设置Agent事件监听器（统计连接使用情况）
   */
	private setupAgentEventListeners(agent: http.Agent | https.Agent, pooledInstance: PooledInstance): void {
		// 监听连接创建
		agent.on('createConnection', () => {
			pooledInstance.stats.connectionsCreated++;
			pooledInstance.stats.totalSockets++;
			this.logger.debug(`📈 连接创建: ${pooledInstance.baseURL}, 总连接: ${pooledInstance.stats.totalSockets}`);
		});
    
		// 监听连接销毁（如果支持）
		if ('on' in agent && typeof agent.on === 'function') {
			agent.on('free', () => {
				pooledInstance.stats.freeSockets++;
				pooledInstance.stats.activeSockets = Math.max(0, pooledInstance.stats.activeSockets - 1);
			});
		}
	}
  
	/**
   * 📊 创建请求和响应拦截器
   */
	private createInterceptors(baseURL: string) {
		return {
			// 请求拦截器
			requestInterceptor: (config: any) => {
				const pooledInstance = this.pools.get(this.normalizeBaseURL(baseURL));
				if (pooledInstance) {
					pooledInstance.stats.requestsTotal++;
					pooledInstance.stats.activeSockets++;
				}
        
				// 🔧 优化请求头（基于HTTP连接复用最佳实践）
				config.headers = config.headers || {};
				config.headers['Connection'] = 'keep-alive';
				config.headers['Keep-Alive'] = `timeout=${Math.floor(this.config.keepAliveTimeout / 1000)}`;
        
				this.logger.debug(`📤 发送请求: ${config.method?.toUpperCase()} ${config.url}`);
				return config;
			},
      
			// 响应拦截器
			responseInterceptor: (response: any) => {
				const pooledInstance = this.pools.get(this.normalizeBaseURL(baseURL));
				if (pooledInstance) {
					pooledInstance.stats.activeSockets = Math.max(0, pooledInstance.stats.activeSockets - 1);
          
					// 检查连接是否被复用
					if (response.config?.socket?.reusedSocket) {
						pooledInstance.stats.connectionsReused++;
					}
				}
        
				this.logger.debug(`📥 响应完成: ${response.status} ${response.statusText}`);
				return response;
			}
		};
	}
  
	/**
   * 🔍 检查实例是否过期
   */
	private isInstanceExpired(pooledInstance: PooledInstance): boolean {
		const age = Date.now() - pooledInstance.lastUsed;
		return age > this.config.keepAliveTimeout;
	}
  
	/**
   * 🔧 规范化Base URL
   */
	private normalizeBaseURL(url: string): string {
		try {
			const urlObj = new URL(url);
			return `${urlObj.protocol}//${urlObj.host}`;
		} catch (error) {
			return url;
		}
	}
  
	/**
   * 🧹 确保清理定时器已启动
   */
	private ensureCleanupTimer(): void {
		if (this.cleanupTimer) {
			return;
		}
		this.cleanupTimer = setInterval(() => {
			this.cleanupExpiredInstances();
		}, this.cleanupIntervalMs);
	}

	private stopCleanupTimer(): void {
		if (!this.cleanupTimer) {
			return;
		}
		clearInterval(this.cleanupTimer);
		this.cleanupTimer = undefined;
	}

	private stopCleanupTimerIfIdle(): void {
		if (this.pools.size === 0) {
			this.stopCleanupTimer();
		}
	}
  
	/**
   * 🧹 清理过期的连接实例
   */
	private cleanupExpiredInstances(): void {
		const now = Date.now();
		let cleanedCount = 0;
    
		for (const [key, pooledInstance] of this.pools.entries()) {
			if (now - pooledInstance.lastUsed > this.config.keepAliveTimeout) {
				// 销毁Agent连接
				pooledInstance.agent.destroy();
				this.pools.delete(key);
				this.refCounts.delete(key);
				cleanedCount++;
      
				this.logger.debug(`🧹 清理过期连接池: ${key}`);
			}
		}
  
		if (cleanedCount > 0) {
			this.logger.info(`🧹 清理了 ${cleanedCount} 个过期连接池，当前池数: ${this.pools.size}`);
			this.globalStats.totalPools = this.pools.size;
		}

		this.stopCleanupTimerIfIdle();
	}
  
	/**
   * 📊 获取连接池统计信息
   */
	getStatistics(): {
    global: typeof this.globalStats;
    pools: Array<{
      baseURL: string;
      lastUsed: Date;
      requestCount: number;
      stats: PoolStats;
    }>;
    } {
		return {
			global: { ...this.globalStats },
			pools: Array.from(this.pools.entries()).map(([baseURL, pooledInstance]) => ({
				baseURL,
				lastUsed: new Date(pooledInstance.lastUsed),
				requestCount: pooledInstance.requestCount,
				stats: { ...pooledInstance.stats }
			}))
		};
	}
  
	/**
   * 🔧 更新连接池配置
   */
	updateConfig(newConfig: Partial<PoolConfig>): void {
		this.config = { ...this.config, ...newConfig };
		this.logger.info('🔧 连接池配置已更新', newConfig);
    
		// 对现有连接池应用新配置需要重新创建实例
		if (this.pools.size > 0) {
			this.logger.warn('⚠️ 配置更新后，新连接将使用新配置，现有连接保持不变');
		}
	}
  
	/**
   * 🛑 关闭所有连接池
   */
	async shutdown(): Promise<void> {
		this.logger.info(`🛑 开始关闭 ${this.pools.size} 个连接池`);
   
		for (const [key, pooledInstance] of this.pools.entries()) {
			try {
				pooledInstance.agent.destroy();
				this.logger.debug(`✅ 连接池已关闭: ${key}`);
			} catch (error) {
				this.logger.warn(`⚠️ 关闭连接池失败: ${key}`, error);
			}
		}
   
		this.pools.clear();
		this.refCounts.clear();
		this.stopCleanupTimer();
		this.globalStats.totalPools = 0;
   
		this.logger.info('✅ 所有连接池已关闭');
	}
  
	/**
   * 📈 获取连接池性能摘要
   */
	getPerformanceSummary(): string {
		const stats = this.getStatistics();
		return `📊 HTTP连接池性能摘要:
• 活跃连接池: ${stats.global.totalPools}
• 总请求数: ${stats.global.totalRequests}
• 连接复用率: ${stats.global.poolHitRate.toFixed(1)}%
• 总创建连接: ${stats.global.totalConnections}
• 复用连接数: ${stats.global.connectionsReused}`;
	}

	private incrementRefCount(poolKey: string): number {
		const current = this.refCounts.get(poolKey) ?? 0;
		const next = current + 1;
		this.refCounts.set(poolKey, next);
		return next;
	}

	private decrementRefCount(poolKey: string): number {
		const current = this.refCounts.get(poolKey) ?? 0;
		const next = current - 1;
		if (next <= 0) {
			this.refCounts.delete(poolKey);
			return 0;
		}
		this.refCounts.set(poolKey, next);
		return next;
	}
}
