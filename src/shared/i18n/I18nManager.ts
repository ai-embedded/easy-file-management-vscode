/**
 * 国际化管理器 - 支持VSCode扩展和Webview的多语言
 */

import * as fs from 'fs';
import * as path from 'path';

// 支持的语言映射
const LANGUAGE_MAPPING: Record<string, string> = {
	'zh-cn': 'zh-cn',
	'zh-tw': 'zh-cn', // 繁体中文暂时映射到简体中文
	'zh': 'zh-cn',
	'en': 'en',
	'en-us': 'en',
	'en-gb': 'en'
	// 可以添加更多语言映射
};

// 默认语言
const DEFAULT_LANGUAGE = 'en';

export interface I18nMessages {
	[key: string]: any;
}

export class I18nManager {
	private currentLanguage: string = DEFAULT_LANGUAGE;
	private messages: Record<string, I18nMessages> = {};
	private extensionPath: string;
	private changeListeners: Array<(language: string, messages: I18nMessages) => void> = [];

	constructor(extensionPath: string) {
		this.extensionPath = extensionPath;
		this.loadAllLanguages();
	}

	/**
	 * 加载所有语言文件
	 */
	private loadAllLanguages(): void {
		try {
			const localesPath = path.join(this.extensionPath, 'locales');

			if (!fs.existsSync(localesPath)) {
				console.warn('[I18nManager] Locales directory not found, using fallback messages');
				this.initializeFallbackMessages();
				return;
			}

			const files = fs.readdirSync(localesPath);

			for (const file of files) {
				if (!file.endsWith('.json')) {continue;}

				const language = path.basename(file, '.json');
				const filePath = path.join(localesPath, file);

				try {
					const content = fs.readFileSync(filePath, 'utf-8');
					this.messages[language] = JSON.parse(content);
					console.log(`[I18nManager] Loaded language: ${language}`);
				} catch (error) {
					console.error(`[I18nManager] Failed to load language file ${file}:`, error);
				}
			}

			// 确保至少有默认语言
			if (!this.messages[DEFAULT_LANGUAGE]) {
				console.warn('[I18nManager] Default language not found, initializing fallback');
				this.initializeFallbackMessages();
			}

		} catch (error) {
			console.error('[I18nManager] Failed to load languages:', error);
			this.initializeFallbackMessages();
		}
	}

	/**
	 * 初始化备用消息（当语言文件加载失败时使用）
	 */
	private initializeFallbackMessages(): void {
		this.messages[DEFAULT_LANGUAGE] = {
			extension: {
				title: 'Easy File',
				description: 'A multi-protocol file transfer tool',
				commands: {
					openPanel: 'Open Easy File'
				}
			},
			ui: {
				common: {
					ok: 'OK',
					cancel: 'Cancel',
					save: 'Save',
					delete: 'Delete',
					loading: 'Loading...',
					error: 'Error',
					success: 'Success'
				}
			}
		};
	}

	/**
	 * 设置当前语言
	 */
	setLanguage(language: string): void {
		const mappedLanguage = this.mapLanguage(language);

		if (mappedLanguage === this.currentLanguage) {
			return; // 语言未改变
		}

		if (!this.messages[mappedLanguage]) {
			console.warn(`[I18nManager] Language ${mappedLanguage} not available, using ${DEFAULT_LANGUAGE}`);
			this.currentLanguage = DEFAULT_LANGUAGE;
		} else {
			this.currentLanguage = mappedLanguage;
		}

		console.log(`[I18nManager] Language changed to: ${this.currentLanguage}`);
		this.notifyLanguageChange();
	}

	/**
	 * 映射VSCode语言代码到支持的语言
	 */
	private mapLanguage(language: string): string {
		const normalizedLang = language.toLowerCase().replace('_', '-');
		return LANGUAGE_MAPPING[normalizedLang] || DEFAULT_LANGUAGE;
	}

	/**
	 * 获取当前语言
	 */
	getCurrentLanguage(): string {
		return this.currentLanguage;
	}

	/**
	 * 获取当前语言的消息
	 */
	getMessages(): I18nMessages {
		return this.messages[this.currentLanguage] || this.messages[DEFAULT_LANGUAGE] || {};
	}

	/**
	 * 获取指定语言的消息
	 */
	getMessagesForLanguage(language: string): I18nMessages {
		const mappedLanguage = this.mapLanguage(language);
		return this.messages[mappedLanguage] || this.messages[DEFAULT_LANGUAGE] || {};
	}

