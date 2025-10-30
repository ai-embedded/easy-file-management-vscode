import { VSCodeMessage } from '../types';
import { sanitizeForPostMessage } from '@shared/utils/Logger';

function createLogSummary(value: any, maxLength = 200): string {
	try {
		const sanitized = sanitizeForPostMessage(value);
		if (sanitized === undefined) {
			return 'undefined';
		}
		if (sanitized === null) {
			return 'null';
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

/**
 * VSCode webview 消息通信工具函数
 */

let vscode: ReturnType<typeof acquireVsCodeApi> | null = null;

/**
 * 获取VSCode API
 * @returns VSCode API实例
 */
export function getVSCodeAPI() {
	if (!vscode) {
		// 首先检查window.vscode是否已经存在（由main.ts初始化）
		if ((window as any).vscode) {
			vscode = (window as any).vscode;
			console.log('使用main.ts初始化的VSCode API');
			return vscode;
		}

		try {
			// 尝试直接获取VSCode API
			if (typeof (window as any).acquireVsCodeApi === 'function') {
				vscode = (window as any).acquireVsCodeApi();
				console.log('直接获取VSCode API成功');
			} else {
				throw new Error('acquireVsCodeApi不可用');
			}
		} catch (error) {
			console.warn('VSCode API获取失败，使用本地存储作为后备方案', error);

			// 创建增强的Mock API，使用localStorage持久化数据
			const STORAGE_KEY = 'vscode-extension-state';

			vscode = {
				postMessage: (message: any) => {
					console.log('Mock postMessage:', message);
					// 尝试向父窗口发送消息（如果在iframe中）
					if (window.parent !== window) {
						try {
							window.parent.postMessage(message, '*');
						} catch (e) {
							console.error('Failed to post message to parent:', e);
						}
					}
				},

				getState: () => {
					try {
						const savedState = localStorage.getItem(STORAGE_KEY);
						if (savedState) {
							const state = JSON.parse(savedState);
							console.log('从localStorage加载状态:', state);
							return state;
						}
					} catch (error) {
						console.error('加载状态失败:', error);
					}
					return {};
				},

				setState: (state: any) => {
					try {
						localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
						console.log('状态已保存到localStorage:', state);
					} catch (error) {
						console.error('保存状态失败:', error);
						// 降级到sessionStorage
						try {
							sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
							console.log('状态已保存到sessionStorage:', state);
						} catch (e) {
							console.error('sessionStorage也保存失败:', e);
						}
					}
				}
			};
		}
	}
	return vscode;
}

/**
 * 发送消息到VSCode扩展
 * @param command 命令名称
 * @param data 数据
 */
export function postMessage(command: string, data?: any): void {
	const api = getVSCodeAPI();
	const message: VSCodeMessage = { command, data };
	const safeMessage = sanitizeForPostMessage(message);

	try {
		console.debug('[messageUtils] postMessage ->', command, createLogSummary(data));
		api.postMessage(safeMessage);
	} catch (error) {
		console.error('[messageUtils] postMessage failed', error, {
			command,
			summary: createLogSummary(data)
		});
	}
}

/**
 * 保存状态到VSCode
 * @param state 状态对象
 */
export function saveState(state: any): void {
	const api = getVSCodeAPI();
	api.setState(state);
}

/**
 * 获取保存的状态
 * @returns 状态对象
 */
export function getState(): any {
	const api = getVSCodeAPI();
	const state = api.getState() || {};

	// 如果没有获取到状态，尝试从localStorage读取（兼容性处理）
	if (Object.keys(state).length === 0) {
		try {
			const savedState = localStorage.getItem('vscode-extension-state');
			if (savedState) {
				return JSON.parse(savedState);
			}
		} catch (error) {
			console.error('从localStorage读取状态失败:', error);
		}
	}

	return state;
}

/**
 * 监听来自VSCode扩展的消息
 * @param handler 消息处理函数
 */
export function onMessage(handler: (message: VSCodeMessage) => void): void {
	(window as any).addEventListener('message', (event: MessageEvent) => {
		handler(event.data);
	});
}

/**
 * 发送日志消息
 * @param level 日志级别
 * @param message 日志内容
 * @param data 附加数据
 */
export function log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
	postMessage('log', { level, message, data });
  
	// 同时在控制台输出
	const consoleMethod = level === 'warn' ? console.warn : 
		level === 'error' ? console.error : console.log;
	consoleMethod(`[${level.toUpperCase()}] ${message}`, data);
}

import { UIMessage, UINotification, UIMessageBox } from './uiUtils';

/**
 * 显示信息提示
 * @param message 提示消息
 */
export function showInfo(message: string): void {
    UIMessage.info(message);
}

/**
 * 显示警告提示
 * @param message 警告消息
 */
export function showWarning(message: string): void {
    UIMessage.warning(message);
}

/**
 * 显示错误提示
 * @param message 错误消息
 */
export function showError(message: string): void {
    UIMessage.error(message);
}

/**
 * 显示成功提示
 * @param message 成功消息
 */
export function showSuccess(message: string): void {
    UIMessage.success(message);
}

/**
 * 请求用户确认
 * @param message 确认消息
 * @param options 选项
 * @returns Promise<boolean> 用户选择结果
 */
export function showConfirm(
	message: string, 
	options?: { detail?: string; modal?: boolean }
): Promise<boolean> {
	return new Promise((resolve) => {
		const requestId = Date.now().toString();
    
		// 监听响应
		const handler = (event: MessageEvent) => {
			const data = event.data;
			if (data.command === 'confirmResponse' && data.requestId === requestId) {
				(window as any).removeEventListener('message', handler);
				resolve(data.result);
			}
		};
    
		(window as any).addEventListener('message', handler);
    
		postMessage('showConfirm', { 
			message, 
			options, 
			requestId 
		});
	});
}

/**
 * 选择文件对话框
 * @param options 选择选项
 * @returns Promise<string[]> 选择的文件路径
 */
export function showOpenDialog(options?: {
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  canSelectMany?: boolean;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string[] | undefined> {
	return new Promise((resolve) => {
		const requestId = Date.now().toString();
    
		const handler = (event: MessageEvent) => {
			const data = event.data;
			if (data.command === 'openDialogResponse' && data.requestId === requestId) {
				(window as any).removeEventListener('message', handler);
				resolve(data.result);
			}
		};
    
		(window as any).addEventListener('message', handler);
    
		postMessage('showOpenDialog', { 
			options, 
			requestId 
		});
	});
}

/**
 * 保存文件对话框
 * @param options 保存选项
 * @returns Promise<string> 保存的文件路径
 */
export function showSaveDialog(options?: {
  defaultUri?: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | undefined> {
	return new Promise((resolve) => {
		const requestId = Date.now().toString();
    
		const handler = (event: MessageEvent) => {
			const data = event.data;
			if (data.command === 'saveDialogResponse' && data.requestId === requestId) {
				(window as any).removeEventListener('message', handler);
				resolve(data.result);
			}
		};
    
		(window as any).addEventListener('message', handler);
    
		postMessage('showSaveDialog', { 
			options, 
			requestId 
		});
	});
}
