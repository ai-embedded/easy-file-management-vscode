<template>
  <el-card class="connection-panel">
    <template #header>
      <div class="card-header">
        <span>设置</span>
        <el-tag :type="connectionStatusType" class="status-tag">
          {{ connectionStatusText }}
        </el-tag>
      </div>
    </template>

    <el-tabs v-model="activeTab" class="settings-tabs">
      <el-tab-pane label="远程连接设置" name="connection">
        <el-form 
          class="connection-form"
          ref="formRef" 
          :model="form" 
          :rules="rules" 
          label-width="100px"
          @submit.prevent="handleConnect"
        >
      <el-form-item label="连接类型" prop="type">
        <el-select 
          v-model="form.type" 
          placeholder="请选择连接类型"
          style="width: 100%"
          :disabled="isConnected"
          @change="handleTypeChange"
        >
          <el-option
            v-for="option in connectionTypeOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
            :disabled="option.disabled"
          />
        </el-select>
      </el-form-item>

      <!-- 网络连接类型需要服务器地址和端口 -->
      <div v-if="isNetworkType(form.type)">
        <el-form-item label="服务器地址" prop="host">
          <el-input 
            v-model="form.host" 
            placeholder="请输入服务器IP地址"
            :disabled="isConnected"
          >
            <template #prepend>{{ urlPrefix }}</template>
          </el-input>
        </el-form-item>

        <el-form-item label="端口" prop="port">
          <el-input-number 
            v-model="form.port" 
            :min="1" 
            :max="65535" 
            placeholder="端口号"
            style="width: 100%"
            :disabled="isConnected"
          />
        </el-form-item>
      </div>

      <!-- 串口连接不需要服务器地址和端口 -->
      <div v-if="form.type === 'serial'">
        <el-form-item>
          <el-alert
            title="串口连接说明"
            type="info"
            show-icon
            :closable="false"
            description="串口连接将通过Web Serial API直接与串口设备通信。连接时会弹出设备选择对话框，请选择对应的USB转串口设备。"
          />
        </el-form-item>

        <el-form-item label="波特率" prop="baudRate">
          <el-select 
            v-model="form.baudRate" 
            placeholder="请选择波特率"
            style="width: 100%"
            :disabled="isConnected"
          >
            <el-option label="9600" :value="9600" />
            <el-option label="19200" :value="19200" />
            <el-option label="38400" :value="38400" />
            <el-option label="57600" :value="57600" />
            <el-option label="115200" :value="115200" />
            <el-option label="230400" :value="230400" />
            <el-option label="460800" :value="460800" />
            <el-option label="921600" :value="921600" />
          </el-select>
        </el-form-item>

        <el-form-item label="数据位">
          <el-radio-group v-model="form.dataBits" :disabled="isConnected">
            <el-radio :value="7">7位</el-radio>
            <el-radio :value="8">8位</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="停止位">
          <el-radio-group v-model="form.stopBits" :disabled="isConnected">
            <el-radio :value="1">1位</el-radio>
            <el-radio :value="2">2位</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="奇偶校验">
          <el-radio-group v-model="form.parity" :disabled="isConnected">
            <el-radio value="none">无校验</el-radio>
            <el-radio value="even">偶校验</el-radio>
            <el-radio value="odd">奇校验</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="流控制">
          <el-radio-group v-model="form.flowControl" :disabled="isConnected">
            <el-radio value="none">无</el-radio>
            <el-radio value="hardware">硬件流控制</el-radio>
          </el-radio-group>
        </el-form-item>
      </div>

      <el-form-item label="超时时间" prop="timeout">
        <el-input-number 
          v-model="form.timeout" 
          :min="5000" 
          :max="60000" 
          :step="1000"
          placeholder="超时时间(毫秒)"
          style="width: 100%"
          :disabled="isConnected"
        />
      </el-form-item>

      <!-- FTP特有配置 -->
      <div v-if="form.type === 'ftp'">
        <el-form-item label="用户名" prop="username">
          <el-input 
            v-model="form.username" 
            placeholder="请输入FTP用户名"
            :disabled="isConnected"
          />
        </el-form-item>
        
        <el-form-item label="密码" prop="password">
          <el-input 
            v-model="form.password" 
            type="password"
            placeholder="请输入FTP密码"
            show-password
            :disabled="isConnected"
          />
        </el-form-item>
        
        <el-form-item label="传输模式">
          <el-radio-group v-model="form.passive" :disabled="isConnected">
            <el-radio :value="true">被动模式 (PASV)</el-radio>
            <el-radio :value="false">主动模式 (PORT)</el-radio>
          </el-radio-group>
        </el-form-item>
      </div>
      
      <!-- HTTP特有配置 -->
      <el-form-item v-if="form.type === 'http'" label="自定义头部">
        <el-input 
          v-model="customHeaders" 
          type="textarea" 
          :rows="3"
          placeholder="JSON格式的自定义请求头 (可选)"
          :disabled="isConnected"
        />
      </el-form-item>

      <el-form-item class="action-row" label-width="0">
        <el-button
          @click="handleSave"
          :loading="saving"
          type="success"
        >
          保存设置
        </el-button>
        
        <el-button 
          @click="handleReset"
          :disabled="isConnected || connecting"
        >
          重置
        </el-button>
      </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="下载设置" name="download">
        <el-form class="download-settings-form" label-width="120px">
          <el-form-item label="默认下载目录">
            <el-input
              v-model="downloadDirectoryInput"
              placeholder="请选择或输入默认下载目录"
              :disabled="downloadPathLoading"
            >
              <template #append>
                <el-button
                  @click="handleBrowseDownloadPath"
                  :loading="downloadPathLoading"
                  :disabled="downloadPathLoading"
                >浏览</el-button>
              </template>
            </el-input>
            <div class="download-hint">此路径将在保存文件时作为默认位置。</div>
          </el-form-item>

          <el-form-item label-width="0" class="download-actions">
            <el-button
              type="success"
              @click="handleDownloadSettingsSave"
              :loading="downloadPathLoading"
              :disabled="downloadPathLoading"
            >
              保存设置
            </el-button>
            <el-button
              @click="handleDownloadPathReset"
              :loading="downloadPathLoading"
              :disabled="downloadPathLoading"
            >
              重置
            </el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { ConnectionConfig, ConnectionStatus } from '../types';
