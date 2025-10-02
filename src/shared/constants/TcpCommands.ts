/**
 * TCP 协议命令定义
 * 客户端和服务器端共享的命令码定义，确保协议一致性
 */

/**
 * TCP 命令码枚举
 * 与服务器端 server_script/tcp_server.py 中的定义保持完全一致
 */
export enum TcpCommand {
  // 连接管理命令（与 server_script/tcp_server.py 完全一致）
  PING = 0x01,          // 1
  PONG = 0x02,          // 2
  CONNECT = 0x03,       // 3
  DISCONNECT = 0x04,    // 4
  
  // 文件/目录管理命令
  LIST_FILES = 0x10,    // 16
  FILE_INFO = 0x11,     // 17
  CREATE_DIR = 0x12,    // 18
  DELETE_FILE = 0x13,   // 19
  RENAME_FILE = 0x14,   // 20
  
  // 文件传输命令（整体文件）
  UPLOAD_FILE = 0x20,   // 32
  DOWNLOAD_FILE = 0x21, // 33
  
  // 分块上传命令
  UPLOAD_REQ = 0x30,    // 48
  UPLOAD_DATA = 0x31,   // 49
  UPLOAD_END = 0x32,    // 50
  
  // 分块下载命令
  DOWNLOAD_REQ = 0x33,  // 51
  DOWNLOAD_DATA = 0x34, // 52
  DOWNLOAD_END = 0x35   // 53
}

/**
 * 命令名称映射表
 */
const tcpCommandNames: Record<TcpCommand, string> = {
	[TcpCommand.PING]: 'PING',
	[TcpCommand.PONG]: 'PONG',
	[TcpCommand.CONNECT]: 'CONNECT',
	[TcpCommand.DISCONNECT]: 'DISCONNECT',
	[TcpCommand.LIST_FILES]: 'LIST_FILES',
	[TcpCommand.FILE_INFO]: 'FILE_INFO',
	[TcpCommand.CREATE_DIR]: 'CREATE_DIR',
	[TcpCommand.DELETE_FILE]: 'DELETE_FILE',
	[TcpCommand.RENAME_FILE]: 'RENAME_FILE',
	[TcpCommand.UPLOAD_FILE]: 'UPLOAD_FILE',
	[TcpCommand.DOWNLOAD_FILE]: 'DOWNLOAD_FILE',
	[TcpCommand.UPLOAD_REQ]: 'UPLOAD_REQ',
	[TcpCommand.UPLOAD_DATA]: 'UPLOAD_DATA',
	[TcpCommand.UPLOAD_END]: 'UPLOAD_END',
	[TcpCommand.DOWNLOAD_REQ]: 'DOWNLOAD_REQ',
	[TcpCommand.DOWNLOAD_DATA]: 'DOWNLOAD_DATA',
	[TcpCommand.DOWNLOAD_END]: 'DOWNLOAD_END'
};

/**
 * 获取命令名称
 * @param command 命令码
 * @returns 命令名称
 */
export function getCommandName(command: TcpCommand): string {
	return tcpCommandNames[command] || `UNKNOWN(0x${command.toString(16).toUpperCase()})`;
}

/**
 * 检查命令是否有效
 * @param command 命令码
 * @returns 是否为有效命令
 */
