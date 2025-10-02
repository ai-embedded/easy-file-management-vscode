import { Client as BasicFtp } from 'basic-ftp';
import { FtpConfig } from '../../../shared/types';

interface PooledConnection {
  client: BasicFtp;
  config: FtpConfig;
  lastUsed: number;
  inUse: boolean;
  id: string;
}

interface PoolStats {
  totalRequests: number;
  failedRequests: number;
  queueWaitTimes: number[];
  lastScalingCheck: number;
  currentMaxConnections: number;
}

interface QueuedRequest {
  resolve: (client: BasicFtp) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
  ftpConfig: FtpConfig;
}

interface ConnectionPoolConfig {
  maxConnections?: number;
  maxIdleTime?: number;
  connectionTimeout?: number;
  enableLogging?: boolean;
  // 自适应配置
  enableAdaptiveScaling?: boolean;
  minConnections?: number;
  maxQueueWaitTime?: number;
  targetErrorRate?: number;
  scalingCheckInterval?: number;
}

/**
 * FTP 连接池 - 管理和复用 FTP 连接以提高性能
 * 
 * 功能特性：
 * - 连接复用：避免重复建立连接的开销
 * - 自动清理：清理空闲时间过长的连接
 * - 连接限制：防止过多连接占用资源
 * - 健康检查：确保连接可用性
 */
export class FtpConnectionPool {
	private connections = new Map<string, PooledConnection[]>();
	private config: Required<ConnectionPoolConfig>;
	private cleanupTimer?: NodeJS.Timeout;
	private scalingTimer?: NodeJS.Timeout;
	private stats = new Map<string, PoolStats>();
	private requestQueue = new Map<string, QueuedRequest[]>();

	constructor(config: ConnectionPoolConfig = {}) {
		this.config = {
			maxConnections: config.maxConnections ?? 5,
			maxIdleTime: config.maxIdleTime ?? 300000, // 5 分钟
			connectionTimeout: config.connectionTimeout ?? 30000, // 30 秒
			enableLogging: config.enableLogging ?? true,
			enableAdaptiveScaling: config.enableAdaptiveScaling ?? false,
			minConnections: config.minConnections ?? 1,
			maxQueueWaitTime: config.maxQueueWaitTime ?? 5000, // 5秒
			targetErrorRate: config.targetErrorRate ?? 0.05, // 5%
			scalingCheckInterval: config.scalingCheckInterval ?? 60000 // 1分钟
		};

		// 启动定期清理
		this.startCleanupTimer();
    
		// 启动自适应缩放（如果启用）
		if (this.config.enableAdaptiveScaling) {
			this.startAdaptiveScaling();
		}
	}

	/**
   * 获取或创建连接（支持排队和过载保护）
   */
	async getConnection(ftpConfig: FtpConfig): Promise<BasicFtp> {
		const key = this.getConnectionKey(ftpConfig);
		const requestStartTime = Date.now();
    
		// 初始化统计信息
		if (!this.stats.has(key)) {
			this.stats.set(key, {
				totalRequests: 0,
				failedRequests: 0,
				queueWaitTimes: [],
				lastScalingCheck: Date.now(),
				currentMaxConnections: this.config.maxConnections
			});
		}
    
		const poolStats = this.stats.get(key)!;
		poolStats.totalRequests++;
    
		if (this.config.enableLogging) {
			console.log(`[FtpConnectionPool] 获取连接 - 键: ${key}`);
		}

		try {
			// 尝试从池中获取可用连接
			const availableConnection = await this.getAvailableConnection(key);
			if (availableConnection) {
				availableConnection.inUse = true;
				availableConnection.lastUsed = Date.now();
        
				if (this.config.enableLogging) {
					console.log(`[FtpConnectionPool] 复用现有连接: ${availableConnection.id}`);
				}
        
				return availableConnection.client;
			}

			// 检查是否可以创建新连接
			const pooledConnections = this.connections.get(key) || [];
			if (pooledConnections.length < poolStats.currentMaxConnections) {
				// 创建新连接
				return await this.createNewConnection(key, ftpConfig);
			}

			// 需要排队等待
			if (this.config.enableAdaptiveScaling) {
				const client = await this.enqueueRequest(key, ftpConfig, requestStartTime);
				return client;
			} else {
				// 传统方式：等待空闲连接或超时失败
				throw new Error(`FTP 连接池已达最大连接数限制: ${poolStats.currentMaxConnections}`);
			}
		} catch (error) {
			poolStats.failedRequests++;
			throw error;
		}
	}

