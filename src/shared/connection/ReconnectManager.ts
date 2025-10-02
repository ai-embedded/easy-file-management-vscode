/**
 * 重连管理器 - 管理自动重连逻辑
 * 支持指数退避、连接状态监控、重连策略等
 */

import { EventEmitter } from 'events';
import { ConnectionStateMachine, ConnectionState } from './ConnectionStateMachine';

/**
 * 重连配置
 */
export interface ReconnectConfig {
  autoReconnect?: boolean;        // 是否自动重连，默认true
  maxReconnectAttempts?: number;  // 最大重连次数，默认5
  reconnectDelay?: number;         // 初始重连延迟（毫秒），默认1000
  maxReconnectDelay?: number;      // 最大重连延迟（毫秒），默认30000
  reconnectBackoffFactor?: number; // 重连退避因子，默认2
  reconnectJitter?: boolean;       // 是否添加随机抖动，默认true
  pingInterval?: number;           // 心跳检测间隔（毫秒），默认30000
  pingTimeout?: number;            // 心跳超时时间（毫秒），默认5000
  enableLogging?: boolean;         // 是否启用日志，默认true
}

/**
 * 重连上下文
 */
export interface ReconnectContext {
  attempts: number;           // 重连尝试次数
  lastAttemptTime?: number;  // 最后尝试时间
  lastError?: Error;          // 最后错误
  isReconnecting: boolean;    // 是否正在重连
  nextDelay?: number;         // 下次重连延迟
}

/**
 * 连接处理器接口
 */
export interface ConnectionHandler {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: () => boolean;
  ping?: () => Promise<void>;
}

/**
 * 重连管理器类
 */
export class ReconnectManager extends EventEmitter {
	private config: Required<ReconnectConfig>;
	private stateMachine: ConnectionStateMachine;
	private connectionHandler: ConnectionHandler | null = null;
	private reconnectContext: ReconnectContext;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private pingTimer: NodeJS.Timeout | null = null;
	private isDestroyed = false;
  
	constructor(
		stateMachine: ConnectionStateMachine,
		config: ReconnectConfig = {}
	) {
		super();
    
		this.stateMachine = stateMachine;
		this.config = {
			autoReconnect: config.autoReconnect ?? true,
			maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
			reconnectDelay: config.reconnectDelay ?? 1000,
			maxReconnectDelay: config.maxReconnectDelay ?? 30000,
			reconnectBackoffFactor: config.reconnectBackoffFactor ?? 2,
			reconnectJitter: config.reconnectJitter ?? true,
			pingInterval: config.pingInterval ?? 10000,  // 10秒心跳间隔，确保连接保持活跃
			pingTimeout: config.pingTimeout ?? 5000,
			enableLogging: config.enableLogging ?? true
		};
    
		this.reconnectContext = {
			attempts: 0,
			isReconnecting: false
		};
    
		this.setupStateMachineListeners();
	}
  
	/**
   * 设置连接处理器
   */
	setConnectionHandler(handler: ConnectionHandler): void {
		this.connectionHandler = handler;
	}
  
	/**
   * 设置状态机监听器
   */
	private setupStateMachineListeners(): void {
		// 监听连接成功
		this.stateMachine.on(ConnectionState.CONNECTED, () => {
			this.handleConnected();
		});
    
		// 监听连接断开
		this.stateMachine.on(ConnectionState.DISCONNECTED, (event) => {
			if (event.from === ConnectionState.CONNECTED || 
          event.from === ConnectionState.RECONNECTING) {
				this.handleDisconnected(event.reason);
			}
		});
    
		// 监听错误状态
		this.stateMachine.on(ConnectionState.ERROR, (event) => {
			this.handleError(new Error(event.reason || '连接错误'));
		});
	}
  
	/**
   * 处理连接成功
   */
	private handleConnected(): void {
		this.log('连接成功');
    
		// 重置重连上下文
		this.reconnectContext.attempts = 0;
		this.reconnectContext.isReconnecting = false;
		this.reconnectContext.lastError = undefined;
    
		// 停止重连定时器
		this.stopReconnectTimer();
    
		// 启动心跳检测
		this.startPingTimer();
    
		// 触发连接成功事件
		this.emit('connected');
	}
  
	/**
   * 处理连接断开
   */
	private handleDisconnected(reason?: string): void {
		this.log(`连接断开: ${reason || '未知原因'}`);
    
		// 停止心跳检测
		this.stopPingTimer();
    
		// 触发断开事件
		this.emit('disconnected', { reason });
    
		// 判断是否需要自动重连
		if (this.config.autoReconnect && !this.isDestroyed) {
			this.startReconnect();
		}
	}
  
	/**
   * 处理错误
   */
	private handleError(error: Error): void {
		this.log(`连接错误: ${error.message}`, 'error');
		this.reconnectContext.lastError = error;
    
		// 触发错误事件
		this.emit('error', error);
    
		// 如果正在重连中，继续重连流程
		if (this.reconnectContext.isReconnecting) {
			this.scheduleReconnect();
		} else if (this.config.autoReconnect && !this.isDestroyed) {
			this.startReconnect();
		}
	}
  
	/**
   * 开始重连
   */
	private startReconnect(): void {
		if (this.reconnectContext.isReconnecting || this.isDestroyed) {
			return;
		}
    
		this.reconnectContext.isReconnecting = true;
		this.reconnectContext.attempts = 0;
    
		this.log('开始重连流程');
		this.emit('reconnectStarted');
    
		// 更新状态机
		this.stateMachine.startReconnecting('自动重连');
    
		// 立即尝试重连
		this.attemptReconnect();
	}
  
