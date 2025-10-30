import type { TransportKind } from '@shared/transport';
import { FtpBridgeService } from './FtpBridgeService';
import { TcpBridgeService } from './TcpBridgeService';
import { HttpBridgeService } from './HttpBridgeService';
import { HttpConnectionService } from '../http/HttpConnectionService';
import type { IConnectionService } from '../interfaces/IConnectionService';

export type BridgeFactory = () => IConnectionService;

const directFactories: Partial<Record<TransportKind, BridgeFactory>> = {
	ftp: () => new FtpBridgeService(),
	tcp: () => new TcpBridgeService(),
	http: () => new HttpBridgeService()
};

const remoteFactories: Partial<Record<TransportKind, BridgeFactory>> = {
	http: () => new HttpConnectionService()
};

export function getDirectBridgeFactory(kind: TransportKind): BridgeFactory | undefined {
	return directFactories[kind];
}

export function getRemoteBridgeFactory(kind: TransportKind): BridgeFactory | undefined {
	return remoteFactories[kind];
}

export function getSupportedDirectBridgeKinds(): TransportKind[] {
	return Object.keys(directFactories) as TransportKind[];
}

export function getSupportedRemoteBridgeKinds(): TransportKind[] {
	return Object.keys(remoteFactories) as TransportKind[];
}
