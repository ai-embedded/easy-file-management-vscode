/**
 * 流式传输支持
 * 减少大文件传输的内存占用，支持进度回调和错误恢复
 */

import { EventEmitter } from 'events';
import { Readable, Writable, Transform } from 'stream';
import { TcpClient } from './TcpClient';
import { TcpCommand } from '../../shared/constants/TcpCommands';
import { Logger } from '../../shared/utils/Logger';

const logger = new Logger('StreamTransfer');

/**
 * 流式传输配置
 */
interface StreamConfig {
  chunkSize?: number;           // 块大小（默认 32KB）
  highWaterMark?: number;        // 流缓冲区大小（默认 64KB）
  concurrency?: number;          // 并发块数量（默认 3）
  retryAttempts?: number;        // 重试次数（默认 3）
  retryDelay?: number;           // 重试延迟（毫秒，默认 1000）
  enableCompression?: boolean;   // 是否启用压缩（默认 false）
  onProgress?: (progress: StreamProgress) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

/**
 * 流式传输进度
 */
interface StreamProgress {
  transferred: number;    // 已传输字节数
  total: number;         // 总字节数
  percent: number;       // 完成百分比
  speed: number;         // 传输速度（字节/秒）
  remaining: number;     // 剩余时间（秒）
  chunkIndex: number;    // 当前块索引
  totalChunks: number;   // 总块数
}

/**
 * 流式下载器
 */
export class StreamDownloader extends EventEmitter {
	private client: TcpClient;
	private config: Required<StreamConfig>;
	private startTime = 0;
	private transferred = 0;
	private total = 0;
	private chunkQueue: Array<{ index: number; data: Buffer }> = [];
	private activeDownloads: Set<number> = new Set();
	private completedChunks: Set<number> = new Set();
	private aborted = false;
	// 🔧 修复P3问题：添加有序写入支持，避免并发下载乱序
	private expectedChunkIndex = 0;   // 下一个期望写入的块索引
	private pendingChunks: Map<number, Buffer> = new Map(); // 暂存乱序到达的块
  
	constructor(client: TcpClient, config: StreamConfig = {}) {
		super();
		this.client = client;
    
		// 初始化配置
		this.config = {
			chunkSize: config.chunkSize || 32 * 1024,  // 32KB
			highWaterMark: config.highWaterMark || 64 * 1024,  // 64KB
			concurrency: config.concurrency || 3,
			retryAttempts: config.retryAttempts || 3,
			retryDelay: config.retryDelay || 1000,
			enableCompression: config.enableCompression || false,
			onProgress: config.onProgress || (() => {}),
			onError: config.onError || (() => {}),
			onComplete: config.onComplete || (() => {})
		};
	}
  
	/**
   * 流式下载文件
   */
	async download(filePath: string): Promise<Readable> {
		console.log(`[StreamDownloader] 开始流式下载: ${filePath}`);
		this.startTime = Date.now();
    
		// 1. 获取文件信息
		const fileInfo = await this.getFileInfo(filePath);
		this.total = fileInfo.size;
		const totalChunks = Math.ceil(this.total / this.config.chunkSize);
    
		console.log(`[StreamDownloader] 文件大小: ${this.total} 字节, 分为 ${totalChunks} 块`);
    
		// 2. 创建可读流
		const readableStream = new Readable({
			highWaterMark: this.config.highWaterMark,
			read: () => {
				// 由下载逻辑推送数据
			}
		});
    
		// 3. 开始并发下载
		this.downloadChunksConcurrently(filePath, totalChunks, readableStream);
    
		return readableStream;
	}
  
	/**
   * 中止下载
   */
	abort(): void {
		this.aborted = true;
		this.emit('abort');
	}
  
	// === 私有方法 ===
  
	/**
   * 获取文件信息
   */
	private async getFileInfo(filePath: string): Promise<any> {
		const response = await this.client.getFileInfo(filePath);
		if (!response.success) {
			throw new Error(`获取文件信息失败: ${response.message}`);
		}
    
		// 修复：正确处理文件信息的返回格式
		const data = response.data;
    
		// 优先使用 fileSize 字段，其次使用 files[0].size
		let fileSize: number;
		if (data.fileSize !== undefined) {
			// 处理 int64 字段可能是 string 或 number 的情况
			fileSize = typeof data.fileSize === 'string' ? Number(data.fileSize) : data.fileSize;
		} else if (data.files && data.files.length > 0 && data.files[0].size !== undefined) {
			// 从文件列表中获取第一个文件的大小
			fileSize = typeof data.files[0].size === 'string' ? Number(data.files[0].size) : data.files[0].size;
		} else {
			throw new Error('无法获取文件大小信息');
		}
    
		// 返回标准化的文件信息对象
		return {
			size: fileSize,
			...data
		};
	}
  
