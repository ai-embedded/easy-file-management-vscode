<template>
  <div class="status-bar">
    <div class="status-section left-section">
      <!-- 连接状态 -->
      <div class="status-item connection-status" :class="connectionStatusClass">
        <el-icon class="status-icon">
          <Connection v-if="connectionStatus === 'connected'" />
          <Loading v-else-if="connectionStatus === 'connecting'" />
          <Warning v-else-if="connectionStatus === 'error'" />
          <Close v-else />
        </el-icon>
        <span class="status-text">{{ connectionStatusText }}</span>
        <span v-if="serverInfo" class="server-info">{{ serverInfo }}</span>
      </div>

      <!-- 当前路径 -->
      <div class="status-item path-info" v-if="currentPath">
        <el-icon class="status-icon">
          <FolderOpened />
        </el-icon>
        <span class="status-text">{{ currentPath }}</span>
      </div>
    </div>

    <div class="status-section center-section">
      <!-- 当前操作状态 -->
      <div class="status-item operation-status" v-if="currentOperation">
        <div class="operation-info">
          <el-icon :class="['status-icon', { rotating: showLoadingIcon }]">
            <component :is="showLoadingIcon ? Loading : InfoFilled" />
          </el-icon>
          <span class="status-text">{{ currentOperation }}</span>
          <span v-if="operationProgress !== null" class="progress-percentage"> ({{ operationProgress }}%)</span>
        </div>
        <el-progress
          v-if="operationProgress !== null"
          :percentage="operationProgress"
          :show-text="false"
          :stroke-width="2"
          class="operation-progress"
        />
        <div
          v-if="operationSpeed !== null"
          class="operation-metrics"
        >
          <span class="transfer-speed">
            <span v-if="operationTransportLabel" class="speed-transport">{{ operationTransportLabel }}</span>
            <span v-if="speedDirectionSymbol" class="speed-direction">{{ speedDirectionSymbol }}</span>
            <span>{{ formatTransferRate(operationSpeed) }}</span>
          </span>
        </div>
      </div>
    </div>

    <div class="status-section right-section">
      <div
        class="status-item operation-control"
        v-if="operationCancelable && (operationInProgress || operationProgress !== null)"
      >
        <el-tooltip content="停止传输" placement="top">
          <div
            class="operation-control-content"
            role="button"
            tabindex="0"
            @click.stop="handleCancelClick"
            @keydown.enter.stop.prevent="handleCancelClick"
            @keydown.space.stop.prevent="handleCancelClick"
            aria-label="停止传输"
          >
            <span class="operation-stop-button">
              <span class="stop-indicator"></span>
            </span>
            <span class="operation-control-text">停止</span>
          </div>
        </el-tooltip>
      </div>
      <!-- 文件统计 -->
      <div class="status-item file-stats" v-if="showFileStats && fileStats">
        <el-icon class="status-icon">
          <Document />
        </el-icon>
        <span class="status-text">
          {{ fileStats.totalFiles }} 个项目
          <span v-if="fileStats.totalSize > 0">
            ({{ formatFileSize(fileStats.totalSize) }})
          </span>
        </span>
      </div>

      <!-- 网络状态 -->
      <div class="status-item network-status" v-if="showNetworkStats && networkStats">
        <el-icon class="status-icon">
          <Monitor />
        </el-icon>
        <el-tooltip effect="dark" placement="top">
          <template #content>
            上传: {{ formatTransferRate(networkStats.uploadSpeed) }}<br>
            下载: {{ formatTransferRate(networkStats.downloadSpeed) }}<br>
            延迟: {{ networkStats.latency }}ms
          </template>
          <span class="status-text network-speed">
            ↑{{ formatTransferRate(networkStats.uploadSpeed, true) }}
            ↓{{ formatTransferRate(networkStats.downloadSpeed, true) }}
          </span>
        </el-tooltip>
      </div>

      <!-- 时间显示 -->
      <div class="status-item time-display" v-if="showTime">
        <el-icon class="status-icon">
          <Clock />
        </el-icon>
        <span class="status-text">{{ currentTime }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  Connection,
  Loading,
  Warning,
  Close,
  FolderOpened,
  InfoFilled,
  Document,
  Monitor,
  Clock
} from '@element-plus/icons-vue';
import { ConnectionStatus } from '../types';
import { formatFileSize } from '../utils/fileUtils';

