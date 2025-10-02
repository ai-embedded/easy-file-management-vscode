import * as net from 'net';
import * as fs from 'fs';
import { FileHandle } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { setImmediate as yieldImmediate } from 'timers/promises';
import { UniversalCodec } from '../../shared/codec/UniversalCodec';
import { AdaptiveChunkStrategy, ChunkTransferResult } from '../../shared/strategies/AdaptiveChunkStrategy';
import { ResumableUploadManager } from '../../shared/upload/ResumableUploadManager';
import { 
	ConnectionStateMachine, 
	ConnectionState,
	ReconnectManager,
	ConnectionHandler,
	StateTransitionEvent
} from '../../shared/connection';
import { TcpKeepAlive, KeepAliveConfig } from './TcpKeepAlive';

import {
	TcpConfig,
	FileItem,
	UploadConfig,
	DownloadConfig,
	FileOperationResult
} from '../../shared/types';

import { TcpCommand, getCommandName } from '../../shared/constants/TcpCommands';
import { Logger, LogLevel } from '../../shared/utils/Logger';

interface ResponseMetrics {
	commandName: string;
	operation?: string;
	payloadBytes: number;
	frameBytes: number;
	encodeDurationMs: number;
	frameDurationMs: number;
	sentAt: number;
}

interface ResponseHandler {
	resolve: (response: any) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
	metrics?: ResponseMetrics;
}

/**
 * TCP客户端 - 基于Node.js直连实现
 * 使用原生net.Socket和UniversalCodec协议
 * 集成状态机和自动重连功能
 */
export class TcpClient implements ConnectionHandler {
	private socket?: net.Socket;
	private codec = new UniversalCodec();
	private _isConnected = false;
	// 🔧 修复P2问题：统一使用Logger控制日志等级
	private logger = new Logger('TcpClient');
	protected config?: TcpConfig;
	private sequenceNumber = 0;
	private messageQueue = new Map<number, ResponseHandler>();
  
	// ✅ P2-7: 序列号碰撞保护配置
	private static readonly MAX_CONCURRENT_REQUESTS = 1000; // 最大并发请求数
	private static readonly MAX_SEQUENCE_RETRIES = 100;     // 序列号生成最大重试次数
	private static readonly FRAME_PAYLOAD_LIMIT = 4 * 1024 * 1024; // 统一帧协议数据段最大长度（4MB）
	private static readonly FRAME_SAFETY_MARGIN = 8 * 1024; // 额外预留8KB，覆盖Protobuf字段/调试标记等开销
	private static readonly MIN_SAFE_CHUNK_SIZE = 32 * 1024; // 避免频繁小块导致性能退化
	public static readonly MAX_SAFE_CHUNK_SIZE = Math.floor(
		(TcpClient.FRAME_PAYLOAD_LIMIT - TcpClient.FRAME_SAFETY_MARGIN) / 1024
	) * 1024; // 4096KB 左右，确保编码后不会突破帧限制
	// ✅ P1-5: 优化接收缓冲区管理 - 使用块列表避免频繁concat
	private receiveChunks: Buffer[] = [];
	private receiveTotalSize = 0;
  
	// 状态机和重连管理
	private stateMachine: ConnectionStateMachine;
	private reconnectManager: ReconnectManager;
  
	// 自适应分块策略
	private chunkStrategy: AdaptiveChunkStrategy;
  
	// 断点续传管理器
	private uploadManager: ResumableUploadManager;

	// P2集成：KeepAlive管理器
	private keepAlive?: TcpKeepAlive;
	private keepAliveConfig: KeepAliveConfig = {
		pingInterval: 45000,      // 45秒心跳间隔，为大文件传输预留更多时间
		pingTimeout: 10000,       // 10秒心跳超时，增加网络延迟容忍度
		maxPingFailures: 3,       // 最多3次失败
		enableTcpKeepAlive: true, // 启用TCP层保活
		autoReconnect: false,     // 自动重连（禁用，改为手动）
		maxReconnectAttempts: 5   // 最多重连5次
	};
  
	/**
   * 辅助函数：将 int64 字段（可能是 string 或 number）安全转换为 number
   * @param value 要转换的值
   * @param defaultValue 默认值（如果转换失败）
   * @returns 转换后的数字
   */
	private toNumber(value: string | number | undefined, defaultValue = 0): number {
		if (value === undefined || value === null) {
			return defaultValue;
		}

		if (typeof value === 'number') {
			return value;
		}

		if (typeof value === 'string') {
			const num = Number(value);
			if (!isNaN(num) && isFinite(num)) {
				return num;
			}
		}

		this.logger.warn(`⚠️ 无法将值转换为数字: ${value}，使用默认值: ${defaultValue}`);
		return defaultValue;
	}

	private normalizeResponseData(
		data: unknown,
		context?: { label?: string }
	): Buffer {
		const label = context?.label ?? 'TCP_RESPONSE';

		if (data === undefined || data === null) {
			this.logger.warn(`${label} 收到空数据，使用空缓冲区`);
			return Buffer.alloc(0);
		}

		if (Buffer.isBuffer(data)) {
			return data;
		}

		if (data instanceof Uint8Array) {
			return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
		}

		if (ArrayBuffer.isView(data)) {
			const view = data as ArrayBufferView;
			return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
		}

		if (data instanceof ArrayBuffer) {
			return Buffer.from(data);
		}

		if (Array.isArray(data)) {
			if (data.length === 0) {
				return Buffer.alloc(0);
			}

			if (data.every((value) => typeof value === 'number')) {
				return Buffer.from(data as number[]);
			}

			const flattened: number[] = [];
			for (const item of data) {
				if (typeof item === 'number') {
					flattened.push(item);
					continue;
				}
				if (Array.isArray(item)) {
					for (const nested of item) {
						if (typeof nested !== 'number') {
							throw new TypeError(`${label} 数组元素类型不受支持: ${typeof nested}`);
						}
						flattened.push(nested);
					}
					continue;
				}
				throw new TypeError(`${label} 数组元素类型不受支持: ${typeof item}`);
			}

			return Buffer.from(flattened);
		}

		if (typeof data === 'string') {
			const sanitized = data.trim();
			if (sanitized.length === 0) {
				return Buffer.alloc(0);
			}
			const compact = sanitized.replace(/\s+/g, '');
			if (this.isLikelyBase64(compact)) {
				try {
					return Buffer.from(compact, 'base64');
				} catch (error) {
					this.logger.warn(`${label} base64 解码失败，回退到 utf8`, error);
				}
			}
			return Buffer.from(sanitized, 'utf8');
		}

		if (typeof data === 'object') {
			const maybeBuffer = data as { type?: string; data?: unknown; base64?: string };
			if (maybeBuffer.type === 'Buffer' && Array.isArray(maybeBuffer.data)) {
				return Buffer.from(maybeBuffer.data);
			}
			if (typeof maybeBuffer.base64 === 'string') {
				return Buffer.from(maybeBuffer.base64, 'base64');
			}
			if ('data' in maybeBuffer) {
				return this.normalizeResponseData(maybeBuffer.data, context);
			}
		}

		throw new TypeError(`${label} 返回未知数据类型: ${typeof data}`);
	}

	private isLikelyBase64(value: string): boolean {
		if (!value || value.length % 4 !== 0) {
			return false;
		}
		return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
	}
  
	constructor() {
		// 初始化状态机
		this.stateMachine = new ConnectionStateMachine({
			initialState: ConnectionState.DISCONNECTED,
			enableLogging: false
		});

		// 默认将 TCP 相关日志提升到 INFO，确保关键链路在生产环境也可见
		this.logger.setLevel(LogLevel.INFO);
    
		// 初始化重连管理器 - 与keepAliveConfig保持一致
		this.reconnectManager = new ReconnectManager(this.stateMachine, {
			autoReconnect: false,
			maxReconnectAttempts: 5,
			reconnectDelay: 2000,        // 增加初始重连延迟，给大文件传输更多时间
			maxReconnectDelay: 60000,    // 增加最大重连延迟到60秒
			pingInterval: 45000,         // 与keepAliveConfig一致：45秒心跳间隔
			pingTimeout: 10000,          // 与keepAliveConfig一致：10秒心跳超时
			enableLogging: false
		});
    
		// 设置连接处理器
		this.reconnectManager.setConnectionHandler(this);
    
		// 初始化自适应分块策略
		this.chunkStrategy = new AdaptiveChunkStrategy({
			minChunkSize: 32 * 1024,          // 最小 32KB
			maxChunkSize: 2 * 1024 * 1024,    // 最大 2MB (配合4MB帧限制)
			defaultChunkSize: 512 * 1024,     // 默认 512KB
			enableAutoAdjust: true,
			adjustInterval: 5000               // 5秒调整一次
		});
    
		// 初始化断点续传管理器
		this.uploadManager = new ResumableUploadManager({
			enabled: true,                     // 启用断点续传
			sessionExpireTime: 24 * 60 * 60 * 1000, // 会话保留24小时
			enableLogging: true
		});

		// 监听状态变化
		this.setupStateListeners();
	}
  
	/**
   * 设置状态监听器
   */
	private setupStateListeners(): void {
		this.stateMachine.on('stateChanged', (event) => {
			this.logger.info(`状态变化: ${event.from} -> ${event.to}`);
			this.lastStateEvent = event;
			this.connectionStateListeners.forEach(listener => listener(event));
		});
    
		this.reconnectManager.on('reconnectSucceeded', (data) => {
			this.logger.info(`重连成功，尝试次数: ${data.attempts}`);
		});
    
		this.reconnectManager.on('reconnectFailed', (data) => {
			this.logger.error(`重连失败，尝试次数: ${data.attempts}`, data.error);
		});
	}

