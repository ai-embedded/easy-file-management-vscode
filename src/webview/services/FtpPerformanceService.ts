/**
 * FTP 性能监控服务
 * 负责收集、分析和管理 FTP 传输性能数据
 */

export interface PerformanceMetrics {
  timestamp: number
  transferSpeed: number // bytes/second
  activeConnections: number
  maxConnections: number
  successRate: number
  totalTransfers: number
  totalDataTransferred: number
  responseTime: number
  cpuUsage: number
  memoryUsage: number
}

export interface ConnectionPoolMetrics {
  poolSize: number
  idleConnections: number
  activeConnections: number
  waitingQueue: number
  reuseCount: number
  totalCreated: number
  totalDestroyed: number
  averageLifetime: number
}

export interface OptimizationMetrics {
  standardImprovement: number // percentage
  extendedImprovement: number // percentage
  connectionReuseSavings: number // milliseconds
  cacheHitRate: number // percentage
  compressionSavings: number // bytes
  retrySuccessRate: number // percentage
  averageRetryCount: number
}

export interface ErrorMetrics {
  networkErrors: number
  timeoutErrors: number
  authErrors: number
  protocolErrors: number
  retrySuccesses: number
  retryFailures: number
  maxRetries: number
  totalErrors: number
}

export interface ServerMetrics {
  responseTime: number
  serverLoad: number
  supportedFeatures: string[]
  detectionReliability: number
  protocolVersion: string
  serverSoftware: string
  maxConcurrentConnections: number
  averageCommandTime: number
}

export interface PerformanceEvent {
  id: string
  timestamp: number
  type: 'transfer' | 'connection' | 'error' | 'optimization'
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: any
}

export interface PerformanceReport {
  generatedAt: number
  period: {
    start: number
    end: number
  }
  summary: {
    totalTransfers: number
    successRate: number
    averageSpeed: number
    totalDataTransferred: number
    peakSpeed: number
    optimizationGains: number
  }
  metrics: {
    performance: PerformanceMetrics[]
    connectionPool: ConnectionPoolMetrics
    optimization: OptimizationMetrics
    errors: ErrorMetrics
    server: ServerMetrics
  }
  trends: {
    speedTrend: number[]
    connectionTrend: number[]
    errorTrend: number[]
  }
  recommendations: string[]
}

export class FtpPerformanceService {
	private static instance: FtpPerformanceService;
	private isMonitoring = false;
	private metrics: PerformanceMetrics[] = [];
	private events: PerformanceEvent[] = [];
	private monitoringInterval: NodeJS.Timeout | null = null;
	private eventListeners: Map<string, Function[]> = new Map();
	private maxMetricsHistory = 1000;
	private maxEventsHistory = 500;

	static getInstance(): FtpPerformanceService {
		if (!this.instance) {
			this.instance = new FtpPerformanceService();
		}
		return this.instance;
	}

	/**
   * 开始性能监控
   */
	startMonitoring(interval = 2000): void {
		if (this.isMonitoring) {return;}

		this.isMonitoring = true;
		this.monitoringInterval = setInterval(() => {
			this.collectMetrics();
		}, interval);

		this.addEvent({
			id: this.generateId(),
			timestamp: Date.now(),
			type: 'optimization',
			level: 'info',
			message: '性能监控已启动'
		});
	}

	/**
   * 停止性能监控
   */
	stopMonitoring(): void {
		if (!this.isMonitoring) {return;}

		this.isMonitoring = false;
		if (this.monitoringInterval) {
			clearInterval(this.monitoringInterval);
			this.monitoringInterval = null;
		}

		this.addEvent({
			id: this.generateId(),
			timestamp: Date.now(),
			type: 'optimization',
			level: 'info',
			message: '性能监控已停止'
		});
	}

	/**
   * 收集当前性能指标
   */
	private async collectMetrics(): Promise<void> {
		try {
			const metrics: PerformanceMetrics = await this.gatherCurrentMetrics();
			this.addMetric(metrics);
      
			// 触发监控更新事件
			this.emit('metricsUpdated', metrics);
      
		} catch (error) {
			this.addEvent({
				id: this.generateId(),
				timestamp: Date.now(),
				type: 'error',
				level: 'error',
				message: `性能数据收集失败: ${error.message}`,
				data: { error }
			});
		}
	}

