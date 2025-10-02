import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { BackendResponse, ProgressInfo, FileItem } from '../../shared/types';
import type { TransportAdapter, TransportOperationDefinition, TransportRuntimeContext } from './types';
import { ChunkBufferTransformer } from './ChunkBufferTransformer';
import { TcpClient } from '../tcp/TcpClient';
import { handleInterruptedDownload } from '../utils/DownloadCleanup';
import { Logger } from '../../shared/utils/Logger';
import type { MessageRouter } from '../MessageRouter';

interface StreamUploadSessionState {
	sessionId: string;
	filename: string;
	targetPath: string;
	fileSize: number;
	chunkSize: number;
	totalChunks: number;
	nextChunkIndex: number;
	bytesSent: number;
}

interface StreamDownloadState {
	sessionId?: string;
	filePath: string;
	targetPath: string;
	requestId: string;
	startTime: number;
	aborted: boolean;
	expectedSize?: number;
	bytesWritten?: number;
}

export class TcpTransportAdapter implements TransportAdapter {
	public readonly kind = 'tcp';
	private client = new TcpClient();
	private chunkTransformer = new ChunkBufferTransformer();
	private streamUploads = new Map<string, StreamUploadSessionState>();
	private streamDownloads = new Map<string, StreamDownloadState>();
	private readonly logger = new Logger('Extension:TcpTransportAdapter');

	async initialize(): Promise<void> {
	}

	getOperations(): TransportOperationDefinition[] {
		return [
			{ name: 'connect', handler: (data) => this.handleConnect(data) },
			{ name: 'disconnect', handler: () => this.handleDisconnect() },
			{ name: 'testConnection', handler: (data) => this.handleTestConnection(data) },
			{ name: 'listFiles', handler: (data) => this.handleListFiles(data) },
			{
				name: 'downloadFile',
				handler: (data, ctx) => this.handleDownloadFile(data, ctx),
				queue: { type: 'TCP下载' }
			},
			{ name: 'streamUpload', handler: (data) => this.executeStreamUpload(data), queue: { type: 'TCP流式上传', manageActive: false } },
			{ name: 'streamDownload', handler: (data, ctx) => this.executeStreamDownload(data, ctx), queue: { type: 'TCP流式下载', manageActive: false } },
			{ name: 'deleteFile', handler: (data) => this.handleDeleteFile(data) },
			{ name: 'renameFile', handler: (data) => this.handleRenameFile(data) },
			{ name: 'createDirectory', handler: (data) => this.handleCreateDirectory(data) },
			{ name: 'getFileInfo', handler: (data) => this.handleGetFileInfo(data) },
			{ name: 'batch.listFiles', handler: (data) => this.handleBatchListFiles(data) },
			{ name: 'batch.deleteFiles', handler: (data) => this.handleBatchDeleteFiles(data) },
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
		let cancelled = false;
		for (const [sessionId, state] of this.streamDownloads.entries()) {
			if (state.requestId === requestId) {
				state.aborted = true;
				await this.client.downloadStreamAbort(sessionId).catch(() => undefined);
				this.streamDownloads.delete(sessionId);
				cancelled = true;
			}
		}
		return cancelled;
	}

	onConnectionStateChange(listener: Parameters<TcpClient['onConnectionStateChange']>[0]): void {
		this.client.onConnectionStateChange(listener);
	}

	private async handleConnect(config: any): Promise<BackendResponse> {
		const success = await this.client.connectWithConfig(config);
		if (!success) {
			const errorMessage = this.client.getLastConnectError() || '连接失败';
			return {
				success: false,
				message: errorMessage,
				data: {
					connected: false,
					error: errorMessage
				}
			};
		}

		return { success: true, data: { connected: true } };
	}

	private async handleDisconnect(): Promise<BackendResponse> {
		await this.client.disconnect();
		return { success: true };
	}

	private async handleTestConnection(config: any): Promise<BackendResponse> {
		const testClient = new TcpClient();
		try {
			const connected = await testClient.connectWithConfig(config);
			if (!connected) {
				return {
					success: false,
					error: testClient.getLastConnectError() || '无法建立 TCP 连接'
				};
			}
			return { success: true, data: { connected: true } };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'TCP 测试连接失败'
			};
		} finally {
			await testClient.disconnect().catch(() => undefined);
		}
	}