	/**
	 * 获取指定语言的翻译文本
	 */
	tForLanguage(language: string, key: string, params: Record<string, any> = {}): string {
		const mappedLanguage = this.mapLanguage(language);
		const messages = this.messages[mappedLanguage] || this.messages[DEFAULT_LANGUAGE] || {};
		const value = this.getNestedValue(messages, key);

		if (typeof value === 'string') {
			return this.replaceParams(value, params);
		}

		if (mappedLanguage !== DEFAULT_LANGUAGE) {
			const fallbackValue = this.getNestedValue(this.messages[DEFAULT_LANGUAGE] || {}, key);
			if (typeof fallbackValue === 'string') {
				return this.replaceParams(fallbackValue, params);
			}
		}

		console.warn(`[I18nManager] Translation not found for key: ${key} (language: ${mappedLanguage})`);
		return key;
	}

	/**
	 * 获取翻译文本
	 */
	t(key: string, params: Record<string, any> = {}): string {
		const messages = this.getMessages();
		const value = this.getNestedValue(messages, key);

		if (typeof value !== 'string') {
			// 如果在当前语言中找不到，尝试使用默认语言
			if (this.currentLanguage !== DEFAULT_LANGUAGE) {
				const defaultValue = this.getNestedValue(this.messages[DEFAULT_LANGUAGE] || {}, key);
				if (typeof defaultValue === 'string') {
					return this.replaceParams(defaultValue, params);
				}
			}

			console.warn(`[I18nManager] Translation not found for key: ${key}`);
			return key; // 返回key本身作为备用
		}

		return this.replaceParams(value, params);
	}

	/**
	 * 获取嵌套对象的值
	 */
	private getNestedValue(obj: any, key: string): any {
		const keys = key.split('.');
		let current = obj;

		for (const k of keys) {
			if (current && typeof current === 'object' && k in current) {
				current = current[k];
			} else {
				return undefined;
			}
		}

		return current;
	}

	/**
	 * 替换参数占位符
	 */
	private replaceParams(text: string, params: Record<string, any>): string {
		let result = text;

		for (const [key, value] of Object.entries(params)) {
			const placeholder = `{${key}}`;
			result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), String(value));
		}

		return result;
	}

	/**
	 * 添加语言变更监听器
	 */
	onLanguageChange(listener: (language: string, messages: I18nMessages) => void): () => void {
		this.changeListeners.push(listener);

		// 返回取消订阅函数
		return () => {
			const index = this.changeListeners.indexOf(listener);
			if (index > -1) {
				this.changeListeners.splice(index, 1);
			}
		};
	}

	/**
	 * 通知语言变更
	 */
	private notifyLanguageChange(): void {
		const messages = this.getMessages();
		this.changeListeners.forEach(listener => {
			try {
				listener(this.currentLanguage, messages);
			} catch (error) {
				console.error('[I18nManager] Error in language change listener:', error);
			}
		});
	}

	/**
	 * 重新加载语言文件
	 */
	reload(): void {
		const currentLang = this.currentLanguage;
		this.messages = {};
		this.changeListeners = [];
		this.loadAllLanguages();
		this.setLanguage(currentLang);
	}

	/**
	 * 获取所有可用的语言
	 */
	getAvailableLanguages(): string[] {
		return Object.keys(this.messages);
	}

	/**
	 * 检查是否支持指定语言
	 */
	isLanguageSupported(language: string): boolean {
		const mappedLanguage = this.mapLanguage(language);
		return mappedLanguage in this.messages;
	}
}

// 全局实例（在extension激活时初始化）
let globalI18nManager: I18nManager | null = null;

/**
 * 初始化全局I18n管理器
 */
export function initializeGlobalI18n(extensionPath: string): I18nManager {
	globalI18nManager = new I18nManager(extensionPath);
	return globalI18nManager;
}

/**
 * 获取全局I18n管理器实例
 */
export function getGlobalI18n(): I18nManager | null {
	return globalI18nManager;
}

/**
 * 便捷翻译函数
 */
export function t(key: string, params?: Record<string, any>): string {
	if (!globalI18nManager) {
		console.warn('[I18n] Global I18n manager not initialized');
		return key;
	}
	return globalI18nManager.t(key, params);
}
