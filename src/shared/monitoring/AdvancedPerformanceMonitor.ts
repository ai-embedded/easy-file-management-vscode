/**
 * 🚀 高级性能监控器
 * 实现自适应参数调优、实时性能分析和智能优化建议
 * 基于todo_tcp.md的优化方案实现
 */

import { Logger } from '../utils/Logger';
import { PerformanceMonitor, PerformanceMetrics, OperationType } from './PerformanceMonitor';

/**
 * 高级性能指标接口
 */
interface AdvancedPerformanceMetric extends PerformanceMetrics {
  format: 'json' | 'protobuf';
  cached: boolean;
  dataSize: number;
  compressionRatio?: number;
  networkLatency?: number;
  processingTime?: number;
}

/**
 * 性能分析结果接口
 */
interface PerformanceAnalysis {
  operationType: string;
  totalCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDuration: number;
  p50: number;
  p95: number;
  p99: number;
  protobufRatio: number;
  cacheHitRate: number;
  avgDataSize: number;
  largeRequestRatio: number;
  avgCompressionRatio: number;
  bottleneckScore: number; // 瓶颈评分 0-100
}

/**
 * 优化建议接口
 */
interface OptimizationRecommendation {
  priority: 'high' | 'medium' | 'low';
  category: 'protocol' | 'caching' | 'batching' | 'compression' | 'network';
  description: string;
  expectedGain: string;
  implementation: string;
  confidence: number; // 置信度 0-1
}

/**
 * 瓶颈报告接口
 */
interface BottleneckReport {
  operation: string;
  issue: string;
  impact: 'high' | 'medium' | 'low';
  suggestion: string;
  metrics: {
    avgLatency: number;
    failureRate: number;
    throughput: number;
  };
}

/**
 * 优化报告接口
 */
interface OptimizationReport {
  timestamp: number;
  summary: {
    totalRequests: number;
    avgResponseTime: number;
    successRate: number;
    protobufUsage: number;
    cacheHitRate: number;
    overallHealthScore: number; // 整体健康评分 0-100
  };
  recommendations: OptimizationRecommendation[];
  topBottlenecks: BottleneckReport[];
  trendAnalysis: {
    performanceTrend: 'improving' | 'stable' | 'degrading';
    trendConfidence: number;
    keyMetricChanges: Array<{
      metric: string;
      change: number; // 百分比变化
      period: string;
    }>;
  };
}

/**
 * 自适应配置接口
 */
interface AdaptiveConfig {
  batchSize: Record<string, number>;
  chunkSize: Record<string, number>;
  cacheStrategy: Record<string, 'aggressive' | 'moderate' | 'conservative'>;
  compressionThreshold: number;
  timeout: Record<string, number>;
}

/**
 * 🚀 高级性能监控器
 */
export class AdvancedPerformanceMonitor extends PerformanceMonitor {
	private advancedMetrics = new Map<string, AdvancedPerformanceMetric[]>();
	private readonly WINDOW_SIZE = 1000; // 保留最近1000个样本
	private readonly ANALYSIS_INTERVAL = 30 * 1000; // 30秒分析一次
	private readonly TREND_WINDOW = 5; // 趋势分析窗口（5个分析周期）
  
	// 历史分析结果（用于趋势分析）
	private analysisHistory: PerformanceAnalysis[][] = [];
  
	// 自适应配置
	private adaptiveConfig: AdaptiveConfig = {
		batchSize: {
			'directory_ops': 20,
			'file_transfer': 3,
			'file_modify': 10,
			'default': 5
		},
		chunkSize: {
			'small_files': 64 * 1024,      // 64KB
			'medium_files': 256 * 1024,    // 256KB
			'large_files': 1024 * 1024,    // 1MB
			'default': 256 * 1024
		},
		cacheStrategy: {
			'directory': 'aggressive',
			'small_files': 'moderate',
			'large_files': 'conservative',
			'default': 'moderate'
		},
		compressionThreshold: 1024, // 1KB
		timeout: {
			'connect': 10000,    // 10s
			'transfer': 30000,   // 30s
			'batch': 5000,       // 5s
			'default': 15000     // 15s
		}
	};
  
