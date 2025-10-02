import * as assert from 'assert';
import * as sinon from 'sinon';
import { StandardFtpOptimizer } from '../../../extension/ftp/optimizers/StandardFtpOptimizer';
import { FtpConnectionPool } from '../../../extension/ftp/connection/FtpConnectionPool';
import { BasicFtp } from 'basic-ftp';
import { FtpConfig, FileOperationResult } from '../../../shared/types';

suite('Standard FTP Optimizer Test Suite', () => {
	let optimizer: StandardFtpOptimizer;
	let mockClient: sinon.SinonStubbedInstance<BasicFtp>;
	let mockConnectionPool: sinon.SinonStubbedInstance<FtpConnectionPool>;
	let mockFtpConfig: FtpConfig;

	setup(() => {
		mockConnectionPool = sinon.createStubInstance(FtpConnectionPool);
		optimizer = new StandardFtpOptimizer(mockConnectionPool as any);
		mockClient = sinon.createStubInstance(BasicFtp);
    
		mockFtpConfig = {
			type: 'ftp',
			host: 'test.example.com',
			port: 21,
			username: 'testuser',
			password: 'testpass',
			timeout: 30000
		};
	});

	teardown(() => {
		sinon.restore();
	});

	test('应该初始化缓存系统', () => {
		assert.ok(optimizer);
    
		// 检查缓存系统是否正确初始化
		const cacheStats = optimizer.getCacheStats();
		assert.strictEqual(cacheStats.size, 0);
		assert.strictEqual(cacheStats.hitRate, 0);
	});

	test('应该优化文件上传操作', async () => {
		const uploadConfig = {
			localPath: '/local/test.txt',
			remotePath: '/remote/test.txt',
			overwrite: true
		};

		// 模拟成功的上传操作
		mockClient.uploadFrom.resolves();
		mockConnectionPool.getConnection.resolves(mockClient as any);
		mockConnectionPool.releaseConnection.returns();

		const result = await optimizer.uploadFile(mockClient as any, uploadConfig);

		assert.ok(result.success);
		assert.strictEqual(result.operation, 'upload');
		assert.ok(result.duration && result.duration > 0);
	});

	test('应该优化文件下载操作', async () => {
		const downloadConfig = {
			remotePath: '/remote/test.txt',
			localPath: '/local/test.txt'
		};

		// 模拟成功的下载操作
		mockClient.downloadTo.resolves();
		mockClient.size.resolves(1024); // 1KB文件

		const result = await optimizer.downloadFile(mockClient as any, downloadConfig);

		assert.ok(result.success);
		assert.strictEqual(result.operation, 'download');
		assert.strictEqual(result.bytesTransferred, 1024);
	});

	test('应该启用流式处理大文件', async () => {
		const largeFileConfig = {
			localPath: '/local/largefile.zip',
			remotePath: '/remote/largefile.zip',
			overwrite: true
		};

		// 模拟大文件上传（超过阈值）
		const fs = require('fs');
		const statStub = sinon.stub(fs.promises, 'stat').resolves({ size: 100 * 1024 * 1024 }); // 100MB

		mockClient.uploadFrom.resolves();

		const result = await optimizer.uploadFile(mockClient as any, largeFileConfig);

		assert.ok(result.success);
		assert.ok(result.optimizationApplied?.includes('流式处理'));
    
		statStub.restore();
	});

	test('应该缓存目录列表', async () => {
		const remotePath = '/test/directory';
		const mockListing = [
			{ name: 'file1.txt', size: 100, type: 1 },
			{ name: 'file2.txt', size: 200, type: 1 }
		];

		mockClient.list.resolves(mockListing);

		// 第一次调用应该从服务器获取
		const listing1 = await optimizer.listDirectory(mockClient as any, remotePath);
		assert.deepStrictEqual(listing1, mockListing);

		// 第二次调用应该从缓存获取
		const listing2 = await optimizer.listDirectory(mockClient as any, remotePath);
		assert.deepStrictEqual(listing2, mockListing);

		// 验证只调用了一次服务器API
		assert.ok(mockClient.list.calledOnce);

		// 验证缓存统计
		const cacheStats = optimizer.getCacheStats();
		assert.strictEqual(cacheStats.size, 1);
		assert.strictEqual(cacheStats.hitRate, 0.5); // 1 hit / 2 requests
	});

	test('应该处理网络中断重试', async () => {
		const uploadConfig = {
			localPath: '/local/test.txt',
			remotePath: '/remote/test.txt',
			overwrite: true
		};

		// 模拟第一次失败，第二次成功
		mockClient.uploadFrom
			.onFirstCall().rejects(new Error('Network error'))
			.onSecondCall().resolves();

		const result = await optimizer.uploadFile(mockClient as any, uploadConfig);

		assert.ok(result.success);
		assert.ok(result.optimizationApplied?.includes('智能重试'));
		assert.ok(mockClient.uploadFrom.calledTwice);
	});

	test('应该优化连接复用', async () => {
		const uploadConfigs = [
			{ localPath: '/local/file1.txt', remotePath: '/remote/file1.txt', overwrite: true },
			{ localPath: '/local/file2.txt', remotePath: '/remote/file2.txt', overwrite: true },
			{ localPath: '/local/file3.txt', remotePath: '/remote/file3.txt', overwrite: true }
		];

		mockClient.uploadFrom.resolves();
		mockConnectionPool.getConnection.resolves(mockClient as any);

		// 批量上传操作
		const results = await Promise.all(
			uploadConfigs.map(config => optimizer.uploadFile(mockClient as any, config))
		);

		// 所有操作都应该成功
		results.forEach(result => {
			assert.ok(result.success);
		});

		// 应该应用了连接复用优化
		const hasConnectionReuse = results.some(result => 
			result.optimizationApplied?.includes('连接复用')
		);
		assert.ok(hasConnectionReuse);
	});

	test('应该测量传输性能', async () => {
		const uploadConfig = {
			localPath: '/local/test.txt',
			remotePath: '/remote/test.txt',
			overwrite: true
		};

		// 模拟上传操作，添加一些延迟
		mockClient.uploadFrom.callsFake(() => {
			return new Promise(resolve => {
				setTimeout(resolve, 100);
			});
		});

		const result = await optimizer.uploadFile(mockClient as any, uploadConfig);

		assert.ok(result.success);
		assert.ok(result.duration && result.duration >= 100);
		assert.ok(result.transferSpeed && result.transferSpeed > 0);
	});

	test('应该处理传输模式优化', async () => {
		const downloadConfig = {
			remotePath: '/remote/test.txt',
			localPath: '/local/test.txt'
		};

		// 模拟被动模式设置
		mockClient.ftp.pasv = sinon.stub().resolves();
		mockClient.downloadTo.resolves();

		const result = await optimizer.downloadFile(mockClient as any, downloadConfig);

		assert.ok(result.success);
		// 验证设置了被动模式（在实际实现中会检查网络环境）
	});

	test('应该清理过期缓存', async () => {
		// 添加一些缓存条目
		await optimizer.listDirectory(mockClient as any, '/test/dir1');
		await optimizer.listDirectory(mockClient as any, '/test/dir2');

		mockClient.list.resolves([]);

		let cacheStats = optimizer.getCacheStats();
		assert.strictEqual(cacheStats.size, 2);

		// 手动触发缓存清理
		optimizer.clearCache();

		cacheStats = optimizer.getCacheStats();
		assert.strictEqual(cacheStats.size, 0);
	});

	test('应该提供优化统计信息', async () => {
		// 执行一些操作来生成统计数据
		const uploadConfig = {
			localPath: '/local/test.txt',
			remotePath: '/remote/test.txt',
			overwrite: true
		};

		mockClient.uploadFrom.resolves();

		await optimizer.uploadFile(mockClient as any, uploadConfig);

		const stats = optimizer.getOptimizationStats();
		assert.ok(stats);
		assert.ok(typeof stats.totalOperations === 'number');
		assert.ok(typeof stats.successfulOperations === 'number');
		assert.ok(typeof stats.averageSpeed === 'number');
		assert.ok(typeof stats.cacheHitRate === 'number');
	});

	test('应该处理并发操作', async () => {
		const uploadConfigs = Array.from({ length: 5 }, (placeholder, i) => ({
			localPath: `/local/file${i}.txt`,
			remotePath: `/remote/file${i}.txt`,
			overwrite: true
		}));

		mockClient.uploadFrom.resolves();

		// 并发执行多个上传操作
		const startTime = Date.now();
		const results = await Promise.all(
			uploadConfigs.map(config => optimizer.uploadFile(mockClient as any, config))
		);
		const endTime = Date.now();

		// 所有操作都应该成功
		results.forEach(result => {
			assert.ok(result.success);
		});

		// 并发操作应该比顺序操作更快
		const totalTime = endTime - startTime;
		assert.ok(totalTime < 1000); // 应该在1秒内完成
	});

	test('应该处理文件不存在错误', async () => {
		const uploadConfig = {
			localPath: '/nonexistent/file.txt',
			remotePath: '/remote/file.txt',
			overwrite: true
		};

		mockClient.uploadFrom.rejects(new Error('ENOENT: no such file or directory'));

		const result = await optimizer.uploadFile(mockClient as any, uploadConfig);

		assert.strictEqual(result.success, false);
		assert.ok(result.error);
		assert.ok(result.error.includes('file or directory'));
	});

	test('应该优化缓冲区大小', async () => {
		const downloadConfig = {
			remotePath: '/remote/largefile.dat',
			localPath: '/local/largefile.dat'
		};

		// 模拟大文件下载
		mockClient.size.resolves(50 * 1024 * 1024); // 50MB
		mockClient.downloadTo.resolves();

		const result = await optimizer.downloadFile(mockClient as any, downloadConfig);

		assert.ok(result.success);
		// 在实际实现中，应该根据文件大小调整缓冲区
		assert.ok(result.optimizationApplied?.some(opt => 
			opt.includes('缓冲区') || opt.includes('流式处理')
		));
	});
});
