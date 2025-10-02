import { Client as BasicFtp } from 'basic-ftp';
import { FtpConnectionPool } from '../connection/FtpConnectionPool';
import { TransferModeSelector, FtpTransferMode } from '../connection/TransferModeSelector';
import { RetryManager, OperationType } from '../../../shared/connection';
import { FtpConfig, UploadConfig, DownloadConfig, FileOperationResult, FileItem } from '../../../shared/types';
import type { Readable as NodeReadable } from 'stream';

interface StandardOptimizationConfig {
  connectionReuse: boolean;
  streamProcessing: boolean;
  localCache: boolean;
  /**
   * 客户端压缩 - 警告：这会永久改变文件内容！
   * 注意：启用此选项会在上传前对文件进行gzip压缩，服务器将存储压缩后的内容。
   * 这不是链路压缩（MODE Z），而是内容压缩，下载者需要手动解压。
   * 默认值：false（强烈建议保持关闭）
   */
  clientCompression: boolean;
  intelligentRetry: boolean;
  transferModeOptimization: boolean;
  bufferSize: number;
  maxMemoryUsage: number;
  enableLogging: boolean;
}

interface OptimizationStats {
  connectionsReused: number;
  connectionsCached: number;
  transfersOptimized: number;
  bytesTransferred: number;
  averageSpeed: number;
  retryCount: number;
}

/**
 * 标准 FTP 优化器 - 第一层优化
 * 
 * 在任何标准 FTP 服务器上都能工作的优化功能：
 * - 连接管理优化（连接复用）
 * - 智能传输模式选择
 * - 流式数据处理
 * - 本地缓存
 * - 智能重试机制
 * - 客户端压缩预处理
 */
export class StandardFtpOptimizer {
	private config: StandardOptimizationConfig;
	private connectionPool: FtpConnectionPool;
	private transferModeSelector: TransferModeSelector;
	private retryManager: RetryManager;
	private stats: OptimizationStats;
	private metadataCache = new Map<string, { data: FileItem[]; timestamp: number }>();
	private cacheValidDuration = 60000; // 1 分钟缓存有效期

	constructor(config: Partial<StandardOptimizationConfig> = {}) {
		this.config = {
			connectionReuse: config.connectionReuse ?? true,
			streamProcessing: config.streamProcessing ?? true,
			localCache: config.localCache ?? true,
			clientCompression: config.clientCompression ?? false, // 默认关闭，避免改变文件内容语义
			intelligentRetry: config.intelligentRetry ?? true,
			transferModeOptimization: config.transferModeOptimization ?? true,
			bufferSize: config.bufferSize ?? 64 * 1024, // 64KB
			maxMemoryUsage: config.maxMemoryUsage ?? 100 * 1024 * 1024, // 100MB
			enableLogging: config.enableLogging ?? true
		};

		// 初始化组件
		this.connectionPool = new FtpConnectionPool({
			maxConnections: 3,
			maxIdleTime: 300000,
			enableLogging: this.config.enableLogging
		});

		this.transferModeSelector = new TransferModeSelector({
			enableNetworkDetection: this.config.transferModeOptimization,
			enableLogging: this.config.enableLogging
		});

		this.retryManager = new RetryManager({
			maxAttempts: 3,
			initialDelay: 1000,
			maxDelay: 10000,
			enableLogging: this.config.enableLogging
		});

		// 初始化统计信息
		this.stats = {
			connectionsReused: 0,
			connectionsCached: 0,
			transfersOptimized: 0,
			bytesTransferred: 0,
			averageSpeed: 0,
			retryCount: 0
		};
	}

	/**
   * 优化的连接方法
   */
	async connect(ftpConfig: FtpConfig): Promise<BasicFtp> {
		if (this.config.enableLogging) {
			console.log('[StandardFtpOptimizer] 开始优化连接');
		}

		let client: BasicFtp;

		if (this.config.connectionReuse) {
			// 使用连接池获取连接
			client = await this.connectionPool.getConnection(ftpConfig);
			this.stats.connectionsReused++;
      
			if (this.config.enableLogging) {
				console.log('[StandardFtpOptimizer] 使用连接池连接');
			}
		} else {
			// 创建新连接
			client = new BasicFtp();
			await client.access({
				host: ftpConfig.host,
				port: ftpConfig.port || 21,
				user: ftpConfig.username,
				password: ftpConfig.password,
				secure: ftpConfig.secure || false
			});
		}

		// 优化传输模式
		if (this.config.transferModeOptimization) {
			const optimalMode = await this.transferModeSelector.selectOptimalTransferMode(client, ftpConfig.host);
			await this.setTransferMode(client, optimalMode);
      
			if (this.config.enableLogging) {
				console.log(`[StandardFtpOptimizer] 设置传输模式: ${optimalMode}`);
			}
		}

		return client;
	}