	private logger = new Logger('AdvancedPerformanceMonitor');
	private analysisTimer?: NodeJS.Timeout;
  
	constructor(config: any = {}) {
		super(config);
		this.startAdvancedAnalysis();
		this.logger.info('🚀 高级性能监控器启动完成');
	}
  
	/**
   * 📊 记录高级性能指标
   */
	recordAdvancedOperation(metric: AdvancedPerformanceMetric): void {
		// 调用基础监控器记录
		this.recordOperation(metric);
    
		// 记录高级指标
		const key = `${metric.operationType}_${metric.format}`;
		let metrics = this.advancedMetrics.get(key);
    
		if (!metrics) {
			metrics = [];
			this.advancedMetrics.set(key, metrics);
		}
    
		metrics.push(metric);
    
		// 保持窗口大小
		if (metrics.length > this.WINDOW_SIZE) {
			metrics.shift();
		}
    
		this.logger.debug(`📊 记录高级指标: ${key} (${metric.duration}ms, ${metric.dataSize} bytes, 格式: ${metric.format}, 缓存: ${metric.cached})`);
	}
  
	/**
   * 🔄 启动高级分析
   */
	private startAdvancedAnalysis(): void {
		this.analysisTimer = setInterval(() => {
			this.performAdvancedAnalysis();
		}, this.ANALYSIS_INTERVAL);
	}
  
	/**
   * 🧠 执行高级分析
   */
	private performAdvancedAnalysis(): void {
		try {
			const currentAnalysis: PerformanceAnalysis[] = [];
      
			// 分析所有操作类型
			for (const [key, metrics] of this.advancedMetrics.entries()) {
				if (metrics.length < 10) {continue;} // 样本太少，跳过
        
				const analysis = this.analyzeOperationMetrics(key, metrics);
				currentAnalysis.push(analysis);
        
				// 实时优化建议
				this.generateRealtimeRecommendations(analysis);
			}
      
			// 保存分析历史
			this.analysisHistory.push(currentAnalysis);
			if (this.analysisHistory.length > this.TREND_WINDOW) {
				this.analysisHistory.shift();
			}
      
			// 自适应参数调优
			this.performAdaptiveOptimization(currentAnalysis);
      
			this.logger.debug(`🧠 高级分析完成: ${currentAnalysis.length} 个操作类型`);
		} catch (error) {
			this.logger.error('🧠 高级分析失败:', error);
		}
	}
  
	/**
   * 📈 分析操作指标
   */
	private analyzeOperationMetrics(key: string, metrics: AdvancedPerformanceMetric[]): PerformanceAnalysis {
		const recent = metrics.slice(-100); // 最近100个样本
		const durations = recent.map(m => m.duration).sort((a, b) => a - b);
		const successful = recent.filter(m => m.success);
		const protobufCount = recent.filter(m => m.format === 'protobuf').length;
		const cachedCount = recent.filter(m => m.cached).length;
		const dataSizes = recent.map(m => m.dataSize);
		const largeRequests = recent.filter(m => m.dataSize > 10 * 1024).length; // >10KB
		const compressionRatios = recent.filter(m => m.compressionRatio).map(m => m.compressionRatio!);
    
		// 计算百分位数
		const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
		const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
		const p99 = durations[Math.floor(durations.length * 0.99)] || 0;
    
		// 计算瓶颈评分
		const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
		const failureRate = (recent.length - successful.length) / recent.length;
		const bottleneckScore = this.calculateBottleneckScore(avgDuration, failureRate, p95);
    
		return {
			operationType: key,
			totalCount: recent.length,
			successCount: successful.length,
			failureCount: recent.length - successful.length,
			successRate: successful.length / recent.length,
			avgDuration,
			p50,
			p95,
			p99,
			protobufRatio: protobufCount / recent.length,
			cacheHitRate: cachedCount / recent.length,
			avgDataSize: dataSizes.reduce((a, b) => a + b, 0) / dataSizes.length,
			largeRequestRatio: largeRequests / recent.length,
			avgCompressionRatio: compressionRatios.length > 0 
				? compressionRatios.reduce((a, b) => a + b, 0) / compressionRatios.length 
				: 0,
			bottleneckScore
		};
	}
  
