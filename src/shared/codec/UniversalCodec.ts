// 🔧 修复：从 shared 导入 TcpCommand，从 webview 导入其他类型
import { TcpCommand, getCommandName } from '../constants/TcpCommands';
import { 
	TcpMessage, 
	TcpResponse, 
	TcpFrame 
} from '../../webview/types/webview-types';
import { ProtobufCodec, Operation, UnifiedRequest, UnifiedResponse } from './ProtobufCodec';
import { CompressionCodec, CompressionAlgorithm } from './CompressionCodec';
import { UnifiedProtocolHandler } from './UnifiedProtocolHandler';
import { Logger } from '../utils/Logger';
import { codecMonitor } from '../monitoring/CodecMonitor';
import { TcpConfigurationManager, TcpTransferConfig, ConfigLevel } from '../../extension/config/TcpConfigurationManager';

const logger = new Logger('UniversalCodec');

/**
 * 统一协议编解码器
 * 统一使用Protobuf数据格式，提供最优编码性能
 */
export class UniversalCodec {
	// 统一协议常量
	private static readonly PROTOCOL_VERSION = 0x01;
	// JSON支持已移除，统一使用Protobuf格式
	private static readonly FORMAT_PROTOBUF = 0x02;
	private static readonly FORMAT_AUTO = 0x03;
	private static readonly FORMAT_COMPRESSED = 0x04; // 压缩格式标识
	// 压缩算法标识位（显式标记算法，向后兼容侦测）
	private static readonly ALGO_MASK = 0x30;         // 0011 0000
	private static readonly ALGO_NONE = 0x00;         // 无算法标识
	private static readonly ALGO_GZIP = 0x10;         // 0001 0000
	private static readonly ALGO_DEFLATE = 0x20;      // 0010 0000
	private static readonly ALGO_BROTLI = 0x30;       // 0011 0000
  
	// 🔧 修复P7问题：重命名为更准确的名称，表示整帧固定开销
	private static readonly FRAME_OVERHEAD_BYTES = 13; // 帧头2+长度4+序列号2+命令码1+格式1+校验1+帧尾2（不含数据体）
  
	private protobufCodec: ProtobufCodec;
	private compressionCodec: CompressionCodec;
	private unifiedHandler: UnifiedProtocolHandler;
	private protobufInitialized = false;
  
	// 🎛️ 配置驱动的压缩管理
	private configManager: TcpConfigurationManager;
	private currentConfig: TcpTransferConfig;
	private configChangeDisposable?: { dispose(): void };
  
	private initializationPromise: Promise<void>; // 🔧 修复：添加初始化Promise避免时序问题

	constructor() {
		this.protobufCodec = new ProtobufCodec();
		this.compressionCodec = new CompressionCodec({
			algorithm: CompressionAlgorithm.GZIP,
			threshold: 1024,  // 只压缩大于 1KB 的数据
			enableAdaptive: true
		});
		this.unifiedHandler = new UnifiedProtocolHandler();
    
		// 🎛️ 初始化配置管理器
		this.configManager = TcpConfigurationManager.getInstance();
		this.currentConfig = this.configManager.getCurrentConfig();
    
		// 🔄 监听配置变更
		this.configChangeDisposable = this.configManager.onConfigChange(
			(newConfig) => this.handleConfigurationChange(newConfig)
		);
    
		// 🔧 修复：保存初始化Promise，避免时序问题
		this.initializationPromise = this.initializeWithConfiguration();
	}

	/**
   * 🎛️ 配置驱动的初始化
   */
	private async initializeWithConfiguration(): Promise<void> {
		try {
			// 🎛️ 确保配置管理器已初始化
			if (!this.configManager) {
				await this.configManager.initialize();
				this.currentConfig = this.configManager.getCurrentConfig();
			}
      
			// 🚀 初始化 Protobuf 编解码器
			await this.initializeProtobuf();
      
			// 🌐 初始化统一协议处理器
			await this.unifiedHandler.initialize();
      
			// 🎛️ 根据配置初始化压缩设置
			this.updateCompressionSettings();
      
			logger.info('🎛️ 配置驱动的编解码器初始化成功', {
				level: this.currentConfig.level,
				compression: this.currentConfig.transfer.compression,
				compressionAlg: this.currentConfig.transfer.compressionAlgorithm
			});
      
		} catch (error) {
			logger.error('❌ 编解码器初始化失败', error);
			throw error;
		}
	}
  
	/**
   * 初始化 Protobuf 编解码器
   */
	private async initializeProtobuf(): Promise<void> {
		try {
			await this.protobufCodec.initialize();
			this.protobufInitialized = true;
			logger.info('Protobuf codec initialized successfully');
		} catch (error) {
			// P1修复：Protobuf-only模式下不再提示JSON fallback
			logger.error('Failed to initialize protobuf codec (Protobuf-only mode, no fallback)', error);
			this.protobufInitialized = false;
			// 在TCP统一协议中，Protobuf是必需的，初始化失败应该抛出错误
			throw new Error(`Protobuf initialization required for unified protocol: ${error}`);
		}
	}
  
	/**
   * 🔄 处理配置变更
   */
	private handleConfigurationChange(newConfig: TcpTransferConfig): void {
		logger.info('🔄 编解码器配置变更', {
			oldCompression: this.currentConfig.transfer.compression,
			newCompression: newConfig.transfer.compression,
			oldLevel: this.currentConfig.level,
			newLevel: newConfig.level
		});
    
		this.currentConfig = newConfig;
		this.updateCompressionSettings();
	}
  
