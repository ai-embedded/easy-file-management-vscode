import * as assert from 'assert';
import * as sinon from 'sinon';
import { CompatibleFtpClient } from '../../../extension/ftp/CompatibleFtpClient';
import { StandardFtpOptimizer } from '../../../extension/ftp/optimizers/StandardFtpOptimizer';
import { ExtendedFtpOptimizer } from '../../../extension/ftp/optimizers/ExtendedFtpOptimizer';
import { FtpCapabilityDetector } from '../../../extension/ftp/capabilities/FtpCapabilityDetector';
import { FtpConnectionPool } from '../../../extension/ftp/connection/FtpConnectionPool';
import { BasicFtp } from 'basic-ftp';
import { FtpConfig, FtpServerCapabilities } from '../../../shared/types/ftp';

suite('Compatible FTP Client Test Suite', () => {
	let client: CompatibleFtpClient;
	let mockConnectionPool: sinon.SinonStubbedInstance<FtpConnectionPool>;
	let mockCapabilityDetector: sinon.SinonStubbedInstance<FtpCapabilityDetector>;
	let mockStandardOptimizer: sinon.SinonStubbedInstance<StandardFtpOptimizer>;
	let mockExtendedOptimizer: sinon.SinonStubbedInstance<ExtendedFtpOptimizer>;
	let mockFtpClient: sinon.SinonStubbedInstance<BasicFtp>;
	let mockConfig: FtpConfig;
	let mockCapabilities: FtpServerCapabilities;

	setup(() => {
		mockConnectionPool = sinon.createStubInstance(FtpConnectionPool);
		mockCapabilityDetector = sinon.createStubInstance(FtpCapabilityDetector);
		mockStandardOptimizer = sinon.createStubInstance(StandardFtpOptimizer);
		mockExtendedOptimizer = sinon.createStubInstance(ExtendedFtpOptimizer);
		mockFtpClient = sinon.createStubInstance(BasicFtp);

		client = new CompatibleFtpClient(
      mockConnectionPool as any,
      mockCapabilityDetector as any,
      mockStandardOptimizer as any,
      mockExtendedOptimizer as any
		);

		mockConfig = {
			type: 'ftp',
			host: 'test.example.com',
			port: 21,
			username: 'testuser',
			password: 'testpass',
			timeout: 30000
		};

		mockCapabilities = {
			supportsPASV: true,
			supportsEPSV: true,
			supportsREST: true,
			supportsSIZE: true,
			supportsMDTM: true,
			supportsModeZ: false, // 不支持压缩
			supportsMLSD: true,
			supportsSITE: true,
			supportsUTF8: true,
			supportsAPPE: true,
			maxConnections: 3,
			transferBufferSize: 64 * 1024,
			commandResponseTime: 150,
			serverSoftware: 'vsftpd 3.0.3',
			serverFeatures: ['PASV', 'EPSV', 'REST', 'SIZE', 'MDTM', 'MLSD'],
			protocolVersion: 'FTP 1.0',
			detectionTime: Date.now(),
			detectionReliability: 0.85
		};
	});

	teardown(() => {
		sinon.restore();
	});

	test('应该成功连接到FTP服务器', async () => {
		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);

		const result = await client.connect(mockConfig);

		assert.ok(result.success);
		assert.ok(result.serverCapabilities);
		assert.ok(mockConnectionPool.getConnection.calledOnce);
		assert.ok(mockCapabilityDetector.detectServerCapabilities.calledOnce);
	});

	test('应该自动选择最佳优化策略', async () => {
		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
    
		await client.connect(mockConfig);

		const uploadConfig = {
			localPath: '/local/test.txt',
			remotePath: '/remote/test.txt',
			overwrite: true
		};

		// 模拟标准优化器响应
		mockStandardOptimizer.uploadFile.resolves({
			success: true,
			operation: 'upload',
			duration: 1000,
			bytesTransferred: 1024,
			optimizationApplied: ['连接复用', '智能重试']
		});

		const result = await client.uploadFile(uploadConfig);

		assert.ok(result.success);
		assert.strictEqual(result.strategyUsed, 'standard');
		assert.ok(mockStandardOptimizer.uploadFile.calledOnce);
	});

	test('应该在支持扩展功能时使用扩展优化器', async () => {
		// 模拟支持更多扩展功能的服务器
		const extendedCapabilities = {
			...mockCapabilities,
			supportsModeZ: true, // 支持压缩
			maxConnections: 5,
			detectionReliability: 0.95
		};

		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(extendedCapabilities);
    
		await client.connect(mockConfig);

		const uploadConfig = {
			localPath: '/local/largefile.zip',
			remotePath: '/remote/largefile.zip',
			overwrite: true
		};

		// 模拟文件大小足够使用扩展功能
		const fs = require('fs');
		const statStub = sinon.stub(fs.promises, 'stat').resolves({ size: 50 * 1024 * 1024 });

		mockExtendedOptimizer.uploadFileWithCompression.resolves({
			success: true,
			operation: 'upload',
			duration: 2000,
			bytesTransferred: 50 * 1024 * 1024,
			optimizationApplied: ['压缩传输', '流式处理'],
			compressionRatio: 0.7
		});

		const result = await client.uploadFile(uploadConfig);

		assert.ok(result.success);
		assert.strictEqual(result.strategyUsed, 'extended');
		assert.ok(result.optimizationApplied?.includes('压缩传输'));
    
		statStub.restore();
	});

	test('应该在扩展功能失败时回退到标准优化', async () => {
		const extendedCapabilities = {
			...mockCapabilities,
			supportsModeZ: true,
			detectionReliability: 0.95
		};

		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(extendedCapabilities);
    
		await client.connect(mockConfig);

		const uploadConfig = {
			localPath: '/local/test.txt',
			remotePath: '/remote/test.txt',
			overwrite: true
		};

		// 模拟扩展功能失败
		mockExtendedOptimizer.uploadFileWithCompression.rejects(new Error('Compression not available'));
    
		// 模拟标准优化器成功
		mockStandardOptimizer.uploadFile.resolves({
			success: true,
			operation: 'upload',
			duration: 1000,
			bytesTransferred: 1024,
			optimizationApplied: ['连接复用']
		});

		const result = await client.uploadFile(uploadConfig);

		assert.ok(result.success);
		assert.strictEqual(result.strategyUsed, 'standard');
		assert.ok(result.fallbackUsed);
		assert.ok(mockStandardOptimizer.uploadFile.calledOnce);
	});

	test('应该提供统一的下载接口', async () => {
		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
    
		await client.connect(mockConfig);

		const downloadConfig = {
			remotePath: '/remote/test.txt',
			localPath: '/local/test.txt'
		};

		mockStandardOptimizer.downloadFile.resolves({
			success: true,
			operation: 'download',
			duration: 800,
			bytesTransferred: 2048,
			optimizationApplied: ['缓存查询']
		});

		const result = await client.downloadFile(downloadConfig);

		assert.ok(result.success);
		assert.strictEqual(result.operation, 'download');
		assert.strictEqual(result.bytesTransferred, 2048);
	});

	test('应该支持目录操作', async () => {
		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
    
		await client.connect(mockConfig);

		const remotePath = '/test/directory';
		const mockListing = [
			{ name: 'file1.txt', size: 1024, type: 1 },
			{ name: 'subdir', size: 0, type: 2 }
		];

		// 根据服务器能力选择合适的列表方法
		if (mockCapabilities.supportsMLSD) {
			mockExtendedOptimizer.listDirectoryEnhanced.resolves(mockListing);
		} else {
			mockStandardOptimizer.listDirectory.resolves(mockListing);
		}

		const listing = await client.listDirectory(remotePath);

		assert.ok(Array.isArray(listing));
		assert.strictEqual(listing.length, 2);
		assert.strictEqual(listing[0].name, 'file1.txt');
	});

	test('应该处理连接错误和重试', async () => {
		// 模拟第一次连接失败，第二次成功
		mockConnectionPool.getConnection
			.onFirstCall().rejects(new Error('Connection refused'))
			.onSecondCall().resolves(mockFtpClient as any);
      
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);

		const result = await client.connect(mockConfig);

		assert.ok(result.success);
		assert.ok(result.retryAttempts && result.retryAttempts > 0);
		assert.ok(mockConnectionPool.getConnection.calledTwice);
	});

	test('应该提供连接状态信息', async () => {
		// 初始状态应该是未连接
		assert.strictEqual(client.isConnected(), false);

		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);

		await client.connect(mockConfig);

		// 连接后状态应该是已连接
		assert.strictEqual(client.isConnected(), true);

		const status = client.getConnectionStatus();
		assert.ok(status.connected);
		assert.ok(status.serverInfo);
		assert.strictEqual(status.serverInfo.software, mockCapabilities.serverSoftware);
	});

	test('应该支持安全断开连接', async () => {
		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
		mockConnectionPool.releaseConnection.returns();

		await client.connect(mockConfig);
		assert.ok(client.isConnected());

		await client.disconnect();

		assert.strictEqual(client.isConnected(), false);
		assert.ok(mockConnectionPool.releaseConnection.calledOnce);
	});

	test('应该提供传输进度回调', async () => {
		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
    
		await client.connect(mockConfig);

		const progressUpdates: any[] = [];
		const progressCallback = (progress: any) => {
			progressUpdates.push(progress);
		};

		const uploadConfig = {
			localPath: '/local/test.txt',
			remotePath: '/remote/test.txt',
			overwrite: true,
			onProgress: progressCallback
		};

		mockStandardOptimizer.uploadFile.callsFake(async () => {
			// 模拟进度更新
			progressCallback({ transferred: 512, total: 1024, percentage: 50 });
			progressCallback({ transferred: 1024, total: 1024, percentage: 100 });
      
			return {
				success: true,
				operation: 'upload',
				duration: 1000,
				bytesTransferred: 1024,
				optimizationApplied: ['连接复用']
			};
		});

		const result = await client.uploadFile(uploadConfig);

		assert.ok(result.success);
		assert.strictEqual(progressUpdates.length, 2);
		assert.strictEqual(progressUpdates[1].percentage, 100);
	});

	test('应该支持批量操作', async () => {
		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
    
		await client.connect(mockConfig);

		const files = [
			{ localPath: '/local/file1.txt', remotePath: '/remote/file1.txt' },
			{ localPath: '/local/file2.txt', remotePath: '/remote/file2.txt' },
			{ localPath: '/local/file3.txt', remotePath: '/remote/file3.txt' }
		];

		mockStandardOptimizer.uploadFile.resolves({
			success: true,
			operation: 'upload',
			duration: 500,
			bytesTransferred: 1024,
			optimizationApplied: ['连接复用']
		});

		const results = await client.uploadMultipleFiles(files);

		assert.strictEqual(results.length, 3);
		results.forEach(result => {
			assert.ok(result.success);
		});
    
		// 应该复用连接
		assert.strictEqual(mockStandardOptimizer.uploadFile.callCount, 3);
	});

	test('应该记录详细的操作日志', async () => {
		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
    
		await client.connect(mockConfig);

		const uploadConfig = {
			localPath: '/local/test.txt',
			remotePath: '/remote/test.txt',
			overwrite: true
		};

		mockStandardOptimizer.uploadFile.resolves({
			success: true,
			operation: 'upload',
			duration: 1000,
			bytesTransferred: 1024,
			optimizationApplied: ['连接复用']
		});

		await client.uploadFile(uploadConfig);

		const logs = client.getOperationLogs();
		assert.ok(Array.isArray(logs));
		assert.ok(logs.length > 0);
    
		const uploadLog = logs.find(log => log.operation === 'upload');
		assert.ok(uploadLog);
		assert.strictEqual(uploadLog.success, true);
	});

	test('应该提供性能统计', async () => {
		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
    
		await client.connect(mockConfig);

		// 执行一些操作
		mockStandardOptimizer.uploadFile.resolves({
			success: true,
			operation: 'upload',
			duration: 1000,
			bytesTransferred: 1024,
			optimizationApplied: ['连接复用']
		});

		await client.uploadFile({
			localPath: '/local/test.txt',
			remotePath: '/remote/test.txt',
			overwrite: true
		});

		const stats = client.getPerformanceStats();
		assert.ok(stats);
		assert.ok(typeof stats.totalOperations === 'number');
		assert.ok(typeof stats.successfulOperations === 'number');
		assert.ok(typeof stats.averageSpeed === 'number');
		assert.ok(typeof stats.totalBytesTransferred === 'number');
	});

	test('应该处理服务器能力变化', async () => {
		mockConnectionPool.getConnection.resolves(mockFtpClient as any);
    
		// 初始连接时服务器能力有限
		const initialCapabilities = {
			...mockCapabilities,
			supportsModeZ: false,
			supportsMLSD: false,
			detectionReliability: 0.7
		};

		mockCapabilityDetector.detectServerCapabilities
			.onFirstCall().resolves(initialCapabilities)
			.onSecondCall().resolves(mockCapabilities); // 重新检测后发现更多功能

		await client.connect(mockConfig);

		// 重新检测服务器能力
		await client.refreshServerCapabilities();

		const status = client.getConnectionStatus();
		assert.ok(status.serverInfo?.capabilities?.supportsMLSD);
	});
});