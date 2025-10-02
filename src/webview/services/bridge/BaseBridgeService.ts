/**
 * 基础桥接服务 - 所有Bridge服务的基类
 * 提供统一的消息通信、请求ID生成、超时管理、进度处理等功能
 */

import { IConnectionService } from '../interfaces/IConnectionService';
import { sanitizeForPostMessage } from '../../../shared/utils/Logger';

function describeBinary(value: unknown): string | null {
	if (typeof ArrayBuffer !== 'undefined') {
		if (value instanceof ArrayBuffer) {
			return `[ArrayBuffer ${value.byteLength} bytes]`;
		}
		if (ArrayBuffer.isView(value)) {
			const view = value as ArrayBufferView;
			const previewLength = Math.min(view.byteLength, 16);
			let preview = '';
			if (previewLength > 0) {
				const previewValues = Array.from(new Uint8Array(view.buffer, view.byteOffset, previewLength));
				preview = ` preview=[${previewValues.join(',')}${view.byteLength > previewLength ? ',…' : ''}]`;
			}
			return `[${value.constructor?.name ?? 'TypedArray'} ${view.byteLength} bytes${preview}]`;
		}
	}

	if (Array.isArray(value) && value.length > 128 && value.every(item => typeof item === 'number')) {
		return `[Array length=${value.length}]`;
	}

	return null;
}