	/**
   * 🎛️ 根据配置更新压缩设置
   */
	private updateCompressionSettings(): void {
		const compressionEnabled = this.isCompressionEnabled();
    
		if (compressionEnabled) {
			// 🎛️ 根据配置更新压缩算法
			const algorithm = this.getConfiguredCompressionAlgorithm();
			this.compressionCodec = new CompressionCodec({
				algorithm,
				threshold: 1024,  // 只压缩大于 1KB 的数据
				enableAdaptive: this.currentConfig.level === ConfigLevel.HIGH_PERFORMANCE
			});
      
			logger.info(`🗜️ 压缩已启用: ${algorithm} (级别: ${this.currentConfig.level})`);
		} else {
			logger.info(`🚫 压缩已禁用 (级别: ${this.currentConfig.level})`);
		}
	}
  
	/**
   * 🎛️ 检查是否启用压缩（基于配置）
   */
	private isCompressionEnabled(): boolean {
		return this.currentConfig.transfer.compression;
	}
  
	/**
   * 🎛️ 获取配置的压缩算法
   */
	private getConfiguredCompressionAlgorithm(): CompressionAlgorithm {
		const configAlg = this.currentConfig.transfer.compressionAlgorithm;
    
		switch (configAlg) {
			case 'gzip':
				return CompressionAlgorithm.GZIP;
			case 'deflate':
				return CompressionAlgorithm.DEFLATE;
			case 'brotli':
				return CompressionAlgorithm.BROTLI;
			case 'auto':
				// 🎛️ 自动选择：根据配置级别选择最优算法
				return this.currentConfig.level === ConfigLevel.HIGH_PERFORMANCE 
					? CompressionAlgorithm.BROTLI 
					: CompressionAlgorithm.GZIP;
			case 'none':
			default:
				return CompressionAlgorithm.NONE;
		}
	}

	/**
   * 智能编码：强制Protobuf格式编码消息（Protobuf-only优化版本）
   * 优化目标：原始数据 -> protobuf二进制 -> 帧协议（完全移除JSON路径和base64编码层）
   * @param message 要编码的消息
   * @param operation 操作类型
   * @param preferredFormat 首选格式（已忽略，强制使用protobuf）
   * @returns 编码结果
   */
	public async smartEncode(
		message: TcpMessage, 
		operation: string, 
		preferredFormat: 'protobuf' = 'protobuf'
	): Promise<{ format: number, data: Uint8Array }> {
		// 🚀 强制Protobuf格式检查
		const selectedFormat = this.selectOptimalFormat(message, operation, preferredFormat);
    
		const startTime = Date.now();
		// ✅ 修复P1-3问题：移除JSON.stringify大对象性能问题，使用估算尺寸
		const inputSize = this.estimateMessageSize(message);
    
		// ✅ 强制Protobuf编码（不再检查selectedFormat，因为selectOptimalFormat已保证返回protobuf）
		try {
			// 🚀 使用真正的 protobuf 二进制编码，无需 base64 转换
			const protobufRequest = this.messageToProtobufRequest(message, operation);
			const binaryData = this.protobufCodec.encodeRequest(protobufRequest);
        
			// 🚫 P0修复：临时禁用压缩功能，直到服务端支持
			// 保持 format 恒定为 0x02，避免与服务端不兼容
			const format = UniversalCodec.FORMAT_PROTOBUF;
        
			// TODO P1: 在服务端支持压缩位识别后，重新启用以下压缩逻辑
			/*
        if (this.isCompressionEnabled() && binaryData.length > 1024) {
          const compressionStartTime = Date.now();
          const originalSize = binaryData.length;
          
          try {
            const compressionResult = await this.compressionCodec.compress(binaryData);
            const compressionDuration = Date.now() - compressionStartTime;
            
            if (compressionResult.algorithm !== CompressionAlgorithm.NONE) {
              codecMonitor.recordCompression(
                true, 
                compressionDuration, 
                originalSize, 
                compressionResult.compressedSize, 
                compressionResult.algorithm
              );
              
              logger.debug(`🗜️ 数据已压缩: ${compressionResult.originalSize} -> ${compressionResult.compressedSize} bytes (算法: ${compressionResult.algorithm})`);
              binaryData = compressionResult.data;
              format = UniversalCodec.FORMAT_COMPRESSED | UniversalCodec.FORMAT_PROTOBUF | this.getAlgoFlag(compressionResult.algorithm);
            } else {
              codecMonitor.recordCompression(false, compressionDuration, originalSize, originalSize, 'none', '数据不适合压缩');
            }
          } catch (error) {
            const compressionDuration = Date.now() - compressionStartTime;
            codecMonitor.recordCompression(false, compressionDuration, originalSize, originalSize, 'unknown', String(error));
            logger.warn(`🗜️ Protobuf数据压缩失败: ${error}`);
          }
        }
        */
        
			// 📊 记录编码性能
			const duration = Date.now() - startTime;
			codecMonitor.recordEncode('protobuf', true, duration, inputSize, binaryData.length);
        
			logger.debug(`✅ Protobuf 二进制编码成功: ${binaryData.length} bytes (操作: ${operation})`);
			logger.debug('🎯 性能优化: 跳过 base64 编码，直接使用二进制数据');
        
			return {
				format,
				data: binaryData  // 直接返回二进制数据，无需额外编码
			};
		} catch (error) {
			// 📊 记录编码失败
			const duration = Date.now() - startTime;
			codecMonitor.recordEncode('protobuf', false, duration, inputSize, 0, String(error));
        
			logger.error('❌ Protobuf 编码失败，统一协议要求必须成功', error);
        
			// ⚠️ 强制Protobuf模式：不再降级到JSON，直接抛出错误
			throw new Error(`Protobuf编码失败: ${error instanceof Error ? error.message : String(error)}. 统一协议要求强制使用Protobuf格式。`);
		}
	}

