/**
 * 重试管理器 - 提供智能重试策略
 * 支持指数退避、幂等性判断、重试取消等功能
 */

import { EventEmitter } from 'events';

/**
 * 错误类型分类
 */
export enum ErrorCategory {
  RETRYABLE = 'retryable',           // 可重试错误（网络超时、连接重置等）
  NON_RETRYABLE = 'non_retryable',   // 不可重试错误（认证失败、权限错误等）
  RATE_LIMITED = 'rate_limited'      // 限流错误（服务器繁忙、请求过于频繁等）
}

/**
 * 错误分类规则
 */
export interface ErrorClassificationRule {
  codes?: string[];              // 错误代码匹配
  messages?: string[];           // 错误消息关键词匹配
  statusCodes?: number[];        // HTTP状态码匹配
  category: ErrorCategory;       // 分类结果
}

/**
 * 重试配置
 */
export interface RetryConfig {
  maxAttempts?: number;          // 最大重试次数，默认3
  initialDelay?: number;          // 初始延迟（毫秒），默认1000
  maxDelay?: number;              // 最大延迟（毫秒），默认30000
  backoffFactor?: number;         // 退避因子，默认2
  jitter?: boolean;               // 是否添加随机抖动，默认true
  retryableErrors?: string[];    // 可重试的错误码列表（保持向后兼容）
  nonRetryableErrors?: string[];  // 不可重试的错误码列表（保持向后兼容）
  rateLimitCooldown?: number;     // 限流错误的冷却时间（毫秒），默认60000
  enableLogging?: boolean;        // 是否启用日志，默认true
  enableStatistics?: boolean;     // 是否启用统计，默认true
  errorClassificationRules?: ErrorClassificationRule[]; // 错误分类规则
}

/**
 * 重试上下文
 */
export interface RetryContext {
  attempt: number;           // 当前重试次数
  totalAttempts: number;     // 总尝试次数（包括首次）
  lastError?: Error;          // 最后一次错误
  startTime: number;          // 开始时间
  elapsedTime: number;        // 已用时间
  nextDelay?: number;         // 下次重试延迟
}

/**
 * 重试决策
 */
export interface RetryDecision {
  shouldRetry: boolean;
  delay: number;
  reason: string;
  errorCategory: ErrorCategory;
}

/**
 * 重试统计信息
 */
export interface RetryStatistics {
  totalRetries: number;
  reasonDistribution: Record<string, number>;
  categoryDistribution: Record<ErrorCategory, number>;
  successAfterRetry: number;
  ultimateFailures: number;
  averageRetriesPerOperation: number;
}

/**
 * 操作类型 - 用于判断幂等性
 */
export enum OperationType {
  // 幂等操作（可安全重试）
  GET = 'GET',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS',
  LIST = 'LIST',
  DOWNLOAD = 'DOWNLOAD',
  READ = 'READ',
  QUERY = 'QUERY',
  REQUEST = 'REQUEST',
  
  // 非幂等操作（需谨慎重试）
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
  UPLOAD = 'UPLOAD',
  WRITE = 'WRITE',
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  EXECUTE = 'EXECUTE'
}

/**
 * 重试管理器类
 */
export class RetryManager extends EventEmitter {
	private config: Required<RetryConfig & {
    rateLimitCooldown: number;
    enableStatistics: boolean;
    errorClassificationRules: ErrorClassificationRule[];
  }>;
	private activeRetries: Map<string, AbortController> = new Map();
	private statistics: RetryStatistics;
  
	constructor(config: RetryConfig = {}) {
		super();
    
		this.config = {
			maxAttempts: config.maxAttempts ?? 3,
			initialDelay: config.initialDelay ?? 1000,
			maxDelay: config.maxDelay ?? 30000,
			backoffFactor: config.backoffFactor ?? 2,
			jitter: config.jitter ?? true,
			retryableErrors: config.retryableErrors || [
				'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ENETUNREACH',
				'ECONNRESET', 'EPIPE', 'EHOSTUNREACH', 'EAI_AGAIN'
			],
			nonRetryableErrors: config.nonRetryableErrors || [
				'EACCES', 'EPERM', 'ENOENT', 'EISDIR', 'ENOTDIR',
				'INVALID_CREDENTIALS', 'UNAUTHORIZED', 'FORBIDDEN', 'OPERATION_CANCELLED'
			],
			rateLimitCooldown: config.rateLimitCooldown ?? 60000,
			enableLogging: config.enableLogging ?? true,
			enableStatistics: config.enableStatistics ?? true,
			errorClassificationRules: config.errorClassificationRules || this.getDefaultClassificationRules()
		};
    
		// 初始化统计信息
		this.statistics = {
			totalRetries: 0,
			reasonDistribution: {},
			categoryDistribution: {
				[ErrorCategory.RETRYABLE]: 0,
				[ErrorCategory.NON_RETRYABLE]: 0,
				[ErrorCategory.RATE_LIMITED]: 0
			},
			successAfterRetry: 0,
			ultimateFailures: 0,
			averageRetriesPerOperation: 0
		};
	}
  
