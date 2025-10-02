/**
 * 🚀 并发分片上传器
 * 实现智能分片、并发控制、错误恢复和进度跟踪
 * 基于todo_tcp.md的优化方案实现
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import { Logger } from '../utils/Logger';
import { AdvancedPerformanceMonitor } from '../monitoring/AdvancedPerformanceMonitor';

/**
 * 分片信息接口
 */
interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  size: number;
  checksum: string;
  retryCount: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  uploadTime?: number;
  speed?: number; // bytes/ms
}

/**
 * 上传配置接口
 */
interface UploadConfig {
  filePath: string;
  chunkSize?: number;
  maxConcurrency?: number;
  maxRetries?: number;
  timeout?: number;
  useCompression?: boolean;
  enableChecksum?: boolean;
  adaptiveChunkSize?: boolean;
  networkQuality?: 'fast' | 'medium' | 'slow';
}

/**
 * 上传进度接口
 */
interface UploadProgress {
  totalBytes: number;
  uploadedBytes: number;
  percentage: number;
  chunksTotal: number;
  chunksCompleted: number;
  chunksFailed: number;
  currentSpeed: number; // bytes/ms
  estimatedTimeRemaining: number; // ms
  activeChunks: number;
}

/**
 * 上传结果接口
 */
interface UploadResult {
  success: boolean;
  totalTime: number;
  avgSpeed: number;
  chunksCompleted: number;
  chunksFailed: number;
  retryCount: number;
  error?: string;
}

/**
 * 信号量实现
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
 * 🚀 并发分片上传器
 */
export class ConcurrentChunkUploader {
	private logger = new Logger('ConcurrentChunkUploader');
	private performanceMonitor?: AdvancedPerformanceMonitor;
	private semaphore: Semaphore;
  
	// 上传状态
	private chunks: ChunkInfo[] = [];
	private uploadedBytes = 0;
	private startTime = 0;
	private config: Required<UploadConfig>;
  
	// 进度回调
	private progressCallback?: (progress: UploadProgress) => void;
  
	// 自适应参数
	private adaptiveChunkSize: number;
	private networkQuality: 'fast' | 'medium' | 'slow' = 'medium';
  
	constructor(
		config: UploadConfig,
		performanceMonitor?: AdvancedPerformanceMonitor,
		progressCallback?: (progress: UploadProgress) => void
	) {
		// 设置默认配置
		this.config = {
			filePath: config.filePath,
			chunkSize: config.chunkSize || 256 * 1024, // 256KB
			maxConcurrency: config.maxConcurrency || 4,
			maxRetries: config.maxRetries || 3,
			timeout: config.timeout || 30000, // 30s
			useCompression: config.useCompression !== false,
			enableChecksum: config.enableChecksum !== false,
			adaptiveChunkSize: config.adaptiveChunkSize !== false,
			networkQuality: config.networkQuality || 'medium'
		};
    
		this.performanceMonitor = performanceMonitor;
		this.progressCallback = progressCallback;
		this.semaphore = new Semaphore(this.config.maxConcurrency);
		this.networkQuality = this.config.networkQuality;
    
		// 初始化自适应分片大小
		this.adaptiveChunkSize = this.calculateInitialChunkSize();
    
		this.logger.info('🚀 并发分片上传器初始化完成');
		this.logger.info(`📊 配置: 并发=${this.config.maxConcurrency}, 分片=${(this.adaptiveChunkSize / 1024).toFixed(0)}KB, 网络=${this.networkQuality}`);
	}
  
