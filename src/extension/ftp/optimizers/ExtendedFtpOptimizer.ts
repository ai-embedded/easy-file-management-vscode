import { Client as BasicFtp } from 'basic-ftp';
import { StandardFtpOptimizer } from './StandardFtpOptimizer';
import { FtpCapabilityDetector, FtpServerCapabilities } from '../capabilities/FtpCapabilityDetector';
import { FtpConfig, UploadConfig, DownloadConfig, FileOperationResult } from '../../../shared/types';
import { ExtendedOptimizationConfig } from '../../../shared/types/ftp';

interface ResumableTransferState {
  filePath: string;
  totalSize: number;
  transferredSize: number;
  lastModified: number;
  checksum?: string;
  // 新增字段用于增强校验
  expectedMd5?: string;
  tempFilePath?: string;
  attempts: number;
  startTime: number;
  lastUpdateTime: number;
  validated: boolean;
}

/**
 * 文件校验结果
 */
interface FileValidationResult {
  lengthValid: boolean;
  md5Valid?: boolean;
  expectedSize: number;
  actualSize: number;
  expectedMd5?: string;
  actualMd5?: string;
  error?: string;
}

interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  compressionTime: number;
  transferTime: number;
}

/**
 * 扩展 FTP 优化器 - 第二层优化
 * 
 * 需要检测服务器支持的扩展功能：
 * - 智能断点续传（需要 REST 支持）
 * - 压缩传输（需要 MODE Z 支持）
 * - 多连接传输（需要服务器支持多连接）
 * - 增强目录列表（需要 MLSD 支持）
 * - 条件性优化功能
 */
export class ExtendedFtpOptimizer extends StandardFtpOptimizer {
	private capabilityDetector: FtpCapabilityDetector;
	private serverCapabilities?: FtpServerCapabilities;
	private resumableStates = new Map<string, ResumableTransferState>();
	private compressionStats: CompressionStats[] = [];
	private activeTransfers = new Set<string>();
	private enableMd5Validation = false; // 可选的 MD5 校验，默认关闭
  
	constructor(private extendedConfig: Partial<ExtendedOptimizationConfig> = {}) {
		// 继承标准优化配置
		super(extendedConfig);
    
		// 扩展配置
		const config: ExtendedOptimizationConfig = {
			...extendedConfig,
			resumableTransfer: extendedConfig.resumableTransfer ?? 'auto',
			compressionTransfer: extendedConfig.compressionTransfer ?? 'auto',
			multiConnection: extendedConfig.multiConnection ?? 'auto', 
			enhancedListing: extendedConfig.enhancedListing ?? 'auto',
			maxConcurrentTransfers: extendedConfig.maxConcurrentTransfers ?? 3,
			chunkSize: extendedConfig.chunkSize ?? 1024 * 1024, // 1MB
			compressionLevel: extendedConfig.compressionLevel ?? 6,
			autoCapabilityDetection: extendedConfig.autoCapabilityDetection ?? true
		};
    
		this.extendedConfig = config;
    
		// 初始化服务器能力检测器
		this.capabilityDetector = new FtpCapabilityDetector({
			enableLogging: this.extendedConfig.enableLogging
		});
	}

	/**
   * 扩展的连接方法 - 包含服务器能力检测
   */
	async connectWithCapabilityDetection(ftpConfig: FtpConfig): Promise<BasicFtp> {
		const client = await super.connect(ftpConfig);
    
		// 自动检测服务器能力
		if (this.extendedConfig.autoCapabilityDetection) {
			try {
				this.serverCapabilities = await this.capabilityDetector.detectServerCapabilities(client, ftpConfig.host);
        
				if (this.extendedConfig.enableLogging) {
					console.log('[ExtendedFtpOptimizer] 服务器能力检测完成:', {
						resumable: this.serverCapabilities.supportsREST,
						compression: this.serverCapabilities.supportsModeZ,
						mlsd: this.serverCapabilities.supportsMLSD,
						maxConnections: this.serverCapabilities.maxConnections
					});
				}
			} catch (error) {
				if (this.extendedConfig.enableLogging) {
					console.warn('[ExtendedFtpOptimizer] 服务器能力检测失败，使用基础功能:', error);
				}
			}
		}
    
		return client;
	}