	/**
   * 执行带重试的操作
   */
	async executeWithRetry<T>(
		operation: () => Promise<T>,
		operationType: OperationType,
		operationId?: string
	): Promise<T> {
		const id = operationId || this.generateOperationId();
		const abortController = new AbortController();
		this.activeRetries.set(id, abortController);
    
		const context: RetryContext = {
			attempt: 0,
			totalAttempts: 0,
			startTime: Date.now(),
			elapsedTime: 0
		};
    
		try {
			return await this.executeWithContext(
				operation,
				operationType,
				context,
				id,
				abortController.signal
			);
		} finally {
			this.activeRetries.delete(id);
		}
	}
  
	/**
   * 执行操作（带上下文）
   */
	private async executeWithContext<T>(
		operation: () => Promise<T>,
		operationType: OperationType,
		context: RetryContext,
		operationId: string,
		signal: AbortSignal
	): Promise<T> {
		while (true) {
			if (signal.aborted) {
				throw new Error('操作已取消');
			}
      
			context.totalAttempts++;
			context.elapsedTime = Date.now() - context.startTime;
      
			try {
				this.log(`执行操作 [${operationId}]，尝试 ${context.totalAttempts}`);
        
				// 触发重试开始事件
				if (context.attempt > 0) {
					this.emit('retryStarted', { operationId, context });
				}
        
				const result = await operation();
        
				// 操作成功
				if (context.attempt > 0) {
					this.log(`操作 [${operationId}] 在第 ${context.totalAttempts} 次尝试成功`);
					this.emit('retrySucceeded', { operationId, context });
          
					// 更新成功统计
					if (this.config.enableStatistics) {
						this.statistics.successAfterRetry++;
						this.updateAverageRetries();
					}
				}
        
				return result;
        
			} catch (error) {
				context.lastError = error as Error;
        
				// 判断是否应该重试
				const decision = this.shouldRetry(
          error as Error,
          operationType,
          context
				);
        
				// 更新统计信息
				if (this.config.enableStatistics) {
					this.updateStatistics(decision, context.attempt === 0);
				}
        
				if (!decision.shouldRetry) {
					this.log(`操作 [${operationId}] 失败，不再重试: ${decision.reason}`, 'error');
					this.emit('retryFailed', { operationId, context, error });
          
					// 更新失败统计
					if (this.config.enableStatistics && context.attempt > 0) {
						this.statistics.ultimateFailures++;
						this.updateAverageRetries();
					}
          
					throw error;
				}
        
				// 等待并重试
				context.attempt++;
				context.nextDelay = decision.delay;
        
				this.log(`操作 [${operationId}] 失败，${decision.delay}ms 后重试 (${context.attempt}/${this.config.maxAttempts})`);
				this.emit('retryScheduled', { operationId, context, delay: decision.delay });
        
				await this.delay(decision.delay, signal);
			}
		}
	}
  
	/**
   * 判断是否应该重试
   */
	private shouldRetry(
		error: Error,
		operationType: OperationType,
		context: RetryContext
	): RetryDecision {
		// 检查重试次数
		if (context.attempt >= this.config.maxAttempts) {
			const category = this.classifyError(error);
			return {
				shouldRetry: false,
				delay: 0,
				reason: `已达到最大重试次数 (${this.config.maxAttempts})`,
				errorCategory: category
			};
		}
    
		// 分类错误
		const errorCategory = this.classifyError(error);
    
		// 不可重试错误直接失败
		if (errorCategory === ErrorCategory.NON_RETRYABLE) {
			return {
				shouldRetry: false,
				delay: 0,
				reason: `错误不可重试: ${error.message}`,
				errorCategory
			};
		}
    
		// 检查操作幂等性（仅对非限流错误）
		if (errorCategory !== ErrorCategory.RATE_LIMITED && !this.isIdempotent(operationType)) {
			// 非幂等操作需要特殊处理
			const isNetworkError = this.isNetworkError(error);
			if (!isNetworkError) {
				return {
					shouldRetry: false,
					delay: 0,
					reason: '非幂等操作且非网络错误，不进行重试',
					errorCategory
				};
			}
		}
    
		// 计算延迟
		const delay = this.calculateDelayByCategory(context.attempt, errorCategory);
    
		return {
			shouldRetry: true,
			delay,
			reason: `${errorCategory}错误可重试，延迟 ${delay}ms`,
			errorCategory
		};
	}
  
