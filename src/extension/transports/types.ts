import type { BackendResponse, ProgressInfo } from '../../shared/types';
import type { TransportKind } from '../../shared/transport';
import type { MessageRouter } from '../MessageRouter';

export interface TransportRuntimeContext {
	readonly router: MessageRouter;
	readonly requestId?: string;
	getProgressCallback(): ((progress: ProgressInfo) => void) | undefined;
	setProgressCallback(callback?: (progress: ProgressInfo) => void): void;
	setActiveOperation(state: { type: string; startTime?: number; status?: 'queued' | 'running' | 'cancelled' }): void;
	getActiveOperation(): { type: string; startTime: number; status?: 'queued' | 'running' | 'cancelled' } | undefined;
	clearActiveOperation(): void;
	postMessage(message: any): void;
}

export interface TransportOperationDefinition {
	name: string;
	handler: (
		data: any,
		context: TransportRuntimeContext
	) => Promise<BackendResponse>;
	queue?: {
		type: string;
		manageActive?: boolean;
	};
}

export interface TransportAdapter {
	readonly kind: TransportKind;
	initialize?(router: MessageRouter): Promise<void> | void;
	getOperations(): TransportOperationDefinition[];
	dispose?(): Promise<void> | void;
	disconnect?(): Promise<void> | void;
	cancelOperation?(requestId: string, reason?: string): Promise<boolean> | boolean;
}
