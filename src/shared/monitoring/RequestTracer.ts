/**
 * 请求追踪器 - 实现分布式追踪功能
 * 生成和管理traceId，贯穿整个请求链路
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';

/**
 * 追踪上下文接口
 */
export interface TraceContext {
  /** 追踪ID - 贯穿整个请求链路 */
  traceId: string;
  /** 跨度ID - 当前操作的唯一标识 */
  spanId: string;
  /** 父跨度ID - 用于构建调用链 */
  parentSpanId?: string;
  /** 请求ID - 与现有系统兼容 */
  requestId?: string;
  /** 操作名称 */
  operationName: string;
  /** 开始时间戳 */
  startTime: number;
  /** 结束时间戳 */
  endTime?: number;
  /** 标签 - 用于存储额外信息 */
  tags: Record<string, any>;
  /** 事件日志 */
  logs: TraceLog[];
  /** 子跨度 */
  children: TraceContext[];
}

/**
 * 追踪日志接口
 */
export interface TraceLog {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  fields?: Record<string, any>;
}

/**
 * 追踪配置
 */
export interface RequestTracerConfig {
  /** 是否启用追踪 */
  enabled?: boolean;
  /** 是否自动注入到日志 */
  autoInjectToLogs?: boolean;
  /** 是否收集调用栈 */
  collectStackTrace?: boolean;
  /** 追踪数据保留时间（毫秒） */
  retentionTime?: number;
  /** 最大追踪数量 */
  maxTraces?: number;
}

/**
 * 请求追踪器类
 */
export class RequestTracer extends EventEmitter {
	private config: Required<RequestTracerConfig>;
	private activeTraces: Map<string, TraceContext> = new Map();
	private completedTraces: Map<string, TraceContext> = new Map();
	private currentContext: TraceContext | null = null;
	private logger: Logger;
	private cleanupTimer?: NodeJS.Timeout;
  
	constructor(config: RequestTracerConfig = {}) {
		super();
    
		this.config = {
			enabled: config.enabled ?? true,
			autoInjectToLogs: config.autoInjectToLogs ?? true,
			collectStackTrace: config.collectStackTrace ?? false,
			retentionTime: config.retentionTime ?? 300000, // 默认5分钟
			maxTraces: config.maxTraces ?? 1000
		};
    
		this.logger = new Logger('RequestTracer');
    
		// 启动清理定时器
		if (this.config.enabled) {
			this.startCleanupTimer();
		}
	}
  
	/**
   * 开始新的追踪
   */
	startTrace(
		operationName: string,
		requestId?: string,
		parentContext?: TraceContext
	): TraceContext {
		if (!this.config.enabled) {
			return this.createDummyContext(operationName);
		}
    
		const traceId = parentContext?.traceId || this.generateTraceId();
		const spanId = this.generateSpanId();
    
		const context: TraceContext = {
			traceId,
			spanId,
			parentSpanId: parentContext?.spanId,
			requestId: requestId || this.generateRequestId(),
			operationName,
			startTime: Date.now(),
			tags: {},
			logs: [],
			children: []
		};
    
		// 添加到活动追踪
		this.activeTraces.set(spanId, context);
    
		// 如果有父上下文，添加到父的子跨度列表
		if (parentContext) {
			parentContext.children.push(context);
		}
    
		// 设置当前上下文
		this.currentContext = context;
    
		// 记录日志
		this.logger.debug(`追踪开始: ${operationName} [trace=${traceId}, span=${spanId}]`);
    
		// 触发事件
		this.emit('trace-started', context);
    
		return context;
	}
  
	/**
   * 创建子追踪
   */
	startChildTrace(
		operationName: string,
		parentContext?: TraceContext
	): TraceContext {
		const parent = parentContext || this.currentContext;
		if (!parent) {
			return this.startTrace(operationName);
		}
    
		return this.startTrace(operationName, parent.requestId, parent);
	}
  
