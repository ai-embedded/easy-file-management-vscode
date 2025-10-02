<template>
  <i18n-provider>
    <div id="app" class="app-container">
    <div class="app-toolbar">
      <div
        class="file-actions-toolbar"
        v-if="isConnected"
      >
        <el-tooltip :content="$t('ui.file.explorer.goBackTooltip')" placement="bottom">
          <el-button
            circle
            size="small"
            :icon="ArrowLeft"
            @click="handleExplorerGoBack"
            :disabled="!explorerToolbarState.canGoBack || explorerToolbarState.loading"
          />
        </el-tooltip>
        <el-tooltip :content="$t('ui.file.explorer.refreshTooltip')" placement="bottom">
          <el-button
            circle
            size="small"
            :icon="Refresh"
            @click="handleExplorerRefresh"
            :loading="explorerToolbarState.loading"
          />
        </el-tooltip>
        <el-tooltip :content="$t('ui.file.explorer.createFolderTooltip')" placement="bottom">
          <el-button
            circle
            size="small"
            :icon="FolderAdd"
            @click="handleExplorerCreateFolder"
            :disabled="!explorerToolbarState.canCreateFolder"
          />
        </el-tooltip>
        <el-tooltip :content="$t('ui.file.explorer.uploadTooltip')" placement="bottom">
          <el-button
            circle
            size="small"
            type="primary"
            :icon="Upload"
            @click="handleExplorerUpload"
            :disabled="!explorerToolbarState.canUpload"
          />
        </el-tooltip>
        <el-tooltip :content="$t('ui.file.explorer.previewTooltip')" placement="bottom">
          <el-button
            circle
            size="small"
            :icon="Document"
            @click="handleExplorerBatchPreview"
            :disabled="!explorerToolbarState.canBatchPreview"
          />
        </el-tooltip>
        <el-tooltip :content="$t('ui.file.explorer.downloadTooltip')" placement="bottom">
          <el-button
            circle
            size="small"
            :icon="Download"
            @click="handleExplorerBatchDownload"
            :disabled="!explorerToolbarState.canBatchDownload"
          />
        </el-tooltip>
        <el-tooltip :content="$t('ui.file.explorer.renameTooltip')" placement="bottom">
          <el-button
            circle
            size="small"
            :icon="Edit"
            @click="handleExplorerBatchRename"
            :disabled="!explorerToolbarState.canBatchRename"
          />
        </el-tooltip>
        <el-tooltip :content="$t('ui.file.explorer.moveTooltip')" placement="bottom">
          <el-button
            circle
            size="small"
            :icon="Rank"
            @click="handleExplorerBatchMove"
            :disabled="!explorerToolbarState.canBatchMove"
          />
        </el-tooltip>
        <el-tooltip :content="$t('ui.file.explorer.deleteTooltip')" placement="bottom">
          <el-button
            circle
            size="small"
            type="danger"
            :icon="Delete"
            @click="handleExplorerBatchDelete"
            :disabled="!explorerToolbarState.canBatchDelete"
          />
        </el-tooltip>
      </div>

      <div class="toolbar-spacer"></div>
      <el-tooltip :content="$t('ui.connection.title')" placement="bottom">
        <el-button
          class="settings-button"
          circle
          type="primary"
          @click="openConnectionDialog('toolbar')"
        >
          ⚙️
        </el-button>
      </el-tooltip>

      <el-tooltip :content="$t('ui.connection.quickConnect')" placement="bottom">
        <el-button
          class="toolbar-action-button"
          type="success"
          :loading="isConnectingState"
          :disabled="isConnected || isConnectingState"
          @click="triggerQuickConnect"
        >
          {{ connectButtonLabel }}
        </el-button>
      </el-tooltip>

      <el-tooltip :content="$t('ui.common.disconnect')" placement="bottom">
        <el-button
          class="toolbar-action-button"
          type="danger"
          :disabled="!isConnected || isConnectingState"
          @click="triggerQuickDisconnect"
        >
          {{ $t('ui.common.disconnect') }}
        </el-button>
      </el-tooltip>
    </div>

    <!-- {{ $t('ui.hardcoded.comments.mainContent') }} -->
    <div class="main-content">
      
      <!-- {{ $t('ui.hardcoded.comments.fileManagement') }} -->
      <div class="file-management-section" v-if="appState.connectionStatus === 'connected'">
        <!-- {{ $t('ui.hardcoded.comments.fileExplorer') }} -->
        <FileExplorer
          ref="fileExplorerRef"
          :files="appState.fileList"
          :current-path="appState.currentPath"
          :connected="isConnected"
          :loading="appState.loading"
          :show-permissions="showPermissions"
          @path-change="handlePathChange"
          @download="handleDownload"
          @preview="handlePreview"
          @rename="handleRename"
          @move="handleMove"
          @move-batch="handleMoveBatch"
          @delete="handleDelete"
          @create-folder="handleCreateFolder"
          @refresh="handleRefresh"
          @upload="handleFolderUpload"
          @pre-upload-dialog-open="handlePreUploadDialogOpen"
          @post-upload-dialog-close="handlePostUploadDialogClose"
          @toolbar-state-change="handleExplorerToolbarStateChange"
        />
      </div>

      <!-- {{ $t('ui.hardcoded.comments.notConnectedHint') }} -->
      <div class="disconnected-hint" v-else-if="appState.connectionStatus === 'disconnected'">
        <el-empty
          :description="$t('ui.messages.info.pleaseWait') + ' ⚙️ ' + $t('ui.connection.title')"
        >
          <el-button type="primary" @click="openConnectionDialog('empty-state')">
            {{ $t('ui.connection.title') }}
          </el-button>
        </el-empty>
      </div>

      <!-- {{ $t('ui.hardcoded.comments.connectingHint') }} -->
      <div class="connecting-hint" v-else-if="appState.connectionStatus === 'connecting'">
        <el-result icon="info" :title="$t('ui.common.connecting')" :sub-title="$t('ui.messages.info.processing')">
          <template #extra>
            <el-button @click="cancelConnection" :loading="true">{{ $t('ui.common.cancel') }}</el-button>
          </template>
        </el-result>
      </div>

      <!-- {{ $t('ui.hardcoded.comments.connectionErrorHint') }} -->
      <div class="error-hint" v-else-if="appState.connectionStatus === 'error'">
        <el-result icon="error" :title="$t('ui.messages.errors.connectionFailed')" :sub-title="appState.error || $t('ui.messages.errors.networkError')">
          <template #extra>
            <el-button type="primary" @click="retryConnection">{{ $t('ui.common.connect') }}</el-button>
            <el-button @click="resetConnection">{{ $t('ui.common.reset') }}</el-button>
          </template>
        </el-result>
      </div>
    </div>

    <!-- {{ $t('ui.hardcoded.comments.statusBar') }} -->
    <StatusBar
      :connection-status="appState.connectionStatus"
      :server-info="serverInfo"
      :current-path="appState.currentPath"
      :current-operation="currentOperation"
      :operation-in-progress="operationInProgress"
      :operation-progress="operationProgress"
      :operation-speed="operationSpeed"
      :operation-direction="operationDirection"
      :operation-transport="operationTransport"
      :operation-cancelable="operationCancelable"
      :file-stats="fileStats"
      :network-stats="networkStats"
      :show-file-stats="true"
      :show-network-stats="false"
      :show-time="true"
      @cancel-operation="cancelCurrentOperation"
    />

    <!-- {{ $t('ui.hardcoded.comments.filePreviewDialog') }} -->
    <FilePreview
      v-model="previewDialogVisible"
      :file-item="previewFileItem"
      :content="previewContent"
      :loading="previewLoading"
      :error="previewError"
      @download="handleDownload"
      @refresh="handlePreviewRefresh"
    />

    <!-- {{ $t('ui.hardcoded.comments.globalLoadingMask') }} -->
    <el-loading
      v-model:visible="globalLoading"
      :element-loading-text="$t('ui.components.loadingTexts.processing')"
      element-loading-background="rgba(0, 0, 0, 0.7)"
      whole-container
    />

    <el-dialog
      v-model="connectionDialogVisible"
      :title="$t('ui.connection.title')"
      width="720px"
      append-to-body
      :close-on-click-modal="false"
      class="connection-dialog"
      @open="handleConnectionDialogOpen"
      @close="handleConnectionDialogClose"
    >
      <ConnectionPanel
        ref="connectionPanelRef"
        @connect="handleConnect"
        @disconnect="handleDisconnect"
        @connection-status-change="handleConnectionStatusChange"
        @download-settings-change="handleDownloadSettingsChange"
      />
    </el-dialog>
    </div>
  </i18n-provider>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { ElMessage, ElNotification, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import {
  ArrowLeft,
  Refresh,
  FolderAdd,
  Upload,
  Document,
  Download,
  Edit,
  Delete,
  Rank
} from '@element-plus/icons-vue';
import type { FileExplorerToolbarState } from './components/FileExplorer.vue';
import ConnectionPanel from './components/ConnectionPanel.vue';
import FileExplorer from './components/FileExplorer.vue';
import FilePreview from './components/FilePreview.vue';
import StatusBar from './components/StatusBar.vue';
import I18nProvider from './components/I18nProvider.vue';
import { createConnectionService } from './services/ServiceFactory';
import type { IConnectionService } from './services/interfaces/IConnectionService';
import type { OperationControlHooks } from './services/bridge/BaseBridgeService';
import type { ConnectionConfig, FileItem, FileOperationResult, UploadConfig, DownloadConfig } from '../shared/types';
import { ConnectionStatus } from '../shared/types';
import { AppState, FileProgress, NotificationType } from './types';
import { onMessage, showError, showInfo, log } from './utils/messageUtils';
import { formatFileSize } from './utils/fileUtils';
import { resolveFile, resolveDirectoryPath } from './utils/fileTransfer';
import { saveFile, showSaveDialog, isVSCodeAvailable } from './utils/vscode';
import { summarizeConnectionConfig } from '../shared/utils/connectionSummary';
import { getTransportDefinitions, getTransportDefinition, type TransportKind } from '../shared/transport';

// {{ $t('ui.hardcoded.comments.useI18n') }}
const { t } = useI18n();

// {{ $t('ui.hardcoded.comments.componentRefs') }}
type ConnectionPanelExpose = {
	setConnectionStatus: (status: ConnectionStatus) => void;
	setConnecting: (connecting: boolean) => void;
	getValidatedConfig: () => Promise<ConnectionConfig>;
	getDownloadSettings: () => { defaultDownloadPath: string | null };
};

interface MoveOperation {
	oldPath: string;
	newPath: string;
}

const joinDirectoryAndFilename = (directory: string, filename: string): string => {
  if (!directory) {
    return filename;
  }
  const trimmed = directory.trim();
  if (!trimmed) {
    return filename;
  }
  const endsWithSeparator = /[\\/]$/.test(trimmed);
  if (endsWithSeparator) {
    return `${trimmed}${filename}`;
  }
  const usesBackslash = trimmed.includes('\\') && !trimmed.includes('/');
  const separator = usesBackslash ? '\\' : '/';
  return `${trimmed}${separator}${filename}`;
};

const connectionPanelRef = ref<ConnectionPanelExpose | null>(null);
const fileExplorerRef = ref<InstanceType<typeof FileExplorer> | null>(null);
const VALIDATION_ERROR_CODE = 'VALIDATION_FAILED';

// {{ $t('ui.hardcoded.comments.remoteConfigDialog') }}
const connectionDialogVisible = ref(false);
const pendingConnectionStatus = ref<ConnectionStatus | null>(ConnectionStatus.DISCONNECTED);
const pendingConnectingState = ref<boolean | null>(false);
const defaultDownloadDirectory = ref<string | null>(null);

// {{ $t('ui.hardcoded.comments.appState') }}
const appState = reactive<AppState>({
  connectionStatus: ConnectionStatus.DISCONNECTED,
  currentPath: '/',
  fileList: [],
  loading: false,
  error: undefined,
  currentConnection: undefined
});

// {{ $t('ui.hardcoded.comments.otherReactiveData') }}
const currentConnectionService = ref<IConnectionService | null>(null);
const connectionStateSubscription = ref<(() => void) | null>(null);
const connectionErrorHandledByEvent = ref(false);
const ignoredExtensionNotificationModules = new Set(['RequestTracer', 'Extension:Webview', 'TcpClient', 'MessageRouter']);
const lastExtensionNotification = ref<{ message: string; timestamp: number } | null>(null);

const getConnectionTargetLabel = (connection?: ConnectionConfig | null): string => {
	if (!connection) {return '';} // {{ $t('ui.hardcoded.hardcodedText.noConnection') }}
	if (connection.type === 'serial') {
		return connection.path ? `${t('ui.hardcoded.hardcodedText.serialPort')} ${connection.path}` : t('ui.hardcoded.hardcodedText.serialDevice');
	}
	const host = connection.host?.trim();
	const port = Number.isFinite(connection.port) ? String(connection.port) : '';
	if (host && port) {
		return `${host}:${port}`;
	}
	return host || '';
};

const formatConnectionErrorMessage = (
	raw: unknown,
	connection?: ConnectionConfig | null
): string => {
	const rawText = typeof raw === 'string'
		? raw
		: raw instanceof Error
			? raw.message
			: '';
	const message = rawText.trim();
	const target = getConnectionTargetLabel(connection);
	const withTargetSuffix = (text: string): string => {
		if (target && !text.includes(target)) {
			return `${text}（${t('ui.hardcoded.hardcodedText.targetSuffix', { target })}）`;
		}
		return text;
	};

	if (/ECONNREFUSED/i.test(message)) {
		return target
			? `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.connectionRefused', { target })}`
			: `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.connectionRefusedGeneral')}`;
	}

	if (/ETIMEDOUT|ETIMEOUT/i.test(message)) {
		return target
			? `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.connectionTimeout', { target })}`
			: `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.connectionTimeoutGeneral')}`;
	}

	if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
		return `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.dnsError')}`;
	}

	if (/ECONNRESET/i.test(message)) {
		return `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.connectionReset')}`;
	}

	if (/EHOSTUNREACH/i.test(message)) {
		return `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.networkUnreachable')}`;
	}

	if (/EACCES/i.test(message)) {
		return `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.accessDenied')}`;
	}

	if (!message) {
		return target
			? `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.connectionFailedWithTarget', { target })}`
			: `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.connectionFailedGeneral')}`;
	}

	const normalized = message.replace(new RegExp(`^${t('ui.hardcoded.hardcodedText.connectionError')}[:：]?\\s*`, 'i'), '').trim();
	if (!normalized) {
		return target
			? `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.connectionFailedWithTarget', { target })}`
			: `${t('ui.hardcoded.hardcodedText.connectionFailed')}：${t('ui.hardcoded.hardcodedText.connectionFailedGeneral')}`;
	}

	return withTargetSuffix(`${t('ui.hardcoded.hardcodedText.connectionFailed')}：${normalized}`);
};

