#!/usr/bin/env node
/*
 * 轻量级 TypeScript 运行器：使用 TypeScript 编译器 API 按需转译 .ts 文件。
 * 避免引入额外依赖（如 ts-node），在仅有 typescript 的环境下即可运行。
 */

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// 为 VS Code API 提供最小化的桩实现，避免在 CLI 环境下导入失败
const vscodeStub = {
	workspace: {
		getConfiguration: () => ({
			get: () => undefined,
			update: async () => undefined
		}),
		onDidChangeConfiguration: () => ({ dispose() { /* no-op */ } })
	},
	window: {
		createOutputChannel: () => ({ appendLine() { /* no-op */ }, dispose() { /* no-op */ } }),
		showErrorMessage: () => undefined,
		showWarningMessage: () => undefined,
		showInformationMessage: () => undefined
	},
	EventEmitter: class {
		constructor() {
			this._listeners = [];
			this.event = (listener) => {
				this._listeners.push(listener);
				return {
					dispose: () => {
						this._listeners = this._listeners.filter(fn => fn !== listener);
					}
				};
			};
		}
		fire(value) {
			for (const listener of [...this._listeners]) {
				try {
					listener(value);
				} catch (error) {
					console.warn('[vscode-stub] Event listener error', error);
				}
			}
		}
		dispose() {
			this._listeners = [];
		}
	},
	Disposable: class {
		constructor(callback) {
			this._callback = callback;
		}
		dispose() {
			if (typeof this._callback === 'function') {
				this._callback();
			}
		}
	}
};

const originalLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain) {
	if (request === 'vscode') {
		return vscodeStub;
	}
	return originalLoad(request, parent, isMain);
};

const register = (module, filename) => {
	const source = fs.readFileSync(filename, 'utf8');
	const { outputText, diagnostics } = ts.transpileModule(source, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.CommonJS,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			esModuleInterop: true,
			skipLibCheck: true,
			strict: false
		},
		fileName: filename
	});

	if (diagnostics && diagnostics.length > 0) {
		diagnostics.forEach(diag => {
			const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
			const location = diag.file && diag.start !== undefined
				? diag.file.getLineAndCharacterOfPosition(diag.start)
				: null;
			if (location) {
				const { line, character } = location;
				console.warn(`[ts-transpile] ${diag.file.fileName}:${line + 1}:${character + 1} ${message}`);
			} else {
				console.warn(`[ts-transpile] ${message}`);
			}
		});
	}

	module._compile(outputText, filename);
};

if (!require.extensions['.ts']) {
	require.extensions['.ts'] = register;
}
if (!require.extensions['.tsx']) {
	require.extensions['.tsx'] = register;
}

const target = path.resolve(__dirname, '../src/test/tcp/TcpUploadSmoke.ts');
require(target);