	/**
   * 优化的文件列表获取
   */
	async listFiles(client: BasicFtp, remotePath = '/', ftpConfig: FtpConfig): Promise<FileItem[]> {
		const cacheKey = `${ftpConfig.host}:${ftpConfig.port}:${remotePath}`;

		// 检查本地缓存
		if (this.config.localCache && this.isCacheValid(cacheKey)) {
			if (this.config.enableLogging) {
				console.log('[StandardFtpOptimizer] 使用缓存的文件列表');
			}
			return this.metadataCache.get(cacheKey)!.data;
		}

		// 执行文件列表获取（带重试）
		const executeList = async (): Promise<FileItem[]> => {
			const normalizedPath = remotePath.startsWith('/') ? remotePath : `/${  remotePath}`;
			const finalPath = normalizedPath === '' || normalizedPath === '/' ? '/' : normalizedPath;

			const fileList = await client.list(finalPath);
      
			const items: FileItem[] = fileList.map(item => ({
				name: item.name,
				path: this.joinPath(finalPath, item.name),
				type: item.isDirectory ? 'directory' : 'file',
				size: item.size,
				lastModified: item.modifiedAt || new Date(),
				permissions: item.permissions?.toString(),
				isReadonly: false
			}));

			// 缓存结果
			if (this.config.localCache) {
				this.metadataCache.set(cacheKey, {
					data: items,
					timestamp: Date.now()
				});
			}

			return items;
		};

		if (this.config.intelligentRetry) {
			return this.retryManager.executeWithRetry(executeList, OperationType.LIST, `list_${remotePath}`);
		} else {
			return executeList();
		}
	}

	/**
   * 优化的文件上传
   */
	async uploadFile(client: BasicFtp, config: UploadConfig): Promise<FileOperationResult> {
		const startTime = Date.now();
		const fileSize = config.buffer?.length || 0;

		if (this.config.enableLogging) {
			console.log(`[StandardFtpOptimizer] 开始优化上传: ${config.filename} (${fileSize} bytes)`);
		}

		const executeUpload = async (): Promise<FileOperationResult> => {
			if (!config.buffer) {
				throw new Error('没有提供文件数据');
			}

			// 预处理：客户端压缩（警告：这会永久改变文件内容）
			let processedBuffer = config.buffer;
			if (this.config.clientCompression && this.shouldCompress(config.filename, fileSize)) {
				console.warn(`[StandardFtpOptimizer] 警告：正在对文件 ${config.filename} 进行客户端压缩，这将改变文件内容！`);
				processedBuffer = await this.compressBuffer(config.buffer);
        
				if (this.config.enableLogging) {
					console.log(`[StandardFtpOptimizer] 客户端压缩: ${config.buffer.length} -> ${processedBuffer.length} bytes`);
					console.log('[StandardFtpOptimizer] 注意：服务器将存储压缩后的内容，下载者需要手动解压');
				}
			}

			// 流式处理上传
			if (this.config.streamProcessing && fileSize > this.config.bufferSize) {
				return this.streamUpload(client, config, processedBuffer);
			} else {
				return this.standardUpload(client, config, processedBuffer);
			}
		};

		let result: FileOperationResult;
		if (this.config.intelligentRetry) {
			result = await this.retryManager.executeWithRetry(executeUpload, OperationType.UPLOAD, `upload_${config.filename}`);
		} else {
			result = await executeUpload();
		}

		if (result.success) {
			this.invalidateCache();
			if (this.config.enableLogging) {
				console.log('[StandardFtpOptimizer] 上传完成', {
					file: config.filename,
					target: result.data?.path ?? config.targetPath,
					size: fileSize
				});
			}
		} else if (this.config.enableLogging) {
			console.warn('[StandardFtpOptimizer] 上传失败', {
				file: config.filename,
				target: config.targetPath,
				size: fileSize,
				message: result.message
			});
		}

		// 更新统计
		this.updateTransferStats(fileSize, Date.now() - startTime);
    
		return result;
	}

	/**
   * 优化的文件下载
   */
	async downloadFile(client: BasicFtp, config: DownloadConfig): Promise<Buffer> {
		const startTime = Date.now();

		if (this.config.enableLogging) {
			console.log(`[StandardFtpOptimizer] 开始优化下载: ${config.filePath}`);
		}

		const executeDownload = async (): Promise<Buffer> => {
			if (this.config.streamProcessing) {
				return this.streamDownload(client, config);
			}
			return this.standardDownload(client, config);
		};

		let result: Buffer;
		if (this.config.intelligentRetry) {
			result = await this.retryManager.executeWithRetry(executeDownload, OperationType.DOWNLOAD, `download_${config.filePath}`);
		} else {
			result = await executeDownload();
		}

		let bytesTransferred = result.length;
		if (config.targetFile) {
			try {
				const fs = await import('fs');
				const stats = await fs.promises.stat(config.targetFile);
				bytesTransferred = stats.size;
			} catch {
				bytesTransferred = result.length;
			}
		}

		this.updateTransferStats(bytesTransferred, Math.max(Date.now() - startTime, 1));

		return result;
	}

