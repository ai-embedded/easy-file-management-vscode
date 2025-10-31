// Native JS App class - replaces App.vue
import { createConnectionService } from './services/ServiceFactory';
import type { IConnectionService } from './services/interfaces/IConnectionService';
import type { OperationControlHooks } from './services/bridge/BaseBridgeService';
import { ConnectionStatus, type ConnectionConfig, type FileItem } from '@shared/types';
import { AppState, FileProgress } from './types';
import { showError, showInfo, showWarning, postMessage, log } from './utils/messageUtils';
import { UIMessageBox } from './utils/uiUtils';
import { resolveFile, resolveDirectoryPath } from './utils/fileTransfer';
import { saveFile, showSaveDialog, isVSCodeAvailable } from './utils/vscode';
import { summarizeConnectionConfig } from '@shared/utils/connectionSummary';
import { getTransportDefinitions, getTransportDefinition, type TransportKind } from '@shared/transport';
import { Logger } from '@shared/utils/Logger';
import { ConnectionPanel } from './components/ConnectionPanel';
import { FileExplorer } from './components/FileExplorer';
import { FilePreview } from './components/FilePreview';
import { StatusBar } from './components/StatusBar';

interface MoveOperation {
    oldPath: string;
    newPath: string;
}

interface OperationToken {
    cancelled: boolean;
    requestIds: Set<string>;
    cancelCallbacks: Array<() => Promise<void> | void>;
}

interface FileExplorerToolbarState {
    canGoBack: boolean;
    loading: boolean;
    canCreateFolder: boolean;
    canUpload: boolean;
    canBatchPreview: boolean;
    canBatchDownload: boolean;
    canBatchRename: boolean;
    canBatchMove: boolean;
    canBatchDelete: boolean;
}

export class App {
	private container: HTMLElement;
	private logger: Logger;
    
	// App state
	private appState: AppState = {
		connectionStatus: ConnectionStatus.DISCONNECTED,
		currentPath: '/',
		fileList: [],
		loading: false,
		error: undefined,
		currentConnection: undefined
	};

	// Connection management
	private currentConnectionService: IConnectionService | null = null;
	private connectionStateSubscription: (() => void) | null = null;
	private connectionErrorHandledByEvent = false;
	private connectionDialogVisible = false;
	private pendingConnectionStatus: ConnectionStatus | null = ConnectionStatus.DISCONNECTED;
	private pendingConnectingState: boolean | null = false;
	private defaultDownloadDirectory: string | null = null;

	// Operation management
	private currentOperation = '';
	private operationInProgress = false;
	private operationProgress: number | null = null;
	private operationSpeed: number | null = null;
	private operationDirection: 'upload' | 'download' | null = null;
	private operationTransport: string | null = null;
	private lastOperationProgressSnapshot: { loaded: number; timestamp: number } | null = null;
	private operationToken: OperationToken | null = null;
	private operationCancelable = false;
	private globalLoading = false;

	// File explorer state
	private explorerToolbarState: FileExplorerToolbarState = {
		canGoBack: false,
		loading: false,
		canCreateFolder: false,
		canUpload: false,
		canBatchPreview: false,
		canBatchDownload: false,
		canBatchRename: false,
		canBatchMove: false,
		canBatchDelete: false
	};

	// File preview state
	private previewDialogVisible = false;
	private previewFileItem: FileItem | null = null;
	private previewContent = '';
	private previewLoading = false;
	private previewError = '';

	// Component references
	private connectionPanel: ConnectionPanel | null = null;
	private fileExplorer: FileExplorer | null = null;
	private filePreview: FilePreview | null = null;
	private statusBar: StatusBar | null = null;

	// File loading
	private currentLoadToken: symbol | null = null;
	private pendingRefreshTimer: number | null = null;
	private pendingRefreshPath: string | null = null;
	private pendingRefreshTransport: string | null = null;
	private refreshRunning = false;
	private suppressRefreshUntil = 0;
	private uploadPickerActive = false;

	// Notifications
	private ignoredExtensionNotificationModules = new Set(['RequestTracer', 'Extension:Webview', 'TcpClient', 'MessageRouter']);
	private lastExtensionNotification: { message: string; timestamp: number } | null = null;

	// Refresh sensitive transports
	private readonly refreshSensitiveTransports = new Set(
		getTransportDefinitions()
			.filter((definition) => definition.refreshSensitive)
			.map((definition) => definition.id)
	);

	constructor(container: HTMLElement, logger: Logger) {
		this.container = container;
		this.logger = logger;
	}

	async init(): Promise<void> {
		this.render();
		this.setupEventListeners();
		this.logger.info('App initialized');
	}