	/**
   * 结束追踪
   */
	endTrace(context: TraceContext, error?: Error): void {
		if (!this.config.enabled || !context.spanId) {
			return;
		}
    
		context.endTime = Date.now();
    
		// 如果有错误，记录到日志
		if (error) {
			this.addLog(context, 'error', error.message, {
				stack: this.config.collectStackTrace ? error.stack : undefined
			});
		}
    
		// 从活动追踪移到完成追踪
		if (this.activeTraces.has(context.spanId)) {
			this.activeTraces.delete(context.spanId);
			this.completedTraces.set(context.spanId, context);
      
			// 限制完成追踪的数量
			this.pruneCompletedTraces();
		}
    
		// 计算耗时
		const duration = context.endTime - context.startTime;
    
		// 记录日志
		if (error) {
			this.logger.error(`追踪失败: ${context.operationName} [trace=${context.traceId}, span=${context.spanId}] - ${duration}ms - ${error.message}`);
		} else {
			this.logger.debug(`追踪完成: ${context.operationName} [trace=${context.traceId}, span=${context.spanId}] - ${duration}ms`);
		}
    
		// 如果是当前上下文，清除它
		if (this.currentContext === context) {
			this.currentContext = null;
		}
    
		// 触发事件
		this.emit('trace-ended', context);
	}
  
	/**
   * 使用追踪包装异步操作
   */
	async traceAsync<T>(
		operationName: string,
		operation: (context: TraceContext) => Promise<T>,
		parentContext?: TraceContext
	): Promise<T> {
		const context = parentContext 
			? this.startChildTrace(operationName, parentContext)
			: this.startTrace(operationName);
    
		try {
			const result = await operation(context);
			this.endTrace(context);
			return result;
		} catch (error) {
			this.endTrace(context, error as Error);
			throw error;
		}
	}
  
	/**
   * 使用追踪包装同步操作
   */
	traceSync<T>(
		operationName: string,
		operation: (context: TraceContext) => T,
		parentContext?: TraceContext
	): T {
		const context = parentContext 
			? this.startChildTrace(operationName, parentContext)
			: this.startTrace(operationName);
    
		try {
			const result = operation(context);
			this.endTrace(context);
			return result;
		} catch (error) {
			this.endTrace(context, error as Error);
			throw error;
		}
	}
  
	/**
   * 添加标签到追踪上下文
   */
	addTag(context: TraceContext, key: string, value: any): void {
		if (!this.config.enabled || !context) {
			return;
		}
    
		context.tags[key] = value;
	}
  
	/**
   * 添加日志到追踪上下文
   */
	addLog(
		context: TraceContext,
		level: 'debug' | 'info' | 'warn' | 'error',
		message: string,
		fields?: Record<string, any>
	): void {
		if (!this.config.enabled || !context) {
			return;
		}
    
		context.logs.push({
			timestamp: Date.now(),
			level,
			message,
			fields
		});
	}
  
	/**
   * 获取当前追踪上下文
   */
	getCurrentContext(): TraceContext | null {
		return this.currentContext;
	}
  
	/**
   * 设置当前追踪上下文
   */
	setCurrentContext(context: TraceContext | null): void {
		this.currentContext = context;
	}
  
	/**
   * 从追踪ID获取上下文
   */
	getContextByTraceId(traceId: string): TraceContext[] {
		const contexts: TraceContext[] = [];
    
		// 搜索活动追踪
		this.activeTraces.forEach(context => {
			if (context.traceId === traceId) {
				contexts.push(context);
			}
		});
    
		// 搜索完成追踪
		this.completedTraces.forEach(context => {
			if (context.traceId === traceId) {
				contexts.push(context);
			}
		});
    
		return contexts;
	}
  
	/**
   * 从请求ID获取上下文
   */
	getContextByRequestId(requestId: string): TraceContext | null {
		// 搜索活动追踪
		for (const context of this.activeTraces.values()) {
			if (context.requestId === requestId) {
				return context;
			}
		}
    
		// 搜索完成追踪
		for (const context of this.completedTraces.values()) {
			if (context.requestId === requestId) {
				return context;
			}
		}
    
		return null;
	}
  
	/**
   * 注入追踪信息到对象
   */
	inject(target: any, context?: TraceContext): any {
		const ctx = context || this.currentContext;
		if (!ctx) {
			return target;
		}
    
		if (typeof target === 'object' && target !== null) {
			target.traceId = ctx.traceId;
			target.spanId = ctx.spanId;
			target.requestId = ctx.requestId;
		}
    
		return target;
	}
  