	/**
   * 强制Protobuf解码：仅支持Protobuf格式解码数据（Protobuf-only优化版本）
   * 优化目标：帧协议 -> protobuf二进制 -> 原始数据（完全移除JSON路径和base64解码层）
   * @param buffer 数据缓冲区
   * @param formatCode 格式代码（必须为Protobuf格式）
   * @returns 解码后的消息
   */
	public async autoDecode(buffer: Uint8Array, formatCode: number): Promise<TcpResponse> {
		const startTime = Date.now();
    
		// 🗜️ 检查是否为压缩格式
		let decompressedBuffer = buffer;
		if (formatCode & UniversalCodec.FORMAT_COMPRESSED) {
			// 读取显式压缩算法标识（若无则回退为侦测，保持向后兼容）
			let algorithm = this.getAlgoFromFlag(formatCode);
			if (algorithm === CompressionAlgorithm.NONE) {
				algorithm = this.compressionCodec.detectAlgorithm(buffer);
			}
			if (algorithm !== CompressionAlgorithm.NONE) {
				const decompressionStartTime = Date.now();
				const compressedSize = buffer.length;
        
				try {
					decompressedBuffer = await this.compressionCodec.decompress(buffer, algorithm);
					const decompressionDuration = Date.now() - decompressionStartTime;
          
					// 🔧 修复P1问题：使用独立解压统计，避免影响JSON/Protobuf使用率
					codecMonitor.recordDecompression(
						true, 
						decompressionDuration, 
						compressedSize, 
						decompressedBuffer.length, 
						algorithm
					);
          
					logger.debug(`🗜️ 数据已解压: ${buffer.length} -> ${decompressedBuffer.length} bytes (算法: ${algorithm})`);
				} catch (error) {
					const decompressionDuration = Date.now() - decompressionStartTime;
					codecMonitor.recordDecompression(false, decompressionDuration, compressedSize, 0, algorithm, String(error));
          
					logger.error('解压失败:', error);
					throw new Error(`解压失败: ${error}`);
				}
			}
			// 移除压缩标志位
			formatCode = formatCode & ~UniversalCodec.FORMAT_COMPRESSED;
			// 同时移除算法标志位
			formatCode = formatCode & ~UniversalCodec.ALGO_MASK;
		}
    
		// ✅ 强制Protobuf格式检查
		if (formatCode === UniversalCodec.FORMAT_PROTOBUF) {
			// 🚨 强制Protobuf初始化检查
			if (!this.protobufInitialized) {
				const errorMsg = 'Protobuf编解码器未初始化，无法解码数据。统一协议要求强制使用Protobuf格式。';
				logger.error(`❌ ${  errorMsg}`);
				throw new Error(errorMsg);
			}
      
			try {
				// 🚀 直接解码 protobuf 二进制数据，无需 base64 转换
				const protobufResponse = this.protobufCodec.decodeResponse(decompressedBuffer);
				const tcpResponse = this.protobufResponseToTcpResponse(protobufResponse);
          
				// 📊 记录解码性能
				const duration = Date.now() - startTime;
				codecMonitor.recordDecode('protobuf', true, duration, decompressedBuffer.length);
          
				logger.debug(`✅ Protobuf 二进制解码成功: ${buffer.length} bytes`);
				logger.debug('🎯 性能优化: 跳过 base64 解码，直接处理二进制数据');
          
				return tcpResponse;
			} catch (error) {
				// 📊 记录解码失败 - 强制Protobuf模式下不再降级到JSON
				const duration = Date.now() - startTime;
				codecMonitor.recordDecode('protobuf', false, duration, decompressedBuffer.length, String(error));
        
				logger.error('❌ Protobuf 解码失败，统一协议要求必须成功', error);
        
				// ⚠️ 强制Protobuf模式：不再降级到JSON，直接抛出错误
				throw new Error(`Protobuf解码失败: ${error instanceof Error ? error.message : String(error)}. 统一协议要求强制使用Protobuf格式。`);
			}
		} else {
			// ❌ 仅支持Protobuf格式
			const supportedFormat = UniversalCodec.FORMAT_PROTOBUF;
			throw new Error(`不支持的数据格式: 0x${formatCode.toString(16).padStart(2, '0')}. 统一协议仅支持Protobuf格式 (0x${supportedFormat.toString(16).padStart(2, '0')}).`);
		}
	}

	/**
   * 构建统一格式的协议帧（委托给UnifiedProtocolHandler，避免重复实现）
   * @param command 命令码
   * @param format 数据格式
   * @param data 数据体
   * @param sequenceNumber 序列号（用于异步请求响应匹配）
   * @returns 完整的统一协议帧
   */
	public buildFrame(command: number, format: number, data: Uint8Array, sequenceNumber = 0): Uint8Array {
		// 🔄 委托给统一协议处理器，避免重复实现
		return this.unifiedHandler.buildFrame(command, data, sequenceNumber);
	}

	/**
   * 解析统一协议帧（委托给UnifiedProtocolHandler，避免重复实现）
   * @param buffer 数据缓冲区
   * @returns 解析后的帧信息
   */
	public parseFrame(buffer: Uint8Array): TcpFrame | null {
		// 🔄 委托给统一协议处理器，避免重复实现
		const parsedFrame = this.unifiedHandler.parseFrame(buffer);
		if (!parsedFrame) {
			return null;
		}
    
		// 适配返回类型为TcpFrame格式
		return {
			magic: parsedFrame.magic,
			version: UniversalCodec.PROTOCOL_VERSION,
			command: parsedFrame.command,
			format: parsedFrame.format,
			sequenceNumber: parsedFrame.sequenceNumber,
			dataLength: parsedFrame.dataLength,
			data: parsedFrame.data,
			checksum: parsedFrame.checksum,
			trailer: parsedFrame.trailer
		};
	}

