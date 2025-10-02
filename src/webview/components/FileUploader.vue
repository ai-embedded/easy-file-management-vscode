<template>
  <el-card class="file-uploader">
    <template #header>
      <div class="uploader-header">
        <span>文件上传</span>
        <el-tag v-if="uploadingFiles.length > 0" type="warning">
          正在上传 {{ uploadingFiles.length }} 个文件
        </el-tag>
      </div>
    </template>

    <div class="upload-area">
      <el-upload
        ref="uploadRef"
        class="upload-dragger"
        drag
        :multiple="true"
        :auto-upload="false"
        :show-file-list="false"
        :on-change="handleFileChange"
        :before-upload="beforeUpload"
        :disabled="!connected"
      >
        <div class="upload-content">
          <el-icon class="upload-icon">
            <UploadFilled />
          </el-icon>
          <div class="upload-text">
            <p class="primary-text">
              {{ connected ? '将文件拖拽到此处，或' : '请先连接到服务器' }}
              <em v-if="connected">点击上传</em>
            </p>
            <p class="secondary-text" v-if="connected">
              支持多文件同时上传，最大单文件 {{ formatFileSize(maxFileSize) }}
            </p>
            <p class="secondary-text" v-if="currentPath">
              目标目录: {{ currentPath }}
            </p>
          </div>
        </div>
      </el-upload>
    </div>

    <!-- 文件列表 -->
    <div class="file-list" v-if="fileList.length > 0">
      <div class="list-header">
        <span>待上传文件 ({{ fileList.length }})</span>
        <div class="list-actions">
          <el-button 
            size="small" 
            @click="clearAll"
            :disabled="uploading"
          >
            清空
          </el-button>
          <el-button 
            type="primary" 
            size="small" 
            @click="startUpload"
            :disabled="!connected || uploading || fileList.length === 0"
            :loading="uploading"
          >
            {{ uploading ? '上传中...' : '开始上传' }}
          </el-button>
        </div>
      </div>

      <div class="file-items">
        <div
          v-for="(file, index) in fileList"
          :key="file.uid"
          class="file-item"
          :class="{
            'uploading': file.status === 'uploading',
            'success': file.status === 'success',
            'error': file.status === 'error'
          }"
        >
          <div class="file-info">
            <div class="file-main-info">
              <el-icon class="file-status-icon">
                <Loading v-if="file.status === 'uploading'" />
                <SuccessFilled v-else-if="file.status === 'success'" />
                <CircleCloseFilled v-else-if="file.status === 'error'" />
                <Document v-else />
              </el-icon>
              
              <div class="file-details">
                <div class="file-name" :title="file.name">{{ file.name }}</div>
                <div class="file-size">{{ formatFileSize(file.size) }}</div>
              </div>
            </div>

            <div class="file-actions">
              <el-button
                size="small"
                type="danger"
                :icon="Delete"
                @click="removeFile(index)"
                :disabled="file.status === 'uploading'"
                circle
              />
            </div>
          </div>

          <!-- 上传进度 -->
          <div class="progress-section" v-if="file.status === 'uploading' || file.status === 'success'">
            <el-progress
              :percentage="file.progress || 0"
              :status="file.status === 'success' ? 'success' : undefined"
              :stroke-width="6"
            >
              <template #default="{ percentage }">
                <span class="progress-percentage">{{ percentage }}%</span>
              </template>
            </el-progress>
            <div class="progress-text">
              <span v-if="file.status === 'uploading'" class="uploading-text">
                <span class="progress-detail">{{ formatFileSize(file.uploadedSize || 0) }} / {{ formatFileSize(file.size) }}</span>
                <span class="upload-speed" v-if="file.speed">{{ formatSpeed(file.speed) }}</span>
              </span>
              <span v-else-if="file.status === 'success'" class="success-text">
                上传完成
              </span>
            </div>
          </div>

          <!-- 错误信息 -->
          <div class="error-section" v-if="file.status === 'error'">
            <el-text type="danger" size="small">
              {{ file.errorMessage || '上传失败' }}
            </el-text>
          </div>
        </div>
      </div>
    </div>

    <!-- 上传统计 -->
    <div class="upload-stats" v-if="showStats">
      <el-row :gutter="16">
        <el-col :span="6">
          <el-statistic title="总文件数" :value="fileList.length" />
        </el-col>
        <el-col :span="6">
          <el-statistic 
            title="已完成" 
            :value="completedCount"
            value-style="color: var(--el-color-success)"
          />
        </el-col>
        <el-col :span="6">
          <el-statistic 
            title="失败" 
            :value="errorCount"
            value-style="color: var(--el-color-danger)"
          />
        </el-col>
        <el-col :span="6">
          <el-statistic 
            title="总进度" 
            :value="Math.round(overallProgress)"
            suffix="%"
            value-style="color: var(--el-color-primary)"
          />
        </el-col>
      </el-row>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { ElMessage, ElMessageBox, type UploadInstance, type UploadFile } from 'element-plus';
