/**
 * HTTP客户端工具 - 通过VSCode extension代理HTTP请求以避免CORS问题
 */

// 生成唯一请求ID
function generateRequestId(): string {
	return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 等待extension响应的Promise存储
const pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (error: any) => void }>();

// 监听extension的响应
if (typeof window !== 'undefined' && (window as any).addEventListener) {
	window.addEventListener('message', (event) => {
		const message = event.data;
		console.log('Received message:', message); // 调试日志
		if (message.command === 'httpResponse' && message.requestId) {
			const request = pendingRequests.get(message.requestId);
			if (request) {
				pendingRequests.delete(message.requestId);
				if (message.success) {
					request.resolve(message.data);
				} else {
					request.reject(new Error(message.error || 'HTTP请求失败'));
				}
			}
		}
	});
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  data?: any;
  timeout?: number;
  skipCodec?: boolean;
}

/**
 * 通过extension代理发送HTTP请求
 */
export async function httpRequest(url: string, options: HttpRequestOptions = {}): Promise<any> {
	return new Promise((resolve, reject) => {
		const requestId = generateRequestId();
		const timeout = options.timeout || 30000;
    
		// 设置请求超时
		const timeoutId = setTimeout(() => {
			pendingRequests.delete(requestId);
			reject(new Error('请求超时'));
		}, timeout);
    
		// 存储Promise回调
		pendingRequests.set(requestId, {
			resolve: (value) => {
				clearTimeout(timeoutId);
				resolve(value);
			},
			reject: (error) => {
				clearTimeout(timeoutId);
				reject(error);
			}
		});
    
		// 发送消息给extension
		try {
			// 检查VSCode API是否可用
			const vscodeApi = (window as any).vscode;
			if (vscodeApi && typeof vscodeApi.postMessage === 'function') {
				console.log('VSCode API available, sending request:', { requestId, url, method: options.method });
				vscodeApi.postMessage({
					command: 'httpRequest',
					data: {
						requestId,
						url,
						method: options.method || 'GET',
						headers: options.headers || {},
						data: options.data
					}
				});
			} else {
				// 开发模式下的fallback
				console.warn('VSCode API not available, falling back to mock response');
				console.log('window.vscode:', (window as any).vscode);
				setTimeout(() => {
					const request = pendingRequests.get(requestId);
					if (request) {
						pendingRequests.delete(requestId);
						clearTimeout(timeoutId);
						request.reject(new Error('VSCode API不可用'));
					}
				}, 100);
			}
		} catch (error) {
			pendingRequests.delete(requestId);
			clearTimeout(timeoutId);
			reject(error);
		}
	});
}

/**
 * HTTP客户端类，兼容axios接口
 */
export class HttpClient {
	private baseURL: string;
	private defaultHeaders: Record<string, string>;
	private timeout: number;

	constructor(config: {
    baseURL?: string;
    headers?: Record<string, string>;
    timeout?: number;
  } = {}) {
		this.baseURL = config.baseURL || '';
		this.defaultHeaders = config.headers || {};
		this.timeout = config.timeout || 30000;
	}

	private buildURL(url: string): string {
		if (url.startsWith('http://') || url.startsWith('https://')) {
			return url;
		}
		return this.baseURL.replace(/\/$/, '') + (url.startsWith('/') ? url : `/${  url}`);
	}

	async get(url: string, config: HttpRequestOptions = {}) {
		return this.request(url, { ...config, method: 'GET' });
	}

	async post(url: string, data?: any, config: HttpRequestOptions = {}) {
		return this.request(url, { ...config, method: 'POST', data });
	}

	async put(url: string, data?: any, config: HttpRequestOptions = {}) {
		return this.request(url, { ...config, method: 'PUT', data });
	}

	async delete(url: string, config: HttpRequestOptions = {}) {
		return this.request(url, { ...config, method: 'DELETE' });
	}

	async request(url: string, options: HttpRequestOptions = {}) {
		const fullURL = this.buildURL(url);
		const requestOptions: HttpRequestOptions = {
			...options,
			headers: {
				...this.defaultHeaders,
				...options.headers
			},
			timeout: options.timeout || this.timeout
		};

		try {
			const response = await httpRequest(fullURL, requestOptions);
			return {
				data: response.data,
				status: response.status,
				statusText: response.statusText,
				headers: response.headers
			};
		} catch (error) {
			// 包装错误为类似axios的格式
			const enhancedError = new Error(error instanceof Error ? error.message : 'HTTP请求失败');
			(enhancedError as Error & { response?: { status: number; statusText: string } }).response = {
				status: 0,
				statusText: 'Network Error'
			};
			throw enhancedError;
		}
	}
}
