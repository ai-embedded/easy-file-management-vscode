import * as vscode from 'vscode';

import {
	BackendMessage,
	BackendResponse,
	ProgressInfo
} from '../shared/types';
import { validateCommand } from './validation/Schemas';
import { ServiceError, ErrorCode, ErrorFactory } from '../shared/errors/ServiceError';
import {
	RequestTracer,
	PerformanceMonitor,
	OperationType as PerfOperationType
} from '../shared/monitoring';
import { Logger } from '../shared/utils/Logger';
import type { TransportAdapter, TransportOperationDefinition, TransportRuntimeContext } from './transports/types';
import { createRegisteredTransportAdapters } from './transports/registry';
import type { TransportKind } from '../shared/transport';

/**
 * 命令处理器类型
 */
type CommandHandler = (data: unknown, requestId?: string) => Promise<BackendResponse>;

interface RegisteredOperation {
	adapter: TransportAdapter;
	definition: TransportOperationDefinition;
}

export class MessageRouter {
	private readonly logger: Logger = new Logger('Extension:MessageRouter');
	private readonly progressCallbacks = new Map<string, (progress: any) => void>();
	private readonly operationQueues = new Map<TransportKind, Promise<void>>();
	private readonly transportAdapters = new Map<TransportKind, TransportAdapter>();
	private readonly transportOperations = new Map<string, RegisteredOperation>();
	private webviewPanel?: vscode.WebviewPanel;
	private readonly commandHandlers: Map<string, CommandHandler> = new Map();
	private readonly requestTracer: RequestTracer;
	private readonly performanceMonitor: PerformanceMonitor;
	private readonly activeOperations: Map<string, { type: string; startTime: number; status?: 'queued' | 'running' | 'cancelled'; transport?: TransportKind }> = new Map();
	private readonly pendingTcpStateMessages: any[] = [];

	static getBackendCommandWhitelist(): string[] {
		const commands = new Set<string>();

		try {
			const adapters = createRegisteredTransportAdapters();
			for (const adapter of adapters) {
				for (const definition of adapter.getOperations()) {
					commands.add(`backend.${adapter.kind}.${definition.name}`);
				}
				adapter.dispose?.();
			}
		} catch (error) {
			console.warn('[MessageRouter] 构建命令白名单失败', error);
		}

		commands.add('backend.cancel.operation');
		commands.add('backend.cancel.all');
		commands.add('backend.operations.list');

		return Array.from(commands);
	}

	constructor() {
		this.requestTracer = new RequestTracer({
			enabled: true,
			autoInjectToLogs: true
		});

		this.performanceMonitor = new PerformanceMonitor({
			enabled: true,
			autoLog: true,
			logInterval: 60000
		});

		const adapters = createRegisteredTransportAdapters();

		for (const adapter of adapters) {
			this.registerTransportAdapter(adapter);
		}

		this.registerCommandHandlers();
		this.registerTcpStateForwarding();
	}

	private registerTransportAdapter(adapter: TransportAdapter): void {
		this.transportAdapters.set(adapter.kind, adapter);
		for (const definition of adapter.getOperations()) {
			const command = `backend.${adapter.kind}.${definition.name}`;
			this.transportOperations.set(command, { adapter, definition });
		}

		Promise.resolve(adapter.initialize?.(this)).catch((error) => {
			this.logger.error(`初始化传输适配器 ${adapter.kind} 失败`, error);
		});
	}

	private registerCommandHandlers(): void {
		for (const [command, entry] of this.transportOperations.entries()) {
			const wrapped: CommandHandler = (data: any, requestId?: string) => {
				const context = this.createRuntimeContext(entry.adapter.kind, requestId);
				const executor = () => entry.definition.handler(data, context);
				if (entry.definition.queue) {
					return this.enqueueOperation(
						entry.adapter.kind,
						entry.definition.queue.type,
						requestId,
						executor,
						{ manageActive: entry.definition.queue.manageActive }
					);
				}
				return executor();
			};

			this.registerCommand(command, wrapped);
		}

		this.registerCommand('backend.cancel.operation', (data) => this.handleCancelOperation(data));
		this.registerCommand('backend.cancel.all', () => this.handleCancelAllOperations());
		this.registerCommand('backend.operations.list', () => this.handleListActiveOperations());
	}

