/**
 * 性能监控器 - 收集和分析操作性能指标
 * 支持p50/p95计算、成功率统计和性能日志输出
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';

/**
 * 操作类型枚举
 */
export enum OperationType {
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  LIST = 'list',
  UPLOAD = 'upload',
  DOWNLOAD = 'download',
  DELETE = 'delete',
  RENAME = 'rename',
  CREATE_DIR = 'create_dir',
  CUSTOM = 'custom'
}

/**
 * 性能指标接口
 */
export interface PerformanceMetrics {
  operationType: OperationType;
  operationName: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * 统计数据接口
 */
export interface PerformanceStatistics {
  operationType: OperationType;
  totalCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * 性能监控配置
 */
export interface PerformanceMonitorConfig {
  /** 是否启用监控 */
  enabled?: boolean;
  /** 统计窗口大小（保留最近N条记录） */
  windowSize?: number;
  /** 是否自动输出日志 */
  autoLog?: boolean;
  /** 日志输出间隔（毫秒） */
  logInterval?: number;
  /** 是否收集详细元数据 */
  collectMetadata?: boolean;
}

/**
 * 性能监控器类
 */
export class PerformanceMonitor extends EventEmitter {
	private config: Required<PerformanceMonitorConfig>;
	private metrics: Map<OperationType, PerformanceMetrics[]> = new Map();
	private activeOperations: Map<string, { type: OperationType; name: string; startTime: number; metadata?: Record<string, any> }> = new Map();
	private logger: Logger;
	private logTimer?: NodeJS.Timeout;
  
	constructor(config: PerformanceMonitorConfig = {}) {
		super();
    
		this.config = {
			enabled: config.enabled ?? true,
			windowSize: config.windowSize ?? 1000,
			autoLog: config.autoLog ?? true,
			logInterval: config.logInterval ?? 60000, // 默认每分钟输出一次
			collectMetadata: config.collectMetadata ?? true
		};
    
		this.logger = new Logger('PerformanceMonitor');
    
		// 初始化各操作类型的数组
		Object.values(OperationType).forEach(type => {
			this.metrics.set(type as OperationType, []);
		});
    
		// 启动自动日志输出
		if (this.config.autoLog && this.config.enabled) {
			this.startAutoLogging();
		}
	}
  
	/**
   * 开始记录操作
   */
	startOperation(
		operationType: OperationType,
		operationName: string,
		operationId?: string,
		metadata?: Record<string, any>
	): string {
		if (!this.config.enabled) {
			return operationId || this.generateOperationId();
		}
    
		const id = operationId || this.generateOperationId();
		const startTime = Date.now();
    
		this.activeOperations.set(id, {
			type: operationType,
			name: operationName,
			startTime,
			metadata: this.config.collectMetadata ? metadata : undefined
		});
    
		this.logger.debug(`操作开始: ${operationName} [${id}]`);
    
		return id;
	}
  
	/**
   * 结束记录操作
   */
	endOperation(operationId: string, success = true, error?: string): void {
		if (!this.config.enabled) {
			return;
		}
    
		const operation = this.activeOperations.get(operationId);
		if (!operation) {
			this.logger.warn(`未找到操作记录: ${operationId}`);
			return;
		}
    
		const endTime = Date.now();
		const duration = endTime - operation.startTime;
    
		const metric: PerformanceMetrics = {
			operationType: operation.type,
			operationName: operation.name,
			startTime: operation.startTime,
			endTime,
			duration,
			success,
			error,
			metadata: operation.metadata
		};
    
		// 添加到指标列表
		this.addMetric(metric);
    
		// 清理活动操作
		this.activeOperations.delete(operationId);
    
		// 记录日志
		if (success) {
			this.logger.debug(`操作完成: ${operation.name} [${operationId}] - ${duration}ms`);
		} else {
			this.logger.warn(`操作失败: ${operation.name} [${operationId}] - ${duration}ms - ${error}`);
		}
    
		// 触发事件
		this.emit('operation-completed', metric);
	}
  
	/**
   * 包装异步操作并自动记录性能
   */
	async measureAsync<T>(
		operationType: OperationType,
		operationName: string,
		operation: () => Promise<T>,
		metadata?: Record<string, any>
	): Promise<T> {
		const operationId = this.startOperation(operationType, operationName, undefined, metadata);
    
		try {
			const result = await operation();
			this.endOperation(operationId, true);
			return result;
		} catch (error) {
			this.endOperation(operationId, false, error instanceof Error ? error.message : String(error));
			throw error;
		}
	}
  
	/**
   * 包装同步操作并自动记录性能
   */
	measureSync<T>(
		operationType: OperationType,
		operationName: string,
		operation: () => T,
		metadata?: Record<string, any>
	): T {
		const operationId = this.startOperation(operationType, operationName, undefined, metadata);
    
		try {
			const result = operation();
			this.endOperation(operationId, true);
			return result;
		} catch (error) {
			this.endOperation(operationId, false, error instanceof Error ? error.message : String(error));
			throw error;
		}
	}
  
