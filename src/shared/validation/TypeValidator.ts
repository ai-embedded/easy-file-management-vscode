/**
 * 类型验证器
 * 提供运行时类型验证和数据完整性检查
 */

import { Logger } from '../utils/Logger';
import { Operation } from '../proto/unified_file_protocol';

const logger = new Logger('TypeValidator');

/**
 * 验证结果接口
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 文件信息验证器
 */
export class FileInfoValidator {
	/**
   * 验证文件信息对象
   */
	static validate(fileInfo: any): ValidationResult {
		const result: ValidationResult = {
			valid: true,
			errors: [],
			warnings: []
		};

		// 必需字段验证
		if (!fileInfo.name || typeof fileInfo.name !== 'string') {
			result.errors.push('文件名必须是非空字符串');
			result.valid = false;
		}

		if (!fileInfo.path || typeof fileInfo.path !== 'string') {
			result.errors.push('文件路径必须是非空字符串');
			result.valid = false;
		}

		if (!fileInfo.type || !['file', 'directory'].includes(fileInfo.type)) {
			result.errors.push('文件类型必须是 "file" 或 "directory"');
			result.valid = false;
		}

		// 可选字段类型验证
		if (fileInfo.size !== undefined && (typeof fileInfo.size !== 'number' || fileInfo.size < 0)) {
			result.errors.push('文件大小必须是非负数');
			result.valid = false;
		}

		if (fileInfo.lastModified !== undefined) {
			try {
				new Date(fileInfo.lastModified);
			} catch (error) {
				result.errors.push('最后修改时间格式无效');
				result.valid = false;
			}
		}

		if (fileInfo.isReadonly !== undefined && typeof fileInfo.isReadonly !== 'boolean') {
			result.warnings.push('isReadonly 应该是布尔值');
		}

		return result;
	}
}

/**
 * 请求消息验证器
 */
export class RequestValidator {
	/**
   * 验证统一请求消息
   */
	static validate(request: any): ValidationResult {
		const result: ValidationResult = {
			valid: true,
			errors: [],
			warnings: []
		};

		// 操作码验证
		if (request.operation === undefined) {
			result.errors.push('操作码不能为空');
			result.valid = false;
		} else if (!Object.values(Operation).includes(request.operation)) {
			result.errors.push(`无效的操作码: ${request.operation}`);
			result.valid = false;
		}

		// 路径验证
		if (request.path !== undefined) {
			if (typeof request.path !== 'string') {
				result.errors.push('路径必须是字符串');
				result.valid = false;
			} else if (request.path.includes('..')) {
				result.errors.push('路径不能包含 ".." (安全检查)');
				result.valid = false;
			}
		}

		// 文件名验证
		if (request.name !== undefined && typeof request.name !== 'string') {
			result.errors.push('文件名必须是字符串');
			result.valid = false;
		}

		// 数据验证
		if (request.data !== undefined) {
			if (!(request.data instanceof Uint8Array) && typeof request.data !== 'string') {
				result.errors.push('数据必须是 Uint8Array 或字符串');
				result.valid = false;
			}
		}

		// 分块传输验证
		if (request.isChunk) {
			// 🔧 修复P1问题：支持字节范围模式
			const isByteRangeMode = request.options?.requestType === 'byteRange';
      
			if (isByteRangeMode) {
				// ✅ 字节范围模式：验证 rangeStart 和 rangeEnd
				if (request.options?.rangeStart !== undefined) {
					const rangeStart = parseInt(request.options.rangeStart as string);
					if (isNaN(rangeStart) || rangeStart < 0) {
						result.errors.push('字节范围起始位置必须是非负整数');
						result.valid = false;
					}
				}
        
				if (request.options?.rangeEnd !== undefined) {
					const rangeEnd = parseInt(request.options.rangeEnd as string);
					if (isNaN(rangeEnd) || rangeEnd < 0) {
						result.errors.push('字节范围结束位置必须是非负整数');
						result.valid = false;
					}
          
					// 检查范围有效性
					if (request.options?.rangeStart !== undefined) {
						const rangeStart = parseInt(request.options.rangeStart as string);
						const rangeEnd = parseInt(request.options.rangeEnd as string);
						if (!isNaN(rangeStart) && !isNaN(rangeEnd) && rangeStart >= rangeEnd) {
							result.errors.push('字节范围起始位置必须小于结束位置');
							result.valid = false;
						}
					}
				}
        
				// 字节范围模式下，不强制要求 chunkIndex 和 totalChunks
				logger.debug('✅ 字节范围模式校验通过', {
					rangeStart: request.options?.rangeStart,
					rangeEnd: request.options?.rangeEnd
				});
		
			} else {
				// 📦 块序号模式：保持原有校验逻辑
				if (request.chunkIndex === undefined || typeof request.chunkIndex !== 'number' || request.chunkIndex < 0) {
					result.errors.push('分块索引必须是非负数');
					result.valid = false;
				}

				if (request.totalChunks === undefined || typeof request.totalChunks !== 'number' || request.totalChunks <= 0) {
					result.errors.push('总块数必须是正数');
					result.valid = false;
				}

				if (request.chunkIndex !== undefined && request.totalChunks !== undefined &&
            request.chunkIndex >= request.totalChunks) {
					result.errors.push('分块索引不能大于或等于总块数');
					result.valid = false;
				}
        
				logger.debug('📦 块序号模式校验', {
					chunkIndex: request.chunkIndex,
					totalChunks: request.totalChunks
				});
			}
		}

		// 文件大小验证 (支持 int64 的 string | number)
		if (request.fileSize !== undefined) {
			// 支持 string 类型的大数字（int64）
			if (typeof request.fileSize === 'string') {
				// 验证是否为有效的非负整数字符串
				if (!/^\d+$/.test(request.fileSize) || BigInt(request.fileSize) < 0n) {
					result.errors.push('文件大小必须是非负整数字符串');
					result.valid = false;
				} else {
					logger.debug(`✅ fileSize 字段验证通过 (string): ${request.fileSize}`);
				}
        
				// 检查文件大小限制 (100MB)
				const maxFileSize = 100 * 1024 * 1024;
				const fileSizeNum = Number(request.fileSize);
				if (!isNaN(fileSizeNum) && fileSizeNum > maxFileSize) {
					result.warnings.push(`文件大小 ${request.fileSize} 超过建议限制 ${maxFileSize}`);
				}
			} else if (typeof request.fileSize === 'number') {
				if (request.fileSize < 0) {
					result.errors.push('文件大小必须是非负数');
					result.valid = false;
				} else {
					logger.debug(`✅ fileSize 字段验证通过 (number): ${request.fileSize}`);
				}
        
				// 检查文件大小限制 (100MB)
				const maxFileSize = 100 * 1024 * 1024;
				if (request.fileSize > maxFileSize) {
					result.warnings.push(`文件大小 ${request.fileSize} 超过建议限制 ${maxFileSize}`);
				}
			} else {
				result.errors.push('文件大小必须是 number 或 string 类型');
				result.valid = false;
			}
		}

		return result;
	}
}

