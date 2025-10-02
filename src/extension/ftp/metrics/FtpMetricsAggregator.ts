/**
 * FTP 指标聚合器
 * 统一收集和暴露所有 FTP 相关的指标数据
 */

import { FtpClient } from '../FtpClient';
import { CompatibleFtpClient } from '../CompatibleFtpClient';
import { FtpConnectionPool } from '../connection/FtpConnectionPool';
import { ConcurrencyManager } from '../../../shared/monitoring/ConcurrencyManager';
import { FtpMetrics } from '../FtpMetrics';

/**
 * 聚合的指标接口
 */
interface AggregatedFtpMetrics {
  // 基础指标
  basic: FtpMetrics;
  
  // 连接池指标
  connectionPool: {
    [key: string]: {
      total: number;
      inUse: number;
      idle: number;
      queued?: number;
      errorRate?: number;
      avgQueueTime?: number;
      maxConnections?: number;
    };
  };
  
  // 并发管理指标
  concurrency: {
    runningCount: number;
    pendingCount: number;
    completedCount: number;
    failedCount: number;
    cancelledCount: number;
    timeoutCount: number;
    totalProcessed: number;
    averageWaitTime: number;
    averageExecutionTime: number;
  };
  
  // 兼容客户端指标（如果使用）
  compatibility?: {
    connectionTime: number;
    totalTransfers: number;
    optimizationLayerUsage: Record<string, number>;
    averageTransferSpeed: number;
    errorRate: number;
    serverCapabilities?: any;
    optimizationStats: any;
    extendedStats: any;
  };
  
  // 系统级别指标
  system: {
    uptime: number;
    timestamp: number;
    memoryUsage?: {
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
  };
}

/**
 * FTP 指标聚合器类
 */
export class FtpMetricsAggregator {
	private basicClient?: FtpClient;
	private compatibleClient?: CompatibleFtpClient;
	private connectionPool?: FtpConnectionPool;
	private concurrencyManager?: ConcurrencyManager;
	private startTime: number;

	constructor() {
		this.startTime = Date.now();
	}

	/**
   * 注册基础 FTP 客户端
   */
	registerBasicClient(client: FtpClient): void {
		this.basicClient = client;
	}

	/**
   * 注册兼容 FTP 客户端
   */
	registerCompatibleClient(client: CompatibleFtpClient): void {
		this.compatibleClient = client;
	}

	/**
   * 注册连接池
   */
	registerConnectionPool(pool: FtpConnectionPool): void {
		this.connectionPool = pool;
	}

	/**
   * 注册并发管理器
   */
	registerConcurrencyManager(manager: ConcurrencyManager): void {
		this.concurrencyManager = manager;
	}

	/**
   * 获取聚合的指标数据
   */
	getAggregatedMetrics(): AggregatedFtpMetrics {
		const now = Date.now();
    
		// 收集基础指标
		let basicMetrics: FtpMetrics;
		if (this.basicClient) {
			basicMetrics = this.basicClient.getMetrics();
		} else {
			// 默认空指标
			basicMetrics = {
				connectionPool: {
					hitRate: 0,
					activeConnections: 0,
					totalConnections: 0,
					queueLength: 0,
					avgQueueTime: 0
				},
				transfer: {
					totalTransfers: 0,
					successCount: 0,
					errorCount: 0,
					errorRate: 0,
					bytesTransferred: 0,
					avgSpeed: 0,
					p50Latency: 0,
					p95Latency: 0,
					p99Latency: 0
				},
				cache: {
					hitRate: 0,
					hits: 0,
					misses: 0,
					evictions: 0,
					size: 0
				},
				compression: {
					enabled: false,
					totalSaved: 0,
					avgRatio: 0,
					compressedTransfers: 0
				},
				retry: {
					totalRetries: 0,
					reasonDistribution: {}
				},
				timestamp: now,
				uptime: now - this.startTime
			};
		}

		// 收集连接池指标
		const connectionPoolStats = this.connectionPool 
			? this.connectionPool.getStats() 
			: {};

		// 收集并发管理器指标
		const concurrencyStats = this.concurrencyManager 
			? this.concurrencyManager.getStatistics()
			: {
				runningCount: 0,
				pendingCount: 0,
				completedCount: 0,
				failedCount: 0,
				cancelledCount: 0,
				timeoutCount: 0,
				totalProcessed: 0,
				averageWaitTime: 0,
				averageExecutionTime: 0
			};

		// 收集兼容客户端指标
		const compatibilityStats = this.compatibleClient 
			? this.compatibleClient.getStats()
			: undefined;

		// 收集系统指标
		const memoryUsage = process.memoryUsage?.();

		return {
			basic: basicMetrics,
			connectionPool: connectionPoolStats,
			concurrency: concurrencyStats,
			compatibility: compatibilityStats,
			system: {
				uptime: now - this.startTime,
				timestamp: now,
				memoryUsage: memoryUsage ? {
					heapUsed: memoryUsage.heapUsed,
					heapTotal: memoryUsage.heapTotal,
					external: memoryUsage.external
				} : undefined
			}
		};
	}