	/**
   * 尝试重连
   */
	private async attemptReconnect(): Promise<void> {
		if (!this.connectionHandler || this.isDestroyed) {
			return;
		}
    
		this.reconnectContext.attempts++;
		this.reconnectContext.lastAttemptTime = Date.now();
    
		this.log(`重连尝试 ${this.reconnectContext.attempts}/${this.config.maxReconnectAttempts}`);
		this.emit('reconnectAttempt', {
			attempt: this.reconnectContext.attempts,
			maxAttempts: this.config.maxReconnectAttempts
		});
    
		try {
			await this.connectionHandler.connect();
      
			// 连接成功
			this.log(`重连成功，尝试次数: ${this.reconnectContext.attempts}`);
			this.stateMachine.markConnected('重连成功');
			this.emit('reconnectSucceeded', {
				attempts: this.reconnectContext.attempts
			});
      
		} catch (error) {
			this.reconnectContext.lastError = error as Error;
			this.log(`重连失败: ${(error as Error).message}`, 'warn');
      
			// 检查是否继续重连
			if (this.reconnectContext.attempts >= this.config.maxReconnectAttempts) {
				this.log('已达到最大重连次数，停止重连', 'error');
				this.reconnectContext.isReconnecting = false;
				this.stateMachine.markError('重连失败：超过最大尝试次数');
				this.emit('reconnectFailed', {
					attempts: this.reconnectContext.attempts,
					error: error as Error
				});
			} else {
				// 计划下次重连
				this.scheduleReconnect();
			}
		}
	}
  
	/**
   * 计划重连
   */
	private scheduleReconnect(): void {
		if (this.isDestroyed) {return;}
    
		const delay = this.calculateReconnectDelay();
		this.reconnectContext.nextDelay = delay;
    
		this.log(`${delay}ms 后进行下次重连`);
		this.emit('reconnectScheduled', { delay });
    
		this.reconnectTimer = setTimeout(() => {
			this.attemptReconnect();
		}, delay);
	}
  
	/**
   * 计算重连延迟（指数退避）
   */
	private calculateReconnectDelay(): number {
		const attempt = this.reconnectContext.attempts;
		let delay = this.config.reconnectDelay * 
                Math.pow(this.config.reconnectBackoffFactor, attempt - 1);
    
		// 限制最大延迟
		delay = Math.min(delay, this.config.maxReconnectDelay);
    
		// 添加随机抖动
		if (this.config.reconnectJitter) {
			const jitter = delay * 0.1 * (Math.random() * 2 - 1); // ±10%
			delay += jitter;
		}
    
		return Math.round(delay);
	}
  
	/**
   * 启动心跳检测
   */
	private startPingTimer(): void {
		if (!this.connectionHandler?.ping || this.config.pingInterval <= 0) {
			return;
		}
    
		this.stopPingTimer();
    
		this.pingTimer = setInterval(async () => {
			if (this.isDestroyed) {
				this.stopPingTimer();
				return;
			}
      
			try {
				const pingPromise = this.connectionHandler!.ping!();
				const timeoutPromise = new Promise((resolve, reject) => {
					setTimeout(() => reject(new Error('心跳超时')), this.config.pingTimeout);
				});
        
				await Promise.race([pingPromise, timeoutPromise]);
				this.emit('ping', { success: true });
        
			} catch (error) {
				this.log(`心跳检测失败: ${(error as Error).message}`, 'warn');
				this.emit('ping', { success: false, error });
        
				// 心跳失败，触发重连
				if (this.connectionHandler?.isConnected()) {
					await this.connectionHandler.disconnect();
				}
				this.stateMachine.markDisconnected('心跳检测失败');
			}
		}, this.config.pingInterval);
    
		this.log(`心跳检测已启动，间隔: ${this.config.pingInterval}ms (${this.config.pingInterval / 1000}秒)`);
	}
  
	/**
   * 停止心跳检测
   */
	private stopPingTimer(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
			this.log('心跳检测已停止');
		}
	}
  
	/**
   * 停止重连定时器
   */
	private stopReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}
  
	/**
   * 手动触发重连
   */
	async reconnect(): Promise<void> {
		if (this.stateMachine.isConnected()) {
			this.log('已连接，无需重连');
			return;
		}
    
		this.startReconnect();
	}
  
	/**
   * 停止重连
   */
	stopReconnect(): void {
		this.log('停止重连');
		this.reconnectContext.isReconnecting = false;
		this.stopReconnectTimer();
		this.emit('reconnectStopped');
	}
  
	/**
   * 更新配置
   */
	updateConfig(config: Partial<ReconnectConfig>): void {
		Object.assign(this.config, config);
		this.log('重连配置已更新');
    
		// 如果更新了心跳配置，重新启动心跳
		if (this.stateMachine.isConnected()) {
			this.startPingTimer();
		}
	}
  
	/**
   * 获取重连状态
   */
	getReconnectStatus(): ReconnectContext {
		return { ...this.reconnectContext };
	}
  
	/**
   * 销毁管理器
   */
	destroy(): void {
		this.isDestroyed = true;
		this.stopReconnect();
		this.stopPingTimer();
		this.removeAllListeners();
		this.log('重连管理器已销毁');
	}
  
	/**
   * 记录日志
   */
	private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
		if (!this.config.enableLogging) {return;}
    
		const prefix = '[ReconnectManager]';
		switch (level) {
			case 'warn':
				console.warn(`${prefix} ${message}`);
				break;
			case 'error':
				console.error(`${prefix} ${message}`);
				break;
			default:
				console.log(`${prefix} ${message}`);
		}
	}
}

/**
 * 创建重连管理器的工厂函数
 */
export function createReconnectManager(
	stateMachine: ConnectionStateMachine,
	config?: ReconnectConfig
): ReconnectManager {
	return new ReconnectManager(stateMachine, config);
}
