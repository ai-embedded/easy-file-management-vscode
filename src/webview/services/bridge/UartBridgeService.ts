/**
 * UART桥接服务 - Webview层与Extension层的桥梁
 * 通过postMessage与Extension主进程通信
 */

import { BaseBridgeService, OperationControlHooks } from './BaseBridgeService';
import {
	ConnectionConfig,
	FileItem,
	FileOperationResult,
	UploadConfig,
	DownloadConfig
} from '@shared/types';

interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
  vendorId?: string;
  productId?: string;
}

export class UartBridgeService extends BaseBridgeService {
	private dataHandlers = new Set<(data: any) => void>();
	private errorHandlers = new Set<(error: any) => void>();
	private closeHandlers = new Set<() => void>();

	constructor() {
		// 使用'uart'作为请求ID前缀，30秒超时
		super('uart', 30000);
	}

	/**
   * 处理自定义消息 - 重写父类方法处理串口特有消息
   */
	protected handleCustomMessage(message: any): void {
		// 处理串口数据
		if (message.command === 'uart.data') {
			this.dataHandlers.forEach(handler => handler(message.data));
		}
    
		// 处理串口错误
		if (message.command === 'uart.error') {
			this.errorHandlers.forEach(handler => handler(message.error));
		}
    
		// 处理串口关闭
		if (message.command === 'uart.close') {
			this.isConnectedFlag = false;
			this.closeHandlers.forEach(handler => handler());
		}
	}

	/**
   * 列举可用串口
   */
	async listPorts(): Promise<PortInfo[]> {
		const response = await this.sendToBackend('backend.uart.list', {});
    
		if (!response.success) {
			throw new Error(response.error || '列举串口失败');
		}
    
		return response.data || [];
	}

	/**
   * 连接到串口
   */
	async connect(config: ConnectionConfig): Promise<boolean> {
		const response = await this.sendToBackend('backend.uart.connect', {
			path: config.path || config.host, // 兼容使用host字段作为串口路径
			baudRate: config.baudRate || 115200,
			dataBits: config.dataBits || 8,
			stopBits: config.stopBits || 1,
			parity: config.parity || 'none',
			flowControl: config.flowControl || 'none',
			timeout: config.timeout,
			parserType: config.parserType || 'raw',
			delimiter: config.delimiter,
			byteLength: config.byteLength
		});
    
		this.isConnectedFlag = response.success;
		this.config = config;
    
		if (response.success) {
			// 设置数据接收监听
			this.setupDataListener();
		}
    
		return response.success;
	}

	/**
   * 断开连接
   */
	async disconnect(): Promise<void> {
		await this.sendToBackend('backend.uart.disconnect', {});
		this.isConnectedFlag = false;
		this.config = undefined;
	}

	/**
   * 测试连接
   */
	async testConnection(config: ConnectionConfig): Promise<boolean> {
		const response = await this.sendToBackend('backend.uart.testConnection', config);
		return response.success && response.data;
	}

	/**
   * 发送数据
   */
	async write(data: string | Buffer): Promise<void> {
		const response = await this.sendToBackend('backend.uart.write', {
			data: typeof data === 'string' ? data : Array.from(data)
		});
    
		if (!response.success) {
			throw new Error(response.error || '发送数据失败');
		}
	}

	/**
   * 设置控制信号
   */
	async setSignals(signals: { dtr?: boolean; rts?: boolean }): Promise<void> {
		const response = await this.sendToBackend('backend.uart.setSignals', signals);
    
		if (!response.success) {
			throw new Error(response.error || '设置控制信号失败');
		}
	}

	/**
   * 获取控制信号
   */
	async getSignals(): Promise<any> {
		const response = await this.sendToBackend('backend.uart.getSignals', {});
    
		if (!response.success) {
			throw new Error(response.error || '获取控制信号失败');
		}
    
		return response.data;
	}

	/**
   * 刷新缓冲区
   */
	async flush(): Promise<void> {
		const response = await this.sendToBackend('backend.uart.flush', {});
    
		if (!response.success) {
			throw new Error(response.error || '刷新缓冲区失败');
		}
	}

	/**
   * 设置数据监听
   */
	private setupDataListener(): void {
		// 数据监听已在构造函数中设置
		console.log('[UartBridgeService] 数据监听已设置');
	}

	/**
   * 注册数据处理器
   */
	onData(handler: (data: any) => void): void {
		this.dataHandlers.add(handler);
	}

	/**
   * 移除数据处理器
   */
	offData(handler: (data: any) => void): void {
		this.dataHandlers.delete(handler);
	}

	/**
   * 注册错误处理器
   */
	onError(handler: (error: any) => void): void {
		this.errorHandlers.add(handler);
	}

	/**
   * 移除错误处理器
   */
	offError(handler: (error: any) => void): void {
		this.errorHandlers.delete(handler);
	}

	/**
   * 注册关闭处理器
   */
	onClose(handler: () => void): void {
		this.closeHandlers.add(handler);
	}

	/**
   * 移除关闭处理器
   */
	offClose(handler: () => void): void {
		this.closeHandlers.delete(handler);
	}

	// 以下是IConnectionService接口的必需方法（串口不支持文件操作，但需要实现）

	async listFiles(path: string): Promise<FileItem[]> {
		throw new Error('串口连接不支持文件操作');
	}

	async downloadFile(config: DownloadConfig): Promise<Blob> {
		throw new Error('串口连接不支持文件下载');
	}

	async uploadFile(config: UploadConfig, hooks?: OperationControlHooks): Promise<FileOperationResult> {
		void hooks;
		throw new Error('串口连接不支持文件上传');
	}

	async deleteFile(path: string): Promise<FileOperationResult> {
		throw new Error('串口连接不支持文件删除');
	}

	async renameFile(oldPath: string, newPath: string): Promise<FileOperationResult> {
		throw new Error('串口连接不支持文件重命名');
	}

	async createDirectory(path: string): Promise<FileOperationResult> {
		throw new Error('串口连接不支持创建目录');
	}

	async getFileInfo(path: string): Promise<FileItem> {
		throw new Error('串口连接不支持获取文件信息');
	}

}
