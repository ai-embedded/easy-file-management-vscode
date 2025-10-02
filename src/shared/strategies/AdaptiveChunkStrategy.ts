/**
 * 自适应分块策略
 * 根据网络条件动态调整块大小
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';

const logger = new Logger('AdaptiveChunkStrategy');

/**
 * 网络质量级别
 */
export enum NetworkQuality {
  EXCELLENT = 'excellent',  // 优秀（>10MB/s，错误率<1%）
  GOOD = 'good',           // 良好（5-10MB/s，错误率<3%）
  MODERATE = 'moderate',   // 中等（1-5MB/s，错误率<5%）
  POOR = 'poor',          // 较差（0.5-1MB/s，错误率<10%）
  VERY_POOR = 'very_poor'  // 很差（<0.5MB/s，错误率>10%）
}

/**
 * 分块策略配置
 */
export interface ChunkStrategyConfig {
  minChunkSize?: number;       // 最小块大小（默认 4KB）
  maxChunkSize?: number;       // 最大块大小（默认 1MB）
  defaultChunkSize?: number;   // 默认块大小（默认 32KB）
  adjustInterval?: number;     // 调整间隔（毫秒，默认 5000）
  sampleSize?: number;        // 采样大小（默认 10）
  enableAutoAdjust?: boolean; // 启用自动调整（默认 true）
  targetErrorRate?: number;   // 目标错误率（默认 0.02）
  targetSpeed?: number;       // 目标速度（字节/秒）
}

/**
 * 传输统计信息
 */
export interface TransferStats {
  totalBytes: number;         // 总字节数
  totalTime: number;         // 总时间（毫秒）
  totalChunks: number;       // 总块数
  successfulChunks: number;  // 成功块数
  failedChunks: number;      // 失败块数
  retryCount: number;        // 重试次数
  currentSpeed: number;      // 当前速度（字节/秒）
  averageSpeed: number;      // 平均速度（字节/秒）
  errorRate: number;         // 错误率
  networkQuality: NetworkQuality; // 网络质量
}

/**
 * 块传输结果
 */
export interface ChunkTransferResult {
  success: boolean;
  duration: number;
  size: number;
  retries: number;
}

/**
 * 自适应分块策略
 */
export class AdaptiveChunkStrategy extends EventEmitter {
	private config: Required<ChunkStrategyConfig>;
	private currentChunkSize: number;
	private stats: TransferStats;
	private recentTransfers: ChunkTransferResult[] = [];
	private adjustTimer?: NodeJS.Timeout;
	private speedHistory: number[] = [];
	private errorRateHistory: number[] = [];
  
	constructor(config: ChunkStrategyConfig = {}) {
		super();
    
		// 初始化配置
		this.config = {
			minChunkSize: config.minChunkSize || 4 * 1024,           // 4KB
			maxChunkSize: config.maxChunkSize || 1024 * 1024,        // 1MB
			defaultChunkSize: config.defaultChunkSize || 32 * 1024,  // 32KB
			adjustInterval: config.adjustInterval || 5000,            // 5秒
			sampleSize: config.sampleSize || 10,
			enableAutoAdjust: config.enableAutoAdjust !== false,
			targetErrorRate: config.targetErrorRate || 0.02,         // 2%
			targetSpeed: config.targetSpeed || 1024 * 1024           // 1MB/s
		};
    
		// 初始化状态
		this.currentChunkSize = this.config.defaultChunkSize;
		this.stats = this.createEmptyStats();
    
		// 启动自动调整
		if (this.config.enableAutoAdjust) {
			this.startAutoAdjust();
		}
    
		logger.info('自适应分块策略已初始化', {
			minChunkSize: this.config.minChunkSize,
			maxChunkSize: this.config.maxChunkSize,
			defaultChunkSize: this.config.defaultChunkSize
		});
	}
  
	/**
   * 获取当前块大小
   */
	getChunkSize(): number {
		return this.currentChunkSize;
	}
  
	/**
   * 获取优化的块大小（基于当前网络状况）
   */
	getOptimalChunkSize(): number {
		const quality = this.evaluateNetworkQuality();
    
		switch (quality) {
			case NetworkQuality.EXCELLENT:
				// 优秀网络：使用大块（限制在60KB以避免超出帧协议限制）
				return Math.min(this.config.maxChunkSize, 60 * 1024); // 60KB
        
			case NetworkQuality.GOOD:
				// 良好网络：使用中大块
				return Math.min(this.config.maxChunkSize, 48 * 1024); // 48KB
        
			case NetworkQuality.MODERATE:
				// 中等网络：使用中等块
				return Math.min(this.config.maxChunkSize, 32 * 1024);  // 32KB
        
			case NetworkQuality.POOR:
				// 较差网络：使用小块
				return Math.max(this.config.minChunkSize, 16 * 1024);  // 16KB
        
			case NetworkQuality.VERY_POOR:
				// 很差网络：使用最小块
				return Math.max(this.config.minChunkSize, 8 * 1024);  // 8KB
        
			default:
				return this.config.defaultChunkSize;
		}
	}
  
