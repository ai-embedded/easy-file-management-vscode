/**
 * 串口协议编解码器
 * 基于UniversalCodec实现，专门适配串口通信需求
 * 根据串口协议实现可行性分析报告第5.2.2节实现
 */

import { UniversalCodec } from '../../../shared/codec/UniversalCodec';
import {
	SerialCommand,
	SerialDataFormat,
	SerialFrame,
	TcpMessage,
	TcpResponse,
	DeviceCapabilities,
	FileItem,
	SerialNegotiationResult
} from '../../types';

/**
 * 串口协议编解码器
 * 扩展UniversalCodec以支持串口特有的功能和协商机制
 */
export class SerialProtocolCodec extends UniversalCodec {
	private deviceCapabilities: DeviceCapabilities | null = null;
	private negotiatedFormat: 'json' | 'protobuf' = 'json';
	private clientId = 'vscode-serial-client-v1.0';

	constructor() {
		super();
	}

	/**
   * 设置设备能力信息
   * @param capabilities 设备能力
   */
	public setDeviceCapabilities(capabilities: DeviceCapabilities): void {
		this.deviceCapabilities = capabilities;
    
		// 根据设备能力选择最佳格式
		if (capabilities.supportedFormats.includes('protobuf')) {
			this.negotiatedFormat = 'protobuf';
		} else {
			this.negotiatedFormat = 'json';
		}
	}

	/**
   * 获取协商的数据格式
   */
	public getNegotiatedFormat(): 'json' | 'protobuf' {
		return this.negotiatedFormat;
	}

	/**
   * 创建连接协商消息（PING命令用于协商）
   * @param preferredFormat 首选格式
   * @returns 协商消息
   */
	public createNegotiationMessage(preferredFormat: 'json' | 'protobuf' = 'json'): TcpMessage {
		return {
			operation: 'PING',
			clientId: this.clientId,
			supportedFormats: ['json', 'protobuf'],
			preferredFormat,
			timestamp: new Date().toISOString(),
			version: '1.0.0',
			deviceCapabilities: {
				supportedCommands: this.getSupportedCommands(),
				supportedFormats: ['json', 'protobuf'],
				maxFileSize: 10 * 1024 * 1024,  // 10MB
				chunkSize: 8192,                 // 8KB
				concurrentOperations: 1
			}
		};
	}

	/**
   * 处理协商响应
   * @param response 设备响应
   * @returns 协商结果
   */
	public processNegotiationResponse(response: TcpResponse): SerialNegotiationResult {
		let selectedFormat: 'json' | 'protobuf' = 'json';
		let supportedCommands: number[] = [];
		let deviceCapabilities: DeviceCapabilities = {
			supportedCommands: [],
			supportedFormats: ['json']
		};

		// 解析设备响应
		if (response.success && response.selectedFormat) {
			selectedFormat = response.selectedFormat as 'json' | 'protobuf';
		}

		if (response.supportedCommands) {
			supportedCommands = response.supportedCommands;
		}

		if (response.deviceCapabilities) {
			deviceCapabilities = {
				supportedCommands: response.deviceCapabilities.supported_commands || [],
				supportedFormats: response.deviceCapabilities.supported_formats || ['json'],
				maxFileSize: response.deviceCapabilities.max_file_size,
				chunkSize: response.deviceCapabilities.chunk_size,
				concurrentOperations: response.deviceCapabilities.concurrent_operations,
				deviceType: response.deviceCapabilities.device_type,
				firmwareVersion: response.deviceCapabilities.firmware_version
			};
		}

		// 保存协商结果
		this.negotiatedFormat = selectedFormat;
		this.setDeviceCapabilities(deviceCapabilities);

		return {
			selectedFormat,
			supportedCommands,
			deviceCapabilities,
			connectionEstablished: response.success
		};
	}