	private createRuntimeContext(transport: TransportKind, requestId?: string): TransportRuntimeContext {
		return {
			router: this,
			requestId,
			getProgressCallback: () => (requestId ? this.progressCallbacks.get(requestId) : undefined),
			setProgressCallback: (callback?: (progress: ProgressInfo) => void) => {
				if (!requestId) {return;}
				if (callback) {
					this.progressCallbacks.set(requestId, callback);
				} else {
					this.progressCallbacks.delete(requestId);
				}
			},
			setActiveOperation: (state) => {
				if (!requestId) {return;}
				this.activeOperations.set(requestId, {
					type: state.type,
					startTime: state.startTime ?? Date.now(),
					status: state.status,
					transport
				});
			},
			getActiveOperation: () => (requestId ? this.activeOperations.get(requestId) : undefined),
			clearActiveOperation: () => {
				if (!requestId) {return;}
				this.activeOperations.delete(requestId);
			},
			postMessage: (message: any) => {
				if (this.webviewPanel) {
					this.webviewPanel.webview.postMessage(message);
				}
			}
		};
	}

	private registerCommand(command: string, handler: CommandHandler): void {
		this.commandHandlers.set(command, this.withErrorHandling(handler, command));
	}

	private withErrorHandling(handler: CommandHandler, command: string): CommandHandler {
		return async (data: any, requestId?: string): Promise<BackendResponse> => {
			try {
				return await handler(data, requestId);
			} catch (error) {
				let serviceError: ServiceError;

				if (error instanceof ServiceError) {
					serviceError = error;
				} else if (error instanceof Error) {
					serviceError = ErrorFactory.unknown(error, 'Extension:MessageRouter', command);
				} else {
					serviceError = ErrorFactory.unknown(new Error(String(error)), 'Extension:MessageRouter', command);
				}

				this.logger.error(`[MessageRouter] 命令执行失败: ${command}`, serviceError);
				return {
					success: false,
					error: serviceError.message,
					errorCode: serviceError.code,
					errorDetails: serviceError.details,
					errorSource: serviceError.source
				};
			}
		};
	}

	/**
   * 设置Webview面板引用
   */
	setWebviewPanel(panel: vscode.WebviewPanel): void {
		this.webviewPanel = panel;
		if (this.pendingTcpStateMessages.length > 0) {
			for (const message of this.pendingTcpStateMessages.splice(0)) {
				this.webviewPanel.webview.postMessage(message);
			}
		}
	}