	/**
   * 并发下载块
   */
	private async downloadChunksConcurrently(
		filePath: string,
		totalChunks: number,
		stream: Readable
	): Promise<void> {
		let nextChunkIndex = 0;
    
		// 启动初始并发下载
		const downloads: Promise<void>[] = [];
		for (let i = 0; i < Math.min(this.config.concurrency, totalChunks); i++) {
			downloads.push(this.downloadChunk(filePath, nextChunkIndex++, totalChunks, stream));
		}
    
		// 等待所有块下载完成
		while (this.completedChunks.size < totalChunks && !this.aborted) {
			// 等待任一下载完成
			await Promise.race(downloads.filter((d): d is Promise<void> => !!d));
      
			// 启动新的下载
			if (nextChunkIndex < totalChunks && 
          this.activeDownloads.size < this.config.concurrency && 
          !this.aborted) {
				const index = downloads.findIndex(d => !d);
				const newDownload = this.downloadChunk(filePath, nextChunkIndex++, totalChunks, stream);
				if (index >= 0) {
					downloads[index] = newDownload;
				} else {
					downloads.push(newDownload);
				}
			}
      
			// 清理已完成的下载
			for (let i = 0; i < downloads.length; i++) {
				if (downloads[i] && await this.isPromiseResolved(downloads[i]!)) {
					(downloads as Array<Promise<void> | null>)[i] = null;
				}
			}
		}
    
		// 结束流
		if (!this.aborted) {
			stream.push(null);
			this.config.onComplete();
			console.log(`[StreamDownloader] 下载完成，耗时: ${(Date.now() - this.startTime) / 1000}秒`);
		}
	}
  
	/**
   * 下载单个块
   */
	private async downloadChunk(
		filePath: string,
		chunkIndex: number,
		totalChunks: number,
		stream: Readable
	): Promise<void> {
		if (this.aborted) {return;}
    
		this.activeDownloads.add(chunkIndex);
		let attempts = 0;
    
		while (attempts < this.config.retryAttempts && !this.aborted) {
			try {
				const start = chunkIndex * this.config.chunkSize;
				const end = Math.min(start + this.config.chunkSize, this.total);
        
				// 发送下载请求
				const response = await this.client.downloadChunk(filePath, start, end);
        
				if (!response.success) {
					throw new Error(response.message || '下载块失败');
				}
        
				// 处理块数据
				const chunkData = Buffer.from(response.data);
        
				// 按顺序写入流
				this.writeChunkToStream(chunkIndex, chunkData, stream);
        
				// 更新进度
				this.transferred += chunkData.length;
				this.completedChunks.add(chunkIndex);
				this.updateProgress(chunkIndex, totalChunks);
        
				break; // 成功，退出重试循环
        
			} catch (error) {
				attempts++;
				console.warn(`[StreamDownloader] 块 ${chunkIndex} 下载失败 (尝试 ${attempts}/${this.config.retryAttempts}):`, error);
        
				if (attempts >= this.config.retryAttempts) {
					this.config.onError(error as Error);
					throw error;
				}
        
				// 重试延迟
				await this.delay(this.config.retryDelay * attempts);
			}
		}
    
		this.activeDownloads.delete(chunkIndex);
	}
  
	/**
   * 🔧 修复P3问题：按顺序写入块到流，确保数据有序
   */
	private writeChunkToStream(index: number, data: Buffer, stream: Readable): void {
		// 如果是过期的块，直接丢弃
		if (index < this.expectedChunkIndex) {
			logger.warn(`⚠️ 丢弃过期块 ${index}，当前期望 ${this.expectedChunkIndex}`);
			return;
		}
    
		if (this.shouldQueueChunk(index)) {
			// 暂存乱序到达的块
			this.pendingChunks.set(index, data);
			logger.debug(`📦 暂存乱序块 ${index}，等待有序写入 (队列中: ${this.pendingChunks.size} 个)`);
		} else {
			// 直接写入当前期望的块
			if (index === this.expectedChunkIndex) {
				stream.push(data);
				this.expectedChunkIndex++;
				logger.debug(`✅ 写入块 ${index}，下一个期望 ${this.expectedChunkIndex}`);
        
				// 检查是否有后续连续的块可以写入
				while (this.pendingChunks.has(this.expectedChunkIndex)) {
					const nextData = this.pendingChunks.get(this.expectedChunkIndex)!;
					this.pendingChunks.delete(this.expectedChunkIndex);
					stream.push(nextData);
					logger.debug(`✅ 连续写入块 ${this.expectedChunkIndex}，队列剩余: ${this.pendingChunks.size} 个`);
					this.expectedChunkIndex++;
				}
			}
		}
	}
  