	/**
   * 编码串口请求消息
   * @param command 命令码
   * @param params 参数
   * @param forceFormat 强制使用的格式
   * @returns 编码结果
   */
	public encodeSerialRequest(
		command: SerialCommand, 
		params: any = {},
		forceFormat?: 'json' | 'protobuf'
	): { format: number, data: Uint8Array } {
		// 创建消息对象
		const message = this.createSerialMessage(command, params);
    
		// 选择格式
		const format = forceFormat || this.negotiatedFormat;
		const operation = this.getCommandName(command);
    
		// 使用父类的智能编码功能
		return this.smartEncode(message, operation, format);
	}

	/**
   * 解码串口响应消息
   * @param buffer 数据缓冲区
   * @param formatCode 格式代码
   * @returns 解码后的响应
   */
	public decodeSerialResponse(buffer: Uint8Array, formatCode: number): TcpResponse {
		return this.autoDecode(buffer, formatCode);
	}

	/**
   * 获取命令名称
   * @param command 命令码
   * @returns 命令名称
   */
	public getCommandName(command: SerialCommand): string {
		const commandNames: Partial<Record<SerialCommand, string>> = {
			[SerialCommand.PING]: 'PING',
			[SerialCommand.PONG]: 'PONG',
			[SerialCommand.CONNECT]: 'CONNECT',
			[SerialCommand.DISCONNECT]: 'DISCONNECT',
			[SerialCommand.LIST_FILES]: 'LIST_FILES',
			[SerialCommand.FILE_INFO]: 'FILE_INFO',
			[SerialCommand.CREATE_DIR]: 'CREATE_DIR',
			[SerialCommand.DELETE_FILE]: 'DELETE_FILE',
			[SerialCommand.RENAME_FILE]: 'RENAME_FILE',
			[SerialCommand.UPLOAD_FILE]: 'UPLOAD_FILE',
			[SerialCommand.DOWNLOAD_FILE]: 'DOWNLOAD_FILE',
			[SerialCommand.UPLOAD_REQ]: 'UPLOAD_REQ',
			[SerialCommand.UPLOAD_DATA]: 'UPLOAD_DATA'
		};
		return commandNames[command] || `UNKNOWN(0x${command.toString(16).toUpperCase()})`;
	}

	/**
   * 创建串口消息
   * @param command 命令码
   * @param params 参数
   * @returns 串口消息
   */
	private createSerialMessage(command: SerialCommand, params: any = {}): TcpMessage {
		const operationName = this.getSerialCommandName(command);
    
		const baseMessage: TcpMessage = {
			operation: operationName,
			clientId: this.clientId,
			timestamp: new Date().toISOString(),
			...params
		};

		// 根据命令类型添加特定字段
		switch (command) {
			case SerialCommand.LIST_FILES:
				return {
					...baseMessage,
					path: params.path || '/',
					options: {
						recursive: params.recursive || false,
						filter: params.filter,
						showHidden: params.showHidden || false
					}
				};

			case SerialCommand.UPLOAD_FILE:
				return {
					...baseMessage,
					path: params.path,
					name: params.name || params.filename,
					data: params.data,
					// 分块传输支持
					isChunk: params.isChunk || false,
					chunkIndex: params.chunkIndex || 0,
					totalChunks: params.totalChunks || 1,
					chunkHash: params.chunkHash
				};

			case SerialCommand.DOWNLOAD_FILE:
				return {
					...baseMessage,
					path: params.path,
					name: params.name || params.filename,
					// 分块传输支持
					isChunk: params.isChunk || false,
					chunkIndex: params.chunkIndex || 0,
					totalChunks: params.totalChunks || 1
				};

			case SerialCommand.DELETE_FILE:
				return {
					...baseMessage,
					path: params.path
				};

			case SerialCommand.RENAME_FILE:
				return {
					...baseMessage,
					path: params.path,
					newName: params.newName
				};

			case SerialCommand.CREATE_DIR:
				return {
					...baseMessage,
					path: params.path,
					name: params.name
				};

			case SerialCommand.PING:
				return {
					...baseMessage,
					supportedFormats: ['json', 'protobuf'],
					preferredFormat: this.negotiatedFormat,
					deviceCapabilities: {
						supportedCommands: this.getSupportedCommands(),
						supportedFormats: ['json', 'protobuf'],
						maxFileSize: 10 * 1024 * 1024,
						chunkSize: 8192,
						concurrentOperations: 1
					}
				};

			default:
				return baseMessage;
		}
	}

