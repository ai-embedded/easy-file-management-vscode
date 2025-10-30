// Native JS entry point - replaces Vue-based main.ts
import './vscode-ui.css';
import { setGlobalLogConfig, LogLevel, createWebviewOutputHandler, Logger } from '@shared/utils/Logger';
import { ConnectionStatus } from '@shared/types/transport';
import { initThemeManager } from './utils/themeManager';
import { postMessage, onMessage } from './utils/messageUtils';
import { App } from './App';

// 初始化 VSCode API
function initVSCodeAPI() {
    const STORAGE_KEY = 'vscode-extension-state';

    function createEnhancedMockAPI() {
        return {
            postMessage: (message: any) => {
                console.log('[Mock VSCode] postMessage:', message);
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
                        return JSON.parse(savedState);
                    }
                } catch (error) {
                    console.error('加载状态失败:', error);
                }
                return {};
            },
            setState: (state: any) => {
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
                } catch (error) {
                    console.error('保存状态失败:', error);
                    try {
                        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
                    } catch (e) {
                        console.error('sessionStorage也保存失败:', e);
                    }
                }
            }
        };
    }

    try {
        if (typeof (window as any).acquireVsCodeApi === 'function') {
            const api = (window as any).acquireVsCodeApi();
            (window as any).vscode = api;
            console.log('VSCode API 获取成功');
        } else if ((window as any).vscode) {
            console.log('使用已存在的VSCode API');
        } else {
            console.warn('VSCode API不可用，使用增强的Mock API');
            (window as any).vscode = createEnhancedMockAPI();
        }
    } catch (e) {
        console.warn('初始化 VSCode API 失败，使用增强的Mock:', e);
        (window as any).vscode = createEnhancedMockAPI();
    }
}

// 全局错误处理
function setupGlobalErrorHandlers(logger: Logger) {
    window.addEventListener('error', (event) => {
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

    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
        const errorString = args.join(' ');
        if (errorString.includes('ResizeObserver') ||
            errorString.includes('loop completed with undelivered notifications') ||
            errorString.includes('loop limit exceeded')) {
            return;
        }
        originalConsoleError.apply(console, args);
    };
}

// 确保ConnectionStatus枚举可用
function ensureConnectionStatusEnum() {
    try {
        if (!ConnectionStatus || typeof ConnectionStatus !== 'object') {
            console.warn('ConnectionStatus枚举未正确导入，使用fallback定义');
            (window as any).ConnectionStatus = {
                DISCONNECTED: 'disconnected',
                CONNECTING: 'connecting',
                CONNECTED: 'connected',
                ERROR: 'error'
            };
        } else {
            (window as any).ConnectionStatus = ConnectionStatus;
        }
    } catch (error) {
        console.error('ConnectionStatus导入失败，使用fallback:', error);
        (window as any).ConnectionStatus = {
            DISCONNECTED: 'disconnected',
            CONNECTING: 'connecting',
            CONNECTED: 'connected',
            ERROR: 'error'
        };
    }
}

// 初始化应用
async function initApp() {
    try {
        console.log('开始初始化原生 JS 应用...');

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

        // 确保ConnectionStatus枚举可用
        ensureConnectionStatusEnum();

        // 检查挂载点是否存在
        const mountPoint = document.getElementById('app');
        if (!mountPoint) {
            throw new Error('找不到挂载点 #app');
        }

        // 创建并初始化应用
        const app = new App(mountPoint, logger);
        await app.init();

        console.log('原生 JS 应用初始化成功');
        logger.info('Webview application mounted');

        // 监听来自VSCode的消息
        onMessage((message) => {
            app.handleMessage(message);
        });

        postMessage('webviewReady', {
            timestamp: new Date().toISOString(),
            themeClasses: Array.from(document.body?.classList ?? []),
            language: 'zh-CN' // TODO: 从i18n获取
        });

        // 清理加载状态
        const loadingContainer = document.querySelector('.loading-container');
        if (loadingContainer) {
            loadingContainer.remove();
        }

        // 导出app实例供调试
        if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
            (window as any).__APP__ = app;
        }

        // 发送初始化成功消息
        if ((window as any).vscode) {
            (window as any).vscode.postMessage({
                command: 'log',
                data: {
                    level: 'info',
                    message: '原生 JS 应用初始化完成'
                }
            });
        }

        // 清理函数
        window.addEventListener('unload', () => {
            try {
                disposeThemeManager?.();
                app.dispose();
            } catch (error) {
                logger.warn('Failed to dispose app during unload', error);
            }
        });

    } catch (error) {
        console.error('初始化失败:', error);
        
        // 显示错误状态
        const app = document.getElementById('app');
        if (app) {
            app.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 40px; text-align: center;">
                    <div style="font-size: 48px; color: var(--vscode-errorForeground, #f48771); margin-bottom: 20px;">⚠️</div>
                    <div style="color: var(--vscode-errorForeground, #f48771); font-size: 18px; font-weight: 600; margin-bottom: 12px;">应用初始化失败</div>
                    <div style="color: var(--vscode-foreground, #cccccc); font-size: 14px; line-height: 1.6; margin-bottom: 20px; max-width: 500px;">
                        ${error instanceof Error ? error.message : '未知错误'}<br>
                        请检查控制台查看详细错误信息
                    </div>
                    <button onclick="location.reload()" style="padding: 8px 16px; border: 1px solid var(--vscode-button-border); border-radius: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; font-size: 12px;">
                        重新加载
                    </button>
                </div>
            `;
        }
        throw error;
    }
}

// 启动应用
console.log('开始启动原生 JS 应用...');
initApp().catch(error => {
    console.error('Failed to initialize app:', error);
});
