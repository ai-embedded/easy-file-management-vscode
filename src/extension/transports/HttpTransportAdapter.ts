import * as path from 'path';
import type { BackendResponse, UploadConfig } from '../../shared/types';
import type { TransportAdapter, TransportOperationDefinition, TransportRuntimeContext } from './types';
import { ChunkBufferTransformer } from './ChunkBufferTransformer';
import { HttpClient, HttpStreamUploadHandle } from '../http/HttpClient';
import { normalizeRemotePath } from '../../shared/utils/pathUtils';
import type { MessageRouter } from '../MessageRouter';

interface HttpStreamUploadSessionState {
	sessionId: string;
	filename: string;
	targetPath: string;
	fileSize: number;
	chunkSize: number;
	totalChunks: number;
	nextChunkIndex: number;
	bytesSent: number;
	handle: HttpStreamUploadHandle;
	selectedAt?: string;
	selectionLagMs?: number;
	startedAt: number;
	handshakeDurationMs?: number;
}

export class HttpTransportAdapter implements TransportAdapter {
	public readonly kind = 'http';
	private client = new HttpClient();
	private chunkTransformer = new ChunkBufferTransformer();
	private streamUploads = new Map<string, HttpStreamUploadSessionState>();
	private downloadControllers = new Map<string, { controller: AbortController }>();

	async initialize(): Promise<void> {
	}

	getOperations(): TransportOperationDefinition[] {
		return [
			{ name: 'connect', handler: (data) => this.handleConnect(data) },
			{ name: 'disconnect', handler: () => this.handleDisconnect() },
			{ name: 'testConnection', handler: (data) => this.handleTestConnection(data) },
			{ name: 'listFiles', handler: (data) => this.handleListFiles(data), queue: { type: 'HTTP列出文件' } },
			{
				name: 'downloadFile',
				handler: (data, ctx) => this.handleDownloadFile(data, ctx),
				queue: { type: 'HTTP下载' }
			},
			{
				name: 'downloadAndSave',
				handler: (data, ctx) => this.handleDownloadAndSave(data, ctx),
				queue: { type: 'HTTP直存下载' }
			},
			{ name: 'streamUpload', handler: (data, ctx) => this.handleStreamUpload(data, ctx) },
			{ name: 'deleteFile', handler: (data) => this.handleDeleteFile(data), queue: { type: 'HTTP删除文件' } },
			{ name: 'renameFile', handler: (data) => this.handleRenameFile(data), queue: { type: 'HTTP重命名文件' } },
			{ name: 'createDirectory', handler: (data) => this.handleCreateDirectory(data), queue: { type: 'HTTP创建目录' } },
			{ name: 'getFileInfo', handler: (data) => this.handleGetFileInfo(data), queue: { type: 'HTTP获取文件信息' } },
			{ name: 'batch.operations', handler: (data, ctx) => this.handleBatchOperations(data, ctx) }
		];
	}

	dispose(): void {
		this.chunkTransformer.dispose();
	}

	async disconnect(): Promise<void> {
		await this.client.disconnect().catch(() => undefined);
	}

	async cancelOperation(requestId: string): Promise<boolean> {
		const entry = this.downloadControllers.get(requestId);
		if (!entry) {
			return false;
		}
		entry.controller.abort();
		this.downloadControllers.delete(requestId);
		return true;
	}

	private async handleConnect(config: any): Promise<BackendResponse> {
		const success = await this.client.connect(config);
		return { success, data: { connected: success } };
	}

	private async handleDisconnect(): Promise<BackendResponse> {
		await this.client.disconnect();
		return { success: true };
	}

	private async handleTestConnection(config: any): Promise<BackendResponse> {
		const success = await this.client.testConnection(config ?? {});
		if (!success) {
			return { success: false, error: '无法连接到 HTTP 服务' };
		}
		return { success: true, data: { connected: true } };
	}

	private async handleListFiles(data: any): Promise<BackendResponse> {
		const remotePath = typeof data?.path === 'string' ? data.path : '/';
		const files = await this.client.listFiles(remotePath);
		return { success: true, data: { files } };
	}

