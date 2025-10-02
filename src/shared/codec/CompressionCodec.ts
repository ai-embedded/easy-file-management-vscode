/**
 * 压缩编解码器
 * 提供数据压缩和解压缩功能，进一步减少传输数据量
 */

import * as zlib from 'zlib';
import { promisify } from 'util';
import { Logger } from '../utils/Logger';
import { codecMonitor } from '../monitoring/CodecMonitor';

const logger = new Logger('CompressionCodec');

// 将 zlib 函数转换为 Promise
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);
const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

/**
 * 压缩算法类型
 */
export enum CompressionAlgorithm {
  NONE = 'none',           // 不压缩
  GZIP = 'gzip',          // Gzip 压缩（通用，压缩率高）
  DEFLATE = 'deflate',    // Deflate 压缩（速度快）
  BROTLI = 'brotli'       // Brotli 压缩（压缩率最高，但速度较慢）
}

/**
 * 压缩级别
 */
enum CompressionLevel {
  FASTEST = 1,     // 最快（压缩率低）
  FAST = 3,        // 快速
  NORMAL = 6,      // 正常（默认）
  HIGH = 7,        // 高压缩
  MAXIMUM = 9      // 最大压缩（速度最慢）
}

/**
 * 压缩配置
 */
interface CompressionConfig {
  algorithm?: CompressionAlgorithm;  // 压缩算法（默认 gzip）
  level?: CompressionLevel;          // 压缩级别（默认 NORMAL）
  threshold?: number;                // 压缩阈值（字节，默认 1024）
  enableAdaptive?: boolean;          // 启用自适应压缩（默认 true）
  maxCompressionTime?: number;       // 最大压缩时间（毫秒，默认 1000）
}

/**
 * 压缩结果
 */
interface CompressionResult {
  algorithm: CompressionAlgorithm;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  compressionTime: number;
  data: Buffer;
}

/**
 * 压缩统计
 */
interface CompressionStats {
  totalCompressed: number;
  totalDecompressed: number;
  totalOriginalBytes: number;
  totalCompressedBytes: number;
  averageCompressionRatio: number;
  averageCompressionTime: number;
  averageDecompressionTime: number;
  algorithmUsage: Record<CompressionAlgorithm, number>;
}

/**
 * 压缩编解码器
 */
export class CompressionCodec {
	private config: Required<CompressionConfig>;
	private stats: CompressionStats;
	private compressionHistory: Array<{
    algorithm: CompressionAlgorithm;
    ratio: number;
    time: number;
    size: number;
  }> = [];
  
	constructor(config: CompressionConfig = {}) {
		// 初始化配置
		this.config = {
			algorithm: config.algorithm || CompressionAlgorithm.GZIP,
			level: config.level || CompressionLevel.NORMAL,
			threshold: config.threshold || 1024, // 1KB
			enableAdaptive: config.enableAdaptive !== false,
			maxCompressionTime: config.maxCompressionTime || 1000 // 1秒
		};
    
		// 初始化统计
		this.stats = {
			totalCompressed: 0,
			totalDecompressed: 0,
			totalOriginalBytes: 0,
			totalCompressedBytes: 0,
			averageCompressionRatio: 0,
			averageCompressionTime: 0,
			averageDecompressionTime: 0,
			algorithmUsage: {
				[CompressionAlgorithm.NONE]: 0,
				[CompressionAlgorithm.GZIP]: 0,
				[CompressionAlgorithm.DEFLATE]: 0,
				[CompressionAlgorithm.BROTLI]: 0
			}
		};
    
		logger.info('压缩编解码器已初始化', {
			algorithm: this.config.algorithm,
			level: this.config.level,
			threshold: this.config.threshold
		});
	}
  
