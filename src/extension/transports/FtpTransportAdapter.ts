import * as fs from 'fs';
import type { BackendResponse, UploadConfig } from '../../shared/types';
import type { TransportAdapter, TransportOperationDefinition, TransportRuntimeContext } from './types';
import { ChunkBufferTransformer } from './ChunkBufferTransformer';
import { FtpClient, FtpStreamUploadHandle } from '../ftp/FtpClient';
import { CompatibleFtpClient } from '../ftp/CompatibleFtpClient';
import { FtpConfigGenerator } from '../../shared/ftp/OptimizedFtpConfig';
import { FtpMetricsAggregator } from '../ftp/metrics/FtpMetricsAggregator';
import type { MessageRouter } from '../MessageRouter';
import { ErrorFactory } from '../../shared/errors/ServiceError';

interface FtpStreamUploadSessionState {
	sessionId: string;
	filename: string;
	targetPath: string;
	fileSize: number;
	chunkSize: number;
	totalChunks: number;
	nextChunkIndex: number;
	bytesSent: number;
	handle: FtpStreamUploadHandle;
}

export class FtpTransportAdapter implements TransportAdapter {
	public readonly kind = 'ftp';
	private client!: FtpClient;
	private metricsAggregator = new FtpMetricsAggregator();
	private chunkTransformer = new ChunkBufferTransformer();
	private streamUploads = new Map<string, FtpStreamUploadSessionState>();
	private useCompatClient = true;

	async initialize(): Promise<void> {
		this.useCompatClient = process.env.FTP_USE_COMPAT_CLIENT !== 'false';
		if (this.useCompatClient) {
			const ftpConfig = FtpConfigGenerator.generateConfigFor('standard', 'balanced');
			this.client = new CompatibleFtpClient(ftpConfig);
			this.metricsAggregator.registerCompatibleClient(this.client as CompatibleFtpClient);
			const pool = (this.client as any).getConnectionPool?.();
			if (pool) {
				this.metricsAggregator.registerConnectionPool(pool);
			}
		} else {
			this.client = new FtpClient();
			this.metricsAggregator.registerBasicClient(this.client);
			const concurrencyManager = (this.client as any).getConcurrencyManager?.();
			if (concurrencyManager) {
				this.metricsAggregator.registerConcurrencyManager(concurrencyManager);
			}
		}
	}

	getOperations(): TransportOperationDefinition[] {
		return [
			{ name: 'connect', handler: (data, ctx) => this.handleConnect(data) },
			{ name: 'disconnect', handler: () => this.handleDisconnect() },
			{ name: 'testConnection', handler: (data) => this.handleTestConnection(data) },
			{ name: 'listFiles', handler: (data) => this.handleListFiles(data) , queue: { type: 'FTP_LIST' } },
			{
				name: 'downloadFile',
				handler: (data, ctx) => this.handleDownloadFile(data, ctx),
				queue: { type: 'FTP_DOWNLOAD' }
			},
			{ name: 'streamUpload', handler: (data, ctx) => this.handleStreamUpload(data, ctx), queue: { type: 'FTP_STREAM_UPLOAD', manageActive: false } },
			{ name: 'deleteFile', handler: (data) => this.handleDeleteFile(data), queue: { type: 'FTP_DELETE' } },
			{ name: 'renameFile', handler: (data) => this.handleRenameFile(data), queue: { type: 'FTP_RENAME' } },
			{ name: 'createDirectory', handler: (data) => this.handleCreateDirectory(data), queue: { type: 'FTP_CREATE_DIR' } },
			{ name: 'getFileInfo', handler: (data) => this.handleGetFileInfo(data), queue: { type: 'FTP_STAT' } },
			{ name: 'saveOptimizedConfig', handler: (data) => this.handleSaveOptimizedConfig(data) },
			{ name: 'testOptimizedConnection', handler: (data) => this.handleTestOptimizedConnection(data) },
			{ name: 'detectServerCapabilities', handler: (data) => this.handleDetectServerCapabilities(data) },
			{ name: 'getOptimizationStats', handler: () => this.handleGetOptimizationStats() },
			{ name: 'getMetrics', handler: () => this.handleGetMetrics() },
			{ name: 'getAggregatedMetrics', handler: () => this.handleGetAggregatedMetrics() },
			{ name: 'getPerformanceSummary', handler: () => this.handleGetPerformanceSummary() },
			{ name: 'resetMetrics', handler: () => this.handleResetMetrics() },
			{ name: 'batch.operations', handler: (data, ctx) => this.handleBatchOperations(data, ctx) }
		];
	}

	dispose(): void {
		this.chunkTransformer.dispose();
	}