	private render(): void {
		this.container.innerHTML = `
            <div class="app-container">
                <div class="app-toolbar">
                    <div class="file-actions-toolbar" id="file-actions-toolbar" style="display: none;">
                        <button class="btn btn-circle btn-small" id="btn-go-back" title="返回">
                            ←
                        </button>
                        <button class="btn btn-circle btn-small" id="btn-refresh" title="刷新">
                            ⟳
                        </button>
                        <button class="btn btn-circle btn-small" id="btn-create-folder" title="创建文件夹">
                            📁+
                        </button>
                        <button class="btn btn-circle btn-small btn-primary" id="btn-upload" title="上传">
                            ⬆
                        </button>
                        <button class="btn btn-circle btn-small" id="btn-preview" title="预览">
                            👁
                        </button>
                        <button class="btn btn-circle btn-small" id="btn-download" title="下载">
                            ⬇
                        </button>
                        <button class="btn btn-circle btn-small" id="btn-rename" title="重命名">
                            ✏
                        </button>
                        <button class="btn btn-circle btn-small" id="btn-move" title="移动">
                            ↗
                        </button>
                        <button class="btn btn-circle btn-small btn-danger" id="btn-delete" title="删除">
                            🗑
                        </button>
                    </div>
                    <div class="toolbar-spacer"></div>
                    <button class="btn btn-circle btn-primary" id="btn-settings" title="连接设置">
                        ⚙️
                    </button>
                    <button class="btn btn-success" id="btn-connect" style="display: none;">
                        连接
                    </button>
                    <button class="btn btn-danger" id="btn-disconnect" style="display: none;">
                        断开连接
                    </button>
                </div>

                <div class="main-content" id="main-content">
                    <div class="disconnected-hint" id="disconnected-hint">
                        <div class="empty-state">
                            <div class="empty-state-icon">📁</div>
                            <div class="empty-state-text">请先配置连接设置</div>
                            <button class="btn btn-primary" id="btn-open-connection-dialog">连接设置</button>
                        </div>
                    </div>
                </div>

                <div id="status-bar-container"></div>
            </div>

            <div id="connection-dialog" class="modal-overlay">
                <div class="modal-container">
                    <div class="modal-header">
                        <h3 class="modal-title">连接设置</h3>
                        <button class="modal-close" id="btn-close-connection-dialog">&times;</button>
                    </div>
                    <div class="modal-body" id="connection-panel-container"></div>
                </div>
            </div>

            <div id="file-preview-dialog" class="modal-overlay">
                <div class="modal-container" style="max-width: 80%; max-height: 80vh;">
                    <div class="modal-header">
                        <h3 class="modal-title">文件预览</h3>
                        <button class="modal-close" id="btn-close-preview-dialog">&times;</button>
                    </div>
                    <div class="modal-body" id="file-preview-container"></div>
                </div>
            </div>

            <div id="global-loading" class="modal-overlay" style="display: none;">
                <div style="display: flex; align-items: center; justify-content: center; height: 100%;">
                    <div class="loading"></div>
                    <span style="margin-left: 12px;">处理中...</span>
                </div>
            </div>
        `;

		// Initialize components
		const connectionPanelContainer = document.getElementById('connection-panel-container');
		const fileExplorerContainer = document.getElementById('main-content');
		const statusBarContainer = document.getElementById('status-bar-container');
		const filePreviewContainer = document.getElementById('file-preview-container');

		if (connectionPanelContainer) {
			this.connectionPanel = new ConnectionPanel(connectionPanelContainer, this.logger);
			this.connectionPanel.onConnect = (config) => this.handleConnect(config);
			this.connectionPanel.onDisconnect = () => this.handleDisconnect();
			this.connectionPanel.onConnectionStatusChange = (status) => this.handleConnectionPanelStatusChange(status);
			this.connectionPanel.onDownloadSettingsChange = (path) => this.handleDownloadSettingsChange(path);
			this.connectionPanel.setDownloadDirectory(this.defaultDownloadDirectory ?? null, { emit: false });
			const downloadSettings = this.connectionPanel.getDownloadSettings();
			if (downloadSettings?.defaultDownloadPath) {
				this.defaultDownloadDirectory = downloadSettings.defaultDownloadPath;
			}
			this.syncConnectionPanelState('render');
		}

		if (fileExplorerContainer) {
			this.fileExplorer = new FileExplorer(fileExplorerContainer, this.logger);
			this.fileExplorer.onPathChange = (path) => this.handlePathChange(path);
			this.fileExplorer.onDownload = (file) => this.handleDownload(file);
			this.fileExplorer.onPreview = (file) => this.handlePreview(file);
			this.fileExplorer.onRename = (oldPath, newPath) => this.handleRename(oldPath, newPath);
			this.fileExplorer.onMove = (oldPath, newPath) => this.handleMove(oldPath, newPath);
			this.fileExplorer.onMoveBatch = (operations) => this.handleMoveBatch(operations);
			this.fileExplorer.onDelete = (file) => this.handleDelete(file);
			this.fileExplorer.onCreateFolder = (path, name) => this.handleCreateFolder(path, name);
			this.fileExplorer.onRefresh = () => this.handleRefresh();
			this.fileExplorer.onUpload = (files, targetPath) => this.handleFolderUpload(files, targetPath);
			this.fileExplorer.onToolbarStateChange = (state) => this.handleExplorerToolbarStateChange(state);
		}

		if (statusBarContainer) {
			this.statusBar = new StatusBar(statusBarContainer, this.logger);
			this.statusBar.onCancelOperation = () => {
				void this.cancelCurrentOperation();
			};
		}

		if (filePreviewContainer) {
			this.filePreview = new FilePreview(filePreviewContainer, this.logger);
			this.filePreview.onDownload = (file) => this.handleDownload(file);
			this.filePreview.onRefresh = (file) => this.handlePreview(file);
		}
	}

	private setupEventListeners(): void {
		// Toolbar buttons
		document.getElementById('btn-settings')?.addEventListener('click', () => this.openConnectionDialog());
		document.getElementById('btn-connect')?.addEventListener('click', () => this.triggerQuickConnect());
		document.getElementById('btn-disconnect')?.addEventListener('click', () => this.triggerQuickDisconnect());
		document.getElementById('btn-open-connection-dialog')?.addEventListener('click', () => this.openConnectionDialog());
		document.getElementById('btn-close-connection-dialog')?.addEventListener('click', () => this.closeConnectionDialog());
		document.getElementById('btn-close-preview-dialog')?.addEventListener('click', () => this.closePreviewDialog());

		// File explorer toolbar buttons
		document.getElementById('btn-go-back')?.addEventListener('click', () => this.handleExplorerGoBack());
		document.getElementById('btn-refresh')?.addEventListener('click', () => this.handleExplorerRefresh());
		document.getElementById('btn-create-folder')?.addEventListener('click', () => this.handleExplorerCreateFolder());
		document.getElementById('btn-upload')?.addEventListener('click', () => this.handleExplorerUpload());
		document.getElementById('btn-preview')?.addEventListener('click', () => this.handleExplorerBatchPreview());
		document.getElementById('btn-download')?.addEventListener('click', () => this.handleExplorerBatchDownload());
		document.getElementById('btn-rename')?.addEventListener('click', () => this.handleExplorerBatchRename());
		document.getElementById('btn-move')?.addEventListener('click', () => this.handleExplorerBatchMove());
		document.getElementById('btn-delete')?.addEventListener('click', () => this.handleExplorerBatchDelete());

		// Close dialogs on backdrop click
		const connectionDialog = document.getElementById('connection-dialog');
		connectionDialog?.addEventListener('click', (event) => {
			const overlay = event.currentTarget as HTMLElement | null;
			if (!overlay) {
				return;
			}
			const container = overlay.querySelector('.modal-container');
			const target = event.target as Node | null;
			if (!container || !target || !container.contains(target)) {
				this.closeConnectionDialog();
			}
		});

		document.getElementById('file-preview-dialog')?.addEventListener('click', (e) => {
			if (e.target === e.currentTarget) {
				this.closePreviewDialog();
			}
		});
	}

