// 连接配置接口
export interface ConnectionConfig {
  type: 'http' | 'usb' | 'serial' | 'ftp' | 'tcp' | 'uart';
  host: string;
  port: number;
  timeout?: number;
  headers?: Record<string, string>;
  // HTTP 特有配置
  protocol?: 'http' | 'https'; // HTTP协议，默认http
  // FTP 特有配置
  username?: string;
  password?: string;
  passive?: boolean; // 是否使用被动模式，默认true
  // TCP 特有配置
  dataFormat?: 'protobuf'; // TCP协议数据格式，统一使用protobuf
  // 串口/UART 特有配置
  path?: string; // 串口路径，如 /dev/ttyUSB0 或 COM3
  baudRate?: number; // 波特率，默认115200
  dataBits?: number; // 数据位，默认8
  stopBits?: number; // 停止位，默认1
  parity?: 'none' | 'even' | 'odd'; // 奇偶校验，默认none
  flowControl?: 'none' | 'hardware' | 'software'; // 流控制，默认none
  parserType?: 'raw' | 'readline' | 'bytelength' | 'delimiter'; // 解析器类型
  delimiter?: string; // 分隔符
  byteLength?: number; // 字节长度
  deviceFilters?: SerialPortFilter[]; // 设备过滤器
}

// 文件项接口
export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  lastModified: Date;
  permissions?: string;
  isReadonly?: boolean;
}

// 文件操作进度接口
export interface FileProgress {
  total: number;
  loaded: number;
  percent: number;
  filename: string;
}

// 连接状态枚举
export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}

// 文件操作类型
export enum FileOperationType {
  UPLOAD = 'upload',
  DOWNLOAD = 'download',
  DELETE = 'delete',
  RENAME = 'rename',
  MOVE = 'move',
  CREATE_FOLDER = 'create_folder'
}

// 文件操作结果
export interface FileOperationResult {
  success: boolean;
  message?: string;
  data?: any;
}

// 上传文件配置
export interface UploadConfig {
  file: File;
  targetPath: string;
  onProgress?: (progress: FileProgress) => void;
  selectedAt?: string;
}

// 下载配置
export interface DownloadConfig {
  filePath: string;
  filename?: string;
  onProgress?: (progress: FileProgress) => void;
}

// 通知类型
export enum NotificationType {
  SUCCESS = 'success',
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info'
}

// 通知消息接口
export interface NotificationMessage {
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
}

// VSCode webview消息接口
export interface VSCodeMessage {
  command: string;
  data?: any;
}

// 应用状态接口
export interface AppState {
  connectionStatus: ConnectionStatus;
  currentConnection?: ConnectionConfig;
  currentPath: string;
  fileList: FileItem[];
  loading: boolean;
  error?: string;
}

// 服务错误类
export class ServiceError extends Error {
	code?: string;
	statusCode?: number;
	details?: any;

	constructor(message: string, code?: string, statusCode?: number, details?: any) {
		super(message);
		this.name = 'ServiceError';
		this.code = code;
		this.statusCode = statusCode;
		this.details = details;
	}
}

// FTP 命令枚举
export enum FtpCommand {
  USER = 'USER',
  PASS = 'PASS',
  QUIT = 'QUIT',
  NOOP = 'NOOP',
  PASV = 'PASV',
  LIST = 'LIST',
  RETR = 'RETR',
  STOR = 'STOR',
  DELE = 'DELE',
  MKD = 'MKD',
  RMD = 'RMD',
  RNFR = 'RNFR',
  RNTO = 'RNTO',
  SIZE = 'SIZE',
  MDTM = 'MDTM',
  PWD = 'PWD',
  CWD = 'CWD',
  TYPE = 'TYPE'
}

// FTP 状态枚举
export enum FtpState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  WAIT_USER = 'WAIT_USER',
  WAIT_PASS = 'WAIT_PASS',
  LOGGED_IN = 'LOGGED_IN',
  WAIT_RENAME = 'WAIT_RENAME',
  DATA_TRANSFER = 'DATA_TRANSFER',
  CLOSING = 'CLOSING'
}

// FTP 响应码类型
export interface FtpResponse {
  code: number;
  message: string;
  multiline?: boolean;
}

// FTP 数据连接配置
export interface FtpDataConnection {
  host: string;
  port: number;
  socket?: any; // 具体的socket类型
}

