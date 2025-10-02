#!/usr/bin/env node
/**
 * 从 .proto 文件生成 TypeScript 代码
 */

const protobuf = require('protobufjs');
const fs = require('fs');
const path = require('path');

const PROTO_FILE = path.join(__dirname, '../proto/unified_file_protocol.proto');
const OUTPUT_DIR = path.join(__dirname, '../src/shared/proto');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'unified_file_protocol.ts');
const INDENT_CHAR = '\t';

const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

function escapeString(value) {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'");
}

function formatValue(value, depth = 0) {
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return '[]';
		}
		const indent = INDENT_CHAR.repeat(depth);
		const childIndent = INDENT_CHAR.repeat(depth + 1);
		const items = value.map(item => `${childIndent}${formatValue(item, depth + 1)}`);
		const itemsContent = items.join(',\n');
		return `[\n${itemsContent}\n${indent}]`;
	}

	if (value && typeof value === 'object') {
		const entries = Object.entries(value);
		if (entries.length === 0) {
			return '{}';
		}
		const indent = INDENT_CHAR.repeat(depth);
		const childIndent = INDENT_CHAR.repeat(depth + 1);
		const formattedEntries = entries.map(([key, val]) => {
			const formattedKey = IDENTIFIER_REGEX.test(key) ? key : `'${escapeString(key)}'`;
			return `${childIndent}${formattedKey}: ${formatValue(val, depth + 1)}`;
		});
		const entriesContent = formattedEntries.join(',\n');
		return `{\n${entriesContent}\n${indent}}`;
	}

	if (typeof value === 'string') {
		return `'${escapeString(value)}'`;
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	if (value === null) {
		return 'null';
	}

	throw new TypeError(`Unsupported descriptor value type: ${typeof value}`);
}

function convertSpacesToTabs(content) {
	return content.replace(/^( {2})+/gm, match => INDENT_CHAR.repeat(match.length / 2));
}

