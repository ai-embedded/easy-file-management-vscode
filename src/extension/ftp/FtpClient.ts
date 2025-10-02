import { Client as BasicFtp } from 'basic-ftp';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { RetryManager, OperationType } from '../../shared/connection';
import { ConcurrencyManager, TaskPriority } from '../../shared/monitoring';
import { FtpMetricsCollector, FtpMetrics } from './FtpMetrics';
import { sanitizePath, maskSensitiveInfo, maskConfig } from './utils/SecurityUtils';
import { PassThrough, Readable as NodeReadable } from 'stream';
import { handleInterruptedDownload } from '../utils/DownloadCleanup';

import {
	FtpConfig,
	FileItem,
	UploadConfig,
	DownloadConfig,
	FileOperationResult
} from '../../shared/types';

interface FtpStreamUploadOptions {
	filename: string;
	targetPath: string;
	totalSize: number;
	chunkSize?: number;
}

export interface FtpStreamUploadHandle {
	sessionId: string;
	acceptedChunkSize: number;
	writeChunk(data: Buffer): Promise<void>;
	finish(): Promise<FileOperationResult>;
	abort(reason?: string): Promise<void>;
}

/**
 * FTP客户端 - 基于Node.js直连实现
 * 使用basic-ftp库提供完整的FTP/FTPS支持
 * 集成重试管理器支持自动重试
 */
export class FtpClient {
	private client = new BasicFtp();
	private isConnected = false;
	private config?: FtpConfig;
	private retryManager: RetryManager;
	private concurrencyManager: ConcurrencyManager;
	private metricsCollector: FtpMetricsCollector;
  
	constructor() {
		// 初始化重试管理器
		this.retryManager = new RetryManager({
			maxAttempts: 3,
			initialDelay: 1000,
			maxDelay: 10000,
			enableLogging: true
		});
    
		// 初始化并发管理器（限制同时进行的FTP操作数）
		this.concurrencyManager = new ConcurrencyManager({
			maxConcurrency: 1, // 单连接串行执行，遵循标准FTP控制流程
			maxQueueSize: 50,
			defaultTimeout: 60000,
			enablePriority: true,
			enableRetry: false // 重试由RetryManager处理
		});
    
		// 初始化指标收集器
		this.metricsCollector = new FtpMetricsCollector();
	}


	/**
   * 连接到FTP服务器
   */
	async connect(config: FtpConfig): Promise<boolean> {
		try {
			const maskedHost = maskSensitiveInfo(config.host, config);
			console.log(`[FtpClient] 连接FTP服务器: ${maskedHost}:${config.port || 21}`);
      
			this.config = config;
      
			// 默认启用证书验证，除非明确禁用
			const rejectUnauthorized = config.validateCertificate !== false;
      
			await this.client.access({
				host: config.host,
				port: config.port || 21,
				user: config.username,
				password: config.password,
				secure: config.secure || false,
				secureOptions: config.secure ? { rejectUnauthorized } : undefined
			});

			// 优先使用 UTF-8 编码以支持中文路径/文件名
			this.client.ftp.encoding = 'utf8';
			try {
				await this.client.send('OPTS UTF8 ON');
			} catch (utf8Error) {
				console.warn('[FtpClient] 服务器不支持 OPTS UTF8 ON，继续使用客户端 UTF-8 编码', utf8Error instanceof Error ? utf8Error.message : utf8Error);
			}

			// 设置被动模式（默认）
			if (config.passive !== false) {
				// basic-ftp默认使用被动模式，无需手动设置
				// this.client.ftp.dataSocket?.type = 'P';
			}

			this.isConnected = true;
			console.log('[FtpClient] FTP连接成功');
      
			return true;
		} catch (error) {
			const maskedError = maskSensitiveInfo(String(error), this.config);
			console.error('[FtpClient] FTP连接失败:', maskedError);
			this.isConnected = false;
			throw new Error(`FTP连接失败: ${error instanceof Error ? maskSensitiveInfo(error.message, this.config) : maskedError}`);
		}
	}