import {
  UploadFilled,
  Loading,
  SuccessFilled,
  CircleCloseFilled,
  Document,
  Delete
} from '@element-plus/icons-vue';
import { FileProgress, UploadConfig } from '../types';
import { formatFileSize } from '../utils/fileUtils';

// 定义文件状态类型
type FileStatus = 'waiting' | 'uploading' | 'success' | 'error';

// 扩展的文件信息
interface ExtendedFile {
  uid: string;
  name: string;
  size: number;
  file: File;
  status: FileStatus;
  progress?: number;
  uploadedSize?: number;
  errorMessage?: string;
  speed?: number; // 上传速度（字节/秒）
  startTime?: number; // 上传开始时间
  lastUpdateTime?: number; // 上次更新时间
  lastUploadedSize?: number; // 上次更新时的已上传大小
}

// 定义属性
interface Props {
  currentPath: string;
  connected: boolean;
  maxFileSize?: number;
  allowedTypes?: string[];
  showStats?: boolean;
  uploadService?: any; // 上传服务实例
}

const props = withDefaults(defineProps<Props>(), {
  maxFileSize: 100 * 1024 * 1024, // 100MB
  allowedTypes: () => [],
  showStats: true
});

// 定义事件
const emit = defineEmits<{
  upload: [file: File, targetPath: string, onProgress: (progress: FileProgress) => void];
  uploadComplete: [results: Array<{ file: File; success: boolean; error?: string }>];
  uploadStart: [files: ExtendedFile[]];
}>();

// 响应式数据
const uploadRef = ref<UploadInstance>();
const fileList = ref<ExtendedFile[]>([]);
const uploading = ref(false);

// 计算属性
const uploadingFiles = computed(() => 
  fileList.value.filter(f => f.status === 'uploading')
);

const completedCount = computed(() => 
  fileList.value.filter(f => f.status === 'success').length
);

const errorCount = computed(() => 
  fileList.value.filter(f => f.status === 'error').length
);

const overallProgress = computed(() => {
  if (fileList.value.length === 0) return 0;
  
  const totalProgress = fileList.value.reduce((sum, file) => {
    if (file.status === 'success') return sum + 100;
    if (file.status === 'uploading') return sum + (file.progress || 0);
    return sum;
  }, 0);
  
  return totalProgress / fileList.value.length;
});

// 方法
const handleFileChange = (file: UploadFile) => {
  if (!file.raw) return;
  
  // 检查文件大小
  if (file.raw.size > props.maxFileSize) {
    ElMessage.error(`文件 "${file.name}" 超过最大限制 ${formatFileSize(props.maxFileSize)}`);
    return;
  }
  
  // 检查文件类型（如果有限制）
  if (props.allowedTypes.length > 0) {
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    if (!fileExt || !props.allowedTypes.includes(fileExt)) {
      ElMessage.error(`不支持的文件类型 "${fileExt}"`);
      return;
    }
  }
  
  // 检查是否重复
  const isDuplicate = fileList.value.some(f => 
    f.name === file.name && f.size === file.raw!.size
  );
  if (isDuplicate) {
    ElMessage.warning(`文件 "${file.name}" 已存在`);
    return;
  }
  
  // 添加到文件列表
  const extendedFile: ExtendedFile = {
    uid: file.uid,
    name: file.name,
    size: file.raw.size,
    file: file.raw,
    status: 'waiting'
  };
  
  fileList.value.push(extendedFile);
  ElMessage.success(`已添加文件 "${file.name}"`);
};

const beforeUpload = () => {
  // 阻止自动上传，我们手动控制上传
  return false;
};

