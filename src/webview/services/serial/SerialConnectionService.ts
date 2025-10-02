import { IConnectionService } from '../interfaces/IConnectionService';
import type { OperationControlHooks } from '../bridge/BaseBridgeService';
import { SerialConnectionManager } from './SerialConnectionManager';
import { SerialProtocolCodec } from './SerialProtocolCodec';
import {
	ConnectionConfig,
	FileItem,
	FileOperationResult,
	UploadConfig,
	DownloadConfig,
	ServiceError,
	SerialCommand,
	SerialConnectionState,
	SerialDataFormat,
	TcpMessage,
	TcpResponse,
	SerialConnectionOptions,
	SerialPortFilter
} from '../../types';

/**
 * 串口连接服务实现
 * 通过Web Serial API与串口设备进行文件操作交互
 * 使用统一协议格式，与TCP协议完全兼容
 */
export class SerialConnectionService extends IConnectionService {
	private connectionManager: SerialConnectionManager;
	private protocolCodec: SerialProtocolCodec;

	constructor() {
		super();
		this.connectionManager = new SerialConnectionManager();
		this.protocolCodec = new SerialProtocolCodec();
		this.setupEventListeners();
	}

	/**
   * 设置事件监听器
   */
	private setupEventListeners(): void {
		// 监听连接状态变化
		this.connectionManager.getConnectionState = () => {
			return this.isConnectedFlag ? SerialConnectionState.CONNECTED : SerialConnectionState.DISCONNECTED;
		};

		console.log('串口连接服务初始化完成');
	}

	/**
   * 连接到串口设备
   * @param config 连接配置
   * @returns Promise<boolean>
   */
	async connect(config: ConnectionConfig): Promise<boolean> {
		try {
			this.config = config;

			// 构建串口连接选项
			const serialOptions: Partial<SerialConnectionOptions> = {
				baudRate: config.baudRate || 115200,
				dataBits: config.dataBits || 8,
				stopBits: config.stopBits || 1,
				parity: config.parity || 'none',
				// Web Serial API 不支持 software 流控，映射为 none
				flowControl: (config.flowControl === 'software' ? 'none' : config.flowControl) || 'none',
				requestTimeout: config.timeout || 30000
			};

			// 构建设备过滤器
			const filters: SerialPortFilter[] = config.deviceFilters || [
				{ usbVendorId: 0x1A86 },  // CH340/CH341
				{ usbVendorId: 0x10C4 },  // CP210x
				{ usbVendorId: 0x0403 },  // FTDI
				{ usbVendorId: 0x2341 },  // Arduino
				{ usbVendorId: 0x239A }   // Adafruit
			];

			const success = await this.connectionManager.connect(serialOptions, filters);
      
			if (success) {
				this.isConnectedFlag = true;
        
				// 执行设备能力协商
				try {
					await this.negotiateDeviceCapabilities();
					console.log('串口连接成功并完成协商');
					return true;
				} catch (negotiationError) {
					console.warn('设备协商失败，但连接保持:', negotiationError);
					// 即使协商失败，连接仍然有效
					return true;
				}
			}
      
			return false;
		} catch (error) {
			this.isConnectedFlag = false;
			throw this.createServiceError('串口连接失败', error);
		}
	}