	/**
   * 断开连接
   */
	async disconnect(): Promise<void> {
		try {
			if (this.isConnected) {
				this.client.close();
				this.isConnected = false;
				console.log('[FtpClient] FTP连接已断开');
			}
		} catch (error) {
			console.warn('[FtpClient] 断开连接时出错:', error);
		}
	}

	/**
   * 获取文件列表（支持自动重试）
   */
	async listFiles(remotePath = '/'): Promise<FileItem[]> {
		this.ensureConnected();
    
		// 路径净化
		const sanitizedPath = sanitizePath(remotePath);
    
		console.log(`[FtpClient] 列出文件 - 原始路径: "${remotePath}", 净化路径: "${sanitizedPath}"`);
    
		return this.retryManager.executeWithRetry(
			async () => {
				try {
					console.log(`[FtpClient] 执行LIST命令: ${sanitizedPath}`);

					const fileList = await this.client.list(sanitizedPath);

					console.log(`[FtpClient] LIST命令返回 ${fileList.length} 个文件/目录`);

					return fileList.map(item => this.toFileItem(item, sanitizedPath));
				} catch (error) {
					// 处理501错误（目录不存在）
					const errorMsg = error instanceof Error ? error.message : String(error);
					if (this.isPathNotFound(errorMsg)) {
						console.warn(`[FtpClient] 目录不存在: ${sanitizedPath}，返回空列表`);
						return [];
					} else if (this.isPermissionDenied(errorMsg)) {
						throw new Error('没有权限访问该目录');
					}
					throw error;
				}
			},
			OperationType.LIST,
			`list_${sanitizedPath}`
		);
	}

