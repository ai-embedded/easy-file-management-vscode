import { 
	ConnectionConfig, 
	FileItem, 
	FileOperationResult, 
	UploadConfig, 
	DownloadConfig 
} from '../../types';
import { ConnectionStatus } from '../../types/webview-types';
import type { OperationControlHooks } from '../bridge/BaseBridgeService';

/**
 * 连接服务抽象接口
 * 定义了所有连接类型（HTTP、USB、串口）的通用方法
 */
export abstract class IConnectionService {
	protected config?: ConnectionConfig;
	protected isConnectedFlag = false;
	private connectionStateListeners: Set<(state: ConnectionStatus, payload?: any) => void> = new Set();
	protected connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;

  /**
   * 连接到远程服务器/设备
   * @param config 连接配置
   * @returns Promise<boolean> 连接是否成功
   */
  abstract connect(config: ConnectionConfig): Promise<boolean>;

  /**
   * 断开连接
   * @returns Promise<void>
   */
  abstract disconnect(): Promise<void>;

  /**
   * 检查连接状态
   * @returns boolean 是否已连接
   */
  isConnected(): boolean {
  	return this.isConnectedFlag;
  }

  /**
   * 订阅连接状态变化
   */
  onConnectionStateChange(listener: (state: ConnectionStatus, payload?: any) => void): () => void {
  	this.connectionStateListeners.add(listener);
  	return () => {
  		this.connectionStateListeners.delete(listener);
  	};
  }

  /**
   * 子类调用以广播连接状态
   */
  protected emitConnectionState(state: ConnectionStatus, payload?: any): void {
  	this.connectionStatus = state;
  	if (state === ConnectionStatus.CONNECTED) {
  		this.isConnectedFlag = true;
  	} else if (state === ConnectionStatus.DISCONNECTED || state === ConnectionStatus.ERROR) {
  		this.isConnectedFlag = false;
  	}

  	this.connectionStateListeners.forEach(listener => {
  		try {
  			listener(state, payload);
  		} catch (error) {
  			console.error('[IConnectionService] 连接状态监听器执行异常:', error);
  		}
  	});
  }

  /**
   * 获取当前连接配置
   * @returns ConnectionConfig | undefined
   */
  getConfig(): ConnectionConfig | undefined {
  	return this.config;
  }

  /**
   * 获取指定路径下的文件列表
   * @param path 文件路径
   * @returns Promise<FileItem[]> 文件列表
   */
  abstract listFiles(path: string): Promise<FileItem[]>;

  /**
   * 下载文件
   * @param config 下载配置
   * @returns Promise<Blob> 文件数据
  */
  abstract downloadFile(config: DownloadConfig): Promise<Blob>;

  /**
   * 上传文件
   * @param config 上传配置
   * @returns Promise<FileOperationResult> 上传结果
   */
  abstract uploadFile(config: UploadConfig, hooks?: OperationControlHooks): Promise<FileOperationResult>;

  /**
   * 删除文件或目录
   * @param path 文件路径
   * @returns Promise<FileOperationResult> 删除结果
   */
  abstract deleteFile(path: string): Promise<FileOperationResult>;

  /**
   * 重命名文件或目录
   * @param oldPath 原路径
   * @param newPath 新路径
   * @returns Promise<FileOperationResult> 重命名结果
   */
  abstract renameFile(oldPath: string, newPath: string): Promise<FileOperationResult>;

  /**
   * 创建目录
   * @param path 目录路径
   * @returns Promise<FileOperationResult> 创建结果
   */
  abstract createDirectory(path: string): Promise<FileOperationResult>;

  /**
   * 将文件直接下载到指定路径
   * @param config 下载配置，必须包含目标路径
   * @param hooks 操作控制钩子
   */
  abstract downloadFileToPath(
    config: DownloadConfig & { targetFile: string },
    hooks?: OperationControlHooks
  ): Promise<FileOperationResult>;

  /**
   * 获取文件信息
   * @param path 文件路径
   * @returns Promise<FileItem> 文件信息
   */
  abstract getFileInfo(path: string): Promise<FileItem>;

  /**
   * 测试连接
   * @param config 连接配置
   * @returns Promise<boolean> 连接测试结果
   */
  abstract testConnection(config: ConnectionConfig): Promise<boolean>;
}
