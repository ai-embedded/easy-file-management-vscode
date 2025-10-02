/**
 * HTTP通用编解码器
 * 复用TCP的UniversalCodec，实现HTTP传输的协议统一
 * 支持JSON、Protobuf和自动协商模式
 */

import { UniversalCodec } from '../../shared/codec/UniversalCodec';
import { Logger } from '../../shared/utils/Logger';

const logger = new Logger('HttpUniversalCodec');

/**
 * HTTP编码结果
 */
interface HttpEncodedData {
  format: string;
  data: Buffer;
  contentType: string;
}

/**
 * HTTP专用编解码器
 * 继承UniversalCodec并提供HTTP专用适配
 */
export class HttpUniversalCodec extends UniversalCodec {
	constructor() {
		super();
	}
  
	/**
   * HTTP专用编码：支持协议选择与优化
   * @param data 要编码的数据
   * @param operation 操作名称
   * @param format 编码格式：json | protobuf | auto，默认为json
   */
	async encodeForHttp(
		data: any, 
		operation: string, 
		format: 'json' | 'protobuf' | 'auto' = 'json'
	): Promise<HttpEncodedData> {
		try {
			// 🔄 复用TCP实现的智能编码逻辑
			const encodedData = await this.smartEncode(data, operation, format);
      
			// 🌐 HTTP专用适配
			const contentType = this.getHttpContentType(encodedData.format);
      
			return {
				format: this.getFormatName(encodedData.format),
				data: Buffer.from(encodedData.data),
				contentType
			};
		} catch (error) {
			logger.error(`HTTP编码失败: ${error}`, { operation, format });
			// 回退到JSON编码
			const jsonData = JSON.stringify(data);
			return {
				format: 'json',
				data: Buffer.from(jsonData, 'utf8'),
				contentType: 'application/json'
			};
		}
	}
  
	/**
   * HTTP专用解码
   * @param data 要解码的数据
   * @param contentType HTTP Content-Type头
   */
	async decodeFromHttp(data: Buffer, contentType: string): Promise<any> {
		try {
			const format = this.parseHttpContentType(contentType);
			const uint8Data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      
			return await this.autoDecode(uint8Data, format);
		} catch (error) {
			logger.error(`HTTP解码失败: ${error}`, { contentType });
			// 回退到JSON解码
			try {
				return JSON.parse(data.toString('utf8'));
			} catch (jsonError) {
				logger.error(`JSON回退解码也失败: ${jsonError}`);
				throw new Error(`HTTP解码失败: ${error}, JSON回退也失败: ${jsonError}`);
			}
		}
	}
  
	/**
   * HTTP内容类型映射
   * @param format 内部格式标识
   */
	private getHttpContentType(format: number): string {
		const formatMap: { [key: number]: string } = {
			0x01: 'application/json',                    // JSON
			0x02: 'application/x-protobuf',             // Protobuf
			0x04: 'application/json; charset=utf-8',    // 压缩JSON
			0x06: 'application/x-protobuf-compressed'   // 压缩Protobuf
		};
		return formatMap[format] || 'application/octet-stream';
	}
  
	/**
   * 解析HTTP Content-Type到内部格式
   * @param contentType HTTP Content-Type头
   */
	private parseHttpContentType(contentType: string): number {
		const normalizedType = contentType.toLowerCase().split(';')[0].trim();
    
		const typeMap: { [key: string]: number } = {
			'application/json': 0x01,
			'application/x-protobuf': 0x02,
			'application/x-protobuf-compressed': 0x06
		};
    
		return typeMap[normalizedType] || 0x01; // 默认JSON
	}
  
	/**
   * 获取格式名称
   * @param format 内部格式标识
   */
	private getFormatName(format: number): string {
		switch (format) {
			case 0x01: return 'json';
			case 0x02: return 'protobuf';
			case 0x04: return 'json-compressed';
			case 0x06: return 'protobuf-compressed';
			default: return 'unknown';
		}
	}
  
	/**
   * 创建HTTP配置的默认协议设置
   * @param userFormat 用户选择的格式
   */
	static createDefaultConfig(userFormat: 'json' | 'protobuf' | 'auto' = 'json'): HttpConfig['negotiation'] {
		return {
			enabled: userFormat === 'auto',
			timeout: 5000,
			fallbackFormat: 'json'
		};
	}
  
	/**
   * 验证HTTP配置的协议设置
   * @param config HTTP配置
   */
	static validateConfig(config: HttpConfig): boolean {
		// 验证基本配置
		if (!config.dataFormat) {
			config.dataFormat = 'json'; // 默认JSON
		}
    
		// 验证协商配置
		if (config.dataFormat === 'auto' && !config.negotiation?.enabled) {
			logger.warn('Auto模式需要启用协商功能');
			return false;
		}
    
		// 验证优化配置
		if (config.optimization) {
			if (config.optimization.chunkSize && config.optimization.chunkSize < 1024) {
				logger.warn('分片大小建议不小于1KB');
			}
		}
    
		return true;
	}
}
