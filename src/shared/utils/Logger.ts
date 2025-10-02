/**
 * 统一日志管理模块
 * 提供分级日志、模块标识、格式化输出等功能
 */

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 99
}

/**
 * 日志配置接口
 */
export interface LoggerConfig {
  level?: LogLevel;
  enableTimestamp?: boolean;
  enableColors?: boolean;
  outputHandler?: (level: LogLevel, module: string, message: string, ...args: unknown[]) => void;
  notificationHandler?: (level: LogLevel, module: string, message: string, args: unknown[]) => void;
}

interface VsCodeOutputChannel {
	appendLine(value: string): void;
}

interface VsCodeWindowApi {
	createOutputChannel(name: string): VsCodeOutputChannel;
	showErrorMessage(message: string): void;
	showWarningMessage(message: string): void;
}

interface VsCodeApiLike {
	window: VsCodeWindowApi;
}

interface WebviewApiLike {
	postMessage?(message: unknown): void;
}

/**
 * 从环境变量获取日志级别
 */
function getLogLevelFromEnv(): LogLevel {
	// 检查process是否存在（webview环境中不存在）
	if (typeof process === 'undefined' || !process?.env) {
		return LogLevel.INFO; // webview环境默认使用INFO级别
	}

	const envLevel = process.env.LOG_LEVEL?.toUpperCase();
	switch (envLevel) {
		case 'DEBUG': return LogLevel.DEBUG;
		case 'INFO': return LogLevel.INFO;
		case 'WARN': return LogLevel.WARN;
		case 'ERROR': return LogLevel.ERROR;
		case 'NONE': return LogLevel.NONE;
		default:
			// 根据 NODE_ENV 设置默认级别
			const nodeEnv = process.env.NODE_ENV;
			if (nodeEnv === 'production') {
				return LogLevel.WARN; // 生产环境默认 WARN
			} else if (nodeEnv === 'development') {
				return LogLevel.DEBUG; // 开发环境默认 DEBUG
			}
			return LogLevel.INFO; // 默认 INFO
	}
}

/**
 * 默认配置
 */
const defaultConfig: Required<LoggerConfig> = {
	level: getLogLevelFromEnv(),
	enableTimestamp: true,
	enableColors: true,
	outputHandler: defaultOutputHandler,
	notificationHandler: () => undefined
};

/**
 * 全局配置
 */
let globalConfig: Required<LoggerConfig> = { ...defaultConfig };

/**
 * 日志级别名称映射
 */
const levelNames: Record<LogLevel, string> = {
	[LogLevel.DEBUG]: 'DEBUG',
	[LogLevel.INFO]: 'INFO',
	[LogLevel.WARN]: 'WARN',
	[LogLevel.ERROR]: 'ERROR',
	[LogLevel.NONE]: 'NONE'
};

/**
 * 日志级别颜色（ANSI转义码）
 */
const levelColors: Record<LogLevel, string> = {
	[LogLevel.DEBUG]: '\x1b[36m', // Cyan
	[LogLevel.INFO]: '\x1b[32m',  // Green
	[LogLevel.WARN]: '\x1b[33m',  // Yellow
	[LogLevel.ERROR]: '\x1b[31m', // Red
	[LogLevel.NONE]: '\x1b[0m'    // Reset
};

/**
 * 默认输出处理器
 */
function defaultOutputHandler(level: LogLevel, module: string, message: string, ...args: unknown[]): void {
	const timestamp = new Date().toISOString();
	const levelName = levelNames[level] || 'UNKNOWN';
  
	let prefix = '';
	if (globalConfig.enableTimestamp) {
		prefix += `[${timestamp}] `;
	}
	prefix += `[${levelName}] [${module}]`;
  
	// 在Node环境中使用颜色
	if (globalConfig.enableColors && typeof process !== 'undefined') {
		const color = levelColors[level];
		const reset = '\x1b[0m';
		prefix = `${color}${prefix}${reset}`;
	}
  
	const fullMessage = `${prefix} ${message}`;
  
	switch (level) {
		case LogLevel.DEBUG:
			console.debug(fullMessage, ...args);
			break;
		case LogLevel.INFO:
			console.log(fullMessage, ...args);
			break;
		case LogLevel.WARN:
			console.warn(fullMessage, ...args);
			break;
		case LogLevel.ERROR:
			console.error(fullMessage, ...args);
			break;
	}
}

