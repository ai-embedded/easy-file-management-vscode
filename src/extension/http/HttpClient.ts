/**
 * HTTP客户端 - 基于Node.js直连实现
 * 使用axios库提供完整的HTTP/HTTPS支持
 * 集成重试管理器支持自动重试
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { PassThrough, pipeline } from 'stream';
import { promisify } from 'util';
import FormData = require('form-data');
import { RetryManager, OperationType } from '../../shared/connection';
import { HttpConnectionPool } from './HttpConnectionPool';
import {
	HttpConfig,
	HttpRequestOptions,
	HttpResponse,
	DownloadConfig,
	UploadConfig,
	FileItem,
	FileOperationResult,
	ProgressInfo
} from '../../shared/types';
import { normalizeRemotePath, urlProtocolPattern } from '../../shared/utils/pathUtils';
import { HttpUniversalCodec } from './HttpUniversalCodec';
import { HttpCapabilityNegotiator, ServerCapabilities } from './HttpCapabilityNegotiator';
import { Logger } from '../../shared/utils/Logger';
import { handleInterruptedDownload, InterruptedDownloadReason } from '../utils/DownloadCleanup';

const pipelineAsync = promisify(pipeline);

interface HttpStreamUploadOptions {
	uploadUrl: string;
	targetPath: string;
	filename: string;
	totalSize: number;
	fields?: Record<string, any>;
	chunkSize?: number;
}

export interface HttpStreamUploadHandle {
	sessionId: string;
	acceptedChunkSize: number;
	writeChunk(data: Buffer): Promise<void>;
	finish(): Promise<FileOperationResult>;
	abort(reason?: string): Promise<void>;
}

export class HttpClient {
	private axiosInstance?: AxiosInstance;
	private config?: HttpConfig;
	private baseURL?: string;
	private isConnected = false;
	private retryManager: RetryManager;
  
	// 🆕 协议选择和能力协商相关
	private codec: HttpUniversalCodec;
	private negotiator: HttpCapabilityNegotiator;
	private serverCapabilities?: ServerCapabilities;
	private logger = new Logger('HttpClient');
  
	// 🚀 连接池管理（复用TCP连接池策略）
	private static connectionPool?: HttpConnectionPool;
	private static getConnectionPool(): HttpConnectionPool {
		if (!HttpClient.connectionPool) {
			HttpClient.connectionPool = new HttpConnectionPool({
				maxSockets: 8,              // 与TCP保持一致
				maxFreeSockets: 4,
				timeout: 30000,
				keepAliveTimeout: 300000,   // 5分钟Keep-Alive
				freeSocketTimeout: 15000,
				enableHttp2: false          // 可通过配置启用
			});
		}
		return HttpClient.connectionPool;
	}
  
	constructor() {
		// 初始化重试管理器
		this.retryManager = new RetryManager({
			maxAttempts: 3,
			initialDelay: 1000,
			maxDelay: 10000,
			enableLogging: true
		});
    
		// 🆕 初始化协议组件
		this.codec = new HttpUniversalCodec();
		this.negotiator = new HttpCapabilityNegotiator({
			timeout: 5000,
			retryAttempts: 2,
			enableCaching: true,
			cacheExpireTime: 300000 // 5分钟
		});
	}

	/**
	 * 测试与远端服务的连通性
	 */
	async testConnection(config: HttpConfig): Promise<boolean> {
		const protocol = config.protocol || 'http';
		const port = config.port || (protocol === 'https' ? 443 : 80);
		const baseURL = config.baseURL || `${protocol}://${config.host}:${port}`;
		const timeout = config.timeout || 10000;

		try {
			const response = await axios.get(`${baseURL}/api/ping`, {
				timeout,
				headers: config.headers,
				validateStatus: () => true
			});
			return response.status >= 200 && response.status < 300;
		} catch (error) {
			this.logger.warn('HTTP 测试连接失败', error);
			return false;
		}
	}

	/**
   * 连接到HTTP服务器（增强版，支持协议选择和能力协商）
   */
	async connect(config: HttpConfig): Promise<boolean> {
		let axiosInstance: AxiosInstance | undefined;
		let baseURL = '';
		const connectionPool = HttpClient.getConnectionPool();

		try {
			this.logger.info(`连接HTTP服务器: ${config.host}:${config.port || 80}, 协议: ${config.dataFormat || 'json'}`);
      
			// 🔧 验证和设置默认配置
			if (!HttpUniversalCodec.validateConfig(config)) {
				this.logger.warn('配置验证失败，使用默认配置');
				config.dataFormat = 'json';
			}
      
			this.config = config;
      
			// 构建基础URL
			const protocol = config.protocol || 'http';
			const port = config.port || (protocol === 'https' ? 443 : 80);
			baseURL = config.baseURL || `${protocol}://${config.host}:${port}`;
      
			// 如果先前已有连接，先释放旧的引用
			if (this.baseURL) {
				connectionPool.releaseInstance(this.baseURL);
				this.baseURL = undefined;
			}

			// 🚀 使用连接池获取优化的axios实例（借鉴TCP连接池策略）
			axiosInstance = await connectionPool.getOptimizedInstance(baseURL);
			this.axiosInstance = axiosInstance;
			this.baseURL = baseURL;
      
			// 🔧 应用额外配置（在连接池基础上）
			this.axiosInstance.defaults.timeout = config.timeout || 30000;
			this.axiosInstance.defaults.headers = { ...this.axiosInstance.defaults.headers, ...config.headers };
			this.axiosInstance.defaults.validateStatus = () => true; // 接受所有状态码
      
			this.logger.info(`🚀 使用连接池连接: ${baseURL}`);

			// 添加请求拦截器（支持协议编码）
			this.axiosInstance.interceptors.request.use(async (axiosConfig) => {
				this.logger.debug(`请求: ${axiosConfig.method?.toUpperCase()} ${axiosConfig.url}`);

				if ((axiosConfig as any).__skipCodec) {
					delete (axiosConfig as any).__skipCodec;
					this.logger.debug('已根据配置跳过编码流程');
					return axiosConfig;
				}
        
				// 🆕 如果有数据且需要编码，使用HttpUniversalCodec
				if (axiosConfig.data && this.shouldEncodeData(axiosConfig)) {
					try {
						const encoded = await this.codec.encodeForHttp(
							axiosConfig.data,
							this.getOperationFromUrl(axiosConfig.url || ''),
							this.config?.dataFormat || 'json'
						);
            
						axiosConfig.data = encoded.data;
						axiosConfig.headers = axiosConfig.headers || {};
						axiosConfig.headers['Content-Type'] = encoded.contentType;
						axiosConfig.headers['X-Data-Format'] = encoded.format;
            
						this.logger.debug(`数据已编码: ${encoded.format}, 大小: ${encoded.data.length} 字节`);
					} catch (error) {
						this.logger.warn(`数据编码失败，使用原始数据: ${error}`);
					}
				}
        
				return axiosConfig;
			}, (error) => {
				this.logger.error('请求错误:', error);
				return Promise.reject(error);
			});

			// 添加响应拦截器（支持协议解码）
			this.axiosInstance.interceptors.response.use(async (response) => {
				this.logger.debug(`响应: ${response.status} ${response.statusText}`);

				// 🆕 如果响应需要解码，使用HttpUniversalCodec
				const decodeContext = this.prepareDecodingContext(response);
				if (decodeContext) {
					try {
						const decodedData = await this.codec.decodeFromHttp(
							decodeContext.buffer,
							decodeContext.contentType
						);
						response.data = decodedData;
						this.logger.debug(`响应数据已解码: ${decodeContext.contentType}`);
					} catch (error) {
						this.logger.warn(`响应解码失败，使用原始数据: ${error}`);
					}
				}

				return response;
			}, (error) => {
				this.logger.error('响应错误:', error);
				return Promise.reject(error);
			});

			// 🆕 执行能力协商（如果启用）
			if (config.dataFormat === 'auto' && config.negotiation?.enabled) {
				try {
					this.logger.info('开始服务器能力协商...');
					this.serverCapabilities = await this.negotiator.negotiateCapabilities(baseURL, this.axiosInstance);
          
					// 根据协商结果调整配置
					this.adjustConfigByCapabilities(this.serverCapabilities);
          
					this.logger.info('服务器能力协商完成', {
						formats: this.serverCapabilities.supportedFormats,
						recommended: this.serverCapabilities.recommendedFormat
					});
				} catch (error) {
					this.logger.warn(`能力协商失败，使用默认配置: ${error}`);
					this.config.dataFormat = 'json'; // 回退到JSON
				}
			}

		// 测试连接
		try {
			const response = await this.axiosInstance.get('/api/ping');
			this.isConnected = response.status === 200;
			
			if (!this.isConnected) {
				this.logger.warn(`Ping返回非200状态码: ${response.status}`);
			}
		} catch (error) {
			// 分析错误类型
			let errorMessage = '未知错误';
			let errorCode: string | undefined;
			
			if (error && typeof error === 'object') {
				if ('code' in error) {
					errorCode = String(error.code);
				}
				if ('message' in error) {
					errorMessage = String(error.message);
				} else if ('response' in error && error.response) {
					const axiosError = error as any;
					if (axiosError.response?.status) {
						errorMessage = `HTTP ${axiosError.response.status}: ${axiosError.response.statusText || '请求失败'}`;
					} else if (axiosError.request) {
						errorMessage = '网络请求失败，服务器无响应';
					}
				} else if ('request' in error) {
					errorMessage = '网络请求失败，无法连接到服务器';
				}
			} else if (error instanceof Error) {
				errorMessage = error.message;
			} else if (typeof error === 'string') {
				errorMessage = error;
			}
			
			// 如果是连接错误（ECONNREFUSED等），直接抛出
			if (errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT' || errorCode === 'ENOTFOUND') {
				this.logger.error('HTTP连接失败:', { 
					error: errorMessage, 
					code: errorCode,
					baseURL,
					protocol: this.config.dataFormat 
				});
				throw new Error(`无法连接到服务器 ${baseURL}: ${errorMessage}`);
			}
			
			// 其他错误，记录警告但继续（服务器可能没有/api/ping端点）
			this.logger.warn('Ping测试失败，但连接已建立', { error: errorMessage, code: errorCode });
			this.isConnected = true;
		}

			this.logger.info(`HTTP连接${this.isConnected ? '成功' : '失败'}`, {
				protocol: this.config.dataFormat,
				capabilities: this.serverCapabilities?.supportedFormats
			});
      
			return this.isConnected;
		} catch (error) {
			if (axiosInstance && baseURL) {
				connectionPool.releaseInstance(baseURL);
			}
			if (this.baseURL === baseURL) {
				this.baseURL = undefined;
			}
			this.axiosInstance = undefined;
			this.isConnected = false;
			
			// 提取详细的错误信息
			let errorMessage = '未知错误';
			let errorCode: string | undefined;
			let errorDetails: any = {};
			
			if (error && typeof error === 'object') {
				if ('code' in error) {
					errorCode = String(error.code);
					errorDetails.code = errorCode;
				}
				if ('message' in error) {
					errorMessage = String(error.message);
				} else if ('response' in error && error.response) {
					const axiosError = error as any;
					if (axiosError.response?.status) {
						errorMessage = `HTTP ${axiosError.response.status}: ${axiosError.response.statusText || '请求失败'}`;
						errorDetails.status = axiosError.response.status;
						errorDetails.statusText = axiosError.response.statusText;
					} else if (axiosError.request) {
						errorMessage = '网络请求失败，服务器无响应';
						errorDetails.requestFailed = true;
					}
				} else if ('request' in error) {
					errorMessage = '网络请求失败，无法连接到服务器';
					errorDetails.connectionFailed = true;
				}
				
				// 提取更多Axios错误信息
				if ('config' in error) {
					const axiosError = error as any;
					errorDetails.url = axiosError.config?.url;
					errorDetails.method = axiosError.config?.method;
				}
			} else if (error instanceof Error) {
				errorMessage = error.message;
			} else if (typeof error === 'string') {
				errorMessage = error;
			}
			
			this.logger.error('HTTP连接失败:', { 
				error: errorMessage,
				code: errorCode,
				baseURL,
				protocol: this.config.dataFormat,
				...errorDetails
			});
			
			throw new Error(`HTTP连接失败: ${errorMessage}${errorCode ? ` (${errorCode})` : ''}`);
		}
	}

	/**
   * 断开连接
   */
	async disconnect(): Promise<void> {
		const pool = HttpClient.connectionPool;
		if (this.baseURL && pool) {
			pool.releaseInstance(this.baseURL);
		}
		this.baseURL = undefined;
		this.axiosInstance = undefined;
		this.config = undefined;
		this.isConnected = false;
		console.log('[HttpClient] HTTP连接已断开');
	}

	/**
   * 发送HTTP请求（支持自动重试）
   */
	async request(options: HttpRequestOptions): Promise<HttpResponse> {
		this.ensureConnected();

		// 判断请求是否幂等
		const isIdempotent = ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'].includes(
			(options.method || 'GET').toUpperCase()
		);
    
		// 非幂等请求不重试（POST等）
		if (!isIdempotent) {
			return this.executeRequest(options);
		}
    
		// 幂等请求使用重试管理器
		return this.retryManager.executeWithRetry(
			() => this.executeRequest(options),
			OperationType.REQUEST,
			`${options.method}_${options.url}`
		);
	}
  
	/**
   * 执行HTTP请求（内部方法）
   */
	private async executeRequest(options: HttpRequestOptions): Promise<HttpResponse> {
		try {
			const config: AxiosRequestConfig = {
				method: options.method || 'GET',
				url: options.url,
				headers: options.headers,
				data: options.data,
				params: options.params,
				timeout: options.timeout,
				responseType: options.responseType || 'json'
			};

			if (options.skipCodec) {
				(config as any).__skipCodec = true;
			}

			const response = await this.axiosInstance!.request(config);

			return {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers as Record<string, string>,
				data: response.data
			};
		} catch (error) {
			console.error('[HttpClient] 请求失败:', error);
			throw new Error(`HTTP请求失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
   * 获取文件列表
   */
	async listFiles(path = '/'): Promise<FileItem[]> {
		this.ensureConnected();

		try {
			const normalizedPath = normalizeRemotePath(path, '/', '');
			const response = await this.request({
				method: 'GET',
				url: '/api/files',
				params: { path: normalizedPath }
			});

			// 处理响应数据
			let files: any[] = [];
      
			this.logger.debug('文件列表响应数据:', { 
				hasData: !!response.data,
				dataType: typeof response.data,
				isArray: Array.isArray(response.data),
				hasFiles: !!(response.data && response.data.files),
				hasDataProp: !!(response.data && response.data.data),
				responseKeys: response.data && typeof response.data === 'object' ? Object.keys(response.data) : []
			});
      
			if (response.data) {
				if (Array.isArray(response.data)) {
					files = response.data;
				} else if (response.data.files && Array.isArray(response.data.files)) {
					files = response.data.files;
				} else if (response.data.data && Array.isArray(response.data.data)) {
					files = response.data.data;
				}
			}

			this.logger.info(`解析到 ${files.length} 个文件`, { path: normalizedPath });

			return files.map((item: any) => ({
				name: item.name || 'unknown',
				path: item.path || '',
				type: item.type || 'file',
				size: item.size || 0,
				lastModified: item.lastModified ? new Date(item.lastModified) : new Date(),
				permissions: item.permissions,
				isReadonly: item.isReadonly || false
			}));
		} catch (error) {
			console.error('[HttpClient] 获取文件列表失败:', error);
			throw new Error(`获取文件列表失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
   * 下载文件（优化版：流式处理，避免内存峰值）
   */
	async downloadFile(config: DownloadConfig): Promise<Buffer> {
		this.ensureConnected();
		const resolvedUrl = this.resolveDownloadUrl(config);

		return this.retryManager.executeWithRetry(
			async () => {
				this.logger.info(`下载文件: ${resolvedUrl}`);

				const response = await this.axiosInstance!({
					method: 'GET',
					url: resolvedUrl,
					responseType: 'stream'
				});

				// 从response headers获取文件总大小
				const total = Number(response.headers['content-length'] || 0);
				let loaded = 0;

				// 🔧 流式读取响应体，逐块累积，同时上报进度
				const bufferList: Buffer[] = [];
				const maxBufferSize = 10 * 1024 * 1024; // 10MB缓冲区限制
				let totalBufferSize = 0;
				let largeFileWarningEmitted = false;
				const stream = response.data as NodeJS.ReadableStream;

				try {
					for await (const rawChunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
						const chunk = Buffer.isBuffer(rawChunk)
							? rawChunk
							: Buffer.from(rawChunk);

						if (!largeFileWarningEmitted && totalBufferSize + chunk.length > maxBufferSize) {
							this.logger.warn('文件较大，建议使用 downloadAsStream 或 downloadFileInChunks 以减少内存占用');
							largeFileWarningEmitted = true;
						}

						bufferList.push(chunk);
						totalBufferSize += chunk.length;
						loaded += chunk.length;

						if (config.onProgress) {
							config.onProgress({
								total,
								loaded,
								percent: total ? Math.round((loaded / total) * 100) : 0,
								filename: config.filename
							});
						}
					}
				} catch (error) {
					this.logger.error('文件下载失败:', error);
					throw new Error(`文件下载失败: ${error instanceof Error ? error.message : String(error)}`);
				}

				const finalBuffer = Buffer.concat(bufferList);
				let effectiveBuffer = finalBuffer;
				const decodeContext = this.prepareDecodingContext({ headers: response.headers, data: finalBuffer });

				if (decodeContext) {
					try {
						const decodedData = await this.codec.decodeFromHttp(
							decodeContext.buffer,
							decodeContext.contentType
						);
						effectiveBuffer = Buffer.isBuffer(decodedData)
							? decodedData
							: Buffer.from(JSON.stringify(decodedData));
					} catch (decodeError) {
						this.logger.warn(`协议解码失败，使用原始数据: ${decodeError}`);
					}
				}

				if (!this.isSuccessfulStatus(response.status)) {
					const message = this.buildHttpErrorMessage(
						response.status,
						response.statusText,
						response.headers,
						effectiveBuffer,
						resolvedUrl
					);
					this.logger.warn(message, {
						status: response.status,
						statusText: response.statusText,
						url: resolvedUrl
					});
					throw new Error(message);
				}

				this.logger.info(`文件下载完成: ${effectiveBuffer.length} bytes`);
				return effectiveBuffer;
			},
			OperationType.DOWNLOAD,
			`download_${resolvedUrl}`
		);
	}

	/**
   * 🆕 流式下载文件（返回可读流，真正的流式处理）
   * 推荐用于大文件下载，避免内存占用
   */
	async downloadAsStream(config: DownloadConfig): Promise<NodeJS.ReadableStream> {
		this.ensureConnected();
		const resolvedUrl = this.resolveDownloadUrl(config);

		this.logger.info(`流式下载文件: ${resolvedUrl}`);

		const response = await this.axiosInstance!({
			method: 'GET',
			url: resolvedUrl,
			responseType: 'stream'
		});

		if (!this.isSuccessfulStatus(response.status)) {
			const errorPayload = await this.readStreamToBuffer(response.data as NodeJS.ReadableStream);
			const message = this.buildHttpErrorMessage(
				response.status,
				response.statusText,
				response.headers,
				errorPayload,
				resolvedUrl
			);
			this.logger.warn(message, {
				status: response.status,
				statusText: response.statusText,
				url: resolvedUrl
			});
			throw new Error(message);
		}

		// 从response headers获取文件总大小
		const total = Number(response.headers['content-length'] || 0);
		let loaded = 0;

		// 创建进度跟踪的Transform流
		const progressStream = new PassThrough();
		const stream = response.data as NodeJS.ReadableStream;

		stream.on('data', (chunk: Buffer) => {
			loaded += chunk.length;

			// 发送进度信息
			if (config.onProgress) {
				config.onProgress({
					loaded,
					total,
					percent: total ? Math.round((loaded / total) * 100) : 0,
					filename: config.filename
				});
			}
		});

		// 将响应流通过进度跟踪流
		stream.pipe(progressStream);

		stream.on('error', (error: Error) => {
			this.logger.error('流式下载失败:', error);
			progressStream.destroy(error);
		});

		stream.on('end', () => {
			this.logger.info('流式下载完成');
		});

		return progressStream;
	}

	/**
   * 🆕 分片下载文件（支持HTTP Range请求）
   * 用于大文件的并发分片下载
   */
	async downloadFileInChunks(config: DownloadConfig & {
    chunkSize?: number;
    maxConcurrency?: number;
  }): Promise<Buffer> {
		this.ensureConnected();
		const resolvedUrl = this.resolveDownloadUrl(config);

		try {
			// 🚀 使用新的HttpChunkedDownloader
			const chunkedDownloaderModule = await import('./HttpChunkedDownloader');

			const chunkedDownloader = new chunkedDownloaderModule.HttpChunkedDownloader(
        this.axiosInstance!,
        {
	        	url: resolvedUrl,
        	chunkSize: config.chunkSize || 256 * 1024, // 256KB默认
        	maxConcurrency: config.maxConcurrency || 4,
        	maxRetries: 3,
        	timeout: 30000,
        	adaptiveChunkSize: true,
        	networkQuality: this.inferNetworkQuality(),
        	enableRangeRequests: true
        },
        undefined, // performanceMonitor可选
        (progress) => {
        	// 🆕 进度回调适配
        	if (config.onProgress) {
        		config.onProgress({
        			loaded: progress.downloadedBytes,
        			total: progress.totalBytes,
        			percent: progress.percentage,
        			filename: config.filename
        		});
        	}
        }
			);

			const result = await chunkedDownloader.download();
      
			if (!result.success || !result.data) {
				throw new Error(result.error || '分片下载失败');
			}

			this.logger.info(`🚀 智能分片下载完成: ${(result.data.length / 1024 / 1024).toFixed(1)}MB, 平均速度: ${(result.avgSpeed / 1024 / 1024).toFixed(1)}MB/s`);
      
			return result.data;
		} catch (error) {
			this.logger.warn('分片下载失败，回退到普通下载:', error);
			// 回退到普通下载
			return this.downloadFile(config);
		}
	}

	/**
   * 🧠 推断网络质量（基于服务器能力和配置）
   * @private
   */
	private inferNetworkQuality(): 'fast' | 'medium' | 'slow' {
		// 简化实现：基于配置和服务器能力推断
		if (this.serverCapabilities?.supportedFeatures.includes('high-speed-transfer')) {
			return 'fast';
		}
    
		// 可以基于历史性能数据进一步优化
		// 目前返回默认中等质量
		return 'medium';
	}

	/**
   * 直接下载文件到指定路径（避免内存峰值）
   */
	async downloadAndSave(
		config: DownloadConfig & { targetPath: string },
		options?: { signal?: AbortSignal; operationId?: string }
	): Promise<FileOperationResult> {
		this.ensureConnected();
		const resolvedUrl = this.resolveDownloadUrl(config);
		const abortSignal = options?.signal;
		const operationId = options?.operationId ?? `downloadAndSave_${resolvedUrl}`;

		return this.retryManager.executeWithRetry(
			async () => {
				console.log(`[HttpClient] 直存下载文件: ${resolvedUrl} -> ${config.targetPath}`);
				const expectedSizeHint = typeof config.fileSize === 'number' && Number.isFinite(config.fileSize)
					? Math.max(0, config.fileSize)
					: undefined;

				const response = await this.axiosInstance!({
					method: 'GET',
					url: resolvedUrl,
					responseType: 'stream',
					signal: abortSignal
				});

				const total = Number(response.headers['content-length'] || 0);
				let loaded = 0;
				let aborted = false;

				const writeStream = fs.createWriteStream(config.targetPath);
				const progressStream = new PassThrough();

				const handleAbort = () => {
					aborted = true;
					response.data?.destroy(new Error('OPERATION_CANCELLED'));
					writeStream.destroy(new Error('OPERATION_CANCELLED'));
				};

				if (abortSignal) {
					abortSignal.addEventListener('abort', handleAbort);
				}

				progressStream.on('data', (chunk: Buffer) => {
					loaded += chunk.length;
					if (config.onProgress) {
						config.onProgress({
							loaded,
							total,
							percent: total ? Math.round((loaded / total) * 100) : 0,
							filename: config.filename || 'unknown'
						});
					}
				});

				try {
					await pipelineAsync(response.data, progressStream, writeStream);
				} catch (error) {
					if (abortSignal) {
						abortSignal.removeEventListener('abort', handleAbort);
					}
					const cleanupReason: InterruptedDownloadReason =
						aborted || (error instanceof Error && error.message === 'OPERATION_CANCELLED')
							? 'cancelled'
							: 'error';
					try {
						await handleInterruptedDownload({
							targetPath: config.targetPath,
							expectedSize: expectedSizeHint || (total > 0 ? total : undefined),
							bytesWritten: loaded,
							reason: cleanupReason,
							transport: 'HTTP',
							logger: this.logger
						});
					} catch (cleanupError) {
						this.logger.warn('HTTP下载清理失败', {
							targetPath: config.targetPath,
							cleanupReason,
							error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
						});
					}
					if (cleanupReason === 'cancelled') {
						throw new Error('OPERATION_CANCELLED');
					}
					throw error;
				}

				if (abortSignal) {
					abortSignal.removeEventListener('abort', handleAbort);
				}

				console.log(`[HttpClient] 文件直存完成: ${config.targetPath}, 大小: ${loaded} bytes`);

				return {
					success: true,
					message: '文件下载完成',
					data: { path: config.targetPath, size: loaded }
				};
			},
			OperationType.DOWNLOAD,
			operationId
		);
	}

	/**
   * 上传文件
   */
	async createStreamUploadSession(options: HttpStreamUploadOptions): Promise<HttpStreamUploadHandle> {
		this.ensureConnected();
		if (!this.axiosInstance) {
			throw new Error('HTTP连接未建立');
		}

		const sessionId = `http-stream-${randomUUID()}`;
		const chunkSize = Math.max(64 * 1024, Math.min(options.chunkSize ?? 512 * 1024, 4 * 1024 * 1024, Math.max(options.totalSize || 0, 64 * 1024)));
		let ended = false;
		let aborted = false;
		let bytesWritten = 0;

		const fileStream = new PassThrough({ highWaterMark: chunkSize });
		const abortController = new AbortController();

		const formData = new FormData();
		formData.append('file', fileStream, {
			filename: options.filename,
			knownLength: Math.max(0, options.totalSize)
		});

		for (const [key, value] of Object.entries(options.fields ?? {})) {
			if (value !== undefined && value !== null) {
				formData.append(key, value);
			}
		}

		const headers = formData.getHeaders();
		try {
			const contentLength = await new Promise<number>((resolve, reject) => {
				(formData as any).getLength((err: Error | null, length: number) => {
					if (err) {
						return reject(err);
					}
					resolve(length);
				});
			});
			headers['Content-Length'] = contentLength;
		} catch (error) {
			this.logger.debug('无法预计算HTTP流式上传Content-Length，改用chunked编码', {
				error: error instanceof Error ? error.message : String(error)
			});
		}

		const requestConfig: AxiosRequestConfig & { __skipCodec?: boolean } = {
			headers,
			maxBodyLength: Infinity,
			maxContentLength: Infinity,
			signal: abortController.signal
		};
		requestConfig.__skipCodec = true;

		const requestPromise = this.axiosInstance.post(options.uploadUrl, formData, requestConfig);

		const completionPromise: Promise<FileOperationResult> = new Promise((resolve) => {
			requestPromise.then((response) => {
				resolve({
					success: response.status >= 200 && response.status < 300,
					message: response.data?.message || '文件上传成功',
					data: response.data
				});
			}).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				resolve({
					success: false,
					message: `HTTP上传失败: ${message}`
				});
			});
		});

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
			if (!fileStream.write(data)) {
				await new Promise<void>((resolve, reject) => {
					const onDrain = () => {
						cleanup();
						resolve();
					};
					const onError = (err: Error) => {
						cleanup();
						reject(err);
					};
					const cleanup = () => {
						fileStream.off('drain', onDrain);
						fileStream.off('error', onError);
					};
					fileStream.once('drain', onDrain);
					fileStream.once('error', onError);
				});
			}
		};

		const finish = async (): Promise<FileOperationResult> => {
			if (aborted) {
				return {
					success: false,
					message: 'HTTP流式上传已被取消'
				};
			}
			if (!ended) {
				ended = true;
				try {
					await new Promise<void>((resolve, reject) => {
						const onError = (err: Error) => {
							fileStream.off('finish', onFinish);
							reject(err);
						};
						const onFinish = () => {
							fileStream.off('error', onError);
							resolve();
						};
						fileStream.once('error', onError);
						fileStream.once('finish', onFinish);
						fileStream.end();
					});
				} catch (error) {
					this.logger.warn('HTTP流式上传结束写入流失败', error);
				}
			}
			const result = await completionPromise;
			this.logger.info('HTTP流式上传完成', {
				sessionId,
				bytesWritten,
				success: result.success,
				message: result.message
			});
			if (!result.success && !result.message) {
				result.message = 'HTTP流式上传失败';
			}
			return result;
		};

		const abort = async (reason?: string): Promise<void> => {
			if (ended || aborted) {
				return;
			}
			aborted = true;
			const abortMessage = reason || 'HTTP流式上传被取消';
			abortController.abort(abortMessage);
			if (!fileStream.destroyed) {
				fileStream.destroy(new Error(abortMessage));
			}
			this.logger.warn('HTTP流式上传中止', {
				sessionId,
				bytesWritten,
				reason: abortMessage
			});
			await completionPromise;
		};

		this.logger.info('创建HTTP流式上传会话', {
			sessionId,
			filename: options.filename,
			chunkSize,
			targetPath: options.targetPath,
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
	 * 上传文件（已废弃，统一通过流式会话实现）
	 */
	async uploadFile(config: UploadConfig): Promise<FileOperationResult> {
		throw new Error('HTTP上传已统一使用 streamUpload 会话，请改用 createStreamUploadSession');
	}

	/**
   * 删除文件
   */
	async deleteFile(path: string): Promise<FileOperationResult> {
		this.ensureConnected();

		try {
			const response = await this.request({
				method: 'DELETE',
				url: '/api/files',
				params: { path }
			});

			return {
				success: response.status >= 200 && response.status < 300,
				message: response.data?.message || '文件删除成功',
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				message: `文件删除失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/**
   * 重命名文件
   */
	async renameFile(oldPath: string, newPath: string): Promise<FileOperationResult> {
		this.ensureConnected();

		try {
			const response = await this.request({
				method: 'PUT',
				url: '/api/files/rename',
				data: { oldPath, newPath },
				headers: {
					'Content-Type': 'application/json'
				},
				skipCodec: true
			});

			return {
				success: response.status >= 200 && response.status < 300,
				message: response.data?.message || '文件重命名成功',
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				message: `文件重命名失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/**
   * 创建目录
   */
	async createDirectory(path: string): Promise<FileOperationResult> {
		this.ensureConnected();

		try {
			// 解析路径
			let parentPath = '/';
			let folderName = '';
      
			const cleanPath = path.endsWith('/') ? path.slice(0, -1) : path;
			const lastSlashIndex = cleanPath.lastIndexOf('/');
      
			if (lastSlashIndex === 0) {
				parentPath = '/';
				folderName = cleanPath.substring(1);
			} else if (lastSlashIndex > 0) {
				parentPath = cleanPath.substring(0, lastSlashIndex);
				folderName = cleanPath.substring(lastSlashIndex + 1);
			} else {
				folderName = cleanPath;
			}

			const response = await this.request({
				method: 'POST',
				url: '/api/files/directory',
				data: { path: parentPath, name: folderName },
				headers: {
					'Content-Type': 'application/json'
				},
				skipCodec: true
			});

			return {
				success: response.status >= 200 && response.status < 300,
				message: response.data?.message || '目录创建成功',
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				message: `目录创建失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/**
   * 获取文件信息
   */
	async getFileInfo(path: string): Promise<FileItem> {
		this.ensureConnected();

		try {
			const response = await this.request({
				method: 'GET',
				url: '/api/files/info',
				params: { path }
			});

			const item = response.data;
			return {
				name: item.name,
				path: item.path,
				type: item.type,
				size: item.size || 0,
				lastModified: new Date(item.lastModified),
				permissions: item.permissions,
				isReadonly: item.isReadonly || false
			};
		} catch (error) {
			throw new Error(`获取文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
   * 确保已连接
   */
	private ensureConnected(): void {
		if (!this.isConnected || !this.axiosInstance) {
			throw new Error('HTTP连接未建立');
		}
	}
  
	// 🆕 协议选择相关的辅助方法
  
	/**
   * 判断是否需要编码数据
   */
	private shouldEncodeData(axiosConfig: any): boolean {
		const data = axiosConfig.data;
		if (!data) {return false;}

		// FormData/流式数据不参与编码
		if (data instanceof FormData || typeof data?.pipe === 'function') {
			return false;
		}

		// 只对特定的API端点进行编码
		const apiEndpoints = ['/api/files/upload', '/api/files', '/api/data'];
		const url = axiosConfig.url || '';
		return apiEndpoints.some(endpoint => url.includes(endpoint));
	}
  
	private prepareDecodingContext(response: { headers?: Record<string, any>; data: any }): { buffer: Buffer; contentType: string } | null {
		const headers = response.headers || {};
		const buffer = this.normalizeToBuffer(response.data);
		if (!buffer) {
			return null;
		}

		const contentTypeRaw = headers['content-type'] || headers['Content-Type'] || '';
		const normalizedContentType = contentTypeRaw.toLowerCase();
		const explicitFormatHeader = headers['x-data-format'] || headers['X-Data-Format'];

		if (explicitFormatHeader) {
			return {
				buffer,
				contentType: contentTypeRaw || String(explicitFormatHeader)
			};
		}

		if (!contentTypeRaw) {
			return null;
		}

		if (normalizedContentType.includes('json') || normalizedContentType.includes('application/x-protobuf')) {
			return {
				buffer,
				contentType: contentTypeRaw
			};
		}

		return null;
	}

	private normalizeToBuffer(data: any): Buffer | null {
		if (data === undefined || data === null) {
			return null;
		}

		if (Buffer.isBuffer(data)) {
			return data;
		}

		if (data instanceof ArrayBuffer) {
			return Buffer.from(data);
		}

		if (ArrayBuffer.isView(data)) {
			const view = data as ArrayBufferView;
			return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
		}

		if (typeof data === 'string') {
			return Buffer.from(data);
		}

		if (Array.isArray(data) && data.every(item => typeof item === 'number')) {
			return Buffer.from(data);
		}

		if (typeof data === 'object' && typeof (data as any).type === 'string' && (data as any).type === 'Buffer' && Array.isArray((data as any).data)) {
			return Buffer.from((data as any).data);
		}

		return null;
	}

	private isSuccessfulStatus(status?: number): boolean {
		return typeof status === 'number' && status >= 200 && status < 300;
	}

	private buildHttpErrorMessage(
		status: number | undefined,
		statusText: string | undefined,
		headers: Record<string, any> | undefined,
		payload: Buffer,
		url: string
	): string {
		const normalizedStatus = typeof status === 'number' ? status : 0;
		const baseMessage = `HTTP下载失败: 状态码 ${normalizedStatus}${statusText ? ` ${statusText}` : ''}，请求: ${url}`;
		if (!payload || payload.length === 0) {
			return baseMessage;
		}

		const contentType = this.getHeaderValue(headers, 'content-type')?.toLowerCase() || '';
		if (contentType.includes('application/json')) {
			try {
				const parsed = JSON.parse(payload.toString('utf8'));
				if (parsed && typeof parsed === 'object') {
					if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
						return `${baseMessage}，服务端提示: ${parsed.message}`;
					}
					return `${baseMessage}，响应体: ${JSON.stringify(parsed)}`;
				}
			} catch (error) {
				this.logger.debug('解析错误响应JSON失败，改用文本形式', error);
			}
		}

		const text = payload.toString('utf8').trim();
		if (text) {
			return `${baseMessage}，响应体: ${text}`;
		}

		return baseMessage;
	}

	private getHeaderValue(headers: Record<string, any> | undefined, key: string): string | undefined {
		if (!headers) {
			return undefined;
		}
		const lowerKey = key.toLowerCase();
		if (typeof (headers as any).get === 'function') {
			const direct = (headers as any).get(lowerKey) || (headers as any).get(key);
			if (direct) {
				return direct as string;
			}
		}
		return headers[lowerKey] || headers[key];
	}

	private async readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
		const chunks: Buffer[] = [];
		for await (const rawChunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
			const chunk = Buffer.isBuffer(rawChunk)
				? rawChunk
				: Buffer.from(rawChunk);
			chunks.push(chunk);
		}
		return Buffer.concat(chunks);
	}



	private resolveDownloadUrl(config: DownloadConfig): string {
		const { url, filePath, filename } = config;
		if (url) {
			if (urlProtocolPattern.test(url) || url.startsWith('/api/')) {
				return url;
			}
			const normalizedFromUrl = normalizeRemotePath(url, '/', filename || '');
			if (normalizedFromUrl.startsWith('/api/')) {
				return normalizedFromUrl;
			}
			return `/api/files/download?path=${encodeURIComponent(normalizedFromUrl)}`;
		}

		if (filePath) {
			const normalizedPath = normalizeRemotePath(filePath, '/', filename || '');
			if (urlProtocolPattern.test(normalizedPath) || normalizedPath.startsWith('/api/')) {
				return normalizedPath;
			}
			return `/api/files/download?path=${encodeURIComponent(normalizedPath)}`;
		}

		throw new Error('HTTP下载缺少目标路径');
	}



	/**
   * 从URL提取操作名称
   */
	private getOperationFromUrl(url: string): string {
		if (url.includes('/upload')) {return 'UPLOAD_FILE';}
		if (url.includes('/download')) {return 'DOWNLOAD_FILE';}
		if (url.includes('/files') && url.includes('DELETE')) {return 'DELETE_FILE';}
		if (url.includes('/files') && url.includes('GET')) {return 'LIST_FILES';}
		return 'REQUEST';
	}
  
	/**
   * 根据服务器能力调整配置
   */
	private adjustConfigByCapabilities(capabilities: ServerCapabilities): void {
		if (!this.config) {return;}
    
		// 如果服务器推荐的格式与当前配置不同，调整配置
		const recommendedFormat = capabilities.recommendedFormat;
		if (recommendedFormat && recommendedFormat !== this.config.dataFormat) {
			this.logger.info(`根据服务器建议调整协议: ${this.config.dataFormat} -> ${recommendedFormat}`);
			this.config.dataFormat = recommendedFormat as any;
		}
    
		// 根据服务器能力启用/禁用功能
		if (this.config.optimization) {
			// 如果服务器支持Range请求，启用分片传输
			if (capabilities.supportedFeatures.includes('range-requests')) {
				this.config.optimization.enableChunking = true;
				this.logger.debug('服务器支持Range请求，启用分片传输');
			}
      
			// 如果服务器支持断点续传，启用该功能
			if (capabilities.supportedFeatures.includes('resume-upload')) {
				this.config.optimization.enableResume = true;
				this.logger.debug('服务器支持断点续传，启用该功能');
			}
		}
	}
  
	/**
   * 获取当前服务器能力
   */
	public getServerCapabilities(): ServerCapabilities | undefined {
		return this.serverCapabilities;
	}
  
	/**
   * 获取当前使用的协议格式
   */
	public getCurrentProtocol(): string {
		return this.config?.dataFormat || 'json';
	}
  
	/**
   * 手动触发能力协商（用于重新协商）
   */
	public async refreshCapabilities(): Promise<ServerCapabilities | undefined> {
		if (!this.axiosInstance || !this.config) {return undefined;}
    
		try {
			const protocol = this.config.protocol || 'http';
			const port = this.config.port || (protocol === 'https' ? 443 : 80);
			const baseURL = this.config.baseURL || `${protocol}://${this.config.host}:${port}`;
      
			this.serverCapabilities = await this.negotiator.negotiateCapabilities(baseURL, this.axiosInstance);
			this.adjustConfigByCapabilities(this.serverCapabilities);
      
			return this.serverCapabilities;
		} catch (error) {
			this.logger.error('手动能力协商失败:', error);
			return undefined;
		}
	}
  
	/**
   * 🚀 获取连接池统计信息
   */
	public static getConnectionPoolStats() {
		if (!HttpClient.connectionPool) {
			return null;
		}
		return HttpClient.connectionPool.getStatistics();
	}
  
	/**
   * 📈 获取连接池性能摘要
   */
	public static getConnectionPoolSummary(): string {
		if (!HttpClient.connectionPool) {
			return '连接池未初始化';
		}
		return HttpClient.connectionPool.getPerformanceSummary();
	}
  
	/**
   * 🛑 关闭全局连接池（用于应用关闭时清理）
   */
	public static async shutdownConnectionPool(): Promise<void> {
		if (HttpClient.connectionPool) {
			await HttpClient.connectionPool.shutdown();
			HttpClient.connectionPool = undefined;
		}
	}
}
