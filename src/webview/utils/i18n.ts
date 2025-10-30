/**
 * 原生国际化实现（不依赖 Vue）
 */

import { Logger } from '@shared/utils/Logger';

// 导入翻译文件
let zhCnMessages: any = {};
let enMessages: any = {};

try {
    zhCnMessages = require('../../../locales/zh-cn.json');
    enMessages = require('../../../locales/en.json');
} catch (error) {
    console.warn('Failed to load translation files, using fallback', error);
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

// 合并消息
const messages: Record<string, any> = {
    'zh-CN': zhCnMessages,
    'en': enMessages
};

// 当前语言
let currentLanguage: string = 'en';

// 语言变更监听器
const languageChangeListeners: Array<(language: string) => void> = [];

/**
 * 映射VSCode语言代码到i18n语言代码
 */
export function mapLanguage(vscodeLanguage: string): string {
    const normalizedLang = vscodeLanguage.toLowerCase().replace('_', '-');
    return LANGUAGE_MAPPING[normalizedLang] || 'en';
}

/**
 * 切换语言
 */
export function switchLanguage(vscodeLanguage: string): string {
    const targetLanguage = mapLanguage(vscodeLanguage);

    if (!messages[targetLanguage]) {
        logger.warn('Language not supported, fallback to English', { requestedLanguage: vscodeLanguage, targetLanguage });
        currentLanguage = 'en';
        notifyLanguageChangeListeners('en');
        return 'en';
    }

    currentLanguage = targetLanguage;
    notifyLanguageChangeListeners(targetLanguage);
    logger.info('Language switched', { from: currentLanguage, to: targetLanguage, vscodeLanguage });

    return targetLanguage;
}

/**
 * 获取当前语言
 */
export function getCurrentLanguage(): string {
    return currentLanguage;
}

/**
 * 通知语言变更监听器
 */
function notifyLanguageChangeListeners(language: string): void {
    languageChangeListeners.forEach(listener => {
        try {
            listener(language);
        } catch (error) {
            logger.error('Language change listener error', error);
        }
    });
}

/**
 * 添加语言变更监听器
 */
export function onLanguageChange(callback: (language: string) => void): () => void {
    languageChangeListeners.push(callback);
    
    // 立即调用一次
    callback(currentLanguage);
    
    // 返回取消监听函数
    return () => {
        const index = languageChangeListeners.indexOf(callback);
        if (index > -1) {
            languageChangeListeners.splice(index, 1);
        }
    };
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
 * 获取嵌套对象的值
 */
function getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    let value = obj;
    for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
            value = value[key];
        } else {
            return undefined;
        }
    }
    return value;
}

/**
 * 翻译函数
 */
export function t(key: string, params?: Record<string, any>): string {
    try {
        const message = getNestedValue(messages[currentLanguage], key);
        
        if (message && typeof message === 'string') {
            if (params) {
                // 简单的参数替换
                return message.replace(/\{(\w+)\}/g, (match, name) => {
                    return params[name] !== undefined ? String(params[name]) : match;
                });
            }
            return message;
        }
        
        // 尝试使用备用语言
        const fallbackMessage = getNestedValue(messages['en'], key);
        if (fallbackMessage && typeof fallbackMessage === 'string') {
            logger.warn('Translation not found in current language, using fallback', { key, language: currentLanguage });
            if (params) {
                return fallbackMessage.replace(/\{(\w+)\}/g, (match, name) => {
                    return params[name] !== undefined ? String(params[name]) : match;
                });
            }
            return fallbackMessage;
        }
        
        // 如果都找不到，返回 key
        logger.warn('Translation not found, using key as fallback', { key, language: currentLanguage });
        return key;
    } catch (error) {
        logger.warn('Translation failed, using key as fallback', { key, error });
        return key;
    }
}

/**
 * 检查是否存在指定key的翻译
 */
export function hasTranslation(key: string, locale?: string): boolean {
    const targetLocale = locale || currentLanguage;
    try {
        const message = getNestedValue(messages[targetLocale], key);
        return message !== undefined && typeof message === 'string';
    } catch {
        return false;
    }
}

// 默认导出
export default {
    t,
    switchLanguage,
    getCurrentLanguage,
    detectAndSetInitialLanguage,
    onLanguageChange,
    hasTranslation,
    mapLanguage
};