	private async handleListFiles(data: any): Promise<BackendResponse> {
		const remotePath = typeof data?.path === 'string' ? data.path : '/';
		const files = await this.client.listFiles(remotePath);
		return { success: true, data: { files } };
	}

	private async handleDownloadFile(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const targetPath = typeof data?.targetPath === 'string' && data.targetPath.trim().length > 0
			? data.targetPath.trim()
			: undefined;
		if (targetPath) {
			return this.downloadToPath({ ...data, targetPath }, context);
		}

		const progressCallback = context.getProgressCallback();
		const blob = await this.client.downloadFile({
			filePath: data.filePath,
			filename: data.filename,
			onProgress: progressCallback
		});
		return { success: true, data: { blob } };
	}

	private async executeStreamUpload(data: any): Promise<BackendResponse> {
		const action = data?.action;
		if (!action) {
			return { success: false, error: '缺少 action 参数' };
		}

		if (action === 'start') {
			const filename = typeof data?.filename === 'string' ? data.filename : undefined;
			const targetPath = typeof data?.targetPath === 'string' ? data.targetPath : '/';
			const fileSize = Number(data?.fileSize ?? 0);
			const requestedChunkSize = Number(data?.chunkSize ?? 256 * 1024);

			if (!filename) {
				return { success: false, error: '缺少文件名' };
			}
			if (!fileSize || fileSize < 0) {
				return { success: false, error: '无效的文件大小' };
			}

			const chunkSize = Math.max(8 * 1024, Math.min(requestedChunkSize || 256 * 1024, TcpClient.MAX_SAFE_CHUNK_SIZE));
			const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));

			const initResponse = await this.client.uploadInit(targetPath, filename, {
				size: fileSize,
				chunkSize,
				totalChunks
			});

			if (!initResponse.success) {
				return {
					success: false,
					error: initResponse.message || '上传会话初始化失败'
				};
			}

			const acceptedChunkSize = typeof initResponse.acceptedChunkSize === 'number'
				? initResponse.acceptedChunkSize
				: chunkSize;
			const backendSessionId = initResponse.sessionId ?? initResponse.data?.sessionId ?? randomUUID();
			this.streamUploads.set(backendSessionId, {
				sessionId: backendSessionId,
				filename,
				targetPath,
				fileSize,
				chunkSize: acceptedChunkSize,
				totalChunks,
				nextChunkIndex: 0,
				bytesSent: 0
			});

			return {
				success: true,
				data: {
					sessionId: backendSessionId,
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
			if (!payload) {
				return { success: false, error: '缺少上传数据块' };
			}

			const buffer = await this.chunkTransformer.toBuffer(payload);
			const expectedIndex = session.nextChunkIndex;
			const providedIndex = typeof data?.chunkIndex === 'number' ? data.chunkIndex : expectedIndex;
			if (providedIndex !== expectedIndex) {
				return { success: false, error: `分块序号不一致，期望 ${expectedIndex}，实际 ${providedIndex}` };
			}

			const response = await this.client.uploadChunk(buffer, expectedIndex, session.totalChunks, session.sessionId);
			if (!response.success) {
				return {
					success: false,
					error: response.message || '上传数据块失败'
				};
			}

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
			const response = await this.client.uploadComplete(session.totalChunks, session.fileSize, session.sessionId);
			this.streamUploads.delete(sessionId);
			return {
				success: response.success,
				data: response,
				error: response.success ? undefined : response.message
			};
		}

		if (action === 'abort') {
			const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : undefined;
			if (sessionId && this.streamUploads.has(sessionId)) {
				this.streamUploads.delete(sessionId);
			}
			return { success: true };
		}

		return { success: false, error: `未知的流式上传操作: ${action}` };
	}