	/**
   * 获取性能摘要
   */
	getPerformanceSummary(): {
    overall: {
      status: 'healthy' | 'warning' | 'critical';
      score: number;
      issues: string[];
    };
    transfer: {
      throughput: number;  // bytes/sec
      successRate: number; // 0-1
      avgLatency: number;  // ms
    };
    connections: {
      utilization: number; // 0-1
      avgQueueTime: number; // ms
      errorRate: number;   // 0-1
    };
    resources: {
      memoryUsage: number; // MB
      concurrencyRate: number; // 0-1
    };
    } {
		const metrics = this.getAggregatedMetrics();
    
		// 计算传输性能
		const transferThroughput = metrics.basic.transfer.avgSpeed || 0;
		const transferSuccessRate = metrics.basic.transfer.totalTransfers > 0 
			? metrics.basic.transfer.successCount / metrics.basic.transfer.totalTransfers 
			: 1;
		const avgLatency = metrics.basic.transfer.p50Latency || 0;

		// 计算连接性能
		let connectionUtilization = 0;
		let avgQueueTime = 0;
		let connectionErrorRate = 0;

		const poolStats = Object.values(metrics.connectionPool);
		if (poolStats.length > 0) {
			const totalConnections = poolStats.reduce((sum, stat) => sum + stat.total, 0);
			const inUseConnections = poolStats.reduce((sum, stat) => sum + stat.inUse, 0);
			connectionUtilization = totalConnections > 0 ? inUseConnections / totalConnections : 0;
      
			avgQueueTime = poolStats.reduce((sum, stat) => sum + (stat.avgQueueTime || 0), 0) / poolStats.length;
			connectionErrorRate = poolStats.reduce((sum, stat) => sum + (stat.errorRate || 0), 0) / poolStats.length;
		}

		// 计算资源使用
		const memoryUsageMB = metrics.system.memoryUsage 
			? metrics.system.memoryUsage.heapUsed / 1024 / 1024 
			: 0;
		const concurrencyRate = metrics.concurrency.totalProcessed > 0 
			? metrics.concurrency.runningCount / (metrics.concurrency.runningCount + metrics.concurrency.pendingCount + 1)
			: 0;

		// 评估整体健康状况
		const issues: string[] = [];
		let score = 100;

		if (transferSuccessRate < 0.95) {
			issues.push(`传输成功率过低: ${(transferSuccessRate * 100).toFixed(1)}%`);
			score -= 20;
		}

		if (connectionErrorRate > 0.05) {
			issues.push(`连接错误率过高: ${(connectionErrorRate * 100).toFixed(1)}%`);
			score -= 15;
		}

		if (avgQueueTime > 5000) {
			issues.push(`平均排队时间过长: ${avgQueueTime.toFixed(0)}ms`);
			score -= 10;
		}

		if (memoryUsageMB > 200) {
			issues.push(`内存使用过高: ${memoryUsageMB.toFixed(1)}MB`);
			score -= 10;
		}

		if (avgLatency > 2000) {
			issues.push(`平均延迟过高: ${avgLatency.toFixed(0)}ms`);
			score -= 10;
		}

		let status: 'healthy' | 'warning' | 'critical';
		if (score >= 90) {
			status = 'healthy';
		} else if (score >= 70) {
			status = 'warning';
		} else {
			status = 'critical';
		}

		return {
			overall: {
				status,
				score: Math.max(0, score),
				issues
			},
			transfer: {
				throughput: transferThroughput,
				successRate: transferSuccessRate,
				avgLatency
			},
			connections: {
				utilization: connectionUtilization,
				avgQueueTime,
				errorRate: connectionErrorRate
			},
			resources: {
				memoryUsage: memoryUsageMB,
				concurrencyRate
			}
		};
	}