// Web Serial API 类型定义
declare global {
  interface Navigator {
    serial?: {
      requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPort>;
      getPorts(): Promise<SerialPort[]>;
      addEventListener(type: 'connect', listener: (event: any) => void): void;
      removeEventListener(type: 'connect', listener: (event: any) => void): void;
      addEventListener(type: 'disconnect', listener: (event: any) => void): void;
      removeEventListener(type: 'disconnect', listener: (event: any) => void): void;
    };
  }
}

declare global {
  class SerialPort {
  	open(options: {
      baudRate: number;
      dataBits?: number;
      stopBits?: number;
      parity?: 'none' | 'even' | 'odd';
      flowControl?: 'none' | 'hardware';
    }): Promise<void>;
  	close(): Promise<void>;
  	readable: ReadableStream<Uint8Array> | null;
  	writable: WritableStream<Uint8Array> | null;
  	getInfo(): SerialPortInfo;
  }
}

// VSCode webview 环境全局类型声明
declare global {
  interface Window {
    vscode?: {
      postMessage: (message: any) => void;
      getState: () => any;
      setState: (state: any) => void;
    };
    '__VUE_APP__'?: any;
    acquireVsCodeApi?: () => {
      postMessage: (message: any) => void;
      getState: () => any;
      setState: (state: any) => void;
    };
  }

  // 重新声明 acquireVsCodeApi 函数
  function acquireVsCodeApi(): {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
  };
}

// 导入统一的 TCP 命令定义
import { TcpCommand } from '@shared/constants/TcpCommands';

// TCP 响应状态枚举（分离响应状态和命令码）
export enum TcpResponseStatus {
  SUCCESS = 0x80,
  ERROR = 0x81,
  PROGRESS = 0x82
}

// TCP 下载相关命令（缺失的命令，需要添加到 shared 中）
export enum TcpDownloadCommand {
  DOWNLOAD_REQ = 0x33,
  DOWNLOAD_DATA = 0x34,
  DOWNLOAD_END = 0x35
}

// TCP 消息格式定义
export interface TcpMessage {
  operation: string;
  path?: string;
  name?: string;
  data?: ArrayBuffer | Uint8Array | Buffer | string; // 支持 Node.js Buffer 类型
  newName?: string;
  options?: Record<string, any>;
  
  // 分块传输支持
  isChunk?: boolean;
  chunkIndex?: number;
  totalChunks?: number;
  chunkHash?: string;
  
  // 连接信息
  clientId?: string;
  version?: string;
  supportedFormats?: string[];
  preferredFormat?: string;
  timestamp?: string;
  
  // 设备协商信息
  deviceCapabilities?: DeviceCapabilities;
}

// TCP 响应格式定义
export interface TcpResponse {
  success: boolean;
  message?: string;
  files?: FileItem[];
  data?: Uint8Array | Buffer | ArrayBuffer | string; // 🔧 修复：统一数据类型，优先 Uint8Array|Buffer
  
  // 分块传输支持
  isChunk?: boolean;
  chunkIndex?: number;
  totalChunks?: number;
  chunkHash?: string;
  
  // 性能统计
  processTimeMs?: number;
  fileSize?: number;
  
  // 进度信息
  progressPercent?: number;
  status?: string;
  
  // 协议协商信息
  selectedFormat?: string;
  supportedCommands?: number[];
  deviceCapabilities?: Record<string, any>;
}

// 统一协议帧格式定义（TCP与串口协议完全一致）
export interface TcpFrame {
  magic: number;        // 帧头/魔数 0xAA55（与串口协议统一）
  version: number;      // 协议版本
  command: number;      // 统一命令码 0x01-0x82
  format: number;       // 数据格式 0x02=Protobuf（统一协议）
  sequenceNumber: number; // 序列号（支持异步请求响应匹配）
  dataLength: number;   // 数据长度
  data: ArrayBuffer;    // 数据体
  checksum: number;     // CRC8校验和
  trailer: number;      // 帧尾 0x55AA（提高解析可靠性）
  reserved?: number;    // 保留字段（向后兼容）
}

// TCP 连接状态
export enum TcpConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  AUTHENTICATING = 'authenticating',
  ERROR = 'error'
}

// ====== 串口协议相关类型定义 ======

// 串口设备过滤器（Web Serial API）
export interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: number;
}

