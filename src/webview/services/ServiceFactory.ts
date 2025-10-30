/**
 * 服务工厂 - 根据连接类型和环境创建对应的服务实例
 */

import { IConnectionService } from './interfaces/IConnectionService';
import { getDirectBridgeFactory, getRemoteBridgeFactory } from './bridge/registry';
// import { SerialConnectionService } from './serial/SerialConnectionService'; // 暂时注释掉串口功能
// import { UartBridgeService } from './bridge/UartBridgeService'; // 暂时注释掉串口功能
import {
	getTransportDefinitions,
	getTransportDefinition,
	isTransportSupported,
	type TransportKind
} from '@shared/transport';

export { getTransportDefinitions } from '@shared/transport';

export type ConnectionType = TransportKind;

// 检查是否在VSCode环境中
function isVSCodeEnvironment(): boolean {
	return typeof window !== 'undefined' && 
         (window as any).vscode !== undefined &&
         typeof (window as any).vscode.postMessage === 'function';
}

/**
 * 创建连接服务实例
 * @param type 连接类型
 * @param useDirectConnection 是否强制使用直连（通过Extension）
 * @returns 连接服务实例
 */
export function createConnectionService(
	type: ConnectionType, 
	useDirectConnection?: boolean
): IConnectionService {
	// 检查是否在VSCode环境中
	const inVSCode = isVSCodeEnvironment();
  
	// 决定是否使用直连（Extension）模式
	const shouldUseDirectConnection = useDirectConnection !== undefined 
		? useDirectConnection 
		: inVSCode; // 默认在VSCode环境中使用直连
  
	console.log(`[ServiceFactory] 创建服务: type=${type}, VSCode环境=${inVSCode}, 使用直连=${shouldUseDirectConnection}`);
  
	const directFactory = getDirectBridgeFactory(type);
	const remoteFactory = getRemoteBridgeFactory(type);

	if (!directFactory && !remoteFactory) {
		if (type === 'uart' || type === 'serial') {
			console.log('[ServiceFactory] 串口功能暂时不可用');
			throw new Error('串口功能暂时不可用');
		}
		throw new Error(`不支持的连接类型: ${type}`);
	}

	if (shouldUseDirectConnection && directFactory) {
		console.log(`[ServiceFactory] 使用 ${type.toUpperCase()} 桥接服务（Extension直连）`);
		return directFactory();
	}

	if (remoteFactory) {
		console.log(`[ServiceFactory] 使用 ${type.toUpperCase()} 远程服务`);
		return remoteFactory();
	}

	console.log(`[ServiceFactory] ${type.toUpperCase()} 仅支持直连模式，回退到桥接服务`);
	return directFactory!();
}

/**
 * 获取支持的连接类型列表
 */
export function getSupportedConnectionTypes(): ConnectionType[] {
	return getTransportDefinitions().map((definition) => definition.id as ConnectionType);
}

/**
 * 检查连接类型是否支持直连模式
 */
export function supportsDirectConnection(type: ConnectionType): boolean {
	return isTransportSupported(type);
}

/**
 * 获取连接类型的显示名称
 */
export function getConnectionTypeDisplayName(type: ConnectionType): string {
	const definition = getTransportDefinition(type);
	if (definition) {
		return definition.label;
	}

	return type.toUpperCase();
}

/**
 * 获取连接类型的默认端口
 */
export function getDefaultPort(type: ConnectionType): number | undefined {
	return getTransportDefinition(type)?.defaultPort;
}

export default {
	createConnectionService,
	getSupportedConnectionTypes,
	supportsDirectConnection,
	getConnectionTypeDisplayName,
	getDefaultPort
};