	private updateConnectionPanelStatus(status: ConnectionStatus, reason: string): void {
		this.pendingConnectionStatus = status;
		if (this.connectionPanel) {
			this.connectionPanel.setConnectionStatus(status);
		}
		this.logger.info('Connection panel status updated', { status, reason });
	}

	private setConnectionPanelConnecting(connecting: boolean, reason: string): void {
		this.pendingConnectingState = connecting;
		if (this.connectionPanel) {
			this.connectionPanel.setConnecting(connecting);
		}
		this.logger.info('Connection panel connecting state updated', { connecting, reason });
	}

	private syncConnectionPanelState(reason: string): void {
		if (!this.connectionPanel) {
			this.logger.warn('Connection panel not ready for sync', { reason });
			return;
		}

		const status = this.pendingConnectionStatus ?? this.appState.connectionStatus;
		const connecting = this.pendingConnectingState ?? (this.appState.connectionStatus === ConnectionStatus.CONNECTING);
		this.connectionPanel.setConnectionStatus(status);
		this.connectionPanel.setConnecting(connecting);

		if (this.defaultDownloadDirectory) {
			this.connectionPanel.setDownloadDirectory(this.defaultDownloadDirectory, { emit: false });
		}
	}

	private handleConnectionPanelStatusChange(status: ConnectionStatus): void {
		this.appState.connectionStatus = status;
		this.updateConnectionPanelStatus(status, 'panel-event');
		this.setConnectionPanelConnecting(status === ConnectionStatus.CONNECTING, 'panel-event');
		this.updateUI();
	}

	private handleDownloadSettingsChange(path: string | null): void {
		const normalized = path && path.trim() ? path.trim() : null;
		this.defaultDownloadDirectory = normalized;
		this.logger.info('Default download directory updated', { path: normalized });
		if (this.connectionPanel) {
			this.connectionPanel.setDownloadDirectory(normalized, { emit: false });
		}
	}

	private async ensureConnectionPanelReady(source = 'manual'): Promise<ConnectionPanel> {
		if (this.connectionPanel) {
			return this.connectionPanel;
		}

		this.openConnectionDialog(source);
		await new Promise((resolve) => window.setTimeout(resolve, 20));

		if (!this.connectionPanel) {
			throw new Error('连接设置面板尚未初始化');
		}

		this.syncConnectionPanelState(`ensure:${source}`);
		return this.connectionPanel;
	}

	private updateUI(): void {
		// Update toolbar visibility
		const fileActionsToolbar = document.getElementById('file-actions-toolbar');
		const btnConnect = document.getElementById('btn-connect');
		const btnDisconnect = document.getElementById('btn-disconnect');
		const disconnectedHint = document.getElementById('disconnected-hint');
		const mainContent = document.getElementById('main-content');

		const isConnected = this.appState.connectionStatus === ConnectionStatus.CONNECTED;
		const isConnecting = this.appState.connectionStatus === ConnectionStatus.CONNECTING;

		if (fileActionsToolbar) {
			fileActionsToolbar.style.display = isConnected ? 'flex' : 'none';
		}

		if (btnConnect) {
			btnConnect.style.display = (!isConnected && !isConnecting) ? 'inline-block' : 'none';
		}

		if (btnDisconnect) {
			btnDisconnect.style.display = (isConnected && !isConnecting) ? 'inline-block' : 'none';
		}

		if (disconnectedHint) {
			disconnectedHint.style.display = isConnected ? 'none' : 'flex';
		}

		// Update file explorer visibility
		if (this.fileExplorer && isConnected) {
			this.fileExplorer.setVisible(true);
			this.fileExplorer.setFiles(this.appState.fileList);
			this.fileExplorer.setCurrentPath(this.appState.currentPath);
			this.fileExplorer.setLoading(this.appState.loading);
		} else if (this.fileExplorer) {
			this.fileExplorer.setVisible(false);
		}

		// Update status bar
		if (this.statusBar) {
			const fileStats = this.computeFileStats();
			this.statusBar.update({
				connectionStatus: this.appState.connectionStatus,
				serverInfo: this.getServerInfo(),
				currentPath: this.appState.currentPath,
				currentOperation: this.currentOperation,
				operationInProgress: this.operationInProgress,
				operationProgress: this.operationProgress,
				operationSpeed: this.operationSpeed,
				operationDirection: this.operationDirection,
				operationTransport: this.operationTransport,
				operationCancelable: this.operationCancelable,
				fileStats: fileStats ?? undefined
			});
		}
	}

	private computeFileStats(): { totalFiles: number; totalDirectories: number; totalSize: number } | null {
		const files = this.appState.fileList;
		if (!files || files.length === 0) {
			return null;
		}

		let fileCount = 0;
		let directoryCount = 0;
		let totalSize = 0;

		for (const item of files) {
			if (item.type === 'file') {
				fileCount += 1;
				totalSize += item.size ?? 0;
			} else if (item.type === 'directory') {
				directoryCount += 1;
			}
		}

		return {
			totalFiles: fileCount + directoryCount,
			totalDirectories: directoryCount,
			totalSize
		};
	}

	private getServerInfo(): string | undefined {
		const service = this.currentConnectionService;
		const config = service?.getConfig?.();
		if (!config) {
			return undefined;
		}

		if (config.type === 'serial' || config.type === 'uart') {
			const baudRate = config.baudRate ?? 115200;
			return `串口 @ ${baudRate}`;
		}

		if (config.host && config.port) {
			return `${config.host}:${config.port}`;
		}

		return summarizeConnectionConfig(config);
	}