// 对外暴露的统一校验入口
export function validateRequestAndReport(request: any): ValidationResult {
	const result = RequestValidator.validate(request);

	if (!result.valid) {
		logger.warn('❌ 请求校验失败', {
			errors: result.errors,
			warnings: result.warnings,
			op: request?.operation
		});
	} else if (result.warnings.length > 0) {
		logger.info('⚠️ 请求校验通过但存在警告', {
			warnings: result.warnings,
			op: request?.operation
		});
	} else {
		logger.debug('✅ 请求校验通过', {
			op: request?.operation
		});
	}

	return result;
}

/**
 * 响应消息验证器
 */
export class ResponseValidator {
	/**
   * 验证统一响应消息
   */
	static validate(response: any): ValidationResult {
		const result: ValidationResult = {
			valid: true,
			errors: [],
			warnings: []
		};

		// 成功标志验证
		if (response.success === undefined || typeof response.success !== 'boolean') {
			result.errors.push('success 字段必须是布尔值');
			result.valid = false;
		}

		// 消息验证
		if (response.message !== undefined && typeof response.message !== 'string') {
			result.warnings.push('message 字段应该是字符串');
		}

		// 文件列表验证
		if (response.files !== undefined) {
			if (!Array.isArray(response.files)) {
				result.errors.push('files 字段必须是数组');
				result.valid = false;
			} else {
				response.files.forEach((file: any, index: number) => {
					const fileValidation = FileInfoValidator.validate(file);
					if (!fileValidation.valid) {
						result.errors.push(`文件 ${index}: ${fileValidation.errors.join(', ')}`);
						result.valid = false;
					}
					result.warnings.push(...fileValidation.warnings.map(w => `文件 ${index}: ${w}`));
				});
			}
		}

		// 时间戳验证 (支持 int64 的 string | number)
		if (response.timestamp !== undefined) {
			// 支持 string 类型的大数字（int64）
			if (typeof response.timestamp === 'string') {
				// 验证是否为有效的正整数字符串
				if (!/^\d+$/.test(response.timestamp) || BigInt(response.timestamp) <= 0n) {
					result.warnings.push('时间戳应该是正整数字符串');
				} else {
					logger.debug(`✅ timestamp 字段验证通过 (string): ${response.timestamp}`);
				}
			} else if (typeof response.timestamp === 'number') {
				if (response.timestamp <= 0) {
					result.warnings.push('时间戳应该是正数');
				} else {
					logger.debug(`✅ timestamp 字段验证通过 (number): ${response.timestamp}`);
				}
			} else {
				result.warnings.push('时间戳应该是 number 或 string 类型');
			}
		}

		// 处理时间验证 (支持 int64 的 string | number)
		if (response.processTimeMs !== undefined) {
			// 支持 string 类型的大数字（int64）
			if (typeof response.processTimeMs === 'string') {
				// 验证是否为有效的非负整数字符串
				if (!/^\d+$/.test(response.processTimeMs) || BigInt(response.processTimeMs) < 0n) {
					result.warnings.push('处理时间应该是非负整数字符串');
				} else {
					logger.debug(`✅ processTimeMs 字段验证通过 (string): ${response.processTimeMs}`);
				}
			} else if (typeof response.processTimeMs === 'number') {
				if (response.processTimeMs < 0) {
					result.warnings.push('处理时间应该是非负数');
				} else {
					logger.debug(`✅ processTimeMs 字段验证通过 (number): ${response.processTimeMs}`);
				}
			} else {
				result.warnings.push('处理时间应该是 number 或 string 类型');
			}
		}

		return result;
	}
}

