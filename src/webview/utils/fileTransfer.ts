import type { Ref } from 'vue';
import type { FileItem } from '../types';
import { normalizeRemotePath } from '../../shared/utils/pathUtils';
import { joinPath } from './fileUtils';

export interface ResolveFileOptions {
  currentPath: Ref<string> | string;
}

export interface ResolvedFile {
  path: string;
  fileWithPath: FileItem;
}

const getCurrentPathValue = (value: Ref<string> | string): string => {
	return typeof value === 'string' ? value : value.value;
};

export const resolveFile = (file: FileItem, options: ResolveFileOptions): ResolvedFile => {
	const basePath = getCurrentPathValue(options.currentPath) || '/';
	const resolvedPath = normalizeRemotePath(file.path, basePath, file.name);
	const fileWithPath = file.path === resolvedPath ? file : { ...file, path: resolvedPath };
	return { path: resolvedPath, fileWithPath };
};

export const resolveDirectoryPath = (targetPath: string, options: ResolveFileOptions): string => {
	const basePath = getCurrentPathValue(options.currentPath) || '/';
	return normalizeRemotePath(targetPath, basePath, '');
};

export const buildChildPath = (parentPath: string, name: string): string => {
	return normalizeRemotePath(joinPath(parentPath, name), parentPath, name);
};

export default {
	resolveFile,
	resolveDirectoryPath,
	buildChildPath
};