	/**
   * 从对象提取追踪信息
   */
	extract(source: any): Partial<TraceContext> | null {
		if (!source || typeof source !== 'object') {
			return null;
		}
    
		const { traceId, spanId, requestId } = source;
		if (!traceId && !spanId && !requestId) {
			return null;
		}
    
		return {
			traceId,
			spanId,
			requestId
		};
	}
  
	/**
   * 生成追踪报告
   */
	generateReport(traceId: string): string {
		const contexts = this.getContextByTraceId(traceId);
		if (contexts.length === 0) {
			return '未找到追踪记录';
		}
    
		const report: string[] = [`=== 追踪报告: ${traceId} ===`];
    
		// 构建追踪树
		const rootContexts = contexts.filter(c => !c.parentSpanId);
		rootContexts.forEach(root => {
			this.appendContextToReport(root, report, 0);
		});
    
		return report.join('\n');
	}
  
	/**
   * 清理过期追踪
   */
	cleanup(): void {
		const now = Date.now();
		const expiredSpanIds: string[] = [];
    
		this.completedTraces.forEach((context, spanId) => {
			if (context.endTime && now - context.endTime > this.config.retentionTime) {
				expiredSpanIds.push(spanId);
			}
		});
    
		expiredSpanIds.forEach(spanId => {
			this.completedTraces.delete(spanId);
		});
    
		if (expiredSpanIds.length > 0) {
			this.logger.debug(`清理了 ${expiredSpanIds.length} 个过期追踪`);
		}
	}
  
	/**
   * 销毁追踪器
   */
	destroy(): void {
		this.stopCleanupTimer();
		this.activeTraces.clear();
		this.completedTraces.clear();
		this.currentContext = null;
		this.removeAllListeners();
	}
  
	// 私有方法
  
	private generateTraceId(): string {
		return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
	}
  
	private generateSpanId(): string {
		return `span_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}
  
	private generateRequestId(): string {
		return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}
  
	private createDummyContext(operationName: string): TraceContext {
		return {
			traceId: '',
			spanId: '',
			operationName,
			startTime: Date.now(),
			tags: {},
			logs: [],
			children: []
		};
	}
  
	private pruneCompletedTraces(): void {
		if (this.completedTraces.size <= this.config.maxTraces) {
			return;
		}
    
		// 按结束时间排序，删除最旧的
		const sorted = Array.from(this.completedTraces.entries())
			.sort((a, b) => (a[1].endTime || 0) - (b[1].endTime || 0));
    
		const toDelete = sorted.slice(0, sorted.length - this.config.maxTraces);
		toDelete.forEach(([spanId]) => {
			this.completedTraces.delete(spanId);
		});
	}
  
	private appendContextToReport(context: TraceContext, report: string[], depth: number): void {
		const indent = '  '.repeat(depth);
		const duration = context.endTime ? context.endTime - context.startTime : 0;
    
		report.push(`${indent}├─ ${context.operationName} [${context.spanId}] - ${duration}ms`);
    
		// 添加标签
		if (Object.keys(context.tags).length > 0) {
			report.push(`${indent}│  标签: ${JSON.stringify(context.tags)}`);
		}
    
		// 添加日志
		context.logs.forEach(log => {
			const logTime = log.timestamp - context.startTime;
			report.push(`${indent}│  [${logTime}ms] ${log.level}: ${log.message}`);
		});
    
		// 递归添加子跨度
		context.children.forEach(child => {
			this.appendContextToReport(child, report, depth + 1);
		});
	}
  
	private startCleanupTimer(): void {
		this.cleanupTimer = setInterval(() => {
			this.cleanup();
		}, 60000); // 每分钟清理一次
	}
  
	private stopCleanupTimer(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}
	}
}

// 导出全局单例（可选）
export const globalRequestTracer = new RequestTracer({
	enabled: true,
	autoInjectToLogs: true,
	collectStackTrace: false,
	retentionTime: 300000,
	maxTraces: 1000
});