	/**
   * 扩展的文件上传 - 支持断点续传
   */
	async uploadFileWithResume(client: BasicFtp, config: UploadConfig): Promise<FileOperationResult> {
		const shouldUseResume = this.shouldUseResumableTransfer('upload');
    
		if (!shouldUseResume || !config.buffer) {
			return super.uploadFile(client, config);
		}

		const transferId = `upload_${config.filename}_${Date.now()}`;
		const fileSize = config.buffer.length;
    
		if (this.extendedConfig.enableLogging) {
			console.log(`[ExtendedFtpOptimizer] 开始断点续传上传: ${config.filename} (${fileSize} bytes)`);
		}

		try {
			// 检查是否有未完成的传输
			const resumableState = this.getResumableState(config.filename);
			let startOffset = 0;

			if (resumableState && resumableState.totalSize === fileSize) {
				// 验证服务器上的文件大小
				const remoteSize = await this.getRemoteFileSize(client, config.targetPath, config.filename);
				if (remoteSize > 0 && remoteSize < fileSize) {
					startOffset = remoteSize;
          
					if (this.extendedConfig.enableLogging) {
						console.log(`[ExtendedFtpOptimizer] 检测到未完成传输，从 ${startOffset} 字节恢复`);
					}
				}
			}

			return await this.performResumableUpload(client, config, startOffset, transferId);

		} catch (error) {
			if (this.extendedConfig.enableLogging) {
				console.warn('[ExtendedFtpOptimizer] 断点续传失败，回退到标准上传:', error);
			}
      
			// 清除失败的断点续传状态
			this.resumableStates.delete(config.filename);
      
			// 回退到标准上传
			return super.uploadFile(client, config);
		}
	}

	/**
   * 扩展的文件下载 - 支持断点续传
   */
	async downloadFileWithResume(client: BasicFtp, config: DownloadConfig): Promise<Buffer> {
		const shouldUseResume = this.shouldUseResumableTransfer('download');
    
		if (!shouldUseResume || !config.filePath) {
			return super.downloadFile(client, config);
		}

		if (this.extendedConfig.enableLogging) {
			console.log(`[ExtendedFtpOptimizer] 开始断点续传下载: ${config.filePath}`);
		}

		try {
			// 获取远程文件信息
			const remoteSize = await this.getRemoteFileSize(client, '', config.filePath);
			if (remoteSize === -1) {
				throw new Error('无法获取远程文件大小');
			}

			return await this.performResumableDownload(client, config, remoteSize);

		} catch (error) {
			if (this.extendedConfig.enableLogging) {
				console.warn('[ExtendedFtpOptimizer] 断点续传下载失败，回退到标准下载:', error);
			}
      
			// 回退到标准下载
			return super.downloadFile(client, config);
		}
	}

	/**
   * 压缩传输上传
   * 注意：MODE Z 链路压缩需要客户端和服务器端的深度支持
   * basic-ftp 库不支持 MODE Z 的实时压缩/解压
   * 因此暂时禁用此功能，避免数据损坏
   */
	async uploadWithCompression(client: BasicFtp, config: UploadConfig): Promise<FileOperationResult> {
		// ⚠️ MODE Z 暂时禁用：basic-ftp 不支持链路压缩
		// 如果将来需要压缩功能，应该在应用层实现：
		// 1. 在上传前压缩文件内容（如使用 zlib）
		// 2. 上传压缩后的文件
		// 3. 在服务器端解压
    
		if (this.extendedConfig.enableLogging) {
			console.log(`[ExtendedFtpOptimizer] MODE Z 压缩传输已禁用，使用标准传输: ${config.filename}`);
		}
    
		// 直接使用断点续传上传，不启用 MODE Z
		return this.uploadFileWithResume(client, config);
    
		/* 原有的 MODE Z 实现已禁用，保留代码仅供参考
    const shouldUseCompression = this.shouldUseCompressionTransfer();
    
    if (!shouldUseCompression || !config.buffer) {
      return this.uploadFileWithResume(client, config);
    }

    const startTime = Date.now();
    
    try {
      // 这里发送 MODE Z 命令但 basic-ftp 不会真正压缩数据流
      // 可能导致服务器期望压缩数据但收到未压缩数据，造成损坏
      await client.send('MODE Z');
      
      const result = await this.uploadFileWithResume(client, config);
      
      this.recordCompressionStats({
        originalSize: config.buffer.length,
        compressedSize: config.buffer.length,
        compressionRatio: 1.0,
        compressionTime: 0,
        transferTime: Date.now() - startTime
      });

      return result;
    } catch (error) {
      if (this.extendedConfig.enableLogging) {
        console.warn('[ExtendedFtpOptimizer] 压缩传输失败，回退到标准传输:', error);
      }
      return this.uploadFileWithResume(client, config);
    } finally {
      // 恢复正常模式
      try {
        await client.send('MODE S');
      } catch {}
    }
    */
	}

