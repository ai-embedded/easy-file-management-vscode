// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { MessageRouter } from './extension/MessageRouter';
import {
	validateUrl,
	filterHeaders,
	validatePath,
	logAudit,
	DEFAULT_SECURITY_CONFIG,
	SecurityConfig
} from './extension/security/SecurityConfig';
import { Logger, LogLevel, setGlobalLogConfig, createVSCodeOutputHandler } from './shared/utils/Logger';
import { ServiceError, ErrorFactory, formatErrorMessage } from './shared/errors/ServiceError';
import { initializeGlobalI18n, getGlobalI18n } from './shared/i18n/I18nManager';

let currentPanel: vscode.WebviewPanel | undefined = undefined;
let webviewWatcher: vscode.FileSystemWatcher | undefined = undefined;
let messageRouter: MessageRouter | undefined = undefined;
let logger: Logger;
let currentLanguage = 'en';
let languageChangeDisposable: vscode.Disposable | undefined = undefined;

const SUPPRESSED_NOTIFICATION_MODULES = new Set([
	'RequestTracer',
	'PerformanceMonitor',
	'Extension:Webview',
	'TcpClient',
	'MessageRouter'
]);

const BACKEND_COMMAND_WHITELIST = new Set(MessageRouter.getBackendCommandWhitelist());

const NOTIFICATION_DEDUP_INTERVAL = 1500;
let lastNotificationKey = '';
let lastNotificationTimestamp = 0;

function shouldForwardNotification(module: string, message: string): boolean {
	if (!message) {
		return false;
	}
	if (SUPPRESSED_NOTIFICATION_MODULES.has(module)) {
		return false;
	}
	return true;
}

type ThemeBridgeKind = 'light' | 'dark' | 'highContrast';

interface ThemeBridgePayload {
	kind: ThemeBridgeKind;
	appearance: 'light' | 'dark';
	kindNumeric: vscode.ColorThemeKind;
	themeId?: string;
	label?: string;
	timestamp: string;
}

function mapColorThemeToBridgePayload(theme: vscode.ColorTheme): ThemeBridgePayload {
	let kind: ThemeBridgeKind;
	let appearance: 'light' | 'dark';

	switch (theme.kind) {
		case vscode.ColorThemeKind.Light:
			kind = 'light';
			appearance = 'light';
			break;
		case vscode.ColorThemeKind.Dark:
			kind = 'dark';
			appearance = 'dark';
			break;
		case vscode.ColorThemeKind.HighContrast:
			kind = 'highContrast';
			appearance = 'dark';
			break;
		case vscode.ColorThemeKind.HighContrastLight:
			kind = 'highContrast';
			appearance = 'light';
			break;
		default:
			kind = theme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light';
			appearance = kind === 'dark' ? 'dark' : 'light';
	}

	return {
		kind,
		appearance,
		kindNumeric: theme.kind,
		themeId: (theme as any)?.id,
		label: (theme as any)?.label,
		timestamp: new Date().toISOString()
	};
}

/**
 * 获取安全的默认保存路径
 * @param filename 文件名
 * @returns 安全的默认保存路径
 */
function getSafeDefaultSavePath(filename?: string): string {
	// 验证文件名安全性
	if (filename) {
		const pathValidation = validatePath(filename);
		if (!pathValidation.valid) {
			logger?.warn(`不安全的文件名: ${filename}, 原因: ${pathValidation.reason}`);
			// 使用安全的默认文件名
			filename = `download_${Date.now()}.dat`;
		}
	}
	const userHome = os.homedir();

	// 尝试使用Downloads目录（大多数系统都有）
	const downloadsPath = path.join(userHome, 'Downloads');

	try {
		// 检查Downloads目录是否存在且可访问
		if (fs.existsSync(downloadsPath)) {
			const stats = fs.statSync(downloadsPath);
			if (stats.isDirectory()) {
				return filename ? path.join(downloadsPath, filename) : downloadsPath;
			}
		}
	} catch (error) {
		logger?.warn('Downloads directory not accessible, using home directory', error);
	}

	// 降级到用户主目录
	return filename ? path.join(userHome, filename) : userHome;
}

/**
 * 获取安全配置
 */
function getSecurityConfig(): SecurityConfig {
	const config = vscode.workspace.getConfiguration('fileManager.security');
	return {
		enableHostWhitelist: config.get('enableHostWhitelist', DEFAULT_SECURITY_CONFIG.enableHostWhitelist),
		hostWhitelist: config.get('hostWhitelist', DEFAULT_SECURITY_CONFIG.hostWhitelist),
		enableProtocolCheck: config.get('enableProtocolCheck', DEFAULT_SECURITY_CONFIG.enableProtocolCheck),
		allowedProtocols: config.get('allowedProtocols', DEFAULT_SECURITY_CONFIG.allowedProtocols),
		filterSensitiveHeaders: config.get('filterSensitiveHeaders', DEFAULT_SECURITY_CONFIG.filterSensitiveHeaders),
		sensitiveHeaders: config.get('sensitiveHeaders', DEFAULT_SECURITY_CONFIG.sensitiveHeaders),
		enablePathValidation: config.get('enablePathValidation', DEFAULT_SECURITY_CONFIG.enablePathValidation),
		maxRedirects: config.get('maxRedirects', DEFAULT_SECURITY_CONFIG.maxRedirects),
		requestTimeout: config.get('requestTimeout', DEFAULT_SECURITY_CONFIG.requestTimeout)
	};
}

