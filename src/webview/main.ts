import { createApp } from 'vue';
import ElementPlus, { ElConfigProvider } from 'element-plus';
import 'element-plus/dist/index.css';
import './style.css';
import App from './App.vue';
import { setGlobalLogConfig, LogLevel, createWebviewOutputHandler, Logger } from '../shared/utils/Logger';
import { ConnectionStatus } from '../shared/types/transport';
import { initThemeManager } from './utils/themeManager';
import { postMessage } from './utils/messageUtils';

// 国际化
import i18n, { detectAndSetInitialLanguage, switchLanguage, getElementLocale } from './utils/i18n';

// 确保ConnectionStatus枚举可用，添加fallback处理
function ensureConnectionStatusEnum() {
	try {
		// 检查ConnectionStatus是否正确导入
		if (!ConnectionStatus || typeof ConnectionStatus !== 'object') {
			console.warn('ConnectionStatus枚举未正确导入，使用fallback定义');

			// Fallback枚举定义 - 注意这里要和 transport.ts 中的值保持一致
			(window as any).ConnectionStatus = {
				DISCONNECTED: 'disconnected',
				CONNECTING: 'connecting',
				CONNECTED: 'connected',
				ERROR: 'error'
			};
		} else {
			// 将正确导入的枚举暴露给全局作用域
			(window as any).ConnectionStatus = ConnectionStatus;
		}
	} catch (error) {
		console.error('ConnectionStatus导入失败，使用fallback:', error);

		// 设置fallback枚举 - 注意这里要和 transport.ts 中的值保持一致
		(window as any).ConnectionStatus = {
			DISCONNECTED: 'disconnected',
			CONNECTING: 'connecting',
			CONNECTED: 'connected',
			ERROR: 'error'
		};
	}
}

