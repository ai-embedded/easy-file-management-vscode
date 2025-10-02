/**
 * Vue前端国际化配置
 */

import { createI18n } from 'vue-i18n';
import { Logger } from '../../shared/utils/Logger';

// Element Plus 语言包
let zhCnElementLocale: any;
let enElementLocale: any;

// 动态导入Element Plus语言包
try {
	zhCnElementLocale = require('element-plus/lib/locale/lang/zh-cn');
	enElementLocale = require('element-plus/lib/locale/lang/en');
} catch (error) {
	// 尝试其他路径
	try {
		zhCnElementLocale = require('element-plus/dist/locale/zh-cn.min.js');
		enElementLocale = require('element-plus/dist/locale/en.min.js');
	} catch (error2) {
		logger.warn('Failed to load Element Plus locales, using fallback', error2);
		// 使用简单的备用语言包
		zhCnElementLocale = { name: 'zh-cn' };
		enElementLocale = { name: 'en' };
	}
}

// 导入翻译文件
let zhCnMessages: any = {};
let enMessages: any = {};

try {
	zhCnMessages = require('../../../locales/zh-cn.json');
	enMessages = require('../../../locales/en.json');
} catch (error) {
	logger.warn('Failed to load translation files, using fallback', error);
	// 使用基本的备用翻译
	zhCnMessages = {
		ui: {
			common: {
				ok: '确定',
				cancel: '取消',
				save: '保存'
			}
		}
	};
	enMessages = {
		ui: {
			common: {
				ok: 'OK',
				cancel: 'Cancel',
				save: 'Save'
			}
		}
	};
}

const logger = new Logger('I18n');

// 语言映射
const LANGUAGE_MAPPING: Record<string, string> = {
	'zh-cn': 'zh-CN',
	'zh-tw': 'zh-CN', // 繁体中文暂时映射到简体中文
	'zh': 'zh-CN',
	'en': 'en',
	'en-us': 'en',
	'en-gb': 'en'
};

// Element Plus 语言包映射
const ELEMENT_LOCALES: Record<string, any> = {
	'zh-CN': zhCnElementLocale,
	'en': enElementLocale
};

// 合并消息：UI消息 + Element Plus消息
const messages = {
	'zh-CN': {
		...zhCnMessages
		// Element Plus的消息会通过ConfigProvider组件单独设置
	},
	'en': {
		...enMessages
		// Element Plus的消息会通过ConfigProvider组件单独设置
	}
};

/**
 * 创建i18n实例
 */
export const i18n = createI18n({
	legacy: false, // 使用Composition API模式
	locale: 'en', // 默认语言
	fallbackLocale: 'en', // 备用语言
	messages,
	globalInjection: true, // 全局注入$t函数
	silentTranslationWarn: false, // 在开发环境下显示翻译警告
	silentFallbackWarn: false
});

/**
 * 映射VSCode语言代码到i18n语言代码
 */
export function mapLanguage(vscodeLanguage: string): string {
	const normalizedLang = vscodeLanguage.toLowerCase().replace('_', '-');
	return LANGUAGE_MAPPING[normalizedLang] || 'en';
}

/**
 * 获取Element Plus语言包
 */
export function getElementLocale(language: string): any {
	const mappedLang = mapLanguage(language);
	return ELEMENT_LOCALES[mappedLang] || ELEMENT_LOCALES['en'];
}

/**
 * 切换语言
 */
export function switchLanguage(vscodeLanguage: string): string {
	const targetLanguage = mapLanguage(vscodeLanguage);

	if (!messages[targetLanguage as keyof typeof messages]) {
		logger.warn('Language not supported, fallback to English', { requestedLanguage: vscodeLanguage, targetLanguage });
		i18n.global.locale.value = 'en';
		return 'en';
	}

	i18n.global.locale.value = targetLanguage;
	logger.info('Language switched', { from: i18n.global.locale.value, to: targetLanguage, vscodeLanguage });

	return targetLanguage;
}

/**
 * 获取当前语言
 */
export function getCurrentLanguage(): string {
	return i18n.global.locale.value;
}

/**
 * 检测浏览器语言并设置初始语言
 */
export function detectAndSetInitialLanguage(): string {
	// 优先使用浏览器语言
	const browserLanguage = navigator.language || navigator.languages?.[0] || 'en';
	const initialLanguage = switchLanguage(browserLanguage);

	logger.info('Initial language detected and set', {
		browserLanguage,
		initialLanguage,
		availableLanguages: Object.keys(messages)
	});

	return initialLanguage;
}

/**
 * 添加语言变更监听器（用于Element Plus等组件的语言同步）
 */
export function onLanguageChange(callback: (language: string, elementLocale: any) => void): () => void {
	const unwatch = i18n.global.locale.value;

	// 创建一个响应式的语言变更监听器
	let currentLanguage = i18n.global.locale.value;

	const checkLanguageChange = () => {
		const newLanguage = i18n.global.locale.value;
		if (newLanguage !== currentLanguage) {
			currentLanguage = newLanguage;
			const elementLocale = getElementLocale(newLanguage);
			callback(newLanguage, elementLocale);
		}
	};

	// 使用定时器检查语言变更（简单实现）
	const interval = setInterval(checkLanguageChange, 100);

	// 立即调用一次
	const elementLocale = getElementLocale(currentLanguage);
	callback(currentLanguage, elementLocale);

	// 返回取消监听函数
	return () => {
		clearInterval(interval);
	};
}

/**
 * 翻译函数（兼容Vue组件外使用）
 */
export function t(key: string, params?: Record<string, any>): string {
	try {
		// 如果在Vue组件外使用，直接使用i18n的global实例
		if (params) {
			return i18n.global.t(key, params);
		}
		return i18n.global.t(key);
	} catch (error) {
		logger.warn('Translation failed, using key as fallback', { key, error });
		return key;
	}
}

/**
 * 检查是否存在指定key的翻译
 */
export function hasTranslation(key: string, locale?: string): boolean {
	const targetLocale = locale || getCurrentLanguage();
	try {
		return i18n.global.te(key, targetLocale);
	} catch {
		return false;
	}
}

// 导出类型定义
export type I18nInstance = typeof i18n;
export type Locale = keyof typeof messages;

// 默认导出
export default i18n;