	private async handleDownloadFile(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const progressCallback = context.getProgressCallback();
		const targetPath = typeof data?.targetPath === 'string' && data.targetPath.trim().length > 0
			? data.targetPath.trim()
			: undefined;

		if (targetPath) {
			return this.handleDownloadToPath({ ...data, targetPath }, context);
		}

		const downloadUrl = this.resolveDownloadUrl(data.url, data.filePath);
		const buffer = await this.client.downloadFile({
			url: downloadUrl,
			filePath: data.filePath || data.url,
			filename: data.filename,
			onProgress: progressCallback
		});

		return { success: true, data: { blob: buffer } };
	}

	private async handleDownloadAndSave(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		return this.handleDownloadToPath(data, context);
	}

	private async handleDownloadToPath(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const targetPath = typeof data?.targetPath === 'string' && data.targetPath.trim().length > 0
			? data.targetPath.trim()
			: undefined;
		if (!targetPath) {
			return { success: false, error: '缺少 targetPath 参数' };
		}

		const progressCallback = context.getProgressCallback();
		const controller = new AbortController();
		const requestId = context.requestId ?? '';
		this.downloadControllers.set(requestId, { controller });
		context.setActiveOperation({ type: 'HTTP下载', status: 'running', startTime: Date.now() });

		try {
			const downloadUrl = this.resolveDownloadUrl(data.url, data.filePath);
			const result = await this.client.downloadAndSave({
				url: downloadUrl,
				targetPath,
				filename: data.filename,
				onProgress: progressCallback
			}, {
				signal: controller.signal,
				operationId: requestId
			});

			return { success: result.success, data: result, message: result.message };
		} catch (error) {
			if (error instanceof Error && error.message === 'OPERATION_CANCELLED') {
				return { success: false, error: '操作已取消' };
			}
			throw error;
		} finally {
			this.downloadControllers.delete(requestId);
			context.clearActiveOperation();
		}
	}

	private async handleStreamUpload(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const action = data?.action;
		if (!action) {
			return { success: false, error: '缺少 action 参数' };
		}

		if (action === 'start') {
			const filename = typeof data?.filename === 'string' ? data.filename : undefined;
			const fileSize = Number(data?.fileSize ?? 0);
			const requestedChunkSize = Number(data?.chunkSize ?? 0);
			const targetPath = typeof data?.targetPath === 'string'
				? data.targetPath
				: (typeof data?.path === 'string' ? data.path : '/');
			const uploadUrl = this.resolveUploadUrl(data.url);
			const fields = this.buildUploadFields(targetPath, data);
			const selectedAt = typeof data?.selectedAt === 'string' ? data.selectedAt : undefined;
			const selectedTimestamp = selectedAt ? Date.parse(selectedAt) : undefined;

			if (!filename) {
				return { success: false, error: '缺少文件名' };
			}
			if (!Number.isFinite(fileSize) || fileSize < 0) {
				return { success: false, error: '无效的文件大小' };
			}

			const handshakeStart = Date.now();
			const handle = await this.client.createStreamUploadSession({
				uploadUrl,
				targetPath,
				filename,
				totalSize: fileSize,
				fields,
				chunkSize: requestedChunkSize || undefined
			});
			const handshakeCompletedAt = Date.now();
			const handshakeDurationMs = handshakeCompletedAt - handshakeStart;
			const selectionLagMs = selectedTimestamp ? Math.max(0, handshakeStart - selectedTimestamp) : undefined;

			const acceptedChunkSize = handle.acceptedChunkSize || Math.max(64 * 1024, requestedChunkSize || 512 * 1024);
			const totalChunks = Math.max(1, Math.ceil(Math.max(fileSize, 1) / acceptedChunkSize));

			const state: HttpStreamUploadSessionState = {
				sessionId: handle.sessionId,
				filename,
				targetPath,
				fileSize,
				chunkSize: acceptedChunkSize,
				totalChunks,
				nextChunkIndex: 0,
				bytesSent: 0,
				handle,
				selectedAt,
				selectionLagMs,
				startedAt: handshakeCompletedAt,
				handshakeDurationMs
			};

			this.streamUploads.set(state.sessionId, state);

			return {
				success: true,
				data: {
					sessionId: state.sessionId,
					acceptedChunkSize,
					totalChunks
				}
			};
		}

		if (action === 'chunk') {
			const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : undefined;
			if (!sessionId || !this.streamUploads.has(sessionId)) {
				return { success: false, error: '上传会话不存在或已结束' };
			}

			const session = this.streamUploads.get(sessionId)!;
			const payload = data?.data ?? data?.chunk ?? data?.fileData;
			if (payload === undefined) {
				return { success: false, error: '缺少上传数据块' };
			}

			const expectedIndex = session.nextChunkIndex;
			const providedIndex = typeof data?.chunkIndex === 'number' ? data.chunkIndex : expectedIndex;
			if (providedIndex !== expectedIndex) {
				return { success: false, error: `分块序号不一致，期望 ${expectedIndex}，实际 ${providedIndex}` };
			}

			const buffer = await this.chunkTransformer.toBuffer(payload);
			await session.handle.writeChunk(buffer);
			session.nextChunkIndex += 1;
			session.bytesSent += buffer.length;
			return {
				success: true,
				data: {
					chunkIndex: expectedIndex,
					bytesSent: session.bytesSent,
					totalChunks: session.totalChunks
				}
			};
		}

		if (action === 'finish') {
			const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : undefined;
			if (!sessionId || !this.streamUploads.has(sessionId)) {
				return { success: false, error: '上传会话不存在或已结束' };
			}
			const session = this.streamUploads.get(sessionId)!;
			this.streamUploads.delete(sessionId);
			session.handle.finish().catch(() => undefined);
			return { success: true };
		}

		if (action === 'abort') {
			const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : undefined;
			if (sessionId && this.streamUploads.has(sessionId)) {
				const session = this.streamUploads.get(sessionId)!;
				this.streamUploads.delete(sessionId);
				await session.handle.abort(data?.reason).catch(() => undefined);
			}
			return { success: true };
		}

		return { success: false, error: `未知的流式上传操作: ${action}` };
	}