// 串口连接配置
export interface SerialConnectionOptions {
  baudRate: number;        // 波特率 (默认115200)
  dataBits: number;        // 数据位 (默认8)
  stopBits: number;        // 停止位 (默认1)
  parity: 'none' | 'even' | 'odd';  // 奇偶校验 (默认none)
  flowControl: 'none' | 'hardware'; // 流控制 (默认none)
  bufferSize?: number;     // 缓冲区大小
  requestTimeout?: number; // 请求超时时间 (默认30秒)
}

// 串口设备信息
export interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: number;
  displayName?: string;
  locationId?: string;
  manufacturer?: string;
  product?: string;
  serialNumber?: string;
}

// 串口连接状态
export enum SerialConnectionState {
  DISCONNECTED = 'disconnected',
  REQUESTING = 'requesting',     // 请求用户选择设备
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}

// 统一命令码定义（与TCP协议完全一致）
export enum SerialCommand {
  // 0x01-0x0F: 系统控制类
  PING = 0x01,              // 心跳检测 (串口必须)
  PONG = 0x02,              // 心跳响应 (串口可选)
  CONNECT = 0x03,           // 建立连接 (串口保留不实现)
  DISCONNECT = 0x04,        // 断开连接 (串口保留不实现)
  
  // 0x10-0x1F: 文件基本操作
  LIST_FILES = 0x10,        // 获取文件列表 (串口必须)
  FILE_INFO = 0x11,         // 获取文件信息 (串口可选)
  CREATE_DIR = 0x12,        // 创建目录 (串口必须)
  DELETE_FILE = 0x13,       // 删除文件 (串口必须)
  RENAME_FILE = 0x14,       // 重命名文件 (串口必须)
  
  // 0x20-0x2F: 简单文件传输 (串口主要使用)
  UPLOAD_FILE = 0x20,       // 简单上传 (整个文件一次传输)
  DOWNLOAD_FILE = 0x21,     // 简单下载 (整个文件一次传输)
  
  // 0x30-0x3F: 分块文件传输 (串口可选)
  UPLOAD_REQ = 0x30,        // 分块上传请求
  UPLOAD_DATA = 0x31,       // 上传数据块
  UPLOAD_END = 0x32,        // 上传结束
  DOWNLOAD_REQ = 0x33,      // 分块下载请求
  DOWNLOAD_DATA = 0x34,     // 下载数据块
  DOWNLOAD_END = 0x35,      // 下载结束
  
  // 0x80-0x8F: 响应状态类
  SUCCESS = 0x80,           // 操作成功
  ERROR = 0x81,             // 操作错误
  PROGRESS = 0x82           // 进度信息
}

// 统一协议帧格式（与TCP协议完全一致）
export interface SerialFrame {
  magic: number;            // 帧头/魔数 0xAA55
  dataLength: number;       // 数据长度 (2字节，小端序)
  sequenceNumber: number;   // 序列号 (2字节，小端序)
  command: number;          // 命令码 (1字节)
  format: number;           // 数据格式 (1字节) 0x02=Protobuf（统一协议）
  data: ArrayBuffer;        // 数据体
  checksum: number;         // CRC8校验和 (1字节)
  trailer: number;          // 帧尾 0x55AA
}

// 串口消息队列项
export interface SerialMessageQueueItem {
  sequenceNumber: number;
  resolve: (response: any) => void;
  reject: (error: Error) => void;
  timestamp: number;
  timeout?: NodeJS.Timeout;
}

// 串口数据格式枚举
export enum SerialDataFormat {
  JSON = 0x01,
  PROTOBUF = 0x02,
  AUTO = 0x03
}

// 设备能力信息
export interface DeviceCapabilities {
  supportedCommands: number[];        // 支持的命令码列表
  supportedFormats: string[];         // 支持的数据格式 ['protobuf']（统一协议）
  maxFileSize?: number;               // 最大文件大小
  chunkSize?: number;                 // 分块大小
  concurrentOperations?: number;      // 并发操作数
  deviceType?: string;                // 设备类型
  firmwareVersion?: string;           // 固件版本
}

// 串口协议协商结果
export interface SerialNegotiationResult {
  selectedFormat: 'protobuf'; // 统一使用protobuf格式
  supportedCommands: number[];
  deviceCapabilities: DeviceCapabilities;
  connectionEstablished: boolean;
}
