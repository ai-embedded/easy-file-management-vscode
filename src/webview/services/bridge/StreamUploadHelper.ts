import type { FileOperationResult, ProgressInfo } from '../../../shared/types';
import type { BackendResponse, OperationControlHooks } from './BaseBridgeService';

const CANCELLED_MESSAGE = '操作已取消';

export interface StreamUploadOptions {
	file: File;
	targetPath: string;
	chunkSize?: number;
	extraStartPayload?: Record<string, any>;
	handshakeTimeout?: number;
	perChunkTimeout?: number;
	finishTimeout?: number;
	hooks?: OperationControlHooks;
	onProgress?: (progress: ProgressInfo & { filename: string }) => void;
	send: (payload: any, options?: { timeout?: number }) => Promise<BackendResponse>;
	createResult: (response: BackendResponse) => FileOperationResult;
}

export type StreamUploadOverrides = Partial<Omit<StreamUploadOptions, 'file' | 'targetPath' | 'hooks' | 'send' | 'createResult'>>;

interface StreamState {
	sessionId?: string;
	reader?: ReadableStreamDefaultReader<Uint8Array>;
	cancelled: boolean;
}

export async function uploadFileViaStream(options: StreamUploadOptions): Promise<FileOperationResult> {
	const {
		file,
		targetPath,
		chunkSize,
		extraStartPayload,
		handshakeTimeout,
		perChunkTimeout,
		finishTimeout,
		hooks,
		onProgress,
		send,
		createResult
	} = options;

	if (typeof (file as any).stream !== 'function') {
		throw new Error('当前环境不支持流式上传，请升级运行环境');
	}

	const totalSize = file.size;
	const state: StreamState = { cancelled: false };

	const markCancelled = () => {
		if (!state.cancelled) {
			state.cancelled = true;
		}
	};

	const abortSession = async (reason = 'user-cancelled') => {
		if (!state.sessionId) {
			return;
		}
		await send({ action: 'abort', sessionId: state.sessionId, reason }).catch(() => undefined);
	};

	const ensureNotCancelled = async (): Promise<void> => {
		if (state.cancelled || hooks?.isCancelled?.()) {
			markCancelled();
			try {
				await state.reader?.cancel();
			} catch {
				// ignore cancellation error
			}
			await abortSession();
			throw new Error(CANCELLED_MESSAGE);
		}
	};

	hooks?.registerCancelCallback?.(async () => {
		markCancelled();
		try {
			await state.reader?.cancel();
		} catch {
			// ignore cancellation error
		}
		await abortSession();
	});

	const emitProgress = (uploaded: number) => {
		if (!onProgress) {
			return;
		}
		const percent = totalSize > 0 ? Math.min(100, Math.round((uploaded / totalSize) * 100)) : 100;
		onProgress({
			loaded: uploaded,
			total: totalSize,
			percent,
			filename: file.name
		});
	};

	try {
		const startPayload = {
			action: 'start',
			filename: file.name,
			fileSize: totalSize,
			targetPath,
			chunkSize,
			...extraStartPayload
		};

		const startResponse = await send(startPayload, handshakeTimeout ? { timeout: handshakeTimeout } : undefined);
		if (!startResponse.success) {
			throw new Error(startResponse.error || startResponse.message || '流式上传初始化失败');
		}

		const startData = startResponse.data ?? {};
		const sessionId = typeof startData.sessionId === 'string' ? startData.sessionId : undefined;
		if (!sessionId) {
			throw new Error('上传会话创建失败');
		}
		state.sessionId = sessionId;

		await ensureNotCancelled();

		const acceptedChunkSize = typeof startData.acceptedChunkSize === 'number' && startData.acceptedChunkSize > 0
			? startData.acceptedChunkSize
			: (chunkSize && chunkSize > 0 ? chunkSize : 1024 * 1024);
		const estimatedChunks = Math.max(1, Math.ceil(Math.max(totalSize, 1) / acceptedChunkSize));
		const totalChunks = Number.isFinite(startData.totalChunks) && startData.totalChunks > 0
			? Math.max(1, Number(startData.totalChunks))
			: estimatedChunks;

		state.reader = (file as any).stream().getReader();
		let uploaded = 0;
		let chunkIndex = 0;
		let pending = new Uint8Array(0);

		const concatBuffers = (a: Uint8Array, b: Uint8Array): Uint8Array => {
			if (a.length === 0) {return b;}
			if (b.length === 0) {return a;}
			const merged = new Uint8Array(a.length + b.length);
			merged.set(a, 0);
			merged.set(b, a.length);
			return merged;
		};

		const flushChunk = async (buffer: Uint8Array) => {
			await ensureNotCancelled();
			const response = await send(
				{
					action: 'chunk',
					sessionId,
					chunkIndex,
					chunkTotal: totalChunks,
					data: buffer
				},
				perChunkTimeout ? { timeout: perChunkTimeout } : undefined
			);

			if (!response.success) {
				throw new Error(response.error || response.message || '上传数据块失败');
			}

			uploaded += buffer.byteLength;
			chunkIndex += 1;
			emitProgress(uploaded);
		};

		while (true) {
			await ensureNotCancelled();
			const { value, done } = await state.reader.read();
			await ensureNotCancelled();
			if (done) {
				break;
			}

			const incoming = value instanceof Uint8Array ? value : new Uint8Array(value);
			pending = concatBuffers(pending, incoming);

			while (pending.length >= acceptedChunkSize) {
				const slice = pending.subarray(0, acceptedChunkSize);
				await flushChunk(slice);
				pending = pending.subarray(acceptedChunkSize);
			}
		}

		if (pending.length > 0 || totalSize === 0) {
			const tail = pending.length > 0 ? pending : new Uint8Array(0);
			await flushChunk(tail);
		}

		await ensureNotCancelled();
		const finishResponse = await send({ action: 'finish', sessionId }, finishTimeout ? { timeout: finishTimeout } : undefined);
		if (!finishResponse.success) {
			throw new Error(finishResponse.error || finishResponse.message || '上传完成失败');
		}

		emitProgress(totalSize);
		return createResult(finishResponse);
	} catch (error) {
		await abortSession(error instanceof Error ? error.message : String(error));
		const err = error instanceof Error ? error : new Error(String(error));
		if (err.message === CANCELLED_MESSAGE) {
			return { success: false, message: CANCELLED_MESSAGE };
		}
		throw err;
	} finally {
		state.reader = undefined;
	}
}
