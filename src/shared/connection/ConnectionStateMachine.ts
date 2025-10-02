/**
 * 连接状态机 - 管理连接状态转换
 * 提供统一的状态管理和转换逻辑
 */

import { EventEmitter } from 'events';

/**
 * 连接状态枚举
 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

/**
 * 状态转换事件
 */
export interface StateTransitionEvent {
  from: ConnectionState;
  to: ConnectionState;
  reason?: string;
  timestamp: number;
}

/**
 * 状态机配置
 */
export interface StateMachineConfig {
  initialState?: ConnectionState;
  enableLogging?: boolean;
  maxStateHistory?: number;
}

/**
 * 连接状态机基类
 * 管理连接的状态转换和事件通知
 */
export class ConnectionStateMachine extends EventEmitter {
	private currentState: ConnectionState;
	private previousState: ConnectionState | null = null;
	private stateHistory: StateTransitionEvent[] = [];
	private config: Required<StateMachineConfig>;
  
	// 合法的状态转换映射
	private readonly validTransitions: Map<ConnectionState, Set<ConnectionState>> = new Map([
		[ConnectionState.DISCONNECTED, new Set([
			ConnectionState.CONNECTING,
			ConnectionState.RECONNECTING  // 允许从断开状态直接进入重连状态
		])],
		[ConnectionState.CONNECTING, new Set([
			ConnectionState.CONNECTED,
			ConnectionState.ERROR,
			ConnectionState.DISCONNECTED
		])],
		[ConnectionState.CONNECTED, new Set([
			ConnectionState.DISCONNECTED,
			ConnectionState.RECONNECTING,
			ConnectionState.ERROR
		])],
		[ConnectionState.RECONNECTING, new Set([
			ConnectionState.CONNECTED,
			ConnectionState.ERROR,
			ConnectionState.DISCONNECTED
		])],
		[ConnectionState.ERROR, new Set([
			ConnectionState.DISCONNECTED,
			ConnectionState.CONNECTING,
			ConnectionState.RECONNECTING
		])]
	]);
  
	constructor(config: StateMachineConfig = {}) {
		super();
    
		this.config = {
			initialState: config.initialState || ConnectionState.DISCONNECTED,
			enableLogging: config.enableLogging ?? true,
			maxStateHistory: config.maxStateHistory || 50
		};
    
		this.currentState = this.config.initialState;
		this.log(`状态机初始化，初始状态: ${this.currentState}`);
	}
  
	/**
   * 获取当前状态
   */
	getState(): ConnectionState {
		return this.currentState;
	}
  
	/**
   * 获取前一个状态
   */
	getPreviousState(): ConnectionState | null {
		return this.previousState;
	}
  
	/**
   * 获取状态历史
   */
	getStateHistory(): ReadonlyArray<StateTransitionEvent> {
		return [...this.stateHistory];
	}
  
	/**
   * 检查是否可以转换到目标状态
   */
	canTransitionTo(targetState: ConnectionState): boolean {
		const validTargets = this.validTransitions.get(this.currentState);
		return validTargets ? validTargets.has(targetState) : false;
	}
  
	/**
   * 转换到新状态
   */
	transitionTo(targetState: ConnectionState, reason?: string): boolean {
		// 幂等性检查：如果已经处于目标状态，跳过转换
		if (this.currentState === targetState) {
			this.log(`状态已经是 ${targetState}，跳过转换 (${reason || '无原因'})`, 'info');
			return true;
		}

		if (!this.canTransitionTo(targetState)) {
			this.log(`非法状态转换: ${this.currentState} -> ${targetState}`, 'warn');
			return false;
		}
    
		const fromState = this.currentState;
		this.previousState = fromState;
		this.currentState = targetState;
    
		const event: StateTransitionEvent = {
			from: fromState,
			to: targetState,
			reason,
			timestamp: Date.now()
		};
    
		// 记录状态历史
		this.addToHistory(event);
    
		// 记录日志
		this.log(`状态转换: ${fromState} -> ${targetState}${reason ? ` (${reason})` : ''}`);
    
		// 触发状态变更事件
		this.emit('stateChanged', event);
		this.emit(targetState, event);
    
		return true;
	}
  
	/**
   * 开始连接
   */
	startConnecting(reason?: string): boolean {
		return this.transitionTo(ConnectionState.CONNECTING, reason);
	}
  
