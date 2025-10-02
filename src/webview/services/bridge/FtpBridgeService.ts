/**
 * FTP桥接服务 - Webview层与Extension层的桥梁
 * 通过postMessage与Extension主进程通信
 */

import { GenericBridgeService } from './GenericBridgeService';
import type { OperationControlHooks } from './BaseBridgeService';
import type { StreamUploadOverrides } from './StreamUploadHelper';
import type {
	ConnectionConfig,
	UploadConfig,
	DownloadConfig
} from '../../../shared/types';

export class FtpBridgeService extends GenericBridgeService {
	constructor() {
		super('ftp', { requestIdPrefix: 'ftp', defaultTimeoutMs: 60000 });
	}

	protected mapConnectPayload(config: ConnectionConfig): any {
		return {
			host: config.host,
			port: config.port || 21,
			username: config.username,
			password: config.password,
			secure: config.protocol === 'https',
			passive: config.passive !== false,
			timeout: config.timeout
		};
	}

	protected getStreamUploadOverrides(config: UploadConfig, hooks?: OperationControlHooks): StreamUploadOverrides | undefined {
		void hooks;
		if (!config.file) {
			return undefined;
		}
		const totalSize = config.file.size;
		const sizeInMB = Math.max(1, Math.ceil(Math.max(totalSize, 1) / (1024 * 1024)));
		const adaptiveTimeout = Math.max(120_000, Math.min(900_000, sizeInMB * 20_000));
		const handshakeTimeout = Math.min(
			adaptiveTimeout,
			Math.max(120_000, Math.min(300_000, Math.round(adaptiveTimeout * 0.25)))
		);
		const chunkEstimate = Math.max(1, Math.ceil(Math.max(totalSize, 1) / (512 * 1024)));
		const perChunkTimeout = Math.min(
			adaptiveTimeout,
			Math.max(60_000, Math.round(adaptiveTimeout / chunkEstimate))
		);
		return {
			chunkSize: 512 * 1024,
			handshakeTimeout,
			perChunkTimeout,
			finishTimeout: adaptiveTimeout
		};
	}

	protected resolveDownloadTimeout(config: DownloadConfig & { targetFile: string }): number | undefined {
		const fileSize = config.fileSize ?? 0;
		const sizeInMB = fileSize > 0 ? Math.max(1, Math.ceil(fileSize / (1024 * 1024))) : 0;
		const estimated = sizeInMB > 0 ? sizeInMB * 1_200 : 0;
		return estimated > 0 ? Math.min(900_000, Math.max(120_000, estimated)) : 300_000;
	}

}