	private async executeStreamDownload(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const action = data?.action;
		const requestId = context.requestId ?? '';

		if (!action) {
			return { success: false, error: '缺少 action 参数' };
		}

		if (action === 'start') {
			return this.downloadToPath(data, context);
		}

		if (action === 'abort') {
			const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : undefined;
			if (!sessionId || !this.streamDownloads.has(sessionId)) {
				return { success: true };
			}

			const state = this.streamDownloads.get(sessionId)!;
			state.aborted = true;
			await this.client.downloadStreamAbort(sessionId).catch(() => undefined);
			this.streamDownloads.delete(sessionId);
			context.clearActiveOperation();
			await handleInterruptedDownload({
				targetPath: state.targetPath,
				expectedSize: state.expectedSize,
				bytesWritten: state.bytesWritten,
				reason: 'cancelled',
				transport: 'TCP',
				logger: this.logger
			}).catch(() => undefined);

			return { success: true };
		}

		return { success: false, error: `未知的流式下载操作: ${action}` };
	}

	private async downloadToPath(rawData: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const filePath = typeof rawData?.filePath === 'string' ? rawData.filePath : undefined;
		const targetPathRaw = typeof rawData?.targetPath === 'string' ? rawData.targetPath.trim() : '';
		const targetPath = targetPathRaw.length > 0 ? targetPathRaw : undefined;
		const requestedChunkSize = Number.isFinite(rawData?.chunkSize) ? Number(rawData.chunkSize) : undefined;
		const progressCallback = context.getProgressCallback();
		const requestId = context.requestId ?? '';

		if (!filePath) {
			return { success: false, error: '缺少 filePath 参数' };
		}
		if (!targetPath) {
			return { success: false, error: '缺少 targetPath 参数' };
		}

		context.setActiveOperation({ type: 'TCP下载', status: 'running', startTime: Date.now() });

		const expectedSize = typeof rawData?.fileSize === 'number' && Number.isFinite(rawData.fileSize) && rawData.fileSize > 0
			? rawData.fileSize
			: undefined;

		const sessionState: StreamDownloadState = {
			filePath,
			targetPath,
			requestId,
			startTime: Date.now(),
			aborted: false,
			expectedSize,
			bytesWritten: 0
		};

		let sessionId: string | undefined;

		try {
			const progressProxy = progressCallback
				? (progress: ProgressInfo) => {
					if (typeof progress?.loaded === 'number') {
						sessionState.bytesWritten = progress.loaded;
					}
					progressCallback?.(progress);
				}
				: (progress: ProgressInfo) => {
					if (typeof progress?.loaded === 'number') {
						sessionState.bytesWritten = progress.loaded;
					}
				};

			await this.client.downloadFile({
				filePath,
				targetFile: targetPath,
				filename: path.basename(targetPath),
				chunkSize: requestedChunkSize,
				fileSize: rawData.fileSize,
				onProgress: progressProxy,
				shouldAbort: () => sessionState.aborted,
				onSession: info => {
					sessionId = info.sessionId;
					sessionState.sessionId = info.sessionId;
					this.streamDownloads.set(info.sessionId, sessionState);
				}
			});

			context.clearActiveOperation();
			if (sessionId) {
				this.streamDownloads.delete(sessionId);
			}

			const finalSize = rawData.fileSize ?? (await fs.promises.stat(targetPath).catch(() => ({ size: 0 }))).size;
			return {
				success: true,
				data: {
					success: true,
					targetPath,
					bytesWritten: finalSize,
					fileSize: finalSize
				}
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (sessionId) {
				await this.client.downloadStreamAbort(sessionId).catch(() => undefined);
				this.streamDownloads.delete(sessionId);
			}
			context.clearActiveOperation();
			const cleanupReason = message === 'DOWNLOAD_ABORTED' ? 'cancelled' : 'error';
			await handleInterruptedDownload({
				targetPath,
				expectedSize: sessionState.expectedSize,
				bytesWritten: sessionState.bytesWritten,
				reason: cleanupReason,
				transport: 'TCP',
				logger: this.logger
			}).catch(() => undefined);
			if (cleanupReason === 'cancelled') {
				return { success: false, error: '下载已取消' };
			}
			return {
				success: false,
				error: message
			};
		}
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
		const targetPath = typeof data?.path === 'string' ? data.path : '';
		if (!targetPath) {
			return { success: false, error: '缺少文件路径' };
		}

		const result = await this.client.getFileInfo(targetPath);
		if (!result.success) {
			return { success: false, error: result.message ?? '获取文件信息失败' };
		}

		const raw = (result.data as any)?.files?.[0] ?? {};
		const resolvedPath = typeof raw.path === 'string' ? raw.path : targetPath;
		const resolvedName = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : path.basename(resolvedPath);
		const resolvedSizeSource = (result.data as any)?.fileSize ?? raw.size;
		const resolvedSize = typeof resolvedSizeSource === 'string'
			? Number(resolvedSizeSource)
			: (typeof resolvedSizeSource === 'number' ? resolvedSizeSource : 0);
		const resolvedLastModifiedRaw = raw.lastModified ?? (result.data as any)?.lastModified;
		let resolvedLastModified: Date;
		if (typeof resolvedLastModifiedRaw === 'string') {
			const parsed = new Date(resolvedLastModifiedRaw);
			resolvedLastModified = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
		} else if (resolvedLastModifiedRaw instanceof Date) {
			resolvedLastModified = resolvedLastModifiedRaw;
		} else {
			resolvedLastModified = new Date();
		}

		const fileInfo: FileItem = {
			name: resolvedName,
			path: resolvedPath,
			type: typeof raw.type === 'string' ? raw.type : 'file',
			size: Number.isFinite(resolvedSize) ? resolvedSize : 0,
			lastModified: resolvedLastModified,
			permissions: typeof raw.permissions === 'string' ? raw.permissions : undefined,
			isReadonly: Boolean(raw.isReadonly)
		};

		return { success: true, data: fileInfo };
	}

	private async handleBatchListFiles(data: any): Promise<BackendResponse> {
		const paths = Array.isArray(data?.paths) ? data.paths : [];
		const results: Record<string, any> = {};

		for (const remotePath of paths) {
			try {
				results[remotePath] = await this.client.listFiles(remotePath);
			} catch (error) {
				results[remotePath] = {
					success: false,
					error: error instanceof Error ? error.message : String(error)
				};
			}
		}

		return { success: true, data: { results } };
	}

	private async handleBatchDeleteFiles(data: any): Promise<BackendResponse> {
		const paths = Array.isArray(data?.paths) ? data.paths : [];
		const results: Array<{ path: string; success: boolean; error?: string }> = [];

		for (const remotePath of paths) {
			try {
				const result = await this.client.deleteFile(remotePath);
				results.push({ path: remotePath, success: result.success, error: result.message });
			} catch (error) {
				results.push({
					path: remotePath,
					success: false,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}

		return { success: true, data: { results } };
	}

	private async handleBatchOperations(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const operations = Array.isArray(data?.operations) ? data.operations : [];
		if (operations.length === 0) {
			return { success: false, error: '缺少批量操作任务' };
		}

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
				case 'upload':
					results.push({ success: false, error: 'TCP 仅支持流式上传，请改用 streamUpload' });
					break;
				case 'download':
					results.push(await this.handleDownloadFile(payload, context));
					break;
				default:
					results.push({ success: false, error: `未知的批量操作: ${name}` });
			}
		}

		return { success: true, data: { results } };
	}
}
