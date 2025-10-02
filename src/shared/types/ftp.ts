/**
 * FTP 优化功能的 TypeScript 类型定义
 * 统一管理所有 FTP 相关的接口、类型和常量
 */

// 重新导出现有类型以保持兼容
export { FtpConfig, UploadConfig, DownloadConfig, FileOperationResult, FileItem } from './index';

// FTP 传输模式
export type FtpTransferMode = 'passive' | 'active';

// 优化层级
export type OptimizationLayer = 'standard' | 'extended' | 'advanced';

// FTP 配置预设
export type FtpConfigPreset = 'conservative' | 'balanced' | 'aggressive' | 'custom';

/**
 * FTP 服务器能力接口
 */
export interface FtpServerCapabilities {
  // 基础能力
  supportsPASV: boolean;      // 被动模式
  supportsEPSV: boolean;      // 扩展被动模式
  supportsREST: boolean;      // 断点续传
  supportsSIZE: boolean;      // 获取文件大小
  supportsMDTM: boolean;      // 获取修改时间
  
  // 扩展能力
  supportsModeZ: boolean;    // 压缩传输
  supportsMLSD: boolean;      // 机器可读目录列表
  supportsSITE: boolean;      // 扩展命令
  supportsUTF8: boolean;      // UTF8 编码支持
  supportsAPPE: boolean;      // 文件追加
  
  // 性能特征
  maxConnections: number;     // 最大连接数
  transferBufferSize: number; // 建议传输缓冲区大小
  commandResponseTime: number; // 平均命令响应时间
  
  // 服务器信息
  serverSoftware: string;     // 服务器软件信息
  serverFeatures: string[];   // 支持的特性列表
  protocolVersion: string;    // FTP 协议版本
  
  // 检测元数据
  detectionTime: number;      // 检测时间戳
  detectionReliability: number; // 检测可靠度 (0-1)
}

/**
 * 网络配置文件
 */
export interface NetworkProfile {
  behindNAT: boolean;
  hasPublicIP: boolean;
  canBindPort: boolean;
  preferredMode: FtpTransferMode;
  confidence: number; // 0-1 的信心度
}

/**
 * 传输策略
 */
export interface TransferStrategy {
  layer: OptimizationLayer;
  method: string;
  reason: string;
}

/**
 * 网络中断记录
 */
export interface NetworkInterruption {
  detectedAt: number;
  recoveredAt?: number;
  reason: 'timeout' | 'connection_lost' | 'server_error' | 'network_error';
  duration?: number;
}

/**
 * 断点续传状态
 */
export interface ResumableTransferState {
  filePath: string;
  totalSize: number;
  transferredSize: number;
  lastModified: number;
  checksum?: string;
}

/**
 * 压缩统计信息
 */
export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  compressionTime: number;
  transferTime: number;
}

/**
 * FTP 客户端统计信息
 */
export interface CompatibleFtpClientStats {
  connectionTime: number;
  totalTransfers: number;
  optimizationLayerUsage: Record<OptimizationLayer, number>;
  averageTransferSpeed: number;
  errorRate: number;
  serverCapabilities?: FtpServerCapabilities;
}

/**
 * 优化统计信息
 */
export interface OptimizationStats {
  connectionsReused: number;
  connectionsCached: number;
  transfersOptimized: number;
  bytesTransferred: number;
  averageSpeed: number;
  retryCount: number;
}

/**
 * 扩展优化统计信息
 */
export interface ExtendedOptimizationStats extends OptimizationStats {
  resumableTransfers: number;
  compressionStats: CompressionStats[];
  averageCompressionRatio: number;
  activeTransfers: number;
}

/**
 * 连接池配置
 */
export interface ConnectionPoolConfig {
  maxConnections?: number;
  maxIdleTime?: number;
  connectionTimeout?: number;
  enableLogging?: boolean;
}

/**
 * 传输模式选择器配置
 */
export interface TransferModeConfig {
  forceMode?: FtpTransferMode;
  enableNetworkDetection?: boolean;
  enablePortTest?: boolean;
  testTimeout?: number;
  cacheResults?: boolean;
  enableLogging?: boolean;
}

/**
 * 强壮传输管理器配置
 */
export interface RobustTransferConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  networkRecoveryTimeout: number;
  connectionValidationTimeout: number;
  enableNetworkRecoveryDetection: boolean;
  enableProgressiveRetry: boolean;
  enableLogging: boolean;
}

/**
 * 能力检测器配置
 */
export interface DetectionConfig {
  testTimeout: number;
  enablePerformanceTests: boolean;
  enableExtensiveTests: boolean;
  maxConnectionTest: number;
  cacheResults: boolean;
  enableLogging: boolean;
}

/**
 * 标准优化配置
 */
export interface StandardOptimizationConfig {
  connectionReuse: boolean;
  streamProcessing: boolean;
  localCache: boolean;
  clientCompression: boolean;
  intelligentRetry: boolean;
  transferModeOptimization: boolean;
  bufferSize: number;
  maxMemoryUsage: number;
  enableLogging: boolean;
}

/**
 * 扩展优化配置
 */
