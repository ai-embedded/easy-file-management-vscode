import * as assert from 'assert';
import * as sinon from 'sinon';
import { FtpCapabilityDetector } from '../../../extension/ftp/capabilities/FtpCapabilityDetector';
import { FtpServerCapabilities } from '../../../shared/types/ftp';
import { BasicFtp } from 'basic-ftp';

suite('FTP Capability Detector Test Suite', () => {
	let detector: FtpCapabilityDetector;
	let mockClient: sinon.SinonStubbedInstance<BasicFtp>;

	setup(() => {
		detector = new FtpCapabilityDetector();
		mockClient = sinon.createStubInstance(BasicFtp);
	});

	teardown(() => {
		sinon.restore();
	});

	test('应该检测基础 FTP 能力', async () => {
		// 模拟服务器支持基础功能
		mockClient.send.withArgs('FEAT').resolves({
			code: 211,
			message: '211-Features:\n PASV\n EPSV\n SIZE\n MDTM\n211 End'
		});
    
		mockClient.send.withArgs('SYST').resolves({
			code: 215,
			message: '215 UNIX Type: L8'
		});

		const capabilities = await detector.detectServerCapabilities(
      mockClient as any,
      'test.example.com'
		);

		assert.strictEqual(capabilities.supportsPASV, true);
		assert.strictEqual(capabilities.supportsEPSV, true);
		assert.strictEqual(capabilities.supportsSIZE, true);
		assert.strictEqual(capabilities.supportsMDTM, true);
		assert.ok(capabilities.detectionReliability > 0.8);
	});

	test('应该处理不支持 FEAT 命令的服务器', async () => {
		// 模拟服务器不支持FEAT命令
		mockClient.send.withArgs('FEAT').rejects(new Error('Command not understood'));
		mockClient.send.withArgs('SYST').resolves({
			code: 215,
			message: '215 UNIX Type: L8'
		});

		// 模拟检测PASV支持
		mockClient.send.withArgs('PASV').resolves({
			code: 227,
			message: '227 Entering Passive Mode (127,0,0,1,195,149)'
		});

		const capabilities = await detector.detectServerCapabilities(
      mockClient as any,
      'test.example.com'
		);

		assert.strictEqual(capabilities.supportsPASV, true);
		assert.strictEqual(capabilities.supportsMLSD, false); // 默认为false，因为无FEAT
		assert.ok(capabilities.detectionReliability < 0.8); // 可靠度较低
	});

	test('应该检测扩展功能支持', async () => {
		// 模拟支持扩展功能的服务器
		mockClient.send.withArgs('FEAT').resolves({
			code: 211,
			message: '211-Features:\n PASV\n EPSV\n SIZE\n MDTM\n MLSD\n MODE Z\n REST STREAM\n UTF8\n211 End'
		});
    
		mockClient.send.withArgs('SYST').resolves({
			code: 215,
			message: '215 ProFTPD Server'
		});

		const capabilities = await detector.detectServerCapabilities(
      mockClient as any,
      'test.example.com'
		);

		assert.strictEqual(capabilities.supportsMLSD, true);
		assert.strictEqual(capabilities.supportsModeZ, true);
		assert.strictEqual(capabilities.supportsREST, true);
		assert.strictEqual(capabilities.supportsUTF8, true);
		assert.strictEqual(capabilities.serverSoftware, 'ProFTPD Server');
	});

	test('应该测量服务器响应时间', async () => {
		// 模拟服务器响应延迟
		mockClient.send.withArgs('NOOP').callsFake(() => {
			return new Promise(resolve => {
				setTimeout(() => resolve({ code: 200, message: 'OK' }), 100);
			});
		});

		const responseTime = await detector.measureResponseTime(mockClient as any);
    
		// 响应时间应该接近100ms，允许一些误差
		assert.ok(responseTime >= 90);
		assert.ok(responseTime <= 150);
	});

	test('应该检测最大并发连接数', async () => {
		// 模拟连接限制检测
		const maxConnections = await detector.detectMaxConnections('test.example.com', 21);
    
		// 默认情况下应该返回合理的连接数
		assert.ok(maxConnections >= 1);
		assert.ok(maxConnections <= 10);
	});

	test('应该生成服务器指纹', () => {
		const capabilities: FtpServerCapabilities = {
			supportsPASV: true,
			supportsEPSV: true,
			supportsREST: true,
			supportsSIZE: true,
			supportsMDTM: true,
			supportsModeZ: false,
			supportsMLSD: true,
			supportsSITE: true,
			supportsUTF8: true,
			supportsAPPE: true,
			maxConnections: 5,
			transferBufferSize: 64 * 1024,
			commandResponseTime: 100,
			serverSoftware: 'vsftpd 3.0.3',
			serverFeatures: ['PASV', 'EPSV', 'REST', 'SIZE', 'MDTM', 'MLSD'],
			protocolVersion: 'FTP 1.0',
			detectionTime: Date.now(),
			detectionReliability: 0.95
		};

		const fingerprint = detector.generateServerFingerprint(capabilities);
    
		assert.ok(typeof fingerprint === 'string');
		assert.ok(fingerprint.length > 0);
    
		// 相同的能力应该生成相同的指纹
		const fingerprint2 = detector.generateServerFingerprint(capabilities);
		assert.strictEqual(fingerprint, fingerprint2);
    
		// 不同的能力应该生成不同的指纹
		const differentCapabilities = { ...capabilities, supportsModeZ: true };
		const differentFingerprint = detector.generateServerFingerprint(differentCapabilities);
		assert.notStrictEqual(fingerprint, differentFingerprint);
	});

	test('应该处理检测失败情况', async () => {
		// 模拟所有命令都失败
		mockClient.send.rejects(new Error('Connection failed'));

		try {
			await detector.detectServerCapabilities(mockClient as any, 'test.example.com');
			assert.fail('应该抛出检测失败错误');
		} catch (error) {
			assert.ok(error instanceof Error);
			assert.ok(error.message.includes('检测失败') || error.message.includes('Connection failed'));
		}
	});

	test('应该正确解析 FEAT 响应', () => {
		const featResponse = '211-Features:\n PASV\n EPSV\n SIZE\n MDTM\n MLSD\n MODE Z\n REST STREAM\n UTF8\n SITE CHMOD\n211 End';
    
		const features = detector.parseFeatResponse(featResponse);
    
		assert.ok(features.includes('PASV'));
		assert.ok(features.includes('EPSV'));
		assert.ok(features.includes('SIZE'));
		assert.ok(features.includes('MDTM'));
		assert.ok(features.includes('MLSD'));
		assert.ok(features.includes('MODE Z'));
		assert.ok(features.includes('REST STREAM'));
		assert.ok(features.includes('UTF8'));
		assert.ok(features.includes('SITE CHMOD'));
	});

	test('应该检测服务器软件版本', async () => {
		const testCases = [
			{
				systResponse: '215 UNIX Type: L8 ProFTPD Server ready',
				expected: 'ProFTPD Server'
			},
			{
				systResponse: '215 Microsoft FTP Service',
				expected: 'Microsoft FTP Service'
			},
			{
				systResponse: '215 UNIX Type: L8',
				expected: 'UNIX FTP Server'
			},
			{
				systResponse: '215 vsftpd 3.0.3',
				expected: 'vsftpd 3.0.3'
			}
		];

		for (const testCase of testCases) {
			const software = detector.parseServerSoftware(testCase.systResponse);
			assert.strictEqual(software, testCase.expected);
		}
	});

	test('应该计算检测可靠度', () => {
		const testResults = [
			{ command: 'FEAT', success: true },
			{ command: 'SYST', success: true },
			{ command: 'PASV', success: true },
			{ command: 'SIZE', success: false },
			{ command: 'MDTM', success: true }
		];

		const reliability = detector.calculateReliability(testResults);
    
		// 5个测试中4个成功，可靠度应该是0.8
		assert.strictEqual(reliability, 0.8);
	});

	test('应该提供能力建议', () => {
		const capabilities: FtpServerCapabilities = {
			supportsPASV: true,
			supportsEPSV: false,
			supportsREST: true,
			supportsSIZE: true,
			supportsMDTM: false,
			supportsModeZ: false,
			supportsMLSD: true,
			supportsSITE: false,
			supportsUTF8: true,
			supportsAPPE: true,
			maxConnections: 3,
			transferBufferSize: 32 * 1024,
			commandResponseTime: 200,
			serverSoftware: 'Old FTP Server',
			serverFeatures: ['PASV', 'REST', 'SIZE', 'MLSD', 'UTF8'],
			protocolVersion: 'FTP 1.0',
			detectionTime: Date.now(),
			detectionReliability: 0.75
		};

		const recommendations = detector.generateOptimizationRecommendations(capabilities);
    
		assert.ok(Array.isArray(recommendations));
		assert.ok(recommendations.length > 0);
    
		// 应该包含一些具体的建议
		const hasPerformanceAdvice = recommendations.some(r => 
			r.includes('缓冲区') || r.includes('连接') || r.includes('优化')
		);
		assert.ok(hasPerformanceAdvice);
	});
});