	async handleMessage(message: BackendMessage): Promise<BackendResponse> {
		const handler = this.commandHandlers.get(message.command);
		if (!handler) {
			return {
				success: false,
				error: `未知的命令: ${message.command}`
			};
		}

		const traceContext = this.requestTracer.startTrace(message.command, message.requestId);
		const perfOpType = this.mapCommandToOperationType(message.command);
		const perfOpId = this.performanceMonitor.startOperation(
			perfOpType,
			message.command,
			message.requestId,
			{ command: message.command, requestId: message.requestId }
		);

		try {
			this.requestTracer.addTag(traceContext, 'command', message.command);
			if (message.requestId) {
				this.requestTracer.addTag(traceContext, 'requestId', message.requestId);
			}

			console.log(`[MessageRouter] 处理命令: ${message.command} [trace=${traceContext.traceId}]`);

			if (message.requestId) {
				const reqId = message.requestId;
				this.progressCallbacks.set(reqId, (progress: any) => {
					if (this.webviewPanel) {
						const tracedProgress = this.requestTracer.inject(progress, traceContext);
						this.webviewPanel.webview.postMessage({
							command: 'backendProgress',
							requestId: reqId,
							progress: tracedProgress,
							traceId: traceContext.traceId
						});
					}
				});
			}

			const validation = validateCommand(message.command, message.data);
			if (!validation.ok) {
				const serviceError = ErrorFactory.invalidParameter('command_data', validation.error || '参数校验失败');
				this.performanceMonitor.endOperation(perfOpId, false, serviceError.message);
				this.requestTracer.endTrace(traceContext, serviceError);
				return {
					success: false,
					error: serviceError.message,
					errorCode: serviceError.code,
					errorDetails: serviceError.details,
					errorSource: serviceError.source
				};
			}

			const response = await handler(message.data, message.requestId);
			this.performanceMonitor.endOperation(perfOpId, response.success, response.message);
			this.requestTracer.endTrace(traceContext, response.success ? undefined : response);

			return response;
		} catch (error) {
			const serviceError = error instanceof ServiceError
				? error
				: ErrorFactory.unknown(error as Error, 'Extension:MessageRouter', message.command);

			this.performanceMonitor.endOperation(perfOpId, false, serviceError.message);
			this.requestTracer.endTrace(traceContext, serviceError);

			return {
				success: false,
				error: serviceError.message,
				errorCode: serviceError.code,
				errorDetails: serviceError.details,
				errorSource: serviceError.source
			};
		} finally {
			if (message.requestId) {
				this.progressCallbacks.delete(message.requestId);
			}
		}
	}

	private enqueueOperation<T>(
		transport: TransportKind,
		type: string,
		requestId: string | undefined,
		runner: () => Promise<T>,
		options: { manageActive?: boolean } = {}
	): Promise<T> {
		const manageActive = options.manageActive !== false;
		const operationLabel = `${type}${requestId ? ` [${requestId}]` : ''}`;
		const queueLabel = transport.toUpperCase();

		console.log(`[MessageRouter] ${operationLabel} 排队等待 (${queueLabel})`);

		const startQueuedAt = Date.now();
		if (manageActive && requestId) {
			this.activeOperations.set(requestId, {
				type,
				startTime: startQueuedAt,
				status: 'queued',
				transport
			});
		}

		const execute = async (): Promise<T> => {
			console.log(`[MessageRouter] ${operationLabel} 准备开始 (${queueLabel})`);
			if (manageActive && requestId) {
				const tracked = this.activeOperations.get(requestId);
				if (!tracked || tracked.status === 'cancelled') {
					console.log(`[MessageRouter] ${operationLabel} 在开始前已取消 (${queueLabel})`);
					this.activeOperations.delete(requestId);
					return { success: false, error: '操作已取消' } as unknown as T;
				}
				this.activeOperations.set(requestId, {
					type,
					startTime: Date.now(),
					status: 'running',
					transport
				});
			}
			try {
				const result = await runner();
				console.log(`[MessageRouter] ${operationLabel} 完成 (${queueLabel})`);
				return result;
			} catch (error) {
				console.error(`[MessageRouter] ${operationLabel} 失败 (${queueLabel}):`, error);
				throw error;
			} finally {
				if (manageActive && requestId) {
					this.activeOperations.delete(requestId);
				}
			}
		};

		const previousQueue = this.operationQueues.get(transport) ?? Promise.resolve();
		const chained = previousQueue.catch(() => undefined).then(execute);

		this.operationQueues.set(
			transport,
			chained.then(() => undefined).catch(() => undefined)
		);

		return chained;
	}