/**
 * 执行HTTP请求（代理函数，避免webview CORS问题）
 * 包含安全加固措施
 */
async function makeHttpRequest(url: string, options: {
	method?: string;
	headers?: Record<string, string>;
	data?: any;
}): Promise<any> {
	const securityConfig = getSecurityConfig();

	// 验证URL安全性
	const urlValidation = validateUrl(url, securityConfig);
	if (!urlValidation.valid) {
		logAudit({
			timestamp: new Date(),
			action: 'HTTP_REQUEST',
			url,
			method: options.method,
			status: 'blocked',
			reason: urlValidation.reason
		});
		throw new Error(`请求被拒绝: ${urlValidation.reason}`);
	}

	// 过滤敏感请求头
	const filteredHeaders = filterHeaders(options.headers || {}, securityConfig);

	// 记录审计日志
	logAudit({
		timestamp: new Date(),
		action: 'HTTP_REQUEST',
		url,
		method: options.method,
		status: 'allowed',
		source: 'webview'
	});
	return new Promise((resolve, reject) => {
		const parsedUrl = new URL(url);
		const isHttps = parsedUrl.protocol === 'https:';
		const client = isHttps ? https : http;

		const requestOptions = {
			hostname: parsedUrl.hostname,
			port: parsedUrl.port || (isHttps ? 443 : 80),
			path: parsedUrl.pathname + parsedUrl.search,
			method: options.method || 'GET',
			headers: {
				'User-Agent': 'VSCode-Extension-HTTP-Client',
				...filteredHeaders
			} as Record<string, string>,
			timeout: securityConfig.requestTimeout
		};

		// 如果有POST数据，添加Content-Length
		let postData = '';
		if (options.data && (options.method === 'POST' || options.method === 'PUT')) {
			postData = typeof options.data === 'string' ? options.data : JSON.stringify(options.data);
			(requestOptions.headers as any)['Content-Length'] = Buffer.byteLength(postData).toString();
			if (!(requestOptions.headers as any)['Content-Type']) {
				(requestOptions.headers as any)['Content-Type'] = 'application/json';
			}
		}

		const req = client.request(requestOptions, (res) => {
			const chunks: Buffer[] = [];

			res.on('data', (chunk) => {
				chunks.push(Buffer.from(chunk));
			});

			res.on('end', () => {
				try {
					// 将所有chunks合并并正确解码为UTF-8
					const buffer = Buffer.concat(chunks);
					const data = buffer.toString('utf8');

					// 尝试解析JSON响应
					let parsedData;
					try {
						parsedData = JSON.parse(data);
					} catch {
						parsedData = data;
					}

					resolve({
						status: res.statusCode,
						statusText: res.statusMessage,
						headers: res.headers,
						data: parsedData
					});
				} catch (error) {
					reject(error);
				}
			});
		});

		req.on('error', (error) => {
			logAudit({
				timestamp: new Date(),
				action: 'HTTP_REQUEST_ERROR',
				url,
				method: options.method,
				status: 'blocked',
				reason: error.message
			});
			reject(error);
		});

		// 设置超时
		req.on('timeout', () => {
			req.destroy();
			logAudit({
				timestamp: new Date(),
				action: 'HTTP_REQUEST_TIMEOUT',
				url,
				method: options.method,
				status: 'blocked',
				reason: `请求超时 (${securityConfig.requestTimeout}ms)`
			});
			reject(new Error(`请求超时 (${securityConfig.requestTimeout}ms)`));
		});

		// 发送POST数据
		if (postData) {
			req.write(postData);
		}

		req.end();
	});
}

/**
 * 检测VSCode当前语言并更新i18n
 */
function detectAndUpdateLanguage(): void {
	const vscodeLanguage = vscode.env.language;
	const i18nManager = getGlobalI18n();

	if (i18nManager && vscodeLanguage !== currentLanguage) {
		logger.info('VSCode language detected', {
			previousLanguage: currentLanguage,
			newLanguage: vscodeLanguage
		});

		currentLanguage = vscodeLanguage;
		i18nManager.setLanguage(vscodeLanguage);

		// 通知webview语言变更
		if (currentPanel) {
			currentPanel.webview.postMessage({
				command: 'languageChanged',
				data: {
					language: vscodeLanguage,
					timestamp: new Date().toISOString()
				}
			});
		}
	}
}

/**
 * 设置语言变更监听
 */
