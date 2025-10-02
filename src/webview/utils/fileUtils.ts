import { FileItem } from '../types';
import { joinPath as sharedJoinPath } from '../../shared/utils/pathUtils';

/**
 * 文件相关的工具函数
 */

/**
 * 格式化文件大小
 * @param bytes 字节数
 * @param decimals 小数位数
 * @returns 格式化的文件大小字符串
 */
export function formatFileSize(bytes: number, decimals = 2): string {
	if (bytes === 0) {
		return '0 B';
	}
  
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  
	const i = Math.floor(Math.log(bytes) / Math.log(k));
  
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))  } ${  sizes[i]}`;
}

/**
 * 获取文件扩展名
 * @param filename 文件名
 * @returns 扩展名
 */
export function getFileExtension(filename: string): string {
	const lastDot = filename.lastIndexOf('.');
	return lastDot > 0 ? filename.substring(lastDot + 1).toLowerCase() : '';
}

/**
 * 获取文件类型图标
 * @param item 文件项
 * @returns 图标名称
 */
export function getFileIcon(item: FileItem): string {
	if (item.type === 'directory') {
		return 'el-icon-folder';
	}
  
	const ext = getFileExtension(item.name);
	const iconMap: Record<string, string> = {
		// 文档
		'txt': 'el-icon-document',
		'doc': 'el-icon-document',
		'docx': 'el-icon-document',
		'pdf': 'el-icon-document',
		'md': 'el-icon-document',
    
		// 图片
		'jpg': 'el-icon-picture',
		'jpeg': 'el-icon-picture',
		'png': 'el-icon-picture',
		'gif': 'el-icon-picture',
		'bmp': 'el-icon-picture',
		'svg': 'el-icon-picture',
    
		// 视频
		'mp4': 'el-icon-video-camera',
		'avi': 'el-icon-video-camera',
		'mkv': 'el-icon-video-camera',
		'mov': 'el-icon-video-camera',
		'wmv': 'el-icon-video-camera',
    
		// 音频
		'mp3': 'el-icon-headset',
		'wav': 'el-icon-headset',
		'flac': 'el-icon-headset',
		'aac': 'el-icon-headset',
    
		// 代码
		'js': 'el-icon-document-copy',
		'ts': 'el-icon-document-copy',
		'vue': 'el-icon-document-copy',
		'html': 'el-icon-document-copy',
		'css': 'el-icon-document-copy',
		'py': 'el-icon-document-copy',
		'java': 'el-icon-document-copy',
		'cpp': 'el-icon-document-copy',
		'c': 'el-icon-document-copy',
    
		// 压缩文件
		'zip': 'el-icon-box',
		'rar': 'el-icon-box',
		'7z': 'el-icon-box',
		'tar': 'el-icon-box',
		'gz': 'el-icon-box'
	};
  
	return iconMap[ext] || 'el-icon-document';
}

/**
 * 格式化日期
 * @param date 日期
 * @returns 格式化的日期字符串
 */
let futureTimeLogCount = 0;
const FUTURE_TIME_LOG_LIMIT = 5;
const isDevEnv = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

export function formatDate(date: Date | number | string): string {
	// 添加输入验证
	let validDate: Date;
  
	if (date instanceof Date) {
		if (isNaN(date.getTime())) {
			if (isDevEnv) {
				console.warn('[formatDate] 无效的Date对象，使用当前时间');
			}
			validDate = new Date();
		} else {
			validDate = date;
		}
	} else if (typeof date === 'number' || typeof date === 'string') {
		validDate = new Date(date);
		if (isNaN(validDate.getTime())) {
			if (isDevEnv) {
				console.warn('[formatDate] 无效的日期值:', date);
			}
			return '未知时间';
		}
	} else {
		if (isDevEnv) {
			console.warn('[formatDate] 不支持的日期类型:', typeof date);
		}
		return '未知时间';
	}
  
	const now = new Date();
	const diff = now.getTime() - validDate.getTime();
  
	// 处理未来的时间（负数差值）
	if (diff < 0) {
		if (isDevEnv && futureTimeLogCount < FUTURE_TIME_LOG_LIMIT) {
			console.log('[formatDate] 检测到未来时间:', validDate.toISOString());
			futureTimeLogCount += 1;
		}
		return '刚刚';
	}
  
	const daysDiff = Math.floor(diff / (1000 * 60 * 60 * 24));
  
	if (daysDiff === 0) {
		return `今天 ${  validDate.toLocaleTimeString('zh-CN', { 
			hour: '2-digit', 
			minute: '2-digit' 
		})}`;
	} else if (daysDiff === 1) {
		return `昨天 ${  validDate.toLocaleTimeString('zh-CN', { 
			hour: '2-digit', 
			minute: '2-digit' 
		})}`;
	} else if (daysDiff < 7) {
		return `${daysDiff}天前`;
	} else {
		return validDate.toLocaleDateString('zh-CN');
	}
}

/**
 * 验证文件名是否合法
 * @param filename 文件名
 * @returns 是否合法
 */
export function isValidFilename(filename: string): boolean {
	// 检查是否包含非法字符
	const invalidChars = /[<>:"/\\|?*]/;
	if (invalidChars.test(filename)) {
		return false;
	}
  
	// 检查是否为空或只包含空格
	if (!filename.trim()) {
		return false;
	}
  
	// 检查是否为保留名称
	const reservedNames = [
		'CON', 'PRN', 'AUX', 'NUL',
		'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
		'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
	];
  
	const nameWithoutExt = filename.split('.')[0].toUpperCase();
	if (reservedNames.includes(nameWithoutExt)) {
		return false;
	}
  
	return true;
}

/**
 * 路径拼接
 * @param paths 路径片段
 * @returns 拼接后的路径
 */
export const joinPath = sharedJoinPath;

/**
 * 获取父目录路径
 * @param path 当前路径
 * @returns 父目录路径
 */
export function getParentPath(path: string): string {
	const parts = path.replace(/^\/+|\/+$/g, '').split('/');
	if (parts.length <= 1) {
		return '/';
	}
	parts.pop();
	return `/${  parts.join('/')}`;
}

/**
 * 获取文件名（不包含路径）
 * @param path 完整路径
 * @returns 文件名
 */
export function getFilename(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1];
}

/**
 * 判断文件是否为文本文件
 * @param filename 文件名
 * @returns 是否为文本文件
 */
export function isTextFile(filename: string): boolean {
	const ext = getFileExtension(filename);
	const textExtensions = [
		// 纯文本
		'txt', 'text', 'log', 'md', 'markdown', 'readme',
    
		// 代码文件
		'js', 'ts', 'jsx', 'tsx', 'vue', 'html', 'htm', 'css', 'scss', 'sass', 'less',
		'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'config',
    
		// 编程语言
		'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'java', 'py', 'rb', 'go', 'rs', 'php',
		'pl', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'vbs', 'lua',
		'r', 'sql', 'swift', 'kt', 'scala', 'clj', 'hs', 'elm', 'dart', 'nim',
    
		// 数据格式
		'csv', 'tsv', 'jsonl', 'ndjson',
    
		// 文档格式
		'rtf', 'tex', 'latex', 'bib',
    
		// 其他文本格式
		'gitignore', 'gitattributes', 'editorconfig', 'env', 'properties',
		'makefile', 'dockerfile', 'containerfile', 'jenkinsfile'
	];
  
	return textExtensions.includes(ext);
}