	/**
   * 🚀 统一协议格式选择 - 强制Protobuf-only策略
   * 
   * Protobuf-only策略：
   * - 🌐 所有操作 → 强制使用Protobuf（TCP和UART完全统一）
   * - ⚡ 性能优先：消除JSON回退路径的性能损失
   * - 🔄 架构统一：彻底移除双格式维护复杂性
   * 
   * @param data 数据对象
   * @param operation 操作类型
   * @param preferred 首选格式（已忽略，强制使用protobuf）
   * @returns 选定的格式（强制为'protobuf'）
   * @throws Error 如果Protobuf不可用
   */
	private selectOptimalFormat(
		data: any, 
		operation: string, 
		preferred: 'protobuf'
	): 'protobuf' {
		// 🚨 强制Protobuf-only检查
		if (!this.protobufInitialized) {
			const errorMsg = `Protobuf编解码器未初始化，无法处理操作[${operation}]。统一协议要求强制使用Protobuf格式。`;
			logger.error(`❌ ${  errorMsg}`);
			throw new Error(errorMsg);
		}
    
		// 🚀 强制Protobuf策略：所有操作使用Protobuf
		logger.debug(`🚀 强制Protobuf: 操作[${operation}]使用 Protobuf 格式（TCP+UART完全统一）`);
		return 'protobuf';
	}

	// ❌ JSON编解码方法已移除 - 统一协议仅支持Protobuf格式
	// encodeJson() 和 decodeJson() 方法已删除，强制使用Protobuf-only模式


	/**
   * 获取命令名称
   * 🔧 修复：使用统一的 shared 函数，添加调试日志
   * @param commandCode 命令码  
   * @returns 命令名称
   */
	public getCommandName(commandCode: number): string {
		const commandName = getCommandName(commandCode as TcpCommand);
    
		// 添加调试日志方便问题定位
		if (!commandName.startsWith('UNKNOWN')) {
			logger.debug(`🔍 命令码解析: 0x${commandCode.toString(16).padStart(2, '0')} -> ${commandName}`);
		} else {
			logger.warn(`⚠️ 未知命令码: 0x${commandCode.toString(16).padStart(2, '0')}`);
		}
    
		return commandName;
	}

	/**
   * 创建操作消息
   * @param operation 操作名称
   * @param params 参数
   * @returns TCP消息
   */
	public createMessage(operation: string, params: any = {}): TcpMessage {
		return {
			operation,
			...params
		};
	}

	/**
   * 验证操作码是否有效
   * @param operation 操作码或操作名称
   * @returns 是否为有效操作
   */
	private validateOperation(operation: string | number): boolean {
		if (typeof operation === 'string') {
			const validOperationNames = [
				'ping', 'PING', 'pong', 'PONG', 'connect', 'CONNECT', 'disconnect', 'DISCONNECT',
				'list_files', 'LIST_FILES', 'file_info', 'FILE_INFO', 'create_directory', 'CREATE_DIR',
				'delete_file', 'DELETE_FILE', 'rename_file', 'RENAME_FILE', 'upload_file', 'UPLOAD_FILE',
				'download_file', 'DOWNLOAD_FILE', 'upload_req', 'UPLOAD_REQ', 'upload_data', 'UPLOAD_DATA',
				'upload_end', 'UPLOAD_END', 'download_req', 'DOWNLOAD_REQ', 'download_data', 'DOWNLOAD_DATA',
				'download_end', 'DOWNLOAD_END', 'unknown', 'UNKNOWN'
			];
			return validOperationNames.includes(operation);
		} else {
			return Object.values(Operation).includes(operation);
		}
	}