function setupLanguageChangeListener(): void {
	// VSCode目前没有内置的语言变更事件，我们需要定期检查
	// 或者依赖webview主动报告语言变更

	// 定期检查语言变更（作为备用方案）
	const checkInterval = setInterval(() => {
		detectAndUpdateLanguage();
	}, 5000); // 每5秒检查一次

	// 将清理函数保存为disposable
	languageChangeDisposable = {
		dispose: () => clearInterval(checkInterval)
	};
}

/**
 * 设置Webview消息处理器
 */
function setupWebviewMessageHandlers(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): void {
	const themeLogger = logger.createChild('ThemeBridge');
	let themeChannelReady = false;
	let pendingThemePayload: ThemeBridgePayload | undefined = mapColorThemeToBridgePayload(vscode.window.activeColorTheme);

	const dispatchThemePayload = (payload: ThemeBridgePayload, reason: string) => {
		if (!panel) {
			themeLogger.warn('Theme payload dispatch skipped - panel missing', { reason });
			return;
		}

		if (!themeChannelReady) {
			pendingThemePayload = payload;
			themeLogger.debug('Theme payload queued before webview ready', {
				reason,
				kind: payload.kind,
				appearance: payload.appearance
			});
			return;
		}

		try {
			panel.webview.postMessage({
				command: 'themeChanged',
				data: payload
			});
			themeLogger.info('Dispatched theme payload to webview', {
				reason,
				kind: payload.kind,
				appearance: payload.appearance,
				themeId: payload.themeId,
				label: payload.label
			});
		} catch (error) {
			themeLogger.error('Failed to dispatch theme payload', error);
		}
	};

	const flushPendingThemePayload = (reason: string) => {
		if (!themeChannelReady || !pendingThemePayload) {
			return;
		}
		const payload = pendingThemePayload;
		pendingThemePayload = undefined;
		dispatchThemePayload(payload, reason);
	};

	const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(activeTheme => {
		const payload = mapColorThemeToBridgePayload(activeTheme);
		dispatchThemePayload(payload, 'vscode-theme-change');
	});

	panel.onDidDispose(() => {
		themeChangeDisposable.dispose();
	});

	// Handle messages from the webview
	panel.webview.onDidReceiveMessage(
		async message => {
			try {
				const command = message.command;

				if (typeof command === 'string' && BACKEND_COMMAND_WHITELIST.has(command)) {
					if (!messageRouter || !panel) {
						logger.warn('[WebviewBridge] Backend command skipped - router unavailable', { command });
						return;
					}

					const requestId = message.requestId || 'default';
					const processBackendCommand = async (): Promise<void> => {
						try {
							const response = await messageRouter.handleMessage({
								command,
								requestId,
								data: message.data
							});

							panel.webview.postMessage({
								command: 'backendResponse',
								requestId: message.requestId,
								success: response.success,
								data: response.data,
								error: response.error
							});
						} catch (error) {
							logger.error('Backend command processing failed', error);
							panel.webview.postMessage({
								command: 'backendResponse',
								requestId: message.requestId,
								success: false,
								error: error instanceof Error ? error.message : '后端处理失败'
							});
						}
					};

					processBackendCommand().catch(unhandledError => {
						logger.error('Unhandled backend command rejection', unhandledError, { command, requestId });
					});
					return;
				}

				switch (message.command) {
					case 'alert':
					case 'showInfo':
						vscode.window.showInformationMessage(message.data?.message || message.text || 'Info');
						break;

					case 'showWarning':
						vscode.window.showWarningMessage(message.data?.message || message.text || 'Warning');
						break;

					case 'showError':
						vscode.window.showErrorMessage(message.data?.message || message.text || 'Error');
						break;

					case 'log':
						const logData = message.data || {};
						const logLevel = logData.level || 'info';
						const logMessage = logData.message || message.text || 'Log message';
						const webviewLogger = logger.createChild('Webview');

						switch (logLevel) {
							case 'error':
								webviewLogger.error(logMessage, logData.data);
								break;
							case 'warn':
								webviewLogger.warn(logMessage, logData.data);
								break;
							default:
								webviewLogger.info(logMessage, logData.data);
								break;
						}
						break;

					case 'showConfirm':
						const confirmResult = await vscode.window.showInformationMessage(
							message.data?.message || '确认操作?',
							{ modal: message.data?.options?.modal || false },
							'确定',
							'取消'
						);

						// 发送确认结果回webview
						if (panel) {
							panel.webview.postMessage({
								command: 'confirmResponse',
								requestId: message.data?.requestId,
								result: confirmResult === '确定'
							});
						}
						break;

					case 'showOpenDialog':
						const openOptions: vscode.OpenDialogOptions = {
							canSelectFiles: message.data?.options?.canSelectFiles ?? true,
							canSelectFolders: message.data?.options?.canSelectFolders ?? false,
							canSelectMany: message.data?.options?.canSelectMany ?? false
						};

						if (message.data?.options?.filters) {
							openOptions.filters = message.data.options.filters;
						}

						const openResult = await vscode.window.showOpenDialog(openOptions);

						if (panel) {
							panel.webview.postMessage({
								command: 'openDialogResponse',
								requestId: message.data?.requestId,
								result: openResult?.map(uri => uri.fsPath)
							});
						}
						break;

					case 'showSaveDialog':
						logger.info('[WebviewBridge] 收到保存对话框请求', {
							requestId: message.data?.requestId,
							suggestedName: message.data?.options?.suggestedName
						});
						const saveOptions: vscode.SaveDialogOptions = {};

						// 构建安全的默认保存路径
						let defaultPath: string;
						if (message.data?.options?.defaultUri) {
							// 如果传入了defaultUri，使用它（但确保安全）
							const customPath = message.data.options.defaultUri;
							try {
								// 验证路径是否安全（不是根目录或系统目录）
								if (customPath === '/' || customPath === 'C:\\' || customPath === '') {
									throw new Error('Unsafe path provided');
								}
								defaultPath = customPath;
							} catch (error) {
								logger.warn('Invalid defaultUri provided, using safe default', error);
								defaultPath = getSafeDefaultSavePath();
							}
						} else {
							// 没有提供defaultUri，使用安全的默认路径
							const filename = message.data?.options?.suggestedName || 'download';
							defaultPath = getSafeDefaultSavePath(filename);
						}

						saveOptions.defaultUri = vscode.Uri.file(defaultPath);

						if (message.data?.options?.filters) {
							saveOptions.filters = message.data.options.filters;
						}

						logger.debug(`Using default save path: ${defaultPath}`);

						const saveResult = await vscode.window.showSaveDialog(saveOptions);
						if (saveResult) {
							logger.info('[WebviewBridge] 用户选择了保存路径', {
								requestId: message.data?.requestId,
								path: saveResult.fsPath
							});
						} else {
							logger.info('[WebviewBridge] 用户取消保存对话框或返回空结果', {
								requestId: message.data?.requestId
							});
						}

						if (panel) {
							panel.webview.postMessage({
								command: 'saveDialogResponse',
								requestId: message.data?.requestId,
								result: saveResult?.fsPath
							});
						}
						break;

					case 'error':
						// 处理来自webview的错误报告
						const errorData = message.data || {};
						logger.error('Webview Error', new Error(errorData.message), {
							message: errorData.message,
							stack: errorData.stack,
							info: errorData.info
						});

						// 可选：显示错误通知给用户
						vscode.window.showErrorMessage(
							`Webview错误: ${errorData.message || '未知错误'}`
						);
						break;

					case 'ping':
						// 响应ping消息
						if (panel) {
							panel.webview.postMessage({ command: 'pong' });
						}
						break;

					case 'webviewReady':
						themeChannelReady = true;
						themeLogger.info('Webview handshake completed', {
							timestamp: message.data?.timestamp,
							themeClasses: message.data?.themeClasses,
							webviewLanguage: message.data?.language
						});
						if (!pendingThemePayload) {
							pendingThemePayload = mapColorThemeToBridgePayload(vscode.window.activeColorTheme);
						}
						flushPendingThemePayload('webview-ready');

						// 发送当前语言给webview
						const vscodeLanguage = vscode.env.language;
						panel.webview.postMessage({
							command: 'languageChanged',
							data: {
								language: vscodeLanguage,
								timestamp: new Date().toISOString()
							}
						});
						break;

					case 'languageChangeConfirmed':
						logger.info('Language change confirmed by webview', {
							vscodeLanguage: message.data?.vscodeLanguage,
							webviewLanguage: message.data?.webviewLanguage,
							timestamp: message.data?.timestamp
						});
						break;

					case 'httpRequest':
						// 代理HTTP请求以避免CORS问题
						try {
							const { url, method = 'GET', headers = {}, data, requestId } = message.data;

							logger.debug(`HTTP Proxy: ${method} ${url}`);

							// 使用Node.js内置模块进行HTTP请求
							const result = await makeHttpRequest(url, { method, headers, data });

							if (panel) {
								panel.webview.postMessage({
									command: 'httpResponse',
									requestId,
									success: true,
									data: result
								});
							}
						} catch (error) {
							logger.error('HTTP Proxy request failed', error);

							if (panel) {
								panel.webview.postMessage({
									command: 'httpResponse',
									requestId: message.data?.requestId,
									success: false,
									error: error instanceof Error ? error.message : 'HTTP请求失败'
								});
							}
						}
						break;

					case 'saveFile':
						// 处理文件保存
						try {
							const { path: filePath, content, encoding } = message.data || {};

							if (!filePath || !content) {
								throw new Error('文件路径或内容不能为空');
							}

							// 将base64内容转换为Buffer
							let fileContent: Buffer;
							if (encoding === 'base64') {
								// 移除data URL前缀（如果有）
								const base64Data = content.replace(/^data:[^;]+;base64,/, '');
								fileContent = Buffer.from(base64Data, 'base64');
							} else {
								fileContent = Buffer.from(content, 'utf8');
							}

							// 写入文件
							await fs.promises.writeFile(filePath, fileContent);
							logger.info(`File saved to: ${filePath}`);
						} catch (error) {
							logger.error('File save failed', error);
							vscode.window.showErrorMessage(`保存文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
						}
						break;

					case 'saveState':
						// 处理状态保存请求
						if (message.data?.state && panel) {
							// 保存状态到VSCode的全局状态
							await context.globalState.update('fileManagerState', message.data.state);
							logger.debug('Webview状态已保存到globalState', message.data.state);

							// 同时保存到文件系统作为备份
							try {
								// 创建配置目录
								const configDir = path.join(os.homedir(), '.easy-file-management');
								if (!fs.existsSync(configDir)) {
									fs.mkdirSync(configDir, { recursive: true });
								}

								const configPath = path.join(configDir, 'config.json');
								fs.writeFileSync(configPath, JSON.stringify(message.data.state, null, 2));
								logger.debug('配置已保存到文件:', configPath);
							} catch (error) {
								logger.warn('保存配置到文件失败:', error);
							}
						}
						break;

					case 'requestState':
						// 处理状态请求
						if (panel) {
							let savedState = context.globalState.get('fileManagerState');

							// 如果globalState没有数据，尝试从文件读取
							if (!savedState) {
								try {
									const configDir = path.join(os.homedir(), '.easy-file-management');
									const configPath = path.join(configDir, 'config.json');

									// 首先尝试新路径
									if (fs.existsSync(configPath)) {
										const configData = fs.readFileSync(configPath, 'utf8');
										savedState = JSON.parse(configData);
										logger.debug('从文件加载配置:', savedState);
									} else {
										// 兼容旧路径
										const oldConfigPath = path.join(os.homedir(), '.vscode-file-manager-config.json');
										if (fs.existsSync(oldConfigPath)) {
											const configData = fs.readFileSync(oldConfigPath, 'utf8');
											savedState = JSON.parse(configData);
											logger.debug('从旧文件加载配置:', savedState);

											// 迁移到新位置
											if (!fs.existsSync(configDir)) {
												fs.mkdirSync(configDir, { recursive: true });
											}
											fs.writeFileSync(configPath, JSON.stringify(savedState, null, 2));
											fs.unlinkSync(oldConfigPath); // 删除旧文件
											logger.info('配置文件已迁移到新位置:', configPath);
										}
									}

									if (savedState) {
										// 同步到globalState
										await context.globalState.update('fileManagerState', savedState);
									}
								} catch (error) {
									logger.warn('从文件加载配置失败:', error);
								}
							}

							if (savedState) {
								panel.webview.postMessage({
									command: 'restoreState',
									state: savedState
								});
								logger.debug('已向webview发送恢复状态消息', savedState);
							} else {
								logger.debug('没有找到保存的状态');
							}
						}
						break;

					case 'requestDefaultDownloadPath':
						if (panel) {
							const defaultPath = getSafeDefaultSavePath();
							panel.webview.postMessage({
								command: 'defaultDownloadPath',
								requestId: message.data?.requestId,
								path: defaultPath
							});
							logger.debug('Default download path sent to webview', { defaultPath });
						}
						break;

					default:
						logger.debug('Unknown webview message', message);
						break;
				}
			} catch (error) {
				logger.error('Error handling webview message', error);
				vscode.window.showErrorMessage(`处理webview消息失败: ${error}`);
			}
		},
		undefined,
		context.subscriptions
	);
}

/**
 * WebviewPanelSerializer - 处理Webview状态序列化和恢复
 */
class FileManagerWebviewSerializer implements vscode.WebviewPanelSerializer {
	constructor(private context: vscode.ExtensionContext) { }

	async deserializeWebviewPanel(
		webviewPanel: vscode.WebviewPanel,
		state: any
	): Promise<void> {
		logger.info('恢复Webview面板状态', state);

		// 恢复全局面板引用
		currentPanel = webviewPanel;

		// 设置Webview内容
		webviewPanel.webview.html = getWebviewContent(this.context, webviewPanel.webview);

		// 设置MessageRouter的webview引用
		if (messageRouter) {
			messageRouter.setWebviewPanel(webviewPanel);
		}

		// 重新设置消息处理器和事件监听器
		setupWebviewMessageHandlers(webviewPanel, this.context);
		setupWebviewWatcher(this.context, webviewPanel);

		// 设置面板关闭处理器
		webviewPanel.onDidDispose(async () => {
			logger.info('恢复的Webview面板关闭中...');

			if (messageRouter) {
				try {
					await messageRouter.disconnectAll();
					logger.info('所有连接已断开（面板关闭）');
				} catch (error) {
					logger.error('面板关闭时断开连接失败', error);
				}
			}

			currentPanel = undefined;

			if (webviewWatcher) {
				webviewWatcher.dispose();
				webviewWatcher = undefined;
			}

			logger.info('恢复的Webview面板已关闭并清理资源');
		}, null, this.context.subscriptions);

		// 尝试从VSCode状态中恢复保存的状态
		const savedState = state || this.context.globalState.get('fileManagerState');
		if (savedState) {
			setTimeout(() => {
				webviewPanel.webview.postMessage({
					command: 'restoreState',
					state: savedState
				});
			}, 1000); // 延迟发送确保webview已加载
		}

		logger.info('Webview面板状态恢复完成');
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// 初始化国际化系统
	const i18nManager = initializeGlobalI18n(context.extensionPath);
	currentLanguage = vscode.env.language;
	i18nManager.setLanguage(currentLanguage);

	// 设置语言变更监听
	setupLanguageChangeListener();

	// 初始化日志系统
	setGlobalLogConfig({
		level: LogLevel.DEBUG,
		outputHandler: createVSCodeOutputHandler(vscode, { showNativePopups: false }),
		notificationHandler: (level, module, message) => {
			if (level !== LogLevel.ERROR) {
				return;
			}
			if (!shouldForwardNotification(module, message)) {
				return;
			}
			const now = Date.now();
			const notificationKey = `${module}:${message}`;
			if (
				notificationKey === lastNotificationKey &&
				now - lastNotificationTimestamp < NOTIFICATION_DEDUP_INTERVAL
			) {
				return;
			}
			lastNotificationKey = notificationKey;
			lastNotificationTimestamp = now;

			const formattedMessage = `${module}: ${message}`;
			const activePanel = currentPanel;
			if (activePanel) {
				try {
					activePanel.webview.postMessage({
						command: 'extension.notification',
						data: {
							level: 'error',
							message: formattedMessage
						}
					});
				} catch (error) {
					console.error('[Extension] Failed to notify webview', error);
				}
				return;
			}
			// 没有打开webview时，回退到VSCode原生弹窗
			vscode.window.showErrorMessage(formattedMessage);
		}
	});

	logger = new Logger('Extension');
	logger.info('Easy File Extension is now active!', {
		vscodeLanguage: vscode.env.language,
		supportedLanguages: i18nManager.getAvailableLanguages(),
		currentLanguage: i18nManager.getCurrentLanguage()
	});

	// 初始化消息路由器
	messageRouter = new MessageRouter();

	// 注册WebviewPanelSerializer以支持状态恢复
	if (vscode.window.registerWebviewPanelSerializer) {
		vscode.window.registerWebviewPanelSerializer(
			'vueElementUI',
			new FileManagerWebviewSerializer(context)
		);
		logger.info('WebviewPanelSerializer已注册，支持状态恢复');
	}

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('easy-file-management.openPanel', () => {
		// Get the active text editor column
		const columnToShowIn = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (currentPanel) {
			// If we already have a panel, show it in the target column
			currentPanel.reveal(columnToShowIn);
		} else {
			// Otherwise, create a new panel
			currentPanel = vscode.window.createWebviewPanel(
				'easyFile',
				'Easy File',
				columnToShowIn || vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					localResourceRoots: [
						vscode.Uri.file(path.join(context.extensionPath, 'dist'))
					]
				}
			);

			// Set the webview's initial html content
			currentPanel.webview.html = getWebviewContent(context, currentPanel.webview);

			// Set the webviewPanel reference in MessageRouter
			if (messageRouter) {
				messageRouter.setWebviewPanel(currentPanel);
			}

			// 设置消息处理器
			setupWebviewMessageHandlers(currentPanel, context);

			// 设置webview文件监听，支持热重载
			setupWebviewWatcher(context, currentPanel);

			// 加载并发送保存的状态
			(async () => {
				let savedState = context.globalState.get('fileManagerState');

				// 如果globalState没有数据，尝试从文件读取
				if (!savedState) {
					try {
						const configDir = path.join(os.homedir(), '.easy-file-management');
						const configPath = path.join(configDir, 'config.json');

						// 首先尝试新路径
						if (fs.existsSync(configPath)) {
							const configData = fs.readFileSync(configPath, 'utf8');
							savedState = JSON.parse(configData);
							logger.debug('从文件加载配置:', savedState);
						} else {
							// 兼容旧路径
							const oldConfigPath = path.join(os.homedir(), '.vscode-file-manager-config.json');
							if (fs.existsSync(oldConfigPath)) {
								const configData = fs.readFileSync(oldConfigPath, 'utf8');
								savedState = JSON.parse(configData);
								logger.debug('从旧文件加载配置:', savedState);

								// 迁移到新位置
								if (!fs.existsSync(configDir)) {
									fs.mkdirSync(configDir, { recursive: true });
								}
								fs.writeFileSync(configPath, JSON.stringify(savedState, null, 2));
								fs.unlinkSync(oldConfigPath); // 删除旧文件
								logger.info('配置文件已迁移到新位置:', configPath);
							}
						}

						if (savedState) {
							// 同步到globalState
							await context.globalState.update('fileManagerState', savedState);
						}
					} catch (error) {
						logger.warn('从文件加载配置失败:', error);
					}
				}

				if (savedState && currentPanel) {
					// 延迟发送确保webview已加载
					setTimeout(() => {
						if (currentPanel) {
							currentPanel.webview.postMessage({
								command: 'restoreState',
								state: savedState
							});
							logger.info('已向新创建的webview发送恢复状态消息', savedState);
						}
					}, 1000);
				}
			})();

			// Reset when the current panel is closed
			currentPanel.onDidDispose(
				async () => {
					logger.info('Webview panel closing...');

					// 断开所有连接
					if (messageRouter) {
						try {
							await messageRouter.disconnectAll();
							logger.info('All connections disconnected on panel close');
						} catch (error) {
							logger.error('Error disconnecting connections on panel close', error);
						}
					}

					currentPanel = undefined;

					// 清理文件监听器
					if (webviewWatcher) {
						webviewWatcher.dispose();
						webviewWatcher = undefined;
					}

					logger.info('Webview panel closed and resources cleaned up');
				},
				null,
				context.subscriptions
			);
		}
	});

	context.subscriptions.push(disposable);
}

// 设置webview文件监听，支持热重载
function setupWebviewWatcher(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
	// 只在开发模式下启用热重载监控
	if (process.env.NODE_ENV !== 'development') {
		logger.debug('Hot reload disabled in production mode');
		return;
	}

	// 清理旧的监听器
	if (webviewWatcher) {
		webviewWatcher.dispose();
	}

	// 创建文件监听器，监听webview目录下的文件变化
	const webviewPath = path.join(context.extensionPath, 'src', 'webview');
	const pattern = new vscode.RelativePattern(webviewPath, '**/*');

	webviewWatcher = vscode.workspace.createFileSystemWatcher(pattern);

	// 文件变化时重新加载webview内容
	const reloadWebview = () => {
		if (panel && !panel.webview.html.includes('已释放')) {
			// 添加延迟确保文件保存完成
			setTimeout(() => {
				try {
					panel.webview.html = getWebviewContent(context, panel.webview);
					logger.debug('Webview content reloaded (hot reload)');

					// 显示重载通知
					vscode.window.showInformationMessage('🔄 Webview 已热重载', { modal: false });
				} catch (error) {
					logger.error('Error reloading webview', error);
				}
			}, 100);
		}
	};

	webviewWatcher.onDidChange(reloadWebview);
	webviewWatcher.onDidCreate(reloadWebview);
	webviewWatcher.onDidDelete(reloadWebview);

	logger.debug('Webview file watcher setup complete (development mode)');
}

interface WebviewUiStrings {
	pageTitle: string;
	loadingTitle: string;
	loadingSubtitle: string;
	errorTitle: string;
	errorMessage: string;
	errorReload: string;
}

function mapLanguageToHtmlLang(language: string | undefined): string {
	const normalized = (language || '').toLowerCase();
	if (normalized.startsWith('zh')) {
		return 'zh-CN';
	}
	return 'en';
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '"':
				return '&quot;';
			case "'":
				return '&#39;';
			default:
				return char;
		}
	});
}

function resolveWebviewStrings(language: string): WebviewUiStrings {
	const i18nManager = getGlobalI18n();
	const fallbackLanguage = language || 'en';
	const getString = (key: string, fallback: string): string => {
		if (!i18nManager) {
			return fallback;
		}
		const localized = i18nManager.tForLanguage(fallbackLanguage, key);
		if (!localized || localized === key) {
			return fallback;
		}
		return localized;
	};

	return {
		pageTitle: getString('extension.webview.title', 'Vue Element Plus File Manager'),
		loadingTitle: getString('extension.webview.loading.title', 'Loading file manager...'),
		loadingSubtitle: getString('extension.webview.loading.subtitle', 'Initializing Vue application and Element Plus components'),
		errorTitle: getString('extension.webview.error.title', 'Application initialization failed'),
		errorMessage: getString('extension.webview.error.message', 'Please check the console for details'),
		errorReload: getString('extension.webview.error.reload', 'Reload')
	};
}

function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
	// Get the local path to the compiled Vue application
	const mainJsUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'main.js'));

	// Use a nonce to only allow specific scripts to be run.
	const nonce = getNonce();

	const vscodeLanguage = currentLanguage || vscode.env.language || 'en';
	const htmlLang = mapLanguageToHtmlLang(vscodeLanguage);
	const uiStrings = resolveWebviewStrings(vscodeLanguage);
	const initialLanguageJson = JSON.stringify(vscodeLanguage);

	// Inline HTML template to avoid file dependency issues
	const htmlTemplate = `<!DOCTYPE html>
<html lang="{{lang}}">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; 
        style-src {{cspSource}} 'unsafe-inline'; 
        script-src 'nonce-{{nonce}}' 'unsafe-eval'; 
        font-src {{cspSource}} data:; 
        img-src {{cspSource}} data: blob:;
        connect-src 'none';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{title}}</title>
    <style>
        /* 全局基础样式 */
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        html, body {
            height: 100%;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        
        #app {
            height: 100%;
        }
        
        /* 加载状态样式 */
        .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: var(--vscode-editor-background);
        }
        
        .loading-spinner {
            width: 48px;
            height: 48px;
            border: 4px solid var(--vscode-button-background);
            border-top: 4px solid var(--vscode-button-foreground);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 20px;
        }
        
        .loading-text {
            color: var(--vscode-foreground);
            font-size: 16px;
            font-weight: 500;
            margin-bottom: 8px;
        }
        
        .loading-subtext {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        /* 错误状态样式 */
        .error-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            padding: 40px;
            text-align: center;
            background: var(--vscode-editor-background);
        }
        
        .error-icon {
            font-size: 48px;
            color: var(--vscode-errorForeground);
            margin-bottom: 20px;
        }
        
        .error-title {
            color: var(--vscode-errorForeground);
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
        }
        
        .error-message {
            color: var(--vscode-foreground);
            font-size: 14px;
            line-height: 1.6;
            margin-bottom: 20px;
            max-width: 500px;
        }
        
        .error-actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            justify-content: center;
        }
        
        .error-button {
            padding: 8px 16px;
            border: 1px solid var(--vscode-button-border);
            border-radius: 4px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            text-decoration: none;
            font-size: 12px;
            transition: all 0.2s;
        }
        
        .error-button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .error-button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .error-button.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        /* 适配VSCode主题变量 */
        :root {
            --primary-color: var(--vscode-button-background, #007acc);
            --primary-hover: var(--vscode-button-hoverBackground, #005a9e);
            --success-color: var(--vscode-gitDecoration-addedResourceForeground, #28a745);
            --warning-color: var(--vscode-gitDecoration-modifiedResourceForeground, #ffc107);
            --danger-color: var(--vscode-errorForeground, #dc3545);
        }
    </style>
</head>
<body>
    <div id="app">
        <div class="loading-container">
            <div class="loading-spinner"></div>
            <div class="loading-text">{{loadingText}}</div>
            <div class="loading-subtext">{{loadingSubtext}}</div>
        </div>
    </div>
    <script nonce="{{nonce}}">window.__INITIAL_VSCODE_LANGUAGE__ = {{initialLanguageJson}};</script>
    <script nonce="{{nonce}}" src="{{mainJsUri}}"></script>
</body>
</html>`;

	// Replace template variables
	const htmlContent = htmlTemplate
		.replace(/{{cspSource}}/g, webview.cspSource)
		.replace(/{{nonce}}/g, nonce)
		.replace(/{{mainJsUri}}/g, mainJsUri.toString())
		.replace(/{{lang}}/g, htmlLang)
		.replace(/{{title}}/g, escapeHtml(uiStrings.pageTitle))
		.replace(/{{loadingText}}/g, escapeHtml(uiStrings.loadingTitle))
		.replace(/{{loadingSubtext}}/g, escapeHtml(uiStrings.loadingSubtitle))
		.replace(/{{initialLanguageJson}}/g, initialLanguageJson);

	return htmlContent;
}

// Fallback content if template file is not available
function getFallbackWebviewContent(webview: vscode.Webview, mainJsUri: vscode.Uri, nonce: string): string {
	const vscodeLanguage = currentLanguage || vscode.env.language || 'en';
	const htmlLang = mapLanguageToHtmlLang(vscodeLanguage);
	const uiStrings = resolveWebviewStrings(vscodeLanguage);
	const initialLanguageJson = JSON.stringify(vscodeLanguage);

	return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(uiStrings.pageTitle)}</title>
</head>
<body>
    <div id="app">
        <div style="display: flex; align-items: center; justify-content: center; height: 100vh;">
            <div>${escapeHtml(uiStrings.loadingTitle)}</div>
        </div>
    </div>
    <script nonce="${nonce}">
        window.vscode = acquireVsCodeApi();
        window.__INITIAL_VSCODE_LANGUAGE__ = ${initialLanguageJson};
    </script>
    <script nonce="${nonce}" src="${mainJsUri}"></script>
</body>
</html>`;
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

// This method is called when your extension is deactivated
export async function deactivate() {
	logger.info('Deactivating Easy File Extension...');

	// 清理语言变更监听器
	if (languageChangeDisposable) {
		languageChangeDisposable.dispose();
		languageChangeDisposable = undefined;
		logger.info('Language change listener disposed');
	}

	// 断开所有连接
	if (messageRouter) {
		try {
			await messageRouter.disconnectAll();
			logger.info('All connections disconnected');
		} catch (error) {
			logger.error('Error disconnecting connections', error);
		}
		messageRouter = undefined;
	}

	// 销毁webview面板
	if (currentPanel) {
		currentPanel.dispose();
		currentPanel = undefined;
		logger.info('Webview panel disposed');
	}

	// 清理文件监听器
	if (webviewWatcher) {
		webviewWatcher.dispose();
		webviewWatcher = undefined;
		logger.info('File watcher disposed');
	}

	logger.info('Easy File Extension deactivated successfully');
}