/**
 * Logger类 - 每个模块创建自己的实例
 */
export class Logger {
	private module: string;
	private config: Required<LoggerConfig>;
  
	constructor(module: string, config?: LoggerConfig) {
		this.module = module;
		// 如果没有指定配置，从环境变量读取
		const envConfig: LoggerConfig = {};
		if (!config?.level) {
			envConfig.level = getLogLevelFromEnv();
		}
		this.config = { ...globalConfig, ...envConfig, ...config };
    
		// 在构造时输出当前日志级别（仅在 DEBUG 模式）
		if (this.config.level === LogLevel.DEBUG) {
			console.log(`[Logger] 📊 模块 '${module}' 日志级别: ${levelNames[this.config.level]}`);
		}
	}
  
	/**
   * 设置日志级别
   */
	setLevel(level: LogLevel): void {
		this.config.level = level;
	}
  
	/**
   * 获取当前日志级别
   */
	getLevel(): LogLevel {
		return this.config.level;
	}
  
	/**
   * DEBUG级别日志
   */
	debug(message: string, ...args: unknown[]): void {
		this.log(LogLevel.DEBUG, message, ...args);
	}
  
	/**
   * INFO级别日志
   */
	info(message: string, ...args: unknown[]): void {
		this.log(LogLevel.INFO, message, ...args);
	}
  
	/**
   * WARN级别日志
   */
	warn(message: string, ...args: unknown[]): void {
		this.log(LogLevel.WARN, message, ...args);
	}
  
	/**
   * ERROR级别日志
   */
	error(message: string, error?: unknown, ...args: unknown[]): void {
		if (error instanceof Error) {
			this.log(LogLevel.ERROR, `${message}: ${error.message}`, error.stack, ...args);
		} else if (error !== undefined) {
			this.log(LogLevel.ERROR, message, error, ...args);
		} else {
			this.log(LogLevel.ERROR, message, ...args);
		}
	}
  
	/**
   * 核心日志方法
   */
	private log(level: LogLevel, message: string, ...args: unknown[]): void {
		// 检查日志级别
		if (level < this.config.level) {
			return;
		}
    
		// 调用输出处理器
		this.config.outputHandler(level, this.module, message, ...args);

		if (level >= LogLevel.WARN) {
			try {
				this.config.notificationHandler(level, this.module, message, args);
			} catch (notifyError) {
				defaultOutputHandler(LogLevel.ERROR, 'Logger', `通知处理器执行失败: ${notifyError instanceof Error ? notifyError.message : String(notifyError)}`);
			}
		}
	}
  
	/**
   * 创建子Logger
   */
	createChild(subModule: string): Logger {
		return new Logger(`${this.module}:${subModule}`, this.config);
	}
}

/**
 * 设置全局日志配置
 */
export function setGlobalLogConfig(config: LoggerConfig): void {
	globalConfig = { ...globalConfig, ...config };
}

/**
 * 获取全局日志配置
 */
export function getGlobalLogConfig(): Required<LoggerConfig> {
	return { ...globalConfig };
}

/**
 * 创建Logger实例的便捷方法
 */
export function createLogger(module: string, config?: LoggerConfig): Logger {
	return new Logger(module, config);
}

/**
 * VSCode扩展专用输出处理器
 * 需要在扩展激活时注入vscode对象
 */
