<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="80%"
    top="5vh"
    :show-close="true"
    :close-on-click-modal="false"
    :close-on-press-escape="true"
    @close="handleClose"
    class="file-preview-dialog"
  >
    <div class="preview-header">
      <div class="file-info">
        <el-icon class="file-icon"><Document /></el-icon>
        <span class="filename">{{ fileItem?.name }}</span>
        <el-tag v-if="fileExtension" size="small" type="info">{{ fileExtension.toUpperCase() }}</el-tag>
        <span class="file-size">{{ formatFileSize(fileItem?.size || 0) }}</span>
      </div>
      <div class="preview-actions">
        <el-button 
          :icon="Refresh" 
          @click="refreshContent"
          :loading="loading"
        >
          刷新
        </el-button>
      </div>
    </div>

    <div class="preview-content" v-loading="loading" element-loading-text="正在加载文件内容...">
      <div v-if="error" class="error-message">
        <el-result
          icon="error"
          title="加载失败"
          :sub-title="error"
        >
          <template #extra>
            <el-button @click="refreshContent" type="primary">重试</el-button>
          </template>
        </el-result>
      </div>
      
      <div v-else-if="content" class="content-container">
        <div class="content-stats">
          <span>行数: {{ lineCount }}</span>
          <span>字符数: {{ charCount }}</span>
          <span>大小: {{ formatFileSize(content.length) }}</span>
        </div>
        <pre class="file-content" :class="getLanguageClass()"><code>{{ content }}</code></pre>
      </div>
      
      <div v-else class="empty-content">
        <el-empty description="文件内容为空" />
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">关闭</el-button>
        <el-button type="primary" @click="handleDownload" :icon="Download">
          下载文件
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { Document, Download, Refresh } from '@element-plus/icons-vue';
import { FileItem } from '../types';
import { formatFileSize, getFileExtension } from '../utils/fileUtils';

interface Props {
  modelValue: boolean;
  fileItem: FileItem | null;
  content: string;
  loading?: boolean;
  error?: string;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  error: ''
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  download: [file: FileItem];
  refresh: [file: FileItem];
}>();

// 响应式数据
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

// 计算属性
const title = computed(() => {
  if (!props.fileItem) return '文件预览';
  return `文件预览 - ${props.fileItem.name}`;
});

const fileExtension = computed(() => {
  if (!props.fileItem) return '';
  return getFileExtension(props.fileItem.name);
});

const lineCount = computed(() => {
  if (!props.content) return 0;
  return props.content.split('\n').length;
});

const charCount = computed(() => {
  return props.content?.length || 0;
});

// 方法
const getLanguageClass = () => {
  const ext = fileExtension.value;
  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'ts': 'typescript',
    'py': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'css': 'css',
    'html': 'html',
    'xml': 'xml',
    'json': 'json',
    'md': 'markdown',
    'vue': 'vue',
    'php': 'php',
    'go': 'go',
    'rs': 'rust',
    'sql': 'sql',
    'sh': 'bash',
    'yml': 'yaml',
    'yaml': 'yaml'
  };
  
  return languageMap[ext] ? `language-${languageMap[ext]}` : 'language-text';
};

const handleClose = () => {
  visible.value = false;
};

const handleDownload = () => {
  if (props.fileItem) {
    emit('download', props.fileItem);
  }
};

const refreshContent = () => {
  if (props.fileItem) {
    emit('refresh', props.fileItem);
  }
};

// 监听对话框显示状态，自动滚动到顶部
watch(visible, (newVisible) => {
  if (newVisible) {
    nextTick(() => {
      const contentElement = document.querySelector('.file-content');
      if (contentElement) {
        contentElement.scrollTop = 0;
      }
    });
  }
});
</script>

<style scoped>
.file-preview-dialog {
  --el-dialog-padding-primary: 0;
}

:deep(.el-dialog__body) {
  padding: 0;
  max-height: 70vh;
  overflow: hidden;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color-page);
}

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.file-icon {
  color: var(--el-color-primary);
  font-size: 18px;
}

.filename {
  font-weight: 500;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}

.file-size {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.preview-actions {
  display: flex;
  gap: 8px;
}

.preview-content {
  height: calc(70vh - 120px);
  overflow: auto;
}

.error-message {
  padding: 40px;
  text-align: center;
}

.content-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.content-stats {
  display: flex;
  gap: 16px;
  padding: 8px 16px;
  background: var(--el-fill-color-extra-light);
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.file-content {
  flex: 1;
  margin: 0;
  padding: 16px;
  background: var(--el-bg-color);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow: auto;
  border: none;
}

.file-content code {
  background: none;
  padding: 0;
  font-family: inherit;
  color: var(--el-text-color-primary);
}

.empty-content {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* 语法高亮的基本样式 */
.language-javascript .keyword,
.language-typescript .keyword,
.language-python .keyword,
.language-java .keyword,
.language-c .keyword,
.language-cpp .keyword {
  color: var(--el-color-primary);
  font-weight: bold;
}

.language-json .property {
  color: var(--el-color-success);
}

.language-html .tag,
.language-xml .tag {
  color: var(--el-color-warning);
}

.language-css .selector {
  color: var(--el-color-danger);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .file-preview-dialog {
    --el-dialog-width: 95vw;
  }
  
  .preview-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 16px;
  }
  
  .file-info {
    width: 100%;
  }
  
  .filename {
    max-width: 200px;
  }
  
  .preview-actions {
    width: 100%;
    justify-content: flex-end;
  }
  
  .content-stats {
    flex-direction: column;
    gap: 4px;
  }
  
  .file-content {
    font-size: 12px;
    padding: 12px;
  }
}

/* 滚动条样式 */
.preview-content::-webkit-scrollbar,
.file-content::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.preview-content::-webkit-scrollbar-track,
.file-content::-webkit-scrollbar-track {
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.preview-content::-webkit-scrollbar-thumb,
.file-content::-webkit-scrollbar-thumb {
  background: var(--el-fill-color-dark);
  border-radius: 4px;
}

.preview-content::-webkit-scrollbar-thumb:hover,
.file-content::-webkit-scrollbar-thumb:hover {
  background: var(--el-fill-color-darker);
}

/* 暗色主题适配 */
@media (prefers-color-scheme: dark) {
  .file-content {
    background: var(--el-bg-color);
    color: var(--el-text-color-primary);
  }
}
</style>
