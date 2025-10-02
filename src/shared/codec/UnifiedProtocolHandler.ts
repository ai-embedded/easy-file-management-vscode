import { ProtobufCodec, Operation } from './ProtobufCodec';
import { Logger } from '../utils/Logger';

/**
 * 🌐 统一协议处理器
 * TCP和UART使用完全相同的协议逻辑
 * 
 * 核心功能：
 * - 🔄 统一编解码：TCP和UART使用相同的Protobuf编码逻辑
 * - 🔧 统一帧构建：相同的帧结构和校验机制
 * - 🛡️ 统一错误处理：一致的异常处理和错误恢复
 * - 📊 统一监控：相同的性能监控和日志记录
 */
export class UnifiedProtocolHandler {
	// 🚀 统一协议帧格式规范（TCP+UART完全一致）
	private static readonly MAGIC_NUMBER = 0xAA55; // 统一魔数
	private static readonly FRAME_HEADER = 0xAA55; // 帧头标识（与魔数一致）
	private static readonly FRAME_TRAILER = 0x55AA; // 帧尾标识
	private static readonly FORMAT_PROTOBUF = 0x02; // Protobuf格式标识
	private static readonly FRAME_OVERHEAD_BYTES = 13; // 帧头开销（长度字段4字节）
	private static readonly MAX_DATA_LENGTH = 4 * 1024 * 1024; // 单帧最大数据长度 4MB
    

	private protobufCodec: ProtobufCodec;
	private logger: Logger;

	constructor() {
		this.protobufCodec = new ProtobufCodec();
		this.logger = new Logger('UnifiedProtocolHandler');
		this.logger.info('🌐 统一协议处理器初始化 (TCP+UART兼容)');
	}

	/**
     * 将任意形式的 operation 转为 Protobuf Operation 枚举
     */
	private coerceOperation(operation: any): Operation {
		if (typeof operation === 'number') {
			// 已是枚举数值
			return operation as Operation;
		}
		if (typeof operation === 'string') {
			const op = operation.toUpperCase();
			switch (op) {
				case 'PING': return Operation.PING;
				case 'PONG': return Operation.PONG;
				case 'CONNECT': return Operation.CONNECT;
				case 'DISCONNECT': return Operation.DISCONNECT;
				case 'LIST_FILES': return Operation.LIST_FILES;
				case 'FILE_INFO': return Operation.FILE_INFO;
				case 'CREATE_DIR': return Operation.CREATE_DIR;
				case 'DELETE_FILE': return Operation.DELETE_FILE;
				case 'RENAME_FILE': return Operation.RENAME_FILE;
				case 'UPLOAD_FILE': return Operation.UPLOAD_FILE;
				case 'DOWNLOAD_FILE': return Operation.DOWNLOAD_FILE;
				case 'UPLOAD_REQ': return Operation.UPLOAD_REQ;
				case 'UPLOAD_DATA': return Operation.UPLOAD_DATA;
				case 'UPLOAD_END': return Operation.UPLOAD_END;
				case 'DOWNLOAD_REQ': return Operation.DOWNLOAD_REQ;
				case 'DOWNLOAD_DATA': return Operation.DOWNLOAD_DATA;
				case 'DOWNLOAD_END': return Operation.DOWNLOAD_END;
				default: return Operation.UNKNOWN;
			}
		}
		return Operation.UNKNOWN;
	}

	/**
     * 规范化请求对象，确保与 Protobuf 定义一致
     */
	private normalizeRequest(request: any): any {
		if (!request || typeof request !== 'object') {return request;}
		const normalized: any = { ...request };
		if (normalized.operation !== undefined) {
			normalized.operation = this.coerceOperation(normalized.operation);
		}
		return normalized;
	}

	/**
     * 🚀 初始化协议处理器
     */
	async initialize(): Promise<void> {
		try {
			await this.protobufCodec.initialize();
			this.logger.info('✅ 统一协议处理器初始化成功');
		} catch (error) {
			this.logger.error('❌ 统一协议处理器初始化失败', error);
			throw new Error(`统一协议初始化失败: ${error}`);
		}
	}

