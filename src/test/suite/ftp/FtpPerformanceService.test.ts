import * as assert from 'assert';
import * as sinon from 'sinon';
import { 
	FtpPerformanceService,
	PerformanceMetrics,
	ConnectionPoolMetrics,
	OptimizationMetrics,
	ErrorMetrics,
	ServerMetrics,
	PerformanceEvent
} from '../../../webview/services/FtpPerformanceService';

suite('FTP Performance Service Test Suite', () => {
	let performanceService: FtpPerformanceService;
	let clock: sinon.SinonFakeTimers;

	setup(() => {
		// 重置单例实例
		(FtpPerformanceService as any).instance = null;
		performanceService = FtpPerformanceService.getInstance();
		clock = sinon.useFakeTimers();
	});

	teardown(() => {
		performanceService.stopMonitoring();
		performanceService.clearHistory();
		clock.restore();
		sinon.restore();
	});

	test('应该创建单例实例', () => {
		const instance1 = FtpPerformanceService.getInstance();
		const instance2 = FtpPerformanceService.getInstance();
    
		assert.strictEqual(instance1, instance2);
	});

	test('应该启动和停止监控', () => {
		assert.strictEqual(performanceService.isMonitoring, false);
    
		performanceService.startMonitoring(1000);
		assert.strictEqual(performanceService.isMonitoring, true);
    
		performanceService.stopMonitoring();
		assert.strictEqual(performanceService.isMonitoring, false);
	});

	test('应该定期收集性能指标', () => {
		const eventListener = sinon.stub();
		performanceService.on('metricsUpdated', eventListener);
    
		performanceService.startMonitoring(1000);
    
		// 快进时间触发指标收集
		clock.tick(1100);
    
		assert.ok(eventListener.called);
		const metrics = eventListener.firstCall.args[0] as PerformanceMetrics;
		assert.ok(typeof metrics.timestamp === 'number');
		assert.ok(typeof metrics.transferSpeed === 'number');
	});

	test('应该添加和检索性能指标', () => {
		const testMetric: PerformanceMetrics = {
			timestamp: Date.now(),
			transferSpeed: 1024 * 1024, // 1MB/s
			activeConnections: 2,
			maxConnections: 5,
			successRate: 98.5,
			totalTransfers: 10,
			totalDataTransferred: 10 * 1024 * 1024,
			responseTime: 100,
			cpuUsage: 25,
			memoryUsage: 45
		};

		performanceService.addMetric(testMetric);

		const summary = performanceService.getPerformanceSummary();
		assert.ok(summary.current);
		assert.strictEqual(summary.current.transferSpeed, testMetric.transferSpeed);
		assert.strictEqual(summary.current.activeConnections, testMetric.activeConnections);
	});

	test('应该记录传输事件', () => {
		const eventListener = sinon.stub();
		performanceService.on('transferEvent', eventListener);

		performanceService.recordTransferEvent('start', {
			filename: 'test.txt',
			size: 1024
		});

		assert.ok(eventListener.called);
		const event = eventListener.firstCall.args[0] as PerformanceEvent;
		assert.strictEqual(event.type, 'transfer');
		assert.ok(event.message.includes('test.txt'));
	});

	test('应该记录连接池事件', () => {
		const eventListener = sinon.stub();
		performanceService.on('connectionEvent', eventListener);

		performanceService.recordConnectionEvent('created', {
			host: 'test.example.com',
			port: 21
		});

		assert.ok(eventListener.called);
		const event = eventListener.firstCall.args[0] as PerformanceEvent;
		assert.strictEqual(event.type, 'connection');
		assert.ok(event.message.includes('test.example.com'));
	});

	test('应该记录优化效果', () => {
		const eventListener = sinon.stub();
		performanceService.on('optimizationEvent', eventListener);

		performanceService.recordOptimizationEffect('连接复用', 25, {
			connectionsReused: 5
		});

		assert.ok(eventListener.called);
		const event = eventListener.firstCall.args[0] as PerformanceEvent;
		assert.strictEqual(event.type, 'optimization');
		assert.ok(event.message.includes('25%'));
	});

	test('应该计算性能统计摘要', () => {
		// 添加一些测试数据
		const metrics = [
			{
				timestamp: Date.now() - 3000,
				transferSpeed: 1024 * 1024,
				activeConnections: 2,
				maxConnections: 5,
				successRate: 98,
				totalTransfers: 5,
				totalDataTransferred: 5 * 1024 * 1024,
				responseTime: 100,
				cpuUsage: 20,
				memoryUsage: 40
			},
			{
				timestamp: Date.now() - 2000,
				transferSpeed: 2048 * 1024,
				activeConnections: 3,
				maxConnections: 5,
				successRate: 99,
				totalTransfers: 8,
				totalDataTransferred: 8 * 1024 * 1024,
				responseTime: 90,
				cpuUsage: 30,
				memoryUsage: 50
			},
			{
				timestamp: Date.now() - 1000,
				transferSpeed: 1536 * 1024,
				activeConnections: 1,
				maxConnections: 5,
				successRate: 97,
				totalTransfers: 12,
				totalDataTransferred: 12 * 1024 * 1024,
				responseTime: 110,
				cpuUsage: 25,
				memoryUsage: 45
			}
		];

		metrics.forEach(metric => performanceService.addMetric(metric));

		const summary = performanceService.getPerformanceSummary();
    
		assert.ok(summary.current);
		assert.ok(summary.average);
		assert.ok(summary.peak);
		assert.ok(summary.trends);
    
		// 验证平均值计算
		assert.strictEqual(summary.average.successRate, 98); // (98+99+97)/3
    
		// 验证峰值
		assert.strictEqual(summary.peak.transferSpeed, 2048 * 1024);
    
		// 验证趋势数据
		assert.strictEqual(summary.trends.speed.length, 3);
		assert.strictEqual(summary.trends.connections.length, 3);
	});

	test('应该生成性能报告', () => {
		// 添加一些测试数据
		const testMetric: PerformanceMetrics = {
			timestamp: Date.now(),
			transferSpeed: 1024 * 1024,
			activeConnections: 2,
			maxConnections: 5,
			successRate: 98.5,
			totalTransfers: 10,
			totalDataTransferred: 10 * 1024 * 1024,
			responseTime: 100,
			cpuUsage: 25,
			memoryUsage: 45
		};

		performanceService.addMetric(testMetric);
		performanceService.recordTransferEvent('complete', {
			filename: 'test.txt',
			size: 1024,
			duration: 1000
		});

		const report = performanceService.generateReport(24);

		assert.ok(report.generatedAt);
		assert.ok(report.period.start);
		assert.ok(report.period.end);
		assert.ok(report.summary);
		assert.ok(report.metrics);
		assert.ok(report.trends);
		assert.ok(Array.isArray(report.recommendations));

		// 验证摘要数据
		assert.ok(typeof report.summary.totalTransfers === 'number');
		assert.ok(typeof report.summary.successRate === 'number');
		assert.ok(typeof report.summary.averageSpeed === 'number');
	});

	test('应该获取连接池指标', () => {
		const poolMetrics = performanceService.getConnectionPoolMetrics();

		assert.ok(typeof poolMetrics.poolSize === 'number');
		assert.ok(typeof poolMetrics.idleConnections === 'number');
		assert.ok(typeof poolMetrics.activeConnections === 'number');
		assert.ok(typeof poolMetrics.reuseCount === 'number');
	});

	test('应该获取优化指标', () => {
		const optimizationMetrics = performanceService.getOptimizationMetrics();

		assert.ok(typeof optimizationMetrics.standardImprovement === 'number');
		assert.ok(typeof optimizationMetrics.extendedImprovement === 'number');
		assert.ok(typeof optimizationMetrics.connectionReuseSavings === 'number');
		assert.ok(typeof optimizationMetrics.cacheHitRate === 'number');
	});

	test('应该获取错误指标', () => {
		// 记录一些错误事件
		performanceService.recordTransferEvent('error', {
			filename: 'test.txt',
			error: 'Network error'
		});

		const errorMetrics = performanceService.getErrorMetrics();

		assert.ok(typeof errorMetrics.networkErrors === 'number');
		assert.ok(typeof errorMetrics.timeoutErrors === 'number');
		assert.ok(typeof errorMetrics.totalErrors === 'number');
	});

	test('应该获取服务器指标', () => {
		const serverMetrics = performanceService.getServerMetrics();

		assert.ok(typeof serverMetrics.responseTime === 'number');
		assert.ok(typeof serverMetrics.serverLoad === 'number');
		assert.ok(Array.isArray(serverMetrics.supportedFeatures));
		assert.ok(typeof serverMetrics.detectionReliability === 'number');
	});

	test('应该维护事件历史限制', () => {
		// 添加超过最大限制的事件
		for (let i = 0; i < 600; i++) {
			performanceService.recordTransferEvent('complete', {
				filename: `file${i}.txt`,
				size: 1024
			});
		}

		const events = performanceService.getRecentEvents(1000);
    
		// 应该不超过最大历史记录限制
		assert.ok(events.length <= 500);
	});

	test('应该维护指标历史限制', () => {
		// 添加超过最大限制的指标
		for (let i = 0; i < 1200; i++) {
			const testMetric: PerformanceMetrics = {
				timestamp: Date.now() + i * 1000,
				transferSpeed: Math.random() * 1024 * 1024,
				activeConnections: Math.floor(Math.random() * 5),
				maxConnections: 5,
				successRate: 95 + Math.random() * 5,
				totalTransfers: i,
				totalDataTransferred: i * 1024,
				responseTime: 80 + Math.random() * 40,
				cpuUsage: Math.random() * 100,
				memoryUsage: Math.random() * 100
			};
			performanceService.addMetric(testMetric);
		}

		// 内部指标数组不应超过最大限制
		const metricsCount = (performanceService as any).metrics.length;
		assert.ok(metricsCount <= 1000);
	});

	test('应该支持事件监听器管理', () => {
		const listener1 = sinon.stub();
		const listener2 = sinon.stub();

		performanceService.on('test-event', listener1);
		performanceService.on('test-event', listener2);

		// 触发事件
		(performanceService as any).emit('test-event', { data: 'test' });

		assert.ok(listener1.called);
		assert.ok(listener2.called);

		// 移除监听器
		performanceService.off('test-event', listener1);

		// 再次触发事件
		(performanceService as any).emit('test-event', { data: 'test2' });

		// listener1 不应该再被调用，listener2 应该被调用
		assert.strictEqual(listener1.callCount, 1);
		assert.strictEqual(listener2.callCount, 2);
	});

	test('应该清除历史数据', () => {
		// 添加一些数据
		const testMetric: PerformanceMetrics = {
			timestamp: Date.now(),
			transferSpeed: 1024 * 1024,
			activeConnections: 2,
			maxConnections: 5,
			successRate: 98.5,
			totalTransfers: 10,
			totalDataTransferred: 10 * 1024 * 1024,
			responseTime: 100,
			cpuUsage: 25,
			memoryUsage: 45
		};

		performanceService.addMetric(testMetric);
		performanceService.recordTransferEvent('complete', { filename: 'test.txt', size: 1024 });

		let summary = performanceService.getPerformanceSummary();
		let events = performanceService.getRecentEvents(10);

		assert.ok(summary.current);
		assert.ok(events.length > 0);

		// 清除历史数据
		performanceService.clearHistory();

		summary = performanceService.getPerformanceSummary();
		events = performanceService.getRecentEvents(10);

		assert.strictEqual(summary.current, null);
		assert.strictEqual(events.length, 1); // 只有清除历史的事件
	});

	test('应该格式化字节大小', () => {
		const formatBytes = (performanceService as any).formatBytes;

		assert.strictEqual(formatBytes(100), '100 B');
		assert.strictEqual(formatBytes(1024), '1.0 KB');
		assert.strictEqual(formatBytes(1024 * 1024), '1.0 MB');
		assert.strictEqual(formatBytes(1024 * 1024 * 1024), '1.0 GB');
	});

	test('应该生成优化建议', () => {
		const summary = {
			totalTransfers: 100,
			successRate: 85, // 较低的成功率
			averageSpeed: 512 * 1024, // 较慢的速度
			totalDataTransferred: 100 * 1024 * 1024,
			peakSpeed: 5 * 1024 * 1024, // 峰值比平均值高很多
			optimizationGains: 20
		};

		const recommendations = (performanceService as any).generateRecommendations(summary);

		assert.ok(Array.isArray(recommendations));
		assert.ok(recommendations.length > 0);

		// 应该包含针对低成功率的建议
		const hasSuccessRateAdvice = recommendations.some(r => r.includes('成功率'));
		assert.ok(hasSuccessRateAdvice);

		// 应该包含针对低速度的建议
		const hasSpeedAdvice = recommendations.some(r => r.includes('速度') || r.includes('优化'));
		assert.ok(hasSpeedAdvice);
	});
});