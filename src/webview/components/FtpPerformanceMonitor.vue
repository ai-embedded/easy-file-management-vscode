<template>
  <div class="ftp-performance-monitor">
    <div class="monitor-header">
      <h2>FTP 性能监控</h2>
      <p class="description">实时监控 FTP 传输性能和优化效果</p>
      <div class="monitor-controls">
        <el-switch
          v-model="isMonitoring"
          active-text="监控中"
          inactive-text="已暂停"
          @change="toggleMonitoring"
        />
        <el-button @click="refreshData" :loading="refreshing">
          <el-icon><Refresh /></el-icon>
          刷新数据
        </el-button>
        <el-button @click="exportReport">
          <el-icon><Download /></el-icon>
          导出报告
        </el-button>
      </div>
    </div>

    <!-- 概览卡片 -->
    <el-row :gutter="20" class="overview-cards">
      <el-col :span="6">
        <el-card class="metric-card">
          <div class="metric-content">
            <div class="metric-value">{{ formatSpeed(currentStats.transferSpeed) }}</div>
            <div class="metric-label">当前传输速度</div>
            <div class="metric-trend" :class="getSpeedTrendClass()">
              <el-icon><ArrowUp v-if="speedTrend > 0" /><ArrowDown v-else /></el-icon>
              {{ Math.abs(speedTrend) }}%
            </div>
          </div>
        </el-card>
      </el-col>
      
      <el-col :span="6">
        <el-card class="metric-card">
          <div class="metric-content">
            <div class="metric-value">{{ currentStats.activeConnections }}/{{ currentStats.maxConnections }}</div>
            <div class="metric-label">活动连接数</div>
            <div class="metric-indicator">
              <el-progress 
                :percentage="(currentStats.activeConnections / currentStats.maxConnections) * 100"
                :color="getConnectionColor()"
                :show-text="false"
                :stroke-width="4"
              />
            </div>
          </div>
        </el-card>
      </el-col>
      
      <el-col :span="6">
        <el-card class="metric-card">
          <div class="metric-content">
            <div class="metric-value">{{ currentStats.successRate.toFixed(1) }}%</div>
            <div class="metric-label">传输成功率</div>
            <div class="metric-trend success">
              <el-icon><Check /></el-icon>
              {{ currentStats.totalTransfers }} 次传输
            </div>
          </div>
        </el-card>
      </el-col>
      
      <el-col :span="6">
        <el-card class="metric-card">
          <div class="metric-content">
            <div class="metric-value">{{ formatFileSize(currentStats.totalDataTransferred) }}</div>
            <div class="metric-label">累计传输量</div>
            <div class="metric-trend">
              <el-icon><DataBoard /></el-icon>
              今日传输
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 实时图表 -->
    <el-row :gutter="20" class="charts-section">
      <el-col :span="12">
        <el-card>
          <template #header>
            <h3><el-icon><TrendCharts /></el-icon> 传输速度趋势</h3>
          </template>
          <div id="speedChart" class="chart-container"></div>
        </el-card>
      </el-col>
      
      <el-col :span="12">
        <el-card>
          <template #header>
            <h3><el-icon><Connection /></el-icon> 连接池状态</h3>
          </template>
          <div class="connection-pool-stats">
            <div class="pool-metric">
              <span class="label">池大小：</span>
              <span class="value">{{ poolStats.poolSize }}</span>
            </div>
            <div class="pool-metric">
              <span class="label">空闲连接：</span>
              <span class="value">{{ poolStats.idleConnections }}</span>
            </div>
            <div class="pool-metric">
              <span class="label">等待队列：</span>
              <span class="value">{{ poolStats.waitingQueue }}</span>
            </div>
            <div class="pool-metric">
              <span class="label">复用次数：</span>
              <span class="value">{{ poolStats.reuseCount }}</span>
            </div>
            <div id="connectionChart" class="chart-container"></div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 详细统计 -->
    <el-row :gutter="20" class="details-section">
      <el-col :span="8">
        <el-card>
          <template #header>
            <h3><el-icon><List /></el-icon> 优化效果统计</h3>
          </template>
          <div class="optimization-stats">
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="标准优化提升">
                <el-tag type="success">+{{ optimizationStats.standardImprovement }}%</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="扩展功能提升">
                <el-tag type="primary">+{{ optimizationStats.extendedImprovement }}%</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="连接复用节省">
                <span>{{ optimizationStats.connectionReuseSavings }}ms</span>
              </el-descriptions-item>
              <el-descriptions-item label="缓存命中率">
                <el-progress
                  :percentage="optimizationStats.cacheHitRate"
                  :stroke-width="6"
                  :color="getCacheColor()"
                />
              </el-descriptions-item>
              <el-descriptions-item label="压缩传输节省">
                <span>{{ formatFileSize(optimizationStats.compressionSavings) }}</span>
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </el-card>
      </el-col>
      
      <el-col :span="8">
        <el-card>
          <template #header>
            <h3><el-icon><Warning /></el-icon> 错误和重试统计</h3>
          </template>
          <div class="error-stats">
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="网络错误">
                <el-tag type="warning">{{ errorStats.networkErrors }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="超时错误">
                <el-tag type="danger">{{ errorStats.timeoutErrors }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="认证错误">
                <el-tag type="danger">{{ errorStats.authErrors }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="重试成功次数">
                <el-tag type="success">{{ errorStats.retrySuccesses }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="最大重试次数">
                <span>{{ errorStats.maxRetries }}</span>
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </el-card>
      </el-col>
      
      <el-col :span="8">
        <el-card>
          <template #header>
            <h3><el-icon><Monitor /></el-icon> 服务器性能指标</h3>
          </template>
          <div class="server-stats">
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="响应延迟">
                <span>{{ serverStats.responseTime }}ms</span>
              </el-descriptions-item>
              <el-descriptions-item label="服务器负载">
                <el-progress
                  :percentage="serverStats.serverLoad"
                  :stroke-width="6"
                  :color="getServerLoadColor()"
                />
              </el-descriptions-item>
              <el-descriptions-item label="支持的功能">
                <div class="capability-tags">
                  <el-tag 
                    v-for="feature in serverStats.supportedFeatures" 
                    :key="feature"
                    size="small"
                    type="primary"
                  >
                    {{ feature }}
                  </el-tag>
                </div>
              </el-descriptions-item>
              <el-descriptions-item label="检测可靠度">
                <el-rate
                  v-model="serverStats.detectionReliability"
                  :max="5"
                  :allow-half="true"
                  disabled
                  show-score
                />
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 实时日志 -->
    <el-card class="log-section">
      <template #header>
        <div class="log-header">
          <h3><el-icon><Document /></el-icon> 实时日志</h3>
          <div class="log-controls">
            <el-select v-model="logLevel" size="small" style="width: 100px">
              <el-option label="全部" value="all" />
              <el-option label="错误" value="error" />
              <el-option label="警告" value="warn" />
              <el-option label="信息" value="info" />
            </el-select>
            <el-button size="small" @click="clearLogs">清空日志</el-button>
          </div>
        </div>
      </template>
      
      <div class="log-container">
        <div 
          v-for="log in filteredLogs" 
          :key="log.id"
          :class="['log-entry', `log-${log.level}`]"
        >
          <span class="log-time">{{ formatTime(log.timestamp) }}</span>
          <span class="log-level">{{ log.level.toUpperCase() }}</span>
          <span class="log-message">{{ log.message }}</span>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Refresh,
  Download,
  ArrowUp,
  ArrowDown,
  Check,
  DataBoard,
  TrendCharts,
  Connection,
  List,
  Warning,
  Monitor,
  Document
} from '@element-plus/icons-vue'
import { ftpPerformanceService, type PerformanceEvent } from '../services/FtpPerformanceService'

// 响应式数据
const isMonitoring = ref(true)
const refreshing = ref(false)
const logLevel = ref('all')
const speedTrend = ref(0)

// 当前统计数据
const currentStats = reactive({
  transferSpeed: 0, // bytes/second
  activeConnections: 0,
  maxConnections: 3,
  successRate: 98.5,
  totalTransfers: 156,
  totalDataTransferred: 2048 * 1024 * 1024 // bytes
})

// 连接池统计
const poolStats = reactive({
  poolSize: 5,
  idleConnections: 3,
  waitingQueue: 0,
  reuseCount: 89
})

// 优化效果统计
const optimizationStats = reactive({
  standardImprovement: 25,
  extendedImprovement: 45,
  connectionReuseSavings: 350,
  cacheHitRate: 78,
  compressionSavings: 512 * 1024 * 1024
})

// 错误统计
const errorStats = reactive({
  networkErrors: 3,
  timeoutErrors: 1,
  authErrors: 0,
  retrySuccesses: 12,
  maxRetries: 3
})

// 服务器统计
const serverStats = reactive({
  responseTime: 125,
  serverLoad: 45,
  supportedFeatures: ['PASV', 'EPSV', 'REST', 'SIZE', 'MLSD'],
  detectionReliability: 4.5
})

// 日志数据
const logs = ref<Array<{
  id: number,
  timestamp: number,
  level: string,
  message: string
}>>([
  { id: 1, timestamp: Date.now() - 1000, level: 'info', message: 'FTP连接池已初始化，最大连接数: 5' },
  { id: 2, timestamp: Date.now() - 800, level: 'info', message: '检测到服务器支持断点续传功能' },
  { id: 3, timestamp: Date.now() - 600, level: 'warn', message: '连接复用失败，创建新连接' },
  { id: 4, timestamp: Date.now() - 400, level: 'info', message: '文件传输完成: document.pdf (2.5MB)' },
  { id: 5, timestamp: Date.now() - 200, level: 'info', message: '缓存命中: 目录列表 /uploads/' }
])

let monitoringInterval: NodeJS.Timeout | null = null
let logIdCounter = 6

// 计算属性
const filteredLogs = computed(() => {
  if (logLevel.value === 'all') return logs.value
  return logs.value.filter(log => log.level === logLevel.value)
})

// 方法
const toggleMonitoring = (value: boolean) => {
  if (value) {
    startMonitoring()
  } else {
    stopMonitoring()
  }
}

const startMonitoring = () => {
  if (monitoringInterval) return
  
  // 启动性能服务监控
  ftpPerformanceService.startMonitoring(2000)
  
  // 监听性能更新事件
  ftpPerformanceService.on('metricsUpdated', (metrics) => {
    updateStatsFromService(metrics)
  })
  
  // 监听事件日志
  ftpPerformanceService.on('transferEvent', (event: PerformanceEvent) => {
    addEventToLog(event)
  })
  
  ftpPerformanceService.on('connectionEvent', (event: PerformanceEvent) => {
    addEventToLog(event)
  })
  
  ftpPerformanceService.on('optimizationEvent', (event: PerformanceEvent) => {
    addEventToLog(event)
  })
  
  // 初始化数据
  updateStatsFromService()
  loadRecentEvents()
  
  // 初始化图表
  nextTick(() => {
    initCharts()
  })
}

const stopMonitoring = () => {
  // 停止性能服务监控
  ftpPerformanceService.stopMonitoring()
  
  // 移除事件监听器
  ftpPerformanceService.off('metricsUpdated', updateStatsFromService)
  ftpPerformanceService.off('transferEvent', addEventToLog)
  ftpPerformanceService.off('connectionEvent', addEventToLog)
  ftpPerformanceService.off('optimizationEvent', addEventToLog)
}

const updateStatsFromService = (metrics?: any) => {
  // 获取性能摘要
  const summary = ftpPerformanceService.getPerformanceSummary()
  
  if (summary.current) {
    const oldSpeed = currentStats.transferSpeed
    currentStats.transferSpeed = summary.current.transferSpeed
    currentStats.activeConnections = summary.current.activeConnections
    currentStats.maxConnections = summary.current.maxConnections
    currentStats.successRate = summary.current.successRate
    currentStats.totalTransfers = summary.current.totalTransfers
    currentStats.totalDataTransferred = summary.current.totalDataTransferred
    
    // 计算速度趋势
    if (oldSpeed > 0) {
      speedTrend.value = ((currentStats.transferSpeed - oldSpeed) / oldSpeed) * 100
    }
  }
  
  // 更新连接池状态
  const connectionMetrics = ftpPerformanceService.getConnectionPoolMetrics()
  Object.assign(poolStats, connectionMetrics)
  
  // 更新优化统计
  const optimizationMetrics = ftpPerformanceService.getOptimizationMetrics()
  Object.assign(optimizationStats, optimizationMetrics)
  
  // 更新错误统计
  const errorMetrics = ftpPerformanceService.getErrorMetrics()
  Object.assign(errorStats, errorMetrics)
  
  // 更新服务器统计
  const serverMetrics = ftpPerformanceService.getServerMetrics()
  Object.assign(serverStats, serverMetrics)
}

const addEventToLog = (event: PerformanceEvent) => {
  logs.value.unshift({
    id: parseInt(event.id.split('_')[1]) || logIdCounter++,
    timestamp: event.timestamp,
    level: event.level,
    message: event.message
  })
  
  // 保持日志数量在合理范围
  if (logs.value.length > 50) {
    logs.value = logs.value.slice(0, 50)
  }
}

const loadRecentEvents = () => {
  const events = ftpPerformanceService.getRecentEvents(20)
  logs.value = events.map(event => ({
    id: parseInt(event.id.split('_')[1]) || logIdCounter++,
    timestamp: event.timestamp,
    level: event.level,
    message: event.message
  }))
}

const refreshData = async () => {
  refreshing.value = true
  try {
    // 从服务刷新数据
    updateStatsFromService()
    loadRecentEvents()
    ElMessage.success('数据刷新完成')
  } catch (error) {
    ElMessage.error('数据刷新失败')
  } finally {
    refreshing.value = false
  }
}

const exportReport = () => {
  try {
    // 使用性能服务生成完整报告
    const report = ftpPerformanceService.generateReport(24) // 24小时报告
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ftp-performance-report-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    
    ElMessage.success('性能报告已导出')
  } catch (error) {
    ElMessage.error('报告生成失败')
  }
}

const clearLogs = () => {
  // 清除服务中的历史数据
  ftpPerformanceService.clearHistory()
  logs.value = []
  ElMessage.success('日志已清空')
}

const formatSpeed = (speed: number): string => {
  if (speed < 1024) return `${speed.toFixed(0)} B/s`
  if (speed < 1024 * 1024) return `${(speed / 1024).toFixed(1)} KB/s`
  return `${(speed / (1024 * 1024)).toFixed(1)} MB/s`
}

const formatFileSize = (size: number): string => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString()
}

const getSpeedTrendClass = () => {
  return speedTrend.value > 0 ? 'trend-up' : 'trend-down'
}

const getConnectionColor = () => {
  const ratio = currentStats.activeConnections / currentStats.maxConnections
  if (ratio < 0.5) return '#67c23a'
  if (ratio < 0.8) return '#e6a23c'
  return '#f56c6c'
}

const getCacheColor = () => {
  if (optimizationStats.cacheHitRate >= 80) return '#67c23a'
  if (optimizationStats.cacheHitRate >= 60) return '#e6a23c'
  return '#f56c6c'
}

const getServerLoadColor = () => {
  if (serverStats.serverLoad < 50) return '#67c23a'
  if (serverStats.serverLoad < 80) return '#e6a23c'
  return '#f56c6c'
}

const initCharts = () => {
  // 这里可以集成图表库（如 ECharts）来显示实时图表
  // 由于这是示例代码，暂时用简单的占位符
  console.log('初始化图表组件')
}

// 生命周期
onMounted(() => {
  startMonitoring()
})

onUnmounted(() => {
  stopMonitoring()
})
</script>

<style scoped lang="scss">
.ftp-performance-monitor {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;

  .monitor-header {
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
      margin-bottom: 20px;
    }

    .monitor-controls {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 15px;
    }
  }

  .overview-cards {
    margin-bottom: 30px;

    .metric-card {
      text-align: center;

      .metric-content {
        .metric-value {
          font-size: 28px;
          font-weight: bold;
          color: #409eff;
          margin-bottom: 5px;
        }

        .metric-label {
          font-size: 14px;
          color: #909399;
          margin-bottom: 10px;
        }

        .metric-trend {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          font-size: 12px;

          &.trend-up {
            color: #67c23a;
          }

          &.trend-down {
            color: #f56c6c;
          }

          &.success {
            color: #67c23a;
          }
        }

        .metric-indicator {
          margin-top: 10px;
        }
      }
    }
  }

  .charts-section, .details-section {
    margin-bottom: 30px;

    .chart-container {
      height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f5f7fa;
      border-radius: 4px;
      color: #909399;
      font-size: 14px;
    }

    .connection-pool-stats {
      .pool-metric {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid #ebeef5;

        .label {
          color: #606266;
        }

        .value {
          font-weight: bold;
          color: #303133;
        }

        &:last-child {
          border-bottom: none;
        }
      }
    }

    .capability-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
  }

  .log-section {
    .log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;

      h3 {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        color: #303133;
        font-size: 16px;
        font-weight: 500;
      }

      .log-controls {
        display: flex;
        align-items: center;
        gap: 10px;
      }
    }

    .log-container {
      max-height: 300px;
      overflow-y: auto;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      line-height: 1.4;

      .log-entry {
        display: flex;
        padding: 4px 0;
        border-bottom: 1px solid #f0f0f0;

        .log-time {
          color: #909399;
          margin-right: 10px;
          min-width: 80px;
        }

        .log-level {
          font-weight: bold;
          margin-right: 10px;
          min-width: 50px;

          &.INFO {
            color: #409eff;
          }

          &.WARN {
            color: #e6a23c;
          }

          &.ERROR {
            color: #f56c6c;
          }
        }

        .log-message {
          flex: 1;
          color: #303133;
        }

        &.log-error {
          background-color: #fef0f0;
        }

        &.log-warn {
          background-color: #fdf6ec;
        }

        &.log-info {
          background-color: #f4f4f5;
        }
      }
    }
  }
}

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

// 响应式设计
@media (max-width: 768px) {
  .ftp-performance-monitor {
    padding: 15px;

    .overview-cards {
      .el-col {
        margin-bottom: 15px;
      }
    }

    .charts-section, .details-section {
      .el-col {
        margin-bottom: 15px;
      }
    }

    .monitor-controls {
      flex-direction: column;
      gap: 10px;
    }
  }
}
</style>