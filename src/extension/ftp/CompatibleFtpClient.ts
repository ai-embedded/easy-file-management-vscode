import { Client as BasicFtp } from 'basic-ftp';
import { PassThrough } from 'stream';
import { randomUUID } from 'crypto';
import { StandardFtpOptimizer } from './optimizers/StandardFtpOptimizer';
import { ExtendedFtpOptimizer } from './optimizers/ExtendedFtpOptimizer';
import { FtpConnectionPool } from './connection/FtpConnectionPool';
import { FtpCapabilityDetector, FtpServerCapabilities } from './capabilities/FtpCapabilityDetector';
import { OptimizedFtpConfig, FtpConfigGenerator } from '../../shared/ftp/OptimizedFtpConfig';
import { FtpConfig, UploadConfig, DownloadConfig, FileOperationResult, FileItem } from '../../shared/types';
import { RetryManager, OperationType } from '../../shared/connection';
import { FtpMetrics } from './FtpMetrics';
import { sanitizePath } from './utils/SecurityUtils';
import { FtpStreamUploadHandle } from './FtpClient';

type OptimizationLayer = 'standard' | 'extended' | 'advanced';

interface TransferStrategy {
  layer: OptimizationLayer;
  method: string;
  reason: string;
}

interface CompatibleFtpClientStats {
  connectionTime: number;
  totalTransfers: number;
  optimizationLayerUsage: Record<OptimizationLayer, number>;
  averageTransferSpeed: number;
  errorRate: number;
  serverCapabilities?: FtpServerCapabilities;
}

/**
 * 兼容 FTP 客户端 - 优化架构的核心入口
 * 
 * 功能特性：
 * - 兼容性优先：确保在任何标准FTP服务器上都能工作
 * - 渐进增强：根据服务器能力逐步启用高级功能
 * - 智能策略选择：自动选择最佳传输策略
 * - 配置化管理：支持灵活的配置管理
 * - 自动降级：高级功能不可用时自动回退
 * - 统一接口：提供简洁一致的API
 */
export class CompatibleFtpClient {
	private config: OptimizedFtpConfig;
	private serverCapabilities?: FtpServerCapabilities;
	private currentClient?: BasicFtp;
	private isConnected = false;
  
	private optimizationLayers: {
    standard: StandardFtpOptimizer;
    extended: ExtendedFtpOptimizer;
  };
  
	private capabilityDetector: FtpCapabilityDetector;
	private stats: CompatibleFtpClientStats;
	private connectionStartTime = 0;
	private failedTransfers = 0;

	constructor(config: OptimizedFtpConfig) {
		this.config = config;
    
		// 初始化优化器
		this.optimizationLayers = {
			standard: new StandardFtpOptimizer({
				connectionReuse: config.optimization.standard.connectionReuse,
				streamProcessing: config.optimization.standard.streamProcessing,
				localCache: config.optimization.standard.localCache,
				clientCompression: config.optimization.standard.clientCompression,
				intelligentRetry: config.optimization.standard.intelligentRetry,
				transferModeOptimization: config.optimization.standard.transferModeOptimization,
				bufferSize: config.performance.bufferSize,
				maxMemoryUsage: config.performance.maxMemoryUsage,
				enableLogging: true
			}),
			extended: new ExtendedFtpOptimizer({
				connectionReuse: config.optimization.standard.connectionReuse,
				streamProcessing: config.optimization.standard.streamProcessing,
				localCache: config.optimization.standard.localCache,
				clientCompression: config.optimization.standard.clientCompression,
				intelligentRetry: config.optimization.standard.intelligentRetry,
				transferModeOptimization: config.optimization.standard.transferModeOptimization,
				resumableTransfer: config.optimization.extended.resumableTransfer,
				compressionTransfer: config.optimization.extended.compressionTransfer,
				multiConnection: config.optimization.extended.multiConnection,
				enhancedListing: config.optimization.extended.enhancedListing,
				maxConcurrentTransfers: config.performance.maxConnections,
				chunkSize: config.performance.chunkSize,
				autoCapabilityDetection: !config.server.compatibility.skipCapabilityDetection,
				enableLogging: true
			})
		};
    
		// 初始化服务器能力检测器
		this.capabilityDetector = new FtpCapabilityDetector({
			enableLogging: config.monitoring.enableDetailedLogging
		});
    
		// 初始化统计信息
		this.stats = {
			connectionTime: 0,
			totalTransfers: 0,
			optimizationLayerUsage: {
				standard: 0,
				extended: 0,
				advanced: 0
			},
			averageTransferSpeed: 0,
			errorRate: 0
		};
	}