	/**
   * 将 TCP 消息转换为 Protobuf 请求
   */
	private messageToProtobufRequest(message: TcpMessage, operationName: string): UnifiedRequest {
		// 🔍 调试日志：检查 operation 字段处理
		logger.debug('🔍 messageToProtobufRequest 调用', {
			receivedOperation: operationName,
			payloadOperation: message.operation
		});

		// 操作名称到操作码的映射 - 完整版本，包含所有.proto文件中定义的操作
		const operationMap: { [key: string]: Operation } = {
			// 连接管理操作
			'ping': Operation.PING,
			'PING': Operation.PING,
			'pong': Operation.PONG,
			'PONG': Operation.PONG,
			'connect': Operation.CONNECT,
			'CONNECT': Operation.CONNECT,
			'disconnect': Operation.DISCONNECT,
			'DISCONNECT': Operation.DISCONNECT,
      
			// 文件操作
			'list_files': Operation.LIST_FILES,
			'LIST_FILES': Operation.LIST_FILES,
			'file_info': Operation.FILE_INFO,
			'FILE_INFO': Operation.FILE_INFO,
			'create_directory': Operation.CREATE_DIR,
			'CREATE_DIR': Operation.CREATE_DIR,
			'delete_file': Operation.DELETE_FILE,
			'DELETE_FILE': Operation.DELETE_FILE,
			'rename_file': Operation.RENAME_FILE,
			'RENAME_FILE': Operation.RENAME_FILE,
      
			// 文件传输操作
			'upload_file': Operation.UPLOAD_FILE,
			'UPLOAD_FILE': Operation.UPLOAD_FILE,
			'download_file': Operation.DOWNLOAD_FILE,
			'DOWNLOAD_FILE': Operation.DOWNLOAD_FILE,
      
			// 分块上传操作
			'upload_req': Operation.UPLOAD_REQ,
			'UPLOAD_REQ': Operation.UPLOAD_REQ,
			'upload_data': Operation.UPLOAD_DATA,
			'UPLOAD_DATA': Operation.UPLOAD_DATA,
			'upload_end': Operation.UPLOAD_END,
			'UPLOAD_END': Operation.UPLOAD_END,
      
			// 分块下载操作
			'download_req': Operation.DOWNLOAD_REQ,
			'DOWNLOAD_REQ': Operation.DOWNLOAD_REQ,
			'download_data': Operation.DOWNLOAD_DATA,
			'DOWNLOAD_DATA': Operation.DOWNLOAD_DATA,
			'download_end': Operation.DOWNLOAD_END,
			'DOWNLOAD_END': Operation.DOWNLOAD_END,
      
			// 未知操作
			'unknown': Operation.UNKNOWN,
			'UNKNOWN': Operation.UNKNOWN
		};

		// 验证操作名称
		const finalOperationName = operationName || message.operation;
		if (!this.validateOperation(finalOperationName)) {
			logger.warn(`无效的操作名称: ${finalOperationName}，使用 UNKNOWN`);
		}

		// 🔍 调试：确定最终的 operation 枚举值
		const mappedOperation = operationMap[operationName] || operationMap[message.operation] || Operation.UNKNOWN;
		logger.debug('🔍 operation 映射结果', {
			input: operationName || message.operation,
			mappedValue: mappedOperation,
			mappedName: Operation[mappedOperation] || 'UNDEFINED'
		});

		const request: UnifiedRequest = {
			operation: mappedOperation
		};

		// 🔄 字段映射转换逻辑 (camelCase -> snake_case for protobuf compatibility)
		if (message.path) {request.path = message.path;}
		if (message.name) {request.name = message.name;}
		if (message.filename) {request.filename = message.filename;}
		if (message.newName) {request.newName = message.newName;} // 将在 protobuf 编码时转换为 new_name
		if (message.options) {request.options = message.options;}
    
		// 处理数据字段 - 🚀 优化：优先处理二进制数据，避免 base64 转换
		if (message.data) {
			// Node.js Buffer 是 Uint8Array 的子类，可以直接使用
			if (Buffer.isBuffer(message.data) || message.data instanceof Uint8Array) {
				request.data = message.data;  // 🎯 直接使用二进制数据，无需转换
			} else if (message.data instanceof ArrayBuffer) {
				request.data = new Uint8Array(message.data);
			} else if (typeof message.data === 'string') {
				// 🔧 修复：Node环境使用Buffer替代atob，处理base64字符串
				try {
					// 使用Node.js Buffer.from()替代浏览器atob()
					const buf = Buffer.from(message.data, 'base64');
					request.data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
					logger.debug(`✅ Node环境base64解码成功: ${message.data.length} 字符 -> ${request.data.length} 字节`);
				} catch (error) {
					// 如果不是 base64，转换为 UTF-8 字节
					logger.debug(`⚠️ base64解码失败，使用UTF-8编码: ${error}`);
					const encoder = new TextEncoder();
					request.data = encoder.encode(message.data);
					logger.debug(`✅ UTF-8编码完成: ${message.data.length} 字符 -> ${request.data.length} 字节`);
				}
			}
		}

		// 🔄 分块传输字段映射 (camelCase -> snake_case)
		// ✅ 修复P1问题：使用显式 undefined 判断，确保 false 值也能正确传输
		if (message.isChunk !== undefined) {
			request.isChunk = message.isChunk; // -> is_chunk
			logger.debug(`✅ Protobuf请求分块字段映射: isChunk=${message.isChunk}`);
		}
		if (message.chunkIndex !== undefined) {request.chunkIndex = message.chunkIndex;} // -> chunk_index
		if (message.totalChunks !== undefined) {request.totalChunks = message.totalChunks;} // -> total_chunks
		if (message.chunkHash) {request.chunkHash = message.chunkHash;} // -> chunk_hash

		// 🔄 连接信息映射 (camelCase -> snake_case)
		if (message.clientId) {request.clientId = message.clientId;} // -> client_id
		if (message.version) {request.version = message.version;}
		if (message.supportedFormats) {request.supportedFormats = message.supportedFormats;} // -> supported_formats
		// 🔧 增强：添加首选格式字段映射，保持JSON/Protobuf通道一致性
		if (message.preferredFormat) {request.preferredFormat = message.preferredFormat;}

		// 🔄 文件信息映射 (camelCase -> snake_case)
		if (message.size !== undefined) {request.fileSize = message.size;} // -> file_size
		if (message.fileSize !== undefined) {request.fileSize = message.fileSize;} // -> file_size
		if (message.checksum) {request.checksum = message.checksum;}
		if (message.chunkSize !== undefined) {request.chunkSize = message.chunkSize;} // -> chunk_size

		return request;
	}

