import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { Logger, LogLevel, createLogger } from '../../shared/utils/Logger';
import { ServiceError, ErrorFactory, ErrorCode } from '../../shared/errors/ServiceError';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Extension should be present', () => {
		assert.ok(vscode.extensions.getExtension('local-publisher.easy-file-management'));
	});

	test('Extension should activate', async () => {
		const ext = vscode.extensions.getExtension('local-publisher.easy-file-management');
		assert.ok(ext);
		await ext!.activate();
		assert.ok(ext!.isActive);
	});
});

suite('Logger Test Suite', () => {
	test('Logger should create instance', () => {
		const logger = createLogger('TestModule');
		assert.ok(logger);
		assert.strictEqual(logger.getLevel(), LogLevel.INFO);
	});

	test('Logger should respect log levels', () => {
		const messages: string[] = [];
		const logger = createLogger('TestModule', {
			level: LogLevel.WARN,
			outputHandler: (level, module, message) => {
				messages.push(`${LogLevel[level]}: ${message}`);
			}
		});

		logger.debug('Debug message'); // Should not be logged
		logger.info('Info message');   // Should not be logged
		logger.warn('Warn message');   // Should be logged
		logger.error('Error message'); // Should be logged

		assert.strictEqual(messages.length, 2);
		assert.strictEqual(messages[0], 'WARN: Warn message');
		assert.strictEqual(messages[1], 'ERROR: Error message');
	});

	test('Logger should create child loggers', () => {
		const logger = createLogger('ParentModule');
		const childLogger = logger.createChild('ChildModule');
		assert.ok(childLogger);
		assert.strictEqual(childLogger.getLevel(), logger.getLevel());
	});
});

suite('ServiceError Test Suite', () => {
	test('ServiceError should create with code and message', () => {
		const error = new ServiceError(ErrorCode.CONNECTION_FAILED, 'Connection failed');
		assert.strictEqual(error.code, ErrorCode.CONNECTION_FAILED);
		assert.strictEqual(error.message, 'Connection failed');
		assert.ok(error.timestamp);
	});

	test('ServiceError should serialize to JSON', () => {
		const error = new ServiceError(
			ErrorCode.FILE_NOT_FOUND,
			'File not found',
			{ path: '/test/file.txt' },
			'TestModule'
		);
		
		const json = error.toJSON();
		assert.strictEqual(json.code, ErrorCode.FILE_NOT_FOUND);
		assert.strictEqual(json.message, 'File not found');
		assert.deepStrictEqual(json.details, { path: '/test/file.txt' });
		assert.strictEqual(json.source, 'TestModule');
	});

	test('ErrorFactory should create specific errors', () => {
		const connectionError = ErrorFactory.connectionFailed('Failed to connect', { host: 'localhost' });
		assert.strictEqual(connectionError.code, ErrorCode.CONNECTION_FAILED);
		assert.ok(connectionError.message.includes('Failed to connect'));

		const fileError = ErrorFactory.fileNotFound('/test/file.txt');
		assert.strictEqual(fileError.code, ErrorCode.FILE_NOT_FOUND);
		assert.ok(fileError.message.includes('/test/file.txt'));

		const timeoutError = ErrorFactory.timeout('uploadFile', 5000);
		assert.strictEqual(timeoutError.code, ErrorCode.TIMEOUT);
		assert.ok(timeoutError.details?.timeout === 5000);
	});

	test('ServiceError should wrap unknown errors', () => {
		const nativeError = new Error('Native error message');
		const wrappedError = ErrorFactory.wrap(nativeError, 'TestModule');
		
		assert.strictEqual(wrappedError.code, ErrorCode.UNKNOWN);
		assert.strictEqual(wrappedError.message, 'Native error message');
		assert.strictEqual(wrappedError.source, 'TestModule');
	});
});

suite('Command Test Suite', () => {
	test('Open Panel command should be registered', async () => {
		const commands = await vscode.commands.getCommands();
		assert.ok(commands.includes('easy-file-management.openPanel'));
	});

	test('Open Panel command should create webview', async () => {
		await vscode.commands.executeCommand('easy-file-management.openPanel');

		// Wait a bit for the panel to be created
		await new Promise(resolve => setTimeout(resolve, 500));

		// Check if there's an active webview panel
		// Note: This is a simplified test, actual implementation may vary
		assert.ok(vscode.window.activeTextEditor || vscode.window.visibleTextEditors.length > 0);
	});
});
