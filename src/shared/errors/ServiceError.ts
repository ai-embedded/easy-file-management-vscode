/**
 * 统一错误模型
 * 提供标准化的错误结构，便于前后端统一处理
 */

/**
 * 错误码枚举
 */
export enum ErrorCode {
  // 通用错误 (1000-1999)
  UNKNOWN = 'ERR_UNKNOWN',
  INVALID_PARAMETER = 'ERR_INVALID_PARAMETER',
  OPERATION_FAILED = 'ERR_OPERATION_FAILED',
  NOT_IMPLEMENTED = 'ERR_NOT_IMPLEMENTED',
  TIMEOUT = 'ERR_TIMEOUT',
  
  // 连接错误 (2000-2999)
  CONNECTION_FAILED = 'ERR_CONNECTION_FAILED',
  CONNECTION_LOST = 'ERR_CONNECTION_LOST',
  NOT_CONNECTED = 'ERR_NOT_CONNECTED',
  ALREADY_CONNECTED = 'ERR_ALREADY_CONNECTED',
  AUTHENTICATION_FAILED = 'ERR_AUTH_FAILED',
  
  // 文件操作错误 (3000-3999)
  FILE_NOT_FOUND = 'ERR_FILE_NOT_FOUND',
  FILE_ACCESS_DENIED = 'ERR_FILE_ACCESS_DENIED',
  FILE_ALREADY_EXISTS = 'ERR_FILE_EXISTS',
  FILE_TOO_LARGE = 'ERR_FILE_TOO_LARGE',
  INVALID_FILE_PATH = 'ERR_INVALID_PATH',
  DIRECTORY_NOT_EMPTY = 'ERR_DIR_NOT_EMPTY',
  
  // 网络错误 (4000-4999)
  NETWORK_ERROR = 'ERR_NETWORK',
  REQUEST_FAILED = 'ERR_REQUEST_FAILED',
  RESPONSE_INVALID = 'ERR_RESPONSE_INVALID',
  CORS_ERROR = 'ERR_CORS',
  
  // 协议错误 (5000-5999)
  PROTOCOL_ERROR = 'ERR_PROTOCOL',
  INVALID_COMMAND = 'ERR_INVALID_COMMAND',
  INVALID_RESPONSE = 'ERR_INVALID_RESPONSE',
  UNSUPPORTED_PROTOCOL = 'ERR_UNSUPPORTED_PROTOCOL',
  
  // 安全错误 (6000-6999)
  SECURITY_VIOLATION = 'ERR_SECURITY',
  UNAUTHORIZED = 'ERR_UNAUTHORIZED',
  FORBIDDEN = 'ERR_FORBIDDEN',
  SSRF_DETECTED = 'ERR_SSRF',
  PATH_TRAVERSAL = 'ERR_PATH_TRAVERSAL'
}

/**
 * 错误详情接口
 */
export interface ErrorDetails {
  [key: string]: any;
}

/**
 * 统一错误响应接口
 */
export interface IServiceError {
  code: ErrorCode | string;
  message: string;
  details?: ErrorDetails;
  stack?: string;
  timestamp?: string;
  source?: string;
}

/**
 * 服务错误类
 * 继承自Error，提供标准化的错误结构
 */
export class ServiceError extends Error implements IServiceError {
	public readonly code: ErrorCode | string;
	public readonly details?: ErrorDetails;
	public readonly timestamp: string;
	public readonly source?: string;
  