	/**
   * 🔢 计算瓶颈评分
   */
	private calculateBottleneckScore(avgDuration: number, failureRate: number, p95: number): number {
		// 基于多个因素计算瓶颈评分 (0-100)
		let score = 0;
    
		// 平均响应时间权重 (40%)
		if (avgDuration > 5000) {score += 40;}
		else if (avgDuration > 2000) {score += 25;}
		else if (avgDuration > 1000) {score += 10;}
    
		// 失败率权重 (35%)
		score += failureRate * 35;
    
		// P95延迟权重 (25%)
		if (p95 > 10000) {score += 25;}
		else if (p95 > 5000) {score += 15;}
		else if (p95 > 2000) {score += 8;}
    
		return Math.min(100, Math.round(score));
	}
  
	/**
   * 💡 生成实时优化建议
   */
	private generateRealtimeRecommendations(analysis: PerformanceAnalysis): void {
		const recommendations: OptimizationRecommendation[] = [];
    
		// 协议优化建议
		if (analysis.protobufRatio < 0.5 && analysis.operationType.includes('file')) {
			recommendations.push({
				priority: 'high',
				category: 'protocol',
				description: `提高 ${analysis.operationType} 的 Protobuf 使用率`,
				expectedGain: '30-50% 性能提升',
				implementation: '强制文件传输使用 Protobuf 格式',
				confidence: 0.85
			});
		}
    
		// 缓存优化建议
		if (analysis.cacheHitRate < 0.6 && analysis.avgDuration > 1000) {
			recommendations.push({
				priority: 'medium',
				category: 'caching',
				description: `增强 ${analysis.operationType} 的缓存策略`,
				expectedGain: '40-60% 响应时间减少',
				implementation: '实现预测性缓存或增加缓存TTL',
				confidence: 0.75
			});
		}
    
		// 批处理优化建议
		if (analysis.largeRequestRatio < 0.2 && analysis.avgDuration > 500) {
			recommendations.push({
				priority: 'medium',
				category: 'batching',
				description: `优化 ${analysis.operationType} 的批处理大小`,
				expectedGain: '20-35% 吞吐量提升',
				implementation: '调整批处理阈值和超时时间',
				confidence: 0.7
			});
		}
    
		// 压缩优化建议
		if (analysis.avgCompressionRatio === 0 && analysis.avgDataSize > 5 * 1024) {
			recommendations.push({
				priority: 'low',
				category: 'compression',
				description: `为 ${analysis.operationType} 启用数据压缩`,
				expectedGain: '15-25% 传输时间减少',
				implementation: '对大于5KB的数据启用压缩',
				confidence: 0.6
			});
		}
    
		// 如果有高优先级建议，记录日志
		const highPriorityRecs = recommendations.filter(r => r.priority === 'high');
		if (highPriorityRecs.length > 0) {
			this.logger.warn(`⚡ 发现高优先级优化机会: ${analysis.operationType}`, {
				bottleneckScore: analysis.bottleneckScore,
				recommendations: highPriorityRecs.map(r => r.description)
			});
		}
	}
  
