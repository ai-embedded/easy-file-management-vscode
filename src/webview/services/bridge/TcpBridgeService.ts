/**
 * TCP桥接服务 - Webview层与Extension层的桥梁
 * 通过postMessage与Extension主进程通信
 */

import { GenericBridgeService } from './GenericBridgeService';
import type { OperationControlHooks } from './BaseBridgeService';
import type { StreamUploadOverrides } from './StreamUploadHelper';
import type {
	ConnectionConfig,
	UploadConfig,
	DownloadConfig
} from '../../../shared/types';
import { ConnectionStatus } from '../../types/webview-types';

export class TcpBridgeService extends GenericBridgeService {
	constructor() {
		super('tcp', { requestIdPrefix: 'tcp', defaultTimeoutMs: 60000 });
	}

	/**
   * 连接到TCP服务器
   */
	async connect(config: ConnectionConfig): Promise<boolean> {
		// 发送连接请求，使用Protobuf协议
		this.emitConnectionState(ConnectionStatus.CONNECTING, { source: 'connect-request', config });
		const response = await this.sendToBackend(this.getCommand('connect'), {
			host: config.host,
			port: config.port,
			timeout: config.timeout,
			dataFormat: 'protobuf', // TCP统一使用protobuf格式
			// 协议参数
			clientId: 'easy-file-management-v2.0',
			supportedFormats: ['protobuf'], // 仅支持protobuf
			preferredFormat: 'protobuf', // 强制使用protobuf
			version: '2.0.0'
		});
    
		this.config = config;
    
		// 如果连接成功，记录连接结果
		if (response.success && response.data) {
			const connectionResult = response.data;
			console.log('[TcpBridgeService] 连接成功:', connectionResult);
			this.emitConnectionState(ConnectionStatus.CONNECTED, {
				source: 'connect-response',
				data: connectionResult
			});

			// 记录服务器确认的协议格式
			if (connectionResult.selectedFormat) {
				console.log(`[TcpBridgeService] 使用协议格式: ${connectionResult.selectedFormat}`);
        
				// 记录服务器信息
				if (connectionResult.serverInfo) {
					const serverInfo = connectionResult.serverInfo;
					console.log('[TcpBridgeService] 服务器信息:');
					console.log(`  - 名称: ${serverInfo.name}`);
					console.log(`  - 版本: ${serverInfo.version}`);
					console.log(`  - 协议: ${serverInfo.protocol}`);
					console.log(`  - 支持格式: ${serverInfo.supportedFormats?.join(', ')}`);
					console.log(`  - 根目录: ${serverInfo.rootDir}`);
					if (serverInfo.maxFileSize) {
						console.log(`  - 最大文件大小: ${(serverInfo.maxFileSize / 1024 / 1024).toFixed(1)}MB`);
					}
					if (serverInfo.chunkSize) {
						console.log(`  - 推荐分块大小: ${(serverInfo.chunkSize / 1024).toFixed(1)}KB`);
					}
				}
			}
		} else if (!response.success) {
			console.error('[TcpBridgeService] 连接失败:', response.message || '未知错误');
			this.emitConnectionState(ConnectionStatus.ERROR, {
				source: 'connect-response',
				message: response.message || response.error || '连接失败'
			});
		}
    
		return response.success;
	}

	/**
   * 断开连接
   */
	async disconnect(): Promise<void> {
		await this.sendToBackend(this.getCommand('disconnect'), {});
		this.emitConnectionState(ConnectionStatus.DISCONNECTED, { source: 'manual-disconnect' });
		this.config = undefined;
	}

	/**
   * 测试连接
   */
	async testConnection(config: ConnectionConfig): Promise<boolean> {
		try {
			const response = await this.sendToBackend(this.getCommand('testConnection'), config);
			return response.success && response.data;
		} catch {
			return false;
		}
	}

	/**
   * 获取文件列表
   */
	async listFiles(path: string): Promise<FileItem[]> {
		const response = await this.sendToBackend(this.getCommand('listFiles'), { path });
    
		if (!response.success) {
			throw new Error(response.error || '获取文件列表失败');
		}
    
		// 转换lastModified字段为Date对象
		const files = response.data?.files || [];
		console.log('[TcpBridgeService] 原始文件列表:', files.length, '个文件');
    
		const processedFiles = files.map((file: any) => {
			let lastModified: Date;
      
			// 添加日期验证和错误处理
			if (file.lastModified) {
				const parsedDate = new Date(file.lastModified);
				if (isNaN(parsedDate.getTime())) {
					console.warn(`[TcpBridgeService] 无效的日期值: ${file.lastModified}，使用当前时间`);
					lastModified = new Date();
				} else {
					lastModified = parsedDate;
				}
			} else {
				console.log(`[TcpBridgeService] 文件 ${file.name} 没有lastModified字段，使用当前时间`);
				lastModified = new Date();
			}
      
			console.log(`[TcpBridgeService] 文件 ${file.name}: 原始lastModified=${file.lastModified}, 转换后=${lastModified.toISOString()}`);
      
			return {
				...file,
				lastModified
			};
		});
    
		return processedFiles;
	}

	protected onBeforeStreamUpload(config: UploadConfig, hooks?: OperationControlHooks): void {
		void hooks;
		if (config.file) {
			console.log('[TcpBridgeService] uploadFile invoked', {
				filename: config.file.name,
				size: config.file.size,
				targetPath: config.targetPath,
				timestamp: new Date().toISOString()
			});
		}
	}

	protected getStreamUploadOverrides(config: UploadConfig): StreamUploadOverrides | undefined {
		void config;
		return {
			chunkSize: 2 * 1024 * 1024
		};
	}

	protected resolveDownloadTimeout(config: DownloadConfig & { targetFile: string }): number | undefined {
		const fileSize = config.fileSize ?? 0;
		const sizeInMB = fileSize > 0 ? Math.max(1, Math.ceil(fileSize / (1024 * 1024))) : 0;
		const estimated = sizeInMB > 0 ? sizeInMB * 1_200 : 0;
		return estimated > 0 ? Math.min(900_000, Math.max(120_000, estimated)) : 300_000;
	}

	/**
   * 获取文件信息
   */
	async getFileInfo(path: string): Promise<FileItem> {
		const response = await this.sendToBackend(this.getCommand('getFileInfo'), { path });
    
		if (!response.success) {
			throw new Error(response.error || '获取文件信息失败');
		}
    
		return response.data;
	}

	protected handleCustomMessage(message: any): void {
		if (message.command === 'tcp.connectionState') {
			const mappedState = this.mapConnectionState(message.data?.state);
			if (!mappedState) {
				return;
			}
			this.emitConnectionState(mappedState, message.data);
		}
	}

	private mapConnectionState(rawState?: string): ConnectionStatus | null {
		switch (rawState) {
			case 'connected':
				return ConnectionStatus.CONNECTED;
			case 'connecting':
				return ConnectionStatus.CONNECTING;
			case 'reconnecting':
				return ConnectionStatus.CONNECTING;
			case 'disconnected':
				return ConnectionStatus.DISCONNECTED;
			case 'error':
				return ConnectionStatus.ERROR;
			default:
				return null;
		}
	}

}
