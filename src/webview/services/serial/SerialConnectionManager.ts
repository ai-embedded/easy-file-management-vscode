/**
 * 串口连接管理器
 * 基于 Web Serial API 实现串口通信
 * 根据串口协议实现可行性分析报告第5.2.1节实现
 */

import {
	SerialConnectionOptions,
	SerialFrame,
	SerialMessageQueueItem,
	SerialConnectionState,
	SerialPortFilter,
	SerialCommand,
	SerialDataFormat,
	DeviceCapabilities
} from '../../types';

export class SerialConnectionManager {
	private port: SerialPort | null = null;
	private isConnected = false;
	private connectionState: SerialConnectionState = SerialConnectionState.DISCONNECTED;
	private messageQueue: Map<number, SerialMessageQueueItem> = new Map();
	private sequenceNumber = 0;
	private receiveBuffer: Uint8Array = new Uint8Array();
	private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

	// 协议常量（与TCP协议完全统一）
	private static readonly MAGIC_NUMBER = 0xAA55;      // 帧头/魔数
	private static readonly FRAME_TRAILER = 0x55AA;     // 帧尾
	private static readonly FRAME_HEADER_SIZE = 11;     // 统一帧头大小（11字节）
  
	// 默认配置
	private defaultOptions: SerialConnectionOptions = {
		baudRate: 115200,
		dataBits: 8,
		stopBits: 1,
		parity: 'none',
		flowControl: 'none',
		requestTimeout: 30000
	};

	// 默认设备过滤器（支持常见的USB转串口芯片）
	private defaultFilters: SerialPortFilter[] = [
		{ usbVendorId: 0x1A86 },  // CH340/CH341
		{ usbVendorId: 0x10C4 },  // CP210x
		{ usbVendorId: 0x0403 },  // FTDI
		{ usbVendorId: 0x2341 },  // Arduino
		{ usbVendorId: 0x239A }  // Adafruit
	];

	constructor() {
		this.bindMethods();
		this.setupEventHandlers();
	}

	/**
   * 绑定方法到实例，避免this丢失
   */
	private bindMethods(): void {
		this.handleReceivedData = this.handleReceivedData.bind(this);
		this.handlePortDisconnect = this.handlePortDisconnect.bind(this);
		this.cleanup = this.cleanup.bind(this);
	}

	/**
   * 设置事件处理器
   */
	private setupEventHandlers(): void {
		// 监听串口设备连接/断开事件
		if ('serial' in navigator && navigator.serial) {
			navigator.serial.addEventListener('connect', (event) => {
				console.log('串口设备已连接:', event.target);
			});

			navigator.serial.addEventListener('disconnect', (event) => {
				console.log('串口设备已断开:', event.target);
				if (event.target === this.port) {
					this.handlePortDisconnect();
				}
			});
		}

		// 页面卸载时清理资源
		window.addEventListener('beforeunload', this.cleanup);
	}