	constructor(
		code: ErrorCode | string,
		message: string,
		details?: ErrorDetails,
		source?: string
	) {
		super(message);
		this.name = 'ServiceError';
		this.code = code;
		this.details = details;
		this.timestamp = new Date().toISOString();
		this.source = source;
    
		// 确保原型链正确（TypeScript编译目标为ES5时需要）
		Object.setPrototypeOf(this, ServiceError.prototype);
    
		// 捕获堆栈信息
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, ServiceError);
		}
	}
  
	/**
   * 转换为普通对象（用于序列化）
   */
	toJSON(): IServiceError {
		return {
			code: this.code,
			message: this.message,
			details: this.details,
			stack: this.stack,
			timestamp: this.timestamp,
			source: this.source
		};
	}
  
	/**
   * 转换为字符串
   */
	toString(): string {
		let str = `[${this.code}] ${this.message}`;
		if (this.source) {
			str = `[${this.source}] ${str}`;
		}
		if (this.details) {
			str += ` | Details: ${JSON.stringify(this.details)}`;
		}
		return str;
	}
  
	/**
   * 从普通对象创建ServiceError
   */
	static fromObject(obj: IServiceError | Error | any): ServiceError {
		if (obj instanceof ServiceError) {
			return obj;
		}
    
		if (obj instanceof Error) {
			return new ServiceError(
				ErrorCode.UNKNOWN,
				obj.message,
				{ originalError: obj.name },
				undefined
			);
		}
    
		if (typeof obj === 'object' && obj !== null) {
			return new ServiceError(
				obj.code || ErrorCode.UNKNOWN,
				obj.message || 'Unknown error',
				obj.details,
				obj.source
			);
		}
    
		return new ServiceError(
			ErrorCode.UNKNOWN,
			String(obj),
			undefined,
			undefined
		);
	}
  
	/**
   * 判断是否为特定错误码
   */
	is(code: ErrorCode | string): boolean {
		return this.code === code;
	}
  
	/**
   * 判断是否为某一类错误
   */
	isType(prefix: string): boolean {
		return this.code.startsWith(prefix);
	}
}

/**
 * 错误工厂函数
 */
export class ErrorFactory {
	/**
   * 创建连接失败错误
   */
	static connectionFailed(message: string, details?: ErrorDetails): ServiceError {
		return new ServiceError(ErrorCode.CONNECTION_FAILED, message, details);
	}
  
	/**
   * 创建未连接错误
   */
	static notConnected(source?: string): ServiceError {
		return new ServiceError(
			ErrorCode.NOT_CONNECTED,
			'未连接到服务器',
			undefined,
			source
		);
	}
  
	/**
   * 创建文件未找到错误
   */
	static fileNotFound(path: string): ServiceError {
		return new ServiceError(
			ErrorCode.FILE_NOT_FOUND,
			`文件未找到: ${path}`,
			{ path }
		);
	}
  
	/**
   * 创建无效参数错误
   */
	static invalidParameter(param: string, reason?: string): ServiceError {
		return new ServiceError(
			ErrorCode.INVALID_PARAMETER,
			`无效参数: ${param}${reason ? ` - ${reason}` : ''}`,
			{ param, reason }
		);
	}
  
	/**
   * 创建超时错误
   */
	static timeout(operation: string, timeout: number): ServiceError {
		return new ServiceError(
			ErrorCode.TIMEOUT,
			`操作超时: ${operation}`,
			{ operation, timeout }
		);
	}
  
	/**
   * 创建网络错误
   */
	static networkError(message: string, details?: ErrorDetails): ServiceError {
		return new ServiceError(ErrorCode.NETWORK_ERROR, message, details);
	}
  
	/**
   * 创建安全错误
   */
	static securityViolation(type: string, message: string): ServiceError {
		return new ServiceError(
			ErrorCode.SECURITY_VIOLATION,
			message,
			{ type }
		);
	}
  
	/**
   * 包装未知错误
   */
	static wrap(error: any, source?: string): ServiceError {
		if (error instanceof ServiceError) {
			if (source && !error.source) {
				return new ServiceError(error.code, error.message, error.details, source);
			}
			return error;
		}
    
		const serviceError = ServiceError.fromObject(error);
		if (source) {
			return new ServiceError(
				serviceError.code,
				serviceError.message,
				serviceError.details,
				source
			);
		}
		return serviceError;
	}
}

/**
 * 错误处理工具函数
 */
export function isServiceError(error: any): error is ServiceError {
	return error instanceof ServiceError;
}

/**
 * 格式化错误消息
 */
export function formatErrorMessage(error: any): string {
	if (error instanceof ServiceError) {
		return error.toString();
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/**
 * 从响应中提取错误
 */
export function extractErrorFromResponse(response: any): ServiceError {
	if (response?.error) {
		return ServiceError.fromObject(response.error);
	}
	if (response?.message) {
		return new ServiceError(
			response.code || ErrorCode.UNKNOWN,
			response.message,
			response.details
		);
	}
	return new ServiceError(
		ErrorCode.UNKNOWN,
		'未知响应错误',
		{ response }
	);
}