import { saveState, getState, postMessage, onMessage, log, showOpenDialog } from '../utils/messageUtils';
import { summarizeConnectionConfig } from '../../shared/utils/connectionSummary';
import {
	getSupportedConnectionTypes,
	getConnectionTypeDisplayName,
	getDefaultPort,
	getTransportDefinitions,
	supportsDirectConnection,
	type ConnectionType
} from '../services/ServiceFactory';

// 定义事件
const emit = defineEmits<{
  connect: [config: ConnectionConfig];
  disconnect: [];
  connectionStatusChange: [status: ConnectionStatus];
  'download-settings-change': [path: string | null];
}>();

// 响应式数据
const activeTab = ref<'connection' | 'download'>('connection');
const formRef = ref<FormInstance>();
const connecting = ref(false);
const saving = ref(false);
// 安全初始化 connectionStatus，处理 ConnectionStatus 可能未定义的情况
const connectionStatus = ref<ConnectionStatus>(
  ConnectionStatus ? ConnectionStatus.DISCONNECTED : 'disconnected' as ConnectionStatus
);
const customHeaders = ref('');
const downloadDirectoryInput = ref('');
const downloadPathLoading = ref(false);
const defaultDownloadDirectory = ref('');
const pendingDownloadPathRequestId = ref<string | null>(null);

type ConnectionOption = { label: string; value: string; disabled?: boolean };

const supportedConnectionTypes = getSupportedConnectionTypes();
const transportDefinitions = getTransportDefinitions();
const networkConnectionTypeSet = new Set<ConnectionType>(
	transportDefinitions
		.filter((definition) => definition.refreshSensitive)
		.map((definition) => definition.id as ConnectionType)
);

const fallbackConnectionLabels: Record<string, string> = {
	// serial: '串口',  // 暂时隐藏，后续支持
	// uart: 'UART/串口',  // 已移除
	// usb: 'USB'  // 已移除
};

const resolveConnectionTypeLabel = (type: string): string => {
	const connectionType = type as ConnectionType;
	if (supportsDirectConnection(connectionType)) {
		return getConnectionTypeDisplayName(connectionType);
	}

	return fallbackConnectionLabels[type] ?? type.toUpperCase();
};