	/**
   * 将 Protobuf 响应转换为 TCP 响应
   */
	private protobufResponseToTcpResponse(response: UnifiedResponse): TcpResponse {
		// 增强错误处理：确保必要字段存在
		if (response === null || response === undefined) {
			logger.error('❌ 收到空响应');
			throw new Error('Protobuf 响应为空');
		}
    
		const tcpResponse: TcpResponse = {
			success: Boolean(response.success),
			message: response.message || '',
			timestamp: response.timestamp || Date.now()
		};

		// 🔄 文件列表字段映射 (snake_case -> camelCase)
		if (response.files) {
			try {
				tcpResponse.files = response.files.map(file => {
					// 增强错误处理：验证文件对象
					if (!file || typeof file !== 'object') {
						logger.warn(`⚠️ 无效的文件对象: ${JSON.stringify(file)}`);
						return null;
					}
          
					return {
						name: file.name || '',
						path: file.path || '',
						type: (file.type === 'directory' ? 'directory' : 'file') as 'file' | 'directory',
						size: typeof file.size === 'string' ? Number(file.size) : (file.size || 0),
						lastModified: file.lastModified ? new Date(file.lastModified) : new Date(),
						permissions: file.permissions || '',
						isReadonly: Boolean(file.isReadonly), // is_readonly -> isReadonly
						mimeType: file.mimeType || '' // mime_type -> mimeType
					};
				}).filter(file => file !== null);
			} catch (error) {
				logger.error(`❌ 文件列表转换失败: ${error}`);
				tcpResponse.files = [];
			}
		}

		// 处理数据字段 - 🚀 优化版本：完全避免 base64 转换
		if (response.data && response.data.length > 0) {
			// 🎯 始终保持二进制数据格式，避免 base64 编码的 33% 开销
			if (response.data instanceof Uint8Array || Buffer.isBuffer(response.data)) {
				// 直接传递二进制数据，零开销
				tcpResponse.data = response.data;
				logger.debug(`🎯 零开销传输: 直接传递 ${response.data.length} 字节二进制数据`);
			} else if (Array.isArray(response.data)) {
				// 如果是数组，转换为 Uint8Array（保持二进制格式）
				tcpResponse.data = new Uint8Array(response.data);
				logger.debug(`🔄 数组转换: ${response.data.length} 字节转为 Uint8Array`);
			} else {
				// 其他情况：尝试创建 Uint8Array
				try {
					tcpResponse.data = new Uint8Array(response.data);
					logger.debug(`✅ 成功转换为二进制: ${tcpResponse.data.length} 字节`);
				} catch (error) {
					// 最后的兜底：保持原始数据
					tcpResponse.data = response.data;
					logger.warn('⚠️ 无法转换为二进制，保持原始格式');
				}
			}
		}

		// 🔄 其他字段映射 (snake_case -> camelCase) - 增强类型转换错误处理
		if (response.processTimeMs !== undefined) {
			const value = response.processTimeMs;
			tcpResponse.processTimeMs = typeof value === 'string' ? Number(value) : value;
			if (isNaN(tcpResponse.processTimeMs)) {
				logger.warn(`⚠️ processTimeMs 转换失败: ${value}`);
				tcpResponse.processTimeMs = 0;
			}
		}
    
		if (response.fileSize !== undefined) {
			const value = response.fileSize;
			tcpResponse.fileSize = typeof value === 'string' ? Number(value) : value;
			if (isNaN(tcpResponse.fileSize)) {
				logger.warn(`⚠️ fileSize 转换失败: ${value}`);
				tcpResponse.fileSize = 0;
			}
		}
    
		if (response.progressPercent !== undefined) {
			tcpResponse.progressPercent = Number(response.progressPercent);
			if (isNaN(tcpResponse.progressPercent)) {
				logger.warn(`⚠️ progressPercent 转换失败: ${response.progressPercent}`);
				tcpResponse.progressPercent = 0;
			}
		}
    
		if (response.status) {tcpResponse.status = String(response.status);}
		if (response.selectedFormat) {tcpResponse.selectedFormat = response.selectedFormat;} // selected_format -> selectedFormat
		// 🔧 修复P1问题：处理supportedCommands类型不一致 - proto为string[]，运行时需要number[]
		if (response.supportedCommands) {
			if (Array.isArray(response.supportedCommands)) {
				// 将字符串命令名映射为数值命令码
				tcpResponse.supportedCommands = response.supportedCommands.map((cmdName: string) => {
					// 1. 首先尝试通过名称查找对应的TcpCommand数值
					const cmdEntry = Object.entries(TcpCommand).find(([name]) => name === cmdName.toUpperCase());
					if (cmdEntry) {
						const cmdValue = cmdEntry[1] as number;
						logger.debug(`🔄 命令映射: "${cmdName}" -> ${cmdValue} (${cmdEntry[0]})`);
						return cmdValue;
					}
          
					// 2. 如果不是命令名，尝试解析为数字
					let numValue: number;
          
					// 检查是否为十六进制字符串（支持 0x 或 0X 前缀）
					if (typeof cmdName === 'string' && (cmdName.startsWith('0x') || cmdName.startsWith('0X'))) {
						numValue = parseInt(cmdName, 16);
						if (!isNaN(numValue) && Object.values(TcpCommand).includes(numValue)) {
							logger.debug(`🔄 十六进制命令: "${cmdName}" -> ${numValue}`);
							return numValue;
						}
					}
          
					// 尝试作为十进制数字解析
					numValue = parseInt(cmdName, 10);
					if (!isNaN(numValue) && Object.values(TcpCommand).includes(numValue)) {
						logger.debug(`🔄 十进制命令: "${cmdName}" -> ${numValue}`);
						return numValue;
					}
          
					// 如果都无法解析，记录警告并过滤
					logger.warn(`⚠️ 未知命令格式，过滤: "${cmdName}"`);
					return null; // 标记为无效，稍后过滤
				}).filter((cmd): cmd is number => cmd !== null); // 过滤无效命令
			} else {
				// 如果已经是数字数组，直接使用
				tcpResponse.supportedCommands = response.supportedCommands as number[];
				logger.debug(`✅ 支持的命令已为数字格式: ${tcpResponse.supportedCommands.length} 个命令`);
			}
		}
		if (response.sessionId) {tcpResponse.sessionId = response.sessionId;} // session_id -> sessionId
		if (response.acceptedChunkSize !== undefined) {tcpResponse.acceptedChunkSize = response.acceptedChunkSize;} // accepted_chunk_size -> acceptedChunkSize

		// 🔄 分块传输字段映射 (snake_case -> camelCase)
		// ⚠️ 注意：需要保留 false 值，使用显式 undefined 判断
		if (response.isChunk !== undefined) {tcpResponse.isChunk = response.isChunk;} // is_chunk -> isChunk
		if (response.chunkIndex !== undefined) {tcpResponse.chunkIndex = response.chunkIndex;} // chunk_index -> chunkIndex
		if (response.totalChunks !== undefined) {tcpResponse.totalChunks = response.totalChunks;} // total_chunks -> totalChunks
		if (response.chunkHash) {tcpResponse.chunkHash = response.chunkHash;} // chunk_hash -> chunkHash

		// 🔄 服务器信息字段映射 (snake_case -> camelCase)
		if (response.serverInfo) {
			tcpResponse.serverInfo = {
				name: response.serverInfo.name,
				version: response.serverInfo.version,
				protocol: response.serverInfo.protocol,
				supportedFormats: response.serverInfo.supportedFormats, // supported_formats -> supportedFormats
				rootDir: response.serverInfo.rootDir, // root_dir -> rootDir
				maxFileSize: response.serverInfo.maxFileSize, // max_file_size -> maxFileSize
				chunkSize: response.serverInfo.chunkSize, // chunk_size -> chunkSize
				concurrentOperations: response.serverInfo.concurrentOperations // concurrent_operations -> concurrentOperations
			};
		}

		return tcpResponse;
	}

