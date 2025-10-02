/**
 * 传输和连接相关的共享类型定义
 */

/**
 * 连接配置接口
 */
export interface ConnectionConfig {
  type: 'http' | 'ftp' | 'tcp' | 'uart' | 'serial' | 'usb';
  host: string;
  port: number;
  timeout?: number;
  
  // HTTP 特有配置
  protocol?: 'http' | 'https';
  headers?: Record<string, string>;
  baseURL?: string;
  httpsAgent?: any;
  
  // FTP 特有配置
  username?: string;
  password?: string;
  secure?: boolean;
  passive?: boolean;
  
  // TCP 特有配置
  dataFormat?: 'protobuf'; // 统一使用protobuf格式
  
  // 串口/UART 特有配置
  path?: string;
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  flowControl?: 'none' | 'hardware' | 'software';
  parserType?: 'raw' | 'readline' | 'bytelength' | 'delimiter';
  delimiter?: string;
  byteLength?: number;
  deviceFilters?: SerialPortFilter[];
}

/**
 * 串口过滤器接口
 */
export interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

/**
 * FTP连接配置
 */
export interface FtpConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  secure?: boolean;
  passive?: boolean;
  timeout?: number;
  validateCertificate?: boolean; // 是否验证SSL/TLS证书，默认true
  maxSingleFileSize?: number; // 单文件最大大小限制（字节），0或undefined表示无限制
}

/**
 * TCP连接配置
 */
export interface TcpConfig {
  host: string;
  port: number;
  timeout?: number;
  dataFormat?: 'protobuf'; // 统一使用protobuf格式
}

/**
 * HTTP连接配置
 */
export interface HttpConfig {
  host: string;
  port?: number;
  protocol?: 'http' | 'https';
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  httpsAgent?: any;
}

/**
 * UART连接配置
 */
export interface UartConfig {
  path: string;
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  flowControl?: 'none' | 'hardware' | 'software';
}

/**
 * 连接状态枚举
 */
export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}