	/**
   * 记录块传输结果
   */
	recordTransfer(result: ChunkTransferResult): void {
		// 更新统计
		this.stats.totalChunks++;
		this.stats.totalBytes += result.size;
		this.stats.totalTime += result.duration;
    
		if (result.success) {
			this.stats.successfulChunks++;
		} else {
			this.stats.failedChunks++;
		}
    
		this.stats.retryCount += result.retries;
    
		// 计算速度
		const speed = result.duration > 0 ? (result.size / result.duration) * 1000 : 0;
		this.stats.currentSpeed = speed;
    
		// 更新平均速度
		this.speedHistory.push(speed);
		if (this.speedHistory.length > this.config.sampleSize) {
			this.speedHistory.shift();
		}
		this.stats.averageSpeed = this.calculateAverage(this.speedHistory);
    
		// 更新错误率
		this.stats.errorRate = this.stats.failedChunks / this.stats.totalChunks;
		this.errorRateHistory.push(result.success ? 0 : 1);
		if (this.errorRateHistory.length > this.config.sampleSize) {
			this.errorRateHistory.shift();
		}
    
		// 更新网络质量
		this.stats.networkQuality = this.evaluateNetworkQuality();
    
		// 保存最近的传输记录
		this.recentTransfers.push(result);
		if (this.recentTransfers.length > this.config.sampleSize) {
			this.recentTransfers.shift();
		}
    
		// 触发事件
		this.emit('stats-updated', this.stats);
    
		logger.debug('传输记录已更新', {
			speed: `${(speed / 1024 / 1024).toFixed(2)} MB/s`,
			errorRate: `${(this.stats.errorRate * 100).toFixed(1)}%`,
			quality: this.stats.networkQuality
		});
	}
  
	/**
   * 手动调整块大小
   */
	adjustChunkSize(): void {
		if (!this.config.enableAutoAdjust) {
			return;
		}
    
		const oldSize = this.currentChunkSize;
		const optimalSize = this.getOptimalChunkSize();
    
		// 基于网络质量和错误率调整
		if (this.stats.errorRate > this.config.targetErrorRate) {
			// 错误率过高，减小块大小
			this.currentChunkSize = Math.max(
				this.config.minChunkSize,
				Math.floor(this.currentChunkSize * 0.8)
			);
			logger.info(`错误率过高 (${(this.stats.errorRate * 100).toFixed(1)}%)，减小块大小`);
      
		} else if (this.stats.averageSpeed > this.config.targetSpeed * 1.5) {
			// 速度很好，增大块大小
			this.currentChunkSize = Math.min(
				this.config.maxChunkSize,
				Math.floor(this.currentChunkSize * 1.2)
			);
			logger.info(`速度优秀 (${(this.stats.averageSpeed / 1024 / 1024).toFixed(2)} MB/s)，增大块大小`);
      
		} else if (this.stats.averageSpeed < this.config.targetSpeed * 0.5) {
			// 速度太慢，减小块大小
			this.currentChunkSize = Math.max(
				this.config.minChunkSize,
				Math.floor(this.currentChunkSize * 0.9)
			);
			logger.info(`速度较慢 (${(this.stats.averageSpeed / 1024 / 1024).toFixed(2)} MB/s)，减小块大小`);
      
		} else {
			// 逐渐趋向最优值
			const diff = optimalSize - this.currentChunkSize;
			this.currentChunkSize += Math.floor(diff * 0.3); // 30% 的调整幅度
		}
    
		// 确保在范围内
		this.currentChunkSize = Math.max(
			this.config.minChunkSize,
			Math.min(this.config.maxChunkSize, this.currentChunkSize)
		);
    
		// 确保是 1KB 的倍数
		this.currentChunkSize = Math.floor(this.currentChunkSize / 1024) * 1024;
    
		if (oldSize !== this.currentChunkSize) {
			logger.info(`块大小已调整: ${oldSize / 1024}KB -> ${this.currentChunkSize / 1024}KB`);
      
			this.emit('chunk-size-changed', {
				oldSize,
				newSize: this.currentChunkSize,
				reason: this.getAdjustReason()
			});
		}
	}
  
	/**
   * 获取统计信息
   */
	getStats(): TransferStats {
		return { ...this.stats };
	}
  
