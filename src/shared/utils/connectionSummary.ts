import type { ConnectionConfig } from '../types';

export interface ConnectionLogSummary {
	hasConfig: boolean;
	type?: ConnectionConfig['type'];
	host?: string;
	port?: number;
	timeout?: number;
	protocol?: 'http' | 'https';
	headers?: string[];
	headersCount?: number;
	headersTruncated?: number;
	username?: string;
	passive?: boolean;
	secure?: boolean;
	hasPassword?: boolean;
	dataFormat?: string;
	path?: string;
	baudRate?: number;
	dataBits?: number;
	stopBits?: number;
	parity?: string;
	flowControl?: string;
}

const MAX_HEADER_KEYS = 5;

/**
 * 生成用于日志记录的连接配置概要，避免直接输出敏感信息。
 */
export function summarizeConnectionConfig(config?: ConnectionConfig | null): ConnectionLogSummary {
	if (!config) {
		return { hasConfig: false };
	}

	const summary: ConnectionLogSummary = {
		hasConfig: true,
		type: config.type,
		timeout: config.timeout
	};

	if (config.host) {
		summary.host = config.host;
	}

	if (typeof config.port === 'number' && Number.isFinite(config.port)) {
		summary.port = config.port;
	}

	switch (config.type) {
		case 'http': {
			summary.protocol = config.protocol ?? 'http';
			if (config.headers) {
				const headerKeys = Object.keys(config.headers);
				summary.headers = headerKeys.slice(0, MAX_HEADER_KEYS);
				summary.headersCount = headerKeys.length;
				if (headerKeys.length > MAX_HEADER_KEYS) {
					summary.headersTruncated = headerKeys.length - MAX_HEADER_KEYS;
				}
			}
			break;
		}
		case 'ftp': {
			summary.username = config.username;
			summary.passive = config.passive;
			if (typeof config.secure === 'boolean') {
				summary.secure = config.secure;
			}
			summary.hasPassword = Boolean(config.password);
			break;
		}
		case 'tcp': {
			summary.dataFormat = config.dataFormat ?? 'protobuf';
			break;
		}
		case 'serial':
		case 'uart':
		case 'usb': {
			summary.path = config.path;
			summary.baudRate = config.baudRate;
			summary.dataBits = config.dataBits;
			summary.stopBits = config.stopBits;
			summary.parity = config.parity;
			summary.flowControl = config.flowControl;
			break;
		}
		default:
			break;
	}

	return summary;
}
