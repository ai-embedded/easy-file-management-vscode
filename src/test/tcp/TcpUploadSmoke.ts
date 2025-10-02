import { performance } from 'node:perf_hooks';
import { TcpClient } from '../../extension/tcp/TcpClient';
import { TcpConfig } from '../../shared/types';
import { LogLevel, setGlobalLogConfig } from '../../shared/utils/Logger';

interface UploadSummary {
	sizeMb: number;
	filename: string;
	success: boolean;
	message?: string;
	durationMs: number;
	remoteSize?: number;
}

setGlobalLogConfig({
	level: LogLevel.INFO,
	enableColors: false
});

const DEFAULT_CONFIG: TcpConfig = {
	host: '127.0.0.1',
	port: 8899,
	dataFormat: 'protobuf',
	timeout: 15000
};

const TEST_SIZES_MB = [50, 100, 200];

function createTestBuffer(sizeMb: number): Buffer {
	const sizeBytes = sizeMb * 1024 * 1024;
	const buffer = Buffer.alloc(sizeBytes);
	// 采用不同的填充值，避免重复内容导致压缩或去重
	buffer.fill(sizeMb & 0xff);
	return buffer;
}

async function runSmokeTests(): Promise<UploadSummary[]> {
	const client = new TcpClient();
	const summaries: UploadSummary[] = [];

	console.log(`[Smoke] 准备连接 TCP 服务器 ${DEFAULT_CONFIG.host}:${DEFAULT_CONFIG.port}`);
	const connected = await client.connectWithConfig(DEFAULT_CONFIG);
	if (!connected) {
		throw new Error(`[Smoke] 连接服务器失败: ${client.getLastConnectError() ?? '未知错误'}`);
	}

	try {
		for (const sizeMb of TEST_SIZES_MB) {
			const buffer = createTestBuffer(sizeMb);
			const filename = `tcp_smoke_${sizeMb}mb_${Date.now()}.bin`;
			const summary: UploadSummary = {
				sizeMb,
				filename,
				success: false,
				durationMs: 0
			};

			console.log(`\n[Smoke] === 开始上传 ${filename} (${sizeMb}MB) ===`);
			const uploadStart = performance.now();
			let lastLoggedPercent = -1;

			try {
				const result = await client.uploadFile({
					buffer,
					filename,
					targetPath: '/',
					fileSize: buffer.length,
					onProgress: (progress) => {
						if (progress.percent === lastLoggedPercent) {
							return;
						}
						if (progress.percent === 100 || progress.percent % 10 === 0) {
							console.log(`[Smoke] 进度 ${progress.percent}% (${progress.loaded}/${progress.total})`);
							lastLoggedPercent = progress.percent;
						}
					}
				});

				summary.durationMs = performance.now() - uploadStart;
				summary.success = result.success;
				summary.message = result.message;

			} catch (error) {
				summary.durationMs = performance.now() - uploadStart;
				summary.success = false;
				summary.message = error instanceof Error ? error.message : String(error);
				console.error(`[Smoke] 上传 ${filename} 过程中发生异常: ${summary.message}`);
			} finally {
				buffer.fill(0);
				summaries.push(summary);
			}

			if (summary.success) {
				console.log(`[Smoke] 上传完成 success=${summary.success} message="${summary.message ?? ''}" 用时=${summary.durationMs.toFixed(1)}ms`);
				const files = await client.listFiles('/');
				const remoteEntry = files.find(item => item.name === filename);
				if (!remoteEntry) {
					summary.success = false;
					summary.message = `远端未找到文件 ${filename}`;
					console.error(`[Smoke] ${summary.message}`);
				} else {
					summary.remoteSize = remoteEntry.size;
					console.log(`[Smoke] 远端文件确认: size=${remoteEntry.size}`);
				}
			} else {
				console.error(`[Smoke] 上传 ${filename} 失败，用时=${summary.durationMs.toFixed(1)}ms`);
			}
		}

		console.log('\n[Smoke] === 测试完成 ===');
		summaries.forEach(summary => {
			console.log(`  - ${summary.filename}: success=${summary.success}, duration=${summary.durationMs.toFixed(1)}ms, remoteSize=${summary.remoteSize}`);
		});

	} finally {
		console.log('[Smoke] 断开 TCP 连接');
		await client.disconnect();
	}

	return summaries;
}

runSmokeTests()
	.then(summaries => {
		const hasFailure = summaries.some(entry => !entry.success);
		if (hasFailure) {
			console.error('[Smoke] 存在失败用例，详见上述日志');
			process.exit(1);
		}
		process.exit(0);
	})
	.catch(error => {
		console.error('[Smoke] 测试执行失败:', error);
		process.exit(1);
	});
