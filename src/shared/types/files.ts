/**
 * 文件系统相关的共享类型定义
 */

/**
 * 文件项接口
 */
export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  lastModified: Date;
  permissions?: string;
  isReadonly?: boolean;
}

/**
 * 文件操作结果接口
 */
export interface FileOperationResult {
  success: boolean;
  message?: string;
  data?: any;
}

/**
 * 文件上传配置接口
 */
export interface UploadConfig {
  file?: File;
  buffer?: Buffer;
  stream?: NodeJS.ReadableStream;  // 支持流式上传
  filename: string;
  fileSize?: number;
  targetPath: string;
  url?: string;  // HTTP上传使用的URL
  filePath?: string;
  fields?: Record<string, any>;
  onProgress?: (progress: ProgressInfo) => void;
  selectedAt?: string;
}

/**
 * 文件下载配置接口
 */
export interface DownloadConfig {
  url?: string;
  filePath?: string;  // 远程文件路径
  filename?: string;
  targetFile?: string;  // 本地目标文件路径（用于直存模式）
  fileSize?: number;
  chunkSize?: number;
  onProgress?: (progress: ProgressInfo) => void;
  shouldAbort?: () => boolean;
  onSession?: (session: { sessionId: string; chunkSize: number; totalChunks: number; fileSize: number }) => void;
}

/**
 * 进度信息接口
 */
export interface ProgressInfo {
  loaded: number;
  total: number;
  percent: number;
  filename?: string;
  transferRate?: number;
}

/**
 * 文件操作进度接口（兼容旧代码）
 */
export interface FileProgress extends ProgressInfo {
  // 保持向后兼容
}
