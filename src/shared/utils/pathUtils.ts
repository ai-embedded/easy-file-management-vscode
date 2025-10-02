export const urlProtocolPattern = /^[a-z][a-z0-9+.-]*:\/\//i;

export const decodeUriComponentSafe = (value: string): string => {
	if (!value || !value.includes('%')) {
		return value;
	}

	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '');

const ensureLeadingSlash = (value: string): string => (value.startsWith('/') ? value : `/${value}`);

const normalizeSegments = (parts: string[]): string[] => {
	const stack: string[] = [];
	for (const part of parts) {
		if (part === '' || part === '.') {
			continue;
		}
		if (part === '..') {
			if (stack.length > 0) {
				stack.pop();
			}
			continue;
		}
		stack.push(part);
	}
	return stack;
};

/**
 * 规范化远程路径：
 * - 兼容 URL 形式（http://...）
 * - 自动解码编码字符
 * - 缺失时回退到 basePath + name
 */
export const normalizeRemotePath = (
	rawPath: string | undefined | null,
	basePath: string,
	name?: string
): string => {
	const baseForJoin = basePath || '/';
	const fallbackName = name ?? '';
	const fallback = joinPath(baseForJoin, fallbackName);

	if (typeof rawPath !== 'string') {
		return fallback;
	}

	const trimmed = rawPath.trim();
	if (!trimmed) {
		return fallback;
	}

	if (urlProtocolPattern.test(trimmed)) {
		return trimmed;
	}

	const decoded = decodeUriComponentSafe(trimmed);
	if (decoded.startsWith('/')) {
		return joinPath(decoded);
	}

	const baseTrimmed = trimSlashes(baseForJoin);
	if (baseTrimmed && decoded.startsWith(`${baseTrimmed}/`)) {
		return joinPath(decoded);
	}

	return joinPath(baseForJoin, decoded);
};

/**
 * 拼接远程路径，保持单个斜杠
 */
export const joinPath = (...segments: Array<string | undefined | null>): string => {
	const rawParts: string[] = [];
	for (const segment of segments) {
		if (typeof segment !== 'string') {
			continue;
		}
		const trimmed = segment.trim();
		if (!trimmed) {
			continue;
		}
		const withoutSlashes = trimSlashes(trimmed);
		if (!withoutSlashes) {
			continue;
		}
		rawParts.push(...withoutSlashes.split('/'));
	}

	if (rawParts.length === 0) {
		return '/';
	}

	const normalized = normalizeSegments(rawParts);
	return normalized.length === 0 ? '/' : ensureLeadingSlash(normalized.join('/'));
};

export default {
	urlProtocolPattern,
	decodeUriComponentSafe,
	normalizeRemotePath,
	joinPath
};
