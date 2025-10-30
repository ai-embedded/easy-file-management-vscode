/**
 * HTTP桥接服务 - Webview层与Extension层的桥梁
 * 通过postMessage与Extension主进程通信
 */

import { GenericBridgeService } from './GenericBridgeService';
import type { OperationControlHooks } from './BaseBridgeService';
import type { StreamUploadOverrides } from './StreamUploadHelper';
import { normalizeRemotePath } from '@shared/utils/pathUtils';
import type {
	ConnectionConfig,
	UploadConfig,
	DownloadConfig
} from '@shared/types';

export class HttpBridgeService extends GenericBridgeService {
	private static readonly DEFAULT_CHUNK_SIZE = 1024 * 1024; // 1MB

	constructor() {
		super('http', { requestIdPrefix: 'http', defaultTimeoutMs: 30000 });
	}

	protected mapConnectPayload(config: ConnectionConfig): any {
		return {
			host: config.host,
			port: config.port,
			protocol: config.protocol || 'http',
			timeout: config.timeout,
			headers: config.headers
		};
	}

	async testConnection(config: ConnectionConfig): Promise<boolean> {
		const response = await this.sendCommand('testConnection', this.mapConnectPayload(config));
		return Boolean(response.success && response.data);
	}

	protected getStreamUploadOverrides(config: UploadConfig, hooks?: OperationControlHooks): StreamUploadOverrides | undefined {
		void hooks;
		if (!config.file) {
			return undefined;
		}
		const selectionTimestamp = config.selectedAt ?? new Date().toISOString();
		const uploadFields = { ...(config.fields ?? {}), clientSelectedAt: selectionTimestamp };
		return {
			chunkSize: config.chunkSize ?? HttpBridgeService.DEFAULT_CHUNK_SIZE,
			extraStartPayload: {
				fields: uploadFields,
				selectedAt: selectionTimestamp
			}
		};
	}

	protected mapDownloadPayload(config: DownloadConfig & { targetFile?: string }): Record<string, unknown> {
		const source = config.filePath ?? config.url;
		if (!source) {
			throw new Error('未提供远程文件路径');
		}

		const remotePath = normalizeRemotePath(source, '/', config.filename ?? '');
		const payload: Record<string, unknown> = {
			filename: config.filename
		};

		if (config.filePath) {
			payload.filePath = remotePath;
		} else {
			payload.url = remotePath;
		}

		if (typeof config.fileSize === 'number') {
			payload.fileSize = config.fileSize;
		}
		if (typeof config.chunkSize === 'number') {
			payload.chunkSize = config.chunkSize;
		}
		if (config.targetFile) {
			payload.targetPath = config.targetFile;
		}

		return payload;
	}
}