	/**
   * 获取串口命令名称
   * @param command 命令码
   * @returns 命令名称
   */
	public getSerialCommandName(command: SerialCommand): string {
		const commandNames: Record<SerialCommand, string> = {
			[SerialCommand.PING]: 'PING',
			[SerialCommand.PONG]: 'PONG',
			[SerialCommand.CONNECT]: 'CONNECT',
			[SerialCommand.DISCONNECT]: 'DISCONNECT',
			[SerialCommand.LIST_FILES]: 'LIST_FILES',
			[SerialCommand.FILE_INFO]: 'FILE_INFO',
			[SerialCommand.CREATE_DIR]: 'CREATE_DIR',
			[SerialCommand.DELETE_FILE]: 'DELETE_FILE',
			[SerialCommand.RENAME_FILE]: 'RENAME_FILE',
			[SerialCommand.UPLOAD_FILE]: 'UPLOAD_FILE',
			[SerialCommand.DOWNLOAD_FILE]: 'DOWNLOAD_FILE',
			[SerialCommand.UPLOAD_REQ]: 'UPLOAD_REQ',
			[SerialCommand.UPLOAD_DATA]: 'UPLOAD_DATA',
			[SerialCommand.UPLOAD_END]: 'UPLOAD_END',
			[SerialCommand.DOWNLOAD_REQ]: 'DOWNLOAD_REQ',
			[SerialCommand.DOWNLOAD_DATA]: 'DOWNLOAD_DATA',
			[SerialCommand.DOWNLOAD_END]: 'DOWNLOAD_END',
			[SerialCommand.SUCCESS]: 'SUCCESS',
			[SerialCommand.ERROR]: 'ERROR',
			[SerialCommand.PROGRESS]: 'PROGRESS'
		};

		return commandNames[command] || `UNKNOWN(0x${command.toString(16).padStart(2, '0')})`;
	}

	/**
   * 获取支持的命令码列表（客户端支持的命令）
   */
	private getSupportedCommands(): number[] {
		return [
			SerialCommand.PING,
			SerialCommand.LIST_FILES,
			SerialCommand.FILE_INFO,
			SerialCommand.CREATE_DIR,
			SerialCommand.DELETE_FILE,
			SerialCommand.RENAME_FILE,
			SerialCommand.UPLOAD_FILE,
			SerialCommand.DOWNLOAD_FILE,
			SerialCommand.UPLOAD_REQ,
			SerialCommand.UPLOAD_DATA,
			SerialCommand.UPLOAD_END,
			SerialCommand.DOWNLOAD_REQ,
			SerialCommand.DOWNLOAD_DATA,
			SerialCommand.DOWNLOAD_END
		];
	}

	/**
   * 检查设备是否支持指定命令
   * @param command 命令码
   * @returns 是否支持
   */
	public isCommandSupported(command: SerialCommand): boolean {
		if (!this.deviceCapabilities) {
			// 如果没有设备能力信息，假设支持基本命令
			const basicCommands = [
				SerialCommand.PING,
				SerialCommand.LIST_FILES,
				SerialCommand.UPLOAD_FILE,
				SerialCommand.DOWNLOAD_FILE,
				SerialCommand.DELETE_FILE,
				SerialCommand.CREATE_DIR
			];
			return basicCommands.includes(command);
		}

		return this.deviceCapabilities.supportedCommands.includes(command);
	}

