/**
 * 类型定义导出
 * 优先使用共享类型，避免重复定义
 */

// 从共享类型导出 - 使用 export type 符合 isolatedModules 要求
export type {
	ConnectionConfig,
	FileItem,
	FileOperationResult,
	UploadConfig,
	DownloadConfig,
	ProgressInfo as FileProgress // 使用别名保持兼容
} from '@shared/types';

// 从共享类型导出枚举 - 枚举需要单独导出
export { NotificationType } from '@shared/types/messages';
export { ConnectionStatus } from '@shared/types/transport';

// 导出错误类型
export { ServiceError, ErrorCode, ErrorFactory } from '@shared/errors/ServiceError';

// 文件操作类型枚举（webview特有）
export enum FileOperationType {
  UPLOAD = 'upload',
  DOWNLOAD = 'download',
  DELETE = 'delete',
  RENAME = 'rename',
  MOVE = 'move',
  CREATE_FOLDER = 'create_folder'
}

// Webview特有的类型
export interface NotificationMessage {
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
}

// 串口设备过滤器
export interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}