	/**
   * 获取当前性能指标（通过与后端通信）
   */
	private async gatherCurrentMetrics(): Promise<PerformanceMetrics> {
		// 模拟性能数据收集
		// 在实际环境中，这里会调用后端API获取真实数据
		return {
			timestamp: Date.now(),
			transferSpeed: Math.random() * 10 * 1024 * 1024, // 0-10MB/s
			activeConnections: Math.floor(Math.random() * 5),
			maxConnections: 5,
			successRate: 95 + Math.random() * 4, // 95-99%
			totalTransfers: 100 + Math.floor(Math.random() * 50),
			totalDataTransferred: Math.random() * 1024 * 1024 * 1024, // 0-1GB
			responseTime: 50 + Math.random() * 200, // 50-250ms
			cpuUsage: Math.random() * 100,
			memoryUsage: 30 + Math.random() * 40 // 30-70%
		};
	}

	/**
   * 添加性能指标记录
   */
	addMetric(metric: PerformanceMetrics): void {
		this.metrics.push(metric);
    
		// 保持历史记录在合理范围内
		if (this.metrics.length > this.maxMetricsHistory) {
			this.metrics = this.metrics.slice(-this.maxMetricsHistory);
		}
	}

	/**
   * 记录传输事件
   */
	recordTransferEvent(type: 'start' | 'complete' | 'error', data: any): void {
		const event: PerformanceEvent = {
			id: this.generateId(),
			timestamp: Date.now(),
			type: 'transfer',
			level: type === 'error' ? 'error' : 'info',
			message: this.formatTransferMessage(type, data),
			data
		};

		this.addEvent(event);
		this.emit('transferEvent', event);
	}

	/**
   * 记录连接池事件
   */
	recordConnectionEvent(type: 'created' | 'reused' | 'destroyed' | 'timeout', data: any): void {
		const event: PerformanceEvent = {
			id: this.generateId(),
			timestamp: Date.now(),
			type: 'connection',
			level: type === 'timeout' ? 'warn' : 'info',
			message: this.formatConnectionMessage(type, data),
			data
		};

		this.addEvent(event);
		this.emit('connectionEvent', event);
	}

	/**
   * 记录优化效果
   */
	recordOptimizationEffect(type: string, improvement: number, details?: any): void {
		const event: PerformanceEvent = {
			id: this.generateId(),
			timestamp: Date.now(),
			type: 'optimization',
			level: 'info',
			message: `${type}优化效果: 提升${improvement}%`,
			data: { type, improvement, details }
		};

		this.addEvent(event);
		this.emit('optimizationEvent', event);
	}

	/**
   * 获取性能统计摘要
   */
	getPerformanceSummary(): {
    current: PerformanceMetrics | null
    average: Partial<PerformanceMetrics>
    peak: Partial<PerformanceMetrics>
    trends: {
      speed: number[]
      connections: number[]
      success: number[]
    }
    } {
		if (this.metrics.length === 0) {
			return {
				current: null,
				average: {},
				peak: {},
				trends: { speed: [], connections: [], success: [] }
			};
		}

		const current = this.metrics[this.metrics.length - 1];
		const recentMetrics = this.metrics.slice(-20); // 最近20个数据点

		const average = this.calculateAverage(recentMetrics);
		const peak = this.calculatePeak(this.metrics);
		const trends = this.calculateTrends(recentMetrics);

		return { current, average, peak, trends };
	}

