/**
 * 断点续传相关类型定义
 */

/**
 * 上传会话信息
 */
export interface UploadSession {
  /** 会话ID（基于文件内容的hash） */
  sessionId: string;
  
  /** 文件路径 */
  filePath: string;
  
  /** 目标路径 */
  targetPath: string;
  
  /** 文件名 */
  filename: string;
  
  /** 文件大小 */
  fileSize: number;
  
  /** 块大小 */
  chunkSize: number;
  
  /** 总块数 */
  totalChunks: number;
  
  /** 已上传的块索引 */
  uploadedChunks: number[];
  
  /** 文件内容 hash */
  fileHash: string;
  
  /** 创建时间 */
  createdAt: number;
  
  /** 最后更新时间 */
  lastUpdatedAt: number;
  
  /** 过期时间（毫秒） */
  expiresAt: number;
}

/**
 * 断点续传配置
 */
export interface ResumableUploadConfig {
  /** 会话存储路径 */
  sessionStorePath?: string;
  
  /** 会话过期时间（毫秒，默认24小时） */
  sessionExpireTime?: number;
  
  /** 是否启用断点续传（默认 true） */
  enabled?: boolean;
  
  /** 最大重试次数 */
  maxRetries?: number;
  
  /** 重试延迟（毫秒） */
  retryDelay?: number;
  
  /** 是否启用日志 */
  enableLogging?: boolean;
}

/**
 * 块上传状态
 */
export interface ChunkUploadStatus {
  /** 块索引 */
  index: number;
  
  /** 是否已上传 */
  uploaded: boolean;
  
  /** 上传时间 */
  uploadedAt?: number;
  
  /** 块大小 */
  size: number;
  
  /** 块 hash */
  hash?: string;
  
  /** 重试次数 */
  retryCount: number;
}

/**
 * 上传进度信息
 */
export interface ResumableUploadProgress {
  /** 总字节数 */
  totalBytes: number;
  
  /** 已上传字节数 */
  uploadedBytes: number;
  
  /** 进度百分比 */
  percent: number;
  
  /** 总块数 */
  totalChunks: number;
  
  /** 已上传块数 */
  uploadedChunks: number;
  
  /** 剩余块数 */
  remainingChunks: number;
  
  /** 预估剩余时间（毫秒） */
  estimatedTimeRemaining?: number;
  
  /** 上传速度（字节/秒） */
  speed?: number;
}