	/**
   * 下载文件（支持自动重试、并发控制和直存模式）
   * 如果指定targetFile，将直接下载到文件并返回空Buffer
   * 否则下载到内存并返回Buffer
   */
	async downloadFile(config: DownloadConfig): Promise<Buffer> {
		this.ensureConnected();
    
		if (!config.filePath) {
			throw new Error('下载文件需要提供文件路径');
		}
    
		// 使用并发管理器控制下载操作
		return this.concurrencyManager.execute(
			`download_${config.filePath}`,
			() => this.retryManager.executeWithRetry(
				async () => {
					console.log(`[FtpClient] 下载文件: ${config.filePath}`);
					const startTime = Date.now();
					const expectedSizeForCleanup = typeof config.fileSize === 'number' && Number.isFinite(config.fileSize) && config.fileSize > 0
						? config.fileSize
						: undefined;
					let lastReportedBytes = 0;

					const hasProgress = typeof config.onProgress === 'function';
					const progressName = config.filename || this.getFilenameFromPath(config.filePath!);

					if (hasProgress) {
						config.onProgress?.({
							total: 1,
							loaded: 0,
							percent: 0,
							filename: progressName,
							transferRate: 0
						});
					} else {
						console.log('[FtpClient] 下载未提供进度回调');
					}

					this.client.trackProgress(info => {
						const totalBytes = info.bytesOverall || info.bytes || 1;
						const percent = Math.min(100, Math.round((info.bytes / totalBytes) * 100));
						lastReportedBytes = info.bytes;
						if (hasProgress) {
							console.log('[FtpClient] 下载进度', {
								file: progressName,
								loaded: info.bytes,
								total: totalBytes,
								percent
							});
							config.onProgress?.({
								total: totalBytes,
								loaded: info.bytes,
								percent,
								filename: progressName,
								transferRate: 0
							});
						}
					});

					try {
						// 真流式下载 - 优化流处理，避免不必要的内存拷贝
						let fileBuffer: Buffer;
          
						if (config.targetFile) {
							// 直存模式：直接下载到文件（最高效）
							const fs = await import('fs');
							const path = await import('path');
            
							// 确保目标目录存在
							const targetDir = path.dirname(config.targetFile);
							await fs.promises.mkdir(targetDir, { recursive: true });
            
							// 直接下载到文件，无需内存缓冲
							await this.client.downloadTo(config.targetFile, config.filePath!);
            
							// 停止进度跟踪
							this.client.trackProgress();
            
							// 获取文件大小用于指标记录
							const stats = await fs.promises.stat(config.targetFile);
							fileBuffer = Buffer.alloc(0); // 返回空Buffer，实际文件已保存到磁盘
            
							const fileSize = stats.size;
            
							// 最终进度报告
							if (config.onProgress) {
								config.onProgress({
									total: fileSize,
									loaded: fileSize,
									percent: 100,
									filename: config.filename || this.getFilenameFromPath(config.filePath!),
									transferRate: 0 // 在直存模式下无法精确计算即时速率
								});
							}
            
							// 记录下载指标
							const elapsed = Date.now() - startTime;
							const speedBps = elapsed > 0 ? (fileSize / elapsed) * 1000 : 0;
							this.metricsCollector.recordTransfer(true, elapsed, fileSize, speedBps);
            
							console.log(`[FtpClient] 文件已直接保存到: ${config.targetFile}`);
            
						} else {
							// 内存模式：使用可控流下载到内存
							const streamModule = await import('stream');
							const chunks: Buffer[] = [];
							let totalSize = 0;
            
							// 创建支持背压控制的写入流
							const memoryStream = new streamModule.Writable({
								highWaterMark: 64 * 1024, // 64KB 缓冲
								write(chunk: Buffer, encoding, callback) {
									chunks.push(chunk);
									totalSize += chunk.length;
                
									// 实时进度报告
									if (config.onProgress) {
										config.onProgress({
											total: totalSize, // 在流模式下无法预知总大小
											loaded: totalSize,
											percent: 0, // 无法计算百分比
											filename: config.filename || this.getFilenameFromPath(config.filePath!),
											transferRate: 0
										});
									}
                
									callback();
								}
							});
            
							// 下载到可控内存流
							await this.client.downloadTo(memoryStream, config.filePath!);
            
							// 停止进度跟踪
							this.client.trackProgress();
            
							// 合并所有块为单个Buffer
							fileBuffer = Buffer.concat(chunks);
            
							// 最终进度报告
							if (config.onProgress) {
								config.onProgress({
									total: fileBuffer.length,
									loaded: fileBuffer.length,
									percent: 100,
									filename: config.filename || this.getFilenameFromPath(config.filePath!)
								});
							}
            
							// 记录下载指标
							const elapsed = Date.now() - startTime;
							const speedBps = elapsed > 0 ? (fileBuffer.length / elapsed) * 1000 : 0;
							this.metricsCollector.recordTransfer(true, elapsed, fileBuffer.length, speedBps);
						}
          
						return fileBuffer;
          
					} catch (error) {
						// 停止进度跟踪
						this.client.trackProgress();
						console.error('[FtpClient] 文件下载失败:', error);

						// 记录失败的下载
						const elapsed = Date.now() - startTime;
						this.metricsCollector.recordTransfer(false, elapsed, 0);

						if (config.targetFile) {
							try {
								await handleInterruptedDownload({
									targetPath: config.targetFile,
									expectedSize: expectedSizeForCleanup,
									bytesWritten: lastReportedBytes,
									reason: 'error',
									transport: 'FTP'
								});
							} catch (cleanupError) {
								console.warn('[FtpClient] 下载失败后清理本地文件时出错', {
									targetFile: config.targetFile,
									error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
								});
							}
						}

						throw new Error(`文件下载失败: ${error instanceof Error ? error.message : String(error)}`);
					}
				},
				OperationType.DOWNLOAD,
				`download_${config.filePath}`
			),
			{ priority: TaskPriority.NORMAL, timeout: 60000 }
		);
	}

