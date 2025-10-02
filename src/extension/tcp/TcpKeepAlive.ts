/**
 * TCP 连接保活管理器
 * 实现连接健康检查和自动恢复
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import { Logger } from '../../shared/utils/Logger';

const logger = new Logger('TcpKeepAlive');

/**
 * 保活配置
 */
export interface KeepAliveConfig {
  // 心跳配置
  pingInterval?: number;         // 心跳间隔（毫秒，默认 30000）
  pingTimeout?: number;          // 心跳超时（毫秒，默认 5000）
  maxPingFailures?: number;      // 最大失败次数（默认 3）
  
  // TCP 保活配置
  enableTcpKeepAlive?: boolean;  // 启用 TCP 层保活（默认 true）
  tcpKeepAliveDelay?: number;    // TCP 保活延迟（毫秒，默认 60000）
  tcpKeepAliveInterval?: number; // TCP 保活间隔（毫秒，默认 10000）
  
  // 重连配置
  autoReconnect?: boolean;       // 自动重连（默认 true）
  reconnectDelay?: number;       // 重连延迟（毫秒，默认 1000）
  maxReconnectAttempts?: number; // 最大重连次数（默认 5）
  reconnectBackoff?: number;     // 重连退避系数（默认 2）
  
  // 监控配置
  enableMonitoring?: boolean;    // 启用监控（默认 true）
  monitoringInterval?: number;   // 监控间隔（毫秒，默认 5000）
}

/**
 * 连接健康状态
 */
interface HealthStatus {
  isHealthy: boolean;
  lastPingTime: number;
  lastPingSuccess: boolean;
  consecutiveFailures: number;
  latency: number;
  uptime: number;
  reconnectCount: number;
  totalPings: number;
  successfulPings: number;
  failedPings: number;
  averageLatency: number;
}

/**
 * TCP 连接保活管理器
 */
export class TcpKeepAlive extends EventEmitter {
	private config: Required<KeepAliveConfig>;
	private socket?: net.Socket;
	private pingTimer?: NodeJS.Timeout;
	private monitorTimer?: NodeJS.Timeout;
	private reconnectTimer?: NodeJS.Timeout;
	private lastActivity = 0;
  
	// 状态跟踪
	private isActive = false;
	private isPinging = false;
	private consecutiveFailures = 0;
	private reconnectAttempts = 0;
	private connectionStartTime = 0;
  
	// 统计信息
	private stats = {
		totalPings: 0,
		successfulPings: 0,
		failedPings: 0,
		totalLatency: 0,
		reconnectCount: 0,
		lastPingTime: 0,
		lastPingSuccess: true,
		lastLatency: 0
	};
  
	// Ping 回调
	private pingCallback?: () => Promise<void>;
  
	constructor(config: KeepAliveConfig = {}) {
		super();
    
		// 初始化配置
		this.config = {
			pingInterval: config.pingInterval || 30000,
			pingTimeout: config.pingTimeout || 5000,
			maxPingFailures: config.maxPingFailures || 3,
			enableTcpKeepAlive: config.enableTcpKeepAlive !== false,
			tcpKeepAliveDelay: config.tcpKeepAliveDelay || 60000,
			tcpKeepAliveInterval: config.tcpKeepAliveInterval || 10000,
			autoReconnect: config.autoReconnect !== false,
			reconnectDelay: config.reconnectDelay || 1000,
			maxReconnectAttempts: config.maxReconnectAttempts || 5,
			reconnectBackoff: config.reconnectBackoff || 2,
			enableMonitoring: config.enableMonitoring !== false,
			monitoringInterval: config.monitoringInterval || 5000
		};
    
		logger.info('TCP 保活管理器已初始化', {
			pingInterval: this.config.pingInterval,
			tcpKeepAlive: this.config.enableTcpKeepAlive,
			autoReconnect: this.config.autoReconnect
		});
	}
  
	/**
   * 启动保活
   */
	start(socket: net.Socket, pingCallback: () => Promise<void>): void {
		if (this.isActive) {
			logger.warn('保活已在运行中');
			return;
		}
    
		this.socket = socket;
		this.pingCallback = pingCallback;
		this.isActive = true;
		this.connectionStartTime = Date.now();
		this.consecutiveFailures = 0;
		this.reconnectAttempts = 0;
		this.lastActivity = Date.now();
    
		// 配置 TCP 层保活
		if (this.config.enableTcpKeepAlive) {
			this.configureTcpKeepAlive();
		}
    
		// 启动应用层心跳
		this.startPing();
    
		// 启动监控
		if (this.config.enableMonitoring) {
			this.startMonitoring();
		}
    
		// 监听 socket 事件
		this.attachSocketListeners();
    
		logger.info('保活已启动');
		this.emit('started');
	}
  