	/**
   * 生成性能报告
   */
	generateReport(hours = 24): PerformanceReport {
		const endTime = Date.now();
		const startTime = endTime - (hours * 60 * 60 * 1000);
    
		const periodMetrics = this.metrics.filter(
			m => m.timestamp >= startTime && m.timestamp <= endTime
		);

		const summary = this.calculateSummary(periodMetrics);
		const trends = this.calculateTrends(periodMetrics);

		return {
			generatedAt: Date.now(),
			period: { start: startTime, end: endTime },
			summary,
			metrics: {
				performance: periodMetrics,
				connectionPool: this.getConnectionPoolMetrics(),
				optimization: this.getOptimizationMetrics(),
				errors: this.getErrorMetrics(),
				server: this.getServerMetrics()
			},
			trends: {
				speedTrend: trends.speed,
				connectionTrend: trends.connections,
				errorTrend: this.calculateErrorTrend(periodMetrics)
			},
			recommendations: this.generateRecommendations(summary)
		};
	}

	/**
   * 获取连接池指标
   */
	getConnectionPoolMetrics(): ConnectionPoolMetrics {
		// 在实际实现中，这些数据应该从连接池服务获取
		return {
			poolSize: 5,
			idleConnections: 3,
			activeConnections: 2,
			waitingQueue: 0,
			reuseCount: 45,
			totalCreated: 12,
			totalDestroyed: 7,
			averageLifetime: 30000 // 30秒
		};
	}

	/**
   * 获取优化指标
   */
	getOptimizationMetrics(): OptimizationMetrics {
		return {
			standardImprovement: 25,
			extendedImprovement: 45,
			connectionReuseSavings: 350,
			cacheHitRate: 78,
			compressionSavings: 512 * 1024 * 1024,
			retrySuccessRate: 85,
			averageRetryCount: 1.2
		};
	}

	/**
   * 获取错误指标
   */
	getErrorMetrics(): ErrorMetrics {
		const errorEvents = this.events.filter(e => e.level === 'error');
		return {
			networkErrors: errorEvents.filter(e => e.message.includes('网络')).length,
			timeoutErrors: errorEvents.filter(e => e.message.includes('超时')).length,
			authErrors: errorEvents.filter(e => e.message.includes('认证')).length,
			protocolErrors: errorEvents.filter(e => e.message.includes('协议')).length,
			retrySuccesses: 12,
			retryFailures: 3,
			maxRetries: 3,
			totalErrors: errorEvents.length
		};
	}

	/**
   * 获取服务器指标
   */
	getServerMetrics(): ServerMetrics {
		const recentMetrics = this.metrics.slice(-10);
		const avgResponseTime = recentMetrics.length > 0 
			? recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / recentMetrics.length 
			: 0;

		return {
			responseTime: avgResponseTime,
			serverLoad: Math.random() * 100,
			supportedFeatures: ['PASV', 'EPSV', 'REST', 'SIZE', 'MLSD'],
			detectionReliability: 0.95,
			protocolVersion: 'FTP 1.0',
			serverSoftware: 'vsftpd 3.0.3',
			maxConcurrentConnections: 5,
			averageCommandTime: 50
		};
	}

	/**
   * 获取最近的事件日志
   */
	getRecentEvents(limit = 50): PerformanceEvent[] {
		return this.events.slice(-limit).reverse();
	}

	/**
   * 清除历史数据
   */
	clearHistory(): void {
		this.metrics = [];
		this.events = [];
		this.addEvent({
			id: this.generateId(),
			timestamp: Date.now(),
			type: 'optimization',
			level: 'info',
			message: '性能历史数据已清除'
		});
	}

	/**
   * 事件监听器
   */
	on(event: string, callback: Function): void {
		if (!this.eventListeners.has(event)) {
			this.eventListeners.set(event, []);
		}
    this.eventListeners.get(event)!.push(callback);
	}

	off(event: string, callback: Function): void {
		const listeners = this.eventListeners.get(event);
		if (listeners) {
			const index = listeners.indexOf(callback);
			if (index > -1) {
				listeners.splice(index, 1);
			}
		}
	}

	private emit(event: string, data: any): void {
		const listeners = this.eventListeners.get(event);
		if (listeners) {
			listeners.forEach(callback => {
				try {
					callback(data);
				} catch (error) {
					console.error(`事件监听器执行错误 (${event}):`, error);
				}
			});
		}
	}

