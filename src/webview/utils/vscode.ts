/**
 * VSCode API 服务层
 * 处理与VSCode扩展的通信
 */

// VSCode API 接口定义
interface VSCodeAPI {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

// 获取VSCode API实例
function getVSCodeAPI(): VSCodeAPI | null {
	if (typeof window !== 'undefined' && (window as any).vscode) {
		return (window as any).vscode;
	}
	return null;
}

// 生成唯一请求ID
function generateRequestId(): string {
	return `vscode_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 等待VSCode响应的Promise存储
const pendingRequests = new Map<string, { 
  resolve: (value: any) => void; 
  reject: (error: any) => void;
  timeout?: NodeJS.Timeout;
}>();

// 监听VSCode的响应
if (typeof window !== 'undefined' && window.addEventListener) {
	window.addEventListener('message', (event) => {
		const message = event.data;
    
		// 处理不同类型的响应
		if (message.requestId && pendingRequests.has(message.requestId)) {
			const request = pendingRequests.get(message.requestId);
			if (request) {
				if (request.timeout) {
					clearTimeout(request.timeout);
				}
				pendingRequests.delete(message.requestId);
        
				// 根据命令类型处理响应
				switch (message.command) {
					case 'saveDialogResponse':
						console.debug('[VSCodeService] 收到 saveDialogResponse', {
							requestId: message.requestId,
							result: message.result
						});
						request.resolve(message.result);
						break;
					case 'openDialogResponse':
						request.resolve(message.result);
						break;
					case 'confirmResponse':
						request.resolve(message.result);
						break;
					default:
						if (message.success !== undefined) {
							if (message.success) {
								request.resolve(message.data || message.result);
							} else {
								request.reject(new Error(message.error || '操作失败'));
							}
						}
				}
			}
		}
	});
}

/**
 * VSCode 服务类
 */
export class VSCodeService {
	private vscode: VSCodeAPI | null;
	private isAvailable: boolean;

	constructor() {
		this.vscode = getVSCodeAPI();
		this.isAvailable = this.vscode !== null;

		if (!this.isAvailable) {
			console.warn('VSCode API 不可用，某些功能可能受限');
		}
	}

	private ensureVsCodeApi(): VSCodeAPI | null {
		if (this.vscode) {
			return this.vscode;
		}

		const api = getVSCodeAPI();
		if (api) {
			this.vscode = api;
			this.isAvailable = true;
			console.debug('[VSCodeService] 成功重新获取 VSCode API');
			return this.vscode;
		}

		this.isAvailable = false;
		console.debug('[VSCodeService] 当前无法获取 VSCode API，可能运行在浏览器环境');
		return null;
	}

	/**
   * 检查VSCode API是否可用
   */
	isVSCodeAvailable(): boolean {
		return this.ensureVsCodeApi() !== null;
	}

	/**
   * 发送消息到VSCode扩展
   */
	postMessage(message: any): void {
		const api = this.ensureVsCodeApi();
		if (api) {
			api.postMessage(message);
		} else {
			console.warn('VSCode API 不可用，消息未发送:', message);
		}
	}

	/**
   * 显示保存对话框
   * @param options 保存对话框选项
   * @returns 选择的文件路径或null
   */
	async showSaveDialog(options?: {
    defaultUri?: string;
    suggestedName?: string;
    filters?: { [name: string]: string[] };
  }): Promise<string | null> {
		const api = this.ensureVsCodeApi();
		if (!api) {
			console.warn('[VSCodeService] VSCode API 不可用，无法弹出保存对话框，将返回空路径');
			return null;
		}

		console.debug('[VSCodeService] 请求显示保存对话框', { options });

		return new Promise((resolve, reject) => {
			const requestId = generateRequestId();
			const timeout = setTimeout(() => {
				pendingRequests.delete(requestId);
				reject(new Error('保存对话框超时'));
			}, 30000);

			pendingRequests.set(requestId, {
				resolve,
				reject,
				timeout
			});

			api.postMessage({
				command: 'showSaveDialog',
				data: {
					requestId,
					options
				}
			});
		});
	}

	/**
   * 显示打开对话框
   * @param options 打开对话框选项
   * @returns 选择的文件路径数组或null
  */
	async showOpenDialog(options?: {
    canSelectFiles?: boolean;
    canSelectFolders?: boolean;
    canSelectMany?: boolean;
    filters?: { [name: string]: string[] };
  }): Promise<string[] | null> {
		const api = this.ensureVsCodeApi();
		if (!api) {
			console.warn('[VSCodeService] VSCode API 不可用，无法弹出打开对话框');
			return null;
		}

		console.debug('[VSCodeService] 请求显示打开对话框', { options });

		return new Promise((resolve, reject) => {
			const requestId = generateRequestId();
			const timeout = setTimeout(() => {
				pendingRequests.delete(requestId);
				reject(new Error('打开对话框超时'));
			}, 30000);

			pendingRequests.set(requestId, {
				resolve,
				reject,
				timeout
			});

			api.postMessage({
				command: 'showOpenDialog',
				data: {
					requestId,
					options
				}
			});
		});
	}

	/**
   * 显示信息消息
   */
	showInformationMessage(message: string): void {
		const api = this.ensureVsCodeApi();
		if (api) {
			api.postMessage({
				command: 'showInfo',
				data: { message }
			});
		} else {
			console.info(message);
		}
	}

	/**
   * 显示警告消息
   */
	showWarningMessage(message: string): void {
		const api = this.ensureVsCodeApi();
		if (api) {
			api.postMessage({
				command: 'showWarning',
				data: { message }
			});
		} else {
			console.warn(message);
		}
	}

	/**
   * 显示错误消息
   */
	showErrorMessage(message: string): void {
		const api = this.ensureVsCodeApi();
		if (api) {
			api.postMessage({
				command: 'showError',
				data: { message }
			});
		} else {
			console.error(message);
		}
	}

	/**
   * 记录日志
   */
	log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
		const api = this.ensureVsCodeApi();
		if (api) {
			api.postMessage({
				command: 'log',
				data: {
					level,
					message,
					data
				}
			});
		} else {
			const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
			logFn(`[${level.toUpperCase()}] ${message}`, data);
		}
	}

	/**
   * 保存文件到本地
   * @param blob 文件内容
   * @param filename 默认文件名
   * @returns 是否保存成功
   */
	async saveFile(blob: Blob, filename: string, targetPath?: string): Promise<boolean> {
		try {
			// 如果VSCode API可用，使用保存对话框
			if (this.isVSCodeAvailable()) {
				console.debug('[VSCodeService] 通过 VSCode 保存文件', { filename, targetPath });
				let savePath = targetPath;
				if (!savePath) {
					savePath = await this.showSaveDialog({
						suggestedName: filename,
						filters: {
							'All Files': ['*']
						}
					});
				}

				if (savePath) {
					console.debug('[VSCodeService] 用户已确认保存路径', { filename, savePath });
					const reader = new FileReader();
					const fileContent = await new Promise<string>((resolve) => {
						reader.onload = () => resolve(reader.result as string);
						reader.readAsDataURL(blob);
					});

					this.postMessage({
						command: 'saveFile',
						data: {
							path: savePath,
							content: fileContent,
							encoding: 'base64'
						}
					});

					return true;
				}
				console.debug('[VSCodeService] 保存路径为空，视为用户取消保存', { filename });
				return false;
			} else {
				// 降级到浏览器下载
				console.debug('[VSCodeService] VSCode API 不可用，降级执行浏览器下载', { filename });
				return this.browserDownload(blob, filename);
			}
		} catch (error) {
			console.error('保存文件失败:', error);
			// 降级到浏览器下载
			return this.browserDownload(blob, filename);
		}
	}

	/**
   * 浏览器下载（降级方案）
   */
	private browserDownload(blob: Blob, filename: string): boolean {
		try {
			console.debug('[VSCodeService] 触发浏览器下载', { filename });
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.style.display = 'none';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);
			return true;
		} catch (error) {
			console.error('浏览器下载失败:', error);
			return false;
		}
	}

	/**
   * 获取保存的状态
   */
	getState(): any {
		const api = this.ensureVsCodeApi();
		if (api) {
			return api.getState();
		}
		// 降级到localStorage
		try {
			return JSON.parse(localStorage.getItem('vscode-state') || '{}');
		} catch {
			return {};
		}
	}

	/**
   * 保存状态
   */
	setState(state: any): void {
		const api = this.ensureVsCodeApi();
		if (api) {
			api.setState(state);
		} else {
			// 降级到localStorage
			try {
				localStorage.setItem('vscode-state', JSON.stringify(state));
			} catch (error) {
				console.error('保存状态失败:', error);
			}
		}
	}
}

// 导出单例实例
export const vscodeService = new VSCodeService();

// 导出便捷函数
export const isVSCodeAvailable = () => vscodeService.isVSCodeAvailable();
export const showSaveDialog = (options?: any) => vscodeService.showSaveDialog(options);
export const saveFile = (blob: Blob, filename: string, targetPath?: string) =>
	vscodeService.saveFile(blob, filename, targetPath);
export const log = (level: 'info' | 'warn' | 'error', message: string, data?: any) => 
	vscodeService.log(level, message, data);