	/**
   * 请求用户选择串口设备
   */
	async requestPort(filters?: SerialPortFilter[]): Promise<SerialPort> {
		if (!('serial' in navigator)) {
			throw new Error('Web Serial API 不支持。请确保使用支持的浏览器（Chrome 89+）或 VSCode');
		}

		this.connectionState = SerialConnectionState.REQUESTING;

		try {
			const port = await navigator.serial!.requestPort({
				filters: filters || this.defaultFilters
			});

			console.log('用户选择了串口设备:', await this.getPortInfo(port));
			return port;
		} catch (error) {
			this.connectionState = SerialConnectionState.DISCONNECTED;
			if (error instanceof Error && error.name === 'NotFoundError') {
				throw new Error('用户未选择串口设备');
			}
			throw new Error(`请求串口设备失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
   * 获取已授权的串口设备列表
   */
	async getAuthorizedPorts(): Promise<SerialPort[]> {
		if (!('serial' in navigator)) {
			return [];
		}

		try {
			return await navigator.serial!.getPorts();
		} catch (error) {
			console.error('获取已授权串口设备失败:', error);
			return [];
		}
	}

	/**
   * 连接串口设备
   */
	async connect(options: Partial<SerialConnectionOptions> = {}, filters?: SerialPortFilter[]): Promise<boolean> {
		try {
			this.connectionState = SerialConnectionState.CONNECTING;
      
			// 合并配置选项
			const config = { ...this.defaultOptions, ...options };

			// 如果没有端口，先请求用户选择
			if (!this.port) {
				this.port = await this.requestPort(filters);
			}

			// 配置并打开串口
			await this.port.open({
				baudRate: config.baudRate,
				dataBits: config.dataBits,
				stopBits: config.stopBits,
				parity: config.parity,
				flowControl: config.flowControl
			});

			this.isConnected = true;
			this.connectionState = SerialConnectionState.CONNECTED;

			// 获取读写器
			this.reader = this.port.readable!.getReader();
			this.writer = this.port.writable!.getWriter();

			// 启动数据接收循环
			this.startReceiveLoop();

			console.log('串口连接成功:', {
				baudRate: config.baudRate,
				dataBits: config.dataBits,
				stopBits: config.stopBits,
				parity: config.parity,
				flowControl: config.flowControl
			});

			return true;
		} catch (error) {
			this.connectionState = SerialConnectionState.ERROR;
			this.cleanup();
			throw new Error(`串口连接失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
   * 断开串口连接
   */
	async disconnect(): Promise<void> {
		try {
			this.isConnected = false;
			this.connectionState = SerialConnectionState.DISCONNECTED;

			// 清理所有待处理的请求
			this.clearMessageQueue();

			// 释放读写器
			if (this.reader) {
				await this.reader.cancel();
				this.reader.releaseLock();
				this.reader = null;
			}

			if (this.writer) {
				await this.writer.close();
				this.writer = null;
			}

			// 关闭串口
			if (this.port && this.port.readable) {
				await this.port.close();
			}

			this.port = null;
			console.log('串口已断开');
		} catch (error) {
			console.error('断开串口时发生错误:', error);
			throw new Error(`断开串口失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
   * 检查连接状态
   */
	isPortConnected(): boolean {
		return this.isConnected && this.port !== null && this.connectionState === SerialConnectionState.CONNECTED;
	}

	/**
   * 获取连接状态
   */
	getConnectionState(): SerialConnectionState {
		return this.connectionState;
	}

	/**
   * 获取串口设备信息
   */
	async getPortInfo(port?: SerialPort): Promise<Record<string, any>> {
		const targetPort = port || this.port;
		if (!targetPort) {
			return {};
		}

		try {
			const info = targetPort.getInfo();
			return {
				usbVendorId: info.usbVendorId,
				usbProductId: info.usbProductId,
				bluetoothServiceClassId: info.bluetoothServiceClassId,
				// 注意：某些浏览器可能不提供这些信息
				displayName: (info as any).displayName,
				manufacturer: (info as any).manufacturer,
				product: (info as any).product,
				serialNumber: (info as any).serialNumber
			};
		} catch (error) {
			console.warn('获取串口设备信息失败:', error);
			return {};
		}
	}

	/**
   * 数据接收循环
   */
	private async startReceiveLoop(): Promise<void> {
		if (!this.reader) {return;}

		try {
			while (this.isConnected && this.reader) {
				const { value, done } = await this.reader.read();
        
				if (done) {
					console.log('串口数据流结束');
					break;
				}

				if (value && value.length > 0) {
					await this.handleReceivedData(value);
				}
			}
		} catch (error) {
			if (this.isConnected) {
				console.error('数据接收错误:', error);
				this.handlePortDisconnect();
			}
		}
	}

	/**
   * 处理接收到的数据
   */
	private async handleReceivedData(data: Uint8Array): Promise<void> {
		try {
			// 将新数据添加到缓冲区
			const newBuffer = new Uint8Array(this.receiveBuffer.length + data.length);
			newBuffer.set(this.receiveBuffer);
			newBuffer.set(data, this.receiveBuffer.length);
			this.receiveBuffer = newBuffer;

			// 尝试解析完整的帧
			while (this.receiveBuffer.length >= SerialConnectionManager.FRAME_HEADER_SIZE) {
				const frame = this.parseFrame(this.receiveBuffer);
        
				if (frame) {
					// 处理解析到的帧
					this.handleParsedFrame(frame);
          
					// 移除已处理的数据
					const frameLength = SerialConnectionManager.FRAME_HEADER_SIZE + frame.dataLength;
					this.receiveBuffer = this.receiveBuffer.slice(frameLength);
				} else {
					// 寻找下一个可能的帧头
					const headerPosition = this.findFrameHeader(this.receiveBuffer, 1);
					if (headerPosition > 0) {
						this.receiveBuffer = this.receiveBuffer.slice(headerPosition);
					} else if (this.receiveBuffer.length > 1024) {
						// 防止缓冲区无限增长，清理无效数据
						this.receiveBuffer = new Uint8Array();
					}
					break;
				}
			}
		} catch (error) {
			console.error('处理接收数据时发生错误:', error);
		}
	}

	/**
   * 查找帧头位置
   */
	private findFrameHeader(buffer: Uint8Array, startIndex = 0): number {
		for (let i = startIndex; i < buffer.length - 1; i++) {
			if (buffer[i] === 0xAA && buffer[i + 1] === 0x55) {
				return i;
			}
		}
		return -1;
	}

	/**
   * 解析数据帧（与TCP协议完全一致的11字节帧格式）
   */
	private parseFrame(buffer: Uint8Array): SerialFrame | null {
		if (buffer.length < SerialConnectionManager.FRAME_HEADER_SIZE) {
			return null;
		}

		let offset = 0;

		// 检查帧头/魔数 (2字节，大端序) - 0xAA55
		const magic = (buffer[offset] << 8) | buffer[offset + 1];
		if (magic !== SerialConnectionManager.MAGIC_NUMBER) {
			return null;
		}
		offset += 2;

		// 解析数据长度 (2字节，小端序)
		const dataLength = buffer[offset] | (buffer[offset + 1] << 8);
		offset += 2;

		// 检查是否有足够的数据
		const totalFrameLength = SerialConnectionManager.FRAME_HEADER_SIZE + dataLength;
		if (buffer.length < totalFrameLength) {
			return null;
		}

		// 解析序列号 (2字节，小端序)
		const sequenceNumber = buffer[offset] | (buffer[offset + 1] << 8);
		offset += 2;

		// 解析命令码 (1字节)
		const command = buffer[offset++];

		// 解析数据格式 (1字节)
		const format = buffer[offset++];

		// 提取数据体
		const data = buffer.slice(offset, offset + dataLength);
		offset += dataLength;

		// 解析校验和 (1字节)
		const checksum = buffer[offset++];

		// 检查帧尾 (2字节，大端序) - 0x55AA
		const trailer = (buffer[offset] << 8) | buffer[offset + 1];
		if (trailer !== SerialConnectionManager.FRAME_TRAILER) {
			return null;
		}

		// 验证校验和（对从数据长度到数据体结束的所有字节进行CRC8校验）
		const checksumData = buffer.slice(2, 2 + 6 + dataLength); // 从数据长度开始到数据体结束
		const calculatedChecksum = this.calculateCRC8(checksumData);
    
		if (checksum !== calculatedChecksum) {
			console.warn(`帧校验和错误: 期望 0x${calculatedChecksum.toString(16)}, 实际 0x${checksum.toString(16)}`);
			return null;
		}

		return {
			magic,
			dataLength,
			sequenceNumber,
			command,
			format,
			data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
			checksum,
			trailer
		};
	}

	/**
   * 处理解析到的帧
   */
	private handleParsedFrame(frame: SerialFrame): void {
		try {
			// 根据序列号匹配待处理的请求
			const queueItem = this.messageQueue.get(frame.sequenceNumber);
      
			if (queueItem) {
				// 清理超时定时器
				if (queueItem.timeout) {
					clearTimeout(queueItem.timeout);
				}
        
				// 移除队列项
				this.messageQueue.delete(frame.sequenceNumber);
        
				// 解析响应数据
				let responseData: any = null;
				try {
					if (frame.format === SerialDataFormat.JSON) {
						const decoder = new TextDecoder();
						const jsonStr = decoder.decode(frame.data);
						responseData = JSON.parse(jsonStr);
					} else if (frame.format === SerialDataFormat.PROTOBUF) {
						// TODO: 实现Protobuf解码
						responseData = frame.data;
					} else {
						throw new Error(`不支持的数据格式: 0x${frame.format.toString(16)}`);
					}
          
					// 调用成功回调
					queueItem.resolve(responseData);
				} catch (parseError) {
					// 数据解析失败
					queueItem.reject(new Error(`响应数据解析失败: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
				}
			} else {
				// 未找到匹配的请求，可能是设备主动发送的数据
				console.warn(`收到未匹配的响应帧，序列号: ${frame.sequenceNumber}`);
        
				// 这里可以处理设备主动发送的通知消息
				this.handleUnsolicitedFrame(frame);
			}
		} catch (error) {
			console.error('处理解析帧时发生错误:', error);
		}
	}

	/**
   * 处理设备主动发送的帧（如状态通知、错误报告等）
   */
	private handleUnsolicitedFrame(frame: SerialFrame): void {
		// 这里可以实现对设备主动发送数据的处理
		// 例如：状态更新、错误通知、进度报告等
		console.log('收到设备主动发送的数据:', {
			command: `0x${frame.command.toString(16).padStart(2, '0')}`,
			format: frame.format,
			dataLength: frame.dataLength
		});
	}

	/**
   * 发送数据帧
   */
	async sendFrame(command: number, format: number, data: Uint8Array, sequenceNumber?: number): Promise<void> {
		if (!this.isPortConnected() || !this.writer) {
			throw new Error('串口未连接');
		}

		const seqNum = sequenceNumber ?? this.generateSequenceNumber();
		const frame = this.buildFrame(command, format, data, seqNum);

		try {
			await this.writer.write(frame);
			console.debug(`发送帧: 命令=0x${command.toString(16)}, 序列号=${seqNum}, 数据长度=${data.length}`);
		} catch (error) {
			throw new Error(`发送数据失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
   * 构建统一协议数据帧（11字节帧头 + 数据体）
   */
	private buildFrame(command: number, format: number, data: Uint8Array, sequenceNumber: number): Uint8Array {
		const totalLength = SerialConnectionManager.FRAME_HEADER_SIZE + data.length;
		const frame = new Uint8Array(totalLength);
    
		let offset = 0;
    
		// 帧头/魔数 (2字节，大端序) - 0xAA55
		frame[offset++] = (SerialConnectionManager.MAGIC_NUMBER >> 8) & 0xFF;
		frame[offset++] = SerialConnectionManager.MAGIC_NUMBER & 0xFF;
    
		// 数据长度 (2字节，小端序)
		frame[offset++] = data.length & 0xFF;
		frame[offset++] = (data.length >> 8) & 0xFF;
    
		// 序列号 (2字节，小端序)
		frame[offset++] = sequenceNumber & 0xFF;
		frame[offset++] = (sequenceNumber >> 8) & 0xFF;
    
		// 命令码 (1字节)
		frame[offset++] = command & 0xFF;
    
		// 数据格式 (1字节)
		frame[offset++] = format & 0xFF;
    
		// 数据体
		frame.set(data, offset);
		offset += data.length;
    
		// 计算并添加校验和 (1字节) - 对从数据长度开始到数据体结束的所有字节进行CRC8校验
		const checksumData = frame.slice(2, offset);
		const checksum = this.calculateCRC8(checksumData);
		frame[offset++] = checksum;
    
		// 帧尾 (2字节，大端序) - 0x55AA
		frame[offset++] = (SerialConnectionManager.FRAME_TRAILER >> 8) & 0xFF;
		frame[offset++] = SerialConnectionManager.FRAME_TRAILER & 0xFF;
    
		return frame;
	}

	/**
   * CRC8校验计算（ITU多项式 0x07）
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
   * 生成序列号
   */
	private generateSequenceNumber(): number {
		this.sequenceNumber = (this.sequenceNumber + 1) & 0xFFFF; // 2字节范围内循环
		return this.sequenceNumber;
	}

	/**
   * 发送请求并等待响应
   */
	async sendRequest(command: number, data: any, format: SerialDataFormat = SerialDataFormat.JSON, timeout?: number): Promise<any> {
		const sequenceNumber = this.generateSequenceNumber();
		const requestTimeout = timeout || this.defaultOptions.requestTimeout!;

		// 序列化数据
		let serializedData: Uint8Array;
		if (format === SerialDataFormat.JSON) {
			const jsonStr = JSON.stringify(data);
			serializedData = new TextEncoder().encode(jsonStr);
		} else if (format === SerialDataFormat.PROTOBUF) {
			// TODO: 实现Protobuf编码
			throw new Error('Protobuf格式暂未实现');
		} else {
			throw new Error(`不支持的数据格式: ${format}`);
		}

		// 创建Promise用于等待响应
		const responsePromise = new Promise<any>((resolve, reject) => {
			const timeoutHandle = setTimeout(() => {
				this.messageQueue.delete(sequenceNumber);
				reject(new Error(`请求超时 (${requestTimeout}ms)`));
			}, requestTimeout);

			const queueItem: SerialMessageQueueItem = {
				sequenceNumber,
				resolve,
				reject,
				timestamp: Date.now(),
				timeout: timeoutHandle
			};

			this.messageQueue.set(sequenceNumber, queueItem);
		});

		// 发送请求
		await this.sendFrame(command, format, serializedData, sequenceNumber);

		return responsePromise;
	}

	/**
   * 处理端口断开事件
   */
	private handlePortDisconnect(): void {
		console.log('检测到串口设备断开');
		this.isConnected = false;
		this.connectionState = SerialConnectionState.DISCONNECTED;
    
		// 清理资源
		this.clearMessageQueue();
		this.cleanup();
    
		// 这里可以触发重连逻辑或通知上层应用
		// emit('disconnect') 或者调用回调函数
	}

	/**
   * 清理消息队列
   */
	private clearMessageQueue(): void {
		for (const [seqNum, item] of this.messageQueue.entries()) {
			if (item.timeout) {
				clearTimeout(item.timeout);
			}
			item.reject(new Error('连接已断开'));
		}
		this.messageQueue.clear();
	}

	/**
   * 清理资源
   */
	private cleanup(): void {
		this.clearMessageQueue();
    
		if (this.reader) {
			this.reader.releaseLock();
			this.reader = null;
		}
    
		if (this.writer) {
			this.writer.releaseLock();
			this.writer = null;
		}
    
		this.receiveBuffer = new Uint8Array();
		this.sequenceNumber = 0;
	}

	/**
   * 获取统计信息
   */
	getStatistics(): Record<string, any> {
		return {
			isConnected: this.isConnected,
			connectionState: this.connectionState,
			pendingRequests: this.messageQueue.size,
			sequenceNumber: this.sequenceNumber,
			bufferSize: this.receiveBuffer.length,
			portInfo: this.port ? 'Connected' : 'Not connected'
		};
	}
}