/**
 * FTP操作指标收集器
 */
export interface FtpMetrics {
  // 连接池指标
  connectionPool: {
    hitRate: number;           // 连接池命中率
    activeConnections: number; // 活跃连接数
    totalConnections: number;  // 总连接数
    queueLength: number;       // 排队长度
    avgQueueTime: number;      // 平均排队时长(ms)
  };
  
  // 传输指标
  transfer: {
    totalTransfers: number;    // 总传输次数
    successCount: number;      // 成功次数
    errorCount: number;        // 错误次数
    errorRate: number;         // 错误率
    bytesTransferred: number; // 传输字节数
    avgSpeed: number;          // 平均速度(bytes/s)
    p50Latency: number;        // P50延迟(ms)
    p95Latency: number;        // P95延迟(ms)
    p99Latency: number;        // P99延迟(ms)
  };
  
  // 缓存指标
  cache: {
    hitRate: number;           // 缓存命中率
    hits: number;              // 命中次数
    misses: number;            // 未命中次数
    evictions: number;         // 驱逐次数
    size: number;              // 缓存大小
  };
  
  // 压缩指标
  compression: {
    enabled: boolean;          // 是否启用
    totalSaved: number;        // 总节省字节数
    avgRatio: number;          // 平均压缩率
    compressedTransfers: number; // 压缩传输次数
  };
  
  // 重试指标
  retry: {
    totalRetries: number;      // 总重试次数
    reasonDistribution: Record<string, number>; // 重试原因分布
  };
  
  // 时间戳
  timestamp: number;           // 指标收集时间
  uptime: number;              // 运行时长(ms)
}

/**
 * 指标收集器实现
 */
export class FtpMetricsCollector {
	private startTime: number;
	private transferLatencies: number[] = [];
	private maxLatencyHistory = 1000; // 最多保留1000个延迟记录
  
	// 连接池指标
	private connectionPoolHits = 0;
	private connectionPoolMisses = 0;
	private connectionQueueTimes: number[] = [];
  
	// 传输指标
	private totalTransfers = 0;
	private successfulTransfers = 0;
	private failedTransfers = 0;
	private totalBytesTransferred = 0;
	private transferSpeeds: number[] = [];
  
	// 缓存指标
	private cacheHits = 0;
	private cacheMisses = 0;
	private cacheEvictions = 0;
	private currentCacheSize = 0;
  
	// 压缩指标
	private compressionEnabled = false;
	private totalBytesSaved = 0;
	private compressionRatios: number[] = [];
	private compressedTransferCount = 0;
  
	// 重试指标
	private totalRetries = 0;
	private retryReasons: Map<string, number> = new Map();
  
	constructor() {
		this.startTime = Date.now();
	}
  
	/**
   * 记录连接池命中
   */
	recordConnectionPoolHit(): void {
		this.connectionPoolHits++;
	}
  
	/**
   * 记录连接池未命中
   */
	recordConnectionPoolMiss(): void {
		this.connectionPoolMisses++;
	}
  
	/**
   * 记录连接排队时间
   */
	recordConnectionQueueTime(timeMs: number): void {
		this.connectionQueueTimes.push(timeMs);
		// 保持队列大小在合理范围
		if (this.connectionQueueTimes.length > this.maxLatencyHistory) {
			this.connectionQueueTimes.shift();
		}
	}
  
	/**
   * 记录传输操作
   */
	recordTransfer(success: boolean, latencyMs: number, bytesTransferred: number, speedBps?: number): void {
		this.totalTransfers++;
		if (success) {
			this.successfulTransfers++;
		} else {
			this.failedTransfers++;
		}
    
		this.transferLatencies.push(latencyMs);
		if (this.transferLatencies.length > this.maxLatencyHistory) {
			this.transferLatencies.shift();
		}
    
		this.totalBytesTransferred += bytesTransferred;
    
		if (speedBps !== undefined) {
			this.transferSpeeds.push(speedBps);
			if (this.transferSpeeds.length > this.maxLatencyHistory) {
				this.transferSpeeds.shift();
			}
		}
	}
  
	/**
   * 记录缓存操作
   */
	recordCacheHit(): void {
		this.cacheHits++;
	}
  
	recordCacheMiss(): void {
		this.cacheMisses++;
	}
  
	recordCacheEviction(): void {
		this.cacheEvictions++;
	}
  
	updateCacheSize(size: number): void {
		this.currentCacheSize = size;
	}
  
	/**
   * 记录压缩操作
   */
	recordCompression(originalSize: number, compressedSize: number): void {
		this.compressionEnabled = true;
		this.compressedTransferCount++;
		this.totalBytesSaved += (originalSize - compressedSize);
		this.compressionRatios.push(compressedSize / originalSize);
    
		if (this.compressionRatios.length > this.maxLatencyHistory) {
			this.compressionRatios.shift();
		}
	}
  
