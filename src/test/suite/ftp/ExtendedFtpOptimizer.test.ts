import * as assert from 'assert';
import * as sinon from 'sinon';
import { ExtendedFtpOptimizer } from '../../../extension/ftp/optimizers/ExtendedFtpOptimizer';
import { StandardFtpOptimizer } from '../../../extension/ftp/optimizers/StandardFtpOptimizer';
import { FtpConnectionPool } from '../../../extension/ftp/connection/FtpConnectionPool';
import { FtpCapabilityDetector } from '../../../extension/ftp/capabilities/FtpCapabilityDetector';
import { BasicFtp } from 'basic-ftp';
import { FtpServerCapabilities } from '../../../shared/types/ftp';

suite('Extended FTP Optimizer Test Suite', () => {
	let optimizer: ExtendedFtpOptimizer;
	let mockClient: sinon.SinonStubbedInstance<BasicFtp>;
	let mockConnectionPool: sinon.SinonStubbedInstance<FtpConnectionPool>;
	let mockCapabilityDetector: sinon.SinonStubbedInstance<FtpCapabilityDetector>;
	let mockStandardOptimizer: sinon.SinonStubbedInstance<StandardFtpOptimizer>;
	let mockCapabilities: FtpServerCapabilities;

	setup(() => {
		mockConnectionPool = sinon.createStubInstance(FtpConnectionPool);
		mockCapabilityDetector = sinon.createStubInstance(FtpCapabilityDetector);
		mockStandardOptimizer = sinon.createStubInstance(StandardFtpOptimizer);
    
		optimizer = new ExtendedFtpOptimizer(
      mockConnectionPool as any,
      mockCapabilityDetector as any,
      mockStandardOptimizer as any
		);
    
		mockClient = sinon.createStubInstance(BasicFtp);

		// 默认的服务器能力配置
		mockCapabilities = {
			supportsPASV: true,
			supportsEPSV: true,
			supportsREST: true,
			supportsSIZE: true,
			supportsMDTM: true,
			supportsModeZ: true,
			supportsMLSD: true,
			supportsSITE: true,
			supportsUTF8: true,
			supportsAPPE: true,
			maxConnections: 5,
			transferBufferSize: 64 * 1024,
			commandResponseTime: 100,
			serverSoftware: 'ProFTPD 1.3.6',
			serverFeatures: ['PASV', 'EPSV', 'REST', 'SIZE', 'MDTM', 'MODE Z', 'MLSD'],
			protocolVersion: 'FTP 1.0',
			detectionTime: Date.now(),
			detectionReliability: 0.95
		};
	});

	teardown(() => {
		sinon.restore();
	});

	test('应该支持断点续传上传', async () => {
		const uploadConfig = {
			localPath: '/local/largefile.zip',
			remotePath: '/remote/largefile.zip',
			overwrite: false,
			enableResume: true
		};

		// 模拟服务器支持断点续传
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
		mockClient.size.resolves(5 * 1024 * 1024); // 服务器上已有5MB
		mockClient.send.withArgs('REST 5242880').resolves({ code: 350, message: 'Restarting at 5242880' });
		mockClient.uploadFrom.resolves();

		const result = await optimizer.uploadFileWithResume(mockClient as any, uploadConfig);

		assert.ok(result.success);
		assert.ok(result.optimizationApplied?.includes('断点续传'));
		assert.strictEqual(result.resumedFromByte, 5 * 1024 * 1024);
	});

	test('应该支持断点续传下载', async () => {
		const downloadConfig = {
			remotePath: '/remote/largefile.zip',
			localPath: '/local/largefile.zip',
			enableResume: true
		};

		// 模拟本地文件已有部分内容
		const fs = require('fs');
		const statStub = sinon.stub(fs.promises, 'stat').resolves({ size: 3 * 1024 * 1024 });

		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
		mockClient.size.resolves(10 * 1024 * 1024); // 远程文件10MB
		mockClient.send.withArgs('REST 3145728').resolves({ code: 350, message: 'Restarting at 3145728' });
		mockClient.downloadTo.resolves();

		const result = await optimizer.downloadFileWithResume(mockClient as any, downloadConfig);

		assert.ok(result.success);
		assert.ok(result.optimizationApplied?.includes('断点续传'));
		assert.strictEqual(result.resumedFromByte, 3 * 1024 * 1024);
    
		statStub.restore();
	});

	test('应该启用压缩传输', async () => {
		const uploadConfig = {
			localPath: '/local/textfile.txt',
			remotePath: '/remote/textfile.txt',
			overwrite: true,
			enableCompression: true
		};

		// 模拟服务器支持压缩
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
		mockClient.send.withArgs('MODE Z').resolves({ code: 200, message: 'MODE Z ok' });
		mockClient.uploadFrom.resolves();

		const result = await optimizer.uploadFileWithCompression(mockClient as any, uploadConfig);

		assert.ok(result.success);
		assert.ok(result.optimizationApplied?.includes('压缩传输'));
    
		// 验证设置了压缩模式
		assert.ok(mockClient.send.calledWith('MODE Z'));
	});

	test('应该使用多连接并行传输', async () => {
		const uploadConfig = {
			localPath: '/local/hugefile.iso',
			remotePath: '/remote/hugefile.iso',
			overwrite: true,
			enableMultiConnection: true
		};

		// 模拟大文件和多连接支持
		const fs = require('fs');
		const statStub = sinon.stub(fs.promises, 'stat').resolves({ size: 500 * 1024 * 1024 }); // 500MB

		mockCapabilities.maxConnections = 3;
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
		mockConnectionPool.getConnection.resolves(mockClient as any);
		mockClient.uploadFrom.resolves();

		const result = await optimizer.uploadFileWithMultiConnection(mockClient as any, uploadConfig);

		assert.ok(result.success);
		assert.ok(result.optimizationApplied?.includes('多连接传输'));
    
		statStub.restore();
	});

	test('应该使用增强目录列表', async () => {
		const remotePath = '/test/directory';

		// 模拟服务器支持MLSD
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
		mockClient.send.withArgs('MLSD /test/directory').resolves({
			code: 150,
			message: 'data'
		});

		const mockMLSDResponse = [
			'Type=file;Size=1024;Modify=20231201120000; file1.txt',
			'Type=file;Size=2048;Modify=20231201120100; file2.txt',
			'Type=dir;Modify=20231201120200; subdir'
		];

		mockClient.list.resolves(mockMLSDResponse.map(line => {
			const parts = line.split('; ');
			const attrs = parts[0].split(';');
			const name = parts[1];
			return {
				name,
				size: attrs.find(a => a.startsWith('Size='))?.split('=')[1] || '0',
				type: attrs.find(a => a.startsWith('Type='))?.split('=')[1] === 'dir' ? 2 : 1,
				modifyTime: attrs.find(a => a.startsWith('Modify='))?.split('=')[1] || ''
			};
		}));

		const listing = await optimizer.listDirectoryEnhanced(mockClient as any, remotePath);

		assert.ok(Array.isArray(listing));
		assert.ok(listing.length > 0);
		assert.ok(listing[0].modifyTime); // 应该有详细的时间信息
	});

	test('应该自动选择最优传输策略', async () => {
		const uploadConfig = {
			localPath: '/local/file.txt',
			remotePath: '/remote/file.txt',
			overwrite: true
		};

		// 模拟不同的文件大小和服务器能力
		const testCases = [
			{
				fileSize: 1024, // 1KB - 应该使用标准传输
				expectedStrategy: 'standard'
			},
			{
				fileSize: 50 * 1024 * 1024, // 50MB - 应该使用压缩
				expectedStrategy: 'compression'
			},
			{
				fileSize: 500 * 1024 * 1024, // 500MB - 应该使用多连接
				expectedStrategy: 'multiConnection'
			}
		];

		const fs = require('fs');
    
		for (const testCase of testCases) {
			const statStub = sinon.stub(fs.promises, 'stat').resolves({ size: testCase.fileSize });
			mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);

			const strategy = await optimizer.selectOptimalStrategy(mockClient as any, uploadConfig);
      
			assert.ok(strategy);
			assert.ok(strategy.includes(testCase.expectedStrategy) || strategy === 'auto');
      
			statStub.restore();
		}
	});

	test('应该处理服务器不支持扩展功能的情况', async () => {
		const uploadConfig = {
			localPath: '/local/file.txt',
			remotePath: '/remote/file.txt',
			overwrite: true,
			enableCompression: true
		};

		// 模拟服务器不支持压缩
		const limitedCapabilities = {
			...mockCapabilities,
			supportsModeZ: false
		};

		mockCapabilityDetector.detectServerCapabilities.resolves(limitedCapabilities);
		mockStandardOptimizer.uploadFile.resolves({
			success: true,
			operation: 'upload',
			duration: 1000,
			bytesTransferred: 1024,
			optimizationApplied: ['连接复用']
		});

		const result = await optimizer.uploadFileWithCompression(mockClient as any, uploadConfig);

		// 应该回退到标准优化器
		assert.ok(result.success);
		assert.ok(mockStandardOptimizer.uploadFile.called);
		assert.ok(!result.optimizationApplied?.includes('压缩传输'));
	});

	test('应该验证文件完整性', async () => {
		const downloadConfig = {
			remotePath: '/remote/file.txt',
			localPath: '/local/file.txt',
			verifyIntegrity: true
		};

		// 模拟服务器支持MDTM和SIZE
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
		mockClient.size.resolves(1024);
		mockClient.send.withArgs('MDTM /remote/file.txt').resolves({
			code: 213,
			message: '213 20231201120000'
		});
		mockClient.downloadTo.resolves();

		const result = await optimizer.downloadFileWithVerification(mockClient as any, downloadConfig);

		assert.ok(result.success);
		assert.ok(result.optimizationApplied?.includes('完整性验证'));
		assert.strictEqual(result.verificationResult?.expectedSize, 1024);
	});

	test('应该支持UTF-8编码', async () => {
		const remotePath = '/测试/中文目录';

		// 模拟服务器支持UTF-8
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
		mockClient.send.withArgs('OPTS UTF8 ON').resolves({ code: 200, message: 'UTF8 set to on' });
		mockClient.list.resolves([
			{ name: '中文文件.txt', size: 1024, type: 1 }
		]);

		const listing = await optimizer.listDirectoryWithUTF8(mockClient as any, remotePath);

		assert.ok(Array.isArray(listing));
		assert.ok(mockClient.send.calledWith('OPTS UTF8 ON'));
	});

	test('应该提供扩展优化统计', () => {
		const stats = optimizer.getExtendedOptimizationStats();

		assert.ok(stats);
		assert.ok(typeof stats.resumeOperations === 'number');
		assert.ok(typeof stats.compressionRatio === 'number');
		assert.ok(typeof stats.multiConnectionUsage === 'number');
		assert.ok(typeof stats.verificationSuccessRate === 'number');
	});

	test('应该处理网络中断后的智能重连', async () => {
		const uploadConfig = {
			localPath: '/local/file.txt',
			remotePath: '/remote/file.txt',
			overwrite: true,
			enableResume: true
		};

		// 模拟网络中断和重连
		mockClient.uploadFrom
			.onFirstCall().rejects(new Error('Connection lost'))
			.onSecondCall().resolves();

		mockClient.size.resolves(512); // 传输了一半
		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);

		const result = await optimizer.uploadFileWithResume(mockClient as any, uploadConfig);

		assert.ok(result.success);
		assert.ok(result.optimizationApplied?.includes('断点续传'));
		assert.ok(result.optimizationApplied?.includes('智能重连'));
	});

	test('应该优化大文件传输性能', async () => {
		const uploadConfig = {
			localPath: '/local/hugefile.bin',
			remotePath: '/remote/hugefile.bin',
			overwrite: true
		};

		const fs = require('fs');
		const statStub = sinon.stub(fs.promises, 'stat').resolves({ 
			size: 1024 * 1024 * 1024 // 1GB文件
		});

		mockCapabilityDetector.detectServerCapabilities.resolves(mockCapabilities);
		mockConnectionPool.getConnection.resolves(mockClient as any);
		mockClient.uploadFrom.resolves();

		const result = await optimizer.uploadLargeFile(mockClient as any, uploadConfig);

		assert.ok(result.success);
    
		// 大文件应该应用多种优化
		const optimizations = result.optimizationApplied || [];
		const hasMultipleOptimizations = optimizations.length > 1;
		assert.ok(hasMultipleOptimizations);
    
		statStub.restore();
	});
});