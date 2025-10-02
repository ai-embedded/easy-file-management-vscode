/**
 * FTP 安全工具
 * 提供路径净化和日志脱敏功能
 */

import { FtpConfig } from '../../../shared/types';

/**
 * 路径净化 - 防止路径遍历攻击
 */
export function sanitizePath(remotePath: string): string {
	// 移除路径遍历尝试
	let sanitized = remotePath.replace(/\.\.\/|\.\.\\/g, '');
	// 移除多余的斜杠
	sanitized = sanitized.replace(/\/+/g, '/');
	// 确保路径以斜杠开头（绝对路径）
	if (!sanitized.startsWith('/')) {
		sanitized = `/${  sanitized}`;
	}
	return sanitized;
}

/**
 * 日志脱敏 - 隐藏敏感信息
 */
export function maskSensitiveInfo(message: string, config?: FtpConfig | { host?: string; username?: string; password?: string; port?: number }): string {
	let masked = message;
	if (config) {
		// 隐藏密码（完全屏蔽）
		if (config.password) {
			masked = masked.replace(new RegExp(escapeRegExp(config.password), 'g'), '****');
		}
		// 隐藏用户名（保留首字母）
		if (config.username && config.username.length > 1) {
			const maskedUsername = config.username[0] + '*'.repeat(config.username.length - 1);
			masked = masked.replace(new RegExp(escapeRegExp(config.username), 'g'), maskedUsername);
		}
		// 隐藏主机地址的一部分
		if (config.host) {
			const hostParts = config.host.split('.');
			if (hostParts.length > 2) {
				const maskedHost = hostParts.map((part, i) => i < 2 ? part : '***').join('.');
				masked = masked.replace(new RegExp(escapeRegExp(config.host), 'g'), maskedHost);
			}
		}
	}
	return masked;
}

/**
 * 对配置对象进行脱敏（用于日志输出）
 */
export function maskConfig(config: FtpConfig | any): any {
	const masked = { ...config };
  
	// 密码完全屏蔽
	if (masked.password) {
		masked.password = '****';
	}
  
	// 用户名部分屏蔽
	if (masked.username && masked.username.length > 1) {
		masked.username = masked.username[0] + '*'.repeat(masked.username.length - 1);
	}
  
	// 主机地址部分屏蔽
	if (masked.host) {
		const hostParts = masked.host.split('.');
		if (hostParts.length > 2) {
			masked.host = hostParts.map((part: string, i: number) => i < 2 ? part : '***').join('.');
		}
	}
  
	return masked;
}

/**
 * 辅助函数：转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}