	/**
   * 释放连接回池中（支持自动处理排队请求）
   */
	releaseConnection(client: BasicFtp): void {
		for (const [key, pooledConnections] of this.connections.entries()) {
			const connection = pooledConnections.find(conn => conn.client === client);
			if (connection) {
				connection.inUse = false;
				connection.lastUsed = Date.now();
        
				if (this.config.enableLogging) {
					console.log(`[FtpConnectionPool] 释放连接: ${connection.id}`);
				}
        
				// 处理排队的请求
				this.processQueuedRequests(key);
        
				return;
			}
		}
	}

	/**
   * 关闭所有连接并清空连接池
   */
	async closeAll(): Promise<void> {
		if (this.config.enableLogging) {
			console.log('[FtpConnectionPool] 关闭所有连接');
		}

		// 停止所有定时器
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}
    
		if (this.scalingTimer) {
			clearInterval(this.scalingTimer);
			this.scalingTimer = undefined;
		}

		// 拒绝所有排队的请求
		for (const [key, queue] of this.requestQueue.entries()) {
			for (const queuedRequest of queue) {
				queuedRequest.reject(new Error('连接池正在关闭'));
			}
		}
		this.requestQueue.clear();

		// 关闭所有连接
		for (const [key, pooledConnections] of this.connections.entries()) {
			for (const connection of pooledConnections) {
				try {
					connection.client.close();
				} catch (error) {
					console.warn(`[FtpConnectionPool] 关闭连接失败: ${error}`);
				}
			}
		}

