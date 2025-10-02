/**
 * 🚀 HTTP分片下载器
 * 基于ConcurrentChunkUploader的设计，实现HTTP Range请求的并发分片下载
 * 复用TCP的智能并发控制和错误恢复机制
 */

import { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { Logger } from '../../shared/utils/Logger';
import { AdvancedPerformanceMonitor } from '../../shared/monitoring/AdvancedPerformanceMonitor';

/**
 * 下载分片信息接口
 */
interface DownloadChunkInfo {
  index: number;
  start: number;
  end: number;
  size: number;
  retryCount: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  downloadTime?: number;
  speed?: number; // bytes/ms
  data?: Buffer;
}

/**
 * 下载配置接口
 */
interface DownloadConfig {
  url: string;
  chunkSize?: number;
  maxConcurrency?: number;
  maxRetries?: number;
  timeout?: number;
  enableChecksum?: boolean;
  adaptiveChunkSize?: boolean;
  networkQuality?: 'fast' | 'medium' | 'slow';
  enableRangeRequests?: boolean;
}

/**
 * 下载进度接口
 */
interface DownloadProgress {
  totalBytes: number;
  downloadedBytes: number;
  percentage: number;
  chunksTotal: number;
  chunksCompleted: number;
  chunksFailed: number;
  currentSpeed: number; // bytes/s
  estimatedTimeRemaining: number; // ms
  activeChunks: number;
}

/**
 * 下载结果接口
 */
interface DownloadResult {
  success: boolean;
  data?: Buffer;
  totalTime: number;
  avgSpeed: number;
  chunksCompleted: number;
  chunksFailed: number;
  retryCount: number;
  error?: string;
}

/**
 * 信号量实现（复用TCP版本）
 */
class Semaphore {
	private permits: number;
	private waitQueue: Array<() => void> = [];
  
	constructor(permits: number) {
		this.permits = permits;
	}
  
	async acquire(): Promise<() => void> {
		return new Promise((resolve) => {
			if (this.permits > 0) {
				this.permits--;
				resolve(() => this.release());
			} else {
				this.waitQueue.push(() => {
					this.permits--;
					resolve(() => this.release());
				});
			}
		});
	}
  
	private release(): void {
		this.permits++;
		const next = this.waitQueue.shift();
		if (next) {
			next();
		}
	}
  
	getAvailablePermits(): number {
		return this.permits;
	}
}

/**
 * 🚀 HTTP分片下载器
 */
export class HttpChunkedDownloader {
	private logger = new Logger('HttpChunkedDownloader');
	private performanceMonitor?: AdvancedPerformanceMonitor;
	private semaphore: Semaphore;
	private axiosInstance: AxiosInstance;
  
	// 下载状态
	private chunks: DownloadChunkInfo[] = [];
	private downloadedBytes = 0;
	private startTime = 0;
	private config: Required<DownloadConfig>;
	private totalFileSize = 0;
  
	// 进度回调
	private progressCallback?: (progress: DownloadProgress) => void;
  
	// 自适应参数
	private adaptiveChunkSize: number;
	private networkQuality: 'fast' | 'medium' | 'slow' = 'medium';
  
	constructor(
		axiosInstance: AxiosInstance,
		config: DownloadConfig,
		performanceMonitor?: AdvancedPerformanceMonitor,
		progressCallback?: (progress: DownloadProgress) => void
	) {
		this.axiosInstance = axiosInstance;
    
		// 设置默认配置
		this.config = {
			url: config.url,
			chunkSize: config.chunkSize || 256 * 1024, // 256KB
			maxConcurrency: config.maxConcurrency || 4,
			maxRetries: config.maxRetries || 3,
			timeout: config.timeout || 30000, // 30s
			enableChecksum: config.enableChecksum !== false,
			adaptiveChunkSize: config.adaptiveChunkSize !== false,
			networkQuality: config.networkQuality || 'medium',
			enableRangeRequests: config.enableRangeRequests !== false
		};
    
		this.performanceMonitor = performanceMonitor;
		this.progressCallback = progressCallback;
		this.semaphore = new Semaphore(this.config.maxConcurrency);
		this.networkQuality = this.config.networkQuality;
    
		// 初始化自适应分片大小
		this.adaptiveChunkSize = this.calculateInitialChunkSize();
    
		this.logger.info('🚀 HTTP分片下载器初始化完成');
		this.logger.info(`📊 配置: 并发=${this.config.maxConcurrency}, 分片=${(this.adaptiveChunkSize / 1024).toFixed(0)}KB, 网络=${this.networkQuality}`);
	}
  
	/**
   * 🎯 开始下载
   */
	async download(): Promise<DownloadResult> {
		const startTime = Date.now();
		this.startTime = startTime;
    
		try {
			// 1. 检测服务器Range支持并获取文件大小
			const serverSupportsRange = await this.checkRangeSupport();
			if (!serverSupportsRange || !this.config.enableRangeRequests) {
				// 回退到普通下载
				return this.fallbackToNormalDownload();
			}
      
			// 2. 创建分片
			await this.prepareChunks();
      
			// 3. 并发下载分片
			await this.downloadChunksConcurrently();
      
			// 4. 组装最终数据
			const finalData = this.assembleChunks();
      
			// 5. 验证结果
			const result = this.validateDownloadResult();
      
			const totalTime = Date.now() - startTime;
			const avgSpeed = this.downloadedBytes / totalTime; // bytes/ms
      
			this.logger.info(`✅ 分片下载完成: ${this.config.url} (${(this.downloadedBytes / 1024 / 1024).toFixed(1)}MB, ${totalTime}ms, ${(avgSpeed * 1000 / 1024 / 1024).toFixed(1)}MB/s)`);
      
			return {
				success: result.success,
				data: finalData,
				totalTime,
				avgSpeed: avgSpeed * 1000, // bytes/s
				chunksCompleted: result.chunksCompleted,
				chunksFailed: result.chunksFailed,
				retryCount: result.retryCount,
				error: result.error
			};
		} catch (error) {
			const totalTime = Date.now() - startTime;
			this.logger.error(`❌ 分片下载失败: ${this.config.url}`, error);
      
			return {
				success: false,
				totalTime,
				avgSpeed: 0,
				chunksCompleted: this.chunks.filter(c => c.status === 'completed').length,
				chunksFailed: this.chunks.filter(c => c.status === 'failed').length,
				retryCount: this.chunks.reduce((sum, c) => sum + c.retryCount, 0),
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
  
	/**
   * 🔍 检测服务器Range支持
   */
	private async checkRangeSupport(): Promise<boolean> {
		try {
			const response = await this.axiosInstance.head(this.config.url);
			const contentLength = response.headers['content-length'];
			const acceptRanges = response.headers['accept-ranges'];
      
			if (!contentLength || !acceptRanges) {
				this.logger.warn('服务器不支持Range请求或无法获取文件大小，将使用普通下载');
				return false;
			}
      
			this.totalFileSize = parseInt(contentLength);
			const supportsRange = acceptRanges.toLowerCase() === 'bytes';
      
			this.logger.info(`🔍 服务器Range支持检测: ${supportsRange ? '✅' : '❌'}, 文件大小: ${(this.totalFileSize / 1024 / 1024).toFixed(1)}MB`);
      
			return supportsRange;
		} catch (error) {
			this.logger.warn('无法检测服务器Range支持，将使用普通下载:', error);
			return false;
		}
	}
  
	/**
   * 🔄 回退到普通下载
   */
	private async fallbackToNormalDownload(): Promise<DownloadResult> {
		this.logger.info('🔄 回退到普通HTTP下载模式');
    
		const startTime = Date.now();
		try {
			const response = await this.axiosInstance.get(this.config.url, {
				responseType: 'arraybuffer',
				timeout: this.config.timeout,
				onDownloadProgress: (progressEvent) => {
					if (this.progressCallback && progressEvent.total) {
						this.progressCallback({
							totalBytes: progressEvent.total,
							downloadedBytes: progressEvent.loaded,
							percentage: (progressEvent.loaded / progressEvent.total) * 100,
							chunksTotal: 1,
							chunksCompleted: 0,
							chunksFailed: 0,
							currentSpeed: 0,
							estimatedTimeRemaining: 0,
							activeChunks: 1
						});
					}
				}
			});
      
			const totalTime = Date.now() - startTime;
			const dataBuffer = Buffer.from(response.data);
			const avgSpeed = dataBuffer.length / totalTime; // bytes/ms
      
			this.logger.info(`✅ 普通下载完成: ${(dataBuffer.length / 1024 / 1024).toFixed(1)}MB, ${totalTime}ms, ${(avgSpeed * 1000 / 1024 / 1024).toFixed(1)}MB/s`);
      
			return {
				success: true,
				data: dataBuffer,
				totalTime,
				avgSpeed: avgSpeed * 1000, // bytes/s
				chunksCompleted: 1,
				chunksFailed: 0,
				retryCount: 0
			};
		} catch (error) {
			const totalTime = Date.now() - startTime;
			return {
				success: false,
				totalTime,
				avgSpeed: 0,
				chunksCompleted: 0,
				chunksFailed: 1,
				retryCount: 0,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
  
	/**
   * 📋 准备分片
   */
	private async prepareChunks(): Promise<void> {
		// 🧠 智能调整分片大小
		if (this.config.adaptiveChunkSize) {
			this.adaptiveChunkSize = this.performanceMonitor?.getOptimalChunkSize(this.totalFileSize, this.networkQuality) || this.adaptiveChunkSize;
		}
    
		const chunkSize = this.adaptiveChunkSize;
		const totalChunks = Math.ceil(this.totalFileSize / chunkSize);
    
		this.logger.info(`📋 准备分片: 文件${(this.totalFileSize / 1024 / 1024).toFixed(1)}MB → ${totalChunks}个分片 (${(chunkSize / 1024).toFixed(0)}KB/片)`);
    
		// 创建分片信息
		this.chunks = [];
		for (let i = 0; i < totalChunks; i++) {
			const start = i * chunkSize;
			const end = Math.min(start + chunkSize - 1, this.totalFileSize - 1);
			const size = end - start + 1;
      
			this.chunks.push({
				index: i,
				start,
				end,
				size,
				retryCount: 0,
				status: 'pending'
			});
		}
    
		this.logger.debug(`✅ 分片准备完成: ${this.chunks.length}个分片`);
	}
  
	/**
   * 🌊 并发下载分片
   */
	private async downloadChunksConcurrently(): Promise<void> {
		const downloadPromises: Promise<void>[] = [];
    
		// 创建所有下载任务
		for (const chunk of this.chunks) {
			const downloadPromise = this.downloadSingleChunk(chunk);
			downloadPromises.push(downloadPromise);
		}
    
		// 等待所有下载完成
		await Promise.all(downloadPromises);
	}
  
	/**
   * 📥 下载单个分片
   */
	private async downloadSingleChunk(chunk: DownloadChunkInfo): Promise<void> {
		// 获取信号量许可
		const release = await this.semaphore.acquire();
    
		try {
			await this.downloadChunkWithRetry(chunk);
		} finally {
			release();
		}
	}
  
	/**
   * 🔄 带重试的分片下载
   */
	private async downloadChunkWithRetry(chunk: DownloadChunkInfo): Promise<void> {
		let lastError: Error | null = null;
    
		for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
			try {
				chunk.status = 'downloading';
				chunk.retryCount = attempt;
        
				// 📊 记录下载开始时间
				const downloadStart = Date.now();
        
				// 🚀 执行HTTP Range请求
				const response = await this.executeWithTimeout(
					() => this.axiosInstance.get(this.config.url, {
						headers: {
							'Range': `bytes=${chunk.start}-${chunk.end}`
						},
						responseType: 'arraybuffer',
						timeout: this.config.timeout
					}),
					this.config.timeout
				);
        
				// 📊 记录下载完成
				const downloadTime = Date.now() - downloadStart;
				chunk.downloadTime = downloadTime;
				chunk.speed = chunk.size / downloadTime; // bytes/ms
				chunk.status = 'completed';
				chunk.data = Buffer.from(response.data);
        
				// 验证分片大小
				if (chunk.data.length !== chunk.size) {
					throw new Error(`分片大小不匹配: 期望${chunk.size}, 实际${chunk.data.length}`);
				}
        
				// 更新统计
				this.downloadedBytes += chunk.size;
        
				// 🎯 自适应调整分片大小
				if (this.config.adaptiveChunkSize) {
					this.adjustChunkSizeBasedOnPerformance(chunk);
				}
        
				// 📈 更新进度
				this.updateProgress();
        
				// 📊 记录性能指标
				this.recordPerformanceMetric(chunk, true);
        
				this.logger.debug(`✅ 分片下载成功: ${chunk.index}/${this.chunks.length} (${(chunk.speed! * 1000 / 1024 / 1024).toFixed(1)}MB/s)`);
				return; // 成功，退出重试循环
        
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
        
				this.logger.warn(`⚠️ 分片下载失败 ${chunk.index} (尝试 ${attempt + 1}/${this.config.maxRetries + 1}): ${lastError.message}`);
        
				// 📊 记录失败的性能指标
				this.recordPerformanceMetric(chunk, false, lastError.message);
        
				// 如果不是最后一次尝试，等待后重试
				if (attempt < this.config.maxRetries) {
					const retryDelay = Math.min(1000 * Math.pow(2, attempt), 10000); // 指数退避，最大10秒
					await this.sleep(retryDelay);
				}
			}
		}
    
		// 所有重试都失败了
		chunk.status = 'failed';
		this.logger.error(`❌ 分片下载最终失败: ${chunk.index} - ${lastError?.message}`);
	}
  
	/**
   * 🧩 组装分片数据
   */
	private assembleChunks(): Buffer {
		// 按索引排序分片
		const sortedChunks = this.chunks
			.filter(chunk => chunk.status === 'completed' && chunk.data)
			.sort((a, b) => a.index - b.index);
    
		// 检查分片完整性
		if (sortedChunks.length !== this.chunks.length) {
			throw new Error(`分片不完整: ${sortedChunks.length}/${this.chunks.length}`);
		}
    
		// 拼接所有分片
		const bufferList = sortedChunks.map(chunk => chunk.data!);
		const finalBuffer = Buffer.concat(bufferList);
    
		this.logger.info(`🧩 分片组装完成: ${finalBuffer.length} 字节`);
    
		return finalBuffer;
	}
  
	/**
   * ⏱️ 执行带超时的操作
   */
	private async executeWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`操作超时 (${timeoutMs}ms)`));
			}, timeoutMs);
      
			operation()
				.then(result => {
					clearTimeout(timer);
					resolve(result);
				})
				.catch(error => {
					clearTimeout(timer);
					reject(error);
				});
		});
	}
  
	/**
   * 🎯 基于性能调整分片大小
   */
	private adjustChunkSizeBasedOnPerformance(chunk: DownloadChunkInfo): void {
		if (!chunk.speed || !chunk.downloadTime) {return;}
    
		const speedMBps = chunk.speed * 1000 / 1024 / 1024; // MB/s
		const chunkSizeKB = this.adaptiveChunkSize / 1024;
    
		// 基于速度和网络质量调整
		let adjustment = 1.0;
    
		if (speedMBps > 10 && chunk.downloadTime < 1000) {
			// 高速且快速完成，增加分片大小
			adjustment = 1.2;
		} else if (speedMBps < 1 || chunk.downloadTime > 5000) {
			// 低速或耗时过长，减少分片大小
			adjustment = 0.8;
		}
    
		const newChunkSize = Math.max(
			32 * 1024,  // 最小32KB
			Math.min(
				2 * 1024 * 1024,  // 最大2MB
				Math.round(this.adaptiveChunkSize * adjustment)
			)
		);
    
		if (newChunkSize !== this.adaptiveChunkSize) {
			this.adaptiveChunkSize = newChunkSize;
			this.logger.debug(`🎯 分片大小自适应调整: ${(chunkSizeKB).toFixed(0)}KB → ${(newChunkSize / 1024).toFixed(0)}KB (速度: ${speedMBps.toFixed(1)}MB/s)`);
		}
	}
  
	/**
   * 📊 记录性能指标
   */
	private recordPerformanceMetric(chunk: DownloadChunkInfo, success: boolean, errorMsg?: string): void {
		if (!this.performanceMonitor) {return;}
    
		this.performanceMonitor.recordAdvancedOperation({
			operationType: 'download' as any,
			operationName: 'chunk_download',
			startTime: Date.now() - (chunk.downloadTime || 0),
			endTime: Date.now(),
			duration: chunk.downloadTime || 0,
			success,
			error: errorMsg,
			format: 'binary' as any,
			cached: false,
			dataSize: chunk.size,
			metadata: {
				chunkIndex: chunk.index,
				chunkSize: chunk.size,
				retryCount: chunk.retryCount,
				speed: chunk.speed,
				rangeStart: chunk.start,
				rangeEnd: chunk.end
			}
		});
	}
  
	/**
   * 📈 更新进度
   */
	private updateProgress(): void {
		if (!this.progressCallback) {return;}
    
		const completedChunks = this.chunks.filter(c => c.status === 'completed').length;
		const failedChunks = this.chunks.filter(c => c.status === 'failed').length;
		const activeChunks = this.chunks.filter(c => c.status === 'downloading').length;
    
		// 计算当前速度（最近5秒的平均值）
		const recentChunks = this.chunks
			.filter(c => c.status === 'completed' && c.downloadTime && c.downloadTime > Date.now() - 5000)
			.slice(-10); // 最近10个完成的分片
    
		const currentSpeed = recentChunks.length > 0
			? recentChunks.reduce((sum, c) => sum + (c.speed || 0), 0) / recentChunks.length
			: 0;
    
		// 估算剩余时间
		const remainingBytes = this.totalFileSize - this.downloadedBytes;
		const estimatedTimeRemaining = currentSpeed > 0 ? remainingBytes / currentSpeed : 0;
    
		const progress: DownloadProgress = {
			totalBytes: this.totalFileSize,
			downloadedBytes: this.downloadedBytes,
			percentage: this.totalFileSize > 0 ? (this.downloadedBytes / this.totalFileSize) * 100 : 0,
			chunksTotal: this.chunks.length,
			chunksCompleted: completedChunks,
			chunksFailed: failedChunks,
			currentSpeed: currentSpeed * 1000, // 转换为 bytes/s
			estimatedTimeRemaining,
			activeChunks
		};
    
		this.progressCallback(progress);
	}
  
	/**
   * ✅ 验证下载结果
   */
	private validateDownloadResult(): { success: boolean; chunksCompleted: number; chunksFailed: number; retryCount: number; error?: string } {
		const completed = this.chunks.filter(c => c.status === 'completed').length;
		const failed = this.chunks.filter(c => c.status === 'failed').length;
		const totalRetries = this.chunks.reduce((sum, c) => sum + c.retryCount, 0);
    
		const success = failed === 0 && completed === this.chunks.length;
		const error = !success ? `${failed} 个分片下载失败` : undefined;
    
		return {
			success,
			chunksCompleted: completed,
			chunksFailed: failed,
			retryCount: totalRetries,
			error
		};
	}
  
	/**
   * 🔢 计算初始分片大小
   */
	private calculateInitialChunkSize(): number {
		const baseSize = this.config.chunkSize;
    
		// 根据网络质量调整
		const networkMultipliers = {
			'fast': 1.5,
			'medium': 1.0,
			'slow': 0.5
		};
    
		return Math.round(baseSize * networkMultipliers[this.networkQuality]);
	}
  
	/**
   * 💤 睡眠函数
   */
	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
  
	/**
   * 📊 获取下载统计
   */
	getStatistics() {
		const completed = this.chunks.filter(c => c.status === 'completed').length;
		const failed = this.chunks.filter(c => c.status === 'failed').length;
		const totalRetries = this.chunks.reduce((sum, c) => sum + c.retryCount, 0);
		const avgSpeed = this.chunks
			.filter(c => c.speed)
			.reduce((sum, c) => sum + c.speed!, 0) / Math.max(1, completed);
    
		return {
			totalChunks: this.chunks.length,
			completedChunks: completed,
			failedChunks: failed,
			downloadedBytes: this.downloadedBytes,
			totalFileSize: this.totalFileSize,
			totalRetries,
			avgSpeed: avgSpeed * 1000, // bytes/s
			adaptiveChunkSize: this.adaptiveChunkSize,
			concurrency: this.config.maxConcurrency,
			availablePermits: this.semaphore.getAvailablePermits()
		};
	}
  
	/**
   * 🛑 停止下载
   */
	async stop(): Promise<void> {
		// 将所有pending状态的分片标记为失败
		for (const chunk of this.chunks) {
			if (chunk.status === 'pending' || chunk.status === 'downloading') {
				chunk.status = 'failed';
			}
		}
    
		this.logger.info('🛑 HTTP分片下载已停止');
	}
}

export default HttpChunkedDownloader;