	/**
   * 记录重试操作
   */
	recordRetry(reason: string): void {
		this.totalRetries++;
		const currentCount = this.retryReasons.get(reason) || 0;
		this.retryReasons.set(reason, currentCount + 1);
	}
  
	/**
   * 批量记录重试统计（从RetryManager获取）
   */
	recordRetryStatistics(retryStats: { totalRetries: number; reasonDistribution: Record<string, number> }): void {
		this.totalRetries = retryStats.totalRetries;
		this.retryReasons.clear();
		for (const [reason, count] of Object.entries(retryStats.reasonDistribution)) {
			this.retryReasons.set(reason, count);
		}
	}
  
	/**
   * 获取当前指标
   */
	getMetrics(activeConnections = 0, queueLength = 0): FtpMetrics {
		const now = Date.now();
		const uptime = now - this.startTime;
    
		// 计算连接池指标
		const totalPoolAccess = this.connectionPoolHits + this.connectionPoolMisses;
		const poolHitRate = totalPoolAccess > 0 ? this.connectionPoolHits / totalPoolAccess : 0;
		const avgQueueTime = this.calculateAverage(this.connectionQueueTimes);
    
		// 计算传输指标
		const errorRate = this.totalTransfers > 0 ? this.failedTransfers / this.totalTransfers : 0;
		const avgSpeed = this.calculateAverage(this.transferSpeeds);
		const latencyPercentiles = this.calculatePercentiles(this.transferLatencies);
    
		// 计算缓存指标
		const totalCacheAccess = this.cacheHits + this.cacheMisses;
		const cacheHitRate = totalCacheAccess > 0 ? this.cacheHits / totalCacheAccess : 0;
    
		// 计算压缩指标
		const avgCompressionRatio = this.calculateAverage(this.compressionRatios);
    
		// 构建重试原因分布
		const retryDistribution: Record<string, number> = {};
		this.retryReasons.forEach((count, reason) => {
			retryDistribution[reason] = count;
		});
    
		return {
			connectionPool: {
				hitRate: poolHitRate,
				activeConnections,
				totalConnections: totalPoolAccess,
				queueLength,
				avgQueueTime
			},
			transfer: {
				totalTransfers: this.totalTransfers,
				successCount: this.successfulTransfers,
				errorCount: this.failedTransfers,
				errorRate,
				bytesTransferred: this.totalBytesTransferred,
				avgSpeed,
				p50Latency: latencyPercentiles.p50,
				p95Latency: latencyPercentiles.p95,
				p99Latency: latencyPercentiles.p99
			},
			cache: {
				hitRate: cacheHitRate,
				hits: this.cacheHits,
				misses: this.cacheMisses,
				evictions: this.cacheEvictions,
				size: this.currentCacheSize
			},
			compression: {
				enabled: this.compressionEnabled,
				totalSaved: this.totalBytesSaved,
				avgRatio: avgCompressionRatio,
				compressedTransfers: this.compressedTransferCount
			},
			retry: {
				totalRetries: this.totalRetries,
				reasonDistribution: retryDistribution
			},
			timestamp: now,
			uptime
		};
	}
  
	/**
   * 重置所有指标
   */
	reset(): void {
		this.startTime = Date.now();
		this.transferLatencies = [];
		this.connectionPoolHits = 0;
		this.connectionPoolMisses = 0;
		this.connectionQueueTimes = [];
		this.totalTransfers = 0;
		this.successfulTransfers = 0;
		this.failedTransfers = 0;
		this.totalBytesTransferred = 0;
		this.transferSpeeds = [];
		this.cacheHits = 0;
		this.cacheMisses = 0;
		this.cacheEvictions = 0;
		this.currentCacheSize = 0;
		this.compressionEnabled = false;
		this.totalBytesSaved = 0;
		this.compressionRatios = [];
		this.compressedTransferCount = 0;
		this.totalRetries = 0;
		this.retryReasons.clear();
	}
  
	/**
   * 计算平均值
   */
	private calculateAverage(values: number[]): number {
		if (values.length === 0) {return 0;}
		const sum = values.reduce((a, b) => a + b, 0);
		return sum / values.length;
	}
  
	/**
   * 计算百分位数
   */
	private calculatePercentiles(values: number[]): { p50: number; p95: number; p99: number } {
		if (values.length === 0) {
			return { p50: 0, p95: 0, p99: 0 };
		}
    
		const sorted = [...values].sort((a, b) => a - b);
		const p50Index = Math.floor(sorted.length * 0.5);
		const p95Index = Math.floor(sorted.length * 0.95);
		const p99Index = Math.floor(sorted.length * 0.99);
    
		return {
			p50: sorted[p50Index] || 0,
			p95: sorted[p95Index] || 0,
			p99: sorted[p99Index] || 0
		};
	}
}