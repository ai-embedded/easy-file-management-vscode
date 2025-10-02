import { BaseBridgeService, OperationControlHooks } from './BaseBridgeService';
import type {
	ConnectionConfig,
	FileItem,
	FileOperationResult,
	UploadConfig,
	DownloadConfig,
	BackendResponse
} from '../../../shared/types';
import { getTransportDefinition, type TransportDefinition, type TransportKind } from '../../../shared/transport';
import { uploadFileViaStream, type StreamUploadOverrides } from './StreamUploadHelper';

interface GenericBridgeOptions {
	requestIdPrefix?: string;
	defaultTimeoutMs?: number;
}

export class GenericBridgeService extends BaseBridgeService {
	protected readonly transport: TransportKind;
	private readonly transportDefinition?: TransportDefinition;

	constructor(transport: TransportKind, options: GenericBridgeOptions = {}) {
		super(options.requestIdPrefix ?? transport, options.defaultTimeoutMs ?? 30000);
		this.transport = transport;
		this.transportDefinition = getTransportDefinition(transport);
	}

	protected getCommand(operation: string): string {
		return `backend.${this.transport}.${operation}`;
	}

	protected async sendCommand<T = any>(operation: string, payload?: any): Promise<{ success: boolean; data?: T; error?: string }> {
		const response = await this.sendToBackend(this.getCommand(operation), payload);
		return response as any;
	}

	protected decorateProgress(direction: 'upload' | 'download', handler?: (progress: any) => void): ((progress: any) => void) | undefined {
		if (!handler) {return undefined;}
		const transportLabel = this.transport.toUpperCase();
		return (progress: any) => {
			const enriched = {
				...progress,
				direction,
				transport: transportLabel
			};
			handler(enriched);
		};
	}

	protected mapConnectPayload(config: ConnectionConfig): any {
		return config;
	}

	async connect(config: ConnectionConfig): Promise<boolean> {
		const response = await this.sendCommand('connect', this.mapConnectPayload(config));
		this.isConnectedFlag = response.success;
		if (response.success) {
			this.config = config;
		}
		return response.success;
	}

	async disconnect(): Promise<void> {
		await this.sendCommand('disconnect', {});
		this.isConnectedFlag = false;
		this.config = undefined;
	}

	async testConnection(config: ConnectionConfig): Promise<boolean> {
		const response = await this.sendCommand('testConnection', this.mapConnectPayload(config));
		return Boolean(response.data);
	}

	async listFiles(path: string): Promise<FileItem[]> {
		const response = await this.sendCommand<{ files?: FileItem[] }>('listFiles', { path });
		if (!response.success) {
			throw new Error(response.error || '获取文件列表失败');
		}
		return response.data?.files ?? [];
	}

	async downloadFile(config: DownloadConfig): Promise<Blob> {
		const payload = this.mapDownloadPayload(config);
		const response = await this.sendOperationWithProgress(
			'downloadFile',
			payload,
			'download',
			config.onProgress
		);
		if (!response.success) {
			throw new Error(response.error || '文件下载失败');
		}
		const buffer = response.data?.blob || response.data;
		if (!buffer) {
			throw new Error('下载的文件数据无效');
		}
		return this.bufferToBlob(buffer);
	}

	async downloadFileToPath(config: DownloadConfig & { targetFile: string }, hooks?: OperationControlHooks): Promise<FileOperationResult> {
		if (!this.supportsDirectDownload()) {
			throw new Error('当前传输不支持直存下载');
		}
		const payload = this.mapDownloadPayload({ ...config, targetFile: config.targetFile });
		const response = await this.sendOperationWithProgress(
			'downloadFile',
			payload,
			'download',
			config.onProgress,
			hooks,
			this.resolveDownloadTimeout(config)
		);
		return this.createFileOperationResult(response, '文件下载成功', '文件下载失败');
	}