const connectionTypeOptions = computed<ConnectionOption[]>(() => {
	const baseOptions: ConnectionOption[] = supportedConnectionTypes.map((type) => ({
		value: type,
		label: resolveConnectionTypeLabel(type)
	}));
	const existingValues = new Set(baseOptions.map((option) => option.value));
	const extras: ConnectionOption[] = [
		// 暂时隐藏串口连接，后续版本支持
		// { value: 'serial', label: resolveConnectionTypeLabel('serial') },
		// 已移除 UART 和 USB 连接类型
		// { value: 'uart', label: resolveConnectionTypeLabel('uart'), disabled: true },
		// { value: 'usb', label: resolveConnectionTypeLabel('usb'), disabled: true }
	];

	for (const option of extras) {
		if (!existingValues.has(option.value)) {
			baseOptions.push(option);
		}
	}

	return baseOptions;
});

const isNetworkType = (type: string | undefined | null): boolean => {
	if (!type) {
		return false;
	}
	return networkConnectionTypeSet.has(type as ConnectionType);
};

const VALIDATION_ERROR_CODE = 'VALIDATION_FAILED';
const createValidationError = (message: string) => {
	const error = new Error(message) as Error & { code?: string };
	error.code = VALIDATION_ERROR_CODE;
	return error;
};

// 表单数据 - 确保初始值都是基本类型或普通对象
const form = ref<ConnectionConfig>({
  type: 'http',
  host: '127.0.0.1',
  port: 8080,
  timeout: 30000,
  headers: {}, // 注意：这会被Vue转换为响应式Proxy
  // FTP特有字段
  username: '',
  password: '',
  passive: true,
  // TCP特有字段
  dataFormat: 'protobuf',
  // 串口特有字段
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none'
});

const createFormLogPayload = (extra: Record<string, unknown> = {}) => ({
	...extra,
	connectionStatus: connectionStatus.value,
	connecting: connecting.value,
	summary: summarizeConnectionConfig(form.value),
	customHeadersLength: customHeaders.value?.length ?? 0
});

const normalizeDownloadPath = (rawPath?: string | null): string => {
  if (!rawPath) {
    return '';
  }
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed;
};

const emitDownloadSettingsChange = (path: string | null) => {
  const normalized = normalizeDownloadPath(path);
  emit('download-settings-change', normalized ? normalized : null);
};

const setDownloadDirectory = (path: string | null, options: { emit?: boolean } = { emit: true }) => {
  const normalized = normalizeDownloadPath(path);
  downloadDirectoryInput.value = normalized;
  if (options.emit) {
    emitDownloadSettingsChange(normalized || null);
  }
};

// 表单验证规则
const rules = computed<FormRules>(() => {
  console.log('[规则计算] 当前类型:', form.value.type);
  console.log('[规则计算] 当前host:', form.value.host);
  console.log('[规则计算] 当前port:', form.value.port);

  const baseRules: FormRules = {
    type: [
      { required: true, message: '请选择连接类型', trigger: 'change' }
    ],
    timeout: [
      { type: 'number', min: 5000, max: 60000, message: '超时时间必须在5-60秒之间', trigger: 'blur' }
    ]
  };

  // 网络连接类型需要主机和端口验证
  if (isNetworkType(form.value.type)) {
    console.log('[规则计算] 添加host和port验证规则');

    baseRules.host = [
      { required: true, message: '请输入服务器地址', trigger: 'blur' },
      {
        pattern: /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^localhost$|^[a-zA-Z0-9.-]+$/,
        message: '请输入有效的IP地址、域名或localhost',
        trigger: 'blur'
      }
    ];
    baseRules.port = [
      { required: true, message: '请输入端口号', trigger: 'blur' },
      { type: 'number', min: 1, max: 65535, message: '端口号必须在1-65535之间', trigger: 'blur' }
    ];
  } else {
    console.log('[规则计算] 非网络类型，不添加host/port规则');
  }

  // FTP特有验证规则
  if (form.value.type === 'ftp') {
    baseRules.username = [
      { required: true, message: '请输入FTP用户名', trigger: 'blur' }
    ];
    baseRules.password = [
      { required: true, message: '请输入FTP密码', trigger: 'blur' }
    ];
  }

  // 串口特有验证规则
  if (form.value.type === 'serial') {
    baseRules.baudRate = [
      { required: true, message: '请选择波特率', trigger: 'change' }
    ];
  }

  console.log('[规则计算] 最终规则:', Object.keys(baseRules));
  console.log('[规则计算] 完整规则:', baseRules);
  return baseRules;
});