	/**
   * 检查 Protobuf 是否可用
   */
	public isProtobufAvailable(): boolean {
		return this.protobufInitialized;
	}

	/**
   * 🔄 运行时格式切换支持
   * 根据当前性能和错误率动态调整首选格式
   */
	public getRecommendedFormat(): 'protobuf' {
		// P1修复：TCP统一协议强制使用protobuf，不再计算JSON指标
		if (!this.protobufInitialized) {
			throw new Error('Protobuf编解码器未初始化，统一协议要求强制使用Protobuf格式');
		}

		// P1修复：移除JSON相关的统计和切换逻辑
		// TCP统一协议中只返回'protobuf'
		return 'protobuf';
	}

	/**
   * 获取编解码器性能报告
   */
	public getPerformanceReport(): any {
		return codecMonitor.getPerformanceReport();
	}

	/**
   * 打印性能报告
   */
	public printPerformanceReport(): void {
		codecMonitor.printPerformanceReport();
	}

	/**
   * 重置监控统计
   */
	public resetMonitoringStats(): void {
		codecMonitor.resetStats();
		logger.info('🔄 编解码器监控统计已重置');
	}

	/**
   * 🔧 修复：获取初始化完成Promise，避免首个请求回落到JSON
   * 使用示例：await codec.readyPromise()
   */
	public get readyPromise(): Promise<void> {
		return this.initializationPromise;
	}

	/**
   * 等待初始化完成的便捷方法
   */
	public async waitForReady(): Promise<void> {
		return this.initializationPromise;
	}

	/**
   * 将压缩算法转换为格式标志位
   */
	private getAlgoFlag(algorithm: CompressionAlgorithm): number {
		switch (algorithm) {
			case CompressionAlgorithm.GZIP:
				return UniversalCodec.ALGO_GZIP;
			case CompressionAlgorithm.DEFLATE:
				return UniversalCodec.ALGO_DEFLATE;
			case CompressionAlgorithm.BROTLI:
				return UniversalCodec.ALGO_BROTLI;
			default:
				return UniversalCodec.ALGO_NONE;
		}
	}

	/**
   * 从格式标志位读取压缩算法
   */
	private getAlgoFromFlag(formatCode: number): CompressionAlgorithm {
		const flag = formatCode & UniversalCodec.ALGO_MASK;
		switch (flag) {
			case UniversalCodec.ALGO_GZIP:
				return CompressionAlgorithm.GZIP;
			case UniversalCodec.ALGO_DEFLATE:
				return CompressionAlgorithm.DEFLATE;
			case UniversalCodec.ALGO_BROTLI:
				return CompressionAlgorithm.BROTLI;
			default:
				return CompressionAlgorithm.NONE;
		}
	}
  
	/**
   * 🎛️ 获取当前配置级别
   */
	public getCurrentConfigLevel(): ConfigLevel {
		return this.currentConfig.level;
	}
  
	/**
   * 🎛️ 获取配置状态
   */
	public getConfigStatus(): {
    level: ConfigLevel;
    compressionEnabled: boolean;
    compressionAlgorithm: string;
    deviceType: string;
    } {
		return {
			level: this.currentConfig.level,
			compressionEnabled: this.currentConfig.transfer.compression,
			compressionAlgorithm: this.currentConfig.transfer.compressionAlgorithm,
			deviceType: this.currentConfig.deviceType
		};
	}
  
	/**
   * 🎛️ 强制更新配置（用于测试和调试）
   */
	public forceConfigUpdate(): void {
		this.currentConfig = this.configManager.getCurrentConfig();
		this.updateCompressionSettings();
		logger.info('🔄 强制更新配置完成');
	}

	/**
   * ✅ 修复P1-3问题：估算消息大小，避免JSON.stringify大对象性能问题
   * 针对包含二进制数据的消息，避免JSON.stringify造成的33%+膨胀和巨大CPU开销
   * @param message 消息对象
   * @returns 估算的消息大小（字节）
   */
	private estimateMessageSize(message: TcpMessage): number {
		let size = 100; // 基础字段估算

		// 字符串字段估算
		if (message.operation) {size += message.operation.length * 2;}
		if (message.path) {size += message.path.length * 2;}
		if (message.name) {size += message.name.length * 2;}
		if (message.filename) {size += message.filename.length * 2;}
    
		// 🎯 重点处理：二进制数据字段，避免JSON.stringify的巨大开销
		if (message.data) {
			if (Buffer.isBuffer(message.data)) {
				size += message.data.length; // 直接使用Buffer长度
			} else if (message.data instanceof Uint8Array) {
				size += message.data.byteLength; // 直接使用字节长度
			} else if (message.data instanceof ArrayBuffer) {
				size += message.data.byteLength; // 直接使用字节长度
			} else if (typeof message.data === 'string') {
				size += message.data.length * 2; // 字符串估算
			} else {
				// 其他类型进行保守估算，避免JSON.stringify
				size += 1000; // 保守估算1KB
			}
		}
    
		// 其他数值字段
		if (message.fileSize !== undefined) {size += 8;}
		if (message.chunkSize !== undefined) {size += 8;}
		if (message.totalChunks !== undefined) {size += 8;}
		if (message.chunkIndex !== undefined) {size += 8;}
    
		logger.debug(`📏 消息大小估算: ${size} 字节 (操作: ${message.operation})`);
		return size;
	}