	async uploadFile(config: UploadConfig, hooks?: OperationControlHooks): Promise<FileOperationResult> {
		const supportsStream = this.supportsStreamUpload();
		const fileSupportsStream = config.file && this.canUseStreamUpload(config.file);

		if (supportsStream) {
			if (!fileSupportsStream) {
				throw new Error('当前传输仅支持流式上传，无法获取可流式读取的文件对象');
			}
			this.onBeforeStreamUpload(config, hooks);
			const overrides = this.getStreamUploadOverrides(config, hooks) ?? {};
			const onProgress = overrides.onProgress ?? this.decorateProgress('upload', config.onProgress);
			const result = await uploadFileViaStream({
				file: config.file!,
				targetPath: config.targetPath,
				chunkSize: overrides.chunkSize ?? config.chunkSize,
				extraStartPayload: overrides.extraStartPayload,
				handshakeTimeout: overrides.handshakeTimeout,
				perChunkTimeout: overrides.perChunkTimeout,
				finishTimeout: overrides.finishTimeout,
				hooks,
				onProgress: onProgress as any,
				send: (payload, sendOptions) => this.sendToBackend(this.getCommand('streamUpload'), payload, sendOptions),
				createResult: (response) => this.createFileOperationResult(response, '文件上传成功', '文件上传失败')
			});
			return result;
		}

		const response = await this.sendOperationWithProgress(
			'uploadFile',
			config,
			'upload',
			config.onProgress,
			hooks
		);
		return this.createFileOperationResult(response, '文件上传成功', '文件上传失败');
	}

	async deleteFile(path: string): Promise<FileOperationResult> {
		const response = await this.sendCommand('deleteFile', { path });
		return this.createFileOperationResult(response, '文件删除成功', '文件删除失败');
	}

	async renameFile(oldPath: string, newPath: string): Promise<FileOperationResult> {
		const response = await this.sendCommand('renameFile', { oldPath, newPath });
		return this.createFileOperationResult(response, '重命名成功', '重命名失败');
	}

	async createDirectory(path: string): Promise<FileOperationResult> {
		const response = await this.sendCommand('createDirectory', { path });
		return this.createFileOperationResult(response, '目录创建成功', '目录创建失败');
	}

	async getFileInfo(path: string): Promise<FileItem> {
		const response = await this.sendCommand('getFileInfo', { path });
		if (!response.success) {
			throw new Error(response.error || '获取文件信息失败');
		}
		return response.data as FileItem;
	}

	protected supportsDirectDownload(): boolean {
		return this.transportDefinition?.capabilities.directDownload ?? true;
	}

	protected supportsStreamUpload(): boolean {
		return this.transportDefinition?.capabilities.streamUpload ?? false;
	}

	protected canUseStreamUpload(file: File): boolean {
		return typeof (file as any).stream === 'function';
	}

	protected getStreamUploadOverrides(config: UploadConfig, hooks?: OperationControlHooks): StreamUploadOverrides | undefined {
		void config;
		void hooks;
		return undefined;
	}

	protected onBeforeStreamUpload(config: UploadConfig, hooks?: OperationControlHooks): void {
		void config;
		void hooks;
		// 默认无额外行为，子类可覆盖
	}

	protected mapDownloadPayload(config: DownloadConfig & { targetFile?: string }): Record<string, unknown> {
		const payload: Record<string, unknown> = {};
		if (config.filePath) {
			payload.filePath = config.filePath;
		}
		if (config.url) {
			payload.url = config.url;
		}
		if (config.filename) {
			payload.filename = config.filename;
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

	protected resolveDownloadTimeout(config: DownloadConfig & { targetFile: string }): number | undefined {
		void config;
		return undefined;
	}

	private async sendOperationWithProgress(
		operation: string,
		payload: any,
		direction: 'upload' | 'download',
		onProgress?: (progress: any) => void,
		hooks?: OperationControlHooks,
		timeout?: number
	): Promise<BackendResponse> {
		if (hooks?.isCancelled?.()) {
			return { success: false, error: '操作已取消' };
		}

		const requestId = this.generateRequestId();
		hooks?.onOperationStart?.(requestId);
		if (hooks?.registerCancelCallback) {
			hooks.registerCancelCallback(() => this.cancelBackendOperation(requestId));
		}

		const response = await this.sendToBackend(
			this.getCommand(operation),
			payload,
			{
				requestId,
				timeout,
				onProgress: this.decorateProgress(direction, onProgress)
			}
		);

		if (hooks?.isCancelled?.()) {
			return { success: false, error: '操作已取消' };
		}

		return response as BackendResponse;
	}
}