const removeFile = (index: number) => {
  const file = fileList.value[index];
  if (file.status === 'uploading') {
    ElMessage.warning('无法删除正在上传的文件');
    return;
  }
  
  fileList.value.splice(index, 1);
  ElMessage.info(`已移除文件 "${file.name}"`);
};

const clearAll = async () => {
  const hasUploading = fileList.value.some(f => f.status === 'uploading');
  if (hasUploading) {
    ElMessage.warning('存在正在上传的文件，无法清空');
    return;
  }
  
  if (fileList.value.length === 0) return;
  
  try {
    await ElMessageBox.confirm(
      '确定要清空所有文件吗？',
      '确认清空',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );
    
    fileList.value = [];
    ElMessage.success('已清空文件列表');
  } catch {
    // 用户取消
  }
};

const startUpload = async () => {
  if (!props.connected) {
    ElMessage.error('未连接到服务器');
    return;
  }
  
  const waitingFiles = fileList.value.filter(f => f.status === 'waiting' || f.status === 'error');
  if (waitingFiles.length === 0) {
    ElMessage.warning('没有待上传的文件');
    return;
  }
  
  uploading.value = true;
  const results: Array<{ file: File; success: boolean; error?: string }> = [];
  
  // 通知开始上传
  emit('uploadStart', waitingFiles);
  
  // 顺序上传文件
  for (const fileItem of waitingFiles) {
    try {
      fileItem.status = 'uploading';
      fileItem.progress = 0;
      fileItem.uploadedSize = 0;
      fileItem.errorMessage = '';
      
      await uploadSingleFile(fileItem);
      
      fileItem.status = 'success';
      fileItem.progress = 100;
      fileItem.uploadedSize = fileItem.size;
      
      results.push({ file: fileItem.file, success: true });
      
    } catch (error) {
      fileItem.status = 'error';
      fileItem.errorMessage = error instanceof Error ? error.message : '上传失败';
      
      results.push({ 
        file: fileItem.file, 
        success: false, 
        error: fileItem.errorMessage 
      });
    }
  }
  
  uploading.value = false;
  emit('uploadComplete', results);
  
  // 显示上传结果
  const successCount = results.filter(r => r.success).length;
  const errorCount = results.filter(r => !r.success).length;
  
  if (errorCount === 0) {
    ElMessage.success(`所有文件上传完成 (${successCount} 个)`);
  } else {
    ElMessage.warning(`上传完成: 成功 ${successCount} 个，失败 ${errorCount} 个`);
  }
};

const uploadSingleFile = async (fileItem: ExtendedFile): Promise<void> => {
  // 记录开始时间
  fileItem.startTime = Date.now();
  fileItem.lastUpdateTime = Date.now();
  fileItem.lastUploadedSize = 0;
  
  const onProgress = (progress: FileProgress) => {
    const now = Date.now();
    const timeDiff = (now - (fileItem.lastUpdateTime || now)) / 1000; // 转换为秒
    
    // 计算上传速度
    if (timeDiff > 0.1) { // 至少100ms更新一次速度
      const bytesUploaded = progress.loaded - (fileItem.lastUploadedSize || 0);
      fileItem.speed = Math.round(bytesUploaded / timeDiff);
      fileItem.lastUpdateTime = now;
      fileItem.lastUploadedSize = progress.loaded;
    }
    
    fileItem.progress = progress.percent;
    fileItem.uploadedSize = progress.loaded;
  };
  
  // 如果提供了上传服务，使用真实上传
  if (props.uploadService) {
    try {
      const result = await props.uploadService.uploadFile({
        file: fileItem.file,
        targetPath: props.currentPath,
        filename: fileItem.name,
        onProgress
      });
      
      if (!result.success) {
        throw new Error(result.message || '上传失败');
      }
    } catch (error) {
      throw error;
    }
  } else {
    // 如果没有提供上传服务，发送事件让父组件处理
    return new Promise((resolve, reject) => {
      // 创建上传配置
      const uploadConfig: UploadConfig = {
        file: fileItem.file,
        targetPath: props.currentPath,
        onProgress
      };
      
      // 发送上传事件
      emit('upload', fileItem.file, props.currentPath, onProgress);
      
      // 模拟上传用于开发测试
      if (import.meta.env.DEV) {
        let progressInterval: NodeJS.Timeout;
        let currentProgress = 0;
        
        progressInterval = setInterval(() => {
          currentProgress += Math.random() * 15;
          if (currentProgress >= 100) {
            currentProgress = 100;
            clearInterval(progressInterval);
            
            // 模拟成功
            onProgress({
              total: fileItem.size,
              loaded: fileItem.size,
              percent: 100,
              filename: fileItem.name
            });
            
            resolve();
            return;
          }
          
          onProgress({
            total: fileItem.size,
            loaded: Math.round(fileItem.size * currentProgress / 100),
            percent: Math.round(currentProgress),
            filename: fileItem.name
          });
        }, 200);
      } else {
        // 生产环境需要父组件处理实际上传
        resolve();
      }
    });
  }
};