export function createVSCodeOutputHandler(
	vscode: VsCodeApiLike,
	options?: { showNativePopups?: boolean }
): typeof defaultOutputHandler {
	const outputChannel = vscode.window.createOutputChannel('File Manager Extension');
	const showNativePopups = options?.showNativePopups ?? true;
 
	return (level: LogLevel, module: string, message: string, ...args: unknown[]) => {
		const timestamp = new Date().toISOString();
		const levelName = levelNames[level] || 'UNKNOWN';
		const fullMessage = `[${timestamp}] [${levelName}] [${module}] ${message}`;
    
		// 写入输出通道
		outputChannel.appendLine(fullMessage);
		if (args.length > 0) {
			outputChannel.appendLine(`  ${  JSON.stringify(args, null, 2)}`);
		}
    
		// 针对错误和警告，保留可选的原生弹窗
		if (showNativePopups) {
			if (level === LogLevel.ERROR) {
				vscode.window.showErrorMessage(`${module}: ${message}`);
			} else if (level === LogLevel.WARN) {
				vscode.window.showWarningMessage(`${module}: ${message}`);
			}
		}
    
		// 同时输出到控制台（开发时使用）
		defaultOutputHandler(level, module, message, ...args);
	};
}

/**
 * Webview专用输出处理器
 * 将日志发送到扩展端统一处理
 */
export function sanitizeForPostMessage(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
	if (value === null || value === undefined) {
		return value;
	}

	const valueType = typeof value;

	if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
		return value;
	}

	if (valueType === 'bigint') {
		return value.toString();
	}

	if (valueType === 'symbol') {
		return value.toString();
	}

	if (valueType === 'function') {
		const fn = value as Function;
		return `[Function ${fn.name || 'anonymous'}]`;
	}

	if (typeof ArrayBuffer !== 'undefined') {
		if (value instanceof ArrayBuffer) {
			return value;
		}
		if (ArrayBuffer.isView(value)) {
			const view = value as ArrayBufferView;
			if (seen.has(view as any)) {
				return '[Circular]';
			}
			seen.add(view as any);
			return view;
		}
	}

	if (value instanceof Date) {
		return value.toISOString();
	}

	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack
		};
	}

	if (Array.isArray(value)) {
		if (seen.has(value)) {
			return '[Circular]';
		}
		seen.add(value);
		return value.map(item => sanitizeForPostMessage(item, seen));
	}

	if (value instanceof Map) {
		if (seen.has(value)) {
			return '[Circular]';
		}
		seen.add(value);
		const mapObject: Record<string, unknown> = {};
		for (const [key, mapValue] of value.entries()) {
			mapObject[String(key)] = sanitizeForPostMessage(mapValue, seen);
		}
		return mapObject;
	}

	if (value instanceof Set) {
		if (seen.has(value)) {
			return '[Circular]';
		}
		seen.add(value);
		return Array.from(value, item => sanitizeForPostMessage(item, seen));
	}

	if (valueType === 'object') {
		const objectValue = value as Record<string, unknown>;
		if (seen.has(objectValue)) {
			return '[Circular]';
		}
		seen.add(objectValue);

		const serialized: Record<string, unknown> = {};
		for (const [key, nestedValue] of Object.entries(objectValue)) {
			serialized[key] = sanitizeForPostMessage(nestedValue, seen);
		}
		return serialized;
	}

	return String(value);
}

export function createWebviewOutputHandler(vscode: WebviewApiLike | undefined): typeof defaultOutputHandler {
	return (level: LogLevel, module: string, message: string, ...args: unknown[]) => {
		// 发送到扩展端
		if (vscode?.postMessage) {
			const safeArgs = args.map(arg => {
				try {
					return sanitizeForPostMessage(arg);
				} catch (error) {
					// 如果序列化失败，回退为字符串描述，避免中断原始日志
					return `[[Unserializable: ${error instanceof Error ? error.message : String(error)}]]`;
				}
			});

			try {
				vscode.postMessage({
					command: 'log',
					data: {
						level: levelNames[level].toLowerCase(),
						message: `[${module}] ${message}`,
						data: safeArgs
					}
				});
			} catch (postError) {
				console.error('[Webview Logger] Failed to post log message', postError);
			}
		}

		// 同时输出到浏览器控制台（开发时使用）
		defaultOutputHandler(level, module, message, ...args);
	};
}