	/**
   * 标记连接成功
   */
	markConnected(reason?: string): boolean {
		return this.transitionTo(ConnectionState.CONNECTED, reason);
	}
  
	/**
   * 标记连接断开
   */
	markDisconnected(reason?: string): boolean {
		return this.transitionTo(ConnectionState.DISCONNECTED, reason);
	}
  
	/**
   * 开始重连
   */
	startReconnecting(reason?: string): boolean {
		return this.transitionTo(ConnectionState.RECONNECTING, reason);
	}
  
	/**
   * 标记错误状态
   */
	markError(reason?: string): boolean {
		return this.transitionTo(ConnectionState.ERROR, reason);
	}
  
	/**
   * 检查是否处于特定状态
   */
	isInState(state: ConnectionState): boolean {
		return this.currentState === state;
	}
  
	/**
   * 检查是否已连接
   */
	isConnected(): boolean {
		return this.currentState === ConnectionState.CONNECTED;
	}
  
	/**
   * 检查是否正在连接
   */
	isConnecting(): boolean {
		return this.currentState === ConnectionState.CONNECTING || 
           this.currentState === ConnectionState.RECONNECTING;
	}
  
	/**
   * 检查是否处于错误状态
   */
	isInError(): boolean {
		return this.currentState === ConnectionState.ERROR;
	}
  
	/**
   * 重置状态机
   */
	reset(): void {
		this.currentState = this.config.initialState;
		this.previousState = null;
		this.stateHistory = [];
		this.log('状态机已重置');
		this.emit('reset');
	}
  
	/**
   * 添加到历史记录
   */
	private addToHistory(event: StateTransitionEvent): void {
		this.stateHistory.push(event);
    
		// 限制历史记录大小
		if (this.stateHistory.length > this.config.maxStateHistory) {
			this.stateHistory = this.stateHistory.slice(-this.config.maxStateHistory);
		}
	}
  
	/**
   * 记录日志
   */
	private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
		if (!this.config.enableLogging) {return;}
    
		const prefix = '[ConnectionStateMachine]';
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
  
	/**
   * 获取状态统计信息
   */
	getStatistics(): {
    currentState: ConnectionState;
    previousState: ConnectionState | null;
    totalTransitions: number;
    stateDistribution: Record<ConnectionState, number>;
    averageStateDuration: Record<ConnectionState, number>;
    } {
		const stateDistribution: Record<ConnectionState, number> = {
			[ConnectionState.DISCONNECTED]: 0,
			[ConnectionState.CONNECTING]: 0,
			[ConnectionState.CONNECTED]: 0,
			[ConnectionState.RECONNECTING]: 0,
			[ConnectionState.ERROR]: 0
		};
    
		const stateDurations: Record<ConnectionState, number[]> = {
			[ConnectionState.DISCONNECTED]: [],
			[ConnectionState.CONNECTING]: [],
			[ConnectionState.CONNECTED]: [],
			[ConnectionState.RECONNECTING]: [],
			[ConnectionState.ERROR]: []
		};
    
		// 计算状态分布和持续时间
		for (let i = 0; i < this.stateHistory.length; i++) {
			const event = this.stateHistory[i];
			stateDistribution[event.to]++;
      
			if (i < this.stateHistory.length - 1) {
				const nextEvent = this.stateHistory[i + 1];
				const duration = nextEvent.timestamp - event.timestamp;
				stateDurations[event.to].push(duration);
			}
		}
    
		// 计算平均持续时间
		const averageStateDuration: Record<ConnectionState, number> = {
			[ConnectionState.DISCONNECTED]: 0,
			[ConnectionState.CONNECTING]: 0,
			[ConnectionState.CONNECTED]: 0,
			[ConnectionState.RECONNECTING]: 0,
			[ConnectionState.ERROR]: 0
		};
    
		for (const state in stateDurations) {
			const durations = stateDurations[state as ConnectionState];
			if (durations.length > 0) {
				const sum = durations.reduce((a, b) => a + b, 0);
				averageStateDuration[state as ConnectionState] = sum / durations.length;
			}
		}
    
		return {
			currentState: this.currentState,
			previousState: this.previousState,
			totalTransitions: this.stateHistory.length,
			stateDistribution,
			averageStateDuration
		};
	}
}

/**
 * 创建状态机实例的工厂函数
 */
export function createStateMachine(config?: StateMachineConfig): ConnectionStateMachine {
	return new ConnectionStateMachine(config);
}