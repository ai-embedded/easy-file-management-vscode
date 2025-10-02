/**
 * 编解码器监控
 * 提供性能监控、错误统计和运行时格式切换功能
 */

import { Logger } from '../utils/Logger';

const logger = new Logger('CodecMonitor');

/**
 * 编解码统计信息
 */
export interface CodecStats {
  // 编码统计
  encodeAttempts: number;
  encodeSuccesses: number;
  encodeFailures: number;
  encodeJsonCount: number;
  encodeProtobufCount: number;
  
  // 解码统计
  decodeAttempts: number;
  decodeSuccesses: number;
  decodeFailures: number;
  decodeJsonCount: number;
  decodeProtobufCount: number;
  
  // 🔧 修复P1问题：独立的压缩/解压统计
  compressionAttempts: number;
  compressionSuccesses: number;
  compressionFailures: number;
  decompressionAttempts: number;
  decompressionSuccesses: number;
  decompressionFailures: number;
  
  // 性能统计
  totalEncodeTime: number;
  totalDecodeTime: number;
  avgEncodeTime: number;
  avgDecodeTime: number;
  
  // 数据量统计
  totalBytesEncoded: number;
  totalBytesDecoded: number;
  
  // 错误统计
  formatFallbackCount: number;
  validationFailures: number;
  
  // 时间戳
  startTime: number;
  lastUpdateTime: number;
}

/**
 * 编解码器监控器
 */
export class CodecMonitor {
	private static instance: CodecMonitor;
	private stats!: CodecStats; // 在构造函数中通过 resetStats 初始化
	private errorHistory: Array<{ timestamp: number; error: string; operation: string }> = [];
	private performanceHistory: Array<{ timestamp: number; operation: string; format: string; duration: number; bytes: number }> = [];
  
	constructor() {
		if (CodecMonitor.instance) {
			return CodecMonitor.instance;
		}
    
		CodecMonitor.instance = this;
		this.resetStats();
	}
  
	/**
   * 重置统计信息
   */
	resetStats(): void {
		this.stats = {
			encodeAttempts: 0,
			encodeSuccesses: 0,
			encodeFailures: 0,
			encodeJsonCount: 0,
			encodeProtobufCount: 0,
			decodeAttempts: 0,
			decodeSuccesses: 0,
			decodeFailures: 0,
			decodeJsonCount: 0,
			decodeProtobufCount: 0,
			// 🔧 修复P1问题：初始化独立压缩统计
			compressionAttempts: 0,
			compressionSuccesses: 0,
			compressionFailures: 0,
			decompressionAttempts: 0,
			decompressionSuccesses: 0,
			decompressionFailures: 0,
			totalEncodeTime: 0,
			totalDecodeTime: 0,
			avgEncodeTime: 0,
			avgDecodeTime: 0,
			totalBytesEncoded: 0,
			totalBytesDecoded: 0,
			formatFallbackCount: 0,
			validationFailures: 0,
			startTime: Date.now(),
			lastUpdateTime: Date.now()
		};
    
		logger.info('📊 编解码器监控已重置');
	}
  
	/**
   * 记录编码操作
   */
	recordEncode(format: 'json' | 'protobuf', success: boolean, duration: number, inputSize: number, outputSize: number, error?: string): void {
		this.stats.encodeAttempts++;
		this.stats.lastUpdateTime = Date.now();
    
		if (success) {
			this.stats.encodeSuccesses++;
			this.stats.totalEncodeTime += duration;
			this.stats.totalBytesEncoded += outputSize;
			this.stats.avgEncodeTime = this.stats.totalEncodeTime / this.stats.encodeSuccesses;
      
			if (format === 'json') {
				this.stats.encodeJsonCount++;
			} else {
				this.stats.encodeProtobufCount++;
			}
      
			// 记录性能历史
			this.performanceHistory.push({
				timestamp: Date.now(),
				operation: 'encode',
				format,
				duration,
				bytes: outputSize
			});
      
			// 保持历史记录大小  
			if (this.performanceHistory.length > 1000) {
				this.performanceHistory = this.performanceHistory.slice(-500);
			}
      
		} else {
			this.stats.encodeFailures++;
      
			if (error) {
				this.errorHistory.push({
					timestamp: Date.now(),
					error,
					operation: `encode_${format}`
				});
        
				// 保持错误历史记录大小
				if (this.errorHistory.length > 100) {
					this.errorHistory = this.errorHistory.slice(-50);
				}
			}
		}
	}
  