	/**
   * 🚀 P2 新增：智能预编码策略 - 大文件采样估算，避免 OOM
   * 
   * 针对大文件上传场景的预编码优化：
   * - 小文件（< 8MB）：直接预编码
   * - 中等文件（8MB-32MB）：采样前1MB估算
   * - 大文件（> 32MB）：采样前512KB估算，仅在STANDARD/HIGH_PERFORMANCE启用
   * 
   * @param message 要编码的消息
   * @param operation 操作类型
   * @param fileSize 文件大小（字节）
   * @returns 预编码结果或估算结果
   */
	public async smartPreEncode(
		message: TcpMessage, 
		operation: string,
		fileSize: number
	): Promise<{ 
    encoded: boolean; 
    data?: { format: number; data: Uint8Array }; 
    estimatedSize: number; 
    method: 'full' | 'sampled' | 'skipped'; 
    compressionRatio?: number;
  }> {
		// 🎛️ 配置驱动的阈值
		const minimalThreshold = 4 * 1024 * 1024;      // 4MB - MINIMAL配置下直接预编码阈值
		const standardThreshold = 8 * 1024 * 1024;     // 8MB - STANDARD配置下采样阈值  
		const performanceThreshold = 32 * 1024 * 1024; // 32MB - HIGH_PERFORMANCE配置下采样阈值
		const maxSampleSize = 1024 * 1024;             // 1MB - 最大采样大小
		const largeSampleSize = 512 * 1024;            // 512KB - 大文件采样大小

		const currentLevel = this.currentConfig.level;
		const isMemoryConstrained = currentLevel === ConfigLevel.MINIMAL;

		logger.info(`🔍 智能预编码决策: 文件=${fileSize}字节, 配置=${currentLevel}`);

		// 场景1: 小文件直接预编码
		if (fileSize <= (isMemoryConstrained ? minimalThreshold : standardThreshold)) {
			logger.info(`📝 小文件全量预编码: ${fileSize}字节`);
			try {
				const encoded = await this.smartEncode(message, operation);
				return {
					encoded: true,
					data: encoded,
					estimatedSize: encoded.data.length,
					method: 'full'
				};
			} catch (error) {
				logger.warn(`⚠️ 小文件预编码失败: ${error}`);
				return {
					encoded: false,
					estimatedSize: fileSize * 1.4, // 保守估算
					method: 'skipped'
				};
			}
		}

		// 场景2: 内存受限或超大文件跳过预编码
		if (isMemoryConstrained || fileSize > performanceThreshold) {
			logger.info(`🚫 跳过预编码: 配置=${currentLevel}, 大小=${fileSize}字节`);
      
			// 基于历史数据或保守估算
			const compressionEnabled = this.isCompressionEnabled();
			const estimatedRatio = compressionEnabled ? 0.7 : 1.1; // 压缩70%或膨胀10%
      
			return {
				encoded: false,
				estimatedSize: Math.ceil(fileSize * estimatedRatio),
				method: 'skipped',
				compressionRatio: estimatedRatio
			};
		}

		// 场景3: 中等文件采样估算
		const sampleSize = Math.min(
			fileSize > standardThreshold ? largeSampleSize : maxSampleSize,
			fileSize
		);

		logger.info(`🔬 中等文件采样预编码: 样本=${sampleSize}字节/${fileSize}字节`);

		try {
			// 创建采样数据
			let sampleData: any;
			if (message.data) {
				if (Buffer.isBuffer(message.data)) {
					sampleData = message.data.subarray(0, sampleSize);
				} else if (message.data instanceof Uint8Array) {
					sampleData = message.data.subarray(0, sampleSize);
				} else if (message.data instanceof ArrayBuffer) {
					sampleData = new Uint8Array(message.data, 0, sampleSize);
				} else {
					// 非二进制数据直接预编码
					sampleData = message.data;
				}
			}

			// 创建采样消息
			const sampleMessage = {
				...message,
				data: sampleData
			};

			const sampleStartTime = Date.now();
			const sampleEncoded = await this.smartEncode(sampleMessage, operation);
			const sampleDuration = Date.now() - sampleStartTime;

			// 计算压缩/膨胀比率
			const sampleOriginalSize = sampleData ? 
				(Buffer.isBuffer(sampleData) ? sampleData.length : 
					sampleData instanceof Uint8Array ? sampleData.byteLength :
						sampleData instanceof ArrayBuffer ? sampleData.byteLength :
							sampleSize) : 100;
      
			const compressionRatio = sampleEncoded.data.length / sampleOriginalSize;
			const estimatedFullSize = Math.ceil(fileSize * compressionRatio);

			logger.info(`📊 采样估算完成: 样本比率=${compressionRatio.toFixed(3)}, 估算=${estimatedFullSize}字节, 耗时=${sampleDuration}ms`);

			return {
				encoded: false,
				estimatedSize: estimatedFullSize,
				method: 'sampled',
				compressionRatio
			};

		} catch (error) {
			logger.warn(`⚠️ 采样预编码失败: ${error}`);
      
			// 回退到保守估算
			const fallbackRatio = this.isCompressionEnabled() ? 0.8 : 1.2;
			return {
				encoded: false,
				estimatedSize: Math.ceil(fileSize * fallbackRatio),
				method: 'skipped',
				compressionRatio: fallbackRatio
			};
		}
	}

	/**
   * 🚀 P2 新增：获取预编码建议的阈值配置
   */
	public getPreEncodeThresholds(): {
    minimalThreshold: number;
    standardThreshold: number; 
    performanceThreshold: number;
    currentLevel: ConfigLevel;
    } {
		return {
			minimalThreshold: 4 * 1024 * 1024,      // 4MB
			standardThreshold: 8 * 1024 * 1024,     // 8MB
			performanceThreshold: 32 * 1024 * 1024, // 32MB
			currentLevel: this.currentConfig.level
		};
	}
  
	/**
   * 🗑️ 清理资源
   */
	public dispose(): void {
		if (this.configChangeDisposable) {
			this.configChangeDisposable.dispose();
			this.configChangeDisposable = undefined;
		}
		logger.info('🗑️ UniversalCodec资源已清理');
	}
}