// 初始化 VSCode API（移除模板内联脚本，收敛 CSP 风险）
function initVSCodeAPI() {
	const STORAGE_KEY = 'vscode-extension-state';

	// 创建增强的Mock API，支持localStorage持久化
	function createEnhancedMockAPI() {
		return {
			postMessage: (message: any) => {
				console.log('[Mock VSCode] postMessage:', message);
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

	try {
		// 尝试获取真实的VSCode API
		if (typeof (window as any).acquireVsCodeApi === 'function') {
			const api = (window as any).acquireVsCodeApi();
			(window as any).vscode = api;
			console.log('VSCode API 获取成功');
		} else if ((window as any).vscode) {
			// 已经存在vscode对象
			console.log('使用已存在的VSCode API');
		} else {
			// 降级到增强的Mock API
			console.warn('VSCode API不可用，使用增强的Mock API');
			(window as any).vscode = createEnhancedMockAPI();
		}
	} catch (e) {
		console.warn('初始化 VSCode API 失败，使用增强的Mock:', e);
		(window as any).vscode = createEnhancedMockAPI();
	}
}

// 全局错误处理（移出模板内联脚本）
function setupGlobalErrorHandlers(logger: Logger) {
	window.addEventListener('error', (event) => {
		// 忽略 ResizeObserver 相关错误（这是 Element Plus 等 UI 框架的已知问题，不影响功能）
		const errorMessage = event.error?.message || event.message || '';
		if (typeof errorMessage === 'string' &&
			(errorMessage.includes('ResizeObserver') ||
			 errorMessage.includes('loop completed with undelivered notifications') ||
			 errorMessage.includes('loop limit exceeded'))) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		logger.error('Global error', event.error || event.message);
		if ((window as any).vscode) {
			(window as any).vscode.postMessage({
				command: 'error',
				data: {
					message: event.error?.message || String(event.message || 'Unknown Error'),
					stack: event.error?.stack
				}
			});
		}
	});

	window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
		logger.error('Unhandled promise rejection', event.reason);
		if ((window as any).vscode) {
			(window as any).vscode.postMessage({
				command: 'error',
				data: {
					message: event.reason instanceof Error ? event.reason.message : String(event.reason),
					stack: event.reason?.stack
				}
			});
		}
	});

	// 抑制 ResizeObserver 循环错误（Element Plus 等 UI 框架的常见警告）
	// 这个错误不影响功能，是由于在 resize 回调中修改 DOM 导致的
	const resizeObserverErrorHandler = (e: ErrorEvent) => {
		if (e.message && e.message.includes('ResizeObserver')) {
			e.stopImmediatePropagation();
			e.preventDefault();
			return true;
		}
		return false;
	};

	// 重写 console.error 以过滤 ResizeObserver 警告
	const originalConsoleError = console.error;
	console.error = (...args: any[]) => {
		const errorString = args.join(' ');
		if (errorString.includes('ResizeObserver') ||
			errorString.includes('loop completed with undelivered notifications') ||
			errorString.includes('loop limit exceeded')) {
			// 静默忽略这些警告
			return;
		}
		originalConsoleError.apply(console, args);
	};
}

// 创建Vue应用实例
const app = createApp(App);

// 设置Element Plus和图标
async function setupApp() {
	try {
		// 初始化i18n
		app.use(i18n);

		// 检测并设置初始语言
		const initialLanguage = detectAndSetInitialLanguage();
		const elementLocale = getElementLocale(initialLanguage);

		// 配置Element Plus (使用检测到的语言)
		app.use(ElementPlus, {
			size: 'default',
			zIndex: 3000,
			locale: elementLocale
		});

		// 动态导入图标
		const elementPlusIcons = await import('@element-plus/icons-vue');

		// 注册所有Element Plus图标
		for (const [key, component] of Object.entries(elementPlusIcons)) {
			if (key !== 'default') {
				app.component(key, component as any);
			}
		}

		// 注册ElConfigProvider组件用于运行时语言切换
		app.component('ElConfigProvider', ElConfigProvider);

		console.log('Element Plus and i18n setup completed', { initialLanguage, elementLocale: elementLocale.name });
		logger.info('Application internationalization initialized', {
			initialLanguage,
			elementLocaleName: elementLocale.name,
			availableLocales: Object.keys(i18n.global.messages.value)
		});
	} catch (error) {
		console.warn('Failed to load Element Plus icons or i18n:', error);

		// 使用基本配置（备用方案）
		app.use(i18n); // 至少确保i18n可用
		app.use(ElementPlus, {
			size: 'default',
			zIndex: 3000
		});

		logger.warn('Fallback to basic Element Plus configuration', error);
	}
}

// 初始化 VSCode API 与日志输出桥接
initVSCodeAPI();
setGlobalLogConfig({
	level: LogLevel.INFO,
	outputHandler: createWebviewOutputHandler((window as any).vscode)
});
const logger = new Logger('Webview');
const themeManagerLogger = logger.createChild('Theme');
const disposeThemeManager = initThemeManager(themeManagerLogger);
setupGlobalErrorHandlers(logger);

// 全局错误处理
app.config.errorHandler = (err, instance, info) => {
	console.error('Vue Error:', err);
	console.error('Component:', instance);
	console.error('Error Info:', info);

	// 向VSCode发送错误信息
	if ((window as any).vscode) {
		(window as any).vscode.postMessage({
			command: 'error',
			data: {
				message: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined,
				info
			}
		});
	}
};

// 全局警告处理
app.config.warnHandler = (msg, instance, trace) => {
	console.warn('Vue Warning:', msg);
	if (instance) {
		console.warn('Component:', instance);
	}
	if (trace) {
		console.warn('Trace:', trace);
	}
};

// 设置并挂载应用
async function initApp() {
	try {
		// 显示加载状态
		console.log('开始初始化 Vue 应用...');

		// 确保ConnectionStatus枚举可用
		ensureConnectionStatusEnum();

		await setupApp();
		console.log('Vue 应用配置完成');

		// 检查挂载点是否存在
		const mountPoint = document.getElementById('app');
		if (!mountPoint) {
			throw new Error('找不到挂载点 #app');
		}

		// 挂载应用
		app.mount('#app');
		console.log('Vue 应用挂载成功');
		logger.info('Webview application mounted');

		// 监听来自VSCode的语言切换消息
		if ((window as any).vscode) {
			window.addEventListener('message', (event) => {
				const message = event.data;
				if (message.command === 'languageChanged') {
					const vscodeLanguage = message.data?.language;
					if (vscodeLanguage) {
						logger.info('Received language change from VSCode', {
							vscodeLanguage,
							currentLanguage: i18n.global.locale.value
						});

						// 切换Vue i18n语言
						const newLanguage = switchLanguage(vscodeLanguage);

						// 发送语言变更确认给VSCode
						(window as any).vscode.postMessage({
							command: 'languageChangeConfirmed',
							data: {
								vscodeLanguage,
								webviewLanguage: newLanguage,
								timestamp: new Date().toISOString()
							}
						});
					}
				}
			});
		}

		postMessage('webviewReady', {
			timestamp: new Date().toISOString(),
			themeClasses: Array.from(document.body?.classList ?? []),
			language: i18n.global.locale.value
		});

		// 清除加载状态
		const loadingContainer = document.querySelector('.loading-container');
		if (loadingContainer) {
			loadingContainer.remove();
		}

		// 导出app实例供调试
		// 在webview环境中，使用更安全的开发环境检测
		if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
			(window as any).__VUE_APP__ = app;
		}

		// 发送初始化成功消息
		if ((window as any).vscode) {
			(window as any).vscode.postMessage({
				command: 'log',
				data: {
					level: 'info',
					message: 'Vue 应用初始化完成'
				}
			});
		}
	} catch (error) {
		console.error('初始化失败:', error);
		throw error;
	}
}

// 启动应用
console.log('开始启动 Vue 应用...');
initApp().catch(error => {
	console.error('Failed to initialize app:', error);

	// 显示错误状态
	const app = document.getElementById('app');
	if (app) {
		app.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 40px; text-align: center;">
        <div style="font-size: 48px; color: var(--vscode-errorForeground, #f48771); margin-bottom: 20px;">⚠️</div>
        <div style="color: var(--vscode-errorForeground, #f48771); font-size: 18px; font-weight: 600; margin-bottom: 12px;">应用初始化失败</div>
        <div style="color: var(--vscode-foreground, #cccccc); font-size: 14px; line-height: 1.6; margin-bottom: 20px; max-width: 500px;">
          ${error.message || '未知错误'}<br>
          请检查控制台查看详细错误信息
        </div>
        <button onclick="location.reload()" style="padding: 8px 16px; border: 1px solid var(--vscode-button-border); border-radius: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; font-size: 12px;">
          重新加载
        </button>
      </div>
    `;
	}
});

window.addEventListener('unload', () => {
	try {
		disposeThemeManager?.();
	} catch (error) {
		logger.warn('Failed to dispose theme manager during unload', error);
	}
});