	/**
   * 重置统计信息
   */
	resetStats(): void {
		this.stats = this.createEmptyStats();
		this.recentTransfers = [];
		this.speedHistory = [];
		this.errorRateHistory = [];
		this.currentChunkSize = this.config.defaultChunkSize;
    
		logger.info('统计信息已重置');
	}
  
	/**
   * 获取推荐配置
   */
	getRecommendation(): {
    chunkSize: number;
    concurrency: number;
    retryAttempts: number;
    timeout: number;
    } {
		const quality = this.evaluateNetworkQuality();
    
		switch (quality) {
			case NetworkQuality.EXCELLENT:
				return {
					chunkSize: this.getOptimalChunkSize(),
					concurrency: 5,
					retryAttempts: 1,
					timeout: 10000
				};
        
			case NetworkQuality.GOOD:
				return {
					chunkSize: this.getOptimalChunkSize(),
					concurrency: 3,
					retryAttempts: 2,
					timeout: 15000
				};
        
			case NetworkQuality.MODERATE:
				return {
					chunkSize: this.getOptimalChunkSize(),
					concurrency: 2,
					retryAttempts: 3,
					timeout: 20000
				};
        
			case NetworkQuality.POOR:
				return {
					chunkSize: this.getOptimalChunkSize(),
					concurrency: 1,
					retryAttempts: 3,
					timeout: 30000
				};
        
			case NetworkQuality.VERY_POOR:
				return {
					chunkSize: this.getOptimalChunkSize(),
					concurrency: 1,
					retryAttempts: 5,
					timeout: 60000
				};
        
			default:
				return {
					chunkSize: this.config.defaultChunkSize,
					concurrency: 2,
					retryAttempts: 3,
					timeout: 20000
				};
		}
	}
  
	/**
   * 销毁策略
   */
	destroy(): void {
		this.stopAutoAdjust();
		this.removeAllListeners();
	}
  
	// === 私有方法 ===
  
	/**
   * 创建空统计
   */
	private createEmptyStats(): TransferStats {
		return {
			totalBytes: 0,
			totalTime: 0,
			totalChunks: 0,
			successfulChunks: 0,
			failedChunks: 0,
			retryCount: 0,
			currentSpeed: 0,
			averageSpeed: 0,
			errorRate: 0,
			networkQuality: NetworkQuality.MODERATE
		};
	}
  
	/**
   * 评估网络质量
   */
	private evaluateNetworkQuality(): NetworkQuality {
		const speed = this.stats.averageSpeed;
		const errorRate = this.stats.errorRate;
    
		// 基于速度和错误率评估
		if (speed > 10 * 1024 * 1024 && errorRate < 0.01) {
			return NetworkQuality.EXCELLENT;
		} else if (speed > 5 * 1024 * 1024 && errorRate < 0.03) {
			return NetworkQuality.GOOD;
		} else if (speed > 1024 * 1024 && errorRate < 0.05) {
			return NetworkQuality.MODERATE;
		} else if (speed > 512 * 1024 && errorRate < 0.10) {
			return NetworkQuality.POOR;
		} else {
			return NetworkQuality.VERY_POOR;
		}
	}
  
	/**
   * 计算平均值
   */
	private calculateAverage(values: number[]): number {
		if (values.length === 0) {return 0;}
		return values.reduce((a, b) => a + b, 0) / values.length;
	}
  
	/**
   * 获取调整原因
   */
	private getAdjustReason(): string {
		if (this.stats.errorRate > this.config.targetErrorRate) {
			return `错误率过高 (${(this.stats.errorRate * 100).toFixed(1)}%)`;
		} else if (this.stats.averageSpeed > this.config.targetSpeed * 1.5) {
			return `速度优秀 (${(this.stats.averageSpeed / 1024 / 1024).toFixed(2)} MB/s)`;
		} else if (this.stats.averageSpeed < this.config.targetSpeed * 0.5) {
			return `速度较慢 (${(this.stats.averageSpeed / 1024 / 1024).toFixed(2)} MB/s)`;
		} else {
			return '网络状况变化';
		}
	}
  
	/**
   * 启动自动调整
   */
	private startAutoAdjust(): void {
		if (this.adjustTimer) {
			return;
		}
    
		this.adjustTimer = setInterval(() => {
			if (this.recentTransfers.length >= this.config.sampleSize / 2) {
				this.adjustChunkSize();
			}
		}, this.config.adjustInterval);
    
		logger.info('自动调整已启动');
	}
  
	/**
   * 停止自动调整
   */
	private stopAutoAdjust(): void {
		if (this.adjustTimer) {
			clearInterval(this.adjustTimer);
			this.adjustTimer = undefined;
			logger.info('自动调整已停止');
		}
	}
}

// 导出默认实例
export const defaultChunkStrategy = new AdaptiveChunkStrategy();