async function generateProtobufCode() {
  try {
    console.log('🔄 开始生成 Protobuf TypeScript 代码...');
    
    // 确保输出目录存在
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      console.log(`✅ 创建输出目录: ${OUTPUT_DIR}`);
    }
    
    // 加载 .proto 文件
    console.log(`📖 加载 Proto 文件: ${PROTO_FILE}`);
    // ⚠️ 重要：必须保持 keepCase=false（默认值），确保字段名转换为 camelCase
    // 这与运行时代码中的字段映射保持一致（snake_case -> camelCase）
    // 如果改为 keepCase=true，将导致字段名大小写不一致，引发运行时错误
    const root = await protobuf.load(PROTO_FILE);
    
	// 🔧 修复：生成静态 JSON descriptor，避免运行时路径问题
	console.log('📦 生成静态 JSON descriptor...');
	const descriptor = root.toJSON();
	const formattedDescriptor = formatValue(descriptor);
    
    // 生成 TypeScript 代码
    console.log('🔧 生成 TypeScript 代码...');
    
    // 获取消息类型
    const UnifiedRequest = root.lookupType('unified_file_protocol.UnifiedRequest');
    const UnifiedResponse = root.lookupType('unified_file_protocol.UnifiedResponse');
    const FileInfo = root.lookupType('unified_file_protocol.FileInfo');
    const ServerInfo = root.lookupType('unified_file_protocol.ServerInfo');
    
	// 生成 TypeScript 接口和编解码器
	const tsCode = `/**
 * 自动生成的 Protobuf TypeScript 代码
 * 生成时间: ${new Date().toISOString()}
 * 源文件: ${path.relative(process.cwd(), PROTO_FILE)}
 */

import * as protobuf from 'protobufjs';
import { Logger } from '../utils/Logger';

const logger = new Logger('ProtobufProtocol');

// 🔧 修复：静态 JSON descriptor，避免运行时路径依赖
const protoDescriptor = ${formattedDescriptor};

// 加载编译后的 protobuf 根对象
let protoRoot: protobuf.Root | null = null;

/**
 * 初始化 Protobuf 根对象 - 🔧 修复：使用静态 JSON descriptor
 */
export async function initializeProtobuf(): Promise<protobuf.Root> {
  if (!protoRoot) {
    protoRoot = protobuf.Root.fromJSON(protoDescriptor);
    logger.info('✅ 使用静态 JSON descriptor 初始化成功，避免路径依赖问题');
  }
  return protoRoot;
}

/**
 * 获取 Protobuf 根对象（同步）
 */
export function getProtobufRoot(): protobuf.Root {
  if (!protoRoot) {
    throw new Error('Protobuf 未初始化，请先调用 initializeProtobuf()');
  }
  return protoRoot;
}

// 操作枚举 - 与 .proto 文件保持同步
export enum Operation {
  UNKNOWN = 0,
  PING = 1,
  PONG = 2,
  CONNECT = 3,
  DISCONNECT = 4,
  LIST_FILES = 16,
  FILE_INFO = 17,
  CREATE_DIR = 18,
  DELETE_FILE = 19,
  RENAME_FILE = 20,
  UPLOAD_FILE = 32,
  DOWNLOAD_FILE = 33,
  UPLOAD_REQ = 48,
  UPLOAD_DATA = 49,
  UPLOAD_END = 50,
  DOWNLOAD_REQ = 51,
  DOWNLOAD_DATA = 52,
  DOWNLOAD_END = 53
}

// TypeScript 接口定义
export interface IUnifiedRequest {
  operation: Operation;
  path?: string;
  name?: string;
  data?: Uint8Array;
  newName?: string;
  /**
   * 选项参数映射
   * @important 所有值必须是字符串类型！布尔值和数字会被自动转换为字符串。
   * @example { recursive: 'true', filter: '*', count: '10' }
   */
  options?: { [key: string]: string };
  isChunk?: boolean;
  chunkIndex?: number;
  totalChunks?: number;
  chunkHash?: string;
  clientId?: string;
  version?: string;
  supportedFormats?: string[];
  filename?: string;
  fileSize?: string | number; // int64: 使用 string 保留精度，必要时转为 number
  checksum?: string;
  chunkSize?: number;
  preferredFormat?: string; // 新增：客户端首选编码格式
}

export interface IUnifiedResponse {
  success: boolean;
  message?: string;
  files?: IFileInfo[];
  data?: Uint8Array;
  isChunk?: boolean;
  chunkIndex?: number;
  totalChunks?: number;
  chunkHash?: string;
  processTimeMs?: string | number; // int64
  fileSize?: string | number; // int64
  progressPercent?: number;
  status?: string;
  selectedFormat?: string;
  supportedCommands?: string[];
  serverInfo?: IServerInfo;
  timestamp?: string | number; // int64
  sessionId?: string;
  acceptedChunkSize?: number;
}

export interface IFileInfo {
  name: string;
  path: string;
  type: string;
  size: string | number; // int64
  lastModified: string;
  permissions?: string;
  isReadonly?: boolean;
  mimeType?: string;
}

export interface IServerInfo {
  name: string;
  version: string;
  protocol: string;
  supportedFormats: string[];
  rootDir: string;
  maxFileSize?: string | number; // int64
  chunkSize?: number;
  concurrentOperations?: number;
}

/**
 * Protobuf 编解码器类
 */
export class ProtobufEncoder {
  private static requestType: protobuf.Type | null = null;
  private static responseType: protobuf.Type | null = null;
  
  /**
   * 初始化编码器
   */
  static async initialize(): Promise<void> {
    const root = await initializeProtobuf();
    this.requestType = root.lookupType('unified_file_protocol.UnifiedRequest');
    this.responseType = root.lookupType('unified_file_protocol.UnifiedResponse');
  }
  
  /**
   * 编码请求消息
   */
  static encodeRequest(request: IUnifiedRequest): Uint8Array {
    if (!this.requestType) {
      throw new Error('编码器未初始化，请先调用 initialize()');
    }
    
    // 转换字段名称（camelCase -> snake_case）
    const protoRequest = this.convertToProtoRequest(request);
    
    // 验证消息
    const errMsg = this.requestType.verify(protoRequest);
    if (errMsg) {
      throw new Error(\`请求消息验证失败: \${errMsg}\`);
    }
    
    // 编码为二进制
    const message = this.requestType.create(protoRequest);
    return this.requestType.encode(message).finish();
  }
  
  /**
   * 解码响应消息
   */
  static decodeResponse(buffer: Uint8Array): IUnifiedResponse {
    if (!this.responseType) {
      throw new Error('编码器未初始化，请先调用 initialize()');
    }
    
    // 解码二进制数据
    const message = this.responseType.decode(buffer);
    const obj = this.responseType.toObject(message, {
      longs: String, // 使用字符串避免大数精度丢失
      enums: Number, // 🔧 修复：改为数字枚举，避免与内部数字枚举不一致
      bytes: Uint8Array, // 统一使用 Uint8Array，便于跨环境和测试一致
      defaults: true,
      arrays: true,
      objects: true,
      oneofs: true
    });
    
    // 转换字段名称（snake_case -> camelCase）
    return this.convertFromProtoResponse(obj);
  }
  
  /**
   * 编码响应消息（用于测试）
   */
  static encodeResponse(response: IUnifiedResponse): Uint8Array {
    if (!this.responseType) {
      throw new Error('编码器未初始化，请先调用 initialize()');
    }
    
    const protoResponse = this.convertToProtoResponse(response);
    const errMsg = this.responseType.verify(protoResponse);
    if (errMsg) {
      throw new Error(\`响应消息验证失败: \${errMsg}\`);
    }
    
    const message = this.responseType.create(protoResponse);
    return this.responseType.encode(message).finish();
  }
  
  /**
   * 解码请求消息（用于测试）
   */
  static decodeRequest(buffer: Uint8Array): IUnifiedRequest {
    if (!this.requestType) {
      throw new Error('编码器未初始化，请先调用 initialize()');
    }
    
    const message = this.requestType.decode(buffer);
    const obj = this.requestType.toObject(message, {
      longs: String, // 使用字符串避免大数精度丢失
      enums: Number, // 🔧 修复：改为数字枚举，避免与内部数字枚举不一致
      bytes: Uint8Array, // 统一使用 Uint8Array，便于跨环境和测试一致
      defaults: true,
      arrays: true,
      objects: true,
      oneofs: true
    });
    
    return this.convertFromProtoRequest(obj);
  }
  
  /**
   * 转换 TypeScript 请求对象为 Proto 格式
   */
  private static convertToProtoRequest(request: IUnifiedRequest): any {
    const proto: any = { operation: request.operation };
    // 与 descriptor（camelCase 字段）严格对齐
    if (request.path) {
      proto.path = request.path;
    }
    if (request.name) {
      proto.name = request.name;
    }
    if (request.data) {
      proto.data = request.data;
    }
    if (request.newName) {
      proto.newName = request.newName;
    }
    // 自动转换 options 中的值为字符串类型
    if (request.options) {
      const convertedOptions: { [key: string]: string } = {};
      for (const [key, value] of Object.entries(request.options)) {
        convertedOptions[key] = String(value);
        // 如果有非字符串值，记录警告
        if (typeof value !== 'string') {
          logger.warn(\`⚠️ 自动转换 options.\${key} 从 \${typeof value} 类型为字符串: \${value} -> "\${String(value)}"\`);
        }
      }
      proto.options = convertedOptions;
    }
    // ✅ 修复P0问题：使用显式 undefined 判断，确保 false 值也能正确传输
    if (request.isChunk !== undefined) {
      proto.isChunk = request.isChunk;
    }
    if (request.chunkIndex !== undefined) {
      proto.chunkIndex = request.chunkIndex;
    }
    if (request.totalChunks !== undefined) {
      proto.totalChunks = request.totalChunks;
    }
    if (request.chunkHash) {
      proto.chunkHash = request.chunkHash;
    }
    if (request.clientId) {
      proto.clientId = request.clientId;
    }
    if (request.version) {
      proto.version = request.version;
    }
    if (request.supportedFormats) {
      proto.supportedFormats = request.supportedFormats;
    }
    if (request.filename) {
      proto.filename = request.filename;
    }
    if (request.fileSize !== undefined) {
      proto.fileSize = request.fileSize;
    }
    if (request.checksum) {
      proto.checksum = request.checksum;
    }
    if (request.chunkSize !== undefined) {
      proto.chunkSize = request.chunkSize;
    }
    if (request.preferredFormat) {
      proto.preferredFormat = request.preferredFormat;
    }
    return proto;
  }
  
  /**
   * 转换 Proto 请求对象为 TypeScript 格式
   */
  private static convertFromProtoRequest(proto: any): IUnifiedRequest {
    const request: IUnifiedRequest = { operation: proto.operation || Operation.UNKNOWN };
    if (proto.path) {
      request.path = proto.path;
    }
    if (proto.name) {
      request.name = proto.name;
    }
    if (proto.data) {
      if (Buffer.isBuffer(proto.data)) {
        // ✅ 优化：直接使用 Buffer，避免不必要的复制
        // Buffer 继承自 Uint8Array，可以直接使用
        request.data = proto.data;
        logger.debug('🚀 数据优化: 直接使用 Buffer，避免复制');
      } else if (proto.data instanceof Uint8Array) {
        request.data = proto.data;
      } else {
        request.data = new Uint8Array(proto.data);
      }
    }
    if (proto.newName) {
      request.newName = proto.newName;
    }
    if (proto.options) {
      request.options = proto.options;
    }
    // ✅ 修复P0问题：使用显式 undefined 判断，确保 false 值也能正确传输
    if (proto.isChunk !== undefined) {
      request.isChunk = proto.isChunk;
    }
    if (proto.chunkIndex !== undefined) {
      request.chunkIndex = proto.chunkIndex;
    }
    if (proto.totalChunks !== undefined) {
      request.totalChunks = proto.totalChunks;
    }
    if (proto.chunkHash) {
      request.chunkHash = proto.chunkHash;
    }
    if (proto.clientId) {
      request.clientId = proto.clientId;
    }
    if (proto.version) {
      request.version = proto.version;
    }
    if (proto.supportedFormats) {
      request.supportedFormats = proto.supportedFormats;
    }
    if (proto.filename) {
      request.filename = proto.filename;
    }
    if (proto.fileSize !== undefined) {
      request.fileSize = this.#coerceLong(proto.fileSize);
    }
    if (proto.checksum) {
      request.checksum = proto.checksum;
    }
    if (proto.chunkSize !== undefined) {
      request.chunkSize = proto.chunkSize;
    }
    if (proto.preferredFormat) {
      request.preferredFormat = proto.preferredFormat;
    }
    return request;
  }
  
  /**
   * 转换 TypeScript 响应对象为 Proto 格式
   */
  private static convertToProtoResponse(response: IUnifiedResponse): any {
    const proto: any = {
      success: response.success
    };
    
    if (response.message) {
      proto.message = response.message;
    }
    if (response.files) {
      proto.files = response.files.map(file => ({
        name: file.name,
        path: file.path,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        permissions: file.permissions,
        isReadonly: file.isReadonly,
        mimeType: file.mimeType
      }));
    }
    if (response.data) {
      proto.data = response.data;
    }
    // 🔧 修复：统一使用 camelCase 字段名，与 descriptor 保持一致
    // ✅ 修复P0问题：使用显式 undefined 判断，确保 false 值也能正确传输
    if (response.isChunk !== undefined) {
      proto.isChunk = response.isChunk;
    }
    if (response.chunkIndex !== undefined) {
      proto.chunkIndex = response.chunkIndex;
    }
    if (response.totalChunks !== undefined) {
      proto.totalChunks = response.totalChunks;
    }
    if (response.chunkHash) {
      proto.chunkHash = response.chunkHash;
    }
    if (response.processTimeMs !== undefined) {
      proto.processTimeMs = response.processTimeMs;
    }
    if (response.fileSize !== undefined) {
      proto.fileSize = response.fileSize;
    }
    // 🔧 修复：统一使用 camelCase 字段名，与 descriptor 保持一致
    if (response.progressPercent !== undefined) {
      proto.progressPercent = response.progressPercent;
    }
    if (response.status) {
      proto.status = response.status;
    }
    if (response.selectedFormat) {
      proto.selectedFormat = response.selectedFormat;
    }
    if (response.supportedCommands) {
      proto.supportedCommands = response.supportedCommands;
    }
    if (response.timestamp !== undefined) {
      proto.timestamp = response.timestamp;
    }
    if (response.sessionId) {
      proto.sessionId = response.sessionId;
    }
    if (response.acceptedChunkSize !== undefined) {
      proto.acceptedChunkSize = response.acceptedChunkSize;
    }
    
    if (response.serverInfo) {
      proto.serverInfo = {
        name: response.serverInfo.name,
        version: response.serverInfo.version,
        protocol: response.serverInfo.protocol,
        supportedFormats: response.serverInfo.supportedFormats,
        rootDir: response.serverInfo.rootDir,
        maxFileSize: response.serverInfo.maxFileSize,
        chunkSize: response.serverInfo.chunkSize,
        concurrentOperations: response.serverInfo.concurrentOperations
      };
    }
    
    return proto;
  }
  
  /**
   * 转换 Proto 响应对象为 TypeScript 格式
   */
  private static convertFromProtoResponse(proto: any): IUnifiedResponse {
    const response: IUnifiedResponse = {
      success: proto.success || false
    };
    
    if (proto.message) {
      response.message = proto.message;
    }
    if (proto.files) {
      response.files = proto.files.map((file: any) => ({
        name: file.name || '',
        path: file.path || '',
        type: file.type || '',
        size: this.#coerceLong(file.size) ?? 0,
        lastModified: file.lastModified || '',
        permissions: file.permissions,
        isReadonly: file.isReadonly || false,
        mimeType: file.mimeType
      }));
    }
    if (proto.data) {
      if (Buffer.isBuffer(proto.data)) {
        // ✅ 优化：直接使用 Buffer，避免不必要的复制
        // Buffer 继承自 Uint8Array，可以直接使用
        response.data = proto.data;
        logger.debug('🚀 响应数据优化: 直接使用 Buffer，避免复制');
      } else if (proto.data instanceof Uint8Array) {
        response.data = proto.data;
      } else {
        response.data = new Uint8Array(proto.data);
      }
    }
    // 🔧 修复：统一使用 camelCase 字段名，与 descriptor 保持一致
    // ✅ 修复P0问题：使用显式 undefined 判断，确保 false 值也能正确传输
    if (proto.isChunk !== undefined) {
      response.isChunk = proto.isChunk;
    }
    if (proto.chunkIndex !== undefined) {
      response.chunkIndex = proto.chunkIndex;
    }
    if (proto.totalChunks !== undefined) {
      response.totalChunks = proto.totalChunks;
    }
    if (proto.chunkHash) {
      response.chunkHash = proto.chunkHash;
    }
    if (proto.processTimeMs !== undefined) {
      response.processTimeMs = this.#coerceLong(proto.processTimeMs);
    }
    if (proto.fileSize !== undefined) {
      response.fileSize = this.#coerceLong(proto.fileSize);
    }
    // 🔧 修复：统一使用 camelCase 字段名，与 descriptor 保持一致
    if (proto.progressPercent !== undefined) {
      response.progressPercent = proto.progressPercent;
    }
    if (proto.status) {
      response.status = proto.status;
    }
    if (proto.selectedFormat) {
      response.selectedFormat = proto.selectedFormat;
    }
    if (proto.supportedCommands) {
      response.supportedCommands = proto.supportedCommands;
    }
    if (proto.timestamp !== undefined) {
      response.timestamp = this.#coerceLong(proto.timestamp);
    }
    if (proto.sessionId) {
      response.sessionId = proto.sessionId;
    }
    if (proto.acceptedChunkSize !== undefined) {
      response.acceptedChunkSize = proto.acceptedChunkSize;
    }
    
    if (proto.serverInfo) {
      response.serverInfo = {
        name: proto.serverInfo.name || '',
        version: proto.serverInfo.version || '',
        protocol: proto.serverInfo.protocol || '',
        supportedFormats: proto.serverInfo.supportedFormats || [],
        rootDir: proto.serverInfo.rootDir || '',
        maxFileSize: this.#coerceLong(proto.serverInfo.maxFileSize),
        chunkSize: proto.serverInfo.chunkSize,
        concurrentOperations: proto.serverInfo.concurrentOperations
      };
    }
    
    return response;
  }

  // 将字符串 long 在安全范围内转为 number，否则保留为 string
  static #coerceLong(value: any): string | number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const num = Number(value);
      const MAX_SAFE = Number.MAX_SAFE_INTEGER;
      if (!Number.isNaN(num) && Number.isFinite(num) && Math.abs(num) <= MAX_SAFE) {
        return num;
      }
      return value;
    }
    return value;
  }
}

// 导出便捷函数
export const encodeRequest = (request: IUnifiedRequest): Uint8Array => {
  return ProtobufEncoder.encodeRequest(request);
};

export const decodeResponse = (buffer: Uint8Array): IUnifiedResponse => {
  return ProtobufEncoder.decodeResponse(buffer);
};

export const encodeResponse = (response: IUnifiedResponse): Uint8Array => {
  return ProtobufEncoder.encodeResponse(response);
};

export const decodeRequest = (buffer: Uint8Array): IUnifiedRequest => {
  return ProtobufEncoder.decodeRequest(buffer);
};

// 初始化函数
export const initialize = (): Promise<void> => {
  return ProtobufEncoder.initialize();
};
`;
    
	// 写入生成的代码
	const finalTsCode = `${convertSpacesToTabs(tsCode)}\n`;
	fs.writeFileSync(OUTPUT_FILE, finalTsCode, 'utf8');
    
    console.log(`✅ 成功生成 TypeScript 代码: ${OUTPUT_FILE}`);
    console.log('📊 生成的内容包括:');
    console.log('  - TypeScript 接口定义');
    console.log('  - 操作枚举');
    console.log('  - Protobuf 编解码器');
    console.log('  - 字段名称转换（统一 camelCase）');
    console.log('  - 类型验证和错误处理');
    
    // 🔧 修复：添加一致性检查，避免代码风格漂移
	if (process.env.CI || process.argv.includes('--check')) {
		console.log('🔍 执行一致性检查...');
		const existingCode = fs.readFileSync(OUTPUT_FILE, 'utf8');
		if (existingCode !== finalTsCode) {
        console.error('❌ 检查失败：生成的代码与现有代码不一致！');
        console.error('💡 解决方案：运行 npm run generate-proto 更新代码');
        process.exit(1);
      } else {
        console.log('✅ 一致性检查通过：生成代码与现有代码完全一致');
      }
    }
    
  } catch (error) {
    console.error('❌ 生成 Protobuf 代码失败:', error);
    process.exit(1);
  }
}

// 运行生成脚本
if (require.main === module) {
  generateProtobufCode().catch(console.error);
}

module.exports = { generateProtobufCode };