	/**
     * 🔄 统一请求编码（TCP和UART通用）
     * @param request 要编码的请求消息
     * @returns 编码后的二进制数据
     */
	encodeRequest(request: any): Uint8Array {
		try {
			const normalized = this.normalizeRequest(request);
			const encoded = this.protobufCodec.encodeRequest(normalized);
			const opName = typeof normalized.operation === 'number' ? (Operation as any)[normalized.operation] || normalized.operation : normalized.operation;
			this.logger.debug(`📤 统一请求编码: ${opName || 'UNKNOWN'} (${encoded.length} bytes)`);
			return encoded;
		} catch (error) {
			this.logger.error('❌ 统一请求编码失败', error);
			throw new Error(`统一协议请求编码失败: ${error}`);
		}
	}

	/**
     * 🔄 统一响应解码（TCP和UART通用）
     * @param data 要解码的二进制数据
     * @returns 解码后的响应对象
     */
	decodeResponse(data: Uint8Array): any {
		try {
			const decoded = this.protobufCodec.decodeResponse(data);
			this.logger.debug(`📥 统一响应解码: ${decoded.success ? '成功' : '失败'} (${data.length} bytes)`);
			return decoded;
		} catch (error) {
			this.logger.error('❌ 统一响应解码失败', error);
			throw new Error(`统一协议响应解码失败: ${error}`);
		}
	}

	/**
     * 🔄 通用编码方法（兼容性接口）
     * @param message 要编码的消息（请求类型）
     * @returns 编码后的二进制数据
     */
	async encode(message: any): Promise<Uint8Array> {
		return Promise.resolve(this.encodeRequest(message));
	}

	/**
     * 🔄 通用解码方法（兼容性接口）
     * @param data 要解码的二进制数据
     * @returns 解码后的消息对象
     */
	async decode(data: Uint8Array): Promise<any> {
		return Promise.resolve(this.decodeResponse(data));
	}

	/**
     * 🔧 构建统一帧（TCP和UART通用）
     * @param command 命令码
     * @param data 数据体
     * @param sequenceNumber 序列号
     * @returns 完整的协议帧
     */
	buildFrame(command: number, data: Uint8Array, sequenceNumber = 0): Uint8Array {
		// 检查数据长度
		if (data.length > UnifiedProtocolHandler.MAX_DATA_LENGTH) {
			throw new Error(`数据长度超过帧协议限制: ${data.length} > ${UnifiedProtocolHandler.MAX_DATA_LENGTH}`);
		}

		const totalLength = UnifiedProtocolHandler.FRAME_OVERHEAD_BYTES + data.length;
		const frame = new Uint8Array(totalLength);
        
		let offset = 0;
        
		// 帧头/魔数 (2字节，大端序) - 0xAA55
		frame[offset++] = (UnifiedProtocolHandler.MAGIC_NUMBER >> 8) & 0xFF;
		frame[offset++] = UnifiedProtocolHandler.MAGIC_NUMBER & 0xFF;
        
		// 数据长度 (4字节，小端序)
		frame[offset++] = data.length & 0xFF;
		frame[offset++] = (data.length >> 8) & 0xFF;
		frame[offset++] = (data.length >> 16) & 0xFF;
		frame[offset++] = (data.length >> 24) & 0xFF;
        
		// 序列号 (2字节，小端序)
		frame[offset++] = sequenceNumber & 0xFF;
		frame[offset++] = (sequenceNumber >> 8) & 0xFF;
        
		// 命令码 (1字节)
		frame[offset++] = command;
        
		// 数据格式 (1字节) - 统一使用Protobuf
		frame[offset++] = UnifiedProtocolHandler.FORMAT_PROTOBUF;
        
		// 数据体
		frame.set(data, offset);
		offset += data.length;
        
		// 校验和 (1字节) - CRC8校验
		const checksum = this.calculateCRC8(frame.slice(2, offset));
		frame[offset++] = checksum;
        
		// 帧尾 (2字节，大端序) - 0x55AA
		frame[offset++] = (UnifiedProtocolHandler.FRAME_TRAILER >> 8) & 0xFF;
		frame[offset++] = UnifiedProtocolHandler.FRAME_TRAILER & 0xFF;
        
		this.logger.debug(`🔧 构建统一帧: cmd=${command}, size=${data.length}, seq=${sequenceNumber}`);
		return frame;
	}