	/**
   * 记录解码操作
   */
	recordDecode(format: 'json' | 'protobuf', success: boolean, duration: number, inputSize: number, error?: string): void {
		this.stats.decodeAttempts++;
		this.stats.lastUpdateTime = Date.now();
    
		if (success) {
			this.stats.decodeSuccesses++;
			this.stats.totalDecodeTime += duration;
			this.stats.totalBytesDecoded += inputSize;
			this.stats.avgDecodeTime = this.stats.totalDecodeTime / this.stats.decodeSuccesses;
      
			if (format === 'json') {
				this.stats.decodeJsonCount++;
			} else {
				this.stats.decodeProtobufCount++;
			}
      
			// 记录性能历史
			this.performanceHistory.push({
				timestamp: Date.now(),
				operation: 'decode',
				format,
				duration,
				bytes: inputSize
			});
      
			if (this.performanceHistory.length > 1000) {
				this.performanceHistory = this.performanceHistory.slice(-500);
			}
      
		} else {
			this.stats.decodeFailures++;
      
			if (error) {
				this.errorHistory.push({
					timestamp: Date.now(),
					error,
					operation: `decode_${format}`
				});
        
				if (this.errorHistory.length > 100) {
					this.errorHistory = this.errorHistory.slice(-50);
				}
			}
		}
	}
  
	/**
   * 记录格式降级
   */
	recordFormatFallback(from: string, to: string, reason: string): void {
		this.stats.formatFallbackCount++;
		this.stats.lastUpdateTime = Date.now();
    
		logger.warn(`🔄 格式降级: ${from} -> ${to}, 原因: ${reason}`);
    
		this.errorHistory.push({
			timestamp: Date.now(),
			error: `Format fallback: ${from} -> ${to} (${reason})`,
			operation: 'format_fallback'
		});
	}
  
	/**
   * 记录验证失败
   */
	recordValidationFailure(operation: string, error: string): void {
		this.stats.validationFailures++;
		this.stats.lastUpdateTime = Date.now();
    
		logger.error(`❌ 验证失败: ${operation} - ${error}`);
    
		this.errorHistory.push({
			timestamp: Date.now(),
			error: `Validation failure: ${error}`,
			operation
		});
	}
  
	/**
   * 🔧 修复P1问题：记录压缩操作（独立统计，不影响JSON/Protobuf使用率）
   */
	recordCompression(success: boolean, duration: number, originalSize: number, compressedSize: number, algorithm: string, error?: string): void {
		this.stats.compressionAttempts++;
		this.stats.lastUpdateTime = Date.now();
    
		if (success) {
			this.stats.compressionSuccesses++;
      
			// 记录性能历史（使用独立标识）
			this.performanceHistory.push({
				timestamp: Date.now(),
				operation: 'compression',
				format: algorithm,
				duration,
				bytes: compressedSize
			});
      
			const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
			logger.debug(`🗜️ 压缩成功: ${originalSize} -> ${compressedSize} 字节 (算法: ${algorithm}, 压缩率: ${compressionRatio}%, 耗时: ${duration}ms)`);
      
		} else {
			this.stats.compressionFailures++;
      
			if (error) {
				this.errorHistory.push({
					timestamp: Date.now(),
					error: `Compression failure (${algorithm}): ${error}`,
					operation: 'compression'
				});
			}
      
			logger.warn(`❌ 压缩失败: ${algorithm} - ${error}`);
		}
	}
  
	/**
   * 🔧 修复P1问题：记录解压操作（独立统计）
   */
	recordDecompression(success: boolean, duration: number, compressedSize: number, decompressedSize: number, algorithm: string, error?: string): void {
		this.stats.decompressionAttempts++;
		this.stats.lastUpdateTime = Date.now();
    
		if (success) {
			this.stats.decompressionSuccesses++;
      
			// 记录性能历史（使用独立标识）
			this.performanceHistory.push({
				timestamp: Date.now(),
				operation: 'decompression',
				format: algorithm,
				duration,
				bytes: decompressedSize
			});
      
			logger.debug(`🗜️ 解压成功: ${compressedSize} -> ${decompressedSize} 字节 (算法: ${algorithm}, 耗时: ${duration}ms)`);
      
		} else {
			this.stats.decompressionFailures++;
      
			if (error) {
				this.errorHistory.push({
					timestamp: Date.now(),
					error: `Decompression failure (${algorithm}): ${error}`,
					operation: 'decompression'
				});
			}
      
			logger.warn(`❌ 解压失败: ${algorithm} - ${error}`);
		}
	}
  
	/**
   * 获取统计信息
   */
	getStats(): CodecStats {
		return { ...this.stats };
	}
  