	/**
   * 停止保活
   */
	stop(): void {
		if (!this.isActive) {
			return;
		}
    
		this.isActive = false;
    
		// 清理定时器
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = undefined;
		}
    
		if (this.monitorTimer) {
			clearInterval(this.monitorTimer);
			this.monitorTimer = undefined;
		}
    
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
    
		// 移除 socket 监听器
		this.detachSocketListeners();
		this.pingCallback = undefined;
		this.socket = undefined;

		logger.info('保活已停止');
		this.emit('stopped');
	}
  
	/**
   * 获取健康状态
   */
	getHealthStatus(): HealthStatus {
		const uptime = this.connectionStartTime > 0 
			? Date.now() - this.connectionStartTime 
			: 0;
    
		const averageLatency = this.stats.successfulPings > 0
			? this.stats.totalLatency / this.stats.successfulPings
			: 0;
    
		return {
			isHealthy: this.isActive && this.consecutiveFailures === 0,
			lastPingTime: this.stats.lastPingTime,
			lastPingSuccess: this.stats.lastPingSuccess,
			consecutiveFailures: this.consecutiveFailures,
			latency: this.stats.lastLatency,
			uptime,
			reconnectCount: this.stats.reconnectCount,
			totalPings: this.stats.totalPings,
			successfulPings: this.stats.successfulPings,
			failedPings: this.stats.failedPings,
			averageLatency
		};
	}
  
	/**
   * 重置统计
   */
	resetStats(): void {
		this.stats = {
			totalPings: 0,
			successfulPings: 0,
			failedPings: 0,
			totalLatency: 0,
			reconnectCount: 0,
			lastPingTime: 0,
			lastPingSuccess: true,
			lastLatency: 0
		};
    
		this.consecutiveFailures = 0;
		this.reconnectAttempts = 0;
	}
  
	// === 私有方法 ===
  
	/**
   * 配置 TCP 层保活
   */
	private configureTcpKeepAlive(): void {
		if (!this.socket) {return;}
    
		try {
			// 启用 TCP 保活
			this.socket.setKeepAlive(true, this.config.tcpKeepAliveDelay);
      
			// 设置 TCP 无延迟（禁用 Nagle 算法）
			this.socket.setNoDelay(true);
      
			logger.info('TCP 层保活已配置', {
				delay: this.config.tcpKeepAliveDelay,
				noDelay: true
			});
      
		} catch (error) {
			logger.error('配置 TCP 保活失败:', error);
		}
	}
  
	/**
   * 启动应用层心跳
   */
	private startPing(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
		}
    
		this.pingTimer = setInterval(() => {
			this.performPing();
		}, this.config.pingInterval);
    
		// 立即执行一次
		this.performPing();
	}
  
	/**
   * 执行心跳检测
   */
	private async performPing(): Promise<void> {
		if (!this.isActive || this.isPinging || !this.pingCallback) {
			return;
		}

		const now = Date.now();
		const idleDuration = now - this.lastActivity;
		if (idleDuration < this.config.pingInterval) {
			logger.debug('跳过心跳: 最近有数据交互', { idleDuration });
			this.stats.lastPingTime = now;
			this.stats.lastPingSuccess = true;
			this.stats.lastLatency = 0;
			return;
		}

		this.isPinging = true;
		const startTime = now;
    
		try {
			// 设置超时
			const timeoutPromise = new Promise<void>((resolve, reject) => {
				setTimeout(() => reject(new Error('Ping timeout')), this.config.pingTimeout);
			});
      
			// 执行 ping
			await Promise.race([
				this.pingCallback(),
				timeoutPromise
			]);
      
			// 计算延迟
			const latency = Date.now() - startTime;
      
			// 更新统计
			this.stats.totalPings++;
			this.stats.successfulPings++;
			this.stats.totalLatency += latency;
			this.stats.lastPingTime = Date.now();
			this.stats.lastPingSuccess = true;
			this.stats.lastLatency = latency;
      
			// 重置失败计数
			this.consecutiveFailures = 0;
      
			logger.debug(`心跳成功: ${latency}ms`);
			this.emit('ping-success', { latency });
      
		} catch (error) {
			// 更新统计
			this.stats.totalPings++;
			this.stats.failedPings++;
			this.stats.lastPingTime = Date.now();
			this.stats.lastPingSuccess = false;
      
			// 增加失败计数
			this.consecutiveFailures++;
      
			logger.warn(`心跳失败 (${this.consecutiveFailures}/${this.config.maxPingFailures}):`, error);
			this.emit('ping-failed', { error, failures: this.consecutiveFailures });
      
			// 检查是否需要重连
			if (this.consecutiveFailures >= this.config.maxPingFailures) {
				logger.warn('心跳连续失败，触发重连');
				this.handleConnectionLoss();
			}
      
		} finally {
			this.isPinging = false;
		}
	}

	recordActivity(context?: string): void {
		this.lastActivity = Date.now();
		if (context) {
			logger.debug('记录连接活跃事件', { context, timestamp: this.lastActivity });
		}
	}
  
	/**
   * 启动监控
   */
	private startMonitoring(): void {
		if (this.monitorTimer) {
			clearInterval(this.monitorTimer);
		}
    
		this.monitorTimer = setInterval(() => {
			const status = this.getHealthStatus();
      
			// 发出监控事件
			this.emit('health-status', status);
      
			// 检查健康状态
			if (!status.isHealthy) {
				logger.warn('连接不健康', {
					consecutiveFailures: status.consecutiveFailures,
					lastPingSuccess: status.lastPingSuccess
				});
			}
      
			// 输出统计
			if (status.totalPings > 0 && status.totalPings % 10 === 0) {
				const successRate = (status.successfulPings / status.totalPings * 100).toFixed(1);
				logger.info(`连接统计: 成功率 ${successRate}%, 平均延迟 ${status.averageLatency.toFixed(1)}ms`);
			}
      
		}, this.config.monitoringInterval);
	}
  
	/**
   * 处理连接丢失
   */
	private handleConnectionLoss(): void {
		if (!this.config.autoReconnect) {
			logger.warn('连接丢失，自动重连已禁用');
			this.emit('connection-lost');
			this.stop();
			return;
		}
    
		// 停止心跳
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = undefined;
		}
    
		// 尝试重连
		this.attemptReconnect();
	}
  
	/**
   * 尝试重连
   */
	private attemptReconnect(): void {
		if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
			logger.error('达到最大重连次数，放弃重连');
			this.emit('reconnect-failed', { attempts: this.reconnectAttempts });
			this.stop();
			return;
		}
    
		this.reconnectAttempts++;
		const delay = this.config.reconnectDelay * Math.pow(this.config.reconnectBackoff, this.reconnectAttempts - 1);
    
		logger.info(`${delay}ms 后进行第 ${this.reconnectAttempts} 次重连尝试`);
    
		this.reconnectTimer = setTimeout(() => {
			this.emit('reconnect-attempt', { 
				attempt: this.reconnectAttempts, 
				maxAttempts: this.config.maxReconnectAttempts 
			});
      
			// 触发重连（由外部处理实际的重连逻辑）
			this.emit('reconnect-required');
      
		}, delay);
	}
  
	/**
   * 附加 socket 监听器
   */
	private attachSocketListeners(): void {
		if (!this.socket) {return;}

		this.socket.on('error', this.handleSocketError);
		this.socket.on('close', this.handleSocketClose);
		this.socket.on('end', this.handleSocketEnd);
		this.socket.on('timeout', this.handleSocketTimeout);
	}
  
	/**
   * 移除 socket 监听器
   */
	private detachSocketListeners(): void {
		if (!this.socket) {return;}

		this.socket.off('error', this.handleSocketError);
		this.socket.off('close', this.handleSocketClose);
		this.socket.off('end', this.handleSocketEnd);
		this.socket.off('timeout', this.handleSocketTimeout);
	}
  
	/**
   * 处理 socket 错误
   */
	private handleSocketError = (error: Error): void => {
		logger.error('Socket 错误:', error);
		this.emit('socket-error', error);
	};
  
	/**
   * 处理 socket 关闭
   */
	private handleSocketClose = (hadError: boolean): void => {
		logger.warn(`Socket 关闭 (有错误: ${hadError})`);
		this.emit('socket-closed', { hadError });

		if (this.isActive) {
			this.handleConnectionLoss();
		}
	};
  
	/**
   * 处理 socket 结束
   */
	private handleSocketEnd = (): void => {
		logger.warn('Socket 连接结束');
		this.emit('socket-ended');
	};
  
	/**
   * 处理 socket 超时
   */
	private handleSocketTimeout = (): void => {
		logger.warn('Socket 超时');
		this.emit('socket-timeout');

		// 触发一次心跳检测
		this.performPing();
	};
  
	/**
   * 连接恢复成功
   */
	onReconnected(socket: net.Socket): void {
		logger.info('连接已恢复');
    
		this.socket = socket;
		this.consecutiveFailures = 0;
		this.stats.reconnectCount++;
    
		// 重新配置
		if (this.config.enableTcpKeepAlive) {
			this.configureTcpKeepAlive();
		}
    
		// 重新附加监听器
		this.attachSocketListeners();
    
		// 重启心跳
		this.startPing();
    
		this.emit('reconnected', { 
			attempts: this.reconnectAttempts,
			totalReconnects: this.stats.reconnectCount 
		});
    
		// 重置重连计数
		this.reconnectAttempts = 0;
	}
}

// 导出默认实例
