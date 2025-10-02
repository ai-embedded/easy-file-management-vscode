import * as assert from 'assert';
import * as sinon from 'sinon';
import { FtpConnectionPool } from '../../../extension/ftp/connection/FtpConnectionPool';
import { FtpConfig } from '../../../shared/types';

suite('FTP Connection Pool Test Suite', () => {
	let connectionPool: FtpConnectionPool;
	let mockFtpConfig: FtpConfig;

	setup(() => {
		connectionPool = new FtpConnectionPool({ maxConnections: 3, idleTimeout: 5000 });
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
		connectionPool.destroyAll();
	});

	test('连接池应该初始化正确的默认参数', () => {
		const pool = new FtpConnectionPool();
		assert.strictEqual(pool.getMaxConnections(), 5);
		assert.strictEqual(pool.getActiveConnectionCount(), 0);
	});

	test('应该能创建新连接', async () => {
		const connection = await connectionPool.getConnection(mockFtpConfig);
		assert.ok(connection);
		assert.strictEqual(connectionPool.getActiveConnectionCount(), 1);
	});

	test('应该能复用现有连接', async () => {
		// 创建第一个连接
		const connection1 = await connectionPool.getConnection(mockFtpConfig);
		connectionPool.releaseConnection(connection1, mockFtpConfig);
    
		// 等待连接变为可复用状态
		await new Promise(resolve => setTimeout(resolve, 100));
    
		// 创建第二个连接应该复用第一个
		const connection2 = await connectionPool.getConnection(mockFtpConfig);
		assert.ok(connection2);
    
		// 由于复用，活动连接数应该为1
		assert.strictEqual(connectionPool.getActiveConnectionCount(), 1);
	});

	test('应该遵守最大连接数限制', async () => {
		const connections = [];
    
		// 创建最大数量的连接
		for (let i = 0; i < 3; i++) {
			const conn = await connectionPool.getConnection(mockFtpConfig);
			connections.push(conn);
		}
    
		assert.strictEqual(connectionPool.getActiveConnectionCount(), 3);
    
		// 尝试创建超过限制的连接应该等待或失败
		const startTime = Date.now();
		const timeoutPromise = new Promise<void>((resolve, reject) => {
			setTimeout(() => reject(new Error('Timeout')), 1000);
		});
    
		try {
			await Promise.race([
				connectionPool.getConnection(mockFtpConfig),
				timeoutPromise
			]);
			assert.fail('应该因为连接数限制而超时');
		} catch (error) {
			assert.ok(error.message.includes('Timeout'));
		}
	});

	test('应该清理空闲连接', async () => {
		const shortTimeoutPool = new FtpConnectionPool({ 
			maxConnections: 3, 
			idleTimeout: 100 
		});
    
		const connection = await shortTimeoutPool.getConnection(mockFtpConfig);
		shortTimeoutPool.releaseConnection(connection, mockFtpConfig);
    
		// 等待空闲超时
		await new Promise(resolve => setTimeout(resolve, 200));
    
		// 活动连接数应该为0，因为连接被清理了
		assert.strictEqual(shortTimeoutPool.getActiveConnectionCount(), 0);
    
		shortTimeoutPool.destroyAll();
	});

	test('应该处理连接健康检查', async () => {
		const connection = await connectionPool.getConnection(mockFtpConfig);
    
		// 模拟连接健康检查
		const isHealthy = await connectionPool.isConnectionHealthy(connection);
    
		// 默认情况下连接应该是健康的
		assert.strictEqual(isHealthy, true);
	});

	test('应该正确生成连接键', () => {
		const key1 = (connectionPool as any).getConnectionKey(mockFtpConfig);
		const key2 = (connectionPool as any).getConnectionKey({
			...mockFtpConfig,
			username: 'differentuser'
		});
    
		assert.notStrictEqual(key1, key2);
    
		const key3 = (connectionPool as any).getConnectionKey(mockFtpConfig);
		assert.strictEqual(key1, key3);
	});

	test('应该提供准确的连接池统计信息', async () => {
		const connection1 = await connectionPool.getConnection(mockFtpConfig);
		const connection2 = await connectionPool.getConnection(mockFtpConfig);
    
		const stats = connectionPool.getStats();
		assert.strictEqual(stats.active, 2);
		assert.strictEqual(stats.idle, 0);
		assert.strictEqual(stats.total, 2);
    
		connectionPool.releaseConnection(connection1, mockFtpConfig);
    
		const statsAfterRelease = connectionPool.getStats();
		assert.strictEqual(statsAfterRelease.active, 1);
		assert.strictEqual(statsAfterRelease.idle, 1);
	});

	test('应该能销毁所有连接', async () => {
		await connectionPool.getConnection(mockFtpConfig);
		await connectionPool.getConnection(mockFtpConfig);
    
		assert.strictEqual(connectionPool.getActiveConnectionCount(), 2);
    
		connectionPool.destroyAll();
    
		assert.strictEqual(connectionPool.getActiveConnectionCount(), 0);
	});

	test('应该处理连接错误', async () => {
		const badConfig = {
			...mockFtpConfig,
			host: 'nonexistent.invalid.domain',
			timeout: 1000 // 短超时以快速失败
		};
    
		try {
			await connectionPool.getConnection(badConfig);
			assert.fail('应该抛出连接错误');
		} catch (error) {
			assert.ok(error instanceof Error);
			assert.ok(error.message.length > 0);
		}
	});

	test('应该支持不同配置的连接隔离', async () => {
		const config2 = {
			...mockFtpConfig,
			host: 'another.example.com'
		};
    
		const connection1 = await connectionPool.getConnection(mockFtpConfig);
		const connection2 = await connectionPool.getConnection(config2);
    
		// 不同配置应该创建不同的连接
		assert.notStrictEqual(connection1, connection2);
		assert.strictEqual(connectionPool.getActiveConnectionCount(), 2);
	});
});