	/**
   * 释放连接
   */
	releaseConnection(client: BasicFtp): void {
		if (this.config.connectionReuse) {
			this.connectionPool.releaseConnection(client);
		} else {
			try {
				client.close();
			} catch (error) {
				console.warn('[StandardFtpOptimizer] 关闭连接失败:', error);
			}
		}
	}

	/**
   * 获取优化统计信息
   */
	getOptimizationStats(): OptimizationStats & { connectionPoolStats: any } {
		return {
			...this.stats,
			connectionPoolStats: this.connectionPool.getStats()
		};
	}

	getConnectionPool(): FtpConnectionPool {
		return this.connectionPool;
	}

	getRetryManager(): RetryManager {
		return this.retryManager;
	}

	invalidateCache(): void {
		this.metadataCache.clear();
	}

	/**
   * 清理资源
   */
	async cleanup(): Promise<void> {
		await this.connectionPool.closeAll();
		this.metadataCache.clear();
		this.transferModeSelector.clearCache();
	}

	// 私有方法实现

	private async setTransferMode(client: BasicFtp, mode: FtpTransferMode): Promise<void> {
		// basic-ftp 库的传输模式设置
		// 注意：basic-ftp 默认使用被动模式，这里主要是为了演示
		if (mode === 'passive') {
			// 被动模式是默认的，通常不需要特别设置
		} else {
			// 主动模式需要特殊设置，但 basic-ftp 的支持有限
			console.warn('[StandardFtpOptimizer] 主动模式支持有限，使用被动模式');
		}
	}

	private isCacheValid(key: string): boolean {
		const cached = this.metadataCache.get(key);
		return !!(cached && (Date.now() - cached.timestamp) < this.cacheValidDuration);
	}

	private shouldCompress(filename: string, fileSize: number): boolean {
		// 警告：压缩会永久改变文件内容，不是链路压缩
		// 只压缩文本文件且大小超过阈值
		const textExtensions = ['.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.ts'];
		const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    
		return textExtensions.includes(extension) && fileSize > 1024; // 1KB 阈值
	}

	private async compressBuffer(buffer: Buffer): Promise<Buffer> {
		// 简化的压缩实现 - 实际应用中应使用 zlib
		const { gzip } = await import('zlib');
		const { promisify } = await import('util');
		const gzipAsync = promisify(gzip);
    
		try {
			return await gzipAsync(buffer) as Buffer;
		} catch (error) {
			console.warn('[StandardFtpOptimizer] 压缩失败，使用原始数据:', error);
			return buffer;
		}
	}

	private async streamUpload(client: BasicFtp, config: UploadConfig, buffer: Buffer): Promise<FileOperationResult> {
		const targetFilePath = config.targetPath.endsWith('/')
			? `${config.targetPath}${config.filename}`
			: `${config.targetPath}/${config.filename}`;

		await this.uploadBufferWithProgress(client, config, buffer, targetFilePath);

		this.stats.transfersOptimized++;

		return {
			success: true,
			message: '文件上传成功（流式处理）',
			data: {
				filename: config.filename,
				size: buffer.length,
				path: targetFilePath
			}
		};
	}

	private async standardUpload(client: BasicFtp, config: UploadConfig, buffer: Buffer): Promise<FileOperationResult> {
		const targetFilePath = config.targetPath.endsWith('/')
			? `${config.targetPath}${config.filename}`
			: `${config.targetPath}/${config.filename}`;

		if (this.config.enableLogging) {
			console.log('[StandardFtpOptimizer] 准备标准上传', {
				file: config.filename,
				path: targetFilePath,
				size: buffer.length
			});
		}

		await this.uploadBufferWithProgress(client, config, buffer, targetFilePath);

		return {
			success: true,
			message: '文件上传成功',
			data: {
				filename: config.filename,
				size: buffer.length,
				path: targetFilePath
			}
		};
	}