	/**
   * 获取性能报告
   */
	getPerformanceReport(): any {
		const now = Date.now();
		const uptime = now - this.stats.startTime;
    
		// 计算成功率
		const encodeSuccessRate = this.stats.encodeAttempts > 0 ? 
			(this.stats.encodeSuccesses / this.stats.encodeAttempts * 100).toFixed(2) : '0';
		const decodeSuccessRate = this.stats.decodeAttempts > 0 ? 
			(this.stats.decodeSuccesses / this.stats.decodeAttempts * 100).toFixed(2) : '0';
    
		// 计算格式使用比例
		const jsonUsagePercent = this.stats.encodeSuccesses > 0 ? 
			(this.stats.encodeJsonCount / this.stats.encodeSuccesses * 100).toFixed(2) : '0';
		const protobufUsagePercent = this.stats.encodeSuccesses > 0 ? 
			(this.stats.encodeProtobufCount / this.stats.encodeSuccesses * 100).toFixed(2) : '0';
    
		// 🔧 修复P1问题：计算压缩相关统计
		const compressionSuccessRate = this.stats.compressionAttempts > 0 ? 
			(this.stats.compressionSuccesses / this.stats.compressionAttempts * 100).toFixed(2) : '0';
		const decompressionSuccessRate = this.stats.decompressionAttempts > 0 ? 
			(this.stats.decompressionSuccesses / this.stats.decompressionAttempts * 100).toFixed(2) : '0';
    
		return {
			uptime,
			uptimeFormatted: this.formatDuration(uptime),
      
			// 成功率
			encodeSuccessRate: `${encodeSuccessRate}%`,
			decodeSuccessRate: `${decodeSuccessRate}%`,
      
			// 格式使用情况
			formatUsage: {
				json: `${jsonUsagePercent}%`,
				protobuf: `${protobufUsagePercent}%`
			},
      
			// 性能指标
			avgEncodeTime: `${this.stats.avgEncodeTime.toFixed(2)}ms`,
			avgDecodeTime: `${this.stats.avgDecodeTime.toFixed(2)}ms`,
      
			// 数据量统计
			totalBytesEncoded: this.formatBytes(this.stats.totalBytesEncoded),
			totalBytesDecoded: this.formatBytes(this.stats.totalBytesDecoded),
      
			// 错误统计
			errorRate: this.stats.encodeAttempts + this.stats.decodeAttempts > 0 ? 
				`${((this.stats.encodeFailures + this.stats.decodeFailures) / (this.stats.encodeAttempts + this.stats.decodeAttempts) * 100).toFixed(2)}%` : '0%',
			fallbackCount: this.stats.formatFallbackCount,
			validationFailures: this.stats.validationFailures,
      
			// 🔧 修复P1问题：压缩统计信息
			compressionStats: {
				compressionSuccessRate: `${compressionSuccessRate}%`,
				decompressionSuccessRate: `${decompressionSuccessRate}%`,
				compressionAttempts: this.stats.compressionAttempts,
				decompressionAttempts: this.stats.decompressionAttempts,
				compressionFailures: this.stats.compressionFailures,
				decompressionFailures: this.stats.decompressionFailures
			},
      
			// 最近错误
			recentErrors: this.errorHistory.slice(-5).map(e => ({
				time: new Date(e.timestamp).toISOString(),
				operation: e.operation,
				error: e.error
			}))
		};
	}
  
	/**
   * 打印性能报告
   */
	printPerformanceReport(): void {
		const report = this.getPerformanceReport();
    
		logger.info('📊 编解码器性能报告:');
		logger.info(`┌─ 运行时间: ${report.uptimeFormatted}`);
		logger.info(`├─ 编码成功率: ${report.encodeSuccessRate}`);
		logger.info(`├─ 解码成功率: ${report.decodeSuccessRate}`);
		logger.info(`├─ 平均编码时间: ${report.avgEncodeTime}`);
		logger.info(`├─ 平均解码时间: ${report.avgDecodeTime}`);
		logger.info(`├─ JSON 使用率: ${report.formatUsage.json}`);
		logger.info(`├─ Protobuf 使用率: ${report.formatUsage.protobuf}`);
		logger.info(`├─ 总编码数据: ${report.totalBytesEncoded}`);
		logger.info(`├─ 总解码数据: ${report.totalBytesDecoded}`);
		logger.info(`├─ 错误率: ${report.errorRate}`);
		logger.info(`├─ 格式降级次数: ${report.fallbackCount}`);
		logger.info(`├─ 验证失败次数: ${report.validationFailures}`);
		// 🔧 修复P1问题：显示压缩统计信息
		logger.info(`├─ 压缩成功率: ${report.compressionStats.compressionSuccessRate} (${report.compressionStats.compressionAttempts}次尝试)`);
		logger.info(`└─ 解压成功率: ${report.compressionStats.decompressionSuccessRate} (${report.compressionStats.decompressionAttempts}次尝试)`);
    
		if (report.recentErrors.length > 0) {
			logger.info('🚨 最近错误:');
			report.recentErrors.forEach((error: any, index: number) => {
				logger.info(`  ${index + 1}. [${error.time}] ${error.operation}: ${error.error}`);
			});
		}
	}
  
	/**
   * 格式化持续时间
   */
	private formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
    
		if (hours > 0) {
			return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
		} else if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		} else {
			return `${seconds}s`;
		}
	}
  
	/**
   * 格式化字节大小
   */
	private formatBytes(bytes: number): string {
		if (bytes === 0) {return '0 B';}
    
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
    
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
	}
}

// 导出单例实例
export const codecMonitor = new CodecMonitor();