	// Connection handlers
	private async handleConnect(config: ConnectionConfig): Promise<void> {
		try {
			this.appState.connectionStatus = ConnectionStatus.CONNECTING;
			this.appState.error = undefined;
			this.appState.currentConnection = config;
			this.updateConnectionPanelStatus(ConnectionStatus.CONNECTING, 'handleConnect-start');
			this.setConnectionPanelConnecting(true, 'handleConnect-start');
			this.setOperation(config.type === 'serial' ? '正在连接串口设备…' : '正在连接远程服务…', true, null, {
				transport: config.type
			});
			this.updateUI();

			this.currentConnectionService = createConnectionService(config.type);
			this.attachServiceConnectionListener(this.currentConnectionService);
			this.connectionErrorHandledByEvent = false;

			const success = await this.currentConnectionService.connect(config);

			if (success) {
				this.appState.connectionStatus = ConnectionStatus.CONNECTED;
				this.appState.currentPath = '/';
				this.updateConnectionPanelStatus(ConnectionStatus.CONNECTED, 'handleConnect-success');
				this.setConnectionPanelConnecting(false, 'handleConnect-success');
				this.closeConnectionDialog('handleConnect-success');
				await this.loadFiles('/');
				showInfo(`连接成功：${summarizeConnectionConfig(config)}`);
				this.logger.info('Connection established', { summary: summarizeConnectionConfig(config) });
			} else {
				throw new Error('连接失败');
			}
		} catch (error) {
			this.appState.connectionStatus = ConnectionStatus.ERROR;
			this.appState.error = error instanceof Error ? error.message : '连接失败';
			showError(this.appState.error);
			this.updateConnectionPanelStatus(ConnectionStatus.ERROR, 'handleConnect-error');
			this.setConnectionPanelConnecting(false, 'handleConnect-error');
			this.logger.error('Connection failed', { error: this.appState.error, summary: summarizeConnectionConfig(config) });
			this.currentConnectionService = null;
			this.attachServiceConnectionListener(null);
		} finally {
			this.clearOperation();
			this.setConnectionPanelConnecting(false, 'handleConnect-finally');
			this.connectionErrorHandledByEvent = false;
			this.updateUI();
		}
	}

	private async handleDisconnect(): Promise<void> {
		try {
			const service = this.currentConnectionService;
			if (service) {
				await service.disconnect();
				this.currentConnectionService = null;
			}
			this.attachServiceConnectionListener(null);

			this.appState.connectionStatus = ConnectionStatus.DISCONNECTED;
			this.appState.fileList = [];
			this.appState.currentPath = '/';
			this.appState.error = undefined;
			this.appState.currentConnection = undefined;
			this.connectionErrorHandledByEvent = false;

			this.updateConnectionPanelStatus(ConnectionStatus.DISCONNECTED, 'handleDisconnect-success');
			this.setConnectionPanelConnecting(false, 'handleDisconnect-success');
			this.syncConnectionPanelState('handleDisconnect-success');

			showInfo('已断开连接');
			this.logger.info('Disconnected from service');
		} catch (error) {
			showError('断开连接失败');
			this.logger.error('Disconnect failed', error);
		} finally {
			this.clearOperation();
			this.updateUI();
		}
	}

	private attachServiceConnectionListener(service: IConnectionService | null): void {
		if (this.connectionStateSubscription) {
			this.connectionStateSubscription();
			this.connectionStateSubscription = null;
		}

		if (service && service.onConnectionStateChange) {
			this.connectionStateSubscription = service.onConnectionStateChange((state, payload) => {
				this.handleServiceConnectionState(state as ConnectionStatus, payload);
			});
		}
	}

	private handleServiceConnectionState(state: ConnectionStatus, payload?: any): void {
		const previousStatus = this.appState.connectionStatus;
		this.logger.info(`Service connection event: ${state}`, payload);

		switch (state) {
			case ConnectionStatus.CONNECTING:
				this.appState.connectionStatus = ConnectionStatus.CONNECTING;
				this.updateConnectionPanelStatus(ConnectionStatus.CONNECTING, 'service-event');
				this.setConnectionPanelConnecting(true, 'service-event');
				this.connectionErrorHandledByEvent = false;
				this.setOperation(payload?.message || '正在尝试连接…', true, null, {
					transport: this.appState.currentConnection?.type
				});
				break;
			case ConnectionStatus.CONNECTED:
				this.appState.connectionStatus = ConnectionStatus.CONNECTED;
				this.updateConnectionPanelStatus(ConnectionStatus.CONNECTED, 'service-event');
				this.setConnectionPanelConnecting(false, 'service-event');
				this.clearOperation();
				this.closeConnectionDialog('service-event');
				this.connectionErrorHandledByEvent = false;
				this.updateUI();
				break;
			case ConnectionStatus.ERROR:
				this.appState.connectionStatus = ConnectionStatus.ERROR;
				this.appState.error = payload?.reason || payload?.error || '连接错误';
				this.updateConnectionPanelStatus(ConnectionStatus.ERROR, 'service-event');
				this.setConnectionPanelConnecting(false, 'service-event');
				this.clearOperation();
				if (!this.connectionErrorHandledByEvent) {
					showError(this.appState.error);
					this.connectionErrorHandledByEvent = true;
				}
				break;
			case ConnectionStatus.DISCONNECTED:
				this.appState.connectionStatus = ConnectionStatus.DISCONNECTED;
				this.updateConnectionPanelStatus(ConnectionStatus.DISCONNECTED, 'service-event');
				this.setConnectionPanelConnecting(false, 'service-event');
				this.clearOperation();
				if (previousStatus === ConnectionStatus.CONNECTED) {
					showInfo('连接已断开');
				}
				break;
		}
		this.updateUI();
	}

