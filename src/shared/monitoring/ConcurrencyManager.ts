/**
 * 并发控制管理器 - 控制并发操作数量，防止资源耗尽
 * 支持队列管理、优先级调度和超时控制
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';

/**
 * 任务优先级
 */
export enum TaskPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3
}

/**
 * 任务状态
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout'
}

/**
 * 任务接口
 */
export interface Task<T = any> {
  id: string;
  name: string;
  priority: TaskPriority;
  status: TaskStatus;
  operation: () => Promise<T>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: T;
  error?: Error;
  timeout?: number;
  retryCount?: number;
  maxRetries?: number;
}

/**
 * 并发控制配置
 */
export interface ConcurrencyConfig {
  /** 最大并发数 */
  maxConcurrency?: number;
  /** 队列最大长度 */
  maxQueueSize?: number;
  /** 默认任务超时时间（毫秒） */
  defaultTimeout?: number;
  /** 是否启用优先级调度 */
  enablePriority?: boolean;
  /** 是否启用自动重试 */
  enableRetry?: boolean;
  /** 默认最大重试次数 */
  defaultMaxRetries?: number;
  /** 重试延迟（毫秒） */
  retryDelay?: number;
}

/**
 * 并发统计数据
 */
export interface ConcurrencyStatistics {
  runningCount: number;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  timeoutCount: number;
  totalProcessed: number;
  averageWaitTime: number;
  averageExecutionTime: number;
}

/**
 * 并发控制管理器类
 */
export class ConcurrencyManager extends EventEmitter {
	private config: Required<ConcurrencyConfig>;
	private queue: Task[] = [];
	private running: Map<string, Task> = new Map();
	private completed: Map<string, Task> = new Map();
	private logger: Logger;
	private statistics = {
		totalProcessed: 0,
		completedCount: 0,
		failedCount: 0,
		cancelledCount: 0,
		timeoutCount: 0,
		totalWaitTime: 0,
		totalExecutionTime: 0
	};
  
	constructor(config: ConcurrencyConfig = {}) {
		super();
    
		this.config = {
			maxConcurrency: config.maxConcurrency ?? 3,
			maxQueueSize: config.maxQueueSize ?? 100,
			defaultTimeout: config.defaultTimeout ?? 30000,
			enablePriority: config.enablePriority ?? true,
			enableRetry: config.enableRetry ?? true,
			defaultMaxRetries: config.defaultMaxRetries ?? 3,
			retryDelay: config.retryDelay ?? 1000
		};
    
		this.logger = new Logger('ConcurrencyManager');
    
		// 验证配置
		if (this.config.maxConcurrency < 1) {
			throw new Error('maxConcurrency must be at least 1');
		}
	}
  
	/**
   * 执行任务
   */
	async execute<T>(
		name: string,
		operation: () => Promise<T>,
		options: {
      priority?: TaskPriority;
      timeout?: number;
      maxRetries?: number;
    } = {}
	): Promise<T> {
		const task: Task<T> = {
			id: this.generateTaskId(),
			name,
			priority: options.priority ?? TaskPriority.NORMAL,
			status: TaskStatus.PENDING,
			operation,
			createdAt: Date.now(),
			timeout: options.timeout ?? this.config.defaultTimeout,
			retryCount: 0,
			maxRetries: this.config.enableRetry 
				? (options.maxRetries ?? this.config.defaultMaxRetries)
				: 0
		};
    
		return new Promise<T>((resolve, reject) => {
			// 检查队列大小
			if (this.queue.length >= this.config.maxQueueSize) {
				const error = new Error(`队列已满，无法添加任务: ${name}`);
				this.logger.error(error.message);
				reject(error);
				return;
			}
      
			// 包装操作以处理结果
			const wrappedTask = {
				...task,
				operation: async () => {
					try {
						const result = await task.operation();
						resolve(result);
						return result;
					} catch (error) {
						reject(error);
						throw error;
					}
				}
			};
      
			// 添加到队列
			this.enqueue(wrappedTask);
      
			// 触发事件
			this.emit('task-queued', task);
      
			// 尝试处理队列
			this.processQueue();
		});
	}
  