	/**
   * 设备能力协商
   */
	private async negotiateDeviceCapabilities(): Promise<void> {
		try {
			// 创建协商消息
			const negotiationMessage = this.protocolCodec.createNegotiationMessage('json');
      
			// 发送PING命令进行协商
			const response = await this.connectionManager.sendRequest(
				SerialCommand.PING,
				negotiationMessage,
				SerialDataFormat.JSON,
				10000 // 10秒超时
			);

			if (response && response.success) {
				// 处理协商响应
				const negotiationResult = this.protocolCodec.processNegotiationResponse(response);
        
				// 验证协商结果
				const validation = this.protocolCodec.validateNegotiationResult(negotiationResult);
        
				if (!validation.valid) {
					console.warn('设备协商警告:', validation.warnings);
					if (validation.errors.length > 0) {
						throw new Error(`设备协商失败: ${validation.errors.join(', ')}`);
					}
				}

				console.log('设备协商成功:', this.protocolCodec.getDeviceSummary());
			} else {
				console.warn('设备可能不支持协商协议，将使用基础模式');
			}
		} catch (error) {
			throw new Error(`设备协商失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
   * 断开连接
   */
	async disconnect(): Promise<void> {
		await this.connectionManager.disconnect();
		this.isConnectedFlag = false;
		this.config = undefined;
	}

	/**
   * 测试连接
   * @param config 连接配置
   * @returns Promise<boolean>
   */
	async testConnection(config: ConnectionConfig): Promise<boolean> {
		try {
			const testManager = new SerialConnectionManager();
      
			const serialOptions: Partial<SerialConnectionOptions> = {
				baudRate: config.baudRate || 115200,
				dataBits: config.dataBits || 8,
				stopBits: config.stopBits || 1,
				parity: config.parity || 'none',
				// Web Serial API 不支持 software 流控，映射为 none
				flowControl: (config.flowControl === 'software' ? 'none' : config.flowControl) || 'none',
				requestTimeout: 10000 // 测试连接使用较短超时
			};

			const filters: SerialPortFilter[] = config.deviceFilters || [];

			const success = await testManager.connect(serialOptions, filters);
      
			if (success) {
				await testManager.disconnect();
				return true;
			}
      
			return false;
		} catch (error) {
			console.warn('串口连接测试失败:', error);
			return false;
		}
	}

	/**
   * 获取文件列表
   * @param path 路径
   * @returns Promise<FileItem[]>
   */
	async listFiles(path: string): Promise<FileItem[]> {
		this.ensureConnected();

		try {
			const requestData = {
				operation: 'LIST_FILES',
				path,
				options: {
					recursive: false,
					filter: '*'
				}
			};

			const response = await this.connectionManager.sendRequest(
				SerialCommand.LIST_FILES,
				requestData,
				SerialDataFormat.JSON,
				15000
			);

			if (!response.success) {
				throw new Error(response.message || '获取文件列表失败');
			}

			// 转换文件列表格式
			return (response.files || []).map((file: any) => this.protocolCodec.createFileItem(file));

		} catch (error) {
			throw this.createServiceError('获取文件列表失败', error);
		}
	}

	/**
   * 下载文件
   * @param config 下载配置
   * @returns Promise<Blob>
   */
	async downloadFile(config: DownloadConfig): Promise<Blob> {
		this.ensureConnected();

		try {
			const requestData = {
				operation: 'DOWNLOAD_FILE',
				path: config.filePath
			};

			const response = await this.connectionManager.sendRequest(
				SerialCommand.DOWNLOAD_FILE,
				requestData,
				SerialDataFormat.JSON,
				60000 // 下载文件使用较长超时时间
			);

			if (!response.success) {
				throw new Error(response.message || '文件下载失败');
			}

			// 更新进度回调
			if (config.onProgress) {
				config.onProgress({
					total: response.fileSize || 1,
					loaded: response.fileSize || 1,
					percent: 100,
					filename: config.filename || this.getFilenameFromPath(config.filePath)
				});
			}

			// 处理二进制数据
			let fileData: ArrayBuffer;
			if (response.data instanceof ArrayBuffer) {
				fileData = response.data;
			} else if (typeof response.data === 'string') {
				// 如果是base64编码的字符串，需要解码
				const binaryString = atob(response.data);
				const bytes = new Uint8Array(binaryString.length);
				for (let i = 0; i < binaryString.length; i++) {
					bytes[i] = binaryString.charCodeAt(i);
				}
				fileData = bytes.buffer;
			} else {
				throw new Error('不支持的文件数据格式');
			}

			return new Blob([fileData]);

		} catch (error) {
			throw this.createServiceError('文件下载失败', error);
		}
	}

	/**
   * 上传文件
   * @param config 上传配置
   * @returns Promise<FileOperationResult>
   */
	async uploadFile(config: UploadConfig, hooks?: OperationControlHooks): Promise<FileOperationResult> {
		void hooks;
		this.ensureConnected();

		try {
			// 将文件转换为ArrayBuffer
			const fileBuffer = await this.fileToArrayBuffer(config.file);
      
			// 根据协议编解码器的建议选择传输方式
			const transferMode = this.protocolCodec.selectTransferMode(config.file.size);
      
			if (transferMode.useChunking) {
				return await this.uploadFileChunked(config, fileBuffer, transferMode.chunkSize);
			} else {
				return await this.uploadFileSimple(config, fileBuffer);
			}

		} catch (error) {
			console.error('文件上传失败:', error);
			return {
				success: false,
				message: `文件上传失败: ${  this.getErrorMessage(error)}`
			};
		}
	}

	/**
   * 简单文件上传（小文件）
   * @param config 上传配置
   * @param fileBuffer 文件数据
   * @returns Promise<FileOperationResult>
   */
	private async uploadFileSimple(
		config: UploadConfig, 
		fileBuffer: ArrayBuffer
	): Promise<FileOperationResult> {
		// 将ArrayBuffer转换为base64字符串用于JSON传输
		const base64Data = this.arrayBufferToBase64(fileBuffer);

		const requestData = {
			operation: 'UPLOAD_FILE',
			path: config.targetPath,
			name: config.file.name,
			data: base64Data,
			options: {
				size: config.file.size,
				type: config.file.type
			}
		};

		const response = await this.connectionManager.sendRequest(
			SerialCommand.UPLOAD_FILE,
			requestData,
			SerialDataFormat.JSON,
			60000
		);

		// 更新进度回调
		if (config.onProgress) {
			config.onProgress({
				total: config.file.size,
				loaded: config.file.size,
				percent: 100,
				filename: config.file.name
			});
		}

		return {
			success: response.success,
			message: response.message || (response.success ? '文件上传成功' : '文件上传失败'),
			data: response
		};
	}

	/**
   * 分块文件上传（大文件）
   * @param config 上传配置
   * @param fileBuffer 文件数据
   * @param chunkSize 块大小
   * @returns Promise<FileOperationResult>
   */
	private async uploadFileChunked(
		config: UploadConfig, 
		fileBuffer: ArrayBuffer,
		chunkSize: number
	): Promise<FileOperationResult> {
		const totalChunks = Math.ceil(fileBuffer.byteLength / chunkSize);
    
		try {
			// 1. 发送上传请求
			const initRequestData = {
				operation: 'UPLOAD_REQ',
				path: config.targetPath,
				name: config.file.name,
				options: {
					size: config.file.size,
					type: config.file.type,
					chunkSize,
					totalChunks
				}
			};

			const initResponse = await this.connectionManager.sendRequest(
				SerialCommand.UPLOAD_REQ,
				initRequestData,
				SerialDataFormat.JSON
			);

			if (!initResponse.success) {
				throw new Error(initResponse.message || '上传初始化失败');
			}

			// 2. 分块上传数据
			let uploadedBytes = 0;
			for (let i = 0; i < totalChunks; i++) {
				const start = i * chunkSize;
				const end = Math.min(start + chunkSize, fileBuffer.byteLength);
				const chunkData = fileBuffer.slice(start, end);
				const base64Chunk = this.arrayBufferToBase64(chunkData);

				const chunkRequestData = {
					operation: 'UPLOAD_DATA',
					data: base64Chunk,
					isChunk: true,
					chunkIndex: i,
					totalChunks,
					chunkHash: await this.calculateHash(chunkData)
				};

				const chunkResponse = await this.connectionManager.sendRequest(
					SerialCommand.UPLOAD_DATA,
					chunkRequestData,
					SerialDataFormat.JSON,
					30000
				);

				if (!chunkResponse.success) {
					throw new Error(`块 ${i} 上传失败: ${chunkResponse.message}`);
				}

				uploadedBytes += (end - start);

				// 更新进度
				if (config.onProgress) {
					config.onProgress({
						total: config.file.size,
						loaded: uploadedBytes,
						percent: Math.round((uploadedBytes / config.file.size) * 100),
						filename: config.file.name
					});
				}
			}

			// 3. 发送上传结束消息
			const endRequestData = {
				operation: 'UPLOAD_END',
				options: {
					totalChunks,
					finalSize: config.file.size
				}
			};

			const endResponse = await this.connectionManager.sendRequest(
				SerialCommand.UPLOAD_END,
				endRequestData,
				SerialDataFormat.JSON
			);

			return {
				success: endResponse.success,
				message: endResponse.message || (endResponse.success ? '文件上传成功' : '文件上传失败'),
				data: endResponse
			};

		} catch (error) {
			return {
				success: false,
				message: `分块上传失败: ${  this.getErrorMessage(error)}`
			};
		}
	}

	/**
   * 删除文件
   * @param path 文件路径
   * @returns Promise<FileOperationResult>
   */
	async deleteFile(path: string): Promise<FileOperationResult> {
		this.ensureConnected();

		try {
			const requestData = {
				operation: 'DELETE_FILE',
				path
			};

			const response = await this.connectionManager.sendRequest(
				SerialCommand.DELETE_FILE,
				requestData,
				SerialDataFormat.JSON
			);

			return {
				success: response.success,
				message: response.message || (response.success ? '文件删除成功' : '文件删除失败')
			};

		} catch (error) {
			return {
				success: false,
				message: `文件删除失败: ${  this.getErrorMessage(error)}`
			};
		}
	}

	/**
   * 重命名文件
   * @param oldPath 原路径
   * @param newPath 新路径
   * @returns Promise<FileOperationResult>
   */
	async renameFile(oldPath: string, newPath: string): Promise<FileOperationResult> {
		this.ensureConnected();

		try {
			// 从新路径中提取新文件名
			const newName = newPath.split('/').pop() || '';

			const requestData = {
				operation: 'RENAME_FILE',
				path: oldPath,
				newName
			};

			const response = await this.connectionManager.sendRequest(
				SerialCommand.RENAME_FILE,
				requestData,
				SerialDataFormat.JSON
			);

			return {
				success: response.success,
				message: response.message || (response.success ? '文件重命名成功' : '文件重命名失败')
			};

		} catch (error) {
			return {
				success: false,
				message: `文件重命名失败: ${  this.getErrorMessage(error)}`
			};
		}
	}

	/**
   * 创建目录
   * @param path 目录路径
   * @returns Promise<FileOperationResult>
   */
	async createDirectory(path: string): Promise<FileOperationResult> {
		this.ensureConnected();

		try {
			// 解析路径，分离父目录和文件夹名称
			let parentPath = '/';
			let folderName = '';
      
			if (path === '/' || path === '') {
				return {
					success: false,
					message: '文件夹名称不能为空'
				};
			}
      
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

			const requestData = {
				operation: 'CREATE_DIR',
				path: parentPath,
				name: folderName
			};

			const response = await this.connectionManager.sendRequest(
				SerialCommand.CREATE_DIR,
				requestData,
				SerialDataFormat.JSON
			);

			return {
				success: response.success,
				message: response.message || (response.success ? '目录创建成功' : '目录创建失败')
			};

		} catch (error) {
			return {
				success: false,
				message: `目录创建失败: ${  this.getErrorMessage(error)}`
			};
		}
	}

	/**
   * 获取文件信息
   * @param path 文件路径
   * @returns Promise<FileItem>
   */
	async getFileInfo(path: string): Promise<FileItem> {
		this.ensureConnected();

		try {
			const requestData = {
				operation: 'FILE_INFO',
				path
			};

			const response = await this.connectionManager.sendRequest(
				SerialCommand.FILE_INFO,
				requestData,
				SerialDataFormat.JSON
			);

			if (!response.success) {
				throw new Error(response.message || '获取文件信息失败');
			}

			// 从响应中提取文件信息
			const fileData = response.files?.[0];
			if (!fileData) {
				throw new Error('响应中没有文件信息');
			}
      
			return this.protocolCodec.createFileItem(fileData);

		} catch (error) {
			throw this.createServiceError('获取文件信息失败', error);
		}
	}

	// ========== 辅助方法 ==========

	/**
   * 确保已连接
   */
	private ensureConnected(): void {
		if (!this.isConnectedFlag) {
			throw new ServiceError('串口连接未建立');
		}
	}

	/**
   * 将文件转换为ArrayBuffer
   */
	private fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as ArrayBuffer);
			reader.onerror = reject;
			reader.readAsArrayBuffer(file);
		});
	}

	/**
   * 将ArrayBuffer转换为base64字符串
   */
	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	/**
   * 计算数据哈希值（简单校验）
   */
	private async calculateHash(data: ArrayBuffer): Promise<string> {
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
	}

	/**
   * 从路径中获取文件名
   */
	private getFilenameFromPath(path: string): string {
		return path.split('/').pop() || '';
	}

	/**
   * 创建服务错误
   */
	private createServiceError(message: string, originalError?: any): ServiceError {
		const error = new ServiceError(message);
    
		if (originalError instanceof Error) {
			error.message = `${message}: ${originalError.message}`;
			error.details = originalError;
		}
    
		return error;
	}

	/**
   * 获取错误消息
   */
	private getErrorMessage(error: any): string {
		if (error instanceof Error) {
			return error.message;
		}
		return String(error);
	}
}