	private async handleDeleteFile(data: any): Promise<BackendResponse> {
		const pathValue = typeof data?.path === 'string' ? data.path : '';
		const result = await this.client.deleteFile(pathValue);
		return { success: result.success, data: result };
	}

	private async handleRenameFile(data: any): Promise<BackendResponse> {
		const oldPath = typeof data?.oldPath === 'string' ? data.oldPath : '';
		const newPath = typeof data?.newPath === 'string' ? data.newPath : '';
		const result = await this.client.renameFile(oldPath, newPath);
		return { success: result.success, data: result };
	}

	private async handleCreateDirectory(data: any): Promise<BackendResponse> {
		const dirPath = typeof data?.path === 'string' ? data.path : '';
		const result = await this.client.createDirectory(dirPath);
		return { success: result.success, data: result };
	}

	private async handleGetFileInfo(data: any): Promise<BackendResponse> {
		const filePath = typeof data?.path === 'string' ? data.path : '';
		const info = await this.client.getFileInfo(filePath);
		return { success: true, data: info };
	}

	private async handleBatchOperations(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const operations = Array.isArray(data?.operations) ? data.operations : [];
		const results: any[] = [];

		for (const op of operations) {
			const name = op?.name;
			const payload = op?.data ?? {};
			switch (name) {
				case 'delete':
					results.push(await this.handleDeleteFile(payload));
					break;
				case 'rename':
					results.push(await this.handleRenameFile(payload));
					break;
				case 'createDirectory':
					results.push(await this.handleCreateDirectory(payload));
					break;
				case 'download':
					results.push(await this.handleDownloadFile(payload, context));
					break;
				case 'upload':
					results.push(await this.handleUploadInBatch(payload, context));
					break;
				default:
					results.push({ success: false, error: `未知的批量操作: ${name}` });
			}
		}

		return { success: true, data: { results } };
	}

	private async handleUploadInBatch(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const progress = context.getProgressCallback();
		const uploadConfig: UploadConfig = {
			file: data.file,
			buffer: data.buffer,
			filename: data.filename,
			targetPath: data.targetPath,
			onProgress: progress
		};

		const result = await this.client.uploadFile(uploadConfig);
		return { success: result.success, data: result, message: result.message };
	}

	private resolveDownloadUrl(url?: string, filePath?: string): string | undefined {
		if (url) {return url;}
		if (filePath) {return normalizeRemotePath(filePath, '/', path.basename(filePath));}
		return undefined;
	}

	private resolveUploadUrl(url?: string): string {
		if (typeof url === 'string' && url.trim().length > 0) {
			return url;
		}
		return '/api/files/upload';
	}

	private buildUploadFields(targetPath: string, data: any): Record<string, any> {
		const fields = { ...(data?.fields ?? {}) };
		fields.targetPath = targetPath;
		return fields;
	}
}