	/**
   * 批量执行任务
   */
	async executeBatch<T>(
		tasks: Array<{
      name: string;
      operation: () => Promise<T>;
      priority?: TaskPriority;
      timeout?: number;
    }>
	): Promise<Array<{ success: boolean; result?: T; error?: Error }>> {
		const promises = tasks.map(task => 
			this.execute(task.name, task.operation, {
				priority: task.priority,
				timeout: task.timeout
			})
				.then(result => ({ success: true, result }))
				.catch(error => ({ success: false, error }))
		);
    
		return Promise.all(promises);
	}
  
	/**
   * 取消任务
   */
	cancelTask(taskId: string): boolean {
		// 从队列中移除
		const queueIndex = this.queue.findIndex(t => t.id === taskId);
		if (queueIndex !== -1) {
			const task = this.queue.splice(queueIndex, 1)[0];
			task.status = TaskStatus.CANCELLED;
			task.completedAt = Date.now();
			this.completed.set(task.id, task);
			this.statistics.cancelledCount++;
      
			this.logger.info(`任务已取消: ${task.name} [${taskId}]`);
			this.emit('task-cancelled', task);
			return true;
		}
    
		// 正在运行的任务无法取消（可以考虑实现中断机制）
		if (this.running.has(taskId)) {
			this.logger.warn(`无法取消正在运行的任务: ${taskId}`);
			return false;
		}
    
		return false;
	}
  
	/**
   * 取消所有待处理任务
   */
	cancelAll(): number {
		const count = this.queue.length;
    
		while (this.queue.length > 0) {
			const task = this.queue.shift()!;
			task.status = TaskStatus.CANCELLED;
			task.completedAt = Date.now();
			this.completed.set(task.id, task);
			this.statistics.cancelledCount++;
			this.emit('task-cancelled', task);
		}
    
		this.logger.info(`已取消 ${count} 个待处理任务`);
		return count;
	}
  
	/**
   * 获取当前状态
   */
	getStatus(): {
    running: number;
    pending: number;
    available: number;
    } {
		return {
			running: this.running.size,
			pending: this.queue.length,
			available: this.config.maxConcurrency - this.running.size
		};
	}
  
	/**
   * 获取统计数据
   */
	getStatistics(): ConcurrencyStatistics {
		const avgWaitTime = this.statistics.totalProcessed > 0
			? this.statistics.totalWaitTime / this.statistics.totalProcessed
			: 0;
    
		const avgExecutionTime = this.statistics.completedCount > 0
			? this.statistics.totalExecutionTime / this.statistics.completedCount
			: 0;
    
		return {
			runningCount: this.running.size,
			pendingCount: this.queue.length,
			completedCount: this.statistics.completedCount,
			failedCount: this.statistics.failedCount,
			cancelledCount: this.statistics.cancelledCount,
			timeoutCount: this.statistics.timeoutCount,
			totalProcessed: this.statistics.totalProcessed,
			averageWaitTime: avgWaitTime,
			averageExecutionTime: avgExecutionTime
		};
	}
  
	/**
   * 设置最大并发数
   */
	setMaxConcurrency(max: number): void {
		if (max < 1) {
			throw new Error('maxConcurrency must be at least 1');
		}
    
		const oldMax = this.config.maxConcurrency;
		this.config.maxConcurrency = max;
    
		this.logger.info(`最大并发数已更新: ${oldMax} -> ${max}`);
    
		// 如果增加了并发数，尝试处理更多任务
		if (max > oldMax) {
			this.processQueue();
		}
	}
  
	/**
   * 等待所有任务完成
   */
	async waitForAll(): Promise<void> {
		while (this.running.size > 0 || this.queue.length > 0) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}
  
	/**
   * 清理完成的任务记录
   */
	clearCompleted(): void {
		this.completed.clear();
	}
  
	/**
   * 重置统计数据
   */
	resetStatistics(): void {
		this.statistics = {
			totalProcessed: 0,
			completedCount: 0,
			failedCount: 0,
			cancelledCount: 0,
			timeoutCount: 0,
			totalWaitTime: 0,
			totalExecutionTime: 0
		};
	}
  
	/**
   * 销毁管理器
   */
	destroy(): void {
		this.cancelAll();
		this.queue = [];
		this.running.clear();
		this.completed.clear();
		this.removeAllListeners();
	}
  
	// 私有方法
  