// 格式化速度
const formatSpeed = (bytesPerSecond: number): string => {
  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond} B/s`;
  } else if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  } else {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
};

// 监听连接状态变化
watch(() => props.connected, (connected) => {
  if (!connected && uploading.value) {
    // 连接断开时停止上传
    uploading.value = false;
    fileList.value.forEach(file => {
      if (file.status === 'uploading') {
        file.status = 'error';
        file.errorMessage = '连接已断开';
      }
    });
  }
});

// 暴露方法给父组件
defineExpose({
  addFiles: (files: File[]) => {
    files.forEach(file => {
      const uploadFile: UploadFile = {
        uid: Date.now() + Math.random(),
        name: file.name,
        size: file.size,
        status: 'ready',
        raw: file
      };
      handleFileChange(uploadFile);
    });
  },
  clearFiles: () => {
    fileList.value = [];
  },
  startUpload
});
</script>

<style scoped>
.file-uploader {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.uploader-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.upload-area {
  margin-bottom: 20px;
}

.upload-dragger {
  width: 100%;
}

:deep(.el-upload-dragger) {
  width: 100%;
  height: 160px;
  border: 2px dashed var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
}

:deep(.el-upload-dragger:hover) {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

:deep(.el-upload-dragger.is-dragover) {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.upload-content {
  text-align: center;
}

.upload-icon {
  font-size: 48px;
  color: var(--el-color-primary);
  margin-bottom: 16px;
}

.upload-text {
  color: var(--el-text-color-regular);
}

.primary-text {
  font-size: 16px;
  margin-bottom: 8px;
  font-weight: 500;
}

.primary-text em {
  color: var(--el-color-primary);
  cursor: pointer;
  font-style: normal;
}

.secondary-text {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.file-list {
  flex: 1;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color);
  font-weight: 500;
}

.list-actions {
  display: flex;
  gap: 8px;
}

.file-items {
  flex: 1;
  overflow-y: auto;
  max-height: 400px;
}

.file-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  transition: all 0.3s;
}

.file-item:last-child {
  border-bottom: none;
}

.file-item.uploading {
  background: var(--el-color-primary-light-9);
}

.file-item.success {
  background: var(--el-color-success-light-9);
}

.file-item.error {
  background: var(--el-color-danger-light-9);
}

.file-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.file-main-info {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.file-status-icon {
  font-size: 20px;
  margin-right: 12px;
  flex-shrink: 0;
}

.file-status-icon.success {
  color: var(--el-color-success);
}

.file-status-icon.error {
  color: var(--el-color-danger);
}

.file-status-icon.uploading {
  color: var(--el-color-primary);
}

.file-details {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-weight: 500;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-size {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.progress-section {
  margin-top: 12px;
}

.progress-text {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.uploading-text {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.progress-detail {
  color: var(--el-text-color-regular);
}

.upload-speed {
  color: var(--el-color-primary);
  font-weight: 500;
  margin-left: auto;
}

.progress-percentage {
  font-size: 14px;
  font-weight: bold;
  color: var(--el-color-primary);
}

.success-text {
  color: var(--el-color-success);
  font-weight: 500;
}

.error-section {
  margin-top: 8px;
}

.upload-stats {
  margin-top: 20px;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

@media (max-width: 768px) {
  .list-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  
  .list-actions {
    justify-content: center;
  }
  
  .file-info {
    flex-direction: column;
    align-items: stretch;
  }
  
  .file-actions {
    margin-top: 8px;
    text-align: center;
  }
  
  :deep(.el-statistic) {
    text-align: center;
  }
}
</style>