	/**
   * 🎛️ 执行自适应优化
   */
	private performAdaptiveOptimization(analysisResults: PerformanceAnalysis[]): void {
		let configChanged = false;
    
		for (const analysis of analysisResults) {
			// 动态调整批处理大小
			const newBatchSize = this.calculateOptimalBatchSize(analysis);
			const operationType = this.mapToOperationType(analysis.operationType);
      
			if (newBatchSize !== this.adaptiveConfig.batchSize[operationType]) {
				this.adaptiveConfig.batchSize[operationType] = newBatchSize;
				configChanged = true;
				this.logger.info(`🎛️ 自适应调整批处理大小: ${operationType} → ${newBatchSize}`);
			}
      
			// 动态调整超时时间
			const newTimeout = this.calculateOptimalTimeout(analysis);
			if (newTimeout !== this.adaptiveConfig.timeout[operationType]) {
				this.adaptiveConfig.timeout[operationType] = newTimeout;
				configChanged = true;
				this.logger.info(`⏰ 自适应调整超时时间: ${operationType} → ${newTimeout}ms`);
			}
		}
    
		if (configChanged) {
			this.logger.info('🎛️ 自适应配置已更新', this.adaptiveConfig);
		}
	}
  
	/**
   * 🔢 计算最优批处理大小
   */
	private calculateOptimalBatchSize(analysis: PerformanceAnalysis): number {
		const baseSize = this.adaptiveConfig.batchSize['default'];
    
		// 根据响应时间和成功率调整
		let multiplier = 1.0;
    
		if (analysis.avgDuration < 500 && analysis.successRate > 0.95) {
			multiplier = 1.5; // 响应快且稳定，增加批处理大小
		} else if (analysis.avgDuration > 2000 || analysis.successRate < 0.9) {
			multiplier = 0.7; // 响应慢或不稳定，减少批处理大小
		}
    
		// 根据数据大小调整
		if (analysis.avgDataSize > 100 * 1024) { // >100KB
			multiplier *= 0.8; // 大数据减少批处理
		}
    
		return Math.max(1, Math.min(50, Math.round(baseSize * multiplier)));
	}
  
	/**
   * ⏰ 计算最优超时时间
   */
	private calculateOptimalTimeout(analysis: PerformanceAnalysis): number {
		// 基于P95响应时间设置超时，留出缓冲
		const baseTimeout = Math.max(5000, analysis.p95 * 2);
    
		// 根据失败率调整
		const failureRate = 1 - analysis.successRate;
		if (failureRate > 0.1) {
			return Math.min(60000, baseTimeout * 1.5); // 高失败率，增加超时
		}
    
		return Math.min(30000, baseTimeout);
	}
  
	/**
   * 🗺️ 映射操作类型
   */
	private mapToOperationType(fullType: string): string {
		if (fullType.includes('LIST') || fullType.includes('INFO')) {return 'directory';}
		if (fullType.includes('UPLOAD') || fullType.includes('DOWNLOAD')) {return 'file_transfer';}
		if (fullType.includes('DELETE') || fullType.includes('RENAME')) {return 'file_modify';}
		return 'default';
	}
  