	/**
   * 重置所有指标
   */
	reset(): void {
		this.startTime = Date.now();
    
		if (this.basicClient) {
			this.basicClient.resetMetrics();
		}
    
		if (this.concurrencyManager) {
			this.concurrencyManager.resetStatistics();
		}
	}

	/**
   * 输出人类可读的指标报告
   */
	generateReport(): string {
		const metrics = this.getAggregatedMetrics();
		const summary = this.getPerformanceSummary();
    
		const lines: string[] = [];
		lines.push('=== FTP 系统指标报告 ===');
		lines.push(`时间: ${new Date(metrics.system.timestamp).toLocaleString()}`);
		lines.push(`运行时间: ${(metrics.system.uptime / 1000 / 60).toFixed(1)} 分钟`);
		lines.push('');
    
		lines.push('## 整体状态');
		lines.push(`状态: ${summary.overall.status.toUpperCase()}`);
		lines.push(`评分: ${summary.overall.score}/100`);
		if (summary.overall.issues.length > 0) {
			lines.push('问题:');
			summary.overall.issues.forEach(issue => lines.push(`  - ${issue}`));
		}
		lines.push('');
    
		lines.push('## 传输性能');
		lines.push(`吞吐量: ${(summary.transfer.throughput / 1024).toFixed(1)} KB/s`);
		lines.push(`成功率: ${(summary.transfer.successRate * 100).toFixed(1)}%`);
		lines.push(`平均延迟: ${summary.transfer.avgLatency.toFixed(0)}ms`);
		lines.push(`P95延迟: ${metrics.basic.transfer.p95Latency.toFixed(0)}ms`);
		lines.push(`总传输: ${metrics.basic.transfer.totalTransfers}`);
		lines.push(`总字节: ${(metrics.basic.transfer.bytesTransferred / 1024 / 1024).toFixed(1)} MB`);
		lines.push('');
    
		lines.push('## 连接池状态');
		Object.entries(metrics.connectionPool).forEach(([key, stats]) => {
			lines.push(`${key}:`);
			lines.push(`  总连接: ${stats.total}, 使用中: ${stats.inUse}, 空闲: ${stats.idle}`);
			if (stats.queued !== undefined) {
				lines.push(`  排队: ${stats.queued}, 平均等待: ${(stats.avgQueueTime || 0).toFixed(0)}ms`);
			}
			if (stats.errorRate !== undefined) {
				lines.push(`  错误率: ${(stats.errorRate * 100).toFixed(1)}%`);
			}
		});
		lines.push('');
    
		lines.push('## 并发控制');
		lines.push(`运行中: ${metrics.concurrency.runningCount}`);
		lines.push(`待处理: ${metrics.concurrency.pendingCount}`);
		lines.push(`已完成: ${metrics.concurrency.completedCount}`);
		lines.push(`失败: ${metrics.concurrency.failedCount}`);
		lines.push(`平均等待: ${metrics.concurrency.averageWaitTime.toFixed(0)}ms`);
		lines.push(`平均执行: ${metrics.concurrency.averageExecutionTime.toFixed(0)}ms`);
		lines.push('');
    
		if (metrics.system.memoryUsage) {
			lines.push('## 资源使用');
			lines.push(`内存使用: ${(metrics.system.memoryUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`);
			lines.push(`内存总量: ${(metrics.system.memoryUsage.heapTotal / 1024 / 1024).toFixed(1)} MB`);
			lines.push('');
		}
    
		return lines.join('\n');
	}
}
