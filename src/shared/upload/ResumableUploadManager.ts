/**
 * 断点续传管理器
 * 支持大文件上传的中断恢复
 */

import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { setImmediate as setImmediateAsync } from 'timers/promises';
import { Logger } from '../utils/Logger';
import {
	UploadSession,
	ResumableUploadConfig,
	ChunkUploadStatus,
	ResumableUploadProgress
} from './types';

const logger = new Logger('ResumableUploadManager');

/**
 * 断点续传管理器
 */
export class ResumableUploadManager extends EventEmitter {
	private config: Required<ResumableUploadConfig>;
	private sessions: Map<string, UploadSession> = new Map();
	private sessionStorePath: string;
	private cleanupTimer?: NodeJS.Timeout;
	private sessionPersistQueue: Promise<void> = Promise.resolve();

	constructor(config: ResumableUploadConfig = {}) {
		super();
    
		// 初始化配置
		this.config = {
			sessionStorePath: config.sessionStorePath || path.join(process.cwd(), '.upload-sessions'),
			sessionExpireTime: config.sessionExpireTime || 24 * 60 * 60 * 1000, // 24小时
			enabled: config.enabled !== false,
			maxRetries: config.maxRetries || 3,
			retryDelay: config.retryDelay || 1000,
			enableLogging: config.enableLogging !== false
		};
    
		this.sessionStorePath = this.config.sessionStorePath;
    
		// 初始化会话存储目录
		if (this.config.enabled) {
			this.initializeSessionStore();
			this.loadSessions();
			this.startCleanupTimer();
		}
    
		logger.info('🚀 断点续传管理器已初始化', {
			enabled: this.config.enabled,
			sessionStorePath: this.sessionStorePath,
			expireTime: `${this.config.sessionExpireTime / 1000 / 60 / 60}小时`
		});
	}
  
	/**
   * 创建或恢复上传会话
   */
	async createOrResumeSession(
		filePath: string,
		targetPath: string,
		filename: string,
		fileBuffer: Buffer,
		chunkSize: number,
		options: { persist?: boolean } = {}
	): Promise<UploadSession> {
		const shouldPersist = this.config.enabled && options.persist !== false;

		if (!shouldPersist) {
			return this.createEphemeralSession(filePath, targetPath, filename, fileBuffer, chunkSize);
		}
	    
	    // 计算文件 hash 作为会话ID
		const hashStart = Date.now();
		const fileHash = await this.calculateFileHash(fileBuffer);
		const hashDuration = Date.now() - hashStart;
		logger.debug('📑 文件哈希准备完成', {
			filename,
			fileSize: fileBuffer.length,
			sessionHash: fileHash,
			hashDuration
		});
		const sessionId = `${fileHash}_${filename}`;
    
		// 检查是否有现有会话
		let session = this.sessions.get(sessionId);

		if (session && !this.isSessionExpired(session)) {
			if (session.chunkSize !== chunkSize) {
				logger.info('⚠️ 检测到会话块大小变更，重新创建上传会话', {
					sessionId,
					storedChunkSize: session.chunkSize,
					requestedChunkSize: chunkSize
				});
				this.deleteSession(sessionId);
				session = undefined;
			}
		}

		if (session && !this.isSessionExpired(session)) {
			// 验证文件内容是否一致
			if (session.fileHash === fileHash && session.fileSize === fileBuffer.length) {
				logger.info(`♻️ 恢复上传会话: ${sessionId}`, {
					uploadedChunks: session.uploadedChunks.length,
					totalChunks: session.totalChunks,
					progress: `${((session.uploadedChunks.length / session.totalChunks) * 100).toFixed(1)}%`
				});
        
				// 更新会话时间
				session.lastUpdatedAt = Date.now();
				session.expiresAt = Date.now() + this.config.sessionExpireTime;
				this.saveSession(session, 'resume');
        
				this.emit('session-resumed', session);
				return session;
			} else {
				// 文件内容变化，删除旧会话
				logger.warn(`⚠️ 文件内容已变化，删除旧会话: ${sessionId}`);
				this.deleteSession(sessionId);
			}
		}
    
		// 创建新会话
		const totalChunks = Math.ceil(fileBuffer.length / chunkSize);
		const newSession: UploadSession = {
			sessionId,
			filePath,
			targetPath,
			filename,
			fileSize: fileBuffer.length,
			chunkSize,
			totalChunks,
			uploadedChunks: [],
			fileHash,
			createdAt: Date.now(),
			lastUpdatedAt: Date.now(),
			expiresAt: Date.now() + this.config.sessionExpireTime
		};
    
		this.sessions.set(sessionId, newSession);
		this.saveSession(newSession, 'create');
    
		logger.info(`📝 创建新上传会话: ${sessionId}`, {
			fileSize: fileBuffer.length,
			chunkSize,
			totalChunks
		});
    
		this.emit('session-created', newSession);
		return newSession;
	}
  