	/**
   * 📊 生成综合优化报告
   */
	generateOptimizationReport(): OptimizationReport {
		const allRecommendations: OptimizationRecommendation[] = [];
		const allBottlenecks: BottleneckReport[] = [];
		let totalRequests = 0;
		let totalResponseTime = 0;
		let totalSuccesses = 0;
		let totalProtobuf = 0;
		let totalCacheHits = 0;
    
		// 分析当前所有指标
		for (const [key, metrics] of this.advancedMetrics.entries()) {
			if (metrics.length === 0) {continue;}
      
			const analysis = this.analyzeOperationMetrics(key, metrics);
			totalRequests += analysis.totalCount;
			totalResponseTime += analysis.avgDuration * analysis.totalCount;
			totalSuccesses += analysis.successCount;
			totalProtobuf += analysis.protobufRatio * analysis.totalCount;
			totalCacheHits += analysis.cacheHitRate * analysis.totalCount;
      
			// 收集瓶颈
			if (analysis.bottleneckScore > 50) {
				allBottlenecks.push({
					operation: key,
					issue: this.identifyMainIssue(analysis),
					impact: analysis.bottleneckScore > 75 ? 'high' : 'medium',
					suggestion: this.generateBottleneckSuggestion(analysis),
					metrics: {
						avgLatency: analysis.avgDuration,
						failureRate: 1 - analysis.successRate,
						throughput: analysis.totalCount / (this.ANALYSIS_INTERVAL / 1000)
					}
				});
			}
      
			// 收集推荐
			this.generateRealtimeRecommendations(analysis);
		}
    
		// 趋势分析
		const trendAnalysis = this.analyzeTrends();
    
		// 计算整体健康评分
		const avgResponseTime = totalRequests > 0 ? totalResponseTime / totalRequests : 0;
		const overallSuccessRate = totalRequests > 0 ? totalSuccesses / totalRequests : 1;
		const overallHealthScore = this.calculateHealthScore(avgResponseTime, overallSuccessRate, allBottlenecks.length);
    
		return {
			timestamp: Date.now(),
			summary: {
				totalRequests,
				avgResponseTime,
				successRate: overallSuccessRate,
				protobufUsage: totalRequests > 0 ? totalProtobuf / totalRequests : 0,
				cacheHitRate: totalRequests > 0 ? totalCacheHits / totalRequests : 0,
				overallHealthScore
			},
			recommendations: allRecommendations,
			topBottlenecks: allBottlenecks.sort((a, b) => b.metrics.avgLatency - a.metrics.avgLatency).slice(0, 5),
			trendAnalysis
		};
	}
  
	/**
   * 📈 分析趋势
   */
	private analyzeTrends(): OptimizationReport['trendAnalysis'] {
		if (this.analysisHistory.length < 2) {
			return {
				performanceTrend: 'stable',
				trendConfidence: 0,
				keyMetricChanges: []
			};
		}
    
		const recent = this.analysisHistory[this.analysisHistory.length - 1];
		const previous = this.analysisHistory[this.analysisHistory.length - 2];
    
		// 计算关键指标变化
		const keyMetricChanges = this.calculateMetricChanges(recent, previous);
    
		// 判断整体趋势
		const avgChange = keyMetricChanges.reduce((sum, change) => sum + change.change, 0) / keyMetricChanges.length;
		let performanceTrend: 'improving' | 'stable' | 'degrading';
    
		if (avgChange < -5) {
			performanceTrend = 'improving';
		} else if (avgChange > 5) {
			performanceTrend = 'degrading';
		} else {
			performanceTrend = 'stable';
		}
    
		const trendConfidence = Math.min(1, Math.abs(avgChange) / 20);
    
		return {
			performanceTrend,
			trendConfidence,
			keyMetricChanges
		};
	}
  
	/**
   * 📊 计算指标变化
   */
	private calculateMetricChanges(recent: PerformanceAnalysis[], previous: PerformanceAnalysis[]) {
		const changes: Array<{ metric: string; change: number; period: string }> = [];
    
		// 匹配相同操作类型的分析结果
		for (const recentAnalysis of recent) {
			const previousAnalysis = previous.find(p => p.operationType === recentAnalysis.operationType);
			if (!previousAnalysis) {continue;}
      
			const responseTimeChange = ((recentAnalysis.avgDuration - previousAnalysis.avgDuration) / previousAnalysis.avgDuration) * 100;
			const successRateChange = ((recentAnalysis.successRate - previousAnalysis.successRate) / previousAnalysis.successRate) * 100;
      
			changes.push(
				{ metric: `${recentAnalysis.operationType}_response_time`, change: responseTimeChange, period: '30s' },
				{ metric: `${recentAnalysis.operationType}_success_rate`, change: successRateChange, period: '30s' }
			);
		}
    
		return changes;
	}
  