	async createStreamUploadSession(options: FtpStreamUploadOptions): Promise<FtpStreamUploadHandle> {
		this.ensureConnected();

		const sessionId = `ftp-stream-${randomUUID()}`;
		const chunkSize = Math.max(32 * 1024, Math.min(options.chunkSize ?? 512 * 1024, 2 * 1024 * 1024));
		const passThrough = new PassThrough({ highWaterMark: chunkSize });
		let ended = false;
		let aborted = false;
		let bytesWritten = 0;

		let uploadPromise: Promise<FileOperationResult>;
		try {
			uploadPromise = this.uploadFile({
				stream: passThrough,
				filename: options.filename,
				targetPath: options.targetPath,
				fileSize: options.totalSize
			});
		} catch (error) {
			passThrough.destroy();
			throw error;
		}

		const completionPromise: Promise<{ success: boolean; result?: FileOperationResult; error?: unknown }> = uploadPromise
			.then((result) => ({ success: true, result }))
			.catch((error) => ({ success: false, error }));

		const writeChunk = async (data: Buffer): Promise<void> => {
			if (ended) {
				throw new Error('流式上传已结束');
			}
			if (aborted) {
				throw new Error('流式上传已中止');
			}
			if (!data || data.length === 0) {
				return;
			}

			bytesWritten += data.length;
			if (!passThrough.write(data)) {
				await new Promise<void>((resolve, reject) => {
					const cleanup = () => {
						passThrough.off('drain', onDrain);
						passThrough.off('error', onError);
					};
					const onDrain = () => {
						cleanup();
						resolve();
					};
					const onError = (err: Error) => {
						cleanup();
						reject(err);
					};
					passThrough.once('drain', onDrain);
					passThrough.once('error', onError);
				});
			}
		};

		const finish = async (): Promise<FileOperationResult> => {
			if (aborted) {
				return {
					success: false,
					message: 'FTP流式上传已被取消'
				};
			}

			if (!ended) {
				ended = true;
				try {
					await new Promise<void>((resolve, reject) => {
						const onError = (err: Error) => {
							passThrough.off('finish', onFinish);
							reject(err);
						};
						const onFinish = () => {
							passThrough.off('error', onError);
							resolve();
						};
						passThrough.once('error', onError);
						passThrough.once('finish', onFinish);
						passThrough.end();
					});
				} catch (error) {
					console.warn('[FtpClient] 结束流式上传写入流失败', error);
				}
			}

			const outcome = await completionPromise;
			console.log('[FtpClient] 流式上传会话结束', {
				sessionId,
				bytesWritten,
				success: outcome.success
			});
			if (outcome.success && outcome.result) {
				return outcome.result;
			}

			const err = outcome.error instanceof Error
				? outcome.error
				: new Error(String(outcome.error ?? 'FTP流式上传失败'));
			throw err;
		};

		const abort = async (reason?: string): Promise<void> => {
			if (ended || aborted) {
				return;
			}
			aborted = true;
			const abortError = new Error(reason || 'FTP流式上传被取消');
			if (!passThrough.destroyed) {
				passThrough.destroy(abortError);
			}
			await completionPromise;
			console.warn('[FtpClient] 流式上传中止', {
				sessionId,
				bytesWritten,
				reason: abortError.message
			});
		};

		console.log('[FtpClient] 创建流式上传会话', {
			sessionId,
			filename: options.filename,
			targetPath: options.targetPath,
			chunkSize,
			totalSize: options.totalSize
		});

		return {
			sessionId,
			acceptedChunkSize: chunkSize,
			writeChunk,
			finish,
			abort
		};
	}

