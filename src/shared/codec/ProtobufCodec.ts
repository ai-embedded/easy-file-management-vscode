/**
 * 真正的 Protobuf 编解码器
 * 使用自动生成的 protobuf 编解码器进行真正的二进制编解码
 */

import { Logger } from '../utils/Logger';
import { TypeValidator } from '../validation/TypeValidator';
import { 
	ProtobufEncoder,
	initialize as initializeProtobuf,
	IUnifiedRequest,
	IUnifiedResponse,
	IFileInfo,
	IServerInfo,
	Operation
} from '../proto/unified_file_protocol';

const logger = new Logger('ProtobufCodec');

// 重新导出类型和枚举以保持向后兼容
export type UnifiedRequest = IUnifiedRequest;
export type UnifiedResponse = IUnifiedResponse;
export { Operation };

/**
 * 真正的 Protobuf 编解码器类
 */
export class ProtobufCodec {
	private static instance: ProtobufCodec;
	private initialized = false;

	constructor() {
		// 单例模式
		if (ProtobufCodec.instance) {
			return ProtobufCodec.instance;
		}
		ProtobufCodec.instance = this;
	}

	/**
   * 初始化编解码器
   * 🔧 修复：移除重复调用，只调用 ProtobufEncoder.initialize()
   */
	async initialize(): Promise<void> {
		if (this.initialized) {
			logger.debug('ℹ️ 编解码器已初始化，跳过重复初始化');
			return;
		}

		try {
			// 🔧 修复：只调用 ProtobufEncoder.initialize()，它内部会调用 initializeProtobuf()
			logger.debug('🔄 开始初始化 Protobuf 编解码器...');
			await ProtobufEncoder.initialize();
      
			this.initialized = true;
			logger.info('✅ Protobuf 编解码器初始化成功 (统一初始化路径)');
			logger.info('🚀 现在使用二进制 protobuf 编解码，性能显著提升！');
			logger.debug('🎯 初始化统计: 避免了重复调用 initializeProtobuf()');
		} catch (error) {
			logger.error('❌ Protobuf 编解码器初始化失败:', error);
			logger.error('💥 初始化错误详情:', {
				errorType: error instanceof Error ? error.constructor.name : typeof error,
				errorMessage: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined
			});
			throw error;
		}
	}

	/**
   * 编码请求消息 - 真正的 protobuf 二进制编码（带验证）
   */
	encodeRequest(request: UnifiedRequest): Uint8Array {
		try {
			if (!this.initialized) {
				throw new Error('Protobuf 编解码器未初始化，请先调用 initialize()');
			}

			// 🔍 调试日志：检查请求对象
			logger.info('🔍 [调试] ProtobufCodec.encodeRequest 收到请求:');
			logger.info(`  - operation 字段值: ${request.operation}`);
			logger.info(`  - operation 类型: ${typeof request.operation}`);
			logger.info(`  - Operation.CONNECT 值: ${Operation.CONNECT}`);

			// 🔍 运行时类型验证
			const validation = TypeValidator.validateRequest(request);
			if (!validation.valid) {
				throw new Error(`请求验证失败: ${validation.errors.join(', ')}`);
			}

			// 使用真正的 protobuf 二进制编码
			const binaryData = ProtobufEncoder.encodeRequest(request);
      
			logger.debug(`📦 Protobuf 请求编码成功: ${binaryData.length} 字节 (操作: ${Operation[request.operation]})`);
			return binaryData;
		} catch (error) {
			logger.error('❌ Protobuf 请求编码失败:', error);
			throw error;
		}
	}

	/**
   * 解码响应消息 - 真正的 protobuf 二进制解码（带验证）
   */
	decodeResponse(data: Uint8Array): UnifiedResponse {
		try {
			if (!this.initialized) {
				throw new Error('Protobuf 编解码器未初始化，请先调用 initialize()');
			}

			// 🔍 数据完整性检查
			if (!data || data.length === 0) {
				throw new Error('解码数据为空');
			}

			// 使用真正的 protobuf 二进制解码
			const response = ProtobufEncoder.decodeResponse(data);
      
			// 🔍 运行时类型验证
			const validation = TypeValidator.validateResponse(response);
			if (!validation.valid) {
				logger.warn(`响应验证失败: ${validation.errors.join(', ')}`);
				// 不抛出错误，只记录警告，因为响应可能来自不同版本的服务器
			}
      
			logger.debug(`📦 Protobuf 响应解码成功: ${data.length} 字节 -> ${response.success ? '成功' : '失败'}`);
			return response;
		} catch (error) {
			logger.error('❌ Protobuf 响应解码失败:', error);
			throw error;
		}
	}

	/**
   * 编码响应消息（用于测试和服务器端）
   */
	encodeResponse(response: UnifiedResponse): Uint8Array {
		try {
			if (!this.initialized) {
				throw new Error('Protobuf 编解码器未初始化，请先调用 initialize()');
			}

			const binaryData = ProtobufEncoder.encodeResponse(response);
			logger.debug(`📦 Protobuf 响应编码成功: ${binaryData.length} 字节`);
			return binaryData;
		} catch (error) {
			logger.error('❌ Protobuf 响应编码失败:', error);
			throw error;
		}
	}

	/**
   * 解码请求消息（用于测试和服务器端）
   */
	decodeRequest(data: Uint8Array): UnifiedRequest {
		try {
			if (!this.initialized) {
				throw new Error('Protobuf 编解码器未初始化，请先调用 initialize()');
			}

			const request = ProtobufEncoder.decodeRequest(data);
			logger.debug(`📦 Protobuf 请求解码成功: ${data.length} 字节 (操作: ${Operation[request.operation]})`);
			return request;
		} catch (error) {
			logger.error('❌ Protobuf 请求解码失败:', error);
			throw error;
		}
	}

	/**
   * 获取操作名称（用于调试）
   */
	getOperationName(operation: number): string {
		return Operation[operation] || 'UNKNOWN';
	}

	/**
   * 检查是否已初始化
   */
	isInitialized(): boolean {
		return this.initialized;
	}

	/**
   * 获取编码器统计信息（用于性能监控）
   */
	getStats(): { initialized: boolean; version: string } {
		return {
			initialized: this.initialized,
			version: '2.0.0-protobuf'
		};
	}
}