	/**
   * 🔧 修复P3问题：判断块是否需要排队等待有序写入
   */
	private shouldQueueChunk(index: number): boolean {
		// 如果是下一个期望的块，可以直接写入
		if (index === this.expectedChunkIndex) {
			return false; // 不需要排队，直接写入
		}
    
		// 如果是过期的块（已经处理过的），忽略
		if (index < this.expectedChunkIndex) {
			logger.warn(`⚠️ 收到过期块 ${index}，当前期望 ${this.expectedChunkIndex}，忽略`);
			return false; // 不排队也不写入，直接丢弃
		}
    
		// 如果是未来的块，需要排队等待
		logger.debug(`🔄 块 ${index} 需要排队，当前期望 ${this.expectedChunkIndex}`);
		return true; // 需要排队等待
	}
  
	/**
   * 更新进度
   */
	private updateProgress(chunkIndex: number, totalChunks: number): void {
		const elapsed = (Date.now() - this.startTime) / 1000;
		const speed = elapsed > 0 ? this.transferred / elapsed : 0;
		const remaining = speed > 0 ? (this.total - this.transferred) / speed : 0;
		const percent = this.total > 0 ? (this.transferred / this.total) * 100 : 0;
    
		const progress: StreamProgress = {
			transferred: this.transferred,
			total: this.total,
			percent: Math.round(percent),
			speed: Math.round(speed),
			remaining: Math.round(remaining),
			chunkIndex,
			totalChunks
		};
    
		this.config.onProgress(progress);
		this.emit('progress', progress);
	}
  
	/**
   * 检查 Promise 是否已解决
   */
	private async isPromiseResolved(promise: Promise<any>): Promise<boolean> {
		try {
			await Promise.race([promise, this.delay(0)]);
			return true;
		} catch {
			return true;
		}
	}
  
	/**
   * 延迟函数
   */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

/**
 * 流式上传器
 */
export class StreamUploader extends EventEmitter {
	private client: TcpClient;
	private config: Required<StreamConfig>;
	private startTime = 0;
	private transferred = 0;
	private total = 0;
	private uploadQueue: Array<{ index: number; data: Buffer }> = [];
	private activeUploads: Set<number> = new Set();
	private completedChunks: Set<number> = new Set();
	private aborted = false;
  
	constructor(client: TcpClient, config: StreamConfig = {}) {
		super();
		this.client = client;
    
		// 初始化配置
		this.config = {
			chunkSize: config.chunkSize || 32 * 1024,  // 32KB
			highWaterMark: config.highWaterMark || 64 * 1024,  // 64KB
			concurrency: config.concurrency || 3,
			retryAttempts: config.retryAttempts || 3,
			retryDelay: config.retryDelay || 1000,
			enableCompression: config.enableCompression || false,
			onProgress: config.onProgress || (() => {}),
			onError: config.onError || (() => {}),
			onComplete: config.onComplete || (() => {})
		};
	}
  
	/**
   * 流式上传文件
   */
	async upload(targetPath: string, filename: string, fileSize: number): Promise<Writable> {
		console.log(`[StreamUploader] 开始流式上传: ${targetPath}/${filename}, 大小: ${fileSize} 字节`);
		this.startTime = Date.now();
		this.total = fileSize;
    
		const totalChunks = Math.ceil(fileSize / this.config.chunkSize);
		let chunkIndex = 0;
    
		// 1. 发送上传请求
		await this.initializeUpload(targetPath, filename, fileSize, totalChunks);
    
		// 2. 创建可写流
		const writableStream = new Writable({
			highWaterMark: this.config.highWaterMark,
			write: async (chunk: Buffer, encoding: string, callback: (error?: Error) => void) => {
				if (this.aborted) {
					callback(new Error('上传已中止'));
					return;
				}
        
				try {
					// 上传块
					await this.uploadChunk(chunk, chunkIndex++, totalChunks);
					callback();
				} catch (error) {
					callback(error as Error);
				}
			},
			final: async (callback: (error?: Error) => void) => {
				if (!this.aborted) {
					try {
						await this.finalizeUpload(totalChunks);
						this.config.onComplete();
						callback();
					} catch (error) {
						callback(error as Error);
					}
				}
			}
		});
    
		return writableStream;
	}
  