	async disconnect(): Promise<void> {
		await this.client.disconnect().catch(() => undefined);
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
		try {
			const testClient = new FtpClient();
			const connected = await testClient.connect(config);
			if (connected) {
				try {
					await testClient.listFiles('/');
				} catch (err) {
					console.warn('[FtpTransportAdapter] 测试连接列目录失败:', err);
				}
				await testClient.disconnect();
				return { success: true, data: { connected: true } };
			}
			return { success: false, error: '无法建立FTP连接' };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : '测试连接失败'
			};
		}
	}

	private async handleListFiles(data: any): Promise<BackendResponse> {
		const path = typeof data?.path === 'string' ? data.path : '/';
		const files = await this.client.listFiles(path);
		return { success: true, data: { files } };
	}

	private async handleDownloadFile(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const requestId = context.requestId ?? '';
		const filePath = typeof data?.filePath === 'string' ? data.filePath : '';
		if (!filePath) {
			return { success: false, error: '缺少文件路径' };
		}

		const progressCallback = context.getProgressCallback();
		const targetPath = typeof data?.targetPath === 'string' && data.targetPath.trim().length > 0
			? data.targetPath.trim()
			: undefined;
		const expectedSize = typeof data?.fileSize === 'number' && Number.isFinite(data.fileSize) && data.fileSize >= 0
			? data.fileSize
			: undefined;

		const buffer = await this.client.downloadFile({
			filePath,
			filename: typeof data?.filename === 'string' ? data.filename : undefined,
			targetFile: targetPath,
			fileSize: expectedSize,
			onProgress: progressCallback
		});

		if (targetPath) {
			const bytesWritten = await this.verifyLocalDownload(targetPath, expectedSize);
			return {
				success: true,
				data: {
					targetPath,
					bytesWritten,
					fileSize: bytesWritten,
					message: '文件已保存到本地'
				}
			};
		}

		return { success: true, data: { blob: buffer } };
	}

	private async verifyLocalDownload(targetPath: string, expectedSize?: number): Promise<number> {
		const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
		const attempts = 8;
		let lastError: any;

		for (let attempt = 0; attempt < attempts; attempt++) {
			if (attempt > 0) {
				await sleep(150 * attempt);
			}
			try {
				const stats = await fs.promises.stat(targetPath);
				if (typeof expectedSize === 'number' && Number.isFinite(expectedSize) && expectedSize >= 0 && stats.size !== expectedSize) {
					console.warn('[FtpTransportAdapter] 下载文件大小与预期不一致', {
						targetPath,
						expectedSize,
						actualSize: stats.size
					});
				}
				return stats.size;
			} catch (error: any) {
				lastError = error;
				if (error?.code === 'ENOENT') {
					continue;
				}
				throw ErrorFactory.wrap(error, 'Extension:FtpTransportAdapter');
			}
		}

		throw ErrorFactory.fileNotFound(targetPath, undefined, lastError);
	}

	private async handleStreamUpload(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const action = data?.action;
		if (!action) {
			return { success: false, error: '缺少 action 参数' };
		}

		if (action === 'start') {
			const filename = typeof data?.filename === 'string' ? data.filename : undefined;
			const targetPath = typeof data?.targetPath === 'string' ? data.targetPath : '/';
			const fileSize = Number(data?.fileSize ?? 0);
			const requestedChunkSize = Number(data?.chunkSize ?? 0);

			if (!filename) {
				return { success: false, error: '缺少文件名' };
			}
			if (!Number.isFinite(fileSize) || fileSize < 0) {
				return { success: false, error: '无效的文件大小' };
			}

			try {
				const handle = await this.client.createStreamUploadSession({
					filename,
					targetPath,
					totalSize: fileSize,
					chunkSize: requestedChunkSize || undefined
				});

				const acceptedChunkSize = handle.acceptedChunkSize;
				const totalChunks = Math.max(1, Math.ceil(Math.max(fileSize, 1) / acceptedChunkSize));

				const state: FtpStreamUploadSessionState = {
					sessionId: handle.sessionId,
					filename,
					targetPath,
					fileSize,
					chunkSize: acceptedChunkSize,
					totalChunks,
					nextChunkIndex: 0,
					bytesSent: 0,
					handle
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
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { success: false, error: `FTP流式上传初始化失败: ${message}` };
			}
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

			try {
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
			} catch (error) {
				await session.handle.abort(error instanceof Error ? error.message : String(error)).catch(() => undefined);
				this.streamUploads.delete(sessionId);
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error)
				};
			}
		}

		if (action === 'finish') {
			const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : undefined;
			if (!sessionId || !this.streamUploads.has(sessionId)) {
				return { success: false, error: '上传会话不存在或已结束' };
			}

			const session = this.streamUploads.get(sessionId)!;
			this.streamUploads.delete(sessionId);
			try {
				const result = await session.handle.finish();
				return { success: result.success, data: result, message: result.message };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error)
				};
			}
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
		const path = typeof data?.path === 'string' ? data.path : '';
		const result = await this.client.deleteFile(path);
		return { success: result.success, data: result };
	}

	private async handleRenameFile(data: any): Promise<BackendResponse> {
		const oldPath = typeof data?.oldPath === 'string' ? data.oldPath : '';
		const newPath = typeof data?.newPath === 'string' ? data.newPath : '';
		const result = await this.client.renameFile(oldPath, newPath);
		return { success: result.success, data: result };
	}

	private async handleCreateDirectory(data: any): Promise<BackendResponse> {
		const path = typeof data?.path === 'string' ? data.path : '';
		const result = await this.client.createDirectory(path);
		return { success: result.success, data: result };
	}

	private async handleGetFileInfo(data: any): Promise<BackendResponse> {
		const path = typeof data?.path === 'string' ? data.path : '';
		const fileInfo = await this.client.getFileInfo(path);
		return { success: true, data: fileInfo };
	}

	private async handleSaveOptimizedConfig(data: any): Promise<BackendResponse> {
		if (!(this.client instanceof CompatibleFtpClient)) {
			return {
				success: false,
				error: '当前未启用 FTP 优化功能，无法保存优化配置'
			};
		}

		try {
			this.client.updateConfig(data.config);
			return {
				success: true,
				message: '优化配置已保存',
				data: { saved: true }
			};
		} catch (error) {
			return {
				success: false,
				error: `保存优化配置失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	private async handleTestOptimizedConnection(data: any): Promise<BackendResponse> {
		try {
			const testConfig = data.config || FtpConfigGenerator.generateConfigFor('standard', 'balanced');
			const testClient = new CompatibleFtpClient(testConfig);
			const connected = await testClient.connect(data.connectionConfig);
			if (connected) {
				try {
					await testClient.listFiles('/');
				} catch (err) {
					console.warn('[FtpTransportAdapter] 测试优化连接列目录失败', err);
				}
				const stats = testClient.getStats();
				await testClient.cleanup();
				return {
					success: true,
					data: {
						connected: true,
						stats,
						serverCapabilities: stats.serverCapabilities
					}
				};
			}
			await testClient.cleanup();
			return { success: false, error: '无法建立 FTP 优化连接' };
		} catch (error) {
			return {
				success: false,
				error: `测试优化连接失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	private async handleDetectServerCapabilities(data: any): Promise<BackendResponse> {
		if (!(this.client instanceof CompatibleFtpClient)) {
			return {
				success: false,
				error: '当前未启用 FTP 优化功能，无法检测服务器能力'
			};
		}

		const stats = this.client.getStats();
		if (stats.serverCapabilities) {
			return {
				success: true,
				data: {
					capabilities: stats.serverCapabilities,
					detectionTime: Date.now()
				}
			};
		}

		if (data.forceRedetect && data.connectionConfig) {
			const reconnected = await this.client.connect(data.connectionConfig);
			if (reconnected) {
				const newStats = this.client.getStats();
				return {
					success: true,
					data: {
						capabilities: newStats.serverCapabilities,
						detectionTime: Date.now(),
						redetected: true
					}
				};
			}
		}

		return {
			success: false,
			error: '未检测到服务器能力，请确保已连接到 FTP 服务器'
		};
	}

	private async handleGetOptimizationStats(): Promise<BackendResponse> {
		try {
			if (!(this.client instanceof CompatibleFtpClient)) {
				const metrics = this.client.getMetrics();
				return {
					success: true,
					data: {
						type: 'basic',
						metrics,
						timestamp: Date.now()
					}
				};
			}

			const stats = this.client.getStats();
			const metrics = this.client.getMetrics();
			return {
				success: true,
				data: {
					type: 'optimized',
					stats,
					metrics,
					timestamp: Date.now()
				}
			};
		} catch (error) {
			return {
				success: false,
				error: `获取优化统计失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	private async handleGetMetrics(): Promise<BackendResponse> {
		const metrics = this.metricsAggregator.getClientMetrics();
		return { success: true, data: metrics };
	}

	private async handleGetAggregatedMetrics(): Promise<BackendResponse> {
		const aggregated = this.metricsAggregator.getAggregatedMetrics();
		return { success: true, data: aggregated };
	}

	private async handleGetPerformanceSummary(): Promise<BackendResponse> {
		const summary = this.metricsAggregator.getPerformanceSummary();
		return { success: true, data: summary };
	}

	private async handleResetMetrics(): Promise<BackendResponse> {
		this.metricsAggregator.reset();
		return { success: true };
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
					results.push(await this.handleUploadInBatch(payload, context));
					break;
				default:
					results.push({ success: false, error: `未知的批量操作: ${name}` });
			}
		}

		return { success: true, data: { results } };
	}

	private async handleUploadInBatch(data: any, context: TransportRuntimeContext): Promise<BackendResponse> {
		const fileConfig: UploadConfig = data;
		const progressCallback = context.getProgressCallback();
		const result = await this.client.uploadFile({ ...fileConfig, onProgress: progressCallback });
		return { success: result.success, data: result, message: result.message };
	}
}