	/**
   * 选择最优的传输方式（简单传输 vs 分块传输）
   * @param dataSize 数据大小
   * @returns 传输方式建议
   */
	public selectTransferMode(dataSize: number): {
    useChunking: boolean;
    chunkSize: number;
    reason: string;
  } {
		const maxSimpleTransferSize = 8192; // 8KB
		const defaultChunkSize = this.deviceCapabilities?.chunkSize || 4096;

		if (dataSize <= maxSimpleTransferSize) {
			return {
				useChunking: false,
				chunkSize: 0,
				reason: `文件大小 ${dataSize} 字节，使用简单传输`
			};
		} else {
			return {
				useChunking: true,
				chunkSize: defaultChunkSize,
				reason: `文件大小 ${dataSize} 字节，使用分块传输（块大小: ${defaultChunkSize}）`
			};
		}
	}

	/**
   * 创建文件信息对象（从响应数据转换）
   * @param fileData 文件数据
   * @returns 标准文件项
   */
	public createFileItem(fileData: any): FileItem {
		return {
			name: fileData.name || '',
			path: fileData.path || '',
			type: fileData.type === 'directory' ? 'directory' : 'file',
			size: fileData.size || 0,
			lastModified: fileData.lastModified ? new Date(fileData.lastModified) : new Date(),
			permissions: fileData.permissions,
			isReadonly: fileData.isReadonly || false
		};
	}

	/**
   * 创建错误响应
   * @param message 错误信息
   * @param code 错误代码
   * @returns 错误响应
   */
	public createErrorResponse(message: string, code?: string): TcpResponse {
		return {
			success: false,
			message,
			status: code || 'ERROR',
			processTimeMs: 0
		};
	}

	/**
   * 验证设备协商结果
   * @param result 协商结果
   * @returns 验证结果
   */
	public validateNegotiationResult(result: SerialNegotiationResult): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
		const errors: string[] = [];
		const warnings: string[] = [];

		// 检查连接是否建立
		if (!result.connectionEstablished) {
			errors.push('设备连接协商失败');
		}

		// 检查必需的命令支持
		const requiredCommands = [
			SerialCommand.PING,
			SerialCommand.LIST_FILES,
			SerialCommand.UPLOAD_FILE,
			SerialCommand.DOWNLOAD_FILE
		];

		for (const cmd of requiredCommands) {
			if (!result.supportedCommands.includes(cmd)) {
				errors.push(`设备不支持必需命令: ${this.getSerialCommandName(cmd)}`);
			}
		}

		// 检查数据格式支持
		if (!result.deviceCapabilities.supportedFormats.includes(result.selectedFormat)) {
			errors.push(`设备不支持选定的数据格式: ${result.selectedFormat}`);
		}

		// 检查文件大小限制
		if (result.deviceCapabilities.maxFileSize && result.deviceCapabilities.maxFileSize < 1024) {
			warnings.push(`设备最大文件大小限制较低: ${result.deviceCapabilities.maxFileSize} 字节`);
		}

		// 检查分块大小
		if (result.deviceCapabilities.chunkSize && result.deviceCapabilities.chunkSize < 1024) {
			warnings.push(`设备分块大小较小: ${result.deviceCapabilities.chunkSize} 字节，可能影响传输效率`);
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings
		};
	}

	/**
   * 获取设备信息摘要
   * @returns 设备信息字符串
   */
	public getDeviceSummary(): string {
		if (!this.deviceCapabilities) {
			return '设备能力信息未知';
		}

		const cap = this.deviceCapabilities;
		return [
			`格式: ${this.negotiatedFormat}`,
			`命令: ${cap.supportedCommands.length}个`,
			`最大文件: ${cap.maxFileSize ? this.formatBytes(cap.maxFileSize) : '未知'}`,
			`分块大小: ${cap.chunkSize ? this.formatBytes(cap.chunkSize) : '未知'}`,
			`设备类型: ${cap.deviceType || '未知'}`
		].join(', ');
	}

	/**
   * 格式化字节数
   * @param bytes 字节数
   * @returns 格式化的字符串
   */
	private formatBytes(bytes: number): string {
		if (bytes === 0) {return '0 B';}
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))  } ${  sizes[i]}`;
	}
}