	/**
   * 上传文件（支持并发控制和流式上传）
   * 优先使用stream，其次使用buffer
   */
	async uploadFile(config: UploadConfig): Promise<FileOperationResult> {
		this.ensureConnected();
    
		// 路径净化
		const sanitizedTargetPath = sanitizePath(config.targetPath);
		let targetFilePath = '';
    
		// 使用并发管理器控制上传操作
		return this.concurrencyManager.execute(
			`upload_${config.filename}`,
			async () => {
				const startTime = Date.now();
				console.log(`[FtpClient] 上传文件: ${config.filename} 到 ${sanitizedTargetPath}`);
          
				// 检查是否提供了数据源
				if (!config.stream && !config.buffer && !config.filePath) {
					throw new Error('没有提供文件数据（需要stream、buffer或filePath）');
				}
          
				// 构建目标路径
				targetFilePath = sanitizedTargetPath.endsWith('/') 
					? `${sanitizedTargetPath}${config.filename}`
					: `${sanitizedTargetPath}/${config.filename}`;
          
				// 获取文件大小用于进度监控
				let totalBytes = config.fileSize || config.buffer?.length || 0;
				if (!totalBytes && config.filePath) {
					try {
						const stats = await fs.promises.stat(config.filePath);
						totalBytes = stats.size;
					} catch {
						// 忽略无法读取大小的情况
					}
				}

				if (this.config?.maxSingleFileSize && this.config.maxSingleFileSize > 0 && totalBytes > this.config.maxSingleFileSize) {
					throw new Error(`文件大小 ${totalBytes} 字节超过限制 ${this.config.maxSingleFileSize} 字节 (${(this.config.maxSingleFileSize / 1024 / 1024).toFixed(1)}MB)`);
				}

				if (!config.onProgress) {
					console.log('[FtpClient] 上传未提供进度回调');
				}

				const streamModule = await import('stream');
				const { Readable: readableStreamCtor } = streamModule;
				let baseStream: NodeJS.ReadableStream;
				let ownsSource = false;

				if (config.stream) {
					baseStream = config.stream;
					console.log('[FtpClient] 使用提供的流进行直接上传');
				} else if (config.filePath) {
					baseStream = fs.createReadStream(config.filePath);
					ownsSource = true;
					console.log(`[FtpClient] 直接从文件上传: ${config.filePath}`);
				} else if (config.buffer) {
					let position = 0;
					const chunkSize = 64 * 1024;
					baseStream = new readableStreamCtor({
						highWaterMark: chunkSize * 2,
						read(this: NodeReadable) {
							if (position >= config.buffer!.length) {
								this.push(null);
								return;
							}

							const end = Math.min(position + chunkSize, config.buffer!.length);
							const chunk = config.buffer!.subarray(position, end);
							position = end;

							this.push(chunk);
						}
					});
					ownsSource = true;
					console.log('[FtpClient] 从Buffer创建控制流进行上传');
				} else {
					throw new Error('无法创建上传源');
				}

				const { stream: uploadStream, finalize, getLoaded } = await this.wrapStreamWithProgress(
					baseStream,
					ownsSource,
					totalBytes,
					config.filename,
					startTime,
					config.onProgress
				);

				let succeeded = false;
				try {
					await this.client.uploadFrom(uploadStream, targetFilePath);
					succeeded = true;
				} catch (error) {
					finalize(false);
					console.error('[FtpClient] 文件上传失败:', {
						file: config.filename,
						targetPath: targetFilePath || sanitizedTargetPath,
						error
					});

					const elapsed = Date.now() - startTime;
					this.metricsCollector.recordTransfer(false, elapsed, 0);

					return {
						success: false,
						message: `文件上传失败: ${error instanceof Error ? error.message : String(error)}`
					};
				} finally {
					finalize(succeeded);
				}

				const uploadedBytes = getLoaded();
				const effectiveSize = totalBytes || uploadedBytes;

				const elapsed = Date.now() - startTime;
				const speedBps = elapsed > 0 ? (effectiveSize / elapsed) * 1000 : 0;
				this.metricsCollector.recordTransfer(true, elapsed, effectiveSize, speedBps);

				console.log('[FtpClient] 上传完成', {
					file: config.filename,
					target: targetFilePath,
					size: effectiveSize,
					elapsed
				});
 
				return {
					success: true,
					message: '文件上传成功',
					data: {
						filename: config.filename,
						size: effectiveSize,
						path: targetFilePath
					}
				};
			},
			{ priority: TaskPriority.HIGH, timeout: 120000 } // 上传优先级更高，超时更长
		);
	}