	/**
   * 🏥 计算健康评分
   */
	private calculateHealthScore(avgResponseTime: number, successRate: number, bottleneckCount: number): number {
		let score = 100;
    
		// 响应时间扣分 (30%)
		if (avgResponseTime > 5000) {score -= 30;}
		else if (avgResponseTime > 2000) {score -= 15;}
		else if (avgResponseTime > 1000) {score -= 5;}
    
		// 成功率扣分 (40%)
		score -= (1 - successRate) * 40;
    
		// 瓶颈数量扣分 (30%)
		score -= bottleneckCount * 10;
    
		return Math.max(0, Math.round(score));
	}
  
	/**
   * 🔍 识别主要问题
   */
	private identifyMainIssue(analysis: PerformanceAnalysis): string {
		if (analysis.successRate < 0.9) {return 'High failure rate';}
		if (analysis.avgDuration > 5000) {return 'High latency';}
		if (analysis.protobufRatio < 0.5) {return 'Inefficient protocol usage';}
		if (analysis.cacheHitRate < 0.5) {return 'Poor cache performance';}
		return 'Performance degradation';
	}
  
	/**
   * 💡 生成瓶颈建议
   */
	private generateBottleneckSuggestion(analysis: PerformanceAnalysis): string {
		if (analysis.successRate < 0.9) {return 'Review error handling and add retry mechanisms';}
		if (analysis.avgDuration > 5000) {return 'Optimize processing logic and consider async patterns';}
		if (analysis.protobufRatio < 0.5) {return 'Force Protobuf usage for this operation type';}
		if (analysis.cacheHitRate < 0.5) {return 'Implement or enhance caching strategy';}
		return 'Review overall architecture and identify optimization opportunities';
	}
  
	/**
   * 🎛️ 获取当前自适应配置
   */
	getAdaptiveConfig(): AdaptiveConfig {
		return { ...this.adaptiveConfig };
	}
  
	/**
   * 🎯 获取特定操作的最优批处理大小
   */
	getOptimalBatchSize(operation: string): number {
		const operationType = this.mapToOperationType(operation);
		return this.adaptiveConfig.batchSize[operationType] || this.adaptiveConfig.batchSize['default'];
	}
  
	/**
   * 🗄️ 获取最优分片大小
   */
	getOptimalChunkSize(fileSize: number, networkQuality: 'fast' | 'medium' | 'slow' = 'medium'): number {
		let category: string;
    
		if (fileSize < 1024 * 1024) { // < 1MB
			category = 'small_files';
		} else if (fileSize < 100 * 1024 * 1024) { // < 100MB
			category = 'medium_files';
		} else {
			category = 'large_files';
		}
    
		let baseSize = this.adaptiveConfig.chunkSize[category] || this.adaptiveConfig.chunkSize['default'];
    
		// 根据网络质量调整
		const networkMultipliers = { 'fast': 1.5, 'medium': 1.0, 'slow': 0.5 };
		baseSize = Math.round(baseSize * networkMultipliers[networkQuality]);
    
		// 确保合理范围
		return Math.max(32 * 1024, Math.min(2 * 1024 * 1024, baseSize));
	}
  
	/**
   * 🛑 停止高级分析
   */
	stop(): void {
		if (this.analysisTimer) {
			clearInterval(this.analysisTimer);
			this.analysisTimer = undefined;
		}
    
		this.logger.info('🛑 高级性能监控器已停止');
	}
  
	/**
   * 📊 获取详细统计信息
   */
	getDetailedStatistics() {
		const baseStats = super.getStatistics?.() || {};
		const healthScore = this.calculateHealthScore(0, 1, 0); // 简化计算
    
		return {
			...baseStats,
			advanced: {
				healthScore,
				adaptiveConfigUpdates: Object.keys(this.adaptiveConfig.batchSize).length,
				analysisHistoryLength: this.analysisHistory.length,
				currentRecommendationCount: 0, // 可以扩展
				trendConfidence: this.analysisHistory.length >= 2 ? 0.8 : 0
			}
		};
	}
}

export default AdvancedPerformanceMonitor;