	/**
   * 连接到FTP服务器
   */
	async connect(configArg?: Partial<FtpConfig> | Partial<OptimizedFtpConfig>): Promise<boolean> {
		try {
			this.connectionStartTime = Date.now();
      
			if (this.config.monitoring.enableDetailedLogging) {
				console.log(`[CompatibleFtpClient] 开始连接到 ${this.config.server.host}:${this.config.server.port}`);
			}

			// 允许外部传入基础 FtpConfig 或优化配置以更新当前配置
			if (configArg) {
				// 粗略判定：是否是 OptimizedFtpConfig 形态（包含 server/optimization 等字段）
				const maybeOpt = configArg as Partial<OptimizedFtpConfig>;
				if (typeof maybeOpt === 'object' && maybeOpt && ('server' in maybeOpt || 'optimization' in maybeOpt || 'performance' in maybeOpt)) {
					this.config = FtpConfigGenerator.mergeConfigs(this.config, maybeOpt);
				} else {
					// 视为基础 FtpConfig，将关键字段映射到优化配置
					const basic = configArg as Partial<FtpConfig>;
					this.config = FtpConfigGenerator.mergeConfigs(this.config, {
						server: {
							host: basic.host ?? this.config.server.host,
							port: (basic.port ?? this.config.server.port) as number,
							username: basic.username ?? this.config.server.username,
							password: basic.password ?? this.config.server.password,
							secure: basic.secure ?? this.config.server.secure
						},
						security: {
							enableSecureConnection: (basic.secure ?? this.config.server.secure) ?? this.config.security.enableSecureConnection,
							validateServerCertificate: this.config.security.validateServerCertificate,
							allowInsecureConnections: this.config.security.allowInsecureConnections,
							connectionTimeout: basic.timeout ?? this.config.security.connectionTimeout
						}
					});
				}
			}

			// 将OptimizedFtpConfig转换为基础FtpConfig
			const basicFtpConfig: FtpConfig = {
				host: this.config.server.host,
				port: this.config.server.port,
				username: this.config.server.username,
				password: this.config.server.password,
				secure: this.config.server.secure || this.config.security.enableSecureConnection,
				passive: true, // 默认使用被动模式
				timeout: this.config.security.connectionTimeout
			};

			// 1. 建立基础连接
			this.currentClient = await this.optimizationLayers.standard.connect(basicFtpConfig);
      
			// 2. 检测服务器能力（如果启用）
			if (!this.config.server.compatibility.skipCapabilityDetection) {
				await this.detectServerCapabilities();
			} else if (this.config.server.capabilities !== 'auto-detect') {
				this.serverCapabilities = this.config.server.capabilities as FtpServerCapabilities;
			}

			// 3. 配置扩展优化器
			if (this.serverCapabilities) {
				this.stats.serverCapabilities = this.serverCapabilities;
			}

			this.isConnected = true;
			this.stats.connectionTime = Date.now() - this.connectionStartTime;
      
			if (this.config.monitoring.enableDetailedLogging) {
				console.log(`[CompatibleFtpClient] 连接成功 (${this.stats.connectionTime}ms)`);
				if (this.serverCapabilities) {
					console.log('[CompatibleFtpClient] 服务器能力:', {
						resumable: this.serverCapabilities.supportsREST,
						compression: this.serverCapabilities.supportsModeZ,
						mlsd: this.serverCapabilities.supportsMLSD
					});
				}
			}

			return true;

		} catch (error) {
			this.isConnected = false;
      
			if (this.config.monitoring.enableDetailedLogging) {
				console.error('[CompatibleFtpClient] 连接失败:', error);
			}
      
			throw new Error(`FTP连接失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
   * 断开连接
   */
	async disconnect(): Promise<void> {
		if (this.currentClient) {
			// 释放优化器中的连接
			this.optimizationLayers.standard.releaseConnection(this.currentClient);
			this.currentClient = undefined;
		}
    
		this.isConnected = false;
    
		if (this.config.monitoring.enableDetailedLogging) {
			console.log('[CompatibleFtpClient] 连接已断开');
		}
	}

	/**
   * 获取文件列表
   */
	async listFiles(remotePath = '/'): Promise<FileItem[]> {
		this.ensureConnected();
    
		const strategy = this.selectListStrategy();
    
		if (this.config.monitoring.enableDetailedLogging) {
			console.log(`[CompatibleFtpClient] 列表策略: ${strategy.layer} - ${strategy.reason}`);
		}

		this.updateLayerUsage(strategy.layer);

		switch (strategy.layer) {
			case 'extended':
				// 使用扩展优化器（支持MLSD等）
				return this.optimizationLayers.extended.listFiles(
          this.currentClient!,
          remotePath,
          this.getFtpConfig()
				);
      
			case 'standard':
			default:
				// 使用标准优化器
				return this.optimizationLayers.standard.listFiles(
          this.currentClient!,
          remotePath,
          this.getFtpConfig()
				);
		}
	}

	/**
   * 上传文件
   */
	async uploadFile(config: UploadConfig): Promise<FileOperationResult> {
		this.ensureConnected();
    
		const strategy = this.selectUploadStrategy(config);
    
		if (this.config.monitoring.enableDetailedLogging) {
			console.log(`[CompatibleFtpClient] 上传策略: ${strategy.layer} - ${strategy.reason}`);
		}

		this.updateLayerUsage(strategy.layer);
		this.stats.totalTransfers++;

		const startTime = Date.now();

		try {
			let result: FileOperationResult;

			switch (strategy.layer) {
				case 'extended':
					// 使用扩展优化器（支持断点续传、压缩等）
					if (strategy.method === 'resumable') {
						result = await this.optimizationLayers.extended.uploadFileWithResume(this.currentClient!, config);
					} else if (strategy.method === 'compressed') {
						result = await this.optimizationLayers.extended.uploadWithCompression(this.currentClient!, config);
					} else {
						result = await this.optimizationLayers.extended.uploadFile(this.currentClient!, config);
					}
					break;
        
				case 'standard':
				default:
					// 使用标准优化器
					result = await this.optimizationLayers.standard.uploadFile(this.currentClient!, config);
					break;
			}

			if (result.success) {
				// 无论采用哪个优化层，统一清空缓存，确保目录刷新
				this.optimizationLayers.standard.invalidateCache();
				if (this.config.monitoring.enableDetailedLogging) {
					console.log('[CompatibleFtpClient] 上传成功后已强制刷新缓存');
				}
			}

			// 更新传输速度统计
			const transferTime = Math.max(Date.now() - startTime, 1);
			const speed = config.buffer ? (config.buffer.length / transferTime) * 1000 : 0;
			this.updateAverageSpeed(speed);
			this.recordTransferOutcome(result.success);

			return result;

		} catch (error) {
			// 记录错误并尝试降级
			if (this.config.monitoring.enableDetailedLogging) {
				console.warn(`[CompatibleFtpClient] ${strategy.layer}层上传失败，尝试降级:`, error);
			}

			if (strategy.layer === 'extended') {
				// 降级到标准优化器
				this.updateLayerUsage('standard');
				const fallbackResult = await this.optimizationLayers.standard.uploadFile(this.currentClient!, config);
				const elapsed = Math.max(Date.now() - startTime, 1);
				const fallbackSpeed = config.buffer ? (config.buffer.length / elapsed) * 1000 : 0;
				this.updateAverageSpeed(fallbackSpeed);
				this.recordTransferOutcome(fallbackResult.success);
				return fallbackResult;
			}

			this.recordTransferOutcome(false);

			throw error;
		}
	}

	async createStreamUploadSession(options: {
		filename: string;
		targetPath: string;
		totalSize: number;
		chunkSize?: number;
	}): Promise<FtpStreamUploadHandle> {
		this.ensureConnected();

		const client = this.currentClient!;
		const sessionId = `ftp-stream-${randomUUID()}`;
		const acceptedChunkSize = Math.max(32 * 1024, Math.min(options.chunkSize ?? 512 * 1024, 2 * 1024 * 1024));
		const passThrough = new PassThrough({ highWaterMark: acceptedChunkSize });
		const sanitizedTarget = sanitizePath(options.targetPath || '/');
		const targetFilePath = sanitizedTarget.endsWith('/')
			? `${sanitizedTarget}${options.filename}`
			: `${sanitizedTarget}/${options.filename}`;

		let ended = false;
		let aborted = false;
		let bytesWritten = 0;
		const startTime = Date.now();
		this.stats.totalTransfers++;

		const uploadPromise: Promise<FileOperationResult> = (async () => {
			try {
				await client.uploadFrom(passThrough, targetFilePath);
				const elapsed = Date.now() - startTime;
				const effectiveSize = options.totalSize || bytesWritten;
				const speed = elapsed > 0 ? (effectiveSize / elapsed) * 1000 : 0;
				this.updateAverageSpeed(speed);
				// 流式模式也需要刷新缓存，确保后续目录列表命中最新文件
				this.optimizationLayers.standard.invalidateCache();
				const result: FileOperationResult = {
					success: true,
					message: '文件上传成功',
					data: {
						filename: options.filename,
						size: effectiveSize,
						path: targetFilePath
					}
				};
				this.recordTransferOutcome(true);
				return result;
			} catch (error) {
				this.recordTransferOutcome(false);
				throw new Error(`文件上传失败: ${error instanceof Error ? error.message : String(error)}`);
			}
		})();

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
				passThrough.end();
			}

			return uploadPromise;
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
			try {
				await uploadPromise;
			} catch {
				// 上传失败属于预期情况，忽略
			}
		};

		console.log('[CompatibleFtpClient] 创建流式上传会话', {
			sessionId,
			filename: options.filename,
			targetPath: targetFilePath,
			chunkSize: acceptedChunkSize,
			totalSize: options.totalSize
		});

		return {
			sessionId,
			acceptedChunkSize,
			writeChunk,
			finish,
			abort
		};
	}

	/**
   * 下载文件
   */
	async downloadFile(config: DownloadConfig): Promise<Buffer> {
		this.ensureConnected();
    
		const strategy = this.selectDownloadStrategy(config);
    
		if (this.config.monitoring.enableDetailedLogging) {
			console.log(`[CompatibleFtpClient] 下载策略: ${strategy.layer} - ${strategy.reason}`);
		}

		this.updateLayerUsage(strategy.layer);
		this.stats.totalTransfers++;

		const startTime = Date.now();

		try {
			let result: Buffer;

			switch (strategy.layer) {
				case 'extended':
					// 使用扩展优化器（支持断点续传）
					if (strategy.method === 'resumable') {
						result = await this.optimizationLayers.extended.downloadFileWithResume(this.currentClient!, config);
					} else {
						result = await this.optimizationLayers.extended.downloadFile(this.currentClient!, config);
					}
					break;
        
				case 'standard':
				default:
					// 使用标准优化器
					result = await this.optimizationLayers.standard.downloadFile(this.currentClient!, config);
					break;
			}

			// 更新传输速度统计
			const transferTime = Math.max(Date.now() - startTime, 1);
			const transferredBytes = Buffer.isBuffer(result) ? result.length : 0;
			const speed = (transferredBytes / transferTime) * 1000;
			this.updateAverageSpeed(speed);
			this.recordTransferOutcome(true);

			return result;

		} catch (error) {
			// 记录错误并尝试降级
			if (this.config.monitoring.enableDetailedLogging) {
				console.warn(`[CompatibleFtpClient] ${strategy.layer}层下载失败，尝试降级:`, error);
			}

			if (strategy.layer === 'extended') {
				// 降级到标准优化器
				this.updateLayerUsage('standard');
				const fallbackResult = await this.optimizationLayers.standard.downloadFile(this.currentClient!, config);
				const transferTime = Math.max(Date.now() - startTime, 1);
				const transferredBytes = Buffer.isBuffer(fallbackResult) ? fallbackResult.length : 0;
				const speed = (transferredBytes / transferTime) * 1000;
				this.updateAverageSpeed(speed);
				this.recordTransferOutcome(true);
				return fallbackResult;
			}

			this.recordTransferOutcome(false);
			throw error;
		}
	}

	/**
   * 删除文件
   */
	async deleteFile(filePath: string): Promise<FileOperationResult> {
		this.ensureConnected();
    
		// 删除操作使用标准优化器即可
		this.updateLayerUsage('standard');
    
		const retryManager = this.optimizationLayers.standard.getRetryManager();
		const sanitizedPath = sanitizePath(filePath);
		const result = await retryManager.executeWithRetry(
			async () => {
				try {
					await this.currentClient!.remove(sanitizedPath);
					return {
						success: true,
						message: '文件删除成功',
						data: { path: sanitizedPath, type: 'file' }
					};
				} catch (fileError) {
					try {
						await this.currentClient!.removeDir(sanitizedPath);
						return {
							success: true,
							message: '目录删除成功',
							data: { path: sanitizedPath, type: 'directory' }
						};
					} catch (dirError) {
						const fileMessage = fileError instanceof Error ? fileError.message : String(fileError);
						const dirMessage = dirError instanceof Error ? dirError.message : String(dirError);
						if (this.isPathNotFound(fileMessage) || this.isPathNotFound(dirMessage)) {
							return {
								success: true,
								message: '目标不存在',
								data: { path: sanitizedPath }
							};
						}
						if (this.isPermissionDenied(fileMessage) || this.isPermissionDenied(dirMessage)) {
							throw new Error('没有权限删除该目标');
						}
						throw dirError;
					}
				}
			},
			'DELETE',
			`delete_${sanitizedPath}`
		);
    
		// 删除成功后失效相关缓存
		if (result.success) {
			this.optimizationLayers.standard.invalidateCache();
		}
    
		return result;
	}

	/**
	 * 重命名文件或目录
	 */
	async renameFile(oldPath: string, newPath: string): Promise<FileOperationResult> {
		this.ensureConnected();

		const sanitizedOldPath = sanitizePath(oldPath);
		const sanitizedNewPath = sanitizePath(newPath);

		if (this.config.monitoring.enableDetailedLogging) {
			console.log(`[CompatibleFtpClient] 重命名: ${sanitizedOldPath} -> ${sanitizedNewPath}`);
		}

		try {
			await this.currentClient!.rename(sanitizedOldPath, sanitizedNewPath);
			this.optimizationLayers.standard.invalidateCache();
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
			const message = error instanceof Error ? error.message : String(error);
			if (this.config.monitoring.enableDetailedLogging) {
				console.error('[CompatibleFtpClient] 重命名失败:', message);
			}
			if (this.isPermissionDenied(message)) {
				return {
					success: false,
					message: '没有权限重命名目标'
				};
			}

			if (this.isPathNotFound(message)) {
				return {
					success: false,
					message: '指定的文件或目录不存在'
				};
			}

			return {
				success: false,
				message: `重命名失败: ${message}`
			};
		}
	}

	/**
	 * 创建目录
	 */
	async createDirectory(dirPath: string): Promise<FileOperationResult> {
		this.ensureConnected();

		const rawPath = typeof dirPath === 'string' ? dirPath.trim() : '';
		if (!rawPath || rawPath === '/' || rawPath === '.') {
			return {
				success: false,
				message: '文件夹名称不能为空'
			};
		}

		this.updateLayerUsage('standard');

		const sanitizedPath = sanitizePath(rawPath);
		const retryManager = this.optimizationLayers.standard.getRetryManager();

		if (this.config.monitoring.enableDetailedLogging) {
			console.log(`[CompatibleFtpClient] 创建目录: ${sanitizedPath}`);
		}

		const result = await retryManager.executeWithRetry(
			async () => {
				try {
					await this.currentClient!.ensureDir(sanitizedPath);
					this.optimizationLayers.standard.invalidateCache();
					return {
						success: true,
						message: '目录创建成功',
						data: { path: sanitizedPath }
					};
				} catch (error) {
					if (this.config.monitoring.enableDetailedLogging) {
						console.error('[CompatibleFtpClient] 创建目录失败:', error);
					}

					const message = error instanceof Error ? error.message : String(error);
					const normalized = message.toLowerCase();

					if (normalized.includes('exist')) {
						this.optimizationLayers.standard.invalidateCache();
						return {
							success: true,
							message: '目录已存在',
							data: { path: sanitizedPath }
						};
					}

					if (this.isPermissionDenied(message)) {
						throw new Error('没有权限创建目录');
					}

					if (this.isPathNotFound(message)) {
						throw new Error('父目录不存在或路径无效');
					}

					throw new Error(`创建目录失败: ${message}`);
				}
			},
			OperationType.CREATE,
			`mkdir_${sanitizedPath}`
		);

		return result;
	}

	/**
	 * 获取文件或目录信息
	 */
	async getFileInfo(filePath: string): Promise<FileItem> {
		this.ensureConnected();

		const sanitizedPath = sanitizePath(filePath);
		const normalizedPath = sanitizedPath !== '/' && sanitizedPath.endsWith('/')
			? sanitizedPath.slice(0, -1)
			: sanitizedPath;

		if (normalizedPath === '/') {
			return {
				name: '/',
				path: '/',
				type: 'directory',
				size: 0,
				lastModified: new Date(),
				isReadonly: false
			};
		}

		const retryManager = this.optimizationLayers.standard.getRetryManager();

		return retryManager.executeWithRetry(
			async () => {
				if (this.config.monitoring.enableDetailedLogging) {
					console.log(`[CompatibleFtpClient] 获取文件信息: ${normalizedPath}`);
				}

				const client = this.currentClient!;
				const filename = this.getFilenameFromPath(normalizedPath);
				const parentPath = normalizedPath.slice(0, normalizedPath.lastIndexOf('/')) || '/';

				let size = 0;
				try {
					const sizeResponse = await client.send(`SIZE ${normalizedPath}`);
					if (sizeResponse && typeof sizeResponse === 'object' && 'message' in sizeResponse) {
						const match = String(sizeResponse.message).match(/^213\s+(\d+)/);
						if (match) {
							size = parseInt(match[1], 10);
						}
					}
				} catch (sizeError) {
					if (this.config.monitoring.enableDetailedLogging) {
						console.warn('[CompatibleFtpClient] SIZE 命令失败，尝试列表信息:', sizeError);
					}
				}

				let modifiedTime: Date | undefined;
				try {
					const mdtmResponse = await client.send(`MDTM ${normalizedPath}`);
					if (mdtmResponse && typeof mdtmResponse === 'object' && 'message' in mdtmResponse) {
						const match = String(mdtmResponse.message).match(/^213\s+(\d{14})/);
						if (match) {
							const timeStr = match[1];
							const year = Number(timeStr.slice(0, 4));
							const month = Number(timeStr.slice(4, 6)) - 1;
							const day = Number(timeStr.slice(6, 8));
							const hours = Number(timeStr.slice(8, 10));
							const minutes = Number(timeStr.slice(10, 12));
							const seconds = Number(timeStr.slice(12, 14));
							modifiedTime = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
						}
					}
				} catch (mdtmError) {
					if (this.config.monitoring.enableDetailedLogging) {
						console.warn('[CompatibleFtpClient] MDTM 命令失败，使用目录信息:', mdtmError);
					}
				}

				const listingPath = parentPath === '' ? '/' : parentPath;
				const entries = await client.list(listingPath);
				const target = entries.find(item => item.name === filename);
				if (!target) {
					throw new Error('目标不存在');
				}

				const itemType = target.isDirectory ? 'directory' : 'file';
				const resolvedSize = size || target.size || 0;
				return {
					name: filename,
					path: normalizedPath,
					type: itemType,
					size: itemType === 'directory' ? target.size || 0 : resolvedSize,
					lastModified: modifiedTime || target.modifiedAt || new Date(),
					permissions: target.permissions?.toString(),
					isReadonly: false
				};
			},
			OperationType.READ,
			`stat_${normalizedPath}`
		);
	}

	private recordTransferOutcome(success: boolean): void {
		if (!success) {
			this.failedTransfers++;
		}
		const total = Math.max(this.stats.totalTransfers, 1);
		const failures = Math.min(this.failedTransfers, total);
		this.stats.errorRate = failures / total;
	}

	private getFilenameFromPath(filePath: string): string {
		const normalized = filePath.replace(/\\/g, '/');
		const segments = normalized.split('/').filter(Boolean);
		return segments.length > 0 ? segments[segments.length - 1] : '';
	}

	private isPathNotFound(message: string): boolean {
		const normalized = message.toLowerCase();
		return normalized.includes('no such file') || normalized.includes('no such directory') || normalized.includes('not found') || normalized.includes('550');
	}

	private isPermissionDenied(message: string): boolean {
		const normalized = message.toLowerCase();
		return normalized.includes('permission denied') || normalized.includes('550 permission') || normalized.includes('access is denied');
	}

	/**
   * 获取客户端统计信息
   */
	getStats(): CompatibleFtpClientStats & {
    optimizationStats: any;
    extendedStats: any;
    } {
		return {
			...this.stats,
			optimizationStats: this.optimizationLayers.standard.getOptimizationStats(),
			extendedStats: this.optimizationLayers.extended.getExtendedStats()
		};
	}

	getMetrics(): FtpMetrics {
		const now = Date.now();
		const poolStats = this.optimizationLayers.standard.getConnectionPool().getStats();
		const statsArray = Object.values(poolStats);

		let totalConnections = 0;
		let activeConnections = 0;
		let queueLength = 0;
		let totalQueueTime = 0;

		for (const stat of statsArray) {
			totalConnections += stat.total;
			activeConnections += stat.inUse;
			queueLength += stat.queued ?? 0;
			totalQueueTime += stat.avgQueueTime ?? 0;
		}

		const avgQueueTime = statsArray.length > 0 ? totalQueueTime / statsArray.length : 0;
		const totalTransfers = this.stats.totalTransfers;
		const failures = Math.min(this.failedTransfers, totalTransfers);
		const successes = Math.max(totalTransfers - failures, 0);
		const retryStats = this.optimizationLayers.standard.getRetryManager().getRetryStatistics();

		return {
			connectionPool: {
				hitRate: 0,
				activeConnections,
				totalConnections,
				queueLength,
				avgQueueTime
			},
			transfer: {
				totalTransfers,
				successCount: successes,
				errorCount: failures,
				errorRate: this.stats.errorRate,
				bytesTransferred: 0,
				avgSpeed: this.stats.averageTransferSpeed,
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
				enabled: this.config.optimization.standard.clientCompression ?? false,
				totalSaved: 0,
				avgRatio: 0,
				compressedTransfers: 0
			},
			retry: {
				totalRetries: retryStats.totalRetries,
				reasonDistribution: retryStats.reasonDistribution
			},
			timestamp: now,
			uptime: this.isConnected ? now - this.connectionStartTime : this.stats.connectionTime
		};
	}

	/**
   * 更新配置
   */
	updateConfig(newConfig: Partial<OptimizedFtpConfig>): void {
		this.config = FtpConfigGenerator.mergeConfigs(this.config, newConfig);
   
		if (this.config.monitoring.enableDetailedLogging) {
			console.log('[CompatibleFtpClient] 配置已更新');
		}
	}

	getConnectionPool(): FtpConnectionPool | undefined {
		return this.optimizationLayers.standard.getConnectionPool();
	}

	getRetryManager(): RetryManager {
		return this.optimizationLayers.standard.getRetryManager();
	}

	getRetryStatistics() {
		return this.optimizationLayers.standard.getRetryManager().getRetryStatistics();
	}

	cancelRetry(operationId: string): boolean {
		return this.optimizationLayers.standard.getRetryManager().cancelRetry(operationId);
	}

	cancelAllRetries(): void {
		this.optimizationLayers.standard.getRetryManager().cancelAllRetries();
	}

	/**
   * 清理资源
   */
	async cleanup(): Promise<void> {
		await this.disconnect();
		await this.optimizationLayers.standard.cleanup();
		await this.optimizationLayers.extended.cleanupExtended();
    
		if (this.config.monitoring.enableDetailedLogging) {
			console.log('[CompatibleFtpClient] 资源清理完成');
		}
	}

	// 私有方法实现

	private async detectServerCapabilities(): Promise<void> {
		if (this.config.server.capabilities === 'auto-detect') {
			try {
				this.serverCapabilities = await this.capabilityDetector.detectServerCapabilities(
          this.currentClient!,
          this.config.server.host
				);
			} catch (error) {
				if (this.config.monitoring.enableDetailedLogging) {
					console.warn('[CompatibleFtpClient] 服务器能力检测失败:', error);
				}
			}
		}
	}

	private selectListStrategy(): TransferStrategy {
		// 如果支持MLSD，使用扩展优化器
		if (this.shouldUseExtendedFeatures() && this.serverCapabilities?.supportsMLSD) {
			return {
				layer: 'extended',
				method: 'enhanced-listing',
				reason: '支持MLSD增强列表'
			};
		}

		return {
			layer: 'standard',
			method: 'standard-listing',
			reason: '使用标准LIST命令'
		};
	}

	private selectUploadStrategy(config: UploadConfig): TransferStrategy {
		const fileSize = config.buffer?.length || 0;

		// 大文件且支持断点续传
		if (fileSize > 10 * 1024 * 1024 && // 10MB
        this.shouldUseExtendedFeatures() &&
        this.serverCapabilities?.supportsREST &&
        this.config.optimization.extended.resumableTransfer !== false) {
			return {
				layer: 'extended',
				method: 'resumable',
				reason: '大文件使用断点续传'
			};
		}

		// 文本文件且支持压缩传输
		if (this.isCompressibleFile(config.filename) &&
        this.shouldUseExtendedFeatures() &&
        this.serverCapabilities?.supportsModeZ &&
        this.config.optimization.extended.compressionTransfer !== false) {
			return {
				layer: 'extended',
				method: 'compressed',
				reason: '文本文件使用压缩传输'
			};
		}

		// 使用扩展优化器的其他功能
		if (this.shouldUseExtendedFeatures()) {
			return {
				layer: 'extended',
				method: 'standard',
				reason: '使用扩展优化器'
			};
		}

		return {
			layer: 'standard',
			method: 'standard',
			reason: '使用标准优化'
		};
	}

	private selectDownloadStrategy(config: DownloadConfig): TransferStrategy {
		// 如果支持断点续传，使用扩展优化器
		if (this.shouldUseExtendedFeatures() &&
        this.serverCapabilities?.supportsREST &&
        this.config.optimization.extended.resumableTransfer !== false) {
			return {
				layer: 'extended',
				method: 'resumable',
				reason: '支持断点续传下载'
			};
		}

		if (this.shouldUseExtendedFeatures()) {
			return {
				layer: 'extended',
				method: 'standard',
				reason: '使用扩展优化器'
			};
		}

		return {
			layer: 'standard',
			method: 'standard',
			reason: '使用标准优化'
		};
	}

	private shouldUseExtendedFeatures(): boolean {
		// 严格标准模式下不使用扩展功能
		if (this.config.server.compatibility.strictStandardMode) {
			return false;
		}

		// 假设只支持基础FTP
		if (this.config.server.compatibility.assumeBasicFtpOnly) {
			return false;
		}

		return true;
	}

	private isCompressibleFile(filename: string): boolean {
		const compressibleExtensions = ['.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.ts'];
		const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
		return compressibleExtensions.includes(extension);
	}

	private getFtpConfig(): FtpConfig {
		return {
			host: this.config.server.host,
			port: this.config.server.port,
			username: this.config.server.username,
			password: this.config.server.password,
			secure: this.config.server.secure,
			timeout: this.config.security.connectionTimeout
		};
	}

	private ensureConnected(): void {
		if (!this.isConnected || !this.currentClient) {
			throw new Error('FTP客户端未连接，请先调用connect()');
		}
	}

	private updateLayerUsage(layer: OptimizationLayer): void {
		this.stats.optimizationLayerUsage[layer]++;
	}

	private updateAverageSpeed(speed: number): void {
		if (this.stats.averageTransferSpeed === 0) {
			this.stats.averageTransferSpeed = speed;
		} else {
			// 使用指数移动平均
			this.stats.averageTransferSpeed = this.stats.averageTransferSpeed * 0.8 + speed * 0.2;
		}
	}
}
