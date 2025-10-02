/**
 * 消息通信相关的共享类型定义
 */

/**
 * 后端消息接口
 */
export interface BackendMessage {
  command: string;
  requestId: string;
  data?: any;
}

/**
 * 后端响应接口
 */
export interface BackendResponse {
  success: boolean;
  data?: any;
  error?: string;
  errorCode?: string;
  errorDetails?: any;
  errorSource?: string;
  progress?: any;
  traceId?: string;
  message?: string;
}

/**
 * HTTP请求选项接口
 */
export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  url: string;
  headers?: Record<string, string>;
  data?: any;
  params?: Record<string, any>;
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob' | 'arraybuffer' | 'stream';
  skipCodec?: boolean;
}

/**
 * HTTP响应接口
 */
export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: any;
}

/**
 * 通知类型枚举
 */
export enum NotificationType {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error'
}

/**
 * 错误信息接口
 */
export interface ErrorInfo {
  code?: string;
  message: string;
  details?: any;
}

/**
 * 服务错误类
 */
export class ServiceError extends Error {
	code?: string;
	details?: any;
  
	constructor(message: string, code?: string, details?: any) {
		super(message);
		this.name = 'ServiceError';
		this.code = code;
		this.details = details;
	}
}