	private async uploadBufferWithProgress(
		client: BasicFtp,
		config: UploadConfig,
		buffer: Buffer,
		targetFilePath: string
	): Promise<void> {
		const streamModule = await import('stream');
		const { Readable: readableStreamCtor, Transform: transformStreamCtor } = streamModule;

		const totalBytes = buffer.length;
		const chunkSize = Math.max(this.config.bufferSize, 64 * 1024);
		const logEnabled = this.config.enableLogging;
		const onProgress = config.onProgress;
		const startTime = Date.now();
		let loaded = 0;
		let lastLoggedPercent = -1;

		const emitProgress = (loadedBytes: number, isFinal = false) => {
			const clampedLoaded = Math.min(loadedBytes, totalBytes);
			const percent = totalBytes > 0
				? Math.min(100, Math.round((clampedLoaded / totalBytes) * 100))
				: isFinal ? 100 : 0;
			const elapsed = Date.now() - startTime;
			const transferRate = elapsed > 0 ? Math.round((clampedLoaded / elapsed) * 1000) : 0;

			if (logEnabled && (isFinal || percent !== lastLoggedPercent)) {
				console.log('[StandardFtpOptimizer] 上传进度', {
					file: config.filename,
					loaded: clampedLoaded,
					total: totalBytes,
					percent
				});
				lastLoggedPercent = percent;
			}

			onProgress?.({
				total: totalBytes || clampedLoaded,
				loaded: clampedLoaded,
				percent,
				filename: config.filename,
				transferRate
			});
		};

		emitProgress(0);

		let offset = 0;
		const source = new readableStreamCtor({
			highWaterMark: chunkSize,
			read(this: NodeReadable) {
				if (offset >= totalBytes) {
					this.push(null);
					return;
				}
				const end = Math.min(offset + chunkSize, totalBytes);
				const chunk = buffer.subarray(offset, end);
				offset = end;
				this.push(chunk);
			}
		});

		const progressTransform = new transformStreamCtor({
			transform(chunk: Buffer, encoding: BufferEncoding, callback) {
				void encoding;
				loaded += chunk.length;
				emitProgress(loaded);
				callback(null, chunk);
			}
		});

		const uploadStream = source.pipe(progressTransform);

		try {
			await client.uploadFrom(uploadStream, targetFilePath);
		} finally {
			if (!uploadStream.destroyed) {
				uploadStream.destroy();
			}
			if (!source.destroyed) {
				source.destroy();
			}
		}

		emitProgress(totalBytes, true);
	}

	private async streamDownload(client: BasicFtp, config: DownloadConfig): Promise<Buffer> {
		const fs = await import('fs');
		const os = await import('os');
		const path = await import('path');

		const tempDir = os.tmpdir();
		const tempFile = path.join(tempDir, `ftp_download_stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
		const hasTargetFile = typeof config.targetFile === 'string' && config.targetFile.trim().length > 0;
		const targetPath = hasTargetFile ? config.targetFile!.trim() : undefined;

		try {
			// 设置进度跟踪
			if (config.onProgress) {
				client.trackProgress(info => {
					config.onProgress?.({
						total: info.bytesOverall || 1,
						loaded: info.bytes,
						percent: Math.round((info.bytes / (info.bytesOverall || 1)) * 100),
						filename: config.filename || this.getFilenameFromPath(config.filePath!)
					});
				});
			}

			// 下载到临时文件
			await client.downloadTo(tempFile, config.filePath!);

			// 停止进度跟踪
			client.trackProgress();

			this.stats.transfersOptimized++;

			if (hasTargetFile && targetPath) {
				const targetDir = path.dirname(targetPath);
				await fs.promises.mkdir(targetDir, { recursive: true });
				try {
					await fs.promises.rename(tempFile, targetPath);
				} catch (renameError: any) {
					if (renameError?.code === 'EXDEV') {
						await fs.promises.copyFile(tempFile, targetPath);
						await fs.promises.unlink(tempFile).catch(() => undefined);
					} else {
						await fs.promises.unlink(tempFile).catch(() => undefined);
						throw renameError;
					}
				}

				return Buffer.alloc(0);
			}

			// 读取文件内容
			const fileBuffer = await fs.promises.readFile(tempFile);
			await fs.promises.unlink(tempFile);
			return fileBuffer;

		} catch (error) {
			// 清理
			client.trackProgress();
			try {
				await fs.promises.unlink(tempFile);
			} catch {}
			throw error;
		}
	}

	private async standardDownload(client: BasicFtp, config: DownloadConfig): Promise<Buffer> {
		// 标准下载实现（复用现有逻辑）
		return this.streamDownload(client, config);
	}

	private updateTransferStats(bytes: number, timeMs: number): void {
		this.stats.bytesTransferred += bytes;
		const speedBps = bytes / (timeMs / 1000);
    
		// 计算平均速度（简化的移动平均）
		if (this.stats.averageSpeed === 0) {
			this.stats.averageSpeed = speedBps;
		} else {
			this.stats.averageSpeed = (this.stats.averageSpeed * 0.8) + (speedBps * 0.2);
		}
	}

	private joinPath(basePath: string, fileName: string): string {
		if (basePath.endsWith('/')) {
			return `${basePath}${fileName}`;
		}
		return `${basePath}/${fileName}`;
	}

	private getFilenameFromPath(filePath: string): string {
		return filePath.split('/').pop() || '';
	}
}