// 计算属性
const isConnected = computed(() => {
  // 添加安全检查，确保 ConnectionStatus 存在
  if (!ConnectionStatus) {
    console.warn('ConnectionStatus 枚举未定义，使用字符串比较');
    return connectionStatus.value === 'connected';
  }
  return connectionStatus.value === ConnectionStatus.CONNECTED;
});

const urlPrefix = computed(() => {
  switch (form.value.type) {
    case 'ftp':
      return 'ftp://';
    case 'http':
      return 'http://';
    case 'tcp':
      return 'tcp://';
    case 'serial':
      return 'serial://'; // 串口不使用网络，但保持一致性
    default:
      return '';
  }
});

const requestDefaultDownloadPath = () => {
  const requestId = `default-download-${Date.now()}`;
  pendingDownloadPathRequestId.value = requestId;
  downloadPathLoading.value = true;
  postMessage('requestDefaultDownloadPath', { requestId });
  window.setTimeout(() => {
    if (pendingDownloadPathRequestId.value === requestId) {
      pendingDownloadPathRequestId.value = null;
      downloadPathLoading.value = false;
    }
  }, 8000);
};

const handleBrowseDownloadPath = async () => {
  try {
    downloadPathLoading.value = true;
    const result = await showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false
    });
    const selected = Array.isArray(result) && result.length > 0 ? result[0] : undefined;
    if (selected) {
      setDownloadDirectory(selected, { emit: true });
    }
  } finally {
    downloadPathLoading.value = false;
  }
};

const handleDownloadPathReset = () => {
  if (defaultDownloadDirectory.value) {
    setDownloadDirectory(defaultDownloadDirectory.value, { emit: true });
    ElMessage.success('已恢复默认下载目录');
    return;
  }
  requestDefaultDownloadPath();
};

const snapshotConnectionForm = (): ConnectionConfig => {
  const snapshot = JSON.parse(JSON.stringify(form.value)) as ConnectionConfig;
  if (snapshot.type === 'http') {
    snapshot.headers = parseCustomHeaders();
  }
  return snapshot;
};

const buildStatePayload = (config: ConnectionConfig) => ({
  connectionForm: config,
  customHeaders: customHeaders.value || '',
  downloadSettings: {
    defaultDownloadPath: normalizeDownloadPath(downloadDirectoryInput.value)
  }
});

const handleDownloadSettingsSave = async () => {
  try {
    const config = snapshotConnectionForm();
    const stateData = buildStatePayload(config);
    postMessage('saveState', { state: stateData });
    saveState(stateData);
    emitDownloadSettingsChange(stateData.downloadSettings.defaultDownloadPath || null);
    ElMessage.success('下载设置已保存');
  } catch (error) {
    ElMessage.error('保存下载设置失败');
    log('error', 'Download settings save failed', {
      error: error instanceof Error ? error.message : error
    });
  }
};

const defaultPort = computed(() => {
	const type = form.value.type as ConnectionType;
	if (supportsDirectConnection(type)) {
		const registeredPort = getDefaultPort(type);
		if (typeof registeredPort === 'number') {
			console.log('[默认端口] 类型:', type, '端口:', registeredPort);
			return registeredPort;
		}
	}

	if (type === 'serial' || type === 'uart') {
		console.log('[默认端口] 类型:', type, '端口:', 0);
		return 0;
	}

	console.log('[默认端口] 类型:', type, '端口:', 8080);
	return 8080;
});

const connectionStatusType = computed(() => {
  // 添加安全检查，确保 ConnectionStatus 存在
  if (!ConnectionStatus) {
    console.warn('ConnectionStatus 枚举未定义，使用默认值');
    return 'info';
  }
  
  switch (connectionStatus.value) {
    case ConnectionStatus.CONNECTED:
      return 'success';
    case ConnectionStatus.CONNECTING:
      return 'warning';
    case ConnectionStatus.ERROR:
      return 'danger';
    default:
      return 'info';
  }
});