	/**
   * 获取操作统计数据
   */
	getStatistics(operationType: OperationType): PerformanceStatistics | null {
		const metrics = this.metrics.get(operationType);
		if (!metrics || metrics.length === 0) {
			return null;
		}
    
		const successMetrics = metrics.filter(m => m.success);
		const failureMetrics = metrics.filter(m => !m.success);
    
		// 计算成功率
		const totalCount = metrics.length;
		const successCount = successMetrics.length;
		const failureCount = failureMetrics.length;
		const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 0;
    
		// 计算耗时统计（仅成功的操作）
		if (successMetrics.length === 0) {
			return {
				operationType,
				totalCount,
				successCount,
				failureCount,
				successRate,
				averageDuration: 0,
				minDuration: 0,
				maxDuration: 0,
				p50: 0,
				p95: 0,
				p99: 0
			};
		}
    
		const durations = successMetrics.map(m => m.duration).sort((a, b) => a - b);
		const sum = durations.reduce((acc, d) => acc + d, 0);
    
		return {
			operationType,
			totalCount,
			successCount,
			failureCount,
			successRate,
			averageDuration: sum / durations.length,
			minDuration: durations[0],
			maxDuration: durations[durations.length - 1],
			p50: this.calculatePercentile(durations, 50),
			p95: this.calculatePercentile(durations, 95),
			p99: this.calculatePercentile(durations, 99)
		};
	}
  
	/**
   * 获取所有操作的统计数据
   */
	getAllStatistics(): Map<OperationType, PerformanceStatistics> {
		const stats = new Map<OperationType, PerformanceStatistics>();
    
		Object.values(OperationType).forEach(type => {
			const stat = this.getStatistics(type as OperationType);
			if (stat) {
				stats.set(type as OperationType, stat);
			}
		});
    
		return stats;
	}
  
	/**
   * 输出性能报告
   */
	generateReport(): string {
		const stats = this.getAllStatistics();
		const report: string[] = ['=== 性能监控报告 ==='];
    
		stats.forEach((stat, type) => {
			report.push(`\n[${type}]`);
			report.push(`  总次数: ${stat.totalCount}`);
			report.push(`  成功率: ${stat.successRate.toFixed(2)}% (成功: ${stat.successCount}, 失败: ${stat.failureCount})`);
      
			if (stat.successCount > 0) {
				report.push(`  平均耗时: ${stat.averageDuration.toFixed(2)}ms`);
				report.push(`  最小/最大: ${stat.minDuration}ms / ${stat.maxDuration}ms`);
				report.push(`  P50: ${stat.p50.toFixed(2)}ms`);
				report.push(`  P95: ${stat.p95.toFixed(2)}ms`);
				report.push(`  P99: ${stat.p99.toFixed(2)}ms`);
			}
		});
    
		return report.join('\n');
	}
  
	/**
   * 清理指标数据
   */
	clearMetrics(operationType?: OperationType): void {
		if (operationType) {
			this.metrics.set(operationType, []);
		} else {
			this.metrics.forEach((values, type) => {
				this.metrics.set(type, []);
			});
		}
	}
  
	/**
   * 启用/禁用监控
   */
	setEnabled(enabled: boolean): void {
		this.config.enabled = enabled;
    
		if (enabled && this.config.autoLog && !this.logTimer) {
			this.startAutoLogging();
		} else if (!enabled && this.logTimer) {
			this.stopAutoLogging();
		}
	}
  
	/**
   * 销毁监控器
   */
	destroy(): void {
		this.stopAutoLogging();
		this.clearMetrics();
		this.activeOperations.clear();
		this.removeAllListeners();
	}
  
	// 私有方法
  
	private addMetric(metric: PerformanceMetrics): void {
		const metrics = this.metrics.get(metric.operationType) || [];
		metrics.push(metric);
    
		// 保持窗口大小
		if (metrics.length > this.config.windowSize) {
			metrics.shift();
		}
    
		this.metrics.set(metric.operationType, metrics);
	}
  
	private calculatePercentile(sortedValues: number[], percentile: number): number {
		if (sortedValues.length === 0) {return 0;}
    
		const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
		return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
	}
  
	private generateOperationId(): string {
		return `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}
  
	private startAutoLogging(): void {
		this.logTimer = setInterval(() => {
			const report = this.generateReport();
			this.logger.info(`\n${report}`);
		}, this.config.logInterval);
	}
  
	private stopAutoLogging(): void {
		if (this.logTimer) {
			clearInterval(this.logTimer);
			this.logTimer = undefined;
		}
	}
}

// 导出全局单例（可选）
export const globalPerformanceMonitor = new PerformanceMonitor({
	enabled: true,
	windowSize: 1000,
	autoLog: true,
	logInterval: 60000
});
