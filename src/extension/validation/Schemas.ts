import { z } from 'zod';

// 基础字段
const str = () => z.string().min(1);
const num = () => z.number();
const bool = () => z.boolean();
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional();

// 连接配置
const ftpConnect = z.object({
	host: str(),
	port: opt(num()),
	username: str(),
	password: str(),
	secure: opt(bool()),
	passive: opt(bool()),
	timeout: opt(num())
});

const tcpConnect = z.object({
	host: str(),
	port: num(),
	timeout: opt(num()),
	// ✅ P0-2: 强制Protobuf-only，移除JSON选项
	dataFormat: opt(z.enum(['protobuf'])) // 仅支持Protobuf格式
});

const httpConnect = z.object({
	host: str(),
	port: opt(num()),
	protocol: opt(z.enum(['http', 'https'])),
	timeout: opt(num()),
	headers: opt(z.record(z.string()))
});

const uartConnect = z.object({
	path: str(),
	baudRate: opt(num()),
	dataBits: opt(num()),
	stopBits: opt(num()),
	parity: opt(z.enum(['none', 'even', 'odd'])),
	flowControl: opt(z.enum(['none', 'hardware', 'software'])),
	parserType: opt(z.enum(['raw', 'readline', 'bytelength', 'delimiter'])),
	delimiter: opt(str()),
	byteLength: opt(num())
});

// 通用文件操作
const pathOnly = z.object({ path: str() });
const renamePayload = z.object({ oldPath: str(), newPath: str() });
const downloadPayload = z.object({
	filePath: str(),
	filename: opt(str()),
	targetPath: opt(str()),
	fileSize: opt(num().nonnegative())
});
const binaryArray = z.array(z.number());
const typedArray = z.instanceof(Uint8Array).or(z.instanceof(Uint16Array)).or(z.instanceof(Uint32Array));
const arrayBufferType = z.instanceof(ArrayBuffer);
const numericIndexedObject = z
	.record(z.string().regex(/^(0|[1-9]\d*)$/), z.number())
	.transform((record) => {
		const entries = Object.keys(record)
			.map((key) => [Number(key), record[key]] as [number, number])
			.sort((a, b) => a[0] - b[0]);
		return entries.map(([, value]) => value);
	});

const uploadPayloadBuffer = z.object({
	filename: str(),
	targetPath: str(),
	fileData: opt(z.union([binaryArray, typedArray, arrayBufferType])),
	fileSize: opt(num())
});

const downloadAndSavePayload = z.object({
	filePath: opt(str()),
	url: opt(str()),
	targetPath: str(),
	filename: opt(str()),
	fileSize: opt(num())
}).refine(data => Boolean(data.filePath) || Boolean(data.url), {
	message: 'filePath 或 url 必须提供一个',
	path: ['filePath']
});

const nodeBufferLike = z.object({ type: z.literal('Buffer'), data: binaryArray });

const streamUploadStart = z.object({
	action: z.literal('start'),
	filename: str(),
	fileSize: num().nonnegative(),
	targetPath: opt(str()),
	chunkSize: opt(num().positive())
});

const streamUploadChunk = z.object({
	action: z.literal('chunk'),
	sessionId: str(),
	data: z.union([typedArray, arrayBufferType, binaryArray, nodeBufferLike, numericIndexedObject]),
	chunkIndex: opt(num().nonnegative()),
	chunkTotal: opt(num().positive())
});

const streamUploadFinish = z.object({
	action: z.literal('finish'),
	sessionId: str()
});

const streamUploadAbort = z.object({
	action: z.literal('abort'),
	sessionId: str(),
	reason: opt(str())
});

const streamUploadPayload = z.union([
	streamUploadStart,
	streamUploadChunk,
	streamUploadFinish,
	streamUploadAbort
]);

const streamDownloadStart = z.object({
	action: z.literal('start'),
	filePath: str(),
	targetPath: str(),
	filename: opt(str()),
	fileSize: opt(num()),
	chunkSize: opt(num().positive())
});

const streamDownloadAbort = z.object({
	action: z.literal('abort'),
	sessionId: str(),
	reason: opt(str())
});

const streamDownloadPayload = z.union([
	streamDownloadStart,
	streamDownloadAbort
]);

const batchOperationEntry = z.object({
	name: str(),
	data: z.unknown().optional()
});

const batchOperationsPayload = z.object({
	operations: z.array(batchOperationEntry).nonempty('至少需要一个批量操作')
});

// HTTP 特有
const httpDownload = z.object({ url: str().or(str()) /* 兼容 url/filePath 字段 */.or(z.never()) })
	.or(z.object({ filePath: str(), filename: opt(str()) }))
	.or(z.object({ url: str(), filename: opt(str()) }));

const uartWrite = z.object({
	data: z.union([str(), z.array(z.number())])
});

// 命令 → 校验器映射
const commandSchemas: Record<string, z.ZodSchema<any>> = {
	// FTP
	'backend.ftp.connect': ftpConnect,
	'backend.ftp.disconnect': z.object({}).optional().default({}),
	'backend.ftp.testConnection': ftpConnect, // 使用相同的连接参数
	'backend.ftp.listFiles': pathOnly,
	'backend.ftp.downloadFile': downloadPayload,
	'backend.ftp.streamUpload': streamUploadPayload,
	'backend.ftp.deleteFile': pathOnly,
	'backend.ftp.renameFile': renamePayload,
	'backend.ftp.createDirectory': pathOnly,
	'backend.ftp.getFileInfo': pathOnly,
	'backend.ftp.batch.operations': batchOperationsPayload,

	// TCP
	'backend.tcp.connect': tcpConnect,
	'backend.tcp.disconnect': z.object({}).optional().default({}),
	'backend.tcp.listFiles': pathOnly,
	'backend.tcp.downloadFile': downloadPayload,
	'backend.tcp.uploadFile': uploadPayloadBuffer,
	'backend.tcp.streamUpload': streamUploadPayload,
	'backend.tcp.streamDownload': streamDownloadPayload,
	'backend.tcp.deleteFile': pathOnly,
	'backend.tcp.renameFile': renamePayload,
	'backend.tcp.createDirectory': pathOnly,
	'backend.tcp.batch.operations': batchOperationsPayload,

	// HTTP
	'backend.http.connect': httpConnect,
	'backend.http.disconnect': z.object({}).optional().default({}),
	'backend.http.listFiles': pathOnly,
	'backend.http.downloadFile': httpDownload,
	'backend.http.downloadAndSave': downloadAndSavePayload,
	'backend.http.streamUpload': streamUploadPayload,
	'backend.http.deleteFile': pathOnly,
	'backend.http.renameFile': renamePayload,
	'backend.http.createDirectory': pathOnly,
	'backend.http.getFileInfo': pathOnly,
	'backend.http.batch.operations': batchOperationsPayload,

	// UART
	'backend.uart.list': z.object({}).optional().default({}),
	'backend.uart.connect': uartConnect,
	'backend.uart.disconnect': z.object({}).optional().default({}),
	'backend.uart.write': uartWrite,
	'backend.uart.setSignals': z.object({ dtr: opt(bool()), rts: opt(bool()) }),
	'backend.uart.getSignals': z.object({}).optional().default({}),
	'backend.uart.flush': z.object({}).optional().default({})
};

export function validateCommand(command: string, data: any): { ok: true; data: any } | { ok: false; error: string } {
	const schema = commandSchemas[command];
	if (!schema) {return { ok: true, data };}
	const result = schema.safeParse(data);
	if (result.success) {
		return { ok: true, data: result.data };
	}
	const msg = result.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ');
	return { ok: false, error: msg };
}