const currentOperation = ref<string>('');
const operationInProgress = ref(false);
const operationProgress = ref<number | null>(null);
const operationSpeed = ref<number | null>(null);
const operationDirection = ref<'upload' | 'download' | null>(null);
const operationTransport = ref<string | null>(null);
let lastOperationProgressSnapshot: { loaded: number; timestamp: number } | null = null;
interface OperationToken {
	cancelled: boolean;
	requestIds: Set<string>;
	cancelCallbacks: Array<() => Promise<void> | void>;
}

const operationToken = ref<OperationToken | null>(null);
const operationCancelable = ref(false);
const getOperationCancelledMessage = () => t('ui.hardcoded.hardcodedText.operationCancelled');
const globalLoading = ref(false);

const defaultExplorerToolbarState: FileExplorerToolbarState = {
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

const explorerToolbarState = ref<FileExplorerToolbarState>(defaultExplorerToolbarState);

const handleExplorerToolbarStateChange = (state: FileExplorerToolbarState) => {
  explorerToolbarState.value = state;
};

const createOperationToken = (): OperationToken => ({
	cancelled: false,
	requestIds: new Set<string>(),
	cancelCallbacks: []
});

const ensureOperationToken = (): OperationToken => {
	if (!operationToken.value) {
		operationToken.value = createOperationToken();
	}
	return operationToken.value;
};

const registerOperationRequestId = (requestId: string) => {
	const token = ensureOperationToken();
	token.requestIds.add(requestId);
	operationCancelable.value = true;
};

const registerOperationCancelCallback = (callback: () => Promise<void> | void) => {
	const token = ensureOperationToken();
	token.cancelCallbacks.push(callback);
	operationCancelable.value = true;
};

const isOperationCancelled = () => operationToken.value?.cancelled ?? false;

const assertOperationNotCancelled = () => {
	if (isOperationCancelled()) {
		throw new Error(getOperationCancelledMessage());
	}
};

const createOperationHooks = (): OperationControlHooks => ({
	onOperationStart: registerOperationRequestId,
	registerCancelCallback: registerOperationCancelCallback,
	isCancelled: isOperationCancelled
});

const sendManualBackendCommand = (command: string, data: unknown): Promise<void> => {
	return new Promise((resolve) => {
		if (!isVSCodeAvailable()) {
			return resolve();
		}
		const requestId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
		const handler = (event: MessageEvent) => {
			if (event.data?.requestId === requestId) {
				window.removeEventListener('message', handler);
				resolve();
			}
		};
		window.addEventListener('message', handler);
		window.vscode.postMessage({ command, requestId, data });
		setTimeout(() => {
			window.removeEventListener('message', handler);
			resolve();
		}, 5000);
	});
};

const cancelCurrentOperation = async () => {
	const token = operationToken.value;
	if (!token) {
		operationCancelable.value = false;
		return;
	}
	if (token.cancelled) {
		operationCancelable.value = false;
		return;
	}
	token.cancelled = true;
	operationCancelable.value = false;

	const service = getCurrentService();
	const cancellationTasks: Promise<unknown>[] = [];

	for (const callback of token.cancelCallbacks) {
		try {
			cancellationTasks.push(Promise.resolve(callback()));
		} catch (error) {
			cancellationTasks.push(Promise.reject(error));
		}
	}

	if (service && typeof (service as any).cancelBackendOperation === 'function') {
		for (const requestId of token.requestIds) {
			cancellationTasks.push((service as any).cancelBackendOperation(requestId));
		}
		if (typeof (service as any).cancelAllBackendOperations === 'function') {
			cancellationTasks.push((service as any).cancelAllBackendOperations());
		}
	} else if (token.requestIds.size > 0) {
		for (const requestId of token.requestIds) {
			cancellationTasks.push(sendManualBackendCommand('backend.cancel.operation', { operationId: requestId }));
		}
		cancellationTasks.push(sendManualBackendCommand('backend.cancel.all', {}));
	}

	await Promise.allSettled(cancellationTasks);
	ElMessage.info(t('ui.hardcoded.hardcodedText.requestStopTransfer'));
};

const handleExplorerGoBack = () => {
  if (!explorerToolbarState.value.canGoBack || explorerToolbarState.value.loading) return;
  fileExplorerRef.value?.goBack();
};

const handleExplorerRefresh = () => {
  fileExplorerRef.value?.refreshFiles();
};

const handleExplorerCreateFolder = () => {
  if (!explorerToolbarState.value.canCreateFolder) return;
  fileExplorerRef.value?.showCreateFolderDialog();
};

const handleExplorerUpload = () => {
  if (!explorerToolbarState.value.canUpload) return;
  fileExplorerRef.value?.handleUploadToCurrentFolder();
};

const handleExplorerBatchPreview = () => {
  if (!explorerToolbarState.value.canBatchPreview) return;
  fileExplorerRef.value?.handleBatchPreview();
};

const handleExplorerBatchDownload = () => {
  if (!explorerToolbarState.value.canBatchDownload) return;
  fileExplorerRef.value?.handleBatchDownload();
};

const handleExplorerBatchRename = () => {
  if (!explorerToolbarState.value.canBatchRename) return;
  fileExplorerRef.value?.handleBatchRename();
};

const handleExplorerBatchMove = () => {
  if (!explorerToolbarState.value.canBatchMove) return;
  fileExplorerRef.value?.handleBatchMove();
};

const handleExplorerBatchDelete = () => {
  if (!explorerToolbarState.value.canBatchDelete) return;
  fileExplorerRef.value?.handleBatchDelete();
};

let currentLoadToken: symbol | null = null;
let pendingRefreshTimer: number | null = null;
let pendingRefreshPath: string | null = null;
let pendingRefreshTransport: string | null = null;
let refreshRunning = false;

const refreshSensitiveTransports = new Set(
	getTransportDefinitions()
		.filter((definition) => definition.refreshSensitive)
		.map((definition) => definition.id)
);

// 抑制刷新（在文件选择对话框打开及其后短时间内，避免与选择回调竞争UI主线程）
let suppressRefreshUntil = 0;
const suppressRefreshFor = (ms: number): void => {
	const now = Date.now();
	suppressRefreshUntil = Math.max(suppressRefreshUntil, now + ms);
};

const handlePreUploadDialogOpen = (_payload: { targetPath: string; timestamp: string }) => {
	// 经验值：1.2s 基本覆盖一次快速的二次上传选择
	suppressRefreshFor(1200);
	// 直接使当前 loadFiles 结果失效，避免已在途刷新落地到 UI
	currentLoadToken = Symbol('cancel-due-to-upload-dialog');
	uploadPickerActive = true;
};

// 记录文件选择器是否打开，用于在刷新回调里判断是否延迟
let uploadPickerActive = false;
const handlePostUploadDialogClose = (_payload: { targetPath: string; timestamp: string; empty: boolean }) => {
	// 对话框已关闭，允许后续刷新，但给一个小缓冲避免刚关闭时主线程竞争
	uploadPickerActive = false;
	suppressRefreshFor(200);
};

const schedulePostUploadRefresh = (path: string): void => {
	const targetPath = path || '/';
	const activeTransport = appState.currentConnection?.type ?? null;

	if (!activeTransport || !refreshSensitiveTransports.has(activeTransport)) {
		void loadFiles(targetPath, { silent: true });
		return;
	}

	pendingRefreshPath = targetPath;
	pendingRefreshTransport = activeTransport;
	if (pendingRefreshTimer !== null) {
		window.clearTimeout(pendingRefreshTimer);
	}

	const definition = activeTransport ? getTransportDefinition(activeTransport as TransportKind) : undefined;
	const delay = definition?.postUploadRefreshDelay ?? 450;

	pendingRefreshTimer = window.setTimeout(async () => {
		pendingRefreshTimer = null;
		const refreshPath = pendingRefreshPath ?? targetPath;
		const expectedTransport = pendingRefreshTransport ?? activeTransport;
		pendingRefreshPath = null;
		pendingRefreshTransport = null;

		const currentTransport = appState.currentConnection?.type ?? null;
		if (expectedTransport && currentTransport && expectedTransport !== currentTransport) {
			// 连接类型已切换，按照当前连接重新调度
			schedulePostUploadRefresh(refreshPath);
			return;
		}

		// 若文件选择器处于打开阶段，则顺延刷新
		if (uploadPickerActive) {
			pendingRefreshPath = refreshPath;
			pendingRefreshTransport = expectedTransport;
			pendingRefreshTimer = window.setTimeout(() => {
				pendingRefreshTimer = null;
				schedulePostUploadRefresh(refreshPath);
			}, 300);
			return;
		}

		// 如果处于抑制窗口内，则顺延刷新，避免与文件选择回调竞争 UI 主线程
		const now = Date.now();
		if (now < suppressRefreshUntil) {
			const remaining = Math.max(50, suppressRefreshUntil - now + 50);
			pendingRefreshPath = refreshPath;
			pendingRefreshTransport = expectedTransport;
			pendingRefreshTimer = window.setTimeout(() => {
				pendingRefreshTimer = null;
				schedulePostUploadRefresh(refreshPath);
			}, remaining);
			return;
		}
		if (refreshRunning) {
			pendingRefreshPath = refreshPath;
			pendingRefreshTransport = expectedTransport;
			schedulePostUploadRefresh(refreshPath);
			return;
		}

		refreshRunning = true;
		try {
			await loadFiles(refreshPath, { silent: true, retryOnStale: true, expectedTransport });
		} catch (error) {
			console.error('[App.vue] 异步刷新文件列表失败', {
				path: refreshPath,
				error: error instanceof Error ? error.message : error
			});
		} finally {
			refreshRunning = false;
			if (pendingRefreshPath) {
				const queuedPath = pendingRefreshPath;
				pendingRefreshPath = null;
				pendingRefreshTransport = null;
				schedulePostUploadRefresh(queuedPath);
			}
		}
	}, delay);
};

// 工具函数：获取当前连接服务
const getCurrentService = () => currentConnectionService.value;
const maxFileSize = ref(100 * 1024 * 1024); // 100MB
const showPermissions = ref(false);

// 文件预览相关
const previewDialogVisible = ref(false);
const previewFileItem = ref<FileItem | null>(null);
const previewContent = ref<string>('');
const previewLoading = ref(false);
const previewError = ref<string>('');

// 计算属性
const isConnected = computed(() => appState.connectionStatus === ConnectionStatus.CONNECTED);
const isConnectingState = computed(() => appState.connectionStatus === ConnectionStatus.CONNECTING);

const connectButtonLabel = computed(() => {
	if (isConnectingState.value) {
		return t('ui.common.connecting');
	}
	if (isConnected.value) {
		return t('ui.common.connected');
	}
	return t('ui.common.connect');
});

const serverInfo = computed(() => {
  const service = getCurrentService();
  const config = service?.getConfig?.();
  if (!config) return undefined;
  
  if (config.type === 'serial') {
		return t('ui.hardcoded.hardcodedText.serialPortLabel', { baudRate: config.baudRate || 115200 });
  } else {
    return `${config.host}:${config.port}`;
  }
});

const fileStats = computed(() => {
  if (!appState.fileList.length) return undefined;
  
  const totalFiles = appState.fileList.filter(f => f.type === 'file').length;
  const totalDirectories = appState.fileList.filter(f => f.type === 'directory').length;
  const totalSize = appState.fileList
    .filter(f => f.type === 'file')
    .reduce((sum, f) => sum + f.size, 0);
  
  return {
    totalFiles: totalFiles + totalDirectories,
    totalDirectories,
    totalSize
  };
});

const networkStats = computed(() => {
  // 这里可以实现网络统计功能
  return undefined;
});

const attachServiceConnectionListener = (service: IConnectionService | null) => {
  connectionStateSubscription.value?.();
  connectionStateSubscription.value = null;
  if (service && service.onConnectionStateChange) {
    connectionStateSubscription.value = service.onConnectionStateChange((state, payload) => {
      handleServiceConnectionState(state as ConnectionStatus, payload);
    });
  }
};

const handleServiceConnectionState = (state: ConnectionStatus, payload?: any) => {
  const previousStatus = appState.connectionStatus;
	console.log(`[App.vue] ${t('ui.hardcoded.hardcodedText.serviceConnectionEvent')}: ${state}`, payload);

  switch (state) {
    case ConnectionStatus.CONNECTING: {
      appState.connectionStatus = ConnectionStatus.CONNECTING;
      updateConnectionPanelStatus(ConnectionStatus.CONNECTING, 'service-event');
      setConnectionPanelConnecting(true, 'service-event');
			setOperation(payload?.message || t('ui.hardcoded.hardcodedText.connectingToServer'), true);
      connectionErrorHandledByEvent.value = false;
      break;
    }
    case ConnectionStatus.CONNECTED: {
      connectionErrorHandledByEvent.value = false;
      appState.connectionStatus = ConnectionStatus.CONNECTED;
      updateConnectionPanelStatus(ConnectionStatus.CONNECTED, 'service-event');
      setConnectionPanelConnecting(false, 'service-event');
      clearOperation();
      if (connectionDialogVisible.value) {
        closeConnectionDialog('service-event');
      }
      break;
    }
	case ConnectionStatus.ERROR: {
		const message = formatConnectionErrorMessage(
			payload?.reason || payload?.error,
			appState.currentConnection
		);
		appState.connectionStatus = ConnectionStatus.ERROR;
		appState.error = message;
		updateConnectionPanelStatus(ConnectionStatus.ERROR, 'service-event');
		setConnectionPanelConnecting(false, 'service-event');
		clearOperation();
		if (!connectionErrorHandledByEvent.value) {
			ElMessage.error(message);
			connectionErrorHandledByEvent.value = true;
		}
		break;
	}
    case ConnectionStatus.DISCONNECTED: {
      const reason = payload?.reason;
      const source = payload?.source;
      const wasConnected = previousStatus === ConnectionStatus.CONNECTED;
      appState.connectionStatus = ConnectionStatus.DISCONNECTED;
      updateConnectionPanelStatus(ConnectionStatus.DISCONNECTED, 'service-event');
      setConnectionPanelConnecting(false, 'service-event');
      clearOperation();
      connectionErrorHandledByEvent.value = false;
			const manualDisconnect = source === 'manual-disconnect' || reason?.includes(t('ui.hardcoded.hardcodedText.userDisconnect'));
      if (wasConnected && !manualDisconnect) {
			ElMessage.warning(reason ? t('ui.hardcoded.hardcodedText.disconnectedWithReason', { reason }) : t('ui.hardcoded.hardcodedText.connectionDisconnected'));
      }
      break;
    }
    default:
      break;
  }
};

// 连接面板状态同步工具
const syncConnectionPanelState = (reason: string) => {
  const panel = connectionPanelRef.value;
  if (!panel) {
	console.warn(`[App.vue] ${t('ui.hardcoded.hardcodedText.cannotSyncPanel', { reason })}`);
    return;
  }

  const status = pendingConnectionStatus.value ?? ConnectionStatus.DISCONNECTED;
  const connecting = pendingConnectingState.value ?? false;
	console.log(`[App.vue] ${t('ui.hardcoded.hardcodedText.syncPanelStatus', { status, connecting, reason })}`);

  panel.setConnectionStatus(status);
  panel.setConnecting(connecting);
};

const updateConnectionPanelStatus = (status: ConnectionStatus, reason: string) => {
	pendingConnectionStatus.value = status;
	console.log(`[App.vue] ${t('ui.hardcoded.hardcodedText.recordStatusChange', { status, reason })}`);
	log('info', 'Connection panel status updated', {
		status,
		reason,
		connection: summarizeConnectionConfig(appState.currentConnection)
	});

  const panel = connectionPanelRef.value;
  if (panel) {
    panel.setConnectionStatus(status);
  }
};

const setConnectionPanelConnecting = (isConnecting: boolean, reason: string) => {
	pendingConnectingState.value = isConnecting;
	console.log(`[App.vue] ${t('ui.hardcoded.hardcodedText.recordProgressChange', { connecting: isConnecting ? t('ui.hardcoded.hardcodedText.inProgress') : t('ui.hardcoded.hardcodedText.idle'), reason })}`);
	log('info', 'Connection panel connecting flag updated', {
		isConnecting,
		reason,
		connection: summarizeConnectionConfig(appState.currentConnection)
	});

  const panel = connectionPanelRef.value;
  if (panel) {
    panel.setConnecting(isConnecting);
  }
};

const openConnectionDialog = (source: string = 'manual') => {
	log('info', 'Open connection dialog request', {
		source,
		connectionStatus: appState.connectionStatus,
		currentConnection: summarizeConnectionConfig(appState.currentConnection)
	});
	connectionDialogVisible.value = true;
};

const closeConnectionDialog = (source: string = 'manual') => {
	log('info', 'Close connection dialog request', {
		source,
		connectionStatus: appState.connectionStatus,
		currentConnection: summarizeConnectionConfig(appState.currentConnection)
	});
	connectionDialogVisible.value = false;
};

const handleConnectionDialogOpen = () => {
	log('info', 'Connection dialog opened', {
		connectionStatus: appState.connectionStatus,
		currentConnection: summarizeConnectionConfig(appState.currentConnection)
	});

	nextTick(() => syncConnectionPanelState('dialog-open'));
};

const handleConnectionDialogClose = () => {
	log('info', 'Connection dialog closed', {
		connectionStatus: appState.connectionStatus,
		currentConnection: summarizeConnectionConfig(appState.currentConnection)
	});
};

watch(() => connectionPanelRef.value, (panel) => {
	if (panel) {
		log('info', 'Connection panel reference ready', {
			connectionStatus: pendingConnectionStatus.value ?? ConnectionStatus.DISCONNECTED,
			connecting: pendingConnectingState.value ?? false,
			currentConnection: summarizeConnectionConfig(appState.currentConnection)
		});
		syncConnectionPanelState('ref-mounted');
		try {
			const settings = panel.getDownloadSettings?.();
			handleDownloadSettingsChange(settings?.defaultDownloadPath ?? null);
		} catch (error) {
			log('warn', 'Failed to synchronize download settings from panel', {
				error: error instanceof Error ? error.message : error
			});
		}
	}
});

watch(connectionDialogVisible, (visible) => {
	log('info', 'Connection dialog visibility changed', {
		visible,
		connectionStatus: appState.connectionStatus,
		currentConnection: summarizeConnectionConfig(appState.currentConnection)
	});
});

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitForConnectionPanelRef = async (timeout = 1500): Promise<ConnectionPanelExpose> => {
	const deadline = Date.now() + timeout;
	while (Date.now() <= deadline) {
		const panel = connectionPanelRef.value;
		if (panel?.getValidatedConfig) {
			return panel;
		}
		await nextTick();
		await delay(16);
	}

	throw new Error(t('ui.hardcoded.hardcodedText.panelInitTimeout'));
};

const ensureConnectionPanelReady = async (source: string): Promise<ConnectionPanelExpose> => {
	let panel = connectionPanelRef.value;
	if (panel?.getValidatedConfig) {
		return panel;
	}

	const dialogWasVisible = connectionDialogVisible.value;
	let dialogOpenedForInit = false;

	if (!dialogWasVisible) {
		openConnectionDialog(`auto-init:${source}`);
		dialogOpenedForInit = true;
	}

	try {
		panel = await waitForConnectionPanelRef();
		syncConnectionPanelState(`auto-init:${source}`);
		return panel;
	} catch (error) {
		log('error', 'Ensure connection panel ready failed', {
			source,
			error: error instanceof Error ? error.message : error
		});
		throw error;
	} finally {
		if (dialogOpenedForInit) {
			closeConnectionDialog(`auto-init:${source}`);
		}
	}
};

// 方法
const handleConnect = async (config: ConnectionConfig) => {
	try {
		appState.connectionStatus = ConnectionStatus.CONNECTING;
		appState.error = undefined;
		appState.currentConnection = config;
		updateConnectionPanelStatus(ConnectionStatus.CONNECTING, 'handleConnect-start');
		setConnectionPanelConnecting(true, 'handleConnect-start');
		
		// {{ $t('ui.hardcoded.comments.setOperation') }}
		setOperation(config.type === 'serial' ? t('ui.hardcoded.hardcodedText.connectingToSerial') : t('ui.hardcoded.hardcodedText.connectingToServer'), true);
		log('info', 'Connection attempt started', {
			source: 'handleConnect',
			connection: summarizeConnectionConfig(config)
		});
		
		// {{ $t('ui.hardcoded.comments.connectionType') }}
		currentConnectionService.value = createConnectionService(config.type);
		log('info', 'Connection service created', {
			type: config.type,
			serviceAvailable: Boolean(currentConnectionService.value)
		});
		attachServiceConnectionListener(currentConnectionService.value);
		connectionErrorHandledByEvent.value = false;

		// {{ $t('ui.hardcoded.comments.tryConnect') }}
		const success = await currentConnectionService.value.connect(config);
		
		if (success) {
			appState.connectionStatus = ConnectionStatus.CONNECTED;
			appState.currentPath = '/';
			
			// {{ $t('ui.hardcoded.comments.updateStatus') }}
			updateConnectionPanelStatus(ConnectionStatus.CONNECTED, 'handleConnect-success');
			setConnectionPanelConnecting(false, 'handleConnect-success');
			closeConnectionDialog('handleConnect-success');
			
			// {{ $t('ui.hardcoded.comments.successMessage') }}
			ElMessage.success({
				message: config.type === 'serial'
					? t('ui.hardcoded.hardcodedText.serialDeviceConnected', { baudRate: config.baudRate || 115200 })
					: t('ui.hardcoded.hardcodedText.serverConnected', { host: config.host, port: config.port }),
				duration: 2000,
				showClose: false
			});
			
			// {{ $t('ui.hardcoded.comments.loadRootFiles') }}
			await loadFiles('/');
			
			log('info', 'Connected to server', {
				connection: summarizeConnectionConfig(config)
			});
		} else {
			throw new Error(t('ui.hardcoded.hardcodedText.connectionFailedGeneric'));
		}
	} catch (error) {
		appState.connectionStatus = ConnectionStatus.ERROR;
		const friendlyError = formatConnectionErrorMessage(
			error instanceof Error ? error.message : error,
			config
		);
		appState.error = friendlyError;
		
		// {{ $t('ui.hardcoded.comments.updateStatus') }}
		updateConnectionPanelStatus(ConnectionStatus.ERROR, 'handleConnect-error');
		setConnectionPanelConnecting(false, 'handleConnect-error');
		
		if (!connectionErrorHandledByEvent.value) {
			ElMessage.error(friendlyError);
			connectionErrorHandledByEvent.value = true;
		}
		log('error', 'Connection failed', {
			error: friendlyError,
			rawError: error instanceof Error ? error.message : error,
			connection: summarizeConnectionConfig(config)
		});
		
		currentConnectionService.value = null;
		attachServiceConnectionListener(null);
	} finally {
		clearOperation();
		setConnectionPanelConnecting(false, 'handleConnect-finally');
		connectionErrorHandledByEvent.value = false;
  }
};

const handleDisconnect = async () => {
	try {
		const previousConnection = appState.currentConnection;
		const service = getCurrentService();
		if (service) {
			await service.disconnect();
			currentConnectionService.value = null;
		}
		attachServiceConnectionListener(null);
		
		appState.connectionStatus = ConnectionStatus.DISCONNECTED;
		appState.fileList = [];
		appState.currentPath = '/';
		appState.error = undefined;
		appState.currentConnection = undefined;
		connectionErrorHandledByEvent.value = false;
		
		// {{ $t('ui.hardcoded.comments.updateStatus') }}
		updateConnectionPanelStatus(ConnectionStatus.DISCONNECTED, 'handleDisconnect-success');
		setConnectionPanelConnecting(false, 'handleDisconnect-success');
		
		ElMessage.success(t('ui.hardcoded.hardcodedText.disconnectSuccess'));
		log('info', 'Disconnected from server', {
			previousConnection: summarizeConnectionConfig(previousConnection)
		});
	} catch (error) {
		ElMessage.error(t('ui.hardcoded.hardcodedText.disconnectFailed'));
		log('error', 'Disconnect failed', error);
	}
};

const triggerQuickConnect = async () => {
	if (isConnected.value || isConnectingState.value) {
		return;
	}

	try {
		const panel = await ensureConnectionPanelReady('quick-connect');
		const config = await panel.getValidatedConfig();
		await handleConnect(config);
	} catch (error) {
		const raw = typeof error === 'object' && error !== null ? error as { code?: string } : {};
		const errorCode = raw.code;
		const message = error instanceof Error ? error.message : t('ui.hardcoded.hardcodedText.completeConfigFirst');
		if (errorCode === VALIDATION_ERROR_CODE) {
			ElMessage.warning(message || t('ui.hardcoded.hardcodedText.completeConfigFirst'));
			openConnectionDialog('quick-connect-validation');
			return;
		}
		ElMessage.error(message || t('ui.hardcoded.hardcodedText.connectionRequestFailed'));
	}
};

const triggerQuickDisconnect = async () => {
	if (!isConnected.value || isConnectingState.value) {
		return;
	}

	try {
		await ElMessageBox.confirm(
			'确定要断开当前连接吗？',
			'确认断开',
			{
				confirmButtonText: '断开',
				cancelButtonText: '取消',
				type: 'warning'
			}
		);
	} catch {
		return;
	}

	await handleDisconnect();
};

const handleConnectionStatusChange = (status: ConnectionStatus) => {
	appState.connectionStatus = status;
	updateConnectionPanelStatus(status, 'panel-event');
	setConnectionPanelConnecting(status === ConnectionStatus.CONNECTING, 'panel-event');
	log('info', 'Connection status changed via panel', {
		status,
		connection: summarizeConnectionConfig(appState.currentConnection)
	});
};

interface LoadFilesOptions {
	silent?: boolean;
	expectedTransport?: string | null;
	retryOnStale?: boolean;
}

const loadFiles = async (path: string, options: LoadFilesOptions = {}) => {
	const { silent = false, expectedTransport = null, retryOnStale = false } = options;
	const service = getCurrentService();
	if (!service) {return;}

	const activeTransport = appState.currentConnection?.type ?? null;
	if (expectedTransport && expectedTransport !== activeTransport) {
		console.warn('[App.vue] 跳过刷新，连接类型已变化', {
			expectedTransport,
			activeTransport,
			path
		});
		return;
	}

  const loadToken = Symbol('loadFiles');
  currentLoadToken = loadToken;

  try {
    const basePath = resolveDirectoryPath(path, { currentPath: appState.currentPath });

    if (!silent) {
      appState.loading = true;
      setOperation(`正在加载 ${basePath}`, true);
    }

    console.log(`[App.vue] 加载文件列表: 原始路径="${path}", 归一化路径="${basePath}"`);
    const files = await service.listFiles(basePath);
    const normalizedFiles = files.map(file => resolveFile(file, { currentPath: basePath }).fileWithPath);
    console.log('[App.vue] 接收到文件列表:', normalizedFiles.length, '个文件');

    if (currentLoadToken === loadToken) {
      appState.fileList = normalizedFiles;
      appState.currentPath = basePath;
    } else {
      console.warn('[App.vue] 放弃过期的文件列表加载结果', {
        path: basePath,
        discardedCount: normalizedFiles.length
      });
      if (retryOnStale && (!expectedTransport || expectedTransport === appState.currentConnection?.type)) {
		console.log('[App.vue] 检测到刷新结果过期，重新调度', {
			path: basePath,
			retry: true
		});
		schedulePostUploadRefresh(basePath);
	}
    }

    log('info', 'Files loaded', { path: basePath, count: normalizedFiles.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载文件列表失败';
    ElMessage.error(message);
    log('error', 'Load files failed', { path, error: message });
  } finally {
    if (currentLoadToken === loadToken) {
      if (!silent) {
        appState.loading = false;
        clearOperation();
      }
      currentLoadToken = null;
    }
  }
};

const handlePathChange = (path: string) => {
  loadFiles(path);
};

const handleDownload = async (file: FileItem) => {
  const service = getCurrentService();
  if (!service) return;

  const { fileWithPath, path: resolvedPath } = resolveFile(file, { currentPath: appState.currentPath });

  let confirmedPath: string | null | undefined;

    if (isVSCodeAvailable()) {
    try {
      const dialogOptions: {
        suggestedName: string;
        filters: { [name: string]: string[] };
        defaultUri?: string;
      } = {
        suggestedName: fileWithPath.name,
        filters: {
          'All Files': ['*']
        }
      };

      if (defaultDownloadDirectory.value) {
        dialogOptions.defaultUri = joinDirectoryAndFilename(defaultDownloadDirectory.value, fileWithPath.name);
      }

      confirmedPath = await showSaveDialog(dialogOptions);
    } catch (dialogError) {
      const message = dialogError instanceof Error ? dialogError.message : '保存对话框打开失败';
      ElMessage.error(`无法打开保存对话框: ${message}`);
      log('error', 'Save dialog failed', { filename: fileWithPath.name, error: message });
      return;
    }

    if (!confirmedPath) {
      ElMessage.info(`已取消 "${fileWithPath.name}" 的下载`);
      log('info', 'Download cancelled before start', { filename: fileWithPath.name });
      return;
    }

    log('info', 'Download target selected', { filename: fileWithPath.name, targetPath: confirmedPath });
  }

  try {
    setOperation(`正在下载 ${fileWithPath.name}`, true, 0, { direction: 'download' });
    const operationHooks = createOperationHooks();

    const requestConfig = {
      filePath: resolvedPath,
      filename: fileWithPath.name,
      fileSize: fileWithPath.size,
      onProgress: (progress: FileProgress) => {
        if (isOperationCancelled()) {return;}
        setOperationProgress(progress.percent, progress);
      }
    };

    if (confirmedPath) {
      const result = await service.downloadFileToPath({
        ...requestConfig,
        targetFile: confirmedPath
      }, operationHooks);

      if (!result.success) {
        if (result.message === getOperationCancelledMessage()) {
          ElMessage.info(`已取消 "${fileWithPath.name}" 的下载`);
          log('info', 'File download cancelled', { filename: fileWithPath.name, targetPath: confirmedPath });
          return;
        }
        throw new Error(result.message || '文件下载失败');
      }

      ElMessage.success(`文件 "${fileWithPath.name}" 下载完成`);
      log('info', 'File downloaded', { filename: fileWithPath.name, size: fileWithPath.size, targetPath: confirmedPath, mode: 'direct-save' });
    } else {
      const blob = await service.downloadFile(requestConfig);
      const saved = await saveFile(blob, fileWithPath.name, confirmedPath || undefined);
      assertOperationNotCancelled();

      if (saved) {
        ElMessage.success(`文件 "${fileWithPath.name}" 下载完成`);
        log('info', 'File downloaded', { filename: fileWithPath.name, size: fileWithPath.size, targetPath: confirmedPath, mode: 'webview-save' });
      } else {
        ElMessage.warning(`文件 "${fileWithPath.name}" 下载已取消`);
        log('warn', 'Download cancelled after transfer', { filename: fileWithPath.name, mode: 'webview-save' });
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === getOperationCancelledMessage()) {
      ElMessage.info(`已取消 "${fileWithPath.name}" 的下载`);
      log('info', 'Download cancelled by user', { filename: fileWithPath.name });
    } else {
      const message = error instanceof Error ? error.message : '下载失败';
      ElMessage.error(`下载失败: ${message}`);
      log('error', 'Download failed', { filename: fileWithPath.name, error: message });
    }
  } finally {
    clearOperation();
  }
};

const handlePreview = async (file: FileItem) => {
  const service = getCurrentService();
  if (!service) return;

  const { fileWithPath, path: resolvedPath } = resolveFile(file, { currentPath: appState.currentPath });
  
  try {
    previewFileItem.value = fileWithPath;
    previewDialogVisible.value = true;
    previewLoading.value = true;
    previewError.value = '';
    previewContent.value = '';
    
    // 检查文件大小，如果太大提供警告
    const maxPreviewSize = 10 * 1024 * 1024; // 10MB
    if (fileWithPath.size > maxPreviewSize) {
      const confirmed = await ElMessageBox.confirm(
        `文件 "${fileWithPath.name}" 较大 (${formatFileSize(fileWithPath.size)})，预览可能需要较长时间。是否继续？`,
        '文件预览',
        {
          confirmButtonText: '继续预览',
          cancelButtonText: '取消',
          type: 'warning'
        }
      );
      
      if (!confirmed) {
        previewDialogVisible.value = false;
        return;
      }
    }
    
    const blob = await service.downloadFile({
      filePath: resolvedPath,
      filename: fileWithPath.name,
      fileSize: fileWithPath.size,
      onProgress: (progress: FileProgress) => {
        // 这里可以显示下载进度，暂时省略
      }
    });

    // 将 Blob 转换为文本
    const text = await blob.text();
    previewContent.value = text;

    log('info', 'File previewed', { filename: fileWithPath.name, size: text.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : '预览失败';
    previewError.value = message;
    ElMessage.error(`预览失败: ${message}`);
    log('error', 'Preview failed', { filename: fileWithPath.name, error: message });
  } finally {
    previewLoading.value = false;
  }
};

const handlePreviewRefresh = (file: FileItem) => {
  handlePreview(file);
};

const handleRename = async (oldPath: string, newPath: string, operation: 'rename' | 'move' = 'rename') => {
  const service = getCurrentService();
  if (!service) return;
  
  try {
    const isMove = operation === 'move';
    setOperation(isMove ? '正在移动...' : '正在重命名...', true);
    
    const result = await service.renameFile(oldPath, newPath);
    
    if (result.success) {
      if (isMove) {
        ElMessage.success('移动成功');
        log('info', 'File moved', { oldPath, newPath });
      } else {
        ElMessage.success('重命名成功');
        log('info', 'File renamed', { oldPath, newPath });
      }
      await loadFiles(appState.currentPath);
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    const isMove = operation === 'move';
    const fallback = isMove ? '移动失败' : '重命名失败';
    const message = error instanceof Error ? error.message : fallback;
    ElMessage.error(message);
    log('error', isMove ? 'Move failed' : 'Rename failed', { oldPath, newPath, error: message });
  } finally {
    clearOperation();
  }
};

const handleMove = (oldPath: string, newPath: string) => {
	return handleRename(oldPath, newPath, 'move');
};

const handleMoveBatch = async (operations: MoveOperation[]) => {
	const service = getCurrentService();
	if (!service || operations.length === 0) {
		return;
	}

	try {
		setOperation(`正在移动 ${operations.length} 项...`, true);
		const total = operations.length;
		for (let index = 0; index < total; index++) {
			const { oldPath, newPath } = operations[index];
			const result = await service.renameFile(oldPath, newPath);
			if (!result.success) {
				throw new Error(result.message || `移动失败: ${oldPath}`);
			}
			setOperationProgress(Math.round(((index + 1) / total) * 100));
			log('info', 'File moved', { oldPath, newPath, batch: true, index: index + 1, total });
		}
		ElMessage.success(`成功移动 ${operations.length} 项`);
		await loadFiles(appState.currentPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : '移动失败';
		ElMessage.error(message);
		log('error', 'Batch move failed', { operations, error: message });
	} finally {
		clearOperation();
	}
};

const handleDelete = async (file: FileItem) => {
	const service = getCurrentService();
	if (!service) return;
  
  try {
    setOperation(`正在删除 ${file.name}`, true);
    
    const result = await service.deleteFile(file.path);
    
    if (result.success) {
      ElMessage.success(`"${file.name}" 删除成功`);
      await loadFiles(appState.currentPath);
      log('info', 'File deleted', { filename: file.name, path: file.path });
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除失败';
    ElMessage.error(message);
    log('error', 'Delete failed', { filename: file.name, error: message });
  } finally {
    clearOperation();
  }
};

const handleCreateFolder = async (path: string, name: string) => {
  const service = getCurrentService();
  if (!service) return;
  
  try {
    setOperation(`正在创建文件夹 ${name}`, true);
    
    const folderPath = path === '/' ? `/${name}` : `${path}/${name}`;
    const result = await service.createDirectory(folderPath);
    
    if (result.success) {
      ElMessage.success(`文件夹 "${name}" 创建成功`);
      await loadFiles(appState.currentPath);
      log('info', 'Folder created', { name, path: folderPath });
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建文件夹失败';
    ElMessage.error(message);
    log('error', 'Create folder failed', { name, error: message });
  } finally {
    clearOperation();
  }
};

const handleRefresh = () => {
  loadFiles(appState.currentPath);
};

const handleDownloadSettingsChange = (path: string | null) => {
  const normalized = path && path.trim() ? path.trim() : null;
  defaultDownloadDirectory.value = normalized;
  log('info', 'Default download directory updated', { path: normalized });
};

const handleFolderUpload = async (files: File[], targetPath: string) => {
  const service = getCurrentService();
  if (!service) return;
  // 新一轮上传开始，清理可能残留的刷新定时器，避免竞争
  if (pendingRefreshTimer !== null) {
    window.clearTimeout(pendingRefreshTimer);
    pendingRefreshTimer = null;
  }
  pendingRefreshPath = null;
  pendingRefreshTransport = null;

  const results: Array<{ file: File; success: boolean; error?: string }> = [];
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const selectionTimestamp = new Date().toISOString();
  console.log('[App.vue] handleFolderUpload invoked', {
    totalFiles: files.length,
    targetPath,
    fileNames: files.map(file => file.name),
    totalBytes,
    timestamp: selectionTimestamp
  });

  const currentTransport = appState.currentConnection?.type;
  if (currentTransport && refreshSensitiveTransports.has(currentTransport)) {
	log('info', `${currentTransport.toUpperCase()} files selected for upload`, {
		totalFiles: files.length,
		fileNames: files.map(file => file.name),
		totalBytes,
		targetPath,
		selectedAt: selectionTimestamp
	});
  }
  
  setOperation(`正在上传 ${files.length} 个文件...`, true, 0, { direction: 'upload' });
  const operationHooks = createOperationHooks();

  try {
    // 顺序上传文件
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        assertOperationNotCancelled();
        setOperationProgress(Math.round((i / files.length) * 100));
        console.log('[App.vue] 开始上传文件', {
          index: i + 1,
          total: files.length,
          name: file.name,
          size: file.size,
          targetPath,
          timestamp: new Date().toISOString()
        });

        const result = await service.uploadFile({
          file,
          targetPath,
          selectedAt: selectionTimestamp,
          onProgress: (progress: FileProgress) => {
            // 添加进度日志
            console.log(`[App.vue] 文件上传进度: ${file.name} - ${progress.percent}% (${progress.loaded}/${progress.total})`);
            
            const overallProgress = ((i / files.length) + (progress.percent / 100 / files.length)) * 100;
            setOperationProgress(Math.round(overallProgress), progress);
            
            // 添加状态栏更新日志
            console.log(`[App.vue] 更新状态栏进度: ${Math.round(overallProgress)}%`);
          }
        }, operationHooks);

        if (result.success) {
          results.push({ file, success: true });
        } else {
          if (result.message === getOperationCancelledMessage()) {
            throw new Error(getOperationCancelledMessage());
          }
          results.push({ file, success: false, error: result.message });
        }
      } catch (error) {
      if (error instanceof Error && error.message === getOperationCancelledMessage()) {
        throw error;
      }
      results.push({ 
        file, 
        success: false, 
        error: error instanceof Error ? error.message : '上传失败' 
      });
    }
  }

    assertOperationNotCancelled();

    // 刷新文件列表（异步执行，避免阻塞下一次上传）
    const refreshPath = appState.currentPath;
    schedulePostUploadRefresh(refreshPath);
    
    // 显示结果
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    if (failCount === 0) {
      ElNotification({
        title: '上传完成',
        message: `成功上传 ${successCount} 个文件`,
        type: 'success'
      });
    } else {
      const failures = results.filter(r => !r.success).map(item => ({
        name: item.file.name,
        error: item.error
      }));
      ElNotification({
        title: '上传完成',
        message: `成功 ${successCount} 个，失败 ${failCount} 个`,
        type: 'warning'
      });
      console.warn(`[App.vue] 上传失败详情: ${JSON.stringify(failures)}`);
      log('warn', 'Folder upload failures', { failures });
    }

    log('info', 'Folder upload completed', { successCount, failCount, targetPath });
  } catch (error) {
    if (error instanceof Error && error.message === getOperationCancelledMessage()) {
      ElMessage.info('已取消上传');
      log('info', 'Folder upload cancelled by user', { targetPath });
    } else {
      ElMessage.error('上传失败');
      log('error', 'Folder upload failed', { error, targetPath });
    }
  } finally {
    clearOperation();
  }
};


const resolveTransportLabel = (transport?: string | null): string | null => {
  const resolved = transport?.trim() || appState.currentConnection?.type;
  if (!resolved) return null;

  const definition = getTransportDefinition(resolved as TransportKind);
  if (definition) {
    return definition.statusBarLabel;
  }

  return resolved.toUpperCase();
};

const resetOperationMetrics = () => {
  operationSpeed.value = null;
  lastOperationProgressSnapshot = null;
};

const updateOperationSpeedFromProgress = (progress?: FileProgress) => {
  if (!progress) return;
  const { loaded } = progress;
  if (typeof loaded !== 'number' || Number.isNaN(loaded)) return;

  const direction = (progress as any).direction;
  if (direction === 'upload' || direction === 'download') {
    operationDirection.value = direction;
  }

  const transport = (progress as any).transport || (progress as any).protocol;
  const transportLabel = resolveTransportLabel(typeof transport === 'string' ? transport : null);
  if (transportLabel) {
    operationTransport.value = transportLabel;
  }

  const now = Date.now();

  if (lastOperationProgressSnapshot && loaded < lastOperationProgressSnapshot.loaded) {
    lastOperationProgressSnapshot = null;
  }

  if (!lastOperationProgressSnapshot) {
    lastOperationProgressSnapshot = { loaded, timestamp: now };
    operationSpeed.value = loaded > 0 ? 0 : null;
    return;
  }

  const deltaBytes = loaded - lastOperationProgressSnapshot.loaded;
  const deltaTimeMs = now - lastOperationProgressSnapshot.timestamp;

  lastOperationProgressSnapshot = { loaded, timestamp: now };

  if (deltaTimeMs <= 0) {
    return;
  }

  const speed = deltaBytes / (deltaTimeMs / 1000);
  operationSpeed.value = speed > 0 ? speed : 0;
};

const setOperation = (
  operation: string,
  inProgress: boolean = false,
  progress: number | null = null,
  options?: {
    direction?: 'upload' | 'download';
    transport?: string | null;
  }
) => {
  currentOperation.value = operation;
  operationInProgress.value = inProgress;
  operationProgress.value = progress;
  resetOperationMetrics();
  operationDirection.value = options?.direction ?? null;
  if (options && 'transport' in options) {
    operationTransport.value = resolveTransportLabel(options.transport);
  } else if (options?.direction) {
    operationTransport.value = resolveTransportLabel();
  } else {
    operationTransport.value = null;
  }
  if (inProgress) {
	operationToken.value = createOperationToken();
	operationCancelable.value = false;
  } else {
	operationToken.value = null;
	operationCancelable.value = false;
  }
};

const setOperationProgress = (progress: number, progressInfo?: FileProgress) => {
  operationProgress.value = progress;
  if (progressInfo) {
    updateOperationSpeedFromProgress(progressInfo);
  }
};

const clearOperation = () => {
  currentOperation.value = '';
  operationInProgress.value = false;
  operationProgress.value = null;
  resetOperationMetrics();
  operationDirection.value = null;
  operationTransport.value = null;
  operationToken.value = null;
  operationCancelable.value = false;
};

const scrollToConnectionPanel = () => {
  log('info', 'scrollToConnectionPanel invoked, opening dialog instead', {
    connectionStatus: appState.connectionStatus
  });
  openConnectionDialog('legacy-scroll-helper');
};

const cancelConnection = () => {
  if (appState.connectionStatus === ConnectionStatus.CONNECTING) {
    handleDisconnect();
  }
};

const retryConnection = () => {
  const config = appState.currentConnection;
  if (config) {
    handleConnect(config);
  }
};

const resetConnection = () => {
  appState.connectionStatus = ConnectionStatus.DISCONNECTED;
  appState.error = undefined;
  attachServiceConnectionListener(null);
  scrollToConnectionPanel();
};

// 生命周期
onMounted(() => {
  // 监听来自VSCode的消息
	onMessage((message) => {
		switch (message.command) {
			case 'ping':
				// 响应ping消息
				if (window.vscode) {
					window.vscode.postMessage({ command: 'pong' });
				}
				break;
			case 'themeChanged':
				log('info', 'Theme change notification received', {
					kind: message.data?.kind,
					appearance: message.data?.appearance
				});
				break;
			case 'extension.notification': {
				const level = message.data?.level ?? 'info';
				const rawContent = message.data?.message ?? message.text;
				const content = typeof rawContent === 'string' ? rawContent.trim() : '';
				if (!content) {
					return;
				}

				let moduleName: string | undefined;
				let displayMessage = content;
				const separatorIndex = content.indexOf(': ');
				if (separatorIndex > 0) {
					moduleName = content.slice(0, separatorIndex).trim();
					displayMessage = content.slice(separatorIndex + 2).trim() || displayMessage;
				}

				if (moduleName && ignoredExtensionNotificationModules.has(moduleName)) {
					return;
				}

				const now = Date.now();
				const recent = lastExtensionNotification.value;
				if (recent && recent.message === displayMessage && now - recent.timestamp < 1500) {
					return;
				}
				lastExtensionNotification.value = { message: displayMessage, timestamp: now };

				switch (level) {
					case 'error':
						ElMessage.error({ message: displayMessage, duration: 4000 });
						break;
					case 'warning':
						ElMessage.warning({ message: displayMessage, duration: 3000 });
						break;
					default:
						ElMessage.info({ message: displayMessage, duration: 3000 });
						break;
				}
				break;
			}
			default:
				console.debug('Received message:', message);
		}
	});
  
  log('info', 'Application mounted');
});

onUnmounted(() => {
  // 清理连接
  const service = getCurrentService();
  if (service) {
    service.disconnect();
  }

  if (pendingRefreshTimer !== null) {
	window.clearTimeout(pendingRefreshTimer);
	pendingRefreshTimer = null;
  }
	pendingRefreshPath = null;
	pendingRefreshTransport = null;
	refreshRunning = false;
  
  log('info', 'Application unmounted');
});
</script>

<style scoped>
.app-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color-page);
}

.app-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 12px 16px 0 16px;
  gap: 8px;
}

.toolbar-spacer {
  flex: 1;
}

.file-actions-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-button {
  font-size: 18px;
  width: 36px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toolbar-action-button {
  min-width: 88px;
  height: 36px;
}

.settings-button:focus-visible {
  outline: 2px solid var(--vscode-focusBorder, var(--el-color-primary));
  outline-offset: 2px;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.file-management-section {
  margin-top: 20px;
}

.disconnected-hint,
.connecting-hint,
.error-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 40px;
}

:deep(.el-row) {
  height: 100%;
}

:deep(.el-col) {
  height: 100%;
}

/* 响应式设计 */
@media (max-width: 992px) {
  .main-content {
    padding: 12px;
  }
  
  .file-management-section {
    margin-top: 16px;
  }
  
  :deep(.el-col) {
    margin-bottom: 16px;
  }
}

@media (max-width: 768px) {
  .main-content {
    padding: 8px;
  }
  
  .disconnected-hint,
  .connecting-hint,
  .error-hint {
    padding: 20px;
    min-height: 300px;
  }
}

/* 滚动条样式 */
.main-content::-webkit-scrollbar {
  width: 8px;
}

.main-content::-webkit-scrollbar-track {
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.main-content::-webkit-scrollbar-thumb {
  background: var(--el-fill-color-dark);
  border-radius: 4px;
}

.main-content::-webkit-scrollbar-thumb:hover {
  background: var(--el-fill-color-darker);
}

.connection-dialog :deep(.el-dialog__body) {
  display: flex;
  justify-content: center;
  padding: 24px 32px 28px;
}

.connection-dialog :deep(.connection-panel) {
  width: 100%;
  max-width: 640px;
  margin: 0;
}

/* 暗色主题适配 */
@media (prefers-color-scheme: dark) {
  .app-container {
    background: var(--el-bg-color-page);
  }
}
</style>