	/**
   * 创建转换流（用于压缩等处理）
   */
	createTransformStream(): Transform {
		return new Transform({
			transform: (chunk: Buffer, encoding: string, callback: (error?: Error, data?: any) => void) => {
				// 这里可以添加压缩等处理
				if (this.config.enableCompression) {
					// TODO: 实现压缩逻辑
					callback(null, chunk);
				} else {
					callback(null, chunk);
				}
			}
		});
	}
  
	/**
   * 中止上传
   */
	abort(): void {
		this.aborted = true;
		this.emit('abort');
	}
  
	// === 私有方法 ===
  
	/**
   * 初始化上传
   */
	private async initializeUpload(
		targetPath: string,
		filename: string,
		fileSize: number,
		totalChunks: number
	): Promise<void> {
		const response = await this.client.uploadInit(targetPath, filename, {
			size: fileSize,
			chunkSize: this.config.chunkSize,
			totalChunks,
			compression: this.config.enableCompression
		});
    
		if (!response.success) {
			throw new Error(`初始化上传失败: ${response.message}`);
		}
	}
  
	/**
   * 上传单个块
   */
	private async uploadChunk(
		data: Buffer,
		chunkIndex: number,
		totalChunks: number
	): Promise<void> {
		let attempts = 0;
    
		while (attempts < this.config.retryAttempts && !this.aborted) {
			try {
				const response = await this.client.uploadChunk(data, chunkIndex, totalChunks);
        
				if (!response.success) {
					throw new Error(response.message || '上传块失败');
				}
        
				// 更新进度
				this.transferred += data.length;
				this.completedChunks.add(chunkIndex);
				this.updateProgress(chunkIndex, totalChunks);
        
				break; // 成功，退出重试循环
        
			} catch (error) {
				attempts++;
				console.warn(`[StreamUploader] 块 ${chunkIndex} 上传失败 (尝试 ${attempts}/${this.config.retryAttempts}):`, error);
        
				if (attempts >= this.config.retryAttempts) {
					this.config.onError(error as Error);
					throw error;
				}
        
				// 重试延迟
				await this.delay(this.config.retryDelay * attempts);
			}
		}
	}
  
	/**
   * 完成上传
   */
	private async finalizeUpload(totalChunks: number): Promise<void> {
		const response = await this.client.uploadComplete(totalChunks, this.total);
    
		if (!response.success) {
			throw new Error(`完成上传失败: ${response.message}`);
		}
    
		console.log(`[StreamUploader] 上传完成，耗时: ${(Date.now() - this.startTime) / 1000}秒`);
	}
  
	/**
   * 更新进度
   */
	private updateProgress(chunkIndex: number, totalChunks: number): void {
		const elapsed = (Date.now() - this.startTime) / 1000;
		const speed = elapsed > 0 ? this.transferred / elapsed : 0;
		const remaining = speed > 0 ? (this.total - this.transferred) / speed : 0;
		const percent = this.total > 0 ? (this.transferred / this.total) * 100 : 0;
    
		const progress: StreamProgress = {
			transferred: this.transferred,
			total: this.total,
			percent: Math.round(percent),
			speed: Math.round(speed),
			remaining: Math.round(remaining),
			chunkIndex,
			totalChunks
		};
    
		this.config.onProgress(progress);
		this.emit('progress', progress);
	}
  
	/**
   * 延迟函数
   */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

// 🔧 修复：暂时移除模块扩展声明，避免调用未实现的方法导致错误
// 
// 注意：流式传输功能当前仅提供类定义，需要手动创建 StreamDownloader/StreamUploader 实例
// 基本的分块上传下载功能已在 TcpClient.uploadFile/downloadFile 中实现
// 
// 使用示例:
// const downloader = new StreamDownloader(tcpClient, config);
// const stream = await downloader.download(filePath);
// 
// const uploader = new StreamUploader(tcpClient, config);
// const stream = await uploader.upload(targetPath, filename, fileSize);

// TODO: 如需集成到 TcpClient，需要在 TcpClient.ts 中添加以下方法的实现：
// - streamDownload(filePath: string, config?: StreamConfig): Promise<Readable>
// - downloadChunk(filePath: string, start: number, end: number): Promise<any>
// - streamUpload(targetPath: string, filename: string, fileSize: number, config?: StreamConfig): Promise<Writable>
// - uploadInit(targetPath: string, filename: string, options: any): Promise<any>
// - uploadChunk(data: Buffer, index: number, total: number): Promise<any>
// - uploadComplete(totalChunks: number, fileSize: number): Promise<any>