	/**
   * 获取扩展优化统计
   */
	getExtendedStats(): {
    resumableTransfers: number;
    compressionStats: CompressionStats[];
    averageCompressionRatio: number;
    serverCapabilities?: FtpServerCapabilities;
    activeTransfers: number;
    } {
		const avgCompressionRatio = this.compressionStats.length > 0
			? this.compressionStats.reduce((sum, stat) => sum + stat.compressionRatio, 0) / this.compressionStats.length
			: 0;

		return {
			resumableTransfers: this.resumableStates.size,
			compressionStats: this.compressionStats.slice(-10), // 最近10次
			averageCompressionRatio: avgCompressionRatio,
			serverCapabilities: this.serverCapabilities,
			activeTransfers: this.activeTransfers.size
		};
	}

	/**
   * 清理扩展资源
   */
	async cleanupExtended(): Promise<void> {
		this.resumableStates.clear();
		this.compressionStats.length = 0;
		this.activeTransfers.clear();
		this.capabilityDetector.clearCache();
		await super.cleanup();
	}

	// 私有方法实现

	private shouldUseResumableTransfer(operation: 'upload' | 'download'): boolean {
		const config = this.extendedConfig.resumableTransfer;
    
		if (config === true) {return true;}
		if (config === false) {return false;}
		if (config === 'auto') {
			return this.serverCapabilities?.supportsREST ?? false;
		}
    
		return false;
	}

	private shouldUseCompressionTransfer(): boolean {
		const config = this.extendedConfig.compressionTransfer;
    
		if (config === true) {return true;}
		if (config === false) {return false;}
		if (config === 'auto') {
			return this.serverCapabilities?.supportsModeZ ?? false;
		}
    
		return false;
	}

	private async getRemoteFileSize(client: BasicFtp, remotePath: string, filename: string): Promise<number> {
		try {
			const fullPath = remotePath.endsWith('/') 
				? `${remotePath}${filename}`
				: `${remotePath}/${filename}`;
      
			const response = await client.send(`SIZE ${fullPath}`);
			const match = response.message.match(/\d+/);
			return match ? parseInt(match[0]) : -1;
      
		} catch (error) {
			return -1;
		}
	}

	private async performResumableUpload(
		client: BasicFtp, 
		config: UploadConfig, 
		startOffset: number,
		transferId: string
	): Promise<FileOperationResult> {
		if (!config.buffer) {
			throw new Error('没有提供文件数据');
		}

		this.activeTransfers.add(transferId);
    
		try {
			// 更新断点续传状态
			this.updateResumableState(config.filename, {
				filePath: config.targetPath,
				totalSize: config.buffer.length,
				transferredSize: startOffset,
				lastModified: Date.now()
			});

			// 根据服务器能力选择最佳续传策略
			const remotePath = `${config.targetPath}/${config.filename}`;

			if (startOffset >= config.buffer.length) {
				this.resumableStates.delete(config.filename);
				return {
					success: true,
					message: '远端文件已完整，无需续传'
				};
			}
      
			if (startOffset > 0) {
				// 首选方案：使用 appendFrom 在服务器端追加剩余数据
				if (this.serverCapabilities?.supportsAPPE !== false) {
					try {
						if (this.extendedConfig.enableLogging) {
							console.log(`[ExtendedFtpOptimizer] 使用APPE续传，从 ${startOffset} 字节开始`);
						}

						const remaining = config.buffer.slice(startOffset);
						const streamModule = await import('stream');
						const remainderStream = streamModule.Readable.from(remaining);
						await client.appendFrom(remainderStream, remotePath);

						// 附加上传成功后立即清空目录缓存
						this.invalidateCache();
						if (this.extendedConfig.enableLogging) {
							console.log('[ExtendedFtpOptimizer] 已清空缓存，确保APPE续传后目录刷新');
						}

						this.resumableStates.delete(config.filename);
						return {
							success: true,
							message: `文件续传上传成功 (续传 ${startOffset} bytes)`
						};
					} catch (appeError) {
						if (this.extendedConfig.enableLogging) {
							console.warn('[ExtendedFtpOptimizer] APPE续传失败，回退全量上传:', appeError);
						}
					}
				}

				if (this.extendedConfig.enableLogging) {
					console.warn('[ExtendedFtpOptimizer] 服务器不支持追加续传，删除远端文件重新上传');
				}

				try {
					await client.remove(remotePath);
				} catch {}
			}
      
			// 正常上传（从头开始或续传失败后重传）
			const result = await super.uploadFile(client, config);
			if (result.success) {
				this.invalidateCache();
				if (this.extendedConfig.enableLogging) {
					console.log('[ExtendedFtpOptimizer] 全量重传完成后已清空缓存');
				}
			}

			// 上传成功，清除断点续传状态
			this.resumableStates.delete(config.filename);

			return result;

		} finally {
			this.activeTransfers.delete(transferId);
		}
	}