	// File operations
	private async loadFiles(path: string, options: { silent?: boolean } = {}): Promise<void> {
		const service = this.currentConnectionService;
		if (!service) {return;}

		const loadToken = Symbol('loadFiles');
		this.currentLoadToken = loadToken;

		try {
			const basePath = resolveDirectoryPath(path, { currentPath: this.appState.currentPath });

			if (!options.silent) {
				this.appState.loading = true;
				this.setOperation(`正在加载 ${basePath}`, true);
			}

			const files = await service.listFiles(basePath);
			const normalizedFiles = files.map(file => resolveFile(file, { currentPath: basePath }).fileWithPath);

			if (this.currentLoadToken === loadToken) {
				this.appState.fileList = normalizedFiles;
				this.appState.currentPath = basePath;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : '加载文件列表失败';
			showError(message);
			this.logger.error('Load files failed', { path, error: message });
		} finally {
			if (this.currentLoadToken === loadToken) {
				if (!options.silent) {
					this.appState.loading = false;
					this.clearOperation();
				}
				this.currentLoadToken = null;
			}
			this.updateUI();
		}
	}

	private handlePathChange(path: string): void {
		this.loadFiles(path);
	}

	private async handleDownload(file: FileItem): Promise<void> {
		const service = this.currentConnectionService;
		if (!service) {return;}

		try {
			const { fileWithPath, path: resolvedPath } = resolveFile(file, { currentPath: this.appState.currentPath });

			let confirmedPath: string | null | undefined;

			if (isVSCodeAvailable()) {
				try {
					const dialogOptions: any = {
						suggestedName: fileWithPath.name,
						filters: { 'All Files': ['*'] }
					};

					if (this.defaultDownloadDirectory) {
						dialogOptions.defaultUri = this.joinDirectoryAndFilename(this.defaultDownloadDirectory, fileWithPath.name);
					}

					confirmedPath = await showSaveDialog(dialogOptions);
				} catch (dialogError) {
					const message = dialogError instanceof Error ? dialogError.message : '保存对话框打开失败';
					showError(`无法打开保存对话框: ${message}`);
					return;
				}

				if (!confirmedPath) {
					showInfo(`已取消 "${fileWithPath.name}" 的下载`);
					return;
				}
			}

			this.setOperation(`正在下载 ${fileWithPath.name}`, true, 0, { direction: 'download' });
			const operationHooks = this.createOperationHooks();

			if (confirmedPath) {
				const result = await service.downloadFileToPath({
					filePath: resolvedPath,
					filename: fileWithPath.name,
					fileSize: fileWithPath.size,
					onProgress: (progress: FileProgress) => {
						if (this.isOperationCancelled()) {return;}
						this.setOperationProgress(progress.percent, progress);
					},
					targetFile: confirmedPath
				}, operationHooks);

				if (!result.success) {
					throw new Error(result.message || '文件下载失败');
				}

				showInfo(`文件 "${fileWithPath.name}" 下载完成`);
			} else {
				const blob = await service.downloadFile({
					filePath: resolvedPath,
					filename: fileWithPath.name,
					fileSize: fileWithPath.size,
					onProgress: (progress: FileProgress) => {
						if (this.isOperationCancelled()) {return;}
						this.setOperationProgress(progress.percent, progress);
					}
				});
				const saved = await saveFile(blob, fileWithPath.name, confirmedPath || undefined);
				if (saved) {
					showInfo(`文件 "${fileWithPath.name}" 下载完成`);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : '下载失败';
			showError(`下载失败: ${message}`);
		} finally {
			this.clearOperation();
			this.updateUI();
		}
	}

	private async handlePreview(file: FileItem): Promise<void> {
		const service = this.currentConnectionService;
		if (!service) {return;}

		try {
			const { fileWithPath, path: resolvedPath } = resolveFile(file, { currentPath: this.appState.currentPath });

			this.previewFileItem = fileWithPath;
			this.previewDialogVisible = true;
			this.previewLoading = true;
			this.previewError = '';
			this.previewContent = '';

			this.updatePreviewDialog();

			const blob = await service.downloadFile({
				filePath: resolvedPath,
				filename: fileWithPath.name,
				fileSize: fileWithPath.size,
				onProgress: () => {}
			});

			const text = await blob.text();
			this.previewContent = text;
			this.previewLoading = false;
			this.updatePreviewDialog();
		} catch (error) {
			const message = error instanceof Error ? error.message : '预览失败';
			this.previewError = message;
			this.previewLoading = false;
			showError(`预览失败: ${message}`);
			this.updatePreviewDialog();
		}
	}

	// Dialog management
	private openConnectionDialog(source = 'manual'): void {
		this.connectionDialogVisible = true;
		const dialog = document.getElementById('connection-dialog');
		if (dialog) {
			dialog.classList.add('show');
		}
		this.syncConnectionPanelState(`dialog-open:${source}`);
	}

	private closeConnectionDialog(source = 'manual'): void {
		this.connectionDialogVisible = false;
		const dialog = document.getElementById('connection-dialog');
		if (dialog) {
			dialog.classList.remove('show');
		}
		this.logger.info('Connection dialog closed', { source });
	}

	private closePreviewDialog(): void {
		this.previewDialogVisible = false;
		const dialog = document.getElementById('file-preview-dialog');
		if (dialog) {
			dialog.classList.remove('show');
		}
	}

	private updatePreviewDialog(): void {
		const dialog = document.getElementById('file-preview-dialog');
		if (dialog) {
			dialog.classList.toggle('show', this.previewDialogVisible);
		}

		if (this.filePreview) {
			this.filePreview.update({
				fileItem: this.previewFileItem,
				content: this.previewContent,
				loading: this.previewLoading,
				error: this.previewError
			});
		}
	}

	// Explorer toolbar handlers
	private handleExplorerGoBack(): void {
		this.fileExplorer?.goBack();
	}

	private handleExplorerRefresh(): void {
		this.fileExplorer?.refreshFiles();
	}

	// File operations (continued)
	private async handleRename(oldPath: string, newPath: string, operation: 'rename' | 'move' = 'rename'): Promise<void> {
		const service = this.currentConnectionService;
		if (!service) {return;}

		try {
			const isMove = operation === 'move';
			this.setOperation(isMove ? '正在移动...' : '正在重命名...', true);

			const result = await service.renameFile(oldPath, newPath);

			if (result.success) {
				if (isMove) {
					showInfo('移动成功');
					this.logger.info('File moved', { oldPath, newPath });
				} else {
					showInfo('重命名成功');
					this.logger.info('File renamed', { oldPath, newPath });
				}
				await this.loadFiles(this.appState.currentPath);
			} else {
				throw new Error(result.message);
			}
		} catch (error) {
			const isMove = operation === 'move';
			const fallback = isMove ? '移动失败' : '重命名失败';
			const message = error instanceof Error ? error.message : fallback;
			showError(message);
			this.logger.error(isMove ? 'Move failed' : 'Rename failed', { oldPath, newPath, error: message });
		} finally {
			this.clearOperation();
			this.updateUI();
		}
	}

	private handleMove(oldPath: string, newPath: string): Promise<void> {
		return this.handleRename(oldPath, newPath, 'move');
	}

	private async handleMoveBatch(operations: MoveOperation[]): Promise<void> {
		const service = this.currentConnectionService;
		if (!service || operations.length === 0) {
			return;
		}

		try {
			this.setOperation(`正在移动 ${operations.length} 项...`, true, 0, {
				transport: this.appState.currentConnection?.type ?? null
			});

			for (let index = 0; index < operations.length; index++) {
				const { oldPath, newPath } = operations[index];
				const result = await service.renameFile(oldPath, newPath);
				if (!result.success) {
					throw new Error(result.message || `移动失败: ${oldPath}`);
				}
				this.setOperationProgress(Math.round(((index + 1) / operations.length) * 100));
				this.logger.info('File moved', { oldPath, newPath, batch: true, index: index + 1, total: operations.length });
			}

			showInfo(`成功移动 ${operations.length} 项`);
			await this.loadFiles(this.appState.currentPath);
		} catch (error) {
			const message = error instanceof Error ? error.message : '移动失败';
			showError(message);
			this.logger.error('Batch move failed', { operations, error: message });
		} finally {
			this.clearOperation();
			this.updateUI();
		}
	}

	private async handleDelete(file: FileItem): Promise<void> {
		const service = this.currentConnectionService;
		if (!service) {return;}

		try {
			this.setOperation(`正在删除 ${file.name}`, true);

			const result = await service.deleteFile(file.path);

			if (result.success) {
				showInfo(`"${file.name}" 删除成功`);
				await this.loadFiles(this.appState.currentPath);
				this.logger.info('File deleted', { filename: file.name, path: file.path });
			} else {
				throw new Error(result.message);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : '删除失败';
			showError(message);
			this.logger.error('Delete failed', { filename: file.name, error: message });
		} finally {
			this.clearOperation();
			this.updateUI();
		}
	}

	private async handleCreateFolder(path: string, name: string): Promise<void> {
		const service = this.currentConnectionService;
		if (!service) {return;}

		try {
			this.setOperation(`正在创建文件夹 ${name}`, true);

			const folderPath = path === '/' ? `/${name}` : `${path}/${name}`;
			const result = await service.createDirectory(folderPath);

			if (result.success) {
				showInfo(`文件夹 "${name}" 创建成功`);
				await this.loadFiles(this.appState.currentPath);
				this.logger.info('Folder created', { name, path: folderPath });
			} else {
				throw new Error(result.message);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : '创建文件夹失败';
			showError(message);
			this.logger.error('Create folder failed', { name, error: message });
		} finally {
			this.clearOperation();
			this.updateUI();
		}
	}

	private handleRefresh(): void {
		this.loadFiles(this.appState.currentPath);
	}

	private async handleFolderUpload(files: File[], targetPath: string): Promise<void> {
		const service = this.currentConnectionService;
		if (!service) {return;}

		// 清理刷新定时器
		if (this.pendingRefreshTimer !== null) {
			window.clearTimeout(this.pendingRefreshTimer);
			this.pendingRefreshTimer = null;
		}
		this.pendingRefreshPath = null;
		this.pendingRefreshTransport = null;

		const results: Array<{ file: File; success: boolean; error?: string }> = [];
		const selectionTimestamp = new Date().toISOString();

		this.setOperation(`正在上传 ${files.length} 个文件...`, true, 0, { direction: 'upload' });
		const operationHooks = this.createOperationHooks();

		try {
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				try {
					if (this.isOperationCancelled()) {
						throw new Error('操作已取消');
					}
					this.setOperationProgress(Math.round((i / files.length) * 100));

					const result = await service.uploadFile({
						file,
						targetPath,
						selectedAt: selectionTimestamp,
						onProgress: (progress: FileProgress) => {
							const overallProgress = ((i / files.length) + (progress.percent / 100 / files.length)) * 100;
							this.setOperationProgress(Math.round(overallProgress), progress);
						}
					}, operationHooks);

					if (result.success) {
						results.push({ file, success: true });
					} else {
						if (result.message === '操作已取消') {
							throw new Error('操作已取消');
						}
						results.push({ file, success: false, error: result.message });
					}
				} catch (error) {
					if (error instanceof Error && error.message === '操作已取消') {
						throw error;
					}
					results.push({
						file,
						success: false,
						error: error instanceof Error ? error.message : '上传失败'
					});
				}
			}

			// 刷新文件列表
			this.schedulePostUploadRefresh(this.appState.currentPath);

			// 显示结果
			const successCount = results.filter(r => r.success).length;
			const failCount = results.filter(r => !r.success).length;

			if (failCount === 0) {
				showInfo(`成功上传 ${successCount} 个文件`);
			} else {
				showError(`上传完成: 成功 ${successCount} 个，失败 ${failCount} 个`);
			}

			this.logger.info('Folder upload completed', { successCount, failCount, targetPath });
		} catch (error) {
			if (error instanceof Error && error.message === '操作已取消') {
				showInfo('已取消上传');
				this.logger.info('Folder upload cancelled by user', { targetPath });
			} else {
				showError('上传失败');
				this.logger.error('Folder upload failed', { error, targetPath });
			}
		} finally {
			this.clearOperation();
			this.updateUI();
		}
	}

	private handleExplorerToolbarStateChange(state: FileExplorerToolbarState): void {
		this.explorerToolbarState = state;
		// Update toolbar buttons state
		const toolbar = document.getElementById('file-actions-toolbar');
		if (toolbar) {
			const buttons = {
				'btn-go-back': state.canGoBack && !state.loading,
				'btn-refresh': !state.loading,
				'btn-create-folder': state.canCreateFolder,
				'btn-upload': state.canUpload,
				'btn-preview': state.canBatchPreview,
				'btn-download': state.canBatchDownload,
				'btn-rename': state.canBatchRename,
				'btn-move': state.canBatchMove,
				'btn-delete': state.canBatchDelete
			};

			Object.entries(buttons).forEach(([id, enabled]) => {
				const btn = document.getElementById(id) as HTMLButtonElement;
				if (btn) {
					btn.disabled = !enabled;
				}
			});
		}
	}

	private schedulePostUploadRefresh(path: string): void {
		const targetPath = path || '/';
		const activeTransport = this.appState.currentConnection?.type ?? null;

		if (!activeTransport || !this.refreshSensitiveTransports.has(activeTransport)) {
			void this.loadFiles(targetPath, { silent: true });
			return;
		}

		this.pendingRefreshPath = targetPath;
		this.pendingRefreshTransport = activeTransport;
		if (this.pendingRefreshTimer !== null) {
			window.clearTimeout(this.pendingRefreshTimer);
		}

		const definition = activeTransport ? getTransportDefinition(activeTransport as TransportKind) : undefined;
		const delay = definition?.postUploadRefreshDelay ?? 450;

		this.pendingRefreshTimer = window.setTimeout(async () => {
			this.pendingRefreshTimer = null;
			const refreshPath = this.pendingRefreshPath ?? targetPath;
			const expectedTransport = this.pendingRefreshTransport ?? activeTransport;
			this.pendingRefreshPath = null;
			this.pendingRefreshTransport = null;

			const currentTransport = this.appState.currentConnection?.type ?? null;
			if (expectedTransport && currentTransport && expectedTransport !== currentTransport) {
				this.schedulePostUploadRefresh(refreshPath);
				return;
			}

			if (this.uploadPickerActive || Date.now() < this.suppressRefreshUntil || this.refreshRunning) {
				this.pendingRefreshPath = refreshPath;
				this.pendingRefreshTransport = expectedTransport;
				this.schedulePostUploadRefresh(refreshPath);
				return;
			}

			this.refreshRunning = true;
			try {
				await this.loadFiles(refreshPath, { silent: true });
			} catch (error) {
				this.logger.error('Post upload refresh failed', { path: refreshPath, error });
			} finally {
				this.refreshRunning = false;
				if (this.pendingRefreshPath) {
					const queuedPath = this.pendingRefreshPath;
					this.pendingRefreshPath = null;
					this.pendingRefreshTransport = null;
					this.schedulePostUploadRefresh(queuedPath);
				}
			}
		}, delay);
	}

	private handleExplorerUpload(): void {
		this.fileExplorer?.handleUploadToCurrentFolder();
	}

	private handleExplorerBatchPreview(): void {
		this.fileExplorer?.handleBatchPreview();
	}

	private handleExplorerBatchDownload(): void {
		this.fileExplorer?.handleBatchDownload();
	}

	private handleExplorerBatchRename(): void {
		this.fileExplorer?.handleBatchRename();
	}

	private handleExplorerBatchMove(): void {
		this.fileExplorer?.handleBatchMove();
	}

	private handleExplorerBatchDelete(): void {
		this.fileExplorer?.handleBatchDelete();
	}

	private async triggerQuickConnect(): Promise<void> {
		if (this.appState.connectionStatus === ConnectionStatus.CONNECTED || this.appState.connectionStatus === ConnectionStatus.CONNECTING) {
			return;
		}

		try {
			const panel = await this.ensureConnectionPanelReady('quick-connect');
			const config = await panel.getValidatedConfig();
			await this.handleConnect(config);
		} catch (error) {
			const errorCode = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
			const message = error instanceof Error ? error.message : '请先完善连接配置';
			if (errorCode === 'VALIDATION_FAILED') {
				showWarning(message || '请先完善连接配置');
				this.openConnectionDialog('quick-connect-validation');
				return;
			}
			showError(message || '连接请求失败');
		}
	}

	private async triggerQuickDisconnect(): Promise<void> {
		if (this.appState.connectionStatus !== ConnectionStatus.CONNECTED || this.appState.connectionStatus === ConnectionStatus.CONNECTING) {
			return;
		}

		const confirmed = await UIMessageBox.confirm({
			title: '确认断开',
			message: '确定要断开当前连接吗？',
			confirmButtonText: '断开',
			cancelButtonText: '取消',
			type: 'warning'
		});

		if (!confirmed) {
			return;
		}

		await this.handleDisconnect();
	}

	// Operation management
	private createOperationToken(): OperationToken {
		return {
			cancelled: false,
			requestIds: new Set<string>(),
			cancelCallbacks: []
		};
	}

	private ensureOperationToken(): OperationToken {
		if (!this.operationToken) {
			this.operationToken = this.createOperationToken();
		}
		return this.operationToken;
	}

	private createOperationHooks(): OperationControlHooks {
		return {
			onOperationStart: (requestId: string) => {
				const token = this.ensureOperationToken();
				token.requestIds.add(requestId);
				this.operationCancelable = true;
			},
			registerCancelCallback: (callback: () => Promise<void> | void) => {
				const token = this.ensureOperationToken();
				token.cancelCallbacks.push(callback);
				this.operationCancelable = true;
			},
			isCancelled: () => this.isOperationCancelled()
		};
	}

	private isOperationCancelled(): boolean {
		return this.operationToken?.cancelled ?? false;
	}

	private async cancelCurrentOperation(): Promise<void> {
		const token = this.operationToken;
		if (!token || token.cancelled) {
			this.operationCancelable = false;
			this.updateUI();
			return;
		}

		token.cancelled = true;
		this.operationCancelable = false;

		const service = this.currentConnectionService;
		const tasks: Array<Promise<unknown>> = [];

		for (const callback of token.cancelCallbacks) {
			try {
				tasks.push(Promise.resolve(callback()));
			} catch (error) {
				tasks.push(Promise.reject(error));
			}
		}

		const serviceAny = service as any;
		if (serviceAny && typeof serviceAny.cancelBackendOperation === 'function') {
			for (const requestId of token.requestIds) {
				tasks.push(Promise.resolve(serviceAny.cancelBackendOperation(requestId)));
			}
			if (typeof serviceAny.cancelAllBackendOperations === 'function') {
				tasks.push(Promise.resolve(serviceAny.cancelAllBackendOperations()));
			}
		} else if (token.requestIds.size > 0) {
			for (const requestId of token.requestIds) {
				tasks.push(this.sendManualBackendCommand('backend.cancel.operation', { operationId: requestId }));
			}
			tasks.push(this.sendManualBackendCommand('backend.cancel.all', {}));
		}

		await Promise.allSettled(tasks);
		showInfo('已请求停止当前操作');
		this.updateUI();
	}

	private sendManualBackendCommand(command: string, data: unknown): Promise<void> {
		return new Promise((resolve) => {
			if (!isVSCodeAvailable()) {
				resolve();
				return;
			}

			const requestId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
			const handler = (event: MessageEvent) => {
				if (event.data?.requestId === requestId) {
					window.removeEventListener('message', handler);
					resolve();
				}
			};

			window.addEventListener('message', handler);

			const vscode = (window as any).vscode;
			if (vscode && typeof vscode.postMessage === 'function') {
				vscode.postMessage({ command, requestId, data });
			} else {
				postMessage(command, { ...data, requestId });
			}

			window.setTimeout(() => {
				window.removeEventListener('message', handler);
				resolve();
			}, 5000);
		});
	}

	private setOperation(
		operation: string,
		inProgress = false,
		progress: number | null = null,
		options?: {
            direction?: 'upload' | 'download';
            transport?: string | null;
        }
	): void {
		this.currentOperation = operation;
		this.operationInProgress = inProgress;
		this.operationProgress = progress;
		this.operationSpeed = null;
		this.lastOperationProgressSnapshot = null;
		this.operationDirection = options?.direction ?? null;
		this.operationTransport = options?.transport ? this.resolveTransportLabel(options.transport) : null;
        
		if (inProgress) {
			this.operationToken = this.createOperationToken();
			this.operationCancelable = false;
		} else {
			this.operationToken = null;
			this.operationCancelable = false;
		}
		this.updateUI();
	}

	private setOperationProgress(progress: number, progressInfo?: FileProgress): void {
		this.operationProgress = progress;

		if (progressInfo) {
			const now = Date.now();
			if (this.lastOperationProgressSnapshot) {
				const deltaBytes = progressInfo.loaded - this.lastOperationProgressSnapshot.loaded;
				const deltaTime = now - this.lastOperationProgressSnapshot.timestamp;
				if (deltaTime > 0 && deltaBytes >= 0) {
					this.operationSpeed = (deltaBytes / deltaTime) * 1000;
				}
			}
			this.lastOperationProgressSnapshot = { loaded: progressInfo.loaded, timestamp: now };
		}

		this.updateUI();
	}

	private clearOperation(): void {
		this.currentOperation = '';
		this.operationInProgress = false;
		this.operationProgress = null;
		this.operationSpeed = null;
		this.operationDirection = null;
		this.operationTransport = null;
		this.operationToken = null;
		this.operationCancelable = false;
		this.updateUI();
	}

	private resolveTransportLabel(transport?: string | null): string | null {
		const resolved = transport?.trim() || this.appState.currentConnection?.type;
		if (!resolved) {return null;}

		const definition = getTransportDefinition(resolved as TransportKind);
		if (definition) {
			return definition.statusBarLabel;
		}

		return resolved.toUpperCase();
	}

	// Message handling
	handleMessage(message: any): void {
		switch (message.command) {
			case 'ping':
				if ((window as any).vscode) {
					(window as any).vscode.postMessage({ command: 'pong' });
				}
				break;
			case 'extension.notification': {
				const level = message.data?.level ?? 'info';
				const rawContent = message.data?.message ?? message.text;
				const content = typeof rawContent === 'string' ? rawContent.trim() : '';
				if (!content) {return;}

				let moduleName: string | undefined;
				let displayMessage = content;
				const separatorIndex = content.indexOf(': ');
				if (separatorIndex > 0) {
					moduleName = content.slice(0, separatorIndex).trim();
					displayMessage = content.slice(separatorIndex + 2).trim() || displayMessage;
				}

				if (moduleName && this.ignoredExtensionNotificationModules.has(moduleName)) {
					return;
				}

				const now = Date.now();
				const recent = this.lastExtensionNotification;
				if (recent && recent.message === displayMessage && now - recent.timestamp < 1500) {
					return;
				}
				this.lastExtensionNotification = { message: displayMessage, timestamp: now };

				switch (level) {
					case 'error':
						showError(displayMessage);
						break;
					case 'warning':
						showInfo(displayMessage);
						break;
					default:
						showInfo(displayMessage);
						break;
				}
				break;
			}
		}
	}

	// Utility functions
	private joinDirectoryAndFilename(directory: string, filename: string): string {
		if (!directory) {return filename;}
		const trimmed = directory.trim();
		if (!trimmed) {return filename;}
		const endsWithSeparator = /[\\/]$/.test(trimmed);
		if (endsWithSeparator) {
			return `${trimmed}${filename}`;
		}
		const usesBackslash = trimmed.includes('\\') && !trimmed.includes('/');
		const separator = usesBackslash ? '\\' : '/';
		return `${trimmed}${separator}${filename}`;
	}

	dispose(): void {
		const service = this.currentConnectionService;
		if (service) {
			service.disconnect();
		}

		if (this.pendingRefreshTimer !== null) {
			window.clearTimeout(this.pendingRefreshTimer);
			this.pendingRefreshTimer = null;
		}

		this.connectionStateSubscription?.();
		this.logger.info('App disposed');
	}
}
