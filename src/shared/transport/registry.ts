export type TransportKind = 'ftp' | 'tcp' | 'http' | 'uart' | 'serial';

export interface TransportCapabilities {
	streamUpload: boolean;
	streamDownload: boolean;
	directDownload: boolean;
}

export interface TransportDefinition {
	id: TransportKind;
	label: string;
	statusBarLabel: string;
	description?: string;
	defaultPort?: number;
	refreshSensitive?: boolean;
	capabilities: TransportCapabilities;
	postUploadRefreshDelay?: number;
}

const definitions: TransportDefinition[] = [
	{
		id: 'ftp',
		label: 'FTP',
		statusBarLabel: 'FTP',
		description: '通过 FTP/FTPS 进行文件管理',
		defaultPort: 21,
		refreshSensitive: true,
		postUploadRefreshDelay: 450,
		capabilities: {
			streamUpload: true,
			streamDownload: false,
			directDownload: true
		}
	},
	{
		id: 'tcp',
		label: 'TCP',
		statusBarLabel: 'TCP',
		description: '通过 TCP 协议进行文件管理',
		defaultPort: 8765,
		refreshSensitive: true,
		postUploadRefreshDelay: 450,
		capabilities: {
			streamUpload: true,
			streamDownload: true,
			directDownload: true
		}
	},
	{
		id: 'http',
		label: 'HTTP',
		statusBarLabel: 'HTTP',
		description: '通过 HTTP/HTTPS 服务传输文件',
		defaultPort: 8080,
		refreshSensitive: true,
		postUploadRefreshDelay: 900,
		capabilities: {
			streamUpload: true,
			streamDownload: true,
			directDownload: true
		}
	}
];

const definitionMap = new Map<TransportKind, TransportDefinition>();

definitions.forEach((definition) => definitionMap.set(definition.id, definition));

export function getTransportDefinitions(): TransportDefinition[] {
	return definitions.slice();
}

export function getTransportDefinition(kind: TransportKind): TransportDefinition | undefined {
	return definitionMap.get(kind);
}

export function isTransportSupported(kind: TransportKind): boolean {
	return definitionMap.has(kind);
}