	/**
   * 压缩数据
   */
	async compress(data: Buffer | Uint8Array): Promise<CompressionResult> {
		const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
		const originalSize = buffer.length;
    
		// 🔧 修复：使用自适应阈值替代固定阈值
		const adaptiveThreshold = this.config.enableAdaptive ? 
			this.getAdaptiveThreshold() : this.config.threshold;
    
		// 检查是否需要压缩
		if (originalSize < adaptiveThreshold) {
			logger.debug(`数据小于自适应阈值 (${originalSize} < ${adaptiveThreshold})，跳过压缩`);
			return {
				algorithm: CompressionAlgorithm.NONE,
				originalSize,
				compressedSize: originalSize,
				compressionRatio: 1,
				compressionTime: 0,
				data: buffer
			};
		}
    
		// 选择最优算法
		const algorithm = this.config.enableAdaptive 
			? this.selectOptimalAlgorithm(originalSize)
			: this.config.algorithm;
    
		const startTime = Date.now();
		let compressedData: Buffer;
    
		try {
			// 执行压缩
			switch (algorithm) {
				case CompressionAlgorithm.GZIP:
					compressedData = await this.compressGzip(buffer);
					break;
          
				case CompressionAlgorithm.DEFLATE:
					compressedData = await this.compressDeflate(buffer);
					break;
          
				case CompressionAlgorithm.BROTLI:
					compressedData = await this.compressBrotli(buffer);
					break;
          
				default:
					compressedData = buffer;
			}
      
			const compressionTime = Date.now() - startTime;
			const compressedSize = compressedData.length;
			const compressionRatio = originalSize / compressedSize;
      
			// 如果压缩后更大，不使用压缩
			if (compressedSize >= originalSize) {
				logger.debug(`压缩后更大 (${compressedSize} >= ${originalSize})，使用原始数据`);
				return {
					algorithm: CompressionAlgorithm.NONE,
					originalSize,
					compressedSize: originalSize,
					compressionRatio: 1,
					compressionTime: 0,
					data: buffer
				};
			}
      
			// 更新统计
			this.updateCompressionStats(algorithm, originalSize, compressedSize, compressionTime);
      
			// 🔧 修复P1问题：移除重复的压缩统计调用，避免污染JSON/Protobuf使用率统计
			// 压缩统计现在由UniversalCodec统一管理，使用独立的recordCompression/recordDecompression接口
			logger.debug('💾 压缩统计由UniversalCodec统一管理，避免重复计数');
      
			const reduction = ((1 - compressedSize / originalSize) * 100).toFixed(1);
			logger.debug(`压缩成功: ${algorithm}, ${originalSize} -> ${compressedSize} 字节 (减少 ${reduction}%)`);
      
			return {
				algorithm,
				originalSize,
				compressedSize,
				compressionRatio,
				compressionTime,
				data: compressedData
			};
      
		} catch (error) {
			logger.error(`压缩失败 (${algorithm}):`, error);
      
			// 🔧 修复P1问题：移除重复的压缩失败统计，避免污染JSON/Protobuf使用率统计
			// 压缩失败统计现在由UniversalCodec统一管理
			logger.debug(`💾 压缩失败统计由UniversalCodec统一管理: ${String(error)}`);
      
			// 返回原始数据
			return {
				algorithm: CompressionAlgorithm.NONE,
				originalSize,
				compressedSize: originalSize,
				compressionRatio: 1,
				compressionTime: 0,
				data: buffer
			};
		}
	}
  
	/**
   * 解压缩数据
   */
	async decompress(data: Buffer | Uint8Array, algorithm: CompressionAlgorithm): Promise<Buffer> {
		if (algorithm === CompressionAlgorithm.NONE) {
			return Buffer.isBuffer(data) ? data : Buffer.from(data);
		}
    
		const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
		const startTime = Date.now();
    
		try {
			let decompressedData: Buffer;
      
			// 执行解压缩
			switch (algorithm) {
				case CompressionAlgorithm.GZIP:
					decompressedData = await gunzip(buffer);
					break;
          
				case CompressionAlgorithm.DEFLATE:
					decompressedData = await inflate(buffer);
					break;
          
				case CompressionAlgorithm.BROTLI:
					decompressedData = await brotliDecompress(buffer);
					break;
          
				default:
					throw new Error(`不支持的压缩算法: ${algorithm}`);
			}
      
			const decompressionTime = Date.now() - startTime;
      
			// 更新统计
			this.stats.totalDecompressed++;
			this.stats.averageDecompressionTime = 
        (this.stats.averageDecompressionTime * (this.stats.totalDecompressed - 1) + decompressionTime) 
        / this.stats.totalDecompressed;
      
			// 🔧 修复P1问题：移除重复的解压缩成功统计，避免污染JSON/Protobuf使用率统计  
			// 解压缩统计现在由UniversalCodec统一管理，使用独立的recordDecompression接口
			logger.debug('💾 解压缩统计由UniversalCodec统一管理，避免重复计数');
      
			logger.debug(`解压成功: ${algorithm}, ${buffer.length} -> ${decompressedData.length} 字节`);
      
			return decompressedData;
      
		} catch (error) {
			logger.error(`解压失败 (${algorithm}):`, error);
      
			// 🔧 修复P1问题：移除重复的解压缩失败统计，避免污染JSON/Protobuf使用率统计
			// 解压缩失败统计现在由UniversalCodec统一管理  
			logger.debug(`💾 解压缩失败统计由UniversalCodec统一管理: ${String(error)}`);
      
			throw error;
		}
	}
  