	/**
   * 删除文件（支持自动重试）
   */
	async deleteFile(filePath: string): Promise<FileOperationResult> {
		this.ensureConnected();
    
		// 路径净化
		const sanitizedPath = sanitizePath(filePath);
    
		return this.retryManager.executeWithRetry(
			async () => {
				console.log(`[FtpClient] 删除文件: ${sanitizedPath}`);
        
				try {
					// 先尝试作为文件删除
					try {
						await this.client.remove(sanitizedPath);
						return {
							success: true,
							message: '文件删除成功',
							data: { path: sanitizedPath, type: 'file' }
						};
					} catch (fileError) {
						// 如果文件删除失败，尝试作为目录删除
						try {
							await this.client.removeDir(sanitizedPath);
							return {
								success: true,
								message: '目录删除成功',
								data: { path: sanitizedPath, type: 'directory' }
							};
						} catch (dirError) {
							const fileErrMsg = this.getErrorMessage(fileError);
							const dirErrMsg = this.getErrorMessage(dirError);

							if (this.isPathNotFound(fileErrMsg) || this.isPathNotFound(dirErrMsg)) {
								return {
									success: true,
									message: '文件或目录不存在',
									data: { path: sanitizedPath }
								};
							}

							if (this.isPermissionDenied(fileErrMsg) || this.isPermissionDenied(dirErrMsg)) {
								throw new Error('没有权限删除该目标');
							}

							throw dirError;
						}
					}
				} catch (error) {
					const reason = this.getErrorMessage(error);
					console.error('[FtpClient] 删除失败:', reason);
					throw new Error(`删除失败: ${reason}`);
				}
			},
			OperationType.DELETE,
			`delete_${sanitizedPath}`
		);
	}