	private addEvent(event: PerformanceEvent): void {
		this.events.push(event);
    
		// 保持历史记录在合理范围内
		if (this.events.length > this.maxEventsHistory) {
			this.events = this.events.slice(-this.maxEventsHistory);
		}
	}

	private generateId(): string {
		return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	private formatTransferMessage(type: string, data: any): string {
		switch (type) {
			case 'start':
				return `开始传输文件: ${data.filename} (${this.formatBytes(data.size)})`;
			case 'complete':
				return `传输完成: ${data.filename} (${this.formatBytes(data.size)}, 耗时: ${data.duration}ms)`;
			case 'error':
				return `传输失败: ${data.filename} - ${data.error}`;
			default:
				return `传输事件: ${type}`;
		}
	}

	private formatConnectionMessage(type: string, data: any): string {
		switch (type) {
			case 'created':
				return `创建新连接: ${data.host}:${data.port}`;
			case 'reused':
				return `复用现有连接: ${data.connectionId}`;
			case 'destroyed':
				return `销毁连接: ${data.connectionId} (存活时间: ${data.lifetime}ms)`;
			case 'timeout':
				return `连接超时: ${data.host}:${data.port}`;
			default:
				return `连接事件: ${type}`;
		}
	}

	private calculateAverage(metrics: PerformanceMetrics[]): Partial<PerformanceMetrics> {
		if (metrics.length === 0) {return {};}

		return {
			transferSpeed: metrics.reduce((sum, m) => sum + m.transferSpeed, 0) / metrics.length,
			responseTime: metrics.reduce((sum, m) => sum + m.responseTime, 0) / metrics.length,
			successRate: metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length
		};
	}

	private calculatePeak(metrics: PerformanceMetrics[]): Partial<PerformanceMetrics> {
		if (metrics.length === 0) {return {};}

		return {
			transferSpeed: Math.max(...metrics.map(m => m.transferSpeed)),
			activeConnections: Math.max(...metrics.map(m => m.activeConnections)),
			successRate: Math.max(...metrics.map(m => m.successRate))
		};
	}

	private calculateTrends(metrics: PerformanceMetrics[]): {
    speed: number[]
    connections: number[]
    success: number[]
  } {
		return {
			speed: metrics.map(m => m.transferSpeed),
			connections: metrics.map(m => m.activeConnections),
			success: metrics.map(m => m.successRate)
		};
	}

	private calculateSummary(metrics: PerformanceMetrics[]): any {
		if (metrics.length === 0) {
			return {
				totalTransfers: 0,
				successRate: 0,
				averageSpeed: 0,
				totalDataTransferred: 0,
				peakSpeed: 0,
				optimizationGains: 0
			};
		}

		return {
			totalTransfers: metrics.reduce((sum, m) => sum + m.totalTransfers, 0),
			successRate: metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length,
			averageSpeed: metrics.reduce((sum, m) => sum + m.transferSpeed, 0) / metrics.length,
			totalDataTransferred: metrics.reduce((sum, m) => sum + m.totalDataTransferred, 0),
			peakSpeed: Math.max(...metrics.map(m => m.transferSpeed)),
			optimizationGains: 35 // 示例值
		};
	}

	private calculateErrorTrend(metrics: PerformanceMetrics[]): number[] {
		// 简化的错误趋势计算
		return metrics.map(m => 100 - m.successRate);
	}

	private generateRecommendations(summary: any): string[] {
		const recommendations: string[] = [];

		if (summary.successRate < 90) {
			recommendations.push('传输成功率较低，建议检查网络连接和服务器状态');
		}

		if (summary.averageSpeed < 1024 * 1024) {
			recommendations.push('传输速度较慢，建议启用更多优化选项');
		}

		if (summary.peakSpeed / summary.averageSpeed > 5) {
			recommendations.push('传输速度波动较大，建议启用自适应优化');
		}

		return recommendations;
	}

	private formatBytes(bytes: number): string {
		if (bytes < 1024) {return `${bytes} B`;}
		if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`;}
		if (bytes < 1024 * 1024 * 1024) {return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;}
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}
}

// 导出单例实例
export const ftpPerformanceService = FtpPerformanceService.getInstance();