// 定义属性
interface Props {
  connectionStatus: ConnectionStatus;
  serverInfo?: string;
  currentPath?: string;
  currentOperation?: string;
  operationInProgress?: boolean;
  operationProgress?: number | null;
  operationSpeed?: number | null;
  operationCancelable?: boolean;
  operationDirection?: 'upload' | 'download' | null;
  operationTransport?: string | null;
  fileStats?: {
    totalFiles: number;
    totalDirectories: number;
    totalSize: number;
  };
  networkStats?: {
    uploadSpeed: number;
    downloadSpeed: number;
    latency: number;
  };
  showFileStats?: boolean;
  showNetworkStats?: boolean;
  showTime?: boolean;
}

const emit = defineEmits<{
	(e: 'cancel-operation'): void;
}>();

const props = withDefaults(defineProps<Props>(), {
  operationInProgress: false,
  operationProgress: null,
  operationSpeed: null,
  operationCancelable: false,
  operationDirection: null,
  operationTransport: null,
  showFileStats: true,
  showNetworkStats: false,
  showTime: true
});

const isCanceling = ref(false);

const showLoadingIcon = computed(() => props.operationInProgress && !isCanceling.value);

const handleCancelClick = () => {
	if (isCanceling.value) return;
	isCanceling.value = true;
	emit('cancel-operation');
};

watch(() => props.operationInProgress, () => {
	isCanceling.value = false;
});

// 响应式数据
const currentTime = ref('');
let timeInterval: NodeJS.Timeout | null = null;

// 计算属性
const connectionStatusClass = computed(() => {
  const baseClass = 'connection-status';
  switch (props.connectionStatus) {
    case ConnectionStatus.CONNECTED:
      return `${baseClass} connected`;
    case ConnectionStatus.CONNECTING:
      return `${baseClass} connecting`;
    case ConnectionStatus.ERROR:
      return `${baseClass} error`;
    default:
      return `${baseClass} disconnected`;
  }
});

const connectionStatusText = computed(() => {
  switch (props.connectionStatus) {
    case ConnectionStatus.CONNECTED:
      return '已连接';
    case ConnectionStatus.CONNECTING:
      return '连接中';
    case ConnectionStatus.ERROR:
      return '连接失败';
    default:
      return '未连接';
  }
});

const speedDirectionSymbol = computed(() => {
  if (props.operationDirection === 'upload') return '↑';
  if (props.operationDirection === 'download') return '↓';
  return '';
});

const operationTransportLabel = computed(() => {
  if (!props.operationTransport) return '';
  return props.operationTransport;
});

// 方法
const formatTransferRate = (bytesPerSecond: number, compact = false): string => {
  if (bytesPerSecond === 0) return compact ? '0' : '0 B/s';
  
  const units = compact ? ['B', 'K', 'M', 'G'] : ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const k = 1024;
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  const value = parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1));
  
  const separator = compact ? '' : ' ';
  return `${value}${separator}${units[i]}`;
};

const updateTime = () => {
  const now = new Date();
  currentTime.value = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

// 生命周期
onMounted(() => {
  if (props.showTime) {
    updateTime();
    timeInterval = setInterval(updateTime, 1000);
  }
});

onUnmounted(() => {
  if (timeInterval) {
    clearInterval(timeInterval);
    timeInterval = null;
  }
});
</script>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  height: 32px;
  background: var(--el-bg-color-page);
  border-top: 1px solid var(--el-border-color);
  padding: 0 12px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  user-select: none;
}

.status-section {
  display: flex;
  align-items: center;
  height: 100%;
}

.left-section {
  flex: 1;
  justify-content: flex-start;
}

.center-section {
  flex: 2;
  justify-content: center;
}

.right-section {
  flex: 1;
  justify-content: flex-end;
}

.status-item {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 8px;
  margin: 0 4px;
  border-radius: 4px;
  transition: all 0.2s;
  white-space: nowrap;
}

.status-item:hover {
  background: var(--el-fill-color-light);
}

.status-icon {
  font-size: 14px;
  margin-right: 4px;
  flex-shrink: 0;
}

.status-text {
  flex-shrink: 0;
}

/* 连接状态样式 */
.connection-status.connected {
  color: var(--el-color-success);
}

.connection-status.connecting {
  color: var(--el-color-warning);
}

.connection-status.error {
  color: var(--el-color-danger);
}

