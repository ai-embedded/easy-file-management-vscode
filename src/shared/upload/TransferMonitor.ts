/**
 * 传输监控器 - 监控大文件传输状态和健康度
 * 为VSCode扩展主机稳定性提供保护
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';

export interface TransferStats {
  startTime: number;
  totalBytes: number;
  transferredBytes: number;
  currentSpeed: number;      // 当前传输速度 (bytes/sec)
  averageSpeed: number;      // 平均传输速度 (bytes/sec)
  estimatedTimeRemaining: number; // 预计剩余时间 (ms)
  chunkCount: number;        // 已传输块数
  totalChunks: number;       // 总块数
  failedChunks: number;      // 失败块数
  retryCount: number;        // 重试次数
  pauseCount: number;        // 暂停次数
  lastActivityTime: number;  // 最后活动时间
  isHealthy: boolean;        // 传输健康状态
  healthScore: number;       // 健康分数 (0-100)
}

export interface TransferHealth {
  score: number;             // 健康分数 0-100
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  issues: string[];          // 健康问题列表
  recommendations: string[]; // 建议措施
}

export interface TransferMonitorConfig {
  healthCheckInterval: number;   // 健康检查间隔 (ms)
  stallTimeout: number;          // 停滞超时时间 (ms)
  minHealthScore: number;        // 最小健康分数
  enableLogging: boolean;        // 启用日志
}

/**
 * 传输监控器
 */
export class TransferMonitor extends EventEmitter {
	private logger = new Logger('TransferMonitor');
	private config: Required<TransferMonitorConfig>;
	private stats: TransferStats;
	private healthTimer?: NodeJS.Timeout;
	private speedCalculationWindow: Array<{timestamp: number, bytes: number}> = [];
	private lastProgressUpdate = Date.now();

	constructor(totalBytes: number, totalChunks: number, config: Partial<TransferMonitorConfig> = {}) {
		super();

		this.config = {
			healthCheckInterval: config.healthCheckInterval || 5000,  // 5秒检查一次
			stallTimeout: config.stallTimeout || 30000,              // 30秒无活动视为停滞
			minHealthScore: config.minHealthScore || 50,             // 最低50分健康分数
			enableLogging: config.enableLogging !== false
		};

		this.stats = {
			startTime: Date.now(),
			totalBytes,
			transferredBytes: 0,
			currentSpeed: 0,
			averageSpeed: 0,
			estimatedTimeRemaining: 0,
			chunkCount: 0,
			totalChunks,
			failedChunks: 0,
			retryCount: 0,
			pauseCount: 0,
			lastActivityTime: Date.now(),
			isHealthy: true,
			healthScore: 100
		};

		this.startHealthMonitoring();

		if (this.config.enableLogging) {
			this.logger.info('📊 传输监控器已启动', {
				totalBytes: `${(totalBytes / 1024 / 1024).toFixed(2)}MB`,
				totalChunks,
				healthCheckInterval: `${this.config.healthCheckInterval / 1000}秒`
			});
		}
	}

	/**
   * 更新传输进度
   */
	updateProgress(transferredBytes: number, chunkCount: number): void {
		const now = Date.now();
		const bytesDelta = transferredBytes - this.stats.transferredBytes;

		if (bytesDelta > 0) {
			this.stats.transferredBytes = transferredBytes;
			this.stats.chunkCount = chunkCount;
			this.stats.lastActivityTime = now;

			// 添加到速度计算窗口
			this.speedCalculationWindow.push({timestamp: now, bytes: transferredBytes});

			// 保持窗口大小（最近30秒的数据）
			const windowSize = 30000;
			this.speedCalculationWindow = this.speedCalculationWindow.filter(
				entry => now - entry.timestamp <= windowSize
			);

			this.calculateSpeeds();
			this.lastProgressUpdate = now;
		}

		this.emit('progress-updated', this.getStats());
	}

	/**
   * 记录块上传失败
   */
	recordChunkFailure(): void {
		this.stats.failedChunks++;
		this.emit('chunk-failed', this.stats.failedChunks);
	}

	/**
   * 记录重试
   */
	recordRetry(): void {
		this.stats.retryCount++;
		this.emit('retry-recorded', this.stats.retryCount);
	}

	/**
   * 记录暂停
   */
	recordPause(): void {
		this.stats.pauseCount++;
		this.emit('pause-recorded', this.stats.pauseCount);
	}

	/**
   * 获取当前统计信息
   */
	getStats(): Readonly<TransferStats> {
		return { ...this.stats };
	}

