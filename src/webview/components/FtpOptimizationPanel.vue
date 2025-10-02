<template>
  <div class="ftp-optimization-panel">
    <div class="panel-header">
      <h2>FTP 通讯优化配置</h2>
      <p class="description">配置 FTP 连接优化策略，提升传输性能</p>
    </div>

    <el-form 
      :model="config" 
      :rules="rules" 
      ref="configFormRef" 
      label-width="150px"
      size="default"
    >
      <!-- 基础服务器配置 -->
      <el-card class="config-section">
        <template #header>
          <h3><el-icon><Connection /></el-icon> 服务器连接</h3>
        </template>
        
        <el-form-item label="服务器地址" prop="server.host" required>
          <el-input 
            v-model="config.server.host" 
            placeholder="请输入FTP服务器地址"
          />
        </el-form-item>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="端口" prop="server.port">
              <el-input-number 
                v-model="config.server.port" 
                :min="1" 
                :max="65535"
                controls-position="right"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="用户名" prop="server.username" required>
              <el-input 
                v-model="config.server.username"
                placeholder="请输入用户名"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="密码" prop="server.password" required>
          <el-input 
            v-model="config.server.password" 
            type="password"
            placeholder="请输入密码"
            show-password
          />
        </el-form-item>

        <el-form-item label="安全连接">
          <el-switch 
            v-model="config.security.enableSecureConnection"
            active-text="启用 FTPS"
            inactive-text="标准 FTP"
          />
        </el-form-item>
      </el-card>

      <!-- 优化策略配置 -->
      <el-card class="config-section">
        <template #header>
          <h3><el-icon><Tools /></el-icon> 优化策略</h3>
        </template>

        <el-form-item label="预设配置">
          <el-radio-group v-model="selectedPreset" @change="applyPreset">
            <el-radio-button label="conservative">保守模式</el-radio-button>
            <el-radio-button label="balanced">平衡模式</el-radio-button>
            <el-radio-button label="aggressive">激进模式</el-radio-button>
            <el-radio-button label="custom">自定义</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <!-- 标准优化选项 -->
        <el-divider content-position="left">标准优化 (兼容所有服务器)</el-divider>
        
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item>
              <el-checkbox v-model="config.optimization.standard.connectionReuse">
                连接复用
              </el-checkbox>
              <div class="option-desc">重用现有连接，减少连接开销</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item>
              <el-checkbox v-model="config.optimization.standard.streamProcessing">
                流式处理
              </el-checkbox>
              <div class="option-desc">大文件分块处理，降低内存占用</div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item>
              <el-checkbox v-model="config.optimization.standard.localCache">
                本地缓存
              </el-checkbox>
              <div class="option-desc">缓存目录结构，加速后续操作</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item>
              <el-checkbox v-model="config.optimization.standard.intelligentRetry">
                智能重试
              </el-checkbox>
              <div class="option-desc">网络中断时自动重试</div>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 扩展优化选项 -->
        <el-divider content-position="left">扩展优化 (需要服务器支持)</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="断点续传">
              <el-select v-model="config.optimization.extended.resumableTransfer">
                <el-option label="自动检测" value="auto" />
                <el-option label="强制启用" :value="true" />
                <el-option label="禁用" :value="false" />
              </el-select>
              <div class="option-desc">支持大文件的断点续传</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="压缩传输">
              <el-select v-model="config.optimization.extended.compressionTransfer">
                <el-option label="自动检测" value="auto" />
                <el-option label="强制启用" :value="true" />
                <el-option label="禁用" :value="false" />
              </el-select>
              <div class="option-desc">文本文件压缩传输</div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="多连接传输">
              <el-select v-model="config.optimization.extended.multiConnection">
                <el-option label="自动检测" value="auto" />
                <el-option label="强制启用" :value="true" />
                <el-option label="禁用" :value="false" />
              </el-select>
              <div class="option-desc">并行连接加速传输</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="增强列表">
              <el-select v-model="config.optimization.extended.enhancedListing">
                <el-option label="自动检测" value="auto" />
                <el-option label="强制启用" :value="true" />
                <el-option label="禁用" :value="false" />
              </el-select>
              <div class="option-desc">使用 MLSD 命令获取详细信息</div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-card>

      <!-- 性能参数配置 -->
      <el-card class="config-section">
        <template #header>
          <h3><el-icon><Setting /></el-icon> 性能参数</h3>
        </template>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="最大连接数">
              <el-input-number 
                v-model="config.performance.maxConnections"
                :min="1"
                :max="10"
                controls-position="right"
                style="width: 100%"
              />
              <div class="option-desc">同时建立的最大连接数</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="缓冲区大小 (KB)">
              <el-input-number 
                v-model="bufferSizeKB"
                :min="16"
                :max="1024"
                :step="16"
                controls-position="right"
                style="width: 100%"
                @change="updateBufferSize"
              />
              <div class="option-desc">数据传输缓冲区大小</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="传输超时 (秒)">
              <el-input-number 
                v-model="transferTimeoutSec"
                :min="10"
                :max="600"
                :step="10"
                controls-position="right"
                style="width: 100%"
                @change="updateTransferTimeout"
              />
              <div class="option-desc">单个传输操作超时时间</div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-card>

      <!-- 兼容性设置 -->
      <el-card class="config-section">
        <template #header>
          <h3><el-icon><Check /></el-icon> 兼容性设置</h3>
        </template>

        <el-form-item>
          <el-checkbox v-model="config.server.compatibility.strictStandardMode">
            严格标准模式
          </el-checkbox>
          <div class="option-desc">仅使用标准FTP命令，确保最大兼容性</div>
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="config.server.compatibility.assumeBasicFtpOnly">
            假设基础FTP
          </el-checkbox>
          <div class="option-desc">假设服务器只支持基础功能，禁用所有扩展特性</div>
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="config.server.compatibility.skipCapabilityDetection">
            跳过能力检测
          </el-checkbox>
          <div class="option-desc">不检测服务器扩展功能，直接使用配置</div>
        </el-form-item>
      </el-card>

      <!-- 监控和日志 -->
      <el-card class="config-section">
        <template #header>
          <h3><el-icon><Monitor /></el-icon> 监控与日志</h3>
        </template>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item>
              <el-checkbox v-model="config.monitoring.enablePerformanceMonitoring">
                性能监控
              </el-checkbox>
              <div class="option-desc">收集传输性能统计信息</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item>
              <el-checkbox v-model="config.monitoring.enableDetailedLogging">
                详细日志
              </el-checkbox>
              <div class="option-desc">记录详细的操作日志</div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="日志级别">
          <el-radio-group v-model="config.monitoring.logLevel">
            <el-radio-button label="error">错误</el-radio-button>
            <el-radio-button label="warn">警告</el-radio-button>
            <el-radio-button label="info">信息</el-radio-button>
            <el-radio-button label="debug">调试</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-card>

      <!-- 按钮区域 -->
      <div class="button-area">
        <el-button @click="testConnection" :loading="testing">
          <el-icon><Connection /></el-icon>
          测试连接
        </el-button>
        
        <el-button @click="detectCapabilities" :loading="detecting">
          <el-icon><Search /></el-icon>
          检测服务器能力
        </el-button>

        <el-button type="primary" @click="saveConfig" :loading="saving">
          <el-icon><Select /></el-icon>
          保存配置
        </el-button>

        <el-button @click="resetToDefault">
          <el-icon><RefreshRight /></el-icon>
          重置为默认
        </el-button>
      </div>
    </el-form>

    <!-- 服务器能力检测结果 -->
    <el-dialog 
      v-model="showCapabilitiesDialog" 
      title="服务器能力检测结果"
      width="600px"
    >
      <div v-if="serverCapabilities" class="capabilities-result">
        <h4>基础能力</h4>
        <el-descriptions :column="2" size="small">
          <el-descriptions-item label="被动模式">
            <el-tag :type="serverCapabilities.supportsPASV ? 'success' : 'danger'">
              {{ serverCapabilities.supportsPASV ? '支持' : '不支持' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="断点续传">
            <el-tag :type="serverCapabilities.supportsREST ? 'success' : 'danger'">
              {{ serverCapabilities.supportsREST ? '支持' : '不支持' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="文件大小查询">
            <el-tag :type="serverCapabilities.supportsSIZE ? 'success' : 'danger'">
              {{ serverCapabilities.supportsSIZE ? '支持' : '不支持' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="修改时间查询">
            <el-tag :type="serverCapabilities.supportsMDTM ? 'success' : 'danger'">
              {{ serverCapabilities.supportsMDTM ? '支持' : '不支持' }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <h4>扩展能力</h4>
        <el-descriptions :column="2" size="small">
          <el-descriptions-item label="压缩传输">
            <el-tag :type="serverCapabilities.supportsModeZ ? 'success' : 'danger'">
              {{ serverCapabilities.supportsModeZ ? '支持' : '不支持' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="增强列表">
            <el-tag :type="serverCapabilities.supportsMLSD ? 'success' : 'danger'">
              {{ serverCapabilities.supportsMLSD ? '支持' : '不支持' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="UTF8编码">
            <el-tag :type="serverCapabilities.supportsUTF8 ? 'success' : 'danger'">
              {{ serverCapabilities.supportsUTF8 ? '支持' : '不支持' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="最大连接数">
            <el-tag type="info">{{ serverCapabilities.maxConnections }}</el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <h4>性能特征</h4>
        <el-descriptions :column="1" size="small">
          <el-descriptions-item label="服务器软件">
            {{ serverCapabilities.serverSoftware }}
          </el-descriptions-item>
          <el-descriptions-item label="建议缓冲区大小">
            {{ Math.round(serverCapabilities.transferBufferSize / 1024) }} KB
          </el-descriptions-item>
          <el-descriptions-item label="检测可靠度">
            <el-progress 
              :percentage="Math.round(serverCapabilities.detectionReliability * 100)"
              :color="getReliabilityColor(serverCapabilities.detectionReliability)"
            />
          </el-descriptions-item>
        </el-descriptions>
      </div>
      
      <template #footer>
        <el-button @click="applyDetectedCapabilities" type="primary">
          应用检测结果到配置
        </el-button>
        <el-button @click="showCapabilitiesDialog = false">
          关闭
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  Connection, 
  Tools, 
  Setting, 
  Check, 
  Monitor, 
  Search, 
  Select, 
  RefreshRight 
} from '@element-plus/icons-vue'
import type { OptimizedFtpConfig, FtpServerCapabilities } from '../../shared/types/ftp'

// 响应式数据
const configFormRef = ref()
const selectedPreset = ref<'conservative' | 'balanced' | 'aggressive' | 'custom'>('balanced')
const testing = ref(false)
const detecting = ref(false)
const saving = ref(false)
const showCapabilitiesDialog = ref(false)
const serverCapabilities = ref<FtpServerCapabilities>()

// 默认配置
const defaultConfig: OptimizedFtpConfig = {
  server: {
    host: '',
    port: 21,
    username: '',
    password: '',
    secure: false,
    capabilities: 'auto-detect',
    compatibility: {
      strictStandardMode: false,
      assumeBasicFtpOnly: false,
      skipCapabilityDetection: false
    }
  },
  optimization: {
    standard: {
      connectionReuse: true,
      streamProcessing: true,
      localCache: true,
      clientCompression: false,
      intelligentRetry: true,
      transferModeOptimization: true
    },
    extended: {
      resumableTransfer: 'auto',
      compressionTransfer: 'auto',
      multiConnection: 'auto',
      enhancedListing: 'auto'
    },
    advanced: {
      hybridProtocol: false,
      customExtensions: []
    }
  },
  performance: {
    maxConnections: 3,
    transferTimeout: 60000,
    bufferSize: 64 * 1024,
    chunkSize: 1024 * 1024,
    maxMemoryUsage: 100 * 1024 * 1024,
    adaptive: {
      enabled: true,
      adjustBasedOnSpeed: true,
      adjustBasedOnLatency: true,
      learningMode: false
    }
  },
  monitoring: {
    enablePerformanceMonitoring: true,
    enableDetailedLogging: false,
    enableStatisticsCollection: true,
    logLevel: 'info'
  },
  security: {
    enableSecureConnection: false,
    validateServerCertificate: false,
    allowInsecureConnections: true,
    connectionTimeout: 30000
  }
}

// 当前配置
const config = reactive<OptimizedFtpConfig>({ ...defaultConfig })

// 便于编辑的计算属性
const bufferSizeKB = computed({
  get: () => Math.round(config.performance.bufferSize / 1024),
  set: (value: number) => updateBufferSize(value)
})

const transferTimeoutSec = computed({
  get: () => Math.round(config.performance.transferTimeout / 1000),
  set: (value: number) => updateTransferTimeout(value)
})

// 表单验证规则
const rules = {
  'server.host': [
    { required: true, message: '请输入服务器地址', trigger: 'blur' }
  ],
  'server.username': [
    { required: true, message: '请输入用户名', trigger: 'blur' }
  ],
  'server.password': [
    { required: true, message: '请输入密码', trigger: 'blur' }
  ]
}

// 方法
const updateBufferSize = (value: number) => {
  config.performance.bufferSize = value * 1024
}

const updateTransferTimeout = (value: number) => {
  config.performance.transferTimeout = value * 1000
}

const applyPreset = (preset: string) => {
  selectedPreset.value = preset as any
  
  switch (preset) {
    case 'conservative':
      config.optimization.standard.connectionReuse = false
      config.optimization.extended.resumableTransfer = false
      config.optimization.extended.compressionTransfer = false
      config.performance.maxConnections = 1
      config.performance.bufferSize = 32 * 1024
      break
    
    case 'aggressive':
      config.optimization.extended.resumableTransfer = 'auto'
      config.optimization.extended.compressionTransfer = 'auto'
      config.optimization.extended.multiConnection = 'auto'
      config.performance.maxConnections = 5
      config.performance.bufferSize = 128 * 1024
      config.performance.adaptive.enabled = true
      break
    
    case 'balanced':
    default:
      Object.assign(config.optimization, defaultConfig.optimization)
      Object.assign(config.performance, defaultConfig.performance)
      break
  }
  
  if (preset !== 'custom') {
    ElMessage.success(`已应用${preset}预设配置`)
  }
}

const testConnection = async () => {
  if (!configFormRef.value) return
  
  try {
    await configFormRef.value.validate()
    testing.value = true
    
    // TODO: 实际的连接测试逻辑
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    ElMessage.success('连接测试成功！')
  } catch (error) {
    ElMessage.error('连接测试失败，请检查配置')
  } finally {
    testing.value = false
  }
}

const detectCapabilities = async () => {
  if (!configFormRef.value) return
  
  try {
    await configFormRef.value.validate()
    detecting.value = true
    
    // TODO: 实际的能力检测逻辑
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // 模拟检测结果
    serverCapabilities.value = {
      supportsPASV: true,
      supportsEPSV: true,
      supportsREST: true,
      supportsSIZE: true,
      supportsMDTM: true,
      supportsModeZ: false,
      supportsMLSD: true,
      supportsSITE: true,
      supportsUTF8: true,
      supportsAPPE: true,
      maxConnections: 5,
      transferBufferSize: 64 * 1024,
      commandResponseTime: 150,
      serverSoftware: 'vsftpd 3.0.3',
      serverFeatures: ['PASV', 'EPSV', 'REST', 'SIZE', 'MDTM', 'MLSD'],
      protocolVersion: 'FTP 1.0',
      detectionTime: Date.now(),
      detectionReliability: 0.95
    }
    
    showCapabilitiesDialog.value = true
    ElMessage.success('服务器能力检测完成')
  } catch (error) {
    ElMessage.error('服务器能力检测失败')
  } finally {
    detecting.value = false
  }
}

const applyDetectedCapabilities = () => {
  if (!serverCapabilities.value) return
  
  const caps = serverCapabilities.value
  
  // 根据检测结果调整配置
  config.optimization.extended.resumableTransfer = caps.supportsREST
  config.optimization.extended.compressionTransfer = caps.supportsModeZ
  config.optimization.extended.enhancedListing = caps.supportsMLSD
  config.optimization.extended.multiConnection = caps.maxConnections > 1
  
  config.performance.maxConnections = Math.min(caps.maxConnections, 5)
  config.performance.bufferSize = caps.transferBufferSize
  
  config.server.capabilities = caps
  config.server.compatibility.skipCapabilityDetection = true
  
  showCapabilitiesDialog.value = false
  selectedPreset.value = 'custom'
  
  ElMessage.success('已根据检测结果优化配置')
}

const saveConfig = async () => {
  if (!configFormRef.value) return
  
  try {
    await configFormRef.value.validate()
    saving.value = true
    
    // TODO: 保存配置的实际逻辑
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    ElMessage.success('配置保存成功！')
  } catch (error) {
    ElMessage.error('配置验证失败，请检查输入')
  } finally {
    saving.value = false
  }
}

const resetToDefault = async () => {
  try {
    await ElMessageBox.confirm('确定要重置为默认配置吗？', '确认重置', {
      type: 'warning'
    })
    
    Object.assign(config, defaultConfig)
    selectedPreset.value = 'balanced'
    
    ElMessage.success('已重置为默认配置')
  } catch {
    // 用户取消
  }
}

const getReliabilityColor = (reliability: number) => {
  if (reliability >= 0.8) return '#67c23a'
  if (reliability >= 0.6) return '#e6a23c'
  return '#f56c6c'
}

// 生命周期
onMounted(() => {
  // 初始化配置，可以从存储中加载
  console.log('FTP优化配置面板已加载')
})
</script>

<style scoped lang="scss">
.ftp-optimization-panel {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;

  .panel-header {
    text-align: center;
    margin-bottom: 30px;

    h2 {
      color: #303133;
      margin-bottom: 10px;
      font-size: 24px;
      font-weight: 500;
    }

    .description {
      color: #606266;
      font-size: 14px;
      margin: 0;
    }
  }

  .config-section {
    margin-bottom: 20px;

    :deep(.el-card__header) {
      padding: 15px 20px;
      background-color: #fafbfc;

      h3 {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        color: #303133;
        font-size: 16px;
        font-weight: 500;
      }
    }

    :deep(.el-card__body) {
      padding: 20px;
    }
  }

  .option-desc {
    font-size: 12px;
    color: #909399;
    margin-top: 4px;
    line-height: 1.4;
  }

  .button-area {
    text-align: center;
    margin-top: 30px;
    padding-top: 20px;
    border-top: 1px solid #ebeef5;

    .el-button {
      margin: 0 8px;
    }
  }

  .capabilities-result {
    h4 {
      color: #303133;
      margin: 20px 0 15px;
      padding-bottom: 8px;
      border-bottom: 1px solid #ebeef5;
      font-size: 14px;
      font-weight: 500;

      &:first-child {
        margin-top: 0;
      }
    }

    :deep(.el-descriptions) {
      margin-bottom: 20px;
    }
  }
}

// 响应式设计
@media (max-width: 768px) {
  .ftp-optimization-panel {
    padding: 15px;

    .button-area .el-button {
      margin: 5px;
      width: calc(50% - 10px);
    }
  }
}
</style>