	/**
   * 标记块已上传
   */
	markChunkUploaded(sessionId: string, chunkIndex: number): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			logger.warn(`⚠️ 会话不存在: ${sessionId}`);
			return;
		}
    
		if (!session.uploadedChunks.includes(chunkIndex)) {
			session.uploadedChunks.push(chunkIndex);
			session.uploadedChunks.sort((a, b) => a - b); // 保持有序
			session.lastUpdatedAt = Date.now();
      
			if (this.config.enabled) {
				this.saveSession(session, 'chunk');
			}
      
			const progress = this.getProgress(sessionId);
			logger.debug(`✅ 块 ${chunkIndex} 已上传`, {
				sessionId,
				progress: `${progress.percent.toFixed(1)}%`,
				uploaded: `${progress.uploadedChunks}/${progress.totalChunks}`
			});
      
			this.emit('chunk-uploaded', { sessionId, chunkIndex, progress });
		}
	}
  
	/**
   * 获取下一个需要上传的块索引
   */
	getNextChunkToUpload(sessionId: string): number | null {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return null;
		}
    
		// 找到第一个未上传的块
		for (let i = 0; i < session.totalChunks; i++) {
			if (!session.uploadedChunks.includes(i)) {
				return i;
			}
		}
    
		return null; // 所有块已上传
	}
  
	/**
   * 获取需要上传的块列表
   */
	getPendingChunks(sessionId: string): number[] {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return [];
		}
    
		const pendingChunks: number[] = [];
		for (let i = 0; i < session.totalChunks; i++) {
			if (!session.uploadedChunks.includes(i)) {
				pendingChunks.push(i);
			}
		}
    
		return pendingChunks;
	}
  
	/**
   * 获取上传进度
   */
	getProgress(sessionId: string): ResumableUploadProgress {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return {
				totalBytes: 0,
				uploadedBytes: 0,
				percent: 0,
				totalChunks: 0,
				uploadedChunks: 0,
				remainingChunks: 0
			};
		}
    
		const uploadedChunks = session.uploadedChunks.length;
		const uploadedBytes = Math.min(
			uploadedChunks * session.chunkSize,
			session.fileSize
		);
    
		return {
			totalBytes: session.fileSize,
			uploadedBytes,
			percent: (uploadedChunks / session.totalChunks) * 100,
			totalChunks: session.totalChunks,
			uploadedChunks,
			remainingChunks: session.totalChunks - uploadedChunks
		};
	}
  
	/**
   * 检查上传是否完成
   */
	isUploadComplete(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return false;
		}
    
		return session.uploadedChunks.length === session.totalChunks;
	}
  
	/**
   * 完成上传会话
   */
	completeSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}
    
		logger.info(`🎉 上传会话完成: ${sessionId}`, {
			fileSize: session.fileSize,
			totalChunks: session.totalChunks,
			duration: `${((Date.now() - session.createdAt) / 1000).toFixed(1)}秒`
		});
    
		this.emit('session-completed', session);
		this.deleteSession(sessionId);
	}
  
	/**
   * 删除会话
   */
	deleteSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}

		this.sessions.delete(sessionId);

		if (this.config.enabled) {
			const sessionFile = this.getSessionFilePath(sessionId);
			this.queueSessionWrite(async () => {
				try {
					await fsPromises.unlink(sessionFile);
					logger.debug(`🗑️ 删除会话文件: ${sessionFile}`);
				} catch (error: any) {
					if (error?.code !== 'ENOENT') {
						logger.error(`删除会话文件失败: ${sessionFile}`, error);
					}
				}
			});
		}

		this.emit('session-deleted', sessionId);
	}
  
	/**
   * 清理过期会话
   */
	cleanupExpiredSessions(): void {
		const now = Date.now();
		let cleanedCount = 0;
    
		for (const [sessionId, session] of this.sessions.entries()) {
			if (this.isSessionExpired(session)) {
				logger.info(`🧹 清理过期会话: ${sessionId}`);
				this.deleteSession(sessionId);
				cleanedCount++;
			}
		}
    
		if (cleanedCount > 0) {
			logger.info(`🧹 清理了 ${cleanedCount} 个过期会话`);
		}
	}
  
	/**
	 * 获取所有活动会话
	 */
	getActiveSessions(): UploadSession[] {
		return Array.from(this.sessions.values()).filter(
			session => !this.isSessionExpired(session)
		);
	}

	/**
	 * 当前是否开启持久化会话能力
	 */
	isPersistenceEnabled(): boolean {
		return this.config.enabled;
	}
  
	/**
   * 销毁管理器
   */
	destroy(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}
    
		// 保存所有会话
		for (const session of this.sessions.values()) {
			this.saveSession(session, 'cleanup');
		}
    
		this.sessions.clear();
		this.removeAllListeners();
    
		logger.info('🛑 断点续传管理器已销毁');
	}
  
	// === 私有方法 ===
  
	/**
   * 初始化会话存储目录
   */
	private initializeSessionStore(): void {
		if (!fs.existsSync(this.sessionStorePath)) {
			fs.mkdirSync(this.sessionStorePath, { recursive: true });
			logger.info(`📁 创建会话存储目录: ${this.sessionStorePath}`);
		}
	}
  
	/**
   * 加载已保存的会话
   */
	private loadSessions(): void {
		if (!fs.existsSync(this.sessionStorePath)) {
			return;
		}
    
		const files = fs.readdirSync(this.sessionStorePath);
		let loadedCount = 0;
    
		for (const file of files) {
			if (file.endsWith('.json')) {
				try {
					const filePath = path.join(this.sessionStorePath, file);
					const content = fs.readFileSync(filePath, 'utf8');
					const session = JSON.parse(content) as UploadSession;
          
					if (!this.isSessionExpired(session)) {
						this.sessions.set(session.sessionId, session);
						loadedCount++;
					} else {
						// 删除过期的会话文件
						fs.unlinkSync(filePath);
					}
				} catch (error) {
					logger.error(`加载会话文件失败: ${file}`, error);
				}
			}
		}
    
		if (loadedCount > 0) {
			logger.info(`📂 加载了 ${loadedCount} 个会话`);
		}
	}
  
	/**
   * 保存会话到文件
   */
	private saveSession(session: UploadSession, reason: 'create' | 'resume' | 'chunk' | 'cleanup' = 'chunk'): void {
		if (!this.config.enabled) {
			return;
		}

		const filePath = this.getSessionFilePath(session.sessionId);
		const payload = JSON.stringify(session, null, 2);

		this.queueSessionWrite(async () => {
			const persistStart = Date.now();
			try {
				await fsPromises.writeFile(filePath, payload, 'utf8');
				logger.debug(`💾 保存会话: ${session.sessionId}`, {
					reason,
					size: payload.length,
					persistDuration: Date.now() - persistStart
				});
			} catch (error) {
				logger.error(`保存会话失败: ${session.sessionId}`, error);
			}
		});
	}
  
	/**
   * 获取会话文件路径
   */
	private getSessionFilePath(sessionId: string): string {
		// 清理文件名中的特殊字符
		const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
		return path.join(this.sessionStorePath, `${safeId}.json`);
	}
  
	/**
   * 检查会话是否过期
   */
	private isSessionExpired(session: UploadSession): boolean {
		return Date.now() > session.expiresAt;
	}
  
	/**
   * 计算文件 hash
   */
	private async calculateFileHash(buffer: Buffer): Promise<string> {
		const hash = crypto.createHash('sha256');
		const step = 1024 * 1024 * 2; // 2MB步长减轻事件循环压力
		for (let offset = 0; offset < buffer.length; offset += step) {
			hash.update(buffer.subarray(offset, Math.min(buffer.length, offset + step)));
			if ((offset / step) % 8 === 7) {
				await setImmediateAsync();
			}
		}
		return hash.digest('hex').substring(0, 16);
	}
  
	/**
   * 创建临时会话（不持久化）
   */
	private async createTemporarySession(
		filePath: string,
		targetPath: string,
		filename: string,
		fileBuffer: Buffer,
		chunkSize: number
	): Promise<UploadSession> {
		const fileHash = await this.calculateFileHash(fileBuffer);
		const sessionId = `temp_${fileHash}_${Date.now()}`;
		return this.buildSessionDescriptor(
			sessionId,
			filePath,
			targetPath,
			filename,
			fileBuffer.length,
			chunkSize,
			fileHash
		);
	}

	private async createEphemeralSession(
		filePath: string,
		targetPath: string,
		filename: string,
		fileBuffer: Buffer,
		chunkSize: number
	): Promise<UploadSession> {
		const sessionId = `ephemeral_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		logger.debug('🕒 使用临时上传会话', {
			filename,
			fileSize: fileBuffer.length,
			chunkSize,
			sessionId
		});
		return this.buildSessionDescriptor(
			sessionId,
			filePath,
			targetPath,
			filename,
			fileBuffer.length,
			chunkSize,
			'ephemeral'
		);
	}

	private buildSessionDescriptor(
		sessionId: string,
		filePath: string,
		targetPath: string,
		filename: string,
		fileSize: number,
		chunkSize: number,
		fileHash: string
	): UploadSession {
		const safeChunk = Math.max(chunkSize, 1);
		const totalChunks = Math.max(1, Math.ceil(fileSize / safeChunk));
		return {
			sessionId,
			filePath,
			targetPath,
			filename,
			fileSize,
			chunkSize,
			totalChunks,
			uploadedChunks: [],
			fileHash,
			createdAt: Date.now(),
			lastUpdatedAt: Date.now(),
			expiresAt: Date.now() + this.config.sessionExpireTime
		};
	}
  
	/**
   * 启动定期清理
   */
	private startCleanupTimer(): void {
		// 每小时清理一次过期会话
		this.cleanupTimer = setInterval(() => {
			this.cleanupExpiredSessions();
		}, 60 * 60 * 1000);
	}

	private queueSessionWrite(task: () => Promise<void>): void {
		this.sessionPersistQueue = this.sessionPersistQueue
			.then(() => task())
			.catch(error => {
				logger.error('会话持久化队列执行失败', error);
			});
	}
}

// 导出默认实例
export const defaultUploadManager = new ResumableUploadManager();