		this.connections.clear();
		this.stats.clear();
	}

	/**
   * 获取连接池统计信息
   */
	getStats(): { [key: string]: { total: number; inUse: number; idle: number; queued?: number; errorRate?: number; avgQueueTime?: number; maxConnections?: number } } {
		const stats: { [key: string]: { total: number; inUse: number; idle: number; queued?: number; errorRate?: number; avgQueueTime?: number; maxConnections?: number } } = {};
    
		for (const [key, pooledConnections] of this.connections.entries()) {
			const total = pooledConnections.length;
			const inUse = pooledConnections.filter(conn => conn.inUse).length;
			const idle = total - inUse;
			const queued = this.requestQueue.get(key)?.length || 0;
      
			const poolStats = this.stats.get(key);
			const errorRate = poolStats ? (poolStats.failedRequests / Math.max(poolStats.totalRequests, 1)) : 0;
			const avgQueueTime = poolStats && poolStats.queueWaitTimes.length > 0 
				? poolStats.queueWaitTimes.reduce((a, b) => a + b, 0) / poolStats.queueWaitTimes.length 
				: 0;
      
			stats[key] = { 
				total, 
				inUse, 
				idle, 
				queued,
				errorRate,
				avgQueueTime,
				maxConnections: poolStats?.currentMaxConnections || this.config.maxConnections
			};
		}
    
		return stats;
	}

	private getConnectionKey(config: FtpConfig): string {
		return `${config.host}:${config.port || 21}:${config.username}`;
	}

	private async getAvailableConnection(key: string): Promise<PooledConnection | null> {
		const pooledConnections = this.connections.get(key) || [];
    
		// 寻找空闲连接
		for (const connection of pooledConnections) {
			if (!connection.inUse) {
				// 检查连接健康状况
				if (await this.isConnectionHealthy(connection.client)) {
					return connection;
				} else {
					// 移除不健康的连接
					await this.removeConnection(key, connection);
				}
			}
		}
    
		return null;
	}

	private async createNewConnection(key: string, ftpConfig: FtpConfig): Promise<BasicFtp> {
		const pooledConnections = this.connections.get(key) || [];
    
		// 检查是否达到最大连接数限制
		if (pooledConnections.length >= this.config.maxConnections) {
			// 尝试清理空闲连接
			await this.cleanupIdleConnections(key);
      
			// 如果仍然超限，抛出错误
			if (pooledConnections.length >= this.config.maxConnections) {
				throw new Error(`FTP 连接池已达最大连接数限制: ${this.config.maxConnections}`);
			}
		}

		const client = new BasicFtp();
		const connectionId = `${key}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

		try {
			if (this.config.enableLogging) {
				console.log(`[FtpConnectionPool] 创建新连接: ${connectionId}`);
			}

			// 设置连接超时
			client.timeout = this.config.connectionTimeout;

			// 遵守证书校验配置（默认为true，更安全）
			const validateCertificate = ftpConfig.validateCertificate !== false;
      
			await client.access({
				host: ftpConfig.host,
				port: ftpConfig.port || 21,
				user: ftpConfig.username,
				password: ftpConfig.password,
				secure: ftpConfig.secure || false,
				secureOptions: ftpConfig.secure ? { 
					rejectUnauthorized: validateCertificate 
				} : undefined
			});

			// 创建池化连接对象
			const pooledConnection: PooledConnection = {
				client,
				config: ftpConfig,
				lastUsed: Date.now(),
				inUse: true,
				id: connectionId
			};

			// 添加到连接池
			if (!this.connections.has(key)) {
				this.connections.set(key, []);
			}
      this.connections.get(key)!.push(pooledConnection);

      if (this.config.enableLogging) {
      	console.log(`[FtpConnectionPool] 新连接创建成功: ${connectionId}`);
      }

      return client;

		} catch (error) {
			// 连接失败时清理客户端
			try {
				client.close();
			} catch {}

			if (this.config.enableLogging) {
				console.error(`[FtpConnectionPool] 创建连接失败: ${error}`);
			}

			throw new Error(`FTP 连接创建失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async isConnectionHealthy(client: BasicFtp): Promise<boolean> {
		try {
			// 简单的健康检查 - 尝试发送 NOOP 命令
			await client.send('NOOP');
			return true;
		} catch {
			return false;
		}
	}

	private async removeConnection(key: string, connection: PooledConnection): Promise<void> {
		const pooledConnections = this.connections.get(key);
		if (pooledConnections) {
			const index = pooledConnections.indexOf(connection);
			if (index !== -1) {
				pooledConnections.splice(index, 1);
        
				try {
					connection.client.close();
				} catch (error) {
					console.warn(`[FtpConnectionPool] 关闭连接时出错: ${error}`);
				}

				if (this.config.enableLogging) {
					console.log(`[FtpConnectionPool] 移除连接: ${connection.id}`);
				}
			}
		}
	}

	private async cleanupIdleConnections(key?: string): Promise<void> {
		const now = Date.now();
		const keysToClean = key ? [key] : Array.from(this.connections.keys());

		for (const currentKey of keysToClean) {
			const pooledConnections = this.connections.get(currentKey);
			if (!pooledConnections) {continue;}

			// 找出需要清理的连接（空闲时间超过限制且未在使用）
			const connectionsToRemove = pooledConnections.filter(
				conn => !conn.inUse && (now - conn.lastUsed) > this.config.maxIdleTime
			);

			for (const connection of connectionsToRemove) {
				await this.removeConnection(currentKey, connection);
			}

			// 如果连接池为空，移除该键
			if (this.connections.get(currentKey)?.length === 0) {
				this.connections.delete(currentKey);
			}
		}
	}

	private startCleanupTimer(): void {
		// 每分钟执行一次清理
		this.cleanupTimer = setInterval(() => {
			this.cleanupIdleConnections().catch(error => {
				console.warn('[FtpConnectionPool] 定期清理失败:', error);
			});
		}, 60000);
	}

	/**
   * 启动自适应缩放定时器
   */
	private startAdaptiveScaling(): void {
		this.scalingTimer = setInterval(() => {
			this.performAdaptiveScaling().catch(error => {
				console.warn('[FtpConnectionPool] 自适应缩放失败:', error);
			});
		}, this.config.scalingCheckInterval);
	}

	/**
   * 将请求加入排队
   */
	private async enqueueRequest(key: string, ftpConfig: FtpConfig, requestStartTime: number): Promise<BasicFtp> {
		return new Promise((resolve, reject) => {
			const queuedRequest: QueuedRequest = {
				resolve,
				reject,
				enqueuedAt: requestStartTime,
				ftpConfig
			};

			if (!this.requestQueue.has(key)) {
				this.requestQueue.set(key, []);
			}

			const queue = this.requestQueue.get(key)!;
			queue.push(queuedRequest);

			if (this.config.enableLogging) {
				console.log(`[FtpConnectionPool] 请求加入排队，当前队列长度: ${queue.length}`);
			}

			// 设置超时
			setTimeout(() => {
				const index = queue.indexOf(queuedRequest);
				if (index !== -1) {
					queue.splice(index, 1);
					reject(new Error(`请求排队超时 (${this.config.maxQueueWaitTime}ms)`));
				}
			}, this.config.maxQueueWaitTime);
		});
	}

	/**
   * 处理排队的请求
   */
	private async processQueuedRequests(key: string): Promise<void> {
		const queue = this.requestQueue.get(key);
		if (!queue || queue.length === 0) {
			return;
		}

		const pooledConnections = this.connections.get(key) || [];
		const availableConnection = pooledConnections.find(conn => !conn.inUse);
    
		if (availableConnection) {
			const queuedRequest = queue.shift()!;
			const waitTime = Date.now() - queuedRequest.enqueuedAt;

			// 记录排队等待时间
			const poolStats = this.stats.get(key)!;
			poolStats.queueWaitTimes.push(waitTime);
      
			// 保持队列历史在合理大小
			if (poolStats.queueWaitTimes.length > 100) {
				poolStats.queueWaitTimes.shift();
			}

			availableConnection.inUse = true;
			availableConnection.lastUsed = Date.now();

			if (this.config.enableLogging) {
				console.log(`[FtpConnectionPool] 处理排队请求，等待时间: ${waitTime}ms`);
			}

			queuedRequest.resolve(availableConnection.client);
		}
	}

	/**
   * 执行自适应缩放
   */
	private async performAdaptiveScaling(): Promise<void> {
		const now = Date.now();

		for (const [key, poolStats] of this.stats.entries()) {
			// 如果距离上次检查时间不足，跳过
			if (now - poolStats.lastScalingCheck < this.config.scalingCheckInterval * 0.8) {
				continue;
			}

			poolStats.lastScalingCheck = now;

			const currentConnections = this.connections.get(key)?.length || 0;
			const queuedRequests = this.requestQueue.get(key)?.length || 0;
			const errorRate = poolStats.totalRequests > 0 ? poolStats.failedRequests / poolStats.totalRequests : 0;
			const avgQueueTime = poolStats.queueWaitTimes.length > 0 
				? poolStats.queueWaitTimes.reduce((a, b) => a + b, 0) / poolStats.queueWaitTimes.length 
				: 0;

			let newMaxConnections = poolStats.currentMaxConnections;

			// 扩容条件：排队时间过长或队列积压严重
			if (avgQueueTime > this.config.maxQueueWaitTime * 0.5 || 
          queuedRequests > 2 ||
          errorRate > this.config.targetErrorRate) {
        
				if (poolStats.currentMaxConnections < this.config.maxConnections) {
					newMaxConnections = Math.min(
						poolStats.currentMaxConnections + 1, 
						this.config.maxConnections
					);
          
					if (this.config.enableLogging) {
						console.log(`[FtpConnectionPool] 扩容连接池 ${key}: ${poolStats.currentMaxConnections} -> ${newMaxConnections}`);
					}
				}
			}
			// 缩容条件：错误率低且无排队
			else if (errorRate < this.config.targetErrorRate * 0.5 && 
               queuedRequests === 0 && 
               avgQueueTime < this.config.maxQueueWaitTime * 0.2 &&
               currentConnections > this.config.minConnections) {
        
				newMaxConnections = Math.max(
					poolStats.currentMaxConnections - 1, 
					this.config.minConnections
				);
        
				if (this.config.enableLogging) {
					console.log(`[FtpConnectionPool] 缩容连接池 ${key}: ${poolStats.currentMaxConnections} -> ${newMaxConnections}`);
				}
			}

			poolStats.currentMaxConnections = newMaxConnections;

			// 如果缩容了，关闭多余的空闲连接
			if (newMaxConnections < currentConnections) {
				await this.trimExcessConnections(key, newMaxConnections);
			}
		}
	}

	/**
   * 清理多余的连接
   */
	private async trimExcessConnections(key: string, targetCount: number): Promise<void> {
		const pooledConnections = this.connections.get(key);
		if (!pooledConnections || pooledConnections.length <= targetCount) {
			return;
		}

		// 优先关闭空闲时间最长的连接
		const idleConnections = pooledConnections
			.filter(conn => !conn.inUse)
			.sort((a, b) => a.lastUsed - b.lastUsed);

		const excessCount = pooledConnections.length - targetCount;
		const connectionsToRemove = idleConnections.slice(0, Math.min(excessCount, idleConnections.length));

		for (const connection of connectionsToRemove) {
			await this.removeConnection(key, connection);
		}
	}
}