	/**
   * 重命名文件
   */
	async renameFile(oldPath: string, newPath: string): Promise<FileOperationResult> {
		this.ensureConnected();
    
		// 路径净化
		const sanitizedOldPath = sanitizePath(oldPath);
		const sanitizedNewPath = sanitizePath(newPath);
    
		try {
			console.log(`[FtpClient] 重命名文件: ${sanitizedOldPath} -> ${sanitizedNewPath}`);
      
			await this.client.rename(sanitizedOldPath, sanitizedNewPath);
      
			return {
				success: true,
				message: '文件重命名成功',
				data: { 
					oldPath: sanitizedOldPath, 
					newPath: sanitizedNewPath,
					oldName: this.getFilenameFromPath(sanitizedOldPath),
					newName: this.getFilenameFromPath(sanitizedNewPath)
				}
			};
      
		} catch (error) {
			console.error('[FtpClient] 重命名失败:', error);
			return {
				success: false,
				message: `重命名失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/**
   * 创建目录（支持自动重试）
   */
	async createDirectory(dirPath: string): Promise<FileOperationResult> {
		this.ensureConnected();
    
		// 路径净化
		const sanitizedPath = sanitizePath(dirPath);
    
		return this.retryManager.executeWithRetry(
			async () => {
				console.log(`[FtpClient] 创建目录: ${sanitizedPath}`);
        
				try {
					await this.client.ensureDir(sanitizedPath);
          
					return {
						success: true,
						message: '目录创建成功',
						data: { path: sanitizedPath }
					};
				} catch (error) {
					console.error('[FtpClient] 创建目录失败:', error);
					// 如果目录已存在，不应该抛出错误，视为成功
					if (error instanceof Error && error.message.includes('exist')) {
						return {
							success: true,
							message: '目录已存在',
							data: { path: sanitizedPath }
						};
					}
					throw new Error(`创建目录失败: ${error instanceof Error ? error.message : String(error)}`);
				}
			},
			OperationType.CREATE,
			`mkdir_${sanitizedPath}`
		);
	}

	/**
   * 获取文件信息
   */
	async getFileInfo(filePath: string): Promise<FileItem> {
		this.ensureConnected();
    
		// 路径净化
		const sanitizedPath = sanitizePath(filePath);
    
		return this.retryManager.executeWithRetry(
			async () => {
				console.log(`[FtpClient] 获取文件信息: ${sanitizedPath}`);
        
				try {
					// 1. 尝试使用SIZE命令获取文件大小
					let size = 0;
					try {
						const sizeResponse = await this.client.send(`SIZE ${sanitizedPath}`);
						if (sizeResponse && typeof sizeResponse === 'object' && 'message' in sizeResponse) {
							// SIZE命令返回格式: "213 <size>"
							const match = String(sizeResponse.message).match(/^213\s+(\d+)/);
							if (match) {
								size = parseInt(match[1], 10);
							}
						}
					} catch (sizeError) {
						console.warn('[FtpClient] SIZE命令失败，尝试其他方法:', sizeError);
					}
          
					// 2. 尝试使用MDTM命令获取修改时间
					let modifiedTime: Date | undefined;
					try {
						const mdtmResponse = await this.client.send(`MDTM ${sanitizedPath}`);
						if (mdtmResponse && typeof mdtmResponse === 'object' && 'message' in mdtmResponse) {
							// MDTM命令返回格式: "213 YYYYMMDDhhmmss"
							const match = String(mdtmResponse.message).match(/^213\s+(\d{14})/);
							if (match) {
								const timeStr = match[1];
								const year = parseInt(timeStr.substr(0, 4), 10);
								const month = parseInt(timeStr.substr(4, 2), 10) - 1;
								const day = parseInt(timeStr.substr(6, 2), 10);
								const hour = parseInt(timeStr.substr(8, 2), 10);
								const minute = parseInt(timeStr.substr(10, 2), 10);
								const second = parseInt(timeStr.substr(12, 2), 10);
								modifiedTime = new Date(year, month, day, hour, minute, second);
							}
						}
					} catch (mdtmError) {
						console.warn('[FtpClient] MDTM命令失败，尝试其他方法:', mdtmError);
					}
          
					// 3. 如果SIZE和MDTM都失败，尝试通过LIST获取信息
					if (size === 0 && !modifiedTime) {
						const dirPath = sanitizedPath.substring(0, sanitizedPath.lastIndexOf('/')) || '/';
						const fileName = sanitizedPath.substring(sanitizedPath.lastIndexOf('/') + 1);

						const fileList = await this.client.list(dirPath);
						const fileInfo = fileList.find(f => f.name === fileName);

						if (fileInfo) {
							size = fileInfo.size || 0;
							modifiedTime = this.resolveTimestamp(fileInfo.modifiedAt, fileInfo.rawModifiedAt);

							const listItem = this.toFileItem(fileInfo, dirPath);
							return {
								...listItem,
								path: sanitizedPath
							};
						}
					}

					// 4. 如果找不到文件，抛出错误
					if (size === 0 && !modifiedTime) {
						throw new Error(`文件不存在或无法获取信息: ${sanitizedPath}`);
					}

					// 返回文件信息
					const fileName = sanitizedPath.substring(sanitizedPath.lastIndexOf('/') + 1);
					return {
						name: fileName,
						path: sanitizedPath,
						size,
						type: 'file',
						lastModified: modifiedTime ?? new Date(),
						permissions: '',
						isReadonly: false
					};

				} catch (error) {
					const message = this.getErrorMessage(error);
					console.error('[FtpClient] 获取文件信息失败:', message);
					if (this.isPathNotFound(message)) {
						throw new Error('文件不存在');
					}
					if (this.isPermissionDenied(message)) {
						throw new Error('没有权限访问该文件');
					}
					throw new Error(`获取文件信息失败: ${message}`);
				}
			},
			OperationType.READ,
			`fileinfo_${sanitizedPath}`
		);
	}

	/**
   * 获取性能指标
   */
	getMetrics(): FtpMetrics {
		// 获取并发管理器的状态
		const status = this.concurrencyManager.getStatus();
		const activeOperations = status.running;
		const queueLength = status.pending;
    
		// 获取重试统计并更新到指标收集器
		const retryStats = this.retryManager.getRetryStatistics();
		this.metricsCollector.recordRetryStatistics({
			totalRetries: retryStats.totalRetries,
			reasonDistribution: retryStats.reasonDistribution
		});
    
		return this.metricsCollector.getMetrics(activeOperations, queueLength);
	}

	/**
   * 重置指标
   */
	resetMetrics(): void {
		this.metricsCollector.reset();
	}

	// 私有辅助方法
	private ensureConnected(): void {
		if (!this.isConnected) {
			throw new Error('FTP未连接，请先建立连接');
		}
	}

	private async wrapStreamWithProgress(
		source: NodeJS.ReadableStream,
		ownsSource: boolean,
		totalBytes: number,
		filename: string,
		startTime: number,
		onProgress?: UploadConfig['onProgress']
	): Promise<{ stream: NodeJS.ReadableStream; finalize: (success: boolean) => void; getLoaded: () => number }> {
		const streamModule = await import('stream');
		const { Transform: transformStreamCtor } = streamModule;

		let loaded = 0;
		let finalized = false;
		let lastLoggedPercent = -1;

		const emitProgress = (loadedBytes: number, done = false) => {
			const clampedLoaded = totalBytes > 0 ? Math.min(loadedBytes, totalBytes) : loadedBytes;
			const percent = totalBytes > 0 ? Math.min(100, Math.round((clampedLoaded / totalBytes) * 100)) : (done ? 100 : 0);
			const elapsed = Date.now() - startTime;
			const transferRate = elapsed > 0 ? Math.round((clampedLoaded / elapsed) * 1000) : 0;

			if (percent !== lastLoggedPercent || done) {
				console.log('[FtpClient] 上传进度', {
					file: filename,
					loaded: clampedLoaded,
					total: totalBytes || clampedLoaded,
					percent
				});
				lastLoggedPercent = percent;
			}

			onProgress?.({
				total: totalBytes || clampedLoaded,
				loaded: clampedLoaded,
				percent,
				filename,
				transferRate
			});
		};

		emitProgress(0);

		const progressTransform = new transformStreamCtor({
			transform(chunk: Buffer, encoding: BufferEncoding, callback) {
				void encoding;
				loaded += chunk.length;
				emitProgress(loaded);
				callback(null, chunk);
			}
		});

		const pipedStream = source.pipe(progressTransform);

		const finalize = (success: boolean) => {
			if (finalized) {
				return;
			}
			finalized = true;
			if (success) {
				emitProgress(loaded, true);
			}
			if (typeof progressTransform.destroy === 'function' && !progressTransform.destroyed) {
				progressTransform.destroy();
			}
			if (ownsSource && typeof (source as any).destroy === 'function' && !(source as any).destroyed) {
				(source as any).destroy();
			}
		};

		const getLoaded = () => loaded;

		return { stream: pipedStream, finalize, getLoaded };
	}

	private getFilenameFromPath(filePath: string): string {
		return filePath.split('/').pop() || '';
	}

	private joinPath(basePath: string, fileName: string): string {
		if (basePath.endsWith('/')) {
			return `${basePath}${fileName}`;
		}
		return `${basePath}/${fileName}`;
	}

	getConcurrencyManager(): ConcurrencyManager {
		return this.concurrencyManager;
	}

	getRetryStatistics() {
		return this.retryManager.getRetryStatistics();
	}

	cancelRetry(operationId: string): boolean {
		return this.retryManager.cancelRetry(operationId);
	}

	cancelAllRetries(): void {
		this.retryManager.cancelAllRetries();
	}

	private toFileItem(item: any, parentPath: string): FileItem {
		const fullPath = parentPath === '/' || parentPath === ''
			? `/${item.name}`
			: `${parentPath}/${item.name}`;

		return {
			name: item.name,
			path: fullPath,
			type: item.isDirectory ? 'directory' : 'file',
			size: item.size ?? 0,
			lastModified: this.resolveTimestamp(item.modifiedAt, item.rawModifiedAt),
			permissions: item.permissions?.toString(),
			isReadonly: false
		};
	}

	private resolveTimestamp(modifiedAt?: Date, rawModifiedAt?: string): Date {
		if (modifiedAt instanceof Date && !isNaN(modifiedAt.getTime())) {
			return modifiedAt;
		}

		if (rawModifiedAt) {
			const parsed = new Date(rawModifiedAt);
			if (!isNaN(parsed.getTime())) {
				return parsed;
			}
		}

		return new Date();
	}

	private getErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	private isPathNotFound(message: string): boolean {
		const normalized = message.toLowerCase();
		return normalized.includes('no such file') || normalized.includes('no such directory') || normalized.includes('not found') || normalized.includes('550') || message.includes('501');
	}

	private isPermissionDenied(message: string): boolean {
		const normalized = message.toLowerCase();
		return normalized.includes('permission denied') || normalized.includes('550 permission') || normalized.includes('access is denied');
	}

}