	private enqueue(task: Task): void {
		if (this.config.enablePriority) {
			// 按优先级插入队列
			const insertIndex = this.queue.findIndex(t => t.priority < task.priority);
			if (insertIndex === -1) {
				this.queue.push(task);
			} else {
				this.queue.splice(insertIndex, 0, task);
			}
		} else {
			// 简单追加到队尾
			this.queue.push(task);
		}
    
		this.logger.debug(`任务已入队: ${task.name} [${task.id}], 队列长度: ${this.queue.length}`);
	}
  
	private async processQueue(): Promise<void> {
		// 检查是否可以处理更多任务
		while (this.running.size < this.config.maxConcurrency && this.queue.length > 0) {
			const task = this.queue.shift()!;
			this.runTask(task);
		}
	}
  
	private async runTask(task: Task): Promise<void> {
		// 更新状态
		task.status = TaskStatus.RUNNING;
		task.startedAt = Date.now();
		this.running.set(task.id, task);
    
		// 计算等待时间
		const waitTime = task.startedAt - task.createdAt;
		this.statistics.totalWaitTime += waitTime;
		this.statistics.totalProcessed++;
    
		this.logger.debug(`任务开始执行: ${task.name} [${task.id}], 等待时间: ${waitTime}ms`);
		this.emit('task-started', task);
    
		// 设置超时
		let timeoutHandle: NodeJS.Timeout | undefined;
		if (task.timeout && task.timeout > 0) {
			timeoutHandle = setTimeout(() => {
				if (this.running.has(task.id)) {
					this.handleTaskTimeout(task);
				}
			}, task.timeout);
		}
    
		try {
			// 执行任务
			const result = await task.operation();
      
			// 清除超时
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
      
			// 更新状态
			task.status = TaskStatus.COMPLETED;
			task.completedAt = Date.now();
			task.result = result;
      
			// 计算执行时间
			const executionTime = task.completedAt - task.startedAt!;
			this.statistics.totalExecutionTime += executionTime;
			this.statistics.completedCount++;
      
			this.logger.debug(`任务完成: ${task.name} [${task.id}], 执行时间: ${executionTime}ms`);
			this.emit('task-completed', task);
      
		} catch (error) {
			// 清除超时
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
      
			// 处理错误
			await this.handleTaskError(task, error as Error);
      
		} finally {
			// 从运行列表移除
			this.running.delete(task.id);
			this.completed.set(task.id, task);
      
			// 限制完成任务的数量
			this.pruneCompleted();
      
			// 继续处理队列
			this.processQueue();
		}
	}
  
	private async handleTaskError(task: Task, error: Error): Promise<void> {
		task.error = error;
    
		// 检查是否需要重试
		if (task.retryCount! < task.maxRetries!) {
      task.retryCount!++;
      task.status = TaskStatus.PENDING;
      
      this.logger.warn(`任务失败，准备重试: ${task.name} [${task.id}], 重试次数: ${task.retryCount}/${task.maxRetries}`);
      
      // 延迟后重新入队
      await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
      this.enqueue(task);
      
		} else {
			// 最终失败
			task.status = TaskStatus.FAILED;
			task.completedAt = Date.now();
			this.statistics.failedCount++;
      
			this.logger.error(`任务失败: ${task.name} [${task.id}] - ${error.message}`);
			this.emit('task-failed', task);
		}
	}
  
	private handleTaskTimeout(task: Task): void {
		task.status = TaskStatus.TIMEOUT;
		task.completedAt = Date.now();
		task.error = new Error(`任务超时: ${task.timeout}ms`);
		this.statistics.timeoutCount++;
    
		this.logger.error(`任务超时: ${task.name} [${task.id}]`);
		this.emit('task-timeout', task);
    
		// 注意：这里不会真正中断任务执行，只是标记状态
		// 如需真正中断，需要在任务内部实现取消机制
	}
  
	private pruneCompleted(): void {
		// 保留最近1000个完成的任务
		const maxCompleted = 1000;
		if (this.completed.size <= maxCompleted) {
			return;
		}
    
		const toDelete = Array.from(this.completed.keys())
			.slice(0, this.completed.size - maxCompleted);
    
		toDelete.forEach(id => {
			this.completed.delete(id);
		});
	}
  
	private generateTaskId(): string {
		return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}
}

// 导出全局单例（可选）
export const globalConcurrencyManager = new ConcurrencyManager({
	maxConcurrency: 3,
	maxQueueSize: 100,
	defaultTimeout: 30000,
	enablePriority: true,
	enableRetry: true,
	defaultMaxRetries: 3,
	retryDelay: 1000
});