export interface ExtendedOptimizationConfig extends StandardOptimizationConfig {
  resumableTransfer: boolean | 'auto';
  compressionTransfer: boolean | 'auto';  
  multiConnection: boolean | 'auto';
  enhancedListing: boolean | 'auto';
  maxConcurrentTransfers: number;
  chunkSize: number;
  compressionLevel: number;
  autoCapabilityDetection: boolean;
}

/**
 * 重试策略
 */
export interface RetryStrategy {
  type: 'exponential' | 'linear' | 'fixed' | 'progressive';
  delayMs: number;
  shouldRetry: boolean;
  reason: string;
}

/**
 * 能力测试定义
 */
export interface CapabilityTest {
  command: string;
  expectedCodes?: number[];
  timeout?: number;
  critical?: boolean;
  description: string;
}

/**
 * 配置验证结果
 */
export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  recommendations: string[];
}

/**
 * 网络推荐结果
 */
export interface NetworkRecommendation {
  recommendedMode: FtpTransferMode;
  reason: string;
  confidence: number;
}

/**
 * 网络状况统计
 */
export interface NetworkStats {
  totalInterruptions: number;
  averageRecoveryTime: number;
  lastInterruption?: NetworkInterruption;
  networkHealth: 'good' | 'fair' | 'poor';
}

/**
 * 连接池统计
 */
export interface ConnectionPoolStats {
  [key: string]: {
    total: number;
    inUse: number;
    idle: number;
  };
}

/**
 * 缓存统计
 */
export interface CacheStats {
  entries: number;
  hitRate: number;
  oldestEntry: number;
}

/**
 * 错误类型常量
 */
export const ftpErrorTypes = {
	connectionFailed: 'CONNECTION_FAILED',
	authenticationFailed: 'AUTHENTICATION_FAILED',
	networkTimeout: 'NETWORK_TIMEOUT',
	transferInterrupted: 'TRANSFER_INTERRUPTED',
	permissionDenied: 'PERMISSION_DENIED',
	fileNotFound: 'FILE_NOT_FOUND',
	insufficientStorage: 'INSUFFICIENT_STORAGE',
	protocolError: 'PROTOCOL_ERROR',
	unknownError: 'UNKNOWN_ERROR'
} as const;

export type FtpErrorType = typeof ftpErrorTypes[keyof typeof ftpErrorTypes];

/**
 * FTP 命令常量
 */
export const ftpCommands = {
	// 基础命令
	user: 'USER',
	pass: 'PASS',
	quit: 'QUIT',
	noop: 'NOOP',
	syst: 'SYST',
  
	// 传输模式
	pasv: 'PASV',
	epsv: 'EPSV',
	port: 'PORT',
	eprt: 'EPRT',
  
	// 文件操作
	list: 'LIST',
	nlst: 'NLST',
	mlsd: 'MLSD',
	retr: 'RETR',
	stor: 'STOR',
	appe: 'APPE',
	dele: 'DELE',
	rnfr: 'RNFR',
	rnto: 'RNTO',
  
	// 文件信息
	size: 'SIZE',
	mdtm: 'MDTM',
  
	// 扩展功能
	rest: 'REST',
	mode: 'MODE',
	feat: 'FEAT',
	site: 'SITE',
	opts: 'OPTS'
} as const;

export type FtpCommand = typeof ftpCommands[keyof typeof ftpCommands];

/**
 * 优化层级常量
 */
export const optimizationLayers = {
	standard: 'standard' as const,
	extended: 'extended' as const,
	advanced: 'advanced' as const
};

/**
 * 传输模式常量
 */
export const transferModes = {
	passive: 'passive' as const,
	active: 'active' as const
};

/**
 * 配置预设常量
 */
export const configPresets = {
	conservative: 'conservative' as const,
	balanced: 'balanced' as const,
	aggressive: 'aggressive' as const,
	custom: 'custom' as const
};

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 文件类型判断辅助函数类型
 */
export type FileTypePredicate = (filename: string, size?: number) => boolean;

/**
 * 进度回调函数类型
 */
export interface ProgressCallback {
  (progress: {
    total: number;
    loaded: number;
    percent: number;
    filename: string;
    transferRate?: number;
  }): void;
}

/**
 * 事件监听器类型
 */
export interface FtpEventListener {
  onConnectionStart?: () => void;
  onConnectionComplete?: (success: boolean) => void;
  onTransferStart?: (filename: string, size: number) => void;
  onTransferProgress?: ProgressCallback;
  onTransferComplete?: (filename: string, success: boolean) => void;
  onNetworkInterruption?: (interruption: NetworkInterruption) => void;
  onNetworkRecovery?: (duration: number) => void;
  onOptimizationApplied?: (layer: OptimizationLayer, method: string) => void;
  onError?: (error: Error, context: string) => void;
}

/**
 * FTP 客户端状态
 */
export type FtpClientState = 'disconnected' | 'connecting' | 'connected' | 'transferring' | 'error';

/**
 * 优化状态
 */
export interface OptimizationState {
  currentLayer: OptimizationLayer;
  activeOptimizations: string[];
  lastOptimizationTime: number;
  optimizationHistory: Array<{
    timestamp: number;
    layer: OptimizationLayer;
    method: string;
    success: boolean;
  }>;
}