const connectionStatusText = computed(() => {
  // 添加安全检查，确保 ConnectionStatus 存在
  if (!ConnectionStatus) {
    console.warn('ConnectionStatus 枚举未定义，使用默认值');
    return '未连接';
  }
  
  switch (connectionStatus.value) {
    case ConnectionStatus.CONNECTED:
      return '已连接';
    case ConnectionStatus.CONNECTING:
      return '连接中...';
    case ConnectionStatus.ERROR:
      return '连接失败';
    default:
      return '未连接';
  }
});

// 方法
const handleTypeChange = () => {
	log('info', 'ConnectionPanel type change triggered', createFormLogPayload({
		nextType: form.value.type
	}));
  console.log('===== 类型切换 =====');
  console.log('切换到类型:', form.value.type);
  console.log('切换前的表单:', JSON.parse(JSON.stringify(form.value)));

  // 根据连接类型调整默认端口（仅适用于网络连接）
  if (isNetworkType(form.value.type)) {
    console.log('网络连接类型 - 检查host和port');
    console.log('当前host:', form.value.host);
    console.log('当前port:', form.value.port);

    // 确保host和port有有效值
    if (!form.value.host || form.value.host === '') {
      console.log('host为空，设置默认值: 127.0.0.1');
      form.value.host = '127.0.0.1';
    }
    const newPort = defaultPort.value;
    console.log('设置默认端口:', newPort);
    form.value.port = newPort;
  }
  
  // 清理不相关的字段
  if (form.value.type !== 'ftp') {
    form.value.username = '';
    form.value.password = '';
    form.value.passive = true;
  }
  
  if (form.value.type !== 'http') {
    // 重置headers为新的普通对象，避免残留的Proxy
    form.value.headers = {};
    customHeaders.value = '';
    console.log('清理HTTP字段，headers重置为:', form.value.headers);
  }
  
  if (form.value.type !== 'tcp') {
    form.value.dataFormat = 'protobuf';
  }
  
  if (form.value.type !== 'serial') {
    // 清理串口特有字段
    form.value.baudRate = 115200;
    form.value.dataBits = 8;
    form.value.stopBits = 1;
    form.value.parity = 'none';
    form.value.flowControl = 'none';
  } else {
    // 串口连接时设置默认值
    form.value.baudRate = 115200;
    form.value.dataBits = 8;
    form.value.stopBits = 1;
    form.value.parity = 'none';
    form.value.flowControl = 'none';
    // 清理网络连接字段
    form.value.host = '';
    form.value.port = 0;
  }
  
  console.log('切换后的表单:', JSON.parse(JSON.stringify(form.value)));

  // 重新验证表单
  setTimeout(() => {
    console.log('清空验证状态');
    formRef.value?.clearValidate();
    console.log('当前验证规则将更新');
    console.log('===== 类型切换完成 =====');
  }, 100);
};