	/**
     * 🔍 解析统一帧（TCP和UART通用）
     * @param buffer 数据缓冲区
     * @returns 解析后的帧信息
     */
	parseFrame(buffer: Uint8Array): {
        magic: number;
        command: number;
        format: number;
        sequenceNumber: number;
        dataLength: number;
        data: ArrayBuffer;
        checksum: number;
        trailer: number;
    } | null {
		if (buffer.length < UnifiedProtocolHandler.FRAME_OVERHEAD_BYTES) {
			return null;
		}
        
		let offset = 0;
        
		// 检查帧头/魔数 (2字节，大端序)
		const magic = (buffer[offset++] << 8) | buffer[offset++];
		if (magic !== UnifiedProtocolHandler.MAGIC_NUMBER) {
			return null;
		}
        
		// 解析数据长度 (4字节，小端序)
		const dataLength =
			buffer[offset++] |
			(buffer[offset++] << 8) |
			(buffer[offset++] << 16) |
			(buffer[offset++] << 24);

		if (dataLength > UnifiedProtocolHandler.MAX_DATA_LENGTH) {
			this.logger.error(`数据长度超过最大值: ${dataLength} > ${UnifiedProtocolHandler.MAX_DATA_LENGTH}`);
			return null;
		}
        
		// 检查总帧长度
		if (buffer.length < UnifiedProtocolHandler.FRAME_OVERHEAD_BYTES + dataLength) {
			return null;
		}
        
		// 解析序列号 (2字节，小端序)
		const sequenceNumber = buffer[offset++] | (buffer[offset++] << 8);
        
		// 解析命令码 (1字节)
		const command = buffer[offset++];
        
		// 解析数据格式 (1字节)
		const format = buffer[offset++];
        
		// 提取数据体
		const data = buffer.slice(offset, offset + dataLength);
		offset += dataLength;
        
		// 解析校验和 (1字节)
		const checksum = buffer[offset++];
        
		// 检查帧尾 (2字节，大端序)
		if (offset + 2 > buffer.length) {
			return null;
		}
		const trailer = (buffer[offset++] << 8) | buffer[offset++];
		if (trailer !== UnifiedProtocolHandler.FRAME_TRAILER) {
			this.logger.error(`帧尾错误: 期望 0x${UnifiedProtocolHandler.FRAME_TRAILER.toString(16)}, 实际 0x${trailer.toString(16)}`);
			return null;
		}
        
		// 验证校验和
		const calculatedChecksum = this.calculateCRC8(buffer.slice(2, offset - 3));
		if (checksum !== calculatedChecksum) {
			this.logger.error(`校验和错误: 期望 ${calculatedChecksum}, 实际 ${checksum}`);
			return null;
		}
        
		return {
			magic,
			command,
			format,
			sequenceNumber,
			dataLength,
			data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
			checksum,
			trailer
		};
	}

	/**
     * 🔢 计算CRC8校验和
     * @param data 数据
     * @returns CRC8校验值
     */
	private calculateCRC8(data: Uint8Array): number {
		let crc = 0;
		for (let i = 0; i < data.length; i++) {
			crc ^= data[i];
			for (let j = 0; j < 8; j++) {
				if (crc & 0x80) {
					crc = (crc << 1) ^ 0x07; // CRC8-ITU多项式
				} else {
					crc <<= 1;
				}
				crc &= 0xFF;
			}
		}
		return crc;
	}

	/**
     * 🔧 获取协议版本信息
     */
	getProtocolInfo(): {
        name: string;
        version: string;
        format: string;
        unified: boolean;
        } {
		return {
			name: 'Unified Protocol Handler',
			version: '1.0.0',
			format: 'protobuf',
			unified: true
		};
	}

	/**
     * 📊 获取统计信息
     */
	getStats(): {
        initialized: boolean;
        protobufAvailable: boolean;
        frameOverhead: number;
        } {
		return {
			initialized: this.protobufCodec !== null,
			protobufAvailable: this.protobufCodec ? this.protobufCodec.isInitialized() : false,
			frameOverhead: UnifiedProtocolHandler.FRAME_OVERHEAD_BYTES
		};
	}

	/**
     * ✅ 检查协议处理器是否已初始化
     */
	isInitialized(): boolean {
		return this.protobufCodec ? this.protobufCodec.isInitialized() : false;
	}
}
