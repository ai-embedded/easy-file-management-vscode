import { getTransportDefinitions, type TransportKind } from '../../shared/transport';
import type { TransportAdapter } from './types';
import { FtpTransportAdapter } from './FtpTransportAdapter';
import { TcpTransportAdapter } from './TcpTransportAdapter';
import { HttpTransportAdapter } from './HttpTransportAdapter';

type AdapterFactory = () => TransportAdapter;

const adapterFactories: Partial<Record<TransportKind, AdapterFactory>> = {
	ftp: () => new FtpTransportAdapter(),
	tcp: () => new TcpTransportAdapter(),
	http: () => new HttpTransportAdapter()
};

export function createRegisteredTransportAdapters(): TransportAdapter[] {
	return getTransportDefinitions()
		.map((definition) => definition.id)
		.filter((kind): kind is keyof typeof adapterFactories => kind in adapterFactories)
		.map((kind) => {
			const factory = adapterFactories[kind];
			return factory!();
		});
}

export function getAdapterFactory(kind: TransportKind): AdapterFactory | undefined {
	return adapterFactories[kind];
}