	/**
   * 获取传输健康度
   */
	getHealth(): TransferHealth {
		const now = Date.now();
		const elapsed = now - this.stats.startTime;
		const timeSinceLastActivity = now - this.stats.lastActivityTime;

		let score = 100;
		const issues: string[] = [];
		const recommendations: string[] = [];

		// 检查传输停滞
		if (timeSinceLastActivity > this.config.stallTimeout) {
			score -= 30;
			issues.push(`传输已停滞 ${Math.round(timeSinceLastActivity / 1000)} 秒`);
			recommendations.push('检查网络连接和服务端状态');
		}

		// 检查失败率
		if (this.stats.chunkCount > 0) {
			const failureRate = (this.stats.failedChunks / this.stats.chunkCount) * 100;
			if (failureRate > 10) {
				score -= 20;
				issues.push(`块失败率过高: ${failureRate.toFixed(1)}%`);
				recommendations.push('考虑减小块大小或增加重试间隔');
			}
		}

		// 检查重试频率
		if (elapsed > 30000) { // 30秒后开始检查
			const retryRate = (this.stats.retryCount / elapsed) * 1000; // 每秒重试次数
			if (retryRate > 0.5) {
				score -= 15;
				issues.push(`重试过于频繁: ${retryRate.toFixed(2)}/秒`);
				recommendations.push('增加传输间隔以减少服务器负载');
			}
		}

		// 检查传输速度
		if (this.stats.averageSpeed > 0 && elapsed > 10000) { // 10秒后开始检查速度
			const expectedTime = (this.stats.totalBytes / this.stats.averageSpeed) * 1000;
			if (expectedTime > 300000) { // 预计需要超过5分钟
				score -= 10;
				issues.push('传输速度较慢');
				recommendations.push('检查网络带宽和服务器性能');
			}
		}

		// 检查暂停频率
		if (this.stats.pauseCount > 5) {
			score -= 10;
			issues.push(`暂停次数过多: ${this.stats.pauseCount} 次`);
			recommendations.push('检查是否有资源竞争或系统负载过高');
		}

		score = Math.max(0, Math.min(100, score));
		this.stats.healthScore = score;
		this.stats.isHealthy = score >= this.config.minHealthScore;

		let status: TransferHealth['status'];
		if (score >= 90) {status = 'excellent';}
		else if (score >= 75) {status = 'good';}
		else if (score >= 60) {status = 'fair';}
		else if (score >= 40) {status = 'poor';}
		else {status = 'critical';}

		return {
			score,
			status,
			issues,
			recommendations
		};
	}

	/**
   * 是否应该暂停传输
   */
	shouldPauseTransfer(): boolean {
		const health = this.getHealth();
		return health.score < this.config.minHealthScore;
	}

	/**
   * 获取建议的暂停时间
   */
	getSuggestedPauseTime(): number {
		const health = this.getHealth();

		if (health.score < 25) {return 2000;} // 2秒
		if (health.score < 50) {return 1000;} // 1秒
		if (health.score < 75) {return 500;}  // 0.5秒

		return 0; // 不需要暂停
	}

	/**
   * 停止监控
   */
	destroy(): void {
		if (this.healthTimer) {
			clearInterval(this.healthTimer);
			this.healthTimer = undefined;
		}

		this.removeAllListeners();

		if (this.config.enableLogging) {
			const duration = Date.now() - this.stats.startTime;
			this.logger.info('📊 传输监控器已停止', {
				duration: `${(duration / 1000).toFixed(1)}秒`,
				transferredBytes: `${(this.stats.transferredBytes / 1024 / 1024).toFixed(2)}MB`,
				averageSpeed: `${(this.stats.averageSpeed / 1024).toFixed(2)}KB/s`,
				finalHealthScore: this.stats.healthScore
			});
		}
	}

	// === 私有方法 ===

	/**
   * 启动健康监控
   */
	private startHealthMonitoring(): void {
		this.healthTimer = setInterval(() => {
			const health = this.getHealth();

			if (!this.stats.isHealthy && health.score >= this.config.minHealthScore) {
				// 健康状态恢复
				this.stats.isHealthy = true;
				this.emit('health-recovered', health);

				if (this.config.enableLogging) {
					this.logger.info('💚 传输健康状态已恢复', { score: health.score });
				}
			} else if (this.stats.isHealthy && health.score < this.config.minHealthScore) {
				// 健康状态恶化
				this.stats.isHealthy = false;
				this.emit('health-degraded', health);

				if (this.config.enableLogging) {
					this.logger.warn('🔴 传输健康状态恶化', {
						score: health.score,
						issues: health.issues
					});
				}
			}

			this.emit('health-check', health);
		}, this.config.healthCheckInterval);
	}

	/**
   * 计算传输速度
   */
	private calculateSpeeds(): void {
		const now = Date.now();

		if (this.speedCalculationWindow.length >= 2) {
			// 计算当前速度（最近2个数据点）
			const recent = this.speedCalculationWindow.slice(-2);
			const timeDelta = recent[1].timestamp - recent[0].timestamp;
			const bytesDelta = recent[1].bytes - recent[0].bytes;

			if (timeDelta > 0) {
				this.stats.currentSpeed = (bytesDelta / timeDelta) * 1000; // bytes/sec
			}

			// 计算平均速度（整个窗口）
			const oldest = this.speedCalculationWindow[0];
			const latest = this.speedCalculationWindow[this.speedCalculationWindow.length - 1];
			const totalTime = latest.timestamp - oldest.timestamp;
			const totalBytes = latest.bytes - oldest.bytes;

			if (totalTime > 0) {
				this.stats.averageSpeed = (totalBytes / totalTime) * 1000; // bytes/sec
			}
		}

		// 计算平均速度（从开始到现在）
		const elapsed = now - this.stats.startTime;
		if (elapsed > 0) {
			const overallAverage = (this.stats.transferredBytes / elapsed) * 1000;

			// 使用加权平均来平滑速度变化
			if (this.stats.averageSpeed === 0) {
				this.stats.averageSpeed = overallAverage;
			} else {
				this.stats.averageSpeed = (this.stats.averageSpeed * 0.7) + (overallAverage * 0.3);
			}
		}

		// 计算预计剩余时间
		if (this.stats.averageSpeed > 0) {
			const remainingBytes = this.stats.totalBytes - this.stats.transferredBytes;
			this.stats.estimatedTimeRemaining = (remainingBytes / this.stats.averageSpeed) * 1000;
		}
	}
}