.connection-status.disconnected {
  color: var(--el-text-color-secondary);
}

.server-info {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-family: monospace;
}

/* 路径信息样式 */
.path-info {
  font-family: monospace;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.path-info .status-icon {
  color: var(--el-color-primary);
}

/* 操作状态样式 */
.operation-status {
  max-width: 500px;
  width: 100%;
  position: relative;
  padding-right: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.operation-info {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 4px;
}

.operation-progress {
  width: 100%;
}

.operation-progress :deep(.el-progress-bar__outer) {
  height: 2px;
  border-radius: 1px;
}

.operation-progress :deep(.el-progress-bar__inner) {
  border-radius: 1px;
}

.operation-metrics {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  font-family: monospace;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.transfer-speed {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.speed-transport {
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.speed-direction {
  font-family: monospace;
}

.progress-percentage {
  color: var(--el-color-primary);
  font-weight: 600;
  margin-left: 4px;
  font-family: monospace;
}

.operation-info .status-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-stop-button {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background-color: var(--el-color-danger);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s ease, background-color 0.2s ease;
  flex-shrink: 0;
}

.operation-control {
  gap: 8px;
  align-self: flex-end;
  padding-bottom: 6px;
}

.operation-control-content {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
  transition: background-color 0.2s ease;
}

.operation-control-text {
  color: var(--el-text-color-primary);
  font-weight: 500;
}

.operation-control-content:hover,
.operation-control-content:focus-visible {
  background-color: var(--el-fill-color-light);
  outline: none;
}

.operation-control-content:hover .operation-stop-button,
.operation-control-content:focus-visible .operation-stop-button {
  background-color: var(--el-color-danger-dark-2);
  transform: scale(1.05);
}

.operation-control-content:active .operation-stop-button {
  transform: scale(0.95);
}

.stop-indicator {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background-color: #fff;
}

.operation-status .status-icon.rotating {
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 文件统计样式 */
.file-stats .status-icon {
  color: var(--el-color-info);
}

/* 网络状态样式 */
.network-status {
  cursor: help;
}

.network-status .status-icon {
  color: var(--el-color-primary);
}

.network-speed {
  font-family: monospace;
  font-size: 11px;
}

/* 时间显示样式 */
.time-display {
  font-family: monospace;
  min-width: 80px;
  justify-content: center;
}

.time-display .status-icon {
  color: var(--el-text-color-secondary);
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .server-info {
    display: none;
  }
  
  .path-info {
    max-width: 200px;
  }
}

@media (max-width: 992px) {
  .network-status {
    display: none;
  }
  
  .operation-status {
    max-width: 300px;
  }
}

@media (max-width: 768px) {
  .status-bar {
    height: 28px;
    padding: 0 8px;
    font-size: 11px;
  }
  
  .status-item {
    padding: 0 4px;
    margin: 0 2px;
  }
  
  .status-icon {
    font-size: 12px;
    margin-right: 2px;
  }
  
  .file-stats {
    display: none;
  }
  
  .path-info {
    max-width: 120px;
  }
  
  .operation-status {
    max-width: 200px;
  }
  
  .center-section {
    flex: 1;
  }
  
  .right-section {
    flex: 0 0 auto;
  }
}

@media (max-width: 480px) {
  .time-display {
    display: none;
  }
  
  .left-section {
    flex: 2;
  }
  
  .center-section {
    flex: 3;
  }
  
  .right-section {
    display: none;
  }
}

/* 暗色主题适配 */
@media (prefers-color-scheme: dark) {
  .status-bar {
    background: var(--el-bg-color-page);
    border-top-color: var(--el-border-color);
  }
  
  .status-item:hover {
    background: var(--el-fill-color);
  }
}

/* 高对比度支持 */
@media (prefers-contrast: high) {
  .status-bar {
    border-top-width: 2px;
  }
  
  .status-item {
    border: 1px solid transparent;
  }
  
  .status-item:hover {
    border-color: var(--el-border-color);
  }
  
  .connection-status.connected {
    font-weight: bold;
  }
  
  .connection-status.error {
    font-weight: bold;
    text-decoration: underline;
  }
}

/* 动画效果优化 */
@media (prefers-reduced-motion: reduce) {
  .operation-status .status-icon.rotating {
    animation: none;
  }
  
  .status-item {
    transition: none;
  }
}
</style>
