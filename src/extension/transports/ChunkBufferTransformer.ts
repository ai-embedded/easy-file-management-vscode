import type { Worker as WorkerType } from 'worker_threads';

let workerCtor: typeof WorkerType | undefined;
try {
	workerCtor = require('worker_threads').Worker as typeof WorkerType;
} catch {
	workerCtor = undefined;
}

export class ChunkBufferTransformer {
	private worker: WorkerType | null;
	private nextJobId = 0;
	private pendingJobs = new Map<number, { resolve: (value: Buffer) => void; reject: (reason: unknown) => void }>();

	constructor() {
		if (!workerCtor) {
			this.worker = null;
			return;
		}

		const workerSource = `
const { parentPort } = require('worker_threads');

const toBuffer = (payload) => {
	if (!payload) { return Buffer.alloc(0); }
	if (Buffer.isBuffer(payload)) { return payload; }
	if (payload instanceof Uint8Array) { return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength); }
	if (Array.isArray(payload)) { return Buffer.from(payload); }
	if (payload && payload.type === 'Buffer' && Array.isArray(payload.data)) { return Buffer.from(payload.data); }
	if (payload instanceof ArrayBuffer) { return Buffer.from(new Uint8Array(payload)); }
	throw new Error('Unsupported payload type');
};

parentPort.on('message', (msg) => {
	const { id, payload } = msg;
	try {
		const buffer = toBuffer(payload);
		const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
		parentPort.postMessage({ id, arrayBuffer }, [arrayBuffer]);
	} catch (error) {
		parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
	}
});
`;

		this.worker = new workerCtor(workerSource, { eval: true });
		this.worker.on('message', (message: any) => {
			const job = this.pendingJobs.get(message.id);
			if (!job) {return;}
			this.pendingJobs.delete(message.id);
			if (message.error) {
				job.reject(new Error(message.error));
				return;
			}
			const buffer = Buffer.from(message.arrayBuffer);
			job.resolve(buffer);
		});
		this.worker.on('error', (error) => {
			console.warn('[ChunkBufferTransformer] worker error', error);
			for (const job of this.pendingJobs.values()) {
				job.reject(error);
			}
			this.pendingJobs.clear();
		});
	}

	async toBuffer(payload: any): Promise<Buffer> {
		if (!this.worker) {
			return ChunkBufferTransformer.syncToBuffer(payload);
		}

		return new Promise<Buffer>((resolve, reject) => {
			const id = this.nextJobId++;
			this.pendingJobs.set(id, { resolve, reject });
			try {
				this.worker!.postMessage({ id, payload });
			} catch (error) {
				this.pendingJobs.delete(id);
				reject(error);
			}
		});
	}

	dispose(): void {
		if (this.worker) {
			this.worker.terminate().catch(() => undefined);
			this.worker = null;
		}
		this.pendingJobs.clear();
	}

	static syncToBuffer(payload: any): Buffer {
		if (!payload) {return Buffer.alloc(0);}
		if (Buffer.isBuffer(payload)) {return payload;}
		if (payload instanceof Uint8Array) {return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);}
		if (Array.isArray(payload)) {return Buffer.from(payload);}
		if (payload?.type === 'Buffer' && Array.isArray(payload?.data)) {return Buffer.from(payload.data);}
		if (payload instanceof ArrayBuffer) {return Buffer.from(new Uint8Array(payload));}
		throw new Error('无法解析上传数据块');
	}
}