/**
 * 数据完整性检查器
 */
export class DataIntegrityChecker {
	/**
   * 计算数据校验和 (简单的 CRC32 实现)
   */
	static calculateChecksum(data: Uint8Array): string {
		let crc = 0xFFFFFFFF;
		for (let i = 0; i < data.length; i++) {
			crc ^= data[i];
			for (let j = 0; j < 8; j++) {
				crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
			}
		}
		return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
	}

	/**
   * 验证数据完整性
   */
	static verifyIntegrity(data: Uint8Array, expectedChecksum?: string): ValidationResult {
		const result: ValidationResult = {
			valid: true,
			errors: [],
			warnings: []
		};

		if (!data || data.length === 0) {
			result.warnings.push('数据为空');
			return result;
		}

		if (expectedChecksum) {
			const actualChecksum = this.calculateChecksum(data);
			if (actualChecksum !== expectedChecksum) {
				result.errors.push(`数据完整性检查失败: 期望 ${expectedChecksum}, 实际 ${actualChecksum}`);
				result.valid = false;
			} else {
				logger.debug(`✅ 数据完整性验证通过: ${actualChecksum}`);
			}
		}

		return result;
	}

	/**
   * 验证分块数据完整性
   */
	static verifyChunkIntegrity(chunks: Uint8Array[], expectedSize?: number): ValidationResult {
		const result: ValidationResult = {
			valid: true,
			errors: [],
			warnings: []
		};

		if (!chunks || chunks.length === 0) {
			result.errors.push('分块数据为空');
			result.valid = false;
			return result;
		}

		// 检查分块连续性
		let totalSize = 0;
		for (let i = 0; i < chunks.length; i++) {
			if (!chunks[i] || chunks[i].length === 0) {
				result.errors.push(`分块 ${i} 为空`);
				result.valid = false;
			}
			totalSize += chunks[i].length;
		}

		// 验证总大小
		if (expectedSize !== undefined && totalSize !== expectedSize) {
			result.errors.push(`分块总大小不匹配: 期望 ${expectedSize}, 实际 ${totalSize}`);
			result.valid = false;
		}

		logger.debug(`🔍 分块完整性检查: ${chunks.length} 块, 总计 ${totalSize} 字节`);

		return result;
	}
}

/**
 * 主验证器类
 */
export class TypeValidator {
	/**
   * 验证请求消息
   */
	static validateRequest(request: any): ValidationResult {
		logger.debug('🔍 开始验证请求消息');
		return validateRequestAndReport(request);
	}

	/**
   * 验证响应消息
   */
	static validateResponse(response: any): ValidationResult {
		logger.debug('🔍 开始验证响应消息');
		const result = ResponseValidator.validate(response);
    
		if (!result.valid) {
			logger.error('❌ 响应验证失败:', result.errors);
		} else if (result.warnings.length > 0) {
			logger.warn('⚠️ 响应验证警告:', result.warnings);
		} else {
			logger.debug('✅ 响应验证通过');
		}

		return result;
	}

	/**
   * 验证数据完整性
   */
	static validateDataIntegrity(data: Uint8Array, checksum?: string): ValidationResult {
		logger.debug('🔍 开始验证数据完整性');
		return DataIntegrityChecker.verifyIntegrity(data, checksum);
	}
}