const parseCustomHeaders = (): Record<string, string> => {
  if (!customHeaders.value.trim()) {
    return {};
  }
  
  try {
    const parsed = JSON.parse(customHeaders.value);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (error) {
    ElMessage.warning('自定义头部格式无效，将被忽略');
    return {};
  }
};

const buildConnectionConfig = (): ConnectionConfig => {
	const config = JSON.parse(JSON.stringify(form.value)) as ConnectionConfig;

	if (config.type === 'http') {
		config.headers = parseCustomHeaders();
	}

	if (config.type === 'ftp' && (!config.username || !config.password)) {
		throw createValidationError('FTP连接需要用户名和密码');
	}

	return config;
};

const getValidatedConfig = async (): Promise<ConnectionConfig> => {
	if (!formRef.value) {
		throw createValidationError('连接配置表单尚未初始化');
	}

	try {
		const valid = await formRef.value.validate();
		if (!valid) {
			throw createValidationError('请先完善连接配置');
		}
	} catch (error) {
		log('warn', 'ConnectionPanel validation failed', {
			error: error instanceof Error ? error.message : error,
			...createFormLogPayload({ reason: 'validation-error' })
		});
		throw createValidationError('请先完善连接配置');
	}

	return buildConnectionConfig();
};

const handleConnect = async () => {
	log('info', 'ConnectionPanel connect requested', createFormLogPayload());

	try {
		const config = await getValidatedConfig();
		const connectionSummary = summarizeConnectionConfig(config);
		connecting.value = true;
		connectionStatus.value = ConnectionStatus ? ConnectionStatus.CONNECTING : 'connecting' as ConnectionStatus;
		emit('connectionStatusChange', ConnectionStatus ? ConnectionStatus.CONNECTING : 'connecting' as ConnectionStatus);
		log('info', 'ConnectionPanel prepared connection config', {
			summary: connectionSummary,
			hasCustomHeaders: config.type === 'http' ? customHeaders.value.trim().length > 0 : undefined
		});

		emit('connect', config);
		log('info', 'ConnectionPanel emitted connect event', {
			summary: connectionSummary
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const errorCode = typeof error === 'object' && error !== null && 'code' in error
			? (error as { code?: string }).code
			: undefined;
		if (errorCode === VALIDATION_ERROR_CODE) {
			ElMessage.warning(message || '请先完成连接配置');
		} else {
			connectionStatus.value = ConnectionStatus ? ConnectionStatus.DISCONNECTED : 'disconnected' as ConnectionStatus;
			emit('connectionStatusChange', ConnectionStatus ? ConnectionStatus.DISCONNECTED : 'disconnected' as ConnectionStatus);
			log('error', 'ConnectionPanel connect flow threw error', {
				error: message,
				stack: error instanceof Error ? error.stack : undefined,
				...createFormLogPayload({ reason: 'unexpected-error' })
			});
		}
	} finally {
		connecting.value = false;
	}
};

const handleDisconnect = async () => {
	log('info', 'ConnectionPanel disconnect requested', createFormLogPayload());
  try {
    await ElMessageBox.confirm(
      '确定要断开当前连接吗？',
      '确认断开',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );

    connectionStatus.value = ConnectionStatus ? ConnectionStatus.DISCONNECTED : 'disconnected' as ConnectionStatus;
    emit('connectionStatusChange', ConnectionStatus ? ConnectionStatus.DISCONNECTED : 'disconnected' as ConnectionStatus);
    emit('disconnect');
		log('info', 'ConnectionPanel disconnect confirmed', createFormLogPayload());
    
  } catch {
    // 用户取消
		log('info', 'ConnectionPanel disconnect cancelled', createFormLogPayload({ reason: 'user-cancelled' }));
  }
};

const handleSave = async () => {
	log('info', 'ConnectionPanel save requested', createFormLogPayload());

	try {
		saving.value = true;
		const config = await getValidatedConfig();
		const stateData = buildStatePayload(config);

		postMessage('saveState', { state: stateData });
		log('info', 'ConnectionPanel saveState dispatched', {
			summary: summarizeConnectionConfig(config),
			customHeadersLength: stateData.customHeaders.length
		});

		saveState(stateData);
		emitDownloadSettingsChange(stateData.downloadSettings.defaultDownloadPath || null);

		setTimeout(() => {
			saving.value = false;
			ElMessage.success('配置已保存');
			log('info', 'ConnectionPanel save completed', createFormLogPayload({ source: 'save-success' }));
		}, 300);
	} catch (error) {
		saving.value = false;
		const errorCode = typeof error === 'object' && error !== null && 'code' in error
			? (error as { code?: string }).code
			: undefined;
		const message = error instanceof Error ? error.message : String(error);

		if (errorCode === VALIDATION_ERROR_CODE) {
			ElMessage.error('请检查必填字段是否填写完整');
			log('error', 'ConnectionPanel save validation error', {
				error: message,
				stack: error instanceof Error ? error.stack : undefined,
				...createFormLogPayload({ reason: 'validation-error' })
			});
		} else {
			ElMessage.error('保存设置失败');
			log('error', 'ConnectionPanel save failed', {
				error: message,
				stack: error instanceof Error ? error.stack : undefined,
				...createFormLogPayload({})
			});
		}
	}
};

const handleReset = () => {
  form.value = {
    type: 'http',
    host: '127.0.0.1',
    port: 8080,
    timeout: 30000,
    headers: {},
    username: '',
    password: '',
    passive: true,
    dataFormat: 'protobuf',
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none'
  };
  customHeaders.value = '';
  formRef.value?.clearValidate();
	log('info', 'ConnectionPanel form reset to defaults', createFormLogPayload({ source: 'reset' }));
};

const saveFormData = () => {
  const stateData = buildStatePayload(snapshotConnectionForm());
  saveState(stateData);
};

const loadFormData = () => {
  const state = getState();
  if (state.connectionForm) {
    // 只加载相关字段，避免字段污染
    const savedForm = state.connectionForm;

    // 保留当前默认值，只覆盖保存的相关字段
    form.value = {
      ...form.value,
      type: savedForm.type || form.value.type,
      timeout: savedForm.timeout || form.value.timeout
    };

    // 根据连接类型加载相应字段
    if (isNetworkType(savedForm.type)) {
      form.value.host = savedForm.host || '127.0.0.1';
      form.value.port = savedForm.port || defaultPort.value;
    }

    if (savedForm.type === 'ftp') {
      form.value.username = savedForm.username || '';
      form.value.password = savedForm.password || '';
      form.value.passive = savedForm.passive !== undefined ? savedForm.passive : true;
    }

    if (savedForm.type === 'http') {
      form.value.headers = savedForm.headers || {};
    }

    if (savedForm.type === 'tcp') {
      form.value.dataFormat = savedForm.dataFormat || 'protobuf';
    }

    if (savedForm.type === 'serial') {
      form.value.baudRate = savedForm.baudRate || 115200;
      form.value.dataBits = savedForm.dataBits || 8;
      form.value.stopBits = savedForm.stopBits || 1;
      form.value.parity = savedForm.parity || 'none';
      form.value.flowControl = savedForm.flowControl || 'none';
    }

		log('info', 'ConnectionPanel restored form from saved state', createFormLogPayload({ source: 'loadFormData' }));
  }
  if (state.customHeaders !== undefined) {
    customHeaders.value = state.customHeaders;
  }

  if (state.downloadSettings && 'defaultDownloadPath' in state.downloadSettings) {
    setDownloadDirectory(state.downloadSettings.defaultDownloadPath, { emit: true });
  }

  // 如果成功加载了配置，显示提示
  if (state.connectionForm) {
    setTimeout(() => {
      ElMessage({
        message: '已加载保存的配置',
        type: 'info',
        duration: 2000
      });
    }, 500);
  }
};

// 移除自动保存功能，改为手动保存
// watch(() => form.value, saveFormData, { deep: true });
// watch(() => customHeaders.value, saveFormData);

// 暴露方法给父组件
const setConnectionStatus = (status: ConnectionStatus) => {
  connectionStatus.value = status;
};

const setConnecting = (status: boolean) => {
  connecting.value = status;
};

const getDownloadSettings = () => ({
  defaultDownloadPath: normalizeDownloadPath(downloadDirectoryInput.value) || null
});

// 生命周期
onMounted(() => {
  // 监听来自扩展端的恢复状态消息
  onMessage((message) => {
    if (message.command === 'restoreState' && message.state) {
      console.log('收到恢复状态消息:', message.state);
      if (message.state.connectionForm) {
        const savedForm = message.state.connectionForm;

        // 保留当前默认值，只覆盖保存的相关字段
        form.value = {
          ...form.value,
          type: savedForm.type || form.value.type,
          timeout: savedForm.timeout || form.value.timeout
        };

        // 根据连接类型加载相应字段
        if (isNetworkType(savedForm.type)) {
          form.value.host = savedForm.host || '127.0.0.1';
          form.value.port = savedForm.port || defaultPort.value;
        }

        if (savedForm.type === 'ftp') {
          form.value.username = savedForm.username || '';
          form.value.password = savedForm.password || '';
          form.value.passive = savedForm.passive !== undefined ? savedForm.passive : true;
        }

        if (savedForm.type === 'http') {
          form.value.headers = savedForm.headers || {};
        }

        if (savedForm.type === 'tcp') {
          form.value.dataFormat = savedForm.dataFormat || 'protobuf';
        }

        if (savedForm.type === 'serial') {
          form.value.baudRate = savedForm.baudRate || 115200;
          form.value.dataBits = savedForm.dataBits || 8;
          form.value.stopBits = savedForm.stopBits || 1;
          form.value.parity = savedForm.parity || 'none';
          form.value.flowControl = savedForm.flowControl || 'none';
        }
      }
     if (message.state.customHeaders !== undefined) {
       customHeaders.value = message.state.customHeaders;
     }
      if (message.state.downloadSettings && 'defaultDownloadPath' in message.state.downloadSettings) {
        setDownloadDirectory(message.state.downloadSettings.defaultDownloadPath, { emit: true });
      }
			log('info', 'ConnectionPanel restoreState message applied', createFormLogPayload({ source: 'restoreState-message' }));
      ElMessage({
        message: '已加载保存的配置',
        type: 'info',
        duration: 2000
      });
    } else if (message.command === 'defaultDownloadPath') {
      const requestId = message.requestId;
      if (!pendingDownloadPathRequestId.value || requestId === pendingDownloadPathRequestId.value) {
        pendingDownloadPathRequestId.value = null;
        downloadPathLoading.value = false;
        const resolvedPath = normalizeDownloadPath(message.path);
        if (resolvedPath) {
          defaultDownloadDirectory.value = resolvedPath;
          if (!downloadDirectoryInput.value) {
            setDownloadDirectory(resolvedPath, { emit: true });
          }
        }
      }
    }
  });

  // 同时尝试从本地加载配置（作为备份）
  loadFormData();

  // 请求扩展端发送保存的状态
  postMessage('requestState');
  requestDefaultDownloadPath();
});

// 暴露给父组件使用的方法和数据
defineExpose({
  setConnectionStatus,
  setConnecting,
  connectionStatus,
  getValidatedConfig,
  handleDisconnect,
  getDownloadSettings
});
</script>

<style scoped>
.connection-panel {
  width: 100%;
  max-width: 640px;
  margin: 0 auto 20px auto;
  box-sizing: border-box;
}

.connection-form {
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
}

.connection-form :deep(.el-input-number) {
	width: 100%;
	display: flex;
}

.connection-form :deep(.el-input-number .el-input) {
	flex: 1;
	min-width: 0;
}

.connection-form :deep(.el-input-number .el-input__wrapper) {
	flex: 1;
	width: 100%;
	min-width: 0;
}

.connection-form :deep(.el-input-number__increase),
.connection-form :deep(.el-input-number__decrease) {
	width: 36px;
	min-width: 36px;
}

.connection-form :deep(.el-input-number:focus-within .el-input-number__increase),
.connection-form :deep(.el-input-number:focus-within .el-input-number__decrease) {
	background-color: var(--el-color-primary-light-9);
	border-color: var(--el-color-primary);
	color: var(--el-color-primary);
}

.connection-form :deep(.el-input-number:focus-within .el-input__wrapper) {
	box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}

.connection-form :deep(.el-input.is-focus .el-input-group__prepend),
.connection-form :deep(.el-input:focus-within .el-input-group__prepend) {
	background-color: var(--el-color-primary-light-9);
	border-color: var(--el-color-primary);
	color: var(--el-color-primary);
}

.settings-tabs {
  width: 100%;
}

.download-settings-form {
  max-width: 520px;
  margin: 0 auto;
  padding: 16px 0;
}

.download-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.download-actions :deep(.el-form-item__content) {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.download-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 6px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-tag {
  margin-left: auto;
}

:deep(.el-form-item__label) {
  font-weight: 500;
}

:deep(.el-input-group__prepend) {
  background-color: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  border-color: var(--el-border-color);
}

.el-button + .el-button {
  margin-left: 10px;
}

.action-row {
  margin-top: 12px;
}

.action-row :deep(.el-form-item__content) {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.action-row :deep(.el-button + .el-button) {
  margin-left: 0;
}

@media (max-width: 768px) {
  .connection-panel {
    max-width: 100%;
  }
  
  .connection-form {
    max-width: 100%;
    padding: 0 12px;
  }
  
  :deep(.el-form-item__label) {
    text-align: left !important;
  }
  
  .el-button {
    width: 100%;
    margin-left: 0 !important;
    margin-top: 8px;
  }

  .action-row :deep(.el-form-item__content) {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
}
</style>
