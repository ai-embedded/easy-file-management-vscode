import { promises as fs } from 'fs';
import path from 'path';

export type InterruptedDownloadReason = 'cancelled' | 'error';

export interface InterruptedDownloadContext {
	targetPath: string;
	expectedSize?: number | null;
	bytesWritten?: number | null;
	reason: InterruptedDownloadReason;
	transport?: string;
	logger?: {
		info?: (...args: any[]) => void;
		warn?: (...args: any[]) => void;
		error?: (...args: any[]) => void;
	};
}

export interface InterruptedDownloadResult {
	action: 'deleted' | 'retained' | 'missing';
	path: string;
	actualSize?: number;
	expectedSize?: number | null;
	uncertain?: boolean;
}

const SIZE_TOLERANCE_BYTES = 512; // 避免因统计误差导致的误判

const toPositiveNumber = (value?: number | null): number | undefined => {
	if (typeof value !== 'number') {return undefined;}
	if (!Number.isFinite(value)) {return undefined;}
	if (value <= 0) {return undefined;}
	return value;
};

export const handleInterruptedDownload = async (
	context: InterruptedDownloadContext
): Promise<InterruptedDownloadResult> => {
	const { targetPath, expectedSize, bytesWritten, reason, transport, logger } = context;

	try {
		const stats = await fs.stat(targetPath).catch((error: NodeJS.ErrnoException) => {
			if (error && error.code === 'ENOENT') {
				return null;
			}
			throw error;
		});

		if (!stats) {
			logger?.info?.('[DownloadCleanup] 目标文件不存在，跳过清理', {
				targetPath,
				reason,
				transport
			});
			return {
				action: 'missing',
				path: targetPath,
				expectedSize: expectedSize ?? null
			};
		}

		const actualSize = stats.size;
		const safeExpected = toPositiveNumber(expectedSize);
		const safeBytes = toPositiveNumber(bytesWritten);

		let confirmedComplete = false;

		if (typeof safeExpected === 'number') {
			const sizeGap = safeExpected - actualSize;
			confirmedComplete = sizeGap <= SIZE_TOLERANCE_BYTES;

			if (!confirmedComplete && typeof safeBytes === 'number') {
				const bytesGap = safeExpected - safeBytes;
				confirmedComplete = bytesGap <= SIZE_TOLERANCE_BYTES;
			}
		}

		if (confirmedComplete) {
			logger?.info?.('[DownloadCleanup] 检测到已完成的文件，跳过删除', {
				targetPath,
				reason,
				transport,
				actualSize,
				expectedSize: safeExpected
			});
			return {
				action: 'retained',
				path: targetPath,
				actualSize,
				expectedSize: safeExpected ?? null
			};
		}

		if (typeof safeExpected === 'number') {
			logger?.warn?.('[DownloadCleanup] 删除未完成的直存文件', {
				targetPath,
				reason,
				transport,
				actualSize,
				expectedSize: safeExpected
			});
			await fs.unlink(targetPath).catch((error: NodeJS.ErrnoException) => {
				if (error && error.code === 'ENOENT') {
					return;
				}
				throw error;
			});

			return {
				action: 'deleted',
				path: targetPath,
				actualSize,
				expectedSize: safeExpected
			};
		}

		// 无法确认完整性（缺少 expectedSize），保留文件但标记不确定
		logger?.warn?.('[DownloadCleanup] 无法确认文件完整性，保留当前文件', {
			transport,
			targetPath,
			reason,
			actualSize,
			expectedSize: expectedSize ?? null
		});

		return {
			action: 'retained',
			path: targetPath,
			actualSize,
			expectedSize: expectedSize ?? null,
			uncertain: true
		};
	} catch (error) {
		logger?.error?.('[DownloadCleanup] 处理部分下载文件失败', {
			targetPath,
			reason,
			expectedSize,
			transport,
			error: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
};

export const describeCleanupResult = (result: InterruptedDownloadResult): string => {
	switch (result.action) {
		case 'deleted':
			return `已删除未完成的文件: ${path.basename(result.path)}`;
		case 'missing':
			return '目标文件不存在，无需清理';
		case 'retained':
		default:
			return result.uncertain
				? `保留文件(完整性未知): ${path.basename(result.path)}`
				: `保留文件: ${path.basename(result.path)}`;
	}
};

