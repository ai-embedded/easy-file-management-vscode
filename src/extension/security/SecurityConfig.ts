/**
 * 安全配置模块
 */

/**
 * 允许的协议列表
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * 默认的主机白名单
 * 可以通过VSCode设置进行配置
 */
const DEFAULT_HOST_WHITELIST = [
	'localhost',
	'127.0.0.1',
	'::1'
	// 可以在这里添加更多默认允许的主机
];

/**
 * 敏感请求头黑名单
 * 这些请求头将被过滤或限制
 */
const SENSITIVE_HEADERS = [
	'authorization',
	'proxy-authorization',
	'cookie',
	'set-cookie',
	'x-api-key',
	'x-auth-token'
];

/**
 * 危险路径模式
 * 用于检测目录穿越攻击
 */
const DANGEROUS_PATH_PATTERNS = [
	/\.\./g,           // 目录穿越
	/\/\//g,           // 双斜杠
	/\\/g,             // 反斜杠
	/~\//g,            // 用户主目录
	/^\//,             // 绝对路径（根目录）
	/%2e%2e/gi,        // URL编码的..
	/%252e%252e/gi    // 双重URL编码的..
];

/**
 * 安全配置接口
 */
export interface SecurityConfig {
  enableHostWhitelist: boolean;
  hostWhitelist: string[];
  enableProtocolCheck: boolean;
  allowedProtocols: string[];
  filterSensitiveHeaders: boolean;
  sensitiveHeaders: string[];
  enablePathValidation: boolean;
  maxRedirects: number;
  requestTimeout: number;
}

/**
 * 默认安全配置
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
	enableHostWhitelist: true,
	hostWhitelist: DEFAULT_HOST_WHITELIST,
	enableProtocolCheck: true,
	allowedProtocols: ALLOWED_PROTOCOLS,
	filterSensitiveHeaders: true,
	sensitiveHeaders: SENSITIVE_HEADERS,
	enablePathValidation: true,
	maxRedirects: 5,
	requestTimeout: 30000
};

/**
 * 验证URL是否安全
 */
export function validateUrl(url: string, config: SecurityConfig = DEFAULT_SECURITY_CONFIG): { valid: boolean; reason?: string } {
	try {
		const parsedUrl = new URL(url);
    
		// 检查协议
		if (config.enableProtocolCheck && !config.allowedProtocols.includes(parsedUrl.protocol)) {
			return { valid: false, reason: `不允许的协议: ${parsedUrl.protocol}` };
		}
    
		// 检查主机白名单
		if (config.enableHostWhitelist && !config.hostWhitelist.includes(parsedUrl.hostname)) {
			return { valid: false, reason: `主机不在白名单中: ${parsedUrl.hostname}` };
		}
    
		return { valid: true };
	} catch (error) {
		return { valid: false, reason: '无效的URL格式' };
	}
}

/**
 * 过滤敏感请求头
 */
export function filterHeaders(headers: Record<string, string>, config: SecurityConfig = DEFAULT_SECURITY_CONFIG): Record<string, string> {
	if (!config.filterSensitiveHeaders) {
		return headers;
	}
  
	const filtered: Record<string, string> = {};
  
	for (const [key, value] of Object.entries(headers)) {
		const lowerKey = key.toLowerCase();
		if (!config.sensitiveHeaders.includes(lowerKey)) {
			filtered[key] = value;
		} else {
			console.warn(`[Security] 已过滤敏感请求头: ${key}`);
		}
	}
  
	return filtered;
}

/**
 * 验证文件路径是否安全
 */
export function validatePath(path: string, config: SecurityConfig = DEFAULT_SECURITY_CONFIG): { valid: boolean; reason?: string } {
	if (!config.enablePathValidation) {
		return { valid: true };
	}
  
	// 检查危险路径模式
	for (const pattern of DANGEROUS_PATH_PATTERNS) {
		if (pattern.test(path)) {
			return { valid: false, reason: `路径包含危险模式: ${pattern}` };
		}
	}
  
	// 检查是否尝试访问系统目录
	const lowerPath = path.toLowerCase();
	const systemPaths = ['/etc', '/usr', '/bin', '/sbin', '/var', 'c:\\windows', 'c:\\program'];
  
	for (const sysPath of systemPaths) {
		if (lowerPath.startsWith(sysPath)) {
			return { valid: false, reason: `尝试访问系统目录: ${sysPath}` };
		}
	}
  
	return { valid: true };
}