	private connectionStateListeners: Set<(event: StateTransitionEvent) => void> = new Set();
	private lastConnectError?: string;
	private lastStateEvent?: StateTransitionEvent;

	public onConnectionStateChange(listener: (event: StateTransitionEvent) => void): () => void {
		this.connectionStateListeners.add(listener);
		return () => {
			this.connectionStateListeners.delete(listener);
		};
	}

	public getLastConnectError(): string | undefined {
		return this.lastConnectError;
	}
  
	/**
   * 心跳检测（实现ConnectionHandler接口）
   */
	async ping(): Promise<void> {
		if (!this._isConnected || !this.socket) {
			throw new Error('未连接到服务器');
		}
    
		try {
			await this.sendCommand(TcpCommand.PING, { operation: 'PING' }, 5000);
		} catch (error) {
			throw new Error(`心跳检测失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
   * 连接到TCP服务器（实现ConnectionHandler接口）
   */
	async connect(config?: TcpConfig): Promise<void> {
		try {
			this.logger.info('准备建立新TCP连接，停止自动重连流程');
			this.reconnectManager.stopReconnect();
			this.lastConnectError = undefined;
			this.logger.debug('连接前状态快照', {
				state: this.stateMachine.getState(),
				reconnectStatus: this.reconnectManager.getReconnectStatus()
			});

			if (this.stateMachine.isInState(ConnectionState.RECONNECTING) || this.stateMachine.isInState(ConnectionState.ERROR)) {
				this.logger.debug('重置状态机为disconnected以便重新连接');
				this.stateMachine.markDisconnected('用户重新连接');
			}

			// 如果已经连接，先断开
			if (this._isConnected || this.socket) {
				this.logger.info('检测到现有连接，先执行清理');
				try {
					await this.cleanup();
					// 等待一小段时间确保清理完成
					await new Promise(resolve => setTimeout(resolve, 100));
				} catch (cleanupError) {
					this.logger.warn('清理现有连接时出错:', cleanupError);
				}
			}
      
			// 重置状态
			this.sequenceNumber = 0;
			this.messageQueue.clear();
			this.receiveChunks = [];
			this.receiveTotalSize = 0;
      
			// 如果没有提供配置，使用已保存的配置
			if (config) {
				this.config = config;
			}
      
			if (!this.config) {
				throw new Error('没有提供连接配置');
			}
      
			const finalConfig = this.config;
			this.logger.info(`连接TCP服务器: ${finalConfig.host}:${finalConfig.port}`);
      
			// 更新状态机 - 开始连接
			this.stateMachine.startConnecting('用户请求连接');
      
			await new Promise<void>((resolve, reject) => {
				this.socket = net.createConnection({
					host: finalConfig.host,
					port: finalConfig.port,
					timeout: finalConfig.timeout || 10000
				});

				const timeout = setTimeout(() => {
					const message = '连接超时';
					this.lastConnectError = message;
					this.stateMachine.markError(message);
					reject(new Error(message));
				}, finalConfig.timeout || 10000);

				this.socket.on('connect', async () => {
					clearTimeout(timeout);
					this.logger.info('TCP连接已建立');
					try {
						this.socket?.setTimeout(0); // 业务流量即视作心跳，禁用底层空闲超时
					} catch (setTimeoutError) {
						this.logger.warn('设置 socket 超时时间失败', setTimeoutError);
					}

					try {
						// 🔧 等待Protobuf编解码器初始化完成
						this.logger.debug('🔄 等待Protobuf编解码器初始化...');
						await this.codec.waitForReady();
						this.logger.info('✅ Protobuf编解码器初始化完成');

						// ✅ P0-2: 强制Protobuf-only握手
						// P2优化：增加压缩能力协商
						const connectResponse = await this.sendCommand(TcpCommand.CONNECT, {
							operation: 'CONNECT',
							clientId: 'easy-file-management-v2.0',
							supportedFormats: ['protobuf'], // 仅支持Protobuf格式
							preferredFormat: 'protobuf',    // 强制使用Protobuf格式
							version: '2.0.0',
							// P2新增：压缩能力声明（待服务端支持后启用）
							compressionCapabilities: {
								supported: true,
								algorithms: ['gzip', 'deflate', 'brotli'],
								enabled: false,  // 当前禁用，待服务端支持后设为true
								minSizeBytes: 1024,  // 最小压缩大小阈值
								compressionLevel: 6   // 默认压缩级别
							}
						});

						if (connectResponse.success) {
							this._isConnected = true;
							this.stateMachine.markConnected('TCP握手成功');
							this.logger.info('TCP握手成功');

							// P2集成：启动KeepAlive
							this.startKeepAlive();

							resolve();
						} else {
							const reason = connectResponse.message || '连接被服务器拒绝';
							this.lastConnectError = reason;
							this.stateMachine.markError(reason);
							if (this.socket) {
								this.socket.removeAllListeners();
								this.socket.destroy();
								this.socket = undefined;
							}
							reject(new Error(reason));
						}
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						this.lastConnectError = message;
						this.stateMachine.markError(message);
						if (this.socket) {
							this.socket.removeAllListeners();
							this.socket.destroy();
							this.socket = undefined;
						}
						reject(error);
					}
				});

				this.socket.on('data', async (data) => {
					// 将任意入站数据视为心跳活跃，防止KeepAlive误判
					this.recordConnectionActivity('socket-data');
					try {
						await this.handleIncomingData(data);
					} catch (error) {
						this.logger.error('❌ 处理接收数据失败:', error);
					}
				});

				this.socket.on('error', (error) => {
					clearTimeout(timeout);
					this.logger.error('TCP连接错误:', error);
					this._isConnected = false;
					const message = error instanceof Error ? error.message : String(error);
					this.lastConnectError = message;

					// 根据错误类型更新状态
					if (this.stateMachine.isConnected()) {
						// 如果之前已连接，则触发重连
						this.stateMachine.markDisconnected(`连接错误: ${message}`);
					} else {
						// 连接失败
						this.stateMachine.markError(`连接错误: ${message}`);
					}

					// 清理socket避免内存泄漏
					if (this.socket) {
						this.socket.removeAllListeners();
						this.socket.destroy();
						this.socket = undefined;
					}

					if (!this._isConnected) {
						reject(error);
					}
				});

				this.socket.on('close', () => {
					this.logger.info('TCP连接已关闭');
					const wasConnected = this._isConnected;
					this._isConnected = false;
					this.cleanupPendingRequests();
			
					// 如果之前已连接或状态机不在断开状态，触发断开状态
					if (wasConnected || !this.stateMachine.isInState(ConnectionState.DISCONNECTED)) {
						this.stateMachine.markDisconnected('连接已关闭');
					}
				});
			});
      
		} catch (error) {
			this.logger.error('TCP连接失败:', error);
			this._isConnected = false;
			const message = error instanceof Error ? error.message : String(error);
			this.lastConnectError = message;
			if (!this.stateMachine.isInState(ConnectionState.ERROR)) {
				this.stateMachine.markError(`连接错误: ${message}`);
			}
			throw new Error(`TCP连接失败: ${message}`);
		}
	}
  
	/**
   * 连接到TCP服务器（保留原有接口兼容性）
   */
	async connectWithConfig(config: TcpConfig): Promise<boolean> {
		try {
			await this.connect(config);
			this.lastConnectError = undefined;
			return true;
		} catch (error) {
			if (!this.lastConnectError) {
				this.lastConnectError = error instanceof Error ? error.message : String(error);
			}
			// 连接失败已在 connect() 内记录错误，避免重复推送用户级错误通知
			this.logger.debug('connectWithConfig 捕获异常', error);
			return false;
		}
	}

	/**
   * 断开连接（实现ConnectionHandler接口）
   */
	async disconnect(): Promise<void> {
		try {
			// 停止自动重连
			this.reconnectManager.stopReconnect();
      
			// P2集成：停止KeepAlive
			this.stopKeepAlive();
      
			if (this._isConnected && this.socket) {
				// 发送断开连接消息
				try {
					await this.sendCommand(TcpCommand.DISCONNECT, {
						operation: 'DISCONNECT'
					});
				} catch (error) {
					this.logger.warn('发送断开连接消息失败:', error);
				}
			}
      
			// 更新状态机
			this.stateMachine.markDisconnected('用户请求断开');
		} finally {
			this.cleanup();
		}
	}
  
	/**
   * 检查是否已连接（实现ConnectionHandler接口）
   * 🔧 修复：强化连接状态判断，避免在某些Node版本下的误判
   */
	isConnected(): boolean {
		return this._isConnected && 
           this.socket?.readyState === 'open' &&
           !this.socket.destroyed && 
           this.socket.readable && 
           this.socket.writable;
	}

	/**
   * 获取文件列表
   */
	async listFiles(remotePath = '/'): Promise<FileItem[]> {
		this.ensureConnected();
    
		try {
			this.logger.debug(`获取文件列表: ${remotePath}`);
      
			const response = await this.sendCommand(TcpCommand.LIST_FILES, {
				operation: 'LIST_FILES',
				path: remotePath,
				options: {
					recursive: 'false',  // 修复：将布尔值转换为字符串
					filter: '*'
				}
			});

			if (!response.success) {
				throw new Error(response.message || '获取文件列表失败');
			}

			return (response.files || []).map((file: any) => ({
				name: file.name,
				path: file.path,
				type: file.type,
				size: file.size,
				lastModified: file.lastModified ? new Date(file.lastModified) : new Date(),
				permissions: file.permissions,
				isReadonly: file.isReadonly || false
			}));
      
		} catch (error) {
			this.logger.error('获取文件列表失败:', error);
			throw new Error(`获取文件列表失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
   * 下载文件
   */
	// ✅ 修复P2问题：根据文件体积智能选择直传或分块下载，默认返回 Buffer
	private static readonly DEFAULT_STREAM_CHUNK_SIZE = 2 * 1024 * 1024;

	async downloadFile(config: DownloadConfig): Promise<Buffer | Blob> {
		this.ensureConnected();

		if (!config.filePath) {
			throw new Error('下载文件需要提供文件路径');
		}

		if (!config.targetFile) {
			this.logger.info('⏬ 内存下载模式：使用流式拉取');
		}

		const filePath = config.filePath;
		const startTime = Date.now();
		const filename = config.filename || this.getFilenameFromPath(filePath);
		const requestedChunk = config.chunkSize && Number.isFinite(config.chunkSize) ? Number(config.chunkSize) : undefined;
		const desiredChunk = requestedChunk && requestedChunk > 0
			? Math.floor(requestedChunk)
			: TcpClient.DEFAULT_STREAM_CHUNK_SIZE;
		const chunkHint = Math.max(TcpClient.MIN_SAFE_CHUNK_SIZE, Math.min(desiredChunk, TcpClient.MAX_SAFE_CHUNK_SIZE));
		const directSave = Boolean(config.targetFile);

		this.logger.info('📥 开始TCP下载', {
			filePath,
			targetFile: config.targetFile || 'memory',
			directSave,
			requestedChunk,
			chunkHint
		});

		const init = await this.downloadStreamInit(filePath, chunkHint);
		config.onSession?.({
			sessionId: init.sessionId,
			chunkSize: init.chunkSize,
			totalChunks: init.totalChunks,
			fileSize: init.fileSize
		});

		this.logger.info('🆔 下载会话就绪', {
			sessionId: init.sessionId,
			chunkSize: init.chunkSize,
			totalChunks: init.totalChunks,
			fileSize: init.fileSize
		});

		let fileHandle: FileHandle | undefined;
		if (directSave) {
			await fs.promises.mkdir(path.dirname(config.targetFile!), { recursive: true });
			fileHandle = await fs.promises.open(config.targetFile!, 'w');
			await fileHandle.truncate(init.fileSize > 0 ? init.fileSize : 0);
		}

		const totalChunks = init.totalChunks;
		const totalBytes = init.fileSize || (init.totalChunks * init.chunkSize);
		const memoryChunks = directSave ? new Array<Buffer | null>(0) : new Array<Buffer | null>(totalChunks).fill(null);
		let bytesReceived = 0;
		let completedChunks = 0;
		let aborted = false;
		const progressLogInterval = totalChunks > 10 ? Math.ceil(totalChunks / 10) : 1;
		const recommendation = this.chunkStrategy.getRecommendation();
		const suggestedConcurrency = Math.max(1, recommendation.concurrency || (totalChunks >= 4 ? 4 : 2));
		const concurrency = Math.min(totalChunks, Math.max(1, Math.min(6, suggestedConcurrency)));
		let nextChunkIndex = 0;
		const maxRetries = 3;
		const throttleIntervalMs = 200;
		let lastProgressEmit = 0;

		const emitProgress = (percent: number) => {
			if (!config.onProgress) {return;}
			const now = Date.now();
			if (percent < 100 && now - lastProgressEmit < throttleIntervalMs) {
				return;
			}
			lastProgressEmit = now;
			config.onProgress({
				total: totalBytes,
				loaded: bytesReceived,
				percent,
				filename
			});
		};

		const workers: Array<Promise<void>> = [];
		const worker = async (): Promise<void> => {
			while (true) {
				if (config.shouldAbort?.()) {
					aborted = true;
					throw new Error('DOWNLOAD_ABORTED');
				}

				const currentChunkIndex = nextChunkIndex++;
				if (currentChunkIndex >= totalChunks) {
					return;
				}

				let attempt = 0;
				while (attempt < maxRetries) {
					if (config.shouldAbort?.()) {
						aborted = true;
						throw new Error('DOWNLOAD_ABORTED');
					}

					try {
						const chunkStart = Date.now();
						const { buffer } = await this.downloadStreamChunk(
							init.sessionId,
							currentChunkIndex,
							totalChunks,
							filePath
						);
						const duration = Date.now() - chunkStart;
						this.chunkStrategy.recordTransfer({
							success: true,
							duration,
							size: buffer.length,
							retries: attempt
						});

						if (directSave && fileHandle) {
							await fileHandle.write(buffer, 0, buffer.length, currentChunkIndex * init.chunkSize);
						} else if (!directSave) {
							memoryChunks[currentChunkIndex] = buffer;
						}

						bytesReceived += buffer.length;
						completedChunks += 1;

						const percent = totalBytes
							? Math.min(100, Math.round((bytesReceived / totalBytes) * 100))
							: Math.round((completedChunks / totalChunks) * 100);

						if (
							currentChunkIndex === 0 ||
							completedChunks % progressLogInterval === 0 ||
							completedChunks === totalChunks
						) {
							this.logger.info('📦 收到下载分块', {
								sessionId: init.sessionId,
								chunkIndex: currentChunkIndex,
								bytes: buffer.length,
								processedChunks: completedChunks,
								bytesReceived,
								percent
							});
						}

						emitProgress(percent);
						break;
					} catch (chunkError) {
						attempt += 1;
						if (attempt >= maxRetries) {
							this.chunkStrategy.recordTransfer({ success: false, duration: 0, size: 0, retries: attempt });
							throw chunkError;
						}
						const backoff = attempt * 300;
						await new Promise(resolve => setTimeout(resolve, backoff));
					}
				}
			}
		};

		for (let i = 0; i < concurrency; i++) {
			workers.push(worker());
		}

		try {
			await Promise.all(workers);
			if (!aborted) {
				emitProgress(100);
			}
		} catch (error) {
			this.logger.error('❌ 下载过程中出现异常，准备中止会话', {
				filePath,
				sessionId: init.sessionId,
				nextChunk: nextChunkIndex,
				bytesReceived,
				error: error instanceof Error ? error.message : String(error)
			}, error);
			await this.downloadStreamAbort(init.sessionId).catch(() => undefined);
			if (aborted || config.shouldAbort?.()) {
				throw new Error('DOWNLOAD_ABORTED');
			}
			throw error;
		} finally {
			if (fileHandle) {
				try {
					await fileHandle.close();
				} catch (closeError) {
					this.logger.warn('⚠️ 关闭下载文件句柄失败', closeError);
				}
			}
		}

		if (aborted || config.shouldAbort?.()) {
			throw new Error('DOWNLOAD_ABORTED');
		}

		await this.downloadStreamFinish(init.sessionId, init.totalChunks, init.fileSize);

		const elapsedMs = Date.now() - startTime;
		const throughputBps = elapsedMs > 0 ? Math.round((bytesReceived / elapsedMs) * 1000) : bytesReceived;
		this.logger.info('✅ 流式下载完成', {
			path: filePath,
			bytes: bytesReceived,
			fileSize: init.fileSize,
			elapsedMs,
			throughputBps,
			targetFile: config.targetFile || null,
			chunkSize: init.chunkSize,
			totalChunks: init.totalChunks,
			concurrency
		});

		if (directSave) {
			this.logger.info('💾 文件已写入本地路径', { targetFile: config.targetFile, bytes: bytesReceived });
			return Buffer.alloc(0);
		}

		const orderedChunks = (memoryChunks as Array<Buffer | null>).map((chunk, index) => {
			if (!chunk) {
				throw new Error(`下载结果不完整，缺少分块 ${index}`);
			}
			return chunk;
		});
		const finalBuffer = Buffer.concat(orderedChunks);
		const returnType = (config as any).returnType || 'buffer';
		if (returnType === 'blob') {
			return new Blob([finalBuffer]);
		}

		return finalBuffer;
	}

	private async downloadStreamInit(
		filePath: string,
		requestedChunkSize?: number
	): Promise<{ sessionId: string; chunkSize: number; totalChunks: number; fileSize: number }> {
		this.ensureConnected();
		this.logger.info('🧾 初始化下载会话', { filePath, requestedChunkSize });

		const options: Record<string, string> = { action: 'start' };
		if (requestedChunkSize && Number.isFinite(requestedChunkSize)) {
			options.chunkSize = String(requestedChunkSize);
		}

		this.logger.info('📡 发送下载会话请求', { filePath, options });

		const response = await this.sendCommand(TcpCommand.DOWNLOAD_REQ, {
			operation: 'DOWNLOAD_REQ',
			path: filePath,
			options
		}, 60000);

		if (!response?.success) {
			this.logger.error('❌ 下载会话初始化失败', { filePath, message: response?.message });
			throw new Error(response?.message || '下载会话初始化失败');
		}

		const data = response.data ?? response;
		const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : data?.data?.sessionId;
		if (!sessionId) {
			throw new Error('下载会话ID缺失');
		}

		const chunkSize = this.toNumber(
			data.acceptedChunkSize ?? data.chunkSize,
			TcpClient.DEFAULT_STREAM_CHUNK_SIZE
		);
		const totalChunks = this.toNumber(data.totalChunks, 0);
		const fileSize = this.toNumber(data.fileSize, 0);
		const normalizedChunks = totalChunks > 0 ? totalChunks : 1;

		this.logger.info('📊 下载会话参数', {
			sessionId,
			chunkSize,
			totalChunks: normalizedChunks,
			fileSize
		});

		return {
			sessionId,
			chunkSize,
			totalChunks: normalizedChunks,
			fileSize
		};
	}

	private async downloadStreamChunk(
		sessionId: string,
		chunkIndex: number,
		totalChunks: number,
		filePath: string
	): Promise<{ buffer: Buffer; chunkIndex: number }> {
		this.logger.info('📮 请求下载分块', { sessionId, chunkIndex, filePath });
		const options: Record<string, string> = {
			action: 'chunk',
			sessionId,
			chunkIndex: String(chunkIndex)
		};

		const response = await this.sendCommand(TcpCommand.DOWNLOAD_REQ, {
			operation: 'DOWNLOAD_REQ',
			isChunk: true,
			chunkIndex,
			totalChunks,
			path: filePath,
			options
		}, 60000);

		if (!response?.success) {
			this.logger.error('❌ 下载分块失败', { sessionId, chunkIndex, message: response?.message });
			throw new Error(response?.message || `下载分块失败: ${chunkIndex}`);
		}

		const dataBuffer = this.normalizeResponseData(response.data, {
			label: `DOWNLOAD_STREAM#${chunkIndex}`
		});
		const resolvedChunkIndex = this.toNumber(response.chunkIndex, chunkIndex);

		this.logger.info('📥 分块响应', {
			sessionId,
			chunkIndex: resolvedChunkIndex,
			bytes: dataBuffer.length,
			totalChunks: response.totalChunks ?? undefined
		});

		return {
			buffer: dataBuffer,
			chunkIndex: resolvedChunkIndex
		};
	}

	private async downloadStreamFinish(sessionId: string, totalChunks: number, fileSize: number): Promise<void> {
		this.logger.info('📬 通知服务端下载完成', { sessionId, totalChunks, fileSize });
		await this.sendCommand(TcpCommand.DOWNLOAD_REQ, {
			operation: 'DOWNLOAD_REQ',
			options: {
				action: 'finish',
				sessionId,
				totalChunks: String(totalChunks),
				fileSize: String(fileSize)
			}
		}, 60000);
	}

	private async downloadStreamAbort(sessionId: string): Promise<void> {
		this.logger.warn('🛑 通知服务端中止下载', { sessionId });
		await this.sendCommand(TcpCommand.DOWNLOAD_REQ, {
			operation: 'DOWNLOAD_REQ',
			options: {
				action: 'abort',
				sessionId
			}
		}, 10000).catch(() => undefined);
	}

	async downloadChunk(
		filePath: string,
		start: number,
		end: number,
		context: {
			chunkIndex?: number;
			totalChunks?: number;
			sessionId?: string;
			requestId?: string;
		} = {}
	): Promise<any> {
		this.ensureConnected();

		const { chunkIndex, totalChunks, sessionId, requestId } = context;
		const chunkSize = Math.max(0, end - start);

		// 🔧 修复：命令码与业务操作码对齐，避免混用，同时携带下载会话上下文
		this.logger.debug('📥 请求下载分块', {
			path: filePath,
			range: `${start}-${end}`,
			bytes: chunkSize,
			chunkIndex,
			totalChunks,
			sessionId,
			reqId: requestId
		});

		const payload: Record<string, any> = {
			operation: 'DOWNLOAD_REQ',
			path: filePath,
			options: {
				rangeStart: String(start),
				rangeEnd: String(end),
				chunkSize: String(Math.max(chunkSize, 0)),
				requestType: 'byteRange'
			},
			isChunk: true,
			totalChunks: typeof totalChunks === 'number' && totalChunks > 0 ? totalChunks : 1
		};

		if (typeof chunkIndex === 'number' && chunkIndex >= 0) {
			payload.chunkIndex = chunkIndex;
			payload.options.chunkIndex = String(chunkIndex);
		}

		if (sessionId) {
			payload.sessionId = sessionId;
			payload.options.sessionId = sessionId;
		}

		if (requestId) {
			payload.options.requestId = requestId;
		}

		return await this.sendCommand(TcpCommand.DOWNLOAD_REQ, payload, 60000);
	}

	/**
   * 初始化分块上传
   */
	async uploadInit(targetPath: string, filename: string, options: { size: number; chunkSize: number; totalChunks: number; compression?: boolean }): Promise<any> {
		this.ensureConnected();
		const response = await this.sendCommand(TcpCommand.UPLOAD_REQ, {
			operation: 'UPLOAD_REQ',
			path: targetPath,
			name: filename,
			fileSize: options.size,
			chunkSize: options.chunkSize,
			totalChunks: options.totalChunks,
			options: { compression: String(!!options.compression) }
		}, 30000);
		return response;
	}

	/**
   * 上传单个分块
   * 优化：移除 Base64 编码，直接使用二进制数据传输，减少 33% 数据量
   */
	async uploadChunk(data: Buffer, index: number, total: number, sessionId?: string): Promise<any> {
		this.ensureConnected();
    
		// 🔧 修复P2问题：大文件传输日志降噪，仅显示关键进度
		if (index % 10 === 1 || index === total) {
			this.logger.info(`📤 上传分块 ${index}/${total}, 大小: ${data.length} 字节`);
		} else {
			this.logger.debug(`📤 上传分块 ${index}/${total}, 大小: ${data.length} 字节`);
		}
    
		// 优化：直接使用 Uint8Array，避免 Base64 编码开销
		const binaryData = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    
		const response = await this.sendCommand(TcpCommand.UPLOAD_DATA, {
			operation: 'UPLOAD_DATA',
			// ✅ 优化：直接传输二进制数据，移除 Base64 编码层
			data: binaryData,
			isChunk: true,
			chunkIndex: index,
			totalChunks: total,
			chunkHash: this.calculateHash(data),
			options: sessionId ? { sessionId } : undefined
		}, 60000);
    
		if (response.success) {
			if (index % 10 === 0 || index === total - 1) {
				this.logger.info(`✅ 分块 ${index} 上传成功`);
			} else {
				this.logger.debug(`✅ 分块 ${index} 上传成功`);
			}
		} else {
			// 失败会触发后续重试或终止逻辑，这里降级为警告避免频繁错误提示
			this.logger.warn(`❌ 分块 ${index} 上传失败: ${response.message}`);
		}
    
		return response;
	}

	/**
   * 完成分块上传
   */
	async uploadComplete(totalChunks: number, fileSize: number, sessionId?: string): Promise<any> {
		this.ensureConnected();
		// 🔧 修复：增加大文件的超时时间
		const endTimeout = fileSize > 10 * 1024 * 1024 ? 60000 : 30000;
		const response = await this.sendCommand(TcpCommand.UPLOAD_END, {
			operation: 'UPLOAD_END',
			totalChunks,
			fileSize,
			options: sessionId ? { sessionId } : undefined
		}, endTimeout);
		return response;
	}

	/**
   * 上传文件
   */
	async uploadFile(config: UploadConfig): Promise<FileOperationResult> {
		this.ensureConnected();
    
		try {
			this.logger.info(`上传文件: ${config.filename} 到 ${config.targetPath}`);
      
			if (!config.buffer) {
				throw new Error('没有提供文件数据');
			}
      
			const fileBuffer = config.buffer;
			const fileSize = this.toNumber(config.fileSize, fileBuffer.length);
      
			// 🔧 修复P1问题：基于真实编码大小动态调整分块策略，避免过早分块
			this.logger.info(`🎯 智能分块决策开始 - 文件大小: ${fileSize} 字节, 配置格式: ${this.config?.dataFormat || 'protobuf'}`);
      
			// 🚀 P2优化：大文件预编码策略优化
			const preEncodeStartTime = Date.now();
			let actualEncodedSize: number;
			let actualFormat: string;
			let preEncodedData: { format: number, data: Uint8Array } | null = null;
      
			// P2优化：引入文件大小阈值，避免大文件内存压力
			const PRE_ENCODE_THRESHOLD = 1 * 1024 * 1024; // 1MB阈值 - 降低阈值避免大文件预编码
			const usePreEncoding = fileSize <= PRE_ENCODE_THRESHOLD;
      
			if (usePreEncoding) {
				try {
					this.logger.debug('🔬 文件小于阈值，执行预编码测试...');
          
					// 构建上传消息用于预编码测试
					const testMessage = {
						operation: 'UPLOAD_FILE',
						path: config.targetPath,
						name: config.filename,
						data: fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer,
						fileSize,
						options: {
							type: 'application/octet-stream'
						}
					};
          
					// 进行真实编码测试
					preEncodedData = await this.codec.smartEncode(
						testMessage, 
						'UPLOAD_FILE', 
						this.config?.dataFormat || 'protobuf'
					);
          
					actualEncodedSize = preEncodedData.data.length;
					actualFormat = preEncodedData.format === 0x02 ? 'protobuf' : 
						(preEncodedData.format & 0x04) ? 'compressed' : 'protobuf';
          
					const preEncodeDuration = Date.now() - preEncodeStartTime;
					this.logger.info(`✅ 预编码完成: ${fileSize} -> ${actualEncodedSize} 字节 (格式: ${actualFormat}, 耗时: ${preEncodeDuration}ms)`);
          
				} catch (error) {
					this.logger.warn(`⚠️ 预编码失败，使用保守估算: ${error}`);
					actualEncodedSize = fileSize * 1.4; // 保守估算：比原文件大40%
					actualFormat = 'estimated';
					preEncodedData = null;
				}
			} else {
				// P2优化：大文件采用采样估算或保守策略
				this.logger.info(`📊 文件大于${PRE_ENCODE_THRESHOLD / 1024 / 1024}MB，使用保守分块策略`);
				actualEncodedSize = fileSize * 1.3; // Protobuf编码通常增加20-30%
				actualFormat = 'estimated';
				preEncodedData = null;
			}
      
			// 🎯 使用自适应策略获取推荐配置
			const recommendation = this.chunkStrategy.getRecommendation();
			const optimalChunkSize = recommendation.chunkSize;
			const networkQuality = this.chunkStrategy.getStats().networkQuality;
      
			this.logger.info('📊 自适应分块策略推荐:', {
				chunkSize: `${optimalChunkSize / 1024}KB`,
				networkQuality,
				concurrency: recommendation.concurrency,
				retryAttempts: recommendation.retryAttempts,
				timeout: `${recommendation.timeout}ms`
			});
      
			// 🚀 基于真实编码大小的分块决策
			const frameLimit = TcpClient.FRAME_PAYLOAD_LIMIT; // TCP帧协议限制
			let useChunking: boolean;
      
			if (actualEncodedSize > frameLimit) {
				// 编码后超过帧限制：必须分块
				useChunking = true;
				this.logger.info(`🚨 强制分块: 编码后${actualEncodedSize}字节 > 帧限制${frameLimit}字节`);
			} else {
				// 基于自适应策略的智能分块决策
				const smartThreshold = Math.max(optimalChunkSize * 2, 32 * 1024);
				useChunking = actualEncodedSize > smartThreshold;
        
				const decision = useChunking ? '使用分块' : '单次传输';
				const efficiency = actualEncodedSize < fileSize ? 
					`压缩效率${((fileSize - actualEncodedSize) / fileSize * 100).toFixed(1)}%` : 
					`编码膨胀${((actualEncodedSize - fileSize) / fileSize * 100).toFixed(1)}%`;
        
				this.logger.info(`📊 智能分块决策: ${decision} (编码后${actualEncodedSize}字节 vs 阈值${smartThreshold}字节, ${efficiency})`);
			}
      
			if (useChunking) {
				return await this.uploadFileChunked(config, fileBuffer);
			} else {
				// 🚀 优化：如果有预编码数据，复用避免重复编码
				return await this.uploadFileSimple(config, fileBuffer, preEncodedData);
			}
      
		} catch (error) {
			this.logger.error('文件上传失败:', error);
			return {
				success: false,
				message: `文件上传失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/**
   * 删除文件
   */
	async deleteFile(filePath: string): Promise<FileOperationResult> {
		this.ensureConnected();
    
		try {
			this.logger.info(`删除文件: ${filePath}`);
      
			const response = await this.sendCommand(TcpCommand.DELETE_FILE, {
				operation: 'DELETE_FILE',
				path: filePath
			});

			return {
				success: response.success,
				message: response.message || (response.success ? '文件删除成功' : '文件删除失败')
			};
      
		} catch (error) {
			this.logger.error('删除文件失败:', error);
			return {
				success: false,
				message: `删除失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/**
   * 重命名文件
   */
	async renameFile(oldPath: string, newPath: string): Promise<FileOperationResult> {
		this.ensureConnected();
    
		try {
			this.logger.info(`重命名文件: ${oldPath} -> ${newPath}`);
      
			const newName = newPath.split('/').pop() || '';
      
			const renamePayload: Record<string, any> = {
				operation: 'RENAME_FILE',
				path: oldPath,
				newName
			};

			if (newPath) {
				renamePayload.newPath = newPath;
				renamePayload.options = {
					newPath
				};
			}

			const response = await this.sendCommand(TcpCommand.RENAME_FILE, renamePayload);

			return {
				success: response.success,
				message: response.message || (response.success ? '文件重命名成功' : '文件重命名失败')
			};
      
		} catch (error) {
			this.logger.error('重命名文件失败:', error);
			return {
				success: false,
				message: `重命名失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/**
   * 获取文件信息
   */
	async getFileInfo(filePath: string): Promise<FileOperationResult> {
		this.ensureConnected();
    
		try {
			this.logger.info(`获取文件信息: ${filePath}`);
      
			const response = await this.sendCommand(TcpCommand.FILE_INFO, {
				operation: 'FILE_INFO',
				path: filePath
			});

			return {
				success: response.success,
				message: response.message || (response.success ? '获取文件信息成功' : '获取文件信息失败'),
				data: response
			};
      
		} catch (error) {
			this.logger.error('获取文件信息失败:', error);
			return {
				success: false,
				message: `获取文件信息失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/**
   * 创建目录
   */
	async createDirectory(dirPath: string): Promise<FileOperationResult> {
		this.ensureConnected();
    
		try {
			this.logger.info(`创建目录: ${dirPath}`);
      
			// 解析路径
			let parentPath = '/';
			let folderName = '';
      
			if (dirPath === '/' || dirPath === '') {
				return {
					success: false,
					message: '文件夹名称不能为空'
				};
			}
      
			const cleanPath = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
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

			const response = await this.sendCommand(TcpCommand.CREATE_DIR, {
				operation: 'CREATE_DIR',
				path: parentPath,
				name: folderName
			});

			return {
				success: response.success,
				message: response.message || (response.success ? '目录创建成功' : '目录创建失败')
			};
      
		} catch (error) {
			this.logger.error('创建目录失败:', error);
			return {
				success: false,
				message: `创建目录失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	// 私有方法

	/**
   * ✅ P2-7: 生成安全的序列号 - 碰撞保护和并发限制
   * @returns 安全的序列号
   * @throws Error 如果无法生成安全的序列号
   */
	private generateSafeSequenceNumber(): number {
		// 检查并发限制
		if (this.messageQueue.size >= TcpClient.MAX_CONCURRENT_REQUESTS) {
			throw new Error(`并发请求数量过多 (${this.messageQueue.size}/${TcpClient.MAX_CONCURRENT_REQUESTS})，请稍后重试`);
		}

		// 生成不冲突的序列号
		let attempts = 0;
		let candidateSeqNum: number;
    
		do {
			this.sequenceNumber = (this.sequenceNumber + 1) & 0xFFFF;
			candidateSeqNum = this.sequenceNumber;
			attempts++;
      
			if (attempts > TcpClient.MAX_SEQUENCE_RETRIES) {
				// 执行紧急清理：移除超时的请求
				this.emergencyCleanupTimeoutRequests();
				throw new Error(`序列号生成失败：重试次数过多 (${attempts})。可能存在大量超时请求未清理。`);
			}
		} while (this.messageQueue.has(candidateSeqNum));
    
		if (attempts > 1) {
			this.logger.debug(`⚠️ 序列号碰撞检测: 重试 ${attempts} 次找到可用序列号 ${candidateSeqNum}`);
		}
    
		return candidateSeqNum;
	}

	/**
   * ✅ P2-7: 紧急清理超时请求
   */
	private emergencyCleanupTimeoutRequests(): void {
		const now = Date.now();
		const timeoutThreshold = 60000; // 60秒超时阈值
		let cleanedCount = 0;
    
		// 记录开始时间以便统计清理效果
		const startSize = this.messageQueue.size;
    
		for (const [seqNum, context] of this.messageQueue.entries()) {
			// 检查请求是否已超时（简单的基于时间的清理）
			if (context.timer && (context.timer as any)._idleStart) {
				const requestAge = now - (context.timer as any)._idleStart;
				if (requestAge > timeoutThreshold) {
					clearTimeout(context.timer);
					context.reject(new Error('请求超时（紧急清理）'));
					this.messageQueue.delete(seqNum);
					cleanedCount++;
				}
			}
		}
    
		const endSize = this.messageQueue.size;
		this.logger.warn(`🚨 紧急清理完成: 移除 ${cleanedCount} 个超时请求，队列大小从 ${startSize} 降至 ${endSize}`);
	}

	/**
   * 发送命令到服务器
   * 🔧 修复：支持预编码数据，避免重复编码
   */
	private async sendCommand(
		command: number, 
		message: any, 
		timeout = 30000,
		preEncodedData?: { format: number; data: Uint8Array } | null
	): Promise<any> {
		return new Promise(async (resolve, reject) => {
			if (!this.socket) {
				reject(new Error('Socket不可用'));
				return;
			}

			// ✅ P2-7: 生成序列号 - 添加碰撞保护和并发限制
			const seqNum = this.generateSafeSequenceNumber();
      
			const commandName = this.getCommandName(command);
			const operationName = typeof message?.operation === 'string' ? message.operation : undefined;

			// P2优化：减少高频日志输出，仅在非PING命令时输出
			if (command !== TcpCommand.PING) {
				this.logger.debug(`🚀 开始发送消息: ${commandName} | seq=${seqNum} | 操作=${operationName} | 预编码=${preEncodedData ? '复用' : '实时'}`);
			}

			try {
				let encodedData: { format: number; data: Uint8Array };
				let encodeDurationMs = 0;
				let frameDurationMs = 0;
				let payloadBytes = 0;
				let frameBytes = 0;

				// 🔧 修复：优先使用预编码数据，避免重复编码
				if (preEncodedData) {
					encodedData = preEncodedData;
					payloadBytes = encodedData.data.length;
					this.logger.debug(`🔄 复用预编码数据: ${payloadBytes} 字节，格式=${encodedData.format}`);
				} else {
					const encodeStart = Date.now();
					// 编码消息 - 🔧 修复：添加 await 等待异步编码完成
					encodedData = await this.codec.smartEncode(
						message, 
						message.operation, 
						this.config?.dataFormat || 'protobuf'
					);
					encodeDurationMs = Date.now() - encodeStart;
					payloadBytes = encodedData.data.length;
					this.logger.debug(`🔀 实时编码完成: ${payloadBytes} 字节，格式=${encodedData.format}`);
				}

				this.logger.debug(`✅ 消息编码成功: 格式=${encodedData.format} | 数据大小=${payloadBytes} bytes | 操作=${operationName}`);

				const frameStart = Date.now();
				// 构建帧
				const frame = this.codec.buildFrame(command, encodedData.format, encodedData.data, seqNum);
				frameDurationMs = Date.now() - frameStart;
				frameBytes = frame.byteLength;

				this.logger.debug(`📦 帧构建完成: 总大小=${frameBytes} bytes | seq=${seqNum} | 命令=${commandName}`);
				this.logger.debug('⏱️ 消息准备耗时', {
					command: commandName,
					operation: operationName,
					encodeMs: encodeDurationMs,
					frameMs: frameDurationMs,
					payloadBytes,
					frameBytes
				});

				// 设置超时处理
				const timer = setTimeout(() => {
					if (this.messageQueue.has(seqNum)) {
						this.messageQueue.delete(seqNum);
						if (commandName !== this.getCommandName(TcpCommand.PING)) {
							this.logger.warn('⌛ 消息响应超时', {
								command: commandName,
								sequence: seqNum,
								timeoutMs: timeout
							});
						}
						reject(new Error(`消息响应超时: ${commandName}`));
					}
				}, timeout);
        
				const sentAt = Date.now();
				// 保存请求上下文
				this.messageQueue.set(seqNum, {
					resolve,
					reject,
					timer,
					metrics: {
						commandName,
						operation: operationName,
						payloadBytes,
						frameBytes,
						encodeDurationMs,
						frameDurationMs,
						sentAt
					}
				});

				// ✅ P1-4: 发送数据 - 零拷贝优化
				try {
					this.recordConnectionActivity();
					// 🎯 零拷贝优化：直接使用Uint8Array，避免Buffer.from的拷贝开销
					// Node.js 支持直接写入Uint8Array，无需额外拷贝
					this.socket.write(frame);
					this.logger.debug(`📡 发送消息成功(零拷贝): ${commandName} | seq=${seqNum} | bytes=${frame.byteLength}`);
				} catch (error) {
					clearTimeout(timer);
					this.messageQueue.delete(seqNum);
					this.logger.error(`❌ 发送消息失败: ${commandName} | seq=${seqNum}`, error);
					reject(new Error(`发送消息失败: ${error}`));
				}

			} catch (encodingError) {
				this.logger.error(`❌ 消息编码失败: ${commandName} | seq=${seqNum}`, encodingError);
				reject(new Error(`消息编码失败: ${encodingError instanceof Error ? encodingError.message : String(encodingError)}`));
			}
		});
	}

	private async handleIncomingData(chunk: Buffer): Promise<void> {
		try {
			// ✅ P1-5: 高效接收缓冲区管理 - 使用块列表避免频繁concat
			this.receiveChunks.push(chunk);
			this.receiveTotalSize += chunk.length;

			this.logger.debug(`📨 接收数据块: ${chunk.length} bytes | 缓冲区总大小: ${this.receiveTotalSize} bytes`);

			// 尝试循环解析多帧
			while (this.receiveTotalSize > 0) {
				// 🎯 优化：仅在需要时合并缓冲区
				const workingBuffer = this.getWorkingBuffer();
				const result = this.tryExtractOneFrame(workingBuffer);
				if (!result || result.consumed === 0) {break;}

				// 🎯 高效移除已消费数据
				this.consumeBytes(result.consumed);

				const frame = result.frame;
				if (!frame) {continue;}

				this.logger.debug(`📦 接收帧: ${this.getCommandName(frame.command)} | seq=${frame.sequenceNumber} | 格式=${frame.format} | 数据长度=${frame.dataLength} bytes`);

				// 解码负载 - 🔧 修复：添加 await 等待异步解码完成
				let response: any;
				try {
					this.logger.debug(`🔍 开始解码响应: seq=${frame.sequenceNumber} | 格式=${frame.format}`);
					response = await this.codec.autoDecode(new Uint8Array(frame.data), frame.format);
					this.logger.debug(`✅ 响应解码成功: seq=${frame.sequenceNumber} | 成功=${response?.success} | 消息=${response?.message}`);
				} catch (e) {
					this.logger.error(`❌ 解码响应失败: seq=${frame.sequenceNumber} | 格式=${frame.format}`, e);
					continue;
				}

				// 根据序列号匹配请求
				const context = this.messageQueue.get(frame.sequenceNumber);
				if (context) {
					clearTimeout(context.timer);
					this.messageQueue.delete(frame.sequenceNumber);
					this.logger.debug(`✅ 请求匹配成功: seq=${frame.sequenceNumber} | 命令=${this.getCommandName(frame.command)}`);
					if (context.metrics) {
						const roundTripMs = Date.now() - context.metrics.sentAt;
						this.logger.debug('⏱️ 消息往返完成', {
							command: context.metrics.commandName,
							operation: context.metrics.operation,
							success: response?.success,
							encodeMs: context.metrics.encodeDurationMs,
							frameMs: context.metrics.frameDurationMs,
							payloadBytes: context.metrics.payloadBytes,
							frameBytes: context.metrics.frameBytes,
							roundTripMs
						});
					}
					context.resolve(response);
					this.recordConnectionActivity();
				} else {
					this.logger.warn(`⚠️ 未匹配的响应: seq=${frame.sequenceNumber} | 命令=${this.getCommandName(frame.command)}`);
				}
			}

			// ✅ P1-5: 改进缓冲区管理策略，避免数据丢失 - 适配新的块列表系统
			const MAX_BUFFER_SIZE = TcpClient.FRAME_PAYLOAD_LIMIT + TcpClient.FRAME_SAFETY_MARGIN;
			const SAFE_BUFFER_SIZE = Math.max(512 * 1024, Math.floor(MAX_BUFFER_SIZE / 2));
      
			if (this.receiveTotalSize > MAX_BUFFER_SIZE) {
				// 温和处理：尝试保留未处理的有效数据
				this.logger.warn(`⚠️ 接收缓冲区过大 (${this.receiveTotalSize} bytes)，执行智能清理`);
				this.cleanupReceiveBuffers(SAFE_BUFFER_SIZE);
			}
		} catch (error) {
			this.logger.error('处理接收数据失败:', error);
		}
	}

	/**
   * ✅ P1-5: 获取工作缓冲区 - 仅在需要时合并数据块
   * @returns 合并后的缓冲区
   */
	private getWorkingBuffer(): Buffer {
		if (this.receiveChunks.length === 0) {
			return Buffer.alloc(0);
		}
		if (this.receiveChunks.length === 1) {
			return this.receiveChunks[0];
		}
		// 只有多个块时才合并
		return Buffer.concat(this.receiveChunks);
	}

	/**
   * ✅ P1-5: 高效消费字节 - 从块列表中移除已处理的数据
   * @param bytesToConsume 要消费的字节数
   */
	private consumeBytes(bytesToConsume: number): void {
		let remaining = bytesToConsume;
    
		while (remaining > 0 && this.receiveChunks.length > 0) {
			const firstChunk = this.receiveChunks[0];
      
			if (firstChunk.length <= remaining) {
				// 整个块都要被消费
				remaining -= firstChunk.length;
				this.receiveTotalSize -= firstChunk.length;
				this.receiveChunks.shift();
			} else {
				// 部分消费第一个块
				const newChunk = firstChunk.slice(remaining);
				this.receiveTotalSize -= remaining;
				this.receiveChunks[0] = newChunk;
				remaining = 0;
			}
		}
    
		this.logger.debug(`✅ 消费了 ${bytesToConsume} 字节，剩余缓冲区大小: ${this.receiveTotalSize} bytes`);
	}

	/**
   * ✅ P1-5: 智能清理接收缓冲区 - 适配块列表系统
   * @param maxSize 保留的最大大小
   */
	private cleanupReceiveBuffers(maxSize: number): void {
		if (this.receiveTotalSize <= maxSize) {return;}

		// 查找最后一个有效的帧起始位置
		const workingBuffer = this.getWorkingBuffer();
		let lastValidFrameStart = -1;
    
		for (let i = workingBuffer.length - 11; i >= 0; i--) {
			if (workingBuffer[i] === 0xAA && workingBuffer[i + 1] === 0x55) {
				lastValidFrameStart = i;
				break;
			}
		}
    
		if (lastValidFrameStart > 0) {
			// 保留从最后有效帧开始的数据
			const preserveData = workingBuffer.slice(lastValidFrameStart);
			this.receiveChunks = [preserveData];
			this.receiveTotalSize = preserveData.length;
			this.logger.info(`✅ 智能清理完成，保留 ${this.receiveTotalSize} bytes 有效数据`);
		} else if (this.receiveTotalSize > maxSize) {
			// 保守清理：保留最后的数据
			const preserveData = workingBuffer.slice(-maxSize);
			this.receiveChunks = [preserveData];
			this.receiveTotalSize = preserveData.length;
			this.logger.info(`✅ 保守清理完成，保留最后 ${maxSize} bytes`);
		}
	}

	private tryExtractOneFrame(buffer: Buffer): { frame: any | null; consumed: number } | null {
		// 🔧 修复P1问题：统一协议使用4字节长度字段，最小帧长度为13字节（2+4+2+1+1+1+2）
		if (buffer.length < 13) {
			this.logger.debug(`🔍 缓冲区长度不足: ${buffer.length} < 13，等待更多数据`);
			return { frame: null, consumed: 0 };
		}

		// 查找魔数 0xAA55
		let start = 0;
		while (start + 1 < buffer.length) {
			if (buffer[start] === 0xAA && buffer[start + 1] === 0x55) {break;}
			start++;
		}
		if (start > 0) {
			this.logger.warn(`丢弃无效前缀字节: ${start}`);
			return { frame: null, consumed: start };
		}

		// 读取数据长度（4字节小端）
		const dataLength = buffer.readUInt32LE(2);
		const totalLength = 13 + dataLength;

		if (buffer.length < totalLength) {
			return { frame: null, consumed: 0 };
		}

		const frameBuffer = buffer.slice(0, totalLength);
		const parsed = this.codec.parseFrame(new Uint8Array(frameBuffer));
		if (!parsed) {
			this.logger.warn('帧解析失败，丢弃一个字节重试');
			return { frame: null, consumed: 1 };
		}

		return { frame: parsed, consumed: totalLength };
	}

	private async uploadFileSimple(
		config: UploadConfig, 
		fileBuffer: Buffer, 
		preEncodedData?: { format: number, data: Uint8Array } | null
	): Promise<FileOperationResult> {
		const fileSize = this.toNumber(config.fileSize, fileBuffer.length);
    
		// 🚀 修复P1问题：复用预编码数据，避免重复编码
		let messageData: any;
		if (preEncodedData) {
			this.logger.debug(`🔄 复用预编码数据: ${preEncodedData.data.length} 字节`);
      
			// 直接使用预编码的数据构建消息
			messageData = {
				operation: 'UPLOAD_FILE',
				path: config.targetPath,
				name: config.filename,
				data: fileBuffer,  // 仍需传递原始数据用于消息构建
				fileSize,
				options: {
					type: 'application/octet-stream'
				}
			};
		} else {
			this.logger.debug('⚠️ 无预编码数据，使用实时编码');
			messageData = {
				operation: 'UPLOAD_FILE',
				path: config.targetPath,
				name: config.filename,
				data: fileBuffer,
				fileSize,
				options: {
					type: 'application/octet-stream'
				}
			};
		}

		// 🚀 发送上传命令，优先使用预编码数据避免重复编码
		const response = await this.sendCommand(
			TcpCommand.UPLOAD_FILE, 
			messageData, 
			60000,
			preEncodedData  // 🔧 修复：传递预编码数据给 sendCommand
		);

		if (config.onProgress) {
			config.onProgress({
				total: fileSize,
				loaded: fileSize,
				percent: 100,
				filename: config.filename
			});
		}

		return {
			success: response.success,
			message: response.message || (response.success ? '文件上传成功' : '文件上传失败'),
			data: response
		};
	}

	private async uploadFileChunked(config: UploadConfig, fileBuffer: Buffer): Promise<FileOperationResult> {
		const fileSize = this.toNumber(config.fileSize, fileBuffer.length);

		// 🚀 使用自适应分块策略动态确定块大小
		let chunkSize = this.chunkStrategy.getOptimalChunkSize();

		// 🔧 修复：优化大文件分块策略，减少往返次数
		if (fileSize < 128 * 1024) {
			// 小文件（<128KB）使用64KB块
			chunkSize = Math.min(chunkSize, 64 * 1024);
		} else if (fileSize > 200 * 1024 * 1024) {
			// 特大文件（>200MB）使用 512KB 块，兼顾吞吐与解析压力
			chunkSize = 512 * 1024;
		} else if (fileSize > 50 * 1024 * 1024) {
			// 超大文件（50-200MB）使用 256KB 块
			chunkSize = 256 * 1024;
		} else if (fileSize > 10 * 1024 * 1024) {
			// 大文件（10-50MB）使用 192KB 块
			chunkSize = 192 * 1024;
		} else if (fileSize > 1 * 1024 * 1024) {
			// 中等文件（1-10MB）使用 160KB 块
			chunkSize = 160 * 1024;
		} else {
			// 小中型文件（128KB-1MB）使用 128KB 块
			chunkSize = 128 * 1024;
		}

		// 使用统一的帧安全约束进行最终裁剪
		chunkSize = this.clampChunkSize(chunkSize, 'pre-session');

		const networkQuality = this.chunkStrategy.getStats().networkQuality;
		this.logger.info(`🚀 使用自适应分块: ${chunkSize / 1024}KB (网络质量: ${networkQuality})`);
    
		// 当前暂不支持服务端断点恢复能力
		const serverSupportsResume = false; // TODO: 待服务端能力建立后动态探测
		const persistenceAvailable = this.uploadManager.isPersistenceEnabled();
		const persistSession = persistenceAvailable && serverSupportsResume;

		// 🔧 断点续传：创建或恢复上传会话（可选择禁用持久化）
		let session = await this.uploadManager.createOrResumeSession(
			config.filename,
			config.targetPath,
			config.filename,
			fileBuffer,
			chunkSize,
			{ persist: persistSession }
		);

		// 历史版本可能残留超大块会话，这里强制重新初始化
		if (session.chunkSize > TcpClient.MAX_SAFE_CHUNK_SIZE) {
			this.logger.warn(
				'⚠️ 检测到历史上传会话的分块尺寸超过帧限制，重新建立安全会话',
				{
					sessionId: session.sessionId,
					persistedChunkSize: session.chunkSize,
					maxSafeChunkSize: TcpClient.MAX_SAFE_CHUNK_SIZE
				}
			);

			this.uploadManager.deleteSession(session.sessionId);

			chunkSize = this.clampChunkSize(session.chunkSize, 'legacy-session');
			session = await this.uploadManager.createOrResumeSession(
				config.filename,
				config.targetPath,
				config.filename,
				fileBuffer,
				chunkSize,
				{ persist: persistSession }
			);
		}

		const totalChunks = session.totalChunks;
		const initialProgress = persistSession ? this.uploadManager.getProgress(session.sessionId) : undefined;
		const initialUploadedChunks = initialProgress ? initialProgress.uploadedChunks : 0;
		const resumedBytesBaseline = initialProgress ? initialProgress.uploadedBytes : 0;
		const uploadStart = Date.now();
		this.logger.info('📦 分块上传准备完成', {
			sessionId: session.sessionId,
			chunkSize,
			totalChunks,
			resumeBaseline: resumedBytesBaseline,
			pendingChunks: totalChunks - initialUploadedChunks,
			mode: persistSession ? 'persistent' : 'ephemeral'
		});

		// 🚫 P0修复：检查服务端是否支持断点续传，如果不支持则上传所有块
		// TODO P1: 实现真正的服务端能力检测，目前默认不支持
		let pendingChunks: number[];

		if (serverSupportsResume) {
			pendingChunks = this.uploadManager.getPendingChunks(session.sessionId);
			this.logger.info('✅ 服务端支持断点续传，使用增量上传');
		} else {
		// 服务端不支持断点续传，强制上传所有块
			pendingChunks = Array.from({ length: totalChunks }, (unusedValue, i) => i);
			this.logger.debug('服务端不支持断点续传，将完整重新上传所有块');
		}
	    
		const dataFormat = this.config?.dataFormat || 'protobuf';
		this.logger.info(`📊 分块统计: 文件${fileSize}字节, 块大小${chunkSize}字节, 总块数${totalChunks}, 格式${dataFormat}`);

		if (serverSupportsResume && pendingChunks.length < totalChunks) {
			this.logger.info(`♻️ 恢复上传: 已上传 ${totalChunks - pendingChunks.length}/${totalChunks} 块，继续上传剩余 ${pendingChunks.length} 块`);
		} else {
			this.logger.info(`开始分块上传文件: ${config.filename}, 大小: ${fileSize} bytes, 分为 ${totalChunks} 块`);
		}
	    
		// 1. 发送上传请求
		// 🔧 修复：增加大文件的超时时间
		const uploadTimeout = fileSize > 10 * 1024 * 1024 ? 120000 : 60000; // 大文件120秒，其他60秒
		const initResponse = await this.sendCommand(TcpCommand.UPLOAD_REQ, {
			operation: 'UPLOAD_REQ',
			path: config.targetPath,
			name: config.filename,
			fileSize, // 🔧 修复：使用专门的 fileSize 字段
			chunkSize, // 🔧 修复：使用专门的 chunkSize 字段
			totalChunks, // 🔧 修复：使用专门的 totalChunks 字段
			options: {
				type: 'application/octet-stream', // 只保留字符串类型的扩展选项
				sessionId: session.sessionId,    // 传递会话ID
				resumedChunks: serverSupportsResume ? String(totalChunks - pendingChunks.length) : '0'
			}
		}, uploadTimeout);

		if (!initResponse.success) {
			throw new Error(initResponse.message || '上传初始化失败');
		}

		// 2. 分块上传数据（并发流水线）
		const scheduledChunks = pendingChunks;
		const plannedChunkCount = scheduledChunks.length;
		this.logger.info('📦 分块上传计划', {
			plannedChunks: plannedChunkCount,
			totalChunks,
			resumeMode: serverSupportsResume ? 'incremental' : 'full'
		});

		const recommendation = this.chunkStrategy.getRecommendation();
		const highVolume = fileSize > 32 * 1024 * 1024;
		const baselineConcurrency = highVolume ? 4 : 2;
		const desiredConcurrency = Math.max(recommendation.concurrency || baselineConcurrency, baselineConcurrency);
		const maxParallel = Math.min(6, plannedChunkCount || 1);
		const concurrency = maxParallel <= 1
			? 1
			: Math.min(desiredConcurrency, maxParallel);

		let nextChunkPointer = 0;
		let uploadedChunks = initialUploadedChunks;
		let uploadedBytes = resumedBytesBaseline;
		let failed = false;
		let totalChunkRetries = 0;
		const throttleIntervalMs = 200;
		let lastProgressEmit = 0;

		const emitProgress = (force = false) => {
			if (!config.onProgress) {return;}
			const now = Date.now();
			if (!force && now - lastProgressEmit < throttleIntervalMs && uploadedChunks < totalChunks) {
				return;
			}
			lastProgressEmit = now;
			const percent = Math.min(100, Math.round((uploadedBytes / fileSize) * 100));
			config.onProgress({
				total: fileSize,
				loaded: uploadedBytes,
				percent,
				filename: config.filename
			});
		};

		const uploadWorker = async (): Promise<void> => {
			while (!failed) {
				const scheduleIndex = nextChunkPointer++;
				if (scheduleIndex >= plannedChunkCount) {
					return;
				}

				const chunkIndex = scheduledChunks[scheduleIndex];
				const start = chunkIndex * chunkSize;
				if (start >= fileBuffer.length) {
					continue;
				}
				const end = Math.min(start + chunkSize, fileBuffer.length);
				const chunkData = fileBuffer.slice(start, end);
				const bytesThisChunk = chunkData.length;

				let retries = 0;
				const maxRetries = 3;
				const chunkTimeout = bytesThisChunk > 512 * 1024 ? 120000 : 60000;

				while (retries < maxRetries && !failed) {
					const chunkStart = Date.now();
					try {
						this.recordConnectionActivity('upload-chunk');
						const response = await this.sendCommand(TcpCommand.UPLOAD_DATA, {
							operation: 'UPLOAD_DATA',
							data: chunkData,
							isChunk: true,
							chunkIndex,
							totalChunks,
							chunkHash: this.calculateHash(chunkData),
							options: {
								sessionId: session.sessionId
							}
						}, chunkTimeout);

						const duration = Date.now() - chunkStart;
						this.chunkStrategy.recordTransfer({
							success: response?.success ?? false,
							duration,
							size: bytesThisChunk,
							retries
						});

						if (!response?.success) {
							throw new Error(response?.message || `数据块 ${chunkIndex} 上传失败`);
						}

						if (persistSession) {
							this.uploadManager.markChunkUploaded(session.sessionId, chunkIndex);
						}

						uploadedChunks += 1;
						uploadedBytes += bytesThisChunk;
						totalChunkRetries += retries;

						emitProgress(false);
						break;
					} catch (error) {
						retries += 1;
						if (retries >= maxRetries) {
							failed = true;
							throw error;
						}
						this.logger.warn(`⚠️ 块 ${chunkIndex} 上传失败，重试 ${retries}/${maxRetries}`);
						await new Promise(resolve => setTimeout(resolve, 1000 * retries));
					}
				}
			}
		};

		const workers = [] as Promise<void>[];
		for (let i = 0; i < concurrency; i++) {
			workers.push(uploadWorker());
		}

		await Promise.all(workers);
		emitProgress(true);

		const finalUploadedBytes = persistSession
			? this.uploadManager.getProgress(session.sessionId).uploadedBytes
			: uploadedBytes;
		if (finalUploadedBytes < fileSize) {
			const missingBytes = fileSize - finalUploadedBytes;
			throw new Error(`分块上传未覆盖全部数据，缺少 ${missingBytes} 字节`);
		}

		const totalElapsedMs = Date.now() - uploadStart;
		const effectiveMbps = totalElapsedMs > 0
			? Number(((finalUploadedBytes - resumedBytesBaseline) / (1024 * 1024)) / (totalElapsedMs / 1000)).toFixed(2)
			: '0.00';
		this.logger.info('✅ 分块上传阶段完成', {
			chunkSize,
			totalChunks,
			plannedChunks: plannedChunkCount,
			concurrency,
			totalDurationMs: totalElapsedMs,
			throughputMbps: effectiveMbps,
			retries: totalChunkRetries,
			resumeBaselineBytes: resumedBytesBaseline,
			mode: persistSession ? 'persistent' : 'ephemeral'
		});

		// 3. 发送上传结束消息
		// 🔧 修复：增加大文件的超时时间
		const endTimeout = fileSize > 10 * 1024 * 1024 ? 60000 : 30000;
		const endResponse = await this.sendCommand(TcpCommand.UPLOAD_END, {
			operation: 'UPLOAD_END',
			totalChunks, // 🔧 修复：使用专门的 totalChunks 字段
			fileSize, // 🔧 修复：使用专门的 fileSize 字段而非 finalSize
			options: {
				sessionId: session.sessionId // 传递会话ID
			}
		}, endTimeout);
		this.recordConnectionActivity();
		this.logger.info('📨 上传结束响应', {
			success: endResponse?.success,
			message: endResponse?.message,
			totalChunks,
			chunkSize,
			fileSize,
			retries: totalChunkRetries
		});

		if (endResponse.success) {
		// 🔧 断点续传：上传成功，清理会话
			if (persistSession) {
				this.uploadManager.completeSession(session.sessionId);
			}
			this.logger.info(`🎉 文件上传完成，会话已清理: ${session.sessionId}`);
		} else {
			this.logger.error('🚨 上传结束失败', {
				sessionId: session.sessionId,
				totalChunks,
				chunkSize,
				message: endResponse?.message,
				data: endResponse
			});
		}

		return {
			success: endResponse.success,
			message: endResponse.message || (endResponse.success ? '文件上传成功' : '文件上传失败'),
			data: endResponse
		};
	}

	/**
   * 对候选分块尺寸进行对齐与裁剪，确保满足帧限制
   */
	private clampChunkSize(candidate: number, reason: string): number {
		const original = candidate;
		// 先保证不低于最小块尺寸
		let adjusted = Math.max(candidate, TcpClient.MIN_SAFE_CHUNK_SIZE);

		// 对齐到 1KB，避免出现奇数大小导致的边界浪费
		adjusted = Math.max(TcpClient.MIN_SAFE_CHUNK_SIZE, Math.floor(adjusted / 1024) * 1024);

		// 最终裁剪到帧协议允许的范围内
		const clamped = Math.min(TcpClient.MAX_SAFE_CHUNK_SIZE, adjusted);

		if (clamped !== original) {
			this.logger.info(
				`⚖️ 分块大小已根据帧限制调整(${reason}): ${(original / 1024).toFixed(1)}KB -> ${(clamped / 1024).toFixed(1)}KB (<= ${TcpClient.FRAME_PAYLOAD_LIMIT} bytes)`
			);
		}

		return clamped;
	}

	private calculateHash(buffer: Buffer): string {
		// 简单的哈希计算（生产环境建议使用crypto模块）
		let hash = 0;
		for (let i = 0; i < buffer.length; i++) {
			hash = ((hash << 5) - hash + buffer[i]) & 0xffffffff;
		}
		return hash.toString(16).padStart(8, '0');
	}

	private recordConnectionActivity(source?: string): void {
		if (this.keepAlive) {
			this.keepAlive.recordActivity(source);
		}
	}


	private ensureConnected(): void {
		if (!this._isConnected) {
			throw new Error('TCP未连接，请先建立连接');
		}
	}

	private getFilenameFromPath(filePath: string): string {
		return filePath.split('/').pop() || '';
	}

	private getCommandName(command: number): string {
		return getCommandName(command as TcpCommand);
	}

	/**
   * P2集成：启动KeepAlive
   */
	private startKeepAlive(): void {
		if (!this.socket || !this._isConnected) {
			return;
		}
    
		// 初始化KeepAlive管理器
		if (!this.keepAlive) {
			this.keepAlive = new TcpKeepAlive(this.keepAliveConfig);
      
			// 监听KeepAlive事件
			this.keepAlive.on('ping-failed', (error) => {
				this.logger.warn('心跳失败:', error);
			});
      
			this.keepAlive.on('connection-lost', () => {
				this.logger.error('连接丢失（KeepAlive检测到心跳中断），自动重连已禁用');
				this.stateMachine.markDisconnected('KeepAlive检测到连接丢失');
			});
      
			this.keepAlive.on('reconnect-success', () => {
				this.logger.info('KeepAlive重连成功');
			});
		}
    
		// 启动KeepAlive，使用PING命令作为心跳
		this.keepAlive.start(this.socket, async () => {
			if (this.messageQueue.size > 0) {
				this.keepAlive?.recordActivity('pending-request');
				this.logger.debug('跳过心跳: 存在未完成请求', { pending: this.messageQueue.size });
				return;
			}
			try {
				await this.sendCommand(TcpCommand.PING, {
					operation: 'PING',
					timestamp: Date.now()
				});
			} catch (error) {
				throw error;
			}
		});
    
		this.logger.info('✅ KeepAlive已启动');
	}

	/**
   * P2集成：停止KeepAlive
   */
	private stopKeepAlive(): void {
		if (this.keepAlive) {
			this.keepAlive.stop();
			this.keepAlive = undefined;
			this.logger.info('⛔ KeepAlive已停止');
		}
	}

	private cleanupPendingRequests(): void {
		for (const [seqNum, context] of this.messageQueue.entries()) {
			clearTimeout(context.timer);
			context.reject(new Error('连接已断开'));
		}
		this.messageQueue.clear();
	}

	private cleanup(): void {
		// 停止KeepAlive，避免残留定时器与旧socket监听
		this.stopKeepAlive();

		this.cleanupPendingRequests();
    
		// 销毁自适应策略
		if (this.chunkStrategy) {
			this.chunkStrategy.destroy();
		}
    
		// 销毁断点续传管理器
		if (this.uploadManager) {
			this.uploadManager.destroy();
		}

		// 释放编解码器资源并重新初始化，防止配置监听残留
		if (this.codec) {
			this.codec.dispose();
			this.codec = new UniversalCodec();
		}
    
		if (this.socket) {
			// 移除所有事件监听器
			this.socket.removeAllListeners();
			this.socket.destroy();
			this.socket = undefined;
		}
    
		// 重置所有状态
		this._isConnected = false;
		this.sequenceNumber = 0;
		this.messageQueue.clear();
		this.receiveChunks = [];
		this.receiveTotalSize = 0;
	}
}