	/**
   * 检测压缩算法
   */
	detectAlgorithm(data: Buffer | Uint8Array): CompressionAlgorithm {
		const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    
		if (buffer.length < 2) {
			return CompressionAlgorithm.NONE;
		}
    
		// 检测 Gzip 魔数 (1f 8b)
		if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
			return CompressionAlgorithm.GZIP;
		}
    
		// 检测 Deflate (78 01, 78 5e, 78 9c, 78 da)
		if (buffer[0] === 0x78) {
			const second = buffer[1];
			if (second === 0x01 || second === 0x5e || second === 0x9c || second === 0xda) {
				return CompressionAlgorithm.DEFLATE;
			}
		}
    
		// Brotli 没有固定的魔数，需要其他方式识别
		// 这里简化处理，如果不是 Gzip 或 Deflate，尝试 Brotli
		// 实际应用中可能需要更复杂的检测逻辑
    
		return CompressionAlgorithm.NONE;
	}
  
	/**
   * 获取推荐的压缩配置
   */
	getRecommendation(dataSize: number, networkSpeed: number): CompressionConfig {
		// 基于数据大小和网络速度推荐配置
    
		if (dataSize < 1024) {
			// 小文件不压缩
			return {
				algorithm: CompressionAlgorithm.NONE,
				level: CompressionLevel.FASTEST,
				threshold: dataSize + 1
			};
		}
    
		if (networkSpeed > 10 * 1024 * 1024) {
			// 高速网络，使用快速压缩
			return {
				algorithm: CompressionAlgorithm.DEFLATE,
				level: CompressionLevel.FAST,
				threshold: 4096
			};
		}
    
		if (networkSpeed > 1024 * 1024) {
			// 中速网络，平衡压缩
			return {
				algorithm: CompressionAlgorithm.GZIP,
				level: CompressionLevel.NORMAL,
				threshold: 2048
			};
		}
    
		// 低速网络，最大压缩
		return {
			algorithm: CompressionAlgorithm.BROTLI,
			level: CompressionLevel.HIGH,
			threshold: 1024
		};
	}
  
	/**
   * 获取统计信息
   */
	getStats(): CompressionStats {
		return { ...this.stats };
	}
  
	/**
   * 重置统计信息
   */
	resetStats(): void {
		this.stats.totalCompressed = 0;
		this.stats.totalDecompressed = 0;
		this.stats.totalOriginalBytes = 0;
		this.stats.totalCompressedBytes = 0;
		this.stats.averageCompressionRatio = 0;
		this.stats.averageCompressionTime = 0;
		this.stats.averageDecompressionTime = 0;
		this.stats.algorithmUsage = {
			[CompressionAlgorithm.NONE]: 0,
			[CompressionAlgorithm.GZIP]: 0,
			[CompressionAlgorithm.DEFLATE]: 0,
			[CompressionAlgorithm.BROTLI]: 0
		};
		this.compressionHistory = [];
	}
  
	// === 私有方法 ===
  
	/**
   * 🔧 修复：获取基于性能统计的自适应压缩阈值
   * 根据codecMonitor的实时统计动态调整压缩阈值
   */
	private getAdaptiveThreshold(): number {
		const stats = codecMonitor.getStats();
		const baseThreshold = this.config.threshold;
    
		// 如果没有足够的统计数据，使用默认阈值
		if (stats.encodeAttempts < 10) {
			return baseThreshold;
		}
    
		const avgEncodeTime = stats.avgEncodeTime;
		const errorRate = stats.encodeAttempts > 0 ? 
			(stats.encodeFailures / stats.encodeAttempts) : 0;
    
		// 性能调优逻辑：
		// 1. 编码速度快(< 50ms) 且错误率低(< 5%) -> 降低阈值，增加压缩机会
		// 2. 编码速度慢(> 100ms) 或错误率高(> 10%) -> 提高阈值，减少压缩开销
		// 3. 否则使用默认阈值
    
		if (avgEncodeTime < 50 && errorRate < 0.05) {
			const adaptiveThreshold = Math.max(512, baseThreshold * 0.5);
			logger.debug(`🎯 自适应阈值：性能良好，降低阈值 ${baseThreshold} -> ${adaptiveThreshold}`);
			return adaptiveThreshold;
		} else if (avgEncodeTime > 100 || errorRate > 0.1) {
			const adaptiveThreshold = Math.min(4096, baseThreshold * 2);
			logger.debug(`⚠️ 自适应阈值：性能较差，提高阈值 ${baseThreshold} -> ${adaptiveThreshold}`);
			return adaptiveThreshold;
		}
    
		return baseThreshold;
	}
  
	/**
   * Gzip 压缩
   */
	private async compressGzip(buffer: Buffer): Promise<Buffer> {
		return await gzip(buffer, {
			level: this.config.level
		});
	}
  
	/**
   * Deflate 压缩
   */
	private async compressDeflate(buffer: Buffer): Promise<Buffer> {
		return await deflate(buffer, {
			level: this.config.level
		});
	}
  
	/**
   * Brotli 压缩
   */
	private async compressBrotli(buffer: Buffer): Promise<Buffer> {
		return await brotliCompress(buffer, {
			params: {
				[zlib.constants.BROTLI_PARAM_QUALITY]: this.config.level
			}
		});
	}
  
	/**
   * 选择最优算法
   */
	private selectOptimalAlgorithm(dataSize: number): CompressionAlgorithm {
		// 基于历史数据选择最优算法
		if (this.compressionHistory.length >= 10) {
			const recentHistory = this.compressionHistory.slice(-10);
      
			// 计算每种算法的平均压缩率和时间
			const algorithmStats = new Map<CompressionAlgorithm, { ratio: number; time: number; count: number }>();
      
			for (const record of recentHistory) {
				const stats = algorithmStats.get(record.algorithm) || { ratio: 0, time: 0, count: 0 };
				stats.ratio += record.ratio;
				stats.time += record.time;
				stats.count++;
				algorithmStats.set(record.algorithm, stats);
			}
      
			// 选择最佳算法（考虑压缩率和时间）
			let bestAlgorithm = this.config.algorithm;
			let bestScore = 0;
      
			for (const [algorithm, stats] of algorithmStats) {
				if (stats.count > 0) {
					const avgRatio = stats.ratio / stats.count;
					const avgTime = stats.time / stats.count;
          
					// 评分：压缩率权重 70%，时间权重 30%
					const score = avgRatio * 0.7 + (1000 / Math.max(avgTime, 1)) * 0.3;
          
					if (score > bestScore) {
						bestScore = score;
						bestAlgorithm = algorithm;
					}
				}
			}
      
			return bestAlgorithm;
		}
    
		// 基于数据大小的默认策略
		if (dataSize < 10 * 1024) {
			// 小数据：使用快速算法
			return CompressionAlgorithm.DEFLATE;
		} else if (dataSize < 100 * 1024) {
			// 中等数据：使用平衡算法
			return CompressionAlgorithm.GZIP;
		} else {
			// 大数据：使用高压缩算法
			return CompressionAlgorithm.BROTLI;
		}
	}
  
	/**
   * 更新压缩统计
   */
	private updateCompressionStats(
		algorithm: CompressionAlgorithm,
		originalSize: number,
		compressedSize: number,
		compressionTime: number
	): void {
		this.stats.totalCompressed++;
		this.stats.totalOriginalBytes += originalSize;
		this.stats.totalCompressedBytes += compressedSize;
		this.stats.algorithmUsage[algorithm]++;
    
		const ratio = originalSize / compressedSize;
		this.stats.averageCompressionRatio = 
      (this.stats.averageCompressionRatio * (this.stats.totalCompressed - 1) + ratio) 
      / this.stats.totalCompressed;
    
		this.stats.averageCompressionTime = 
      (this.stats.averageCompressionTime * (this.stats.totalCompressed - 1) + compressionTime) 
      / this.stats.totalCompressed;
    
		// 记录历史
		this.compressionHistory.push({
			algorithm,
			ratio,
			time: compressionTime,
			size: originalSize
		});
    
		// 限制历史记录大小
		if (this.compressionHistory.length > 100) {
			this.compressionHistory = this.compressionHistory.slice(-50);
		}
	}
}

// 导出默认实例