	private mapCommandToOperationType(command: string): PerfOperationType {
		if (command.includes('.connect')) {return PerfOperationType.CONNECT;}
		if (command.includes('.disconnect')) {return PerfOperationType.DISCONNECT;}
		if (command.includes('.list')) {return PerfOperationType.LIST;}
		if (command.includes('.upload')) {return PerfOperationType.UPLOAD;}
		if (command.includes('.download')) {return PerfOperationType.DOWNLOAD;}
		if (command.includes('.delete')) {return PerfOperationType.DELETE;}
		if (command.includes('.rename')) {return PerfOperationType.RENAME;}
		if (command.includes('.createDirectory') || command.includes('.createDir')) {return PerfOperationType.CREATE_DIR;}
		return PerfOperationType.CUSTOM;
	}

	async disconnectAll(): Promise<void> {
		console.log('[MessageRouter] 断开所有连接');
		await Promise.allSettled(
			Array.from(this.transportAdapters.values()).map((adapter) => adapter.disconnect?.())
		);
	}

	private registerTcpStateForwarding(): void {
		const tcpAdapter = this.transportAdapters.get('tcp') as unknown as { onConnectionStateChange?: (listener: any) => void } | undefined;
		if (!tcpAdapter?.onConnectionStateChange) {
			return;
		}

		tcpAdapter.onConnectionStateChange((event: any) => {
			const message = {
				command: 'tcp.connectionState',
				data: {
					state: event.to,
					previousState: event.from,
					reason: event.reason,
					timestamp: event.timestamp
				}
			};

			if (this.webviewPanel) {
				this.webviewPanel.webview.postMessage(message);
			} else {
				this.pendingTcpStateMessages.push(message);
			}
		});
	}

	private async handleCancelOperation(data: any): Promise<BackendResponse> {
		const operationId = data?.operationId;

		if (!operationId) {
			return { success: false, error: '操作ID不能为空' };
		}

		const operation = this.activeOperations.get(operationId);
		if (!operation) {
			return { success: false, error: '操作未找到或已完成' };
		}

		if (operation.status === 'queued') {
			operation.status = 'cancelled';
			console.log(`[MessageRouter] 操作排队阶段取消: ${operationId} (${operation.type})`);
			return {
				success: true,
				message: `操作 ${operation.type} 已取消`,
				data: { operationId, type: operation.type }
			};
		}

		const cancelled = await this.cancelOperationByAdapter(operation.transport, operationId);
		this.activeOperations.delete(operationId);
		this.progressCallbacks.delete(operationId);

		return {
			success: cancelled,
			message: cancelled ? `操作 ${operation.type} 已取消` : '无法取消该操作',
			data: { operationId, type: operation.type }
		};
	}

	private async cancelOperationByAdapter(transport: TransportKind | undefined, operationId: string): Promise<boolean> {
		if (!transport) {return false;}
		const adapter = this.transportAdapters.get(transport);
		if (!adapter?.cancelOperation) {return false;}
		try {
			return await adapter.cancelOperation(operationId);
		} catch (error) {
			this.logger.warn(`取消 ${transport} 操作失败`, error);
			return false;
		}
	}

	private async handleCancelAllOperations(): Promise<BackendResponse> {
		const operations = Array.from(this.activeOperations.entries());
		if (operations.length === 0) {
			return { success: true, message: '当前没有活动操作', data: { cancelledCount: 0 } };
		}

		let cancelledCount = 0;
		for (const [operationId, operation] of operations) {
			const cancelled = await this.cancelOperationByAdapter(operation.transport, operationId);
			if (cancelled) {
				cancelledCount += 1;
			}
			this.activeOperations.delete(operationId);
			this.progressCallbacks.delete(operationId);
		}

		return {
			success: true,
			message: `已取消 ${cancelledCount} 个操作`,
			data: { cancelledCount }
		};
	}

	private async handleListActiveOperations(): Promise<BackendResponse> {
		const operations = Array.from(this.activeOperations.entries()).map(([id, operation]) => ({
			operationId: id,
			type: operation.type,
			transport: operation.transport,
			startTime: operation.startTime,
			duration: Date.now() - operation.startTime,
			status: operation.status ?? 'running'
		}));

		return {
			success: true,
			data: {
				operations,
				count: operations.length
			}
		};
	}
}