	private async performResumableDownload(
		client: BasicFtp, 
		config: DownloadConfig, 
		remoteSize: number
	): Promise<Buffer> {
		// 真正的断点续传下载实现 - 使用basic-ftp的startAt参数
		const fs = await import('fs');
		const os = await import('os');
		const path = await import('path');
    
		const tempDir = os.tmpdir();
		const tempFile = path.join(tempDir, `ftp_resumable_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
		let downloadedSize = 0;

		try {
			// 检查是否存在已部分下载的临时文件
			let existingSize = 0;
			try {
				const stats = await fs.promises.stat(tempFile);
				existingSize = stats.size;
				if (existingSize > 0 && existingSize < remoteSize) {
					downloadedSize = existingSize;
					if (this.extendedConfig.enableLogging) {
						console.log(`[ExtendedFtpOptimizer] 发现已下载 ${existingSize} 字节，从此处恢复`);
					}
				}
			} catch (err) {
				// 文件不存在，从头开始下载
			}

			// 使用basic-ftp的startAt参数直接从指定位置下载到文件末尾
			// 这避免了伪分块循环的问题
			const maxRetries = 3;
			let retryCount = 0;
      
			while (downloadedSize < remoteSize && retryCount < maxRetries) {
				try {
					// 创建文件流（如果从中间恢复则使用追加模式）
					const fileStream = fs.createWriteStream(tempFile, { 
						flags: downloadedSize > 0 ? 'a' : 'w',
						start: downloadedSize
					});

					// 使用downloadTo的第三个参数startAt来指定开始位置
					// basic-ftp会自动发送REST命令并从指定位置开始下载
					await client.downloadTo(fileStream, config.filePath!, downloadedSize);
          
					// 等待流完成写入
					await new Promise((resolve, reject) => {
						fileStream.on('finish', resolve);
						fileStream.on('error', reject);
					});

					// 验证文件大小
					const stats = await fs.promises.stat(tempFile);
					downloadedSize = stats.size;

					// 更新进度
					if (config.onProgress) {
						config.onProgress({
							total: remoteSize,
							loaded: downloadedSize,
							percent: Math.round((downloadedSize / remoteSize) * 100),
							filename: config.filename || this.getFilenameFromPath(config.filePath!),
							transferRate: 0
						});
					}

					// 如果下载完成，退出循环
					if (downloadedSize >= remoteSize) {
						break;
					}

				} catch (error) {
					retryCount++;
					if (this.extendedConfig.enableLogging) {
						console.warn(`[ExtendedFtpOptimizer] 断点续传失败 (${downloadedSize}/${remoteSize}), 重试 ${retryCount}/${maxRetries}:`, error);
					}
          
					// 如果已经达到最大重试次数，抛出错误
					if (retryCount >= maxRetries) {
						throw error;
					}

					// 短暂延迟后重试
					await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
				}
			}
      
			// 读取完整文件内容
			const completeBuffer = await fs.promises.readFile(tempFile);
      
			// 验证下载完整性
			if (completeBuffer.length !== remoteSize) {
				throw new Error(`下载不完整: 预期 ${remoteSize} 字节, 实际 ${completeBuffer.length} 字节`);
			}
      
			// 清理临时文件
			try {
				await fs.promises.unlink(tempFile);
			} catch (err) {
				console.warn('[ExtendedFtpOptimizer] 清理临时文件失败:', err);
			}
      
			return completeBuffer;
      
		} catch (error) {
			// 清理临时文件
			try {
				await fs.promises.unlink(tempFile);
			} catch {}
			throw error;
		}
	}

	private getResumableState(filename: string): ResumableTransferState | undefined {
		return this.resumableStates.get(filename);
	}

	private updateResumableState(filename: string, state: ResumableTransferState): void {
		this.resumableStates.set(filename, state);
	}

	private recordCompressionStats(stats: CompressionStats): void {
		this.compressionStats.push(stats);
    
		// 只保留最近100条记录
		if (this.compressionStats.length > 100) {
			this.compressionStats.splice(0, this.compressionStats.length - 100);
		}
	}

	private getFilenameFromPath(filePath: string): string {
		return filePath.split('/').pop() || '';
	}
  
	/**
   * 文件完整性校验
   */
	private async validateFileIntegrity(
		filePath: string,
		expectedSize: number,
		expectedMd5?: string
	): Promise<FileValidationResult> {
		const fs = await import('fs');
		const crypto = await import('crypto');
    
		try {
			// 检查文件是否存在
			const stats = await fs.promises.stat(filePath);
			const actualSize = stats.size;
      
			// 长度校验
			const lengthValid = actualSize === expectedSize;
      
			const result: FileValidationResult = {
				lengthValid,
				expectedSize,
				actualSize
			};
      
			// MD5 校验（如果提供了期望值）
			if (expectedMd5 && this.enableMd5Validation) {
				try {
					const hash = crypto.createHash('md5');
					const stream = fs.createReadStream(filePath);
          
					await new Promise((resolve, reject) => {
						stream.on('data', (data) => hash.update(data));
						stream.on('end', resolve);
						stream.on('error', reject);
					});
          
					const actualMd5 = hash.digest('hex');
					result.md5Valid = actualMd5.toLowerCase() === expectedMd5.toLowerCase();
					result.expectedMd5 = expectedMd5;
					result.actualMd5 = actualMd5;
				} catch (md5Error) {
					result.error = `MD5 计算失败: ${md5Error instanceof Error ? md5Error.message : String(md5Error)}`;
				}
			}
      
			return result;
		} catch (error) {
			return {
				lengthValid: false,
				expectedSize,
				actualSize: 0,
				error: `文件访问失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}
  
	/**
   * 更新断点续传状态
   */
	private updateResumeState(
		filePath: string,
		totalSize: number,
		transferredSize: number,
		tempFilePath?: string,
		expectedMd5?: string
	): void {
		const now = Date.now();
		const existing = this.resumableStates.get(filePath);
    
		const state: ResumableTransferState = {
			filePath,
			totalSize,
			transferredSize,
			lastModified: now,
			tempFilePath,
			expectedMd5,
			attempts: existing ? existing.attempts + 1 : 1,
			startTime: existing?.startTime || now,
			lastUpdateTime: now,
			validated: false
		};
    
		this.resumableStates.set(filePath, state);
    
		if (this.extendedConfig.enableLogging) {
			console.log(`[断点续传] 状态更新: ${filePath} - ${transferredSize}/${totalSize} bytes (${Math.round((transferredSize / totalSize) * 100)}%)`);
		}
	}
  
	/**
   * 清理断点续传状态
   */
	private clearResumeState(filePath: string): void {
		const state = this.resumableStates.get(filePath);
		if (state && state.tempFilePath) {
			// 清理临时文件
			import('fs').then(fs => {
				fs.promises.unlink(state.tempFilePath!).catch(() => {});
			});
		}
    
		this.resumableStates.delete(filePath);
    
		if (this.extendedConfig.enableLogging) {
			console.log(`[断点续传] 状态清理: ${filePath}`);
		}
	}
  
	/**
   * 启用/禁用 MD5 校验
   */
	setMd5ValidationEnabled(enabled: boolean): void {
		this.enableMd5Validation = enabled;
		if (this.extendedConfig.enableLogging) {
			console.log(`[ExtendedFtpOptimizer] MD5 校验 ${enabled ? '已启用' : '已禁用'}`);
		}
	}
  
	/**
   * 获取断点续传状态统计
   */
	getResumeStats(): {
    activeTransfers: number;
    totalStates: number;
    statesByFile: Array<{
      filePath: string;
      progress: number;
      attempts: number;
      duration: number;
      validated: boolean;
    }>;
    } {
		const now = Date.now();
		const statesByFile = Array.from(this.resumableStates.values()).map(state => ({
			filePath: state.filePath,
			progress: state.totalSize > 0 ? (state.transferredSize / state.totalSize) * 100 : 0,
			attempts: state.attempts,
			duration: now - state.startTime,
			validated: state.validated
		}));
    
		return {
			activeTransfers: this.activeTransfers.size,
			totalStates: this.resumableStates.size,
			statesByFile
		};
	}
}