	/**
   * 判断操作是否幂等
   */
	private isIdempotent(operationType: OperationType): boolean {
		const idempotentOperations = [
			OperationType.GET,
			OperationType.HEAD,
			OperationType.OPTIONS,
			OperationType.LIST,
			OperationType.DOWNLOAD,
			OperationType.READ,
			OperationType.QUERY
		];
    
		return idempotentOperations.includes(operationType);
	}
  
	/**
   * 判断是否为网络错误
   */
	private isNetworkError(error: Error): boolean {
		const networkErrors = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 
			'ENETUNREACH', 'ECONNRESET', 'EPIPE'];
		const errorCode = (error as any).code;
    
		return networkErrors.includes(errorCode) ||
           error.message.includes('network') ||
           error.message.includes('timeout');
	}
  
	/**
   * 判断错误是否可重试
   */
	private isRetryableError(error: Error): boolean {
		const errorCode = (error as any).code || '';
		const errorMessage = error.message.toLowerCase();
    
		// 检查不可重试错误列表
		if (this.config.nonRetryableErrors.some(code => 
			errorCode === code || errorMessage.includes(code.toLowerCase())
		)) {
			return false;
		}
    
		// 检查可重试错误列表
		if (this.config.retryableErrors.some(code => 
			errorCode === code || errorMessage.includes(code.toLowerCase())
		)) {
			return true;
		}
    
		// 默认：5xx错误可重试，4xx错误不可重试
		if ((error as any).response) {
			const status = (error as any).response.status;
			return status >= 500 && status < 600;
		}
    
		return false;
	}
  
	/**
   * 计算重试延迟（指数退避）
   */
	private calculateDelay(attempt: number): number {
		let delay = this.config.initialDelay * Math.pow(this.config.backoffFactor, attempt);
    
		// 限制最大延迟
		delay = Math.min(delay, this.config.maxDelay);
    
		// 添加随机抖动（防止惊群效应）
		if (this.config.jitter) {
			const jitter = delay * 0.1 * (Math.random() * 2 - 1); // ±10%
			delay += jitter;
		}
    
		return Math.round(delay);
	}
  
	/**
   * 根据错误类型计算延迟
   */
	private calculateDelayByCategory(attempt: number, category: ErrorCategory): number {
		switch (category) {
			case ErrorCategory.RATE_LIMITED:
				// 限流错误使用更长的冷却时间
				let rateLimitDelay = this.config.rateLimitCooldown + (attempt * this.config.rateLimitCooldown * 0.5);
				rateLimitDelay = Math.min(rateLimitDelay, this.config.rateLimitCooldown * 3); // 最大不超过3倍
				return Math.round(rateLimitDelay);
        
			case ErrorCategory.RETRYABLE:
			default:
				// 标准指数退避
				return this.calculateDelay(attempt);
		}
	}
  
	/**
   * 延迟执行
   */
	private delay(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(resolve, ms);
      
			signal.addEventListener('abort', () => {
				clearTimeout(timeout);
				reject(new Error('延迟已取消'));
			});
		});
	}
  
	/**
   * 取消重试
   */
	cancelRetry(operationId: string): boolean {
		const controller = this.activeRetries.get(operationId);
		if (controller) {
			controller.abort();
			this.activeRetries.delete(operationId);
			this.log(`已取消操作 [${operationId}] 的重试`);
			return true;
		}
		return false;
	}
  
	/**
   * 取消所有重试
   */
	cancelAllRetries(): void {
		for (const [id, controller] of this.activeRetries.entries()) {
			controller.abort();
			this.log(`已取消操作 [${id}] 的重试`);
		}
		this.activeRetries.clear();
	}
  
	/**
   * 更新配置
   */
	updateConfig(config: Partial<RetryConfig>): void {
		Object.assign(this.config, config);
		this.log('重试配置已更新');
	}
  
	/**
   * 获取当前配置
   */
	getConfig(): Readonly<Required<RetryConfig>> {
		return { ...this.config };
	}
  
	/**
   * 获取活动重试数量
   */
	getActiveRetryCount(): number {
		return this.activeRetries.size;
	}
  
	/**
   * 获取重试统计信息
   */
	getRetryStatistics(): RetryStatistics {
		return { ...this.statistics };
	}
  
	/**
   * 重置统计信息
   */
	resetStatistics(): void {
		this.statistics = {
			totalRetries: 0,
			reasonDistribution: {},
			categoryDistribution: {
				[ErrorCategory.RETRYABLE]: 0,
				[ErrorCategory.NON_RETRYABLE]: 0,
				[ErrorCategory.RATE_LIMITED]: 0
			},
			successAfterRetry: 0,
			ultimateFailures: 0,
			averageRetriesPerOperation: 0
		};
	}
  
	/**
   * 生成操作ID
   */
	private generateOperationId(): string {
		return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}
  
	/**
   * 获取默认错误分类规则
   */
	private getDefaultClassificationRules(): ErrorClassificationRule[] {
		return [
			// 不可重试错误
			{
				codes: ['EACCES', 'EPERM', 'ENOENT', 'EISDIR', 'ENOTDIR'],
				messages: ['access denied', 'permission denied', 'not found', 'unauthorized', 'forbidden', 'invalid credentials'],
				statusCodes: [401, 403, 404],
				category: ErrorCategory.NON_RETRYABLE
			},
			// 限流错误
			{
				codes: ['ETOOMANYREQUESTS'],
				messages: ['too many requests', 'rate limited', 'service unavailable', 'server busy', 'quota exceeded'],
				statusCodes: [429, 503, 509],
				category: ErrorCategory.RATE_LIMITED
			},
			// 可重试错误
			{
				codes: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ENETUNREACH', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH', 'EAI_AGAIN'],
				messages: ['network error', 'timeout', 'connection', 'reset', 'socket', 'disconnected'],
				statusCodes: [500, 502, 504],
				category: ErrorCategory.RETRYABLE
			}
		];
	}
  
	/**
   * 分类错误
   */
	private classifyError(error: Error): ErrorCategory {
		const errorCode = (error as any).code || '';
		const errorMessage = error.message.toLowerCase();
		const statusCode = (error as any).response?.status;
    
		// 使用自定义分类规则
		for (const rule of this.config.errorClassificationRules) {
			// 检查错误代码
			if (rule.codes && rule.codes.some(code => errorCode === code)) {
				return rule.category;
			}
      
			// 检查错误消息
			if (rule.messages && rule.messages.some(msg => errorMessage.includes(msg.toLowerCase()))) {
				return rule.category;
			}
      
			// 检查HTTP状态码
			if (rule.statusCodes && statusCode && rule.statusCodes.includes(statusCode)) {
				return rule.category;
			}
		}
    
		// 向后兼容：使用旧的分类逻辑
		if (this.config.nonRetryableErrors.some(code => 
			errorCode === code || errorMessage.includes(code.toLowerCase())
		)) {
			return ErrorCategory.NON_RETRYABLE;
		}
    
		if (this.config.retryableErrors.some(code => 
			errorCode === code || errorMessage.includes(code.toLowerCase())
		)) {
			return ErrorCategory.RETRYABLE;
		}
    
		// 默认分类
		if (statusCode) {
			if (statusCode >= 500 && statusCode < 600) {
				return ErrorCategory.RETRYABLE;
			}
			if (statusCode >= 400 && statusCode < 500) {
				return ErrorCategory.NON_RETRYABLE;
			}
		}
    
		// 默认为可重试
		return ErrorCategory.RETRYABLE;
	}
  
	/**
   * 更新统计信息
   */
	private updateStatistics(decision: RetryDecision, isFirstAttempt: boolean): void {
		if (isFirstAttempt && decision.shouldRetry) {
			// 只有在第一次尝试失败后开始重试时才统计
			this.statistics.totalRetries++;
		}
    
		// 统计原因分布
		const reason = decision.reason;
		this.statistics.reasonDistribution[reason] = (this.statistics.reasonDistribution[reason] || 0) + 1;
    
		// 统计类别分布
		this.statistics.categoryDistribution[decision.errorCategory]++;
	}
  
	/**
   * 更新平均重试次数
   */
	private updateAverageRetries(): void {
		const totalOperations = this.statistics.successAfterRetry + this.statistics.ultimateFailures;
		if (totalOperations > 0) {
			this.statistics.averageRetriesPerOperation = this.statistics.totalRetries / totalOperations;
		}
	}
  
	/**
   * 记录日志
   */
	private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
		if (!this.config.enableLogging) {return;}
    
		const prefix = '[RetryManager]';
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