function createLogSummary(value: any, maxLength = 200): string {
	try {
		const binaryDescriptor = describeBinary(value);
		if (binaryDescriptor) {
			return binaryDescriptor;
		}

		if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
			const summaryObject: Record<string, unknown> = {};
			for (const [key, nested] of Object.entries(value)) {
				const nestedBinary = describeBinary(nested);
				if (nestedBinary) {
					summaryObject[key] = nestedBinary;
				} else {
					summaryObject[key] = sanitizeForPostMessage(nested);
				}
			}
			const json = JSON.stringify(summaryObject);
			if (json.length > maxLength) {
				return `${json.slice(0, maxLength)}…`;
			}
			return json;
		}

		const sanitized = sanitizeForPostMessage(value);
		if (sanitized === undefined) {
			return 'undefined';
		}
		if (sanitized === null) {
			return 'null';
		}
		if (typeof sanitized === 'string') {
			return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength)}…` : sanitized;
		}

		const json = JSON.stringify(sanitized);
		if (json.length > maxLength) {
			return `${json.slice(0, maxLength)}…`;
		}
		return json;
	} catch (error) {
		return `[log_summarize_failed: ${error instanceof Error ? error.message : String(error)}]`;
	}
}

export interface BackendResponse {
  success: boolean;
  data?: any;
  error?: string;
  progress?: any;
}

interface MessageHandler {
  requestId: string;
  handler: (response: BackendResponse) => void;
  service: BaseBridgeService;
}

interface ProgressHandler {
	requestId: string;
	handler: (progress: any) => void;
	service: BaseBridgeService;
}

export interface OperationControlHooks {
	onOperationStart?: (requestId: string) => void;
	registerCancelCallback?: (callback: () => Promise<void> | void) => void;
	isCancelled?: () => boolean;
}

interface RequestTimeoutController {
	requestId: string;
	timeoutMs: number;
	startedAt: number;
	lastActivity: number;
	timer: number;
	onTimeout: () => void;
}

/**
 * 基础桥接服务抽象类
 * 统一处理所有Bridge服务的公共逻辑
 */
export abstract class BaseBridgeService extends IConnectionService {
	// 静态单例消息监听器，避免重复注册
	private static messageListenerInitialized = false;
	private static responseHandlers = new Map<string, MessageHandler>();
	private static progressHandlers = new Map<string, ProgressHandler>();
	private static requestTimeoutControllers = new Map<string, RequestTimeoutController>();
  
	// 实例级别的配置
	protected requestIdPrefix = 'req';
	protected defaultTimeout = 30000; // 默认30秒超时
  
	constructor(requestIdPrefix?: string, defaultTimeout?: number) {
		super();
    
		if (requestIdPrefix) {
			this.requestIdPrefix = requestIdPrefix;
		}
    
		if (defaultTimeout !== undefined) {
			this.defaultTimeout = defaultTimeout;
		}
    
		// 将实例添加到集合中
		BaseBridgeService.instances.add(this);
    
		// 确保消息监听器只初始化一次
		if (!BaseBridgeService.messageListenerInitialized) {
			this.initializeMessageListener();
			BaseBridgeService.messageListenerInitialized = true;
		}
	}
  
	/**
   * 清理资源
   */
	dispose(): void {
		// 从实例集合中移除
		BaseBridgeService.instances.delete(this);
	}
  
	/**
   * 初始化全局消息监听器（只执行一次）
   */
	private initializeMessageListener(): void {
		window.addEventListener('message', (event) => {
			const message = event.data;
      
			// 处理后端响应
			if (message.command === 'backendResponse' && message.requestId) {
				console.debug('[BaseBridgeService] backendResponse <-', message.command, message.requestId, createLogSummary(message.data ?? message));
				BaseBridgeService.clearRequestTimeout(message.requestId);
				const handlerInfo = BaseBridgeService.responseHandlers.get(message.requestId);
				if (handlerInfo) {
					BaseBridgeService.responseHandlers.delete(message.requestId);
					handlerInfo.handler(message);
				}
			}
      
			// 处理进度更新
			if (message.command === 'backendProgress' && message.requestId) {
				console.debug('[BaseBridgeService] backendProgress <-', message.requestId, createLogSummary(message.progress));
				BaseBridgeService.refreshRequestTimeout(message.requestId);
				const handlerInfo = BaseBridgeService.progressHandlers.get(message.requestId);
				if (handlerInfo) {
					handlerInfo.handler(message.progress);
				}
			}
      
			// 调用所有实例的自定义消息处理
			// 由于是静态监听器，需要通过其他方式让子类处理自定义消息
			BaseBridgeService.notifyCustomMessage(message);
		});
	}
  
	// 静态实例集合，用于通知自定义消息
	private static instances = new Set<BaseBridgeService>();
  
	/**
   * 通知所有实例处理自定义消息
   */
	private static notifyCustomMessage(message: any): void {
		BaseBridgeService.instances.forEach(instance => {
			instance.handleCustomMessage(message);
		});
	}

	private static registerRequestTimeout(requestId: string, timeoutMs: number, onTimeout: () => void): void {
		const existing = BaseBridgeService.requestTimeoutControllers.get(requestId);
		if (existing) {
			window.clearTimeout(existing.timer);
		}

		const controller: RequestTimeoutController = {
			requestId,
			timeoutMs,
			startedAt: Date.now(),
			lastActivity: Date.now(),
			timer: window.setTimeout(() => {
				BaseBridgeService.requestTimeoutControllers.delete(requestId);
				onTimeout();
			}, timeoutMs),
			onTimeout
		};

		BaseBridgeService.requestTimeoutControllers.set(requestId, controller);
		console.debug('[BaseBridgeService] 注册请求超时监控', { requestId, timeoutMs });
	}

	private static refreshRequestTimeout(requestId: string, timeoutMs?: number): void {
		const controller = BaseBridgeService.requestTimeoutControllers.get(requestId);
		if (!controller) {
			return;
		}

		const nextTimeout = timeoutMs ?? controller.timeoutMs;
		window.clearTimeout(controller.timer);
		controller.timeoutMs = nextTimeout;
		controller.lastActivity = Date.now();
		controller.timer = window.setTimeout(() => {
			BaseBridgeService.requestTimeoutControllers.delete(requestId);
			controller.onTimeout();
		}, nextTimeout);

		console.debug('[BaseBridgeService] 刷新请求超时监控', {
			requestId,
			timeoutMs: controller.timeoutMs,
			elapsedMs: controller.lastActivity - controller.startedAt
		});
	}

	private static clearRequestTimeout(requestId: string): void {
		const controller = BaseBridgeService.requestTimeoutControllers.get(requestId);
		if (!controller) {
			return;
		}

		window.clearTimeout(controller.timer);
		BaseBridgeService.requestTimeoutControllers.delete(requestId);
		console.debug('[BaseBridgeService] 清理请求超时监控', {
			requestId,
			totalDurationMs: Date.now() - controller.startedAt
		});
	}
  
	/**
   * 处理自定义消息 - 子类可以重写此方法处理特殊消息
   */
	protected handleCustomMessage(message: any): void {
		// 默认空实现，子类可重写
	}
  
	/**
   * 发送请求到后端
   * @param command 命令名称
   * @param data 请求数据
   * @param options 可选配置
   */
	protected sendToBackend(
		command: string,
		data: any,
		options?: {
      requestId?: string;
      timeout?: number;
      onProgress?: (progress: any) => void;
    }
	): Promise<BackendResponse> {
		return new Promise((resolve) => {
			const requestId = options?.requestId || this.generateRequestId();
			const timeout = options?.timeout ?? this.defaultTimeout;
      
			// 注册响应处理器
			BaseBridgeService.responseHandlers.set(requestId, {
				requestId,
				handler: resolve,
				service: this
			});
      
			// 注册进度处理器（如果提供）
			if (options?.onProgress) {
				BaseBridgeService.progressHandlers.set(requestId, {
					requestId,
					handler: options.onProgress,
					service: this
				});
			}
      
			// 获取VSCode API并发送消息
			const vscodeApi = this.getVSCodeApi();
			if (vscodeApi && typeof vscodeApi.postMessage === 'function') {
				const payload = sanitizeForPostMessage({
					command,
					requestId,
					data
				});

				try {
					console.debug('[BaseBridgeService] sendToBackend ->', command, requestId, createLogSummary(data));
					vscodeApi.postMessage(payload);

					BaseBridgeService.registerRequestTimeout(requestId, timeout, () => {
						if (BaseBridgeService.responseHandlers.has(requestId)) {
							this.cleanupHandlers(requestId);
							console.warn('[BaseBridgeService] 请求超时', {
								command,
								requestId,
								timeoutMs: timeout
							});
							resolve({
								success: false,
								error: '请求超时'
							});
						}
					});
				} catch (error) {
					console.error('[BaseBridgeService] postMessage failed', error, { command, requestId });
					this.cleanupHandlers(requestId);
					resolve({
						success: false,
						error: 'Webview 与扩展通信失败'
					});
					return;
				}
			} else {
				// 开发环境回退处理
				console.warn('[BaseBridgeService] VSCode API不可用，使用模拟响应');
				setTimeout(() => {
					this.cleanupHandlers(requestId);
					resolve({
						success: false,
						error: 'VSCode API不可用'
					});
				}, 100);
				return;
			}
      
		});
	}
  
	/**
   * 发送请求并处理进度
   * @param command 命令名称
   * @param data 请求数据
   * @param onProgress 进度回调
   * @param timeout 超时时间
   */
	protected async sendRequestWithProgress(
		command: string,
		data: any,
		onProgress?: (progress: any) => void,
		options?: number | { timeout?: number; onStart?: (requestId: string) => void }
	): Promise<BackendResponse> {
		let timeout: number | undefined;
		let onStart: ((requestId: string) => void) | undefined;

		if (typeof options === 'number') {
			timeout = options;
		} else if (options) {
			timeout = options.timeout;
			onStart = options.onStart;
		}

		const requestId = this.generateRequestId();
		onStart?.(requestId);

		try {
			if (timeout) {
				console.debug('[BaseBridgeService] sendRequestWithProgress timeout override', {
					command,
					requestId,
					timeout
				});
			}
			return await this.sendToBackend(command, data, {
				requestId,
				timeout,
				onProgress
			});
		} finally {
			// 清理进度处理器
			this.cleanupHandlers(requestId);
		}
	}
  
	/**
   * 生成唯一的请求ID
   */
	protected generateRequestId(): string {
		return `${this.requestIdPrefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}
  
	/**
   * 获取VSCode API
   */
	protected getVSCodeApi(): any {
		// 优先使用window.vscode
		if ((window as any).vscode) {
			return (window as any).vscode;
		}
    
		// 兼容不同的访问方式
		if (typeof window !== 'undefined' && (window as any).vscode) {
			return (window as any).vscode;
		}
    
		return null;
	}
  
	/**
   * 清理请求相关的处理器
   */
	protected cleanupHandlers(requestId: string): void {
		BaseBridgeService.responseHandlers.delete(requestId);
		BaseBridgeService.progressHandlers.delete(requestId);
		BaseBridgeService.clearRequestTimeout(requestId);
	}

	public cancelBackendOperation(operationId: string, timeout = 10000): Promise<BackendResponse> {
		return this.sendToBackend('backend.cancel.operation', { operationId }, { timeout });
	}

	public cancelAllBackendOperations(timeout = 10000): Promise<BackendResponse> {
		return this.sendToBackend('backend.cancel.all', {}, { timeout });
	}
  
	/**
   * 将File对象转换为ArrayBuffer
   */
	protected fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as ArrayBuffer);
			reader.onerror = reject;
			reader.readAsArrayBuffer(file);
		});
	}
  
	/**
   * 将Buffer数据转换为Blob
   */
	protected bufferToBlob(buffer: any): Blob {
		let uint8Array: Uint8Array;
    
		if (buffer.type === 'Buffer' && Array.isArray(buffer.data)) {
			uint8Array = new Uint8Array(buffer.data);
		} else if (buffer instanceof ArrayBuffer) {
			uint8Array = new Uint8Array(buffer);
		} else if (Array.isArray(buffer)) {
			uint8Array = new Uint8Array(buffer);
		} else {
			uint8Array = new Uint8Array(Object.values(buffer));
		}
    
		return new Blob([uint8Array]);
	}
  
	/**
   * 创建标准的文件操作结果
   */
	protected createFileOperationResult(
		response: BackendResponse,
		successMessage: string,
		failureMessage: string
	): import('../../../shared/types').FileOperationResult {
		return {
			success: response.success,
			message: response.data?.message || response.error || 
               (response.success ? successMessage : failureMessage),
			data: response.data
		};
	}
}