	/**
   * 🎯 开始上传
   */
	async upload(sendChunkCallback: (chunkData: Buffer, chunkInfo: ChunkInfo) => Promise<void>): Promise<UploadResult> {
		const startTime = Date.now();
		this.startTime = startTime;
    
		try {
			// 1. 分析文件并创建分片
			await this.prepareChunks();
      
			// 2. 并发上传分片
			await this.uploadChunksConcurrently(sendChunkCallback);
      
			// 3. 验证上传结果
			const result = this.validateUploadResult();
      
			const totalTime = Date.now() - startTime;
			const avgSpeed = this.uploadedBytes / totalTime; // bytes/ms
      
			this.logger.info(`✅ 上传完成: ${this.config.filePath} (${(this.uploadedBytes / 1024 / 1024).toFixed(1)}MB, ${totalTime}ms, ${(avgSpeed * 1000 / 1024 / 1024).toFixed(1)}MB/s)`);
      
			return {
				success: result.success,
				totalTime,
				avgSpeed: avgSpeed * 1000, // bytes/s
				chunksCompleted: result.chunksCompleted,
				chunksFailed: result.chunksFailed,
				retryCount: result.retryCount,
				error: result.error
			};
		} catch (error) {
			const totalTime = Date.now() - startTime;
			this.logger.error(`❌ 上传失败: ${this.config.filePath}`, error);
      
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
   * 📋 准备分片
   */
	private async prepareChunks(): Promise<void> {
		const stats = fs.statSync(this.config.filePath);
		const fileSize = stats.size;
    
		// 🧠 智能调整分片大小
		if (this.config.adaptiveChunkSize) {
			this.adaptiveChunkSize = this.performanceMonitor?.getOptimalChunkSize(fileSize, this.networkQuality) || this.adaptiveChunkSize;
		}
    
		const chunkSize = this.adaptiveChunkSize;
		const totalChunks = Math.ceil(fileSize / chunkSize);
    
		this.logger.info(`📋 准备分片: 文件${(fileSize / 1024 / 1024).toFixed(1)}MB → ${totalChunks}个分片 (${(chunkSize / 1024).toFixed(0)}KB/片)`);

		// 创建分片信息
		this.chunks = [];
		for (let i = 0; i < totalChunks; i++) {
			const start = i * chunkSize;
			const end = Math.min(start + chunkSize, fileSize);
			const size = end - start;

			let checksum = '';
			if (this.config.enableChecksum) {
				checksum = await this.calculateChunkChecksum(start, size);
			}

			this.chunks.push({
				index: i,
				start,
				end,
				size,
				checksum,
				retryCount: 0,
				status: 'pending'
			});
		}

		this.logger.debug(`✅ 分片准备完成: ${this.chunks.length}个分片`);
	}

	/**
	 * 🔐 计算分片校验和
	 */
	private async calculateChunkChecksum(start: number, size: number): Promise<string> {
		return new Promise((resolve, reject) => {
			const hash = crypto.createHash('md5');
			const stream = fs.createReadStream(this.config.filePath, { start, end: start + size - 1 });

			stream.on('data', chunk => hash.update(chunk));
			stream.on('end', () => resolve(hash.digest('hex')));
			stream.on('error', reject);
		});
	}

	/**
	 * 🌊 并发上传分片
	 */
	private async uploadChunksConcurrently(
		sendChunkCallback: (chunkData: Buffer, chunkInfo: ChunkInfo) => Promise<void>
	): Promise<void> {
		const uploadPromises: Promise<void>[] = [];

		for (const chunk of this.chunks) {
			uploadPromises.push(this.uploadSingleChunk(chunk, sendChunkCallback));
		}

		await Promise.all(uploadPromises);
	}

	/**
	 * 📤 上传单个分片
	 */
	private async uploadSingleChunk(
		chunk: ChunkInfo,
		sendChunkCallback: (chunkData: Buffer, chunkInfo: ChunkInfo) => Promise<void>
	): Promise<void> {
		const release = await this.semaphore.acquire();

		try {
			await this.uploadChunkWithRetry(chunk, sendChunkCallback);
		} finally {
			release();
		}
	}

	/**
	 * 🔄 带重试的分片上传
	 */
	private async uploadChunkWithRetry(
		chunk: ChunkInfo,
		sendChunkCallback: (chunkData: Buffer, chunkInfo: ChunkInfo) => Promise<void>
	): Promise<void> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
			try {
				chunk.status = 'uploading';
				chunk.retryCount = attempt;

				const uploadStart = Date.now();
				const chunkData = await this.readChunkData(chunk);

				await this.executeWithTimeout(
					() => sendChunkCallback(chunkData, chunk),
					this.config.timeout
				);

				const uploadTime = Date.now() - uploadStart;
				chunk.uploadTime = uploadTime;
				chunk.speed = chunk.size / uploadTime;
				chunk.status = 'completed';

				this.uploadedBytes += chunk.size;

				if (this.config.adaptiveChunkSize) {
					this.adjustChunkSizeBasedOnPerformance(chunk);
				}

				this.updateProgress();
				this.recordPerformanceMetric(chunk, true);

				this.logger.debug(
					`✅ 分片上传成功: ${chunk.index}/${this.chunks.length} (${(chunk.speed! * 1000 / 1024 / 1024).toFixed(1)}MB/s)`
				);
				return;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				this.logger.warn(
					`⚠️ 分片上传失败 ${chunk.index} (尝试 ${attempt + 1}/${this.config.maxRetries + 1}): ${lastError.message}`
				);

				this.recordPerformanceMetric(chunk, false, lastError.message);

				if (attempt < this.config.maxRetries) {
					const retryDelay = Math.min(1000 * Math.pow(2, attempt), 10000);
					await this.sleep(retryDelay);
				}
			}
		}

		chunk.status = 'failed';
		this.logger.error(`❌ 分片上传最终失败: ${chunk.index} - ${lastError?.message}`);
		// 根据策略决定是否抛出错误，这里选择继续其他分片的上传
	}

	/**
	 * 📖 读取分片数据
	 */
	private async readChunkData(chunk: ChunkInfo): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			const buffer = Buffer.allocUnsafe(chunk.size);
			const fd = fs.openSync(this.config.filePath, 'r');

			try {
				const bytesRead = fs.readSync(fd, buffer, 0, chunk.size, chunk.start);
				fs.closeSync(fd);

				if (bytesRead !== chunk.size) {
					throw new Error(`读取字节数不匹配: 期望${chunk.size}, 实际${bytesRead}`);
				}

				if (this.config.enableChecksum && chunk.checksum) {
					const actualChecksum = crypto.createHash('md5').update(buffer).digest('hex');
					if (actualChecksum !== chunk.checksum) {
						throw new Error(`分片校验和不匹配: 期望${chunk.checksum}, 实际${actualChecksum}`);
					}
				}

				resolve(buffer);
			} catch (error) {
				fs.closeSync(fd);
				reject(error);
			}
		});
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
	private adjustChunkSizeBasedOnPerformance(chunk: ChunkInfo): void {
		if (!chunk.speed || !chunk.uploadTime) {
			return;
		}

		const speedMBps = (chunk.speed * 1000) / 1024 / 1024;
		const chunkSizeKB = this.adaptiveChunkSize / 1024;

		let adjustment = 1.0;

		if (speedMBps > 10 && chunk.uploadTime < 1000) {
			adjustment = 1.2;
		} else if (speedMBps < 1 || chunk.uploadTime > 5000) {
			adjustment = 0.8;
		}

		const newChunkSize = Math.max(
			32 * 1024,
			Math.min(2 * 1024 * 1024, Math.round(this.adaptiveChunkSize * adjustment))
		);

		if (newChunkSize !== this.adaptiveChunkSize) {
			this.logger.debug(
				`🎯 分片大小自适应调整: ${chunkSizeKB.toFixed(0)}KB → ${(newChunkSize / 1024).toFixed(0)}KB (速度: ${speedMBps.toFixed(1)}MB/s)`
			);
			this.adaptiveChunkSize = newChunkSize;
		}
	}

	/**
	 * 📊 记录性能指标
	 */
	private recordPerformanceMetric(chunk: ChunkInfo, success: boolean, errorMsg?: string): void {
		if (!this.performanceMonitor) {
			return;
		}

		this.performanceMonitor.recordAdvancedOperation({
			operationType: 'upload' as any,
			operationName: 'chunk_upload',
			startTime: Date.now() - (chunk.uploadTime || 0),
			endTime: Date.now(),
			duration: chunk.uploadTime || 0,
			success,
			error: errorMsg,
			format: 'protobuf' as any,
			cached: false,
			dataSize: chunk.size,
			metadata: {
				chunkIndex: chunk.index,
				chunkSize: chunk.size,
				retryCount: chunk.retryCount,
				speed: chunk.speed
			}
		});
	}

	/**
	 * 📈 更新进度
	 */
	private updateProgress(): void {
		if (!this.progressCallback) {
			return;
		}

		const totalBytes = this.chunks.reduce((sum, c) => sum + c.size, 0);
		const completedChunks = this.chunks.filter(c => c.status === 'completed').length;
		const failedChunks = this.chunks.filter(c => c.status === 'failed').length;
		const activeChunks = this.chunks.filter(c => c.status === 'uploading').length;

		const recentChunks = this.chunks
			.filter(c => c.status === 'completed' && c.uploadTime && c.uploadTime > Date.now() - 5000)
			.slice(-10);

		const currentSpeed = recentChunks.length > 0
			? recentChunks.reduce((sum, c) => sum + (c.speed || 0), 0) / recentChunks.length
			: 0;

		const remainingBytes = totalBytes - this.uploadedBytes;
		const estimatedTimeRemaining = currentSpeed > 0 ? remainingBytes / currentSpeed : 0;

		const progress: UploadProgress = {
			totalBytes,
			uploadedBytes: this.uploadedBytes,
			percentage: totalBytes > 0 ? (this.uploadedBytes / totalBytes) * 100 : 0,
			chunksTotal: this.chunks.length,
			chunksCompleted: completedChunks,
			chunksFailed: failedChunks,
			currentSpeed: currentSpeed * 1000,
			estimatedTimeRemaining,
			activeChunks
		};

		this.progressCallback(progress);
	}

	/**
	 * ✅ 验证上传结果
	 */
	private validateUploadResult(): {
		success: boolean;
		chunksCompleted: number;
		chunksFailed: number;
		retryCount: number;
		error?: string;
		} {
		const completed = this.chunks.filter(c => c.status === 'completed').length;
		const failed = this.chunks.filter(c => c.status === 'failed').length;
		const totalRetries = this.chunks.reduce((sum, c) => sum + c.retryCount, 0);

		const success = failed === 0 && completed === this.chunks.length;
		const error = !success ? `${failed} 个分片上传失败` : undefined;

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

		const networkMultipliers = {
			fast: 1.5,
			medium: 1.0,
			slow: 0.5
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
	 * 📊 获取上传统计
	 */
	getStatistics() {
		const completed = this.chunks.filter(c => c.status === 'completed').length;
		const failed = this.chunks.filter(c => c.status === 'failed').length;
		const totalRetries = this.chunks.reduce((sum, c) => sum + c.retryCount, 0);
		const avgSpeed =
			this.chunks.filter(c => c.speed).reduce((sum, c) => sum + c.speed!, 0) /
			Math.max(1, completed);

		return {
			totalChunks: this.chunks.length,
			completedChunks: completed,
			failedChunks: failed,
			uploadedBytes: this.uploadedBytes,
			totalRetries,
			avgSpeed: avgSpeed * 1000,
			adaptiveChunkSize: this.adaptiveChunkSize,
			concurrency: this.config.maxConcurrency,
			availablePermits: this.semaphore.getAvailablePermits()
		};
	}

	/**
	 * 🛑 停止上传
	 */
	async stop(): Promise<void> {
		for (const chunk of this.chunks) {
			if (chunk.status === 'pending' || chunk.status === 'uploading') {
				chunk.status = 'failed';
			}
		}

		this.logger.info('🛑 并发分片上传已停止');
	}
}

export default ConcurrentChunkUploader;
