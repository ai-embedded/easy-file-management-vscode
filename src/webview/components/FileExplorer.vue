<template>
  <el-card class="file-explorer">
    <template #header>
      <div class="explorer-header">
        <div class="breadcrumb-container">
          <el-breadcrumb separator="/" class="path-breadcrumb">
            <el-breadcrumb-item @click="navigateToPath('/')" class="breadcrumb-item">
              <el-icon><House /></el-icon>
            </el-breadcrumb-item>
            <el-breadcrumb-item 
              v-for="(segment, index) in pathSegments" 
              :key="index"
              @click="navigateToPath(getPathUpTo(index))"
              class="breadcrumb-item"
            >
              {{ segment }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        
      </div>
    </template>

    <div class="file-list-container" v-loading="loading">
      <el-table
        ref="tableRef"
        :data="displayFiles"
        stripe
        highlight-current-row
        row-key="path"
        @row-dblclick="handleDoubleClick"
        @row-contextmenu="handleRightClick"
        @row-click="handleRowClick"
        empty-text="暂无文件"
        class="file-table"
      >
        <el-table-column width="48" align="center">
          <template #header>
            <el-checkbox
              :model-value="isAllSelected"
              :indeterminate="isIndeterminate"
              @change="toggleSelectAll"
            />
          </template>
          <template #default="{ row }">
            <el-checkbox
              :model-value="isRowSelected(row)"
              @change="(value: boolean) => toggleRowSelection(row, value)"
              @click.stop
            />
          </template>
        </el-table-column>

        <el-table-column width="60" align="center">
          <template #default="{ row }">
            <el-icon class="file-icon" :class="getFileIconClass(row)">
              <Folder v-if="row.type === 'directory'" />
              <Document v-else />
            </el-icon>
          </template>
        </el-table-column>

        <el-table-column label="名称" prop="name" min-width="200">
          <template #default="{ row }">
            <span class="file-name" :class="{ 'readonly': row.isReadonly }">
              {{ row.name }}
            </span>
            <el-tag v-if="row.isReadonly" size="small" type="info" class="readonly-tag">
              只读
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="大小" width="100" align="right">
          <template #default="{ row }">
            <span v-if="row.type === 'file'">{{ formatFileSize(row.size) }}</span>
            <span v-else class="directory-indicator">--</span>
          </template>
        </el-table-column>

        <el-table-column label="修改时间" width="180">
          <template #default="{ row }">
            {{ row.lastModified ? formatDate(row.lastModified) : '未知时间' }}
          </template>
        </el-table-column>

        <el-table-column label="权限" width="100" v-if="showPermissions">
          <template #default="{ row }">
            <span class="permissions">{{ row.permissions || '-' }}</span>
          </template>
        </el-table-column>


      </el-table>
    </div>

    <!-- 右键菜单 -->
    <el-dropdown
      ref="contextMenuRef"
      :show-timeout="0"
      :hide-timeout="0"
      trigger="contextmenu"
      @visible-change="onContextMenuVisibleChange"
    >
      <span></span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item 
            @click="handlePreview(contextMenuItem!)"
            :disabled="!contextMenuItem || contextMenuItem.type === 'directory' || !isTextFile(contextMenuItem?.name || '')"
          >
            <el-icon><Document /></el-icon>
            预览
          </el-dropdown-item>
          <el-dropdown-item 
            @click="handleDownload(contextMenuItem!)"
            :disabled="!contextMenuItem || contextMenuItem.type === 'directory'"
          >
            <el-icon><Download /></el-icon>
            下载
          </el-dropdown-item>
          <el-dropdown-item 
            @click="handleRename(contextMenuItem!)"
            :disabled="!contextMenuItem || contextMenuItem.isReadonly"
          >
            <el-icon><Edit /></el-icon>
            重命名
          </el-dropdown-item>
		  <el-dropdown-item 
			@click="handleMove(contextMenuItem!)"
			:disabled="!contextMenuItem || contextMenuItem.isReadonly"
		  >
            <el-icon><Rank /></el-icon>
            移动
          </el-dropdown-item>
          <el-dropdown-item 
            @click="handleDelete(contextMenuItem!)"
            :disabled="!contextMenuItem || contextMenuItem.isReadonly"
            divided
          >
            <el-icon><Delete /></el-icon>
            删除
          </el-dropdown-item>
          <el-dropdown-item @click="showCreateFolderDialog" divided>
            <el-icon><FolderAdd /></el-icon>
            新建文件夹
          </el-dropdown-item>
          <el-dropdown-item @click="refreshFiles">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <!-- 重命名对话框 -->
    <el-dialog
      v-model="renameDialogVisible"
      title="重命名"
      width="400px"
      @close="resetRenameDialog"
    >
      <el-form @submit.prevent="confirmRename">
        <el-form-item label="新名称">
          <el-input 
            v-model="newFileName" 
            placeholder="请输入新的文件名"
            @keyup.enter="confirmRename"
            ref="renameInputRef"
          />
        </el-form-item>
      </el-form>
      
      <template #footer>
        <el-button @click="renameDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmRename" :loading="renaming">
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- 移动对话框 -->
	<el-dialog
	  v-model="moveDialogVisible"
	  :title="moveDialogTitle"
	  width="400px"
	  @close="resetMoveDialog"
	>
	  <el-form @submit.prevent="confirmMove">
		<el-form-item label="目标目录">
		  <el-select
			v-model="moveTargetDirectory"
			placeholder="可选择或输入目标路径，支持 ../"
			ref="moveSelectRef"
			filterable
			allow-create
			default-first-option
			style="width: 100%"
		  >
			<el-option
			  v-for="option in moveTargetOptions"
			  :key="option.path"
			  :label="option.label"
			  :value="option.path"
			/>
		  </el-select>
		  <p class="move-tip">支持输入绝对路径或相对路径（例如 ../documents）。</p>
		</el-form-item>
	  </el-form>

	  <template #footer>
		<el-button @click="moveDialogVisible = false">取消</el-button>
		<el-button type="primary" @click="confirmMove" :loading="moving">
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- 新建文件夹对话框 -->
    <el-dialog
      v-model="createFolderDialogVisible"
      title="新建文件夹"
      width="400px"
      @close="resetCreateFolderDialog"
    >
      <el-form @submit.prevent="confirmCreateFolder">
        <el-form-item label="文件夹名称">
          <el-input 
            v-model="newFolderName" 
            placeholder="请输入文件夹名称"
            @keyup.enter="confirmCreateFolder"
            ref="createFolderInputRef"
          />
        </el-form-item>
      </el-form>
      
      <template #footer>
        <el-button @click="createFolderDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmCreateFolder" :loading="creating">
          创建
        </el-button>
      </template>
    </el-dialog>
    
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { 
  ElMessage, 
  ElMessageBox, 
  type ElTable,
  type ElInput,
  type ElSelect
} from 'element-plus';
import {
  House,
  ArrowLeft,
  Refresh,
  FolderAdd,
  Folder,
  Document,
  Download,
  Edit,
  Delete,
  Upload,
  Rank
} from '@element-plus/icons-vue';
import { FileItem, FileProgress } from '../types';
import { formatFileSize, formatDate, isValidFilename, joinPath, isTextFile } from '../utils/fileUtils';

// 定义属性
interface Props {
  files: FileItem[];
  currentPath: string;
  connected: boolean;
  loading?: boolean;
  showPermissions?: boolean;
}

interface ToolbarState {
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

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  showPermissions: false
});

// 定义事件
const emit = defineEmits<{
	pathChange: [path: string];
	download: [file: FileItem];
	preview: [file: FileItem];
	rename: [oldPath: string, newPath: string];
	move: [oldPath: string, newPath: string];
	moveBatch: [operations: MoveOperation[]];
	delete: [file: FileItem];
	createFolder: [path: string, name: string];
	refresh: [];
	upload: [files: File[], targetPath: string];
  // 在打开文件选择对话框前通知父组件，便于抑制 HTTP 刷新
  preUploadDialogOpen: [{ targetPath: string; timestamp: string }];
  // 在文件选择对话框关闭后通知父组件，恢复刷新策略
  postUploadDialogClose: [{ targetPath: string; timestamp: string; empty: boolean }];
  toolbarStateChange: [state: ToolbarState];
}>();

// 响应式数据
const tableRef = ref<InstanceType<typeof ElTable>>();
const contextMenuRef = ref();
const renameInputRef = ref<InstanceType<typeof ElInput>>();
const createFolderInputRef = ref<InstanceType<typeof ElInput>>();
const fileInputRef = ref<HTMLInputElement | null>(null);
let fileInputChangeHandler: ((this: HTMLInputElement, ev: Event) => void) | null = null;

const initializeFileInput = (): HTMLInputElement => {
  if (fileInputRef.value) {return fileInputRef.value;}

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.style.display = 'none';

  fileInputChangeHandler = () => {
    handleFileSelectFromInput(input);
  };
  input.addEventListener('change', fileInputChangeHandler);
  document.body.appendChild(input);
  fileInputRef.value = input;
  return input;
};

onMounted(() => {
  initializeFileInput();
});

onBeforeUnmount(() => {
  const input = fileInputRef.value;
  if (input) {
    if (fileInputChangeHandler) {
      input.removeEventListener('change', fileInputChangeHandler);
    }
    input.parentNode?.removeChild(input);
  }
  fileInputRef.value = null;
  fileInputChangeHandler = null;
});
const selectedPaths = ref<Set<string>>(new Set<string>());
const currentRowPath = ref<string | null>(null);

const pathHistory = ref<string[]>(['/']);
const currentPathIndex = ref(0);
const contextMenuItem = ref<FileItem | null>(null);

// 对话框相关
const renameDialogVisible = ref(false);
const createFolderDialogVisible = ref(false);
const newFileName = ref('');
const newFolderName = ref('');
const renaming = ref(false);
const creating = ref(false);
const renamingItem = ref<FileItem | null>(null);
const moveDialogVisible = ref(false);
const moveTargetDirectory = ref('');
const moving = ref(false);
const moveItems = ref<FileItem[]>([]);
const moveSelectRef = ref<InstanceType<typeof ElSelect>>();

// 计算属性
const displayFiles = computed(() => {
	return [...props.files].sort((a, b) => {
		// 目录优先
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    // 按名称排序
    return a.name.localeCompare(b.name, 'zh-CN');
  });
});

const pathSegments = computed(() => {
  if (props.currentPath === '/') return [];
  return props.currentPath.split('/').filter(segment => segment.length > 0);
});

const canGoBack = computed(() => {
  return currentPathIndex.value > 0;
});

const selectedItems = computed(() => {
  const currentSelection = selectedPaths.value;
  return displayFiles.value.filter(item => currentSelection.has(item.path));
});

const isAllSelected = computed(() => {
  return selectedItems.value.length > 0 && selectedItems.value.length === displayFiles.value.length && displayFiles.value.length > 0;
});

const isIndeterminate = computed(() => {
  return selectedItems.value.length > 0 && selectedItems.value.length < displayFiles.value.length;
});

const canBatchPreview = computed(() => {
  if (selectedItems.value.length !== 1) return false;
  const item = selectedItems.value[0];
  return item.type === 'file' && isTextFile(item.name);
});

const canBatchDownload = computed(() => {
  if (selectedItems.value.length === 0) return false;
  return selectedItems.value.every(item => item.type === 'file');
});

const canBatchRename = computed(() => {
	if (selectedItems.value.length !== 1) return false;
	const item = selectedItems.value[0];
	return !item.isReadonly;
});

const directoriesInCurrentPath = computed(() => {
	return displayFiles.value.filter(item => item.type === 'directory');
});

const getParentDirectory = (path: string): string | null => {
	if (!path || path === '/') {
		return null;
	}
	const segments = path.split('/').filter(segment => segment.length > 0);
	segments.pop();
	if (segments.length === 0) {
		return '/';
	}
	return `/${segments.join('/')}`;
};

const parentDirectoryPath = computed(() => getParentDirectory(props.currentPath));

interface MoveTargetOption {
	path: string;
	label: string;
}

interface MoveOperation {
	oldPath: string;
	newPath: string;
}

const buildRelativeLabel = (path: string): string => {
	if (path === '/') {
		return '/';
	}
	const parentPath = parentDirectoryPath.value;
	if (parentPath && path === parentPath) {
		return parentPath === '/' ? '../' : `../${parentPath.slice(1)}`;
	}
	if (props.currentPath === '/') {
		return path.slice(1) || '/';
	}
	const prefix = props.currentPath.endsWith('/') ? props.currentPath : `${props.currentPath}/`;
	if (path.startsWith(prefix)) {
		const relative = path.slice(prefix.length);
		return relative || path;
	}
	return path;
};

const moveTargetOptions = computed<MoveTargetOption[]>(() => {
	const optionEntries = new Map<string, string>();
	const addOption = (path: string | null, label?: string) => {
		if (!path) {
			return;
		}
		const normalized = joinPath(path);
		if (normalized === props.currentPath) {
			return;
		}
		if (optionEntries.has(normalized)) {
			return;
		}
		optionEntries.set(normalized, label ?? buildRelativeLabel(normalized));
	};

	addOption('/', '/');
	addOption(parentDirectoryPath.value);
	directoriesInCurrentPath.value.forEach(dir => {
		addOption(dir.path, buildRelativeLabel(dir.path));
	});

	return Array.from(optionEntries.entries()).map(([path, label]) => ({ path, label }));
});

const canBatchMove = computed(() => {
	if (selectedItems.value.length === 0) return false;
	return selectedItems.value.every(item => !item.isReadonly);
});

const moveDialogTitle = computed(() => {
	return moveItems.value.length > 1 ? `移动到（${moveItems.value.length} 项）` : '移动到';
});

const canBatchDelete = computed(() => {
	if (selectedItems.value.length === 0) return false;
	return selectedItems.value.every(item => !item.isReadonly);
});

const toolbarState = computed<ToolbarState>(() => ({
  canGoBack: canGoBack.value,
  loading: props.loading,
  canCreateFolder: props.connected,
  canUpload: props.connected,
  canBatchPreview: canBatchPreview.value,
  canBatchDownload: canBatchDownload.value,
  canBatchRename: canBatchRename.value,
  canBatchMove: canBatchMove.value,
  canBatchDelete: canBatchDelete.value
}));

export type { ToolbarState as FileExplorerToolbarState };

watch(toolbarState, (state) => {
	emit('toolbarStateChange', { ...state });
}, { immediate: true });

const findFileByPath = (path: string) => {
  return displayFiles.value.find(item => item.path === path) || null;
};

const setCurrentRow = (file: FileItem | null) => {
  currentRowPath.value = file?.path ?? null;
  nextTick(() => {
    tableRef.value?.setCurrentRow(file ?? undefined);
  });
};

// 方法
const navigateToPath = (path: string) => {
  if (path === props.currentPath) return;
  
  // 添加到历史记录
  if (currentPathIndex.value < pathHistory.value.length - 1) {
    pathHistory.value = pathHistory.value.slice(0, currentPathIndex.value + 1);
  }
  pathHistory.value.push(path);
  currentPathIndex.value = pathHistory.value.length - 1;
  
  emit('pathChange', path);
};

const getPathUpTo = (index: number): string => {
  if (index < 0) return '/';
  const segments = pathSegments.value.slice(0, index + 1);
  return '/' + segments.join('/');
};

const goBack = () => {
  if (!canGoBack.value) return;
  
  currentPathIndex.value--;
  const previousPath = pathHistory.value[currentPathIndex.value];
  emit('pathChange', previousPath);
};

const refreshFiles = () => {
  emit('refresh');
};

const handleDoubleClick = (row: FileItem) => {
  if (row.type === 'directory') {
    const newPath = joinPath(props.currentPath, row.name);
    console.log(`[FileExplorer] 双击目录: 当前路径="${props.currentPath}", 目录名="${row.name}", 新路径="${newPath}"`);
    navigateToPath(newPath);
  } else {
    // 文本文件双击预览，非文本文件双击下载
    if (isTextFile(row.name)) {
      handlePreview(row);
    } else {
      handleDownload(row);
    }
  }
};

const handleRightClick = (row: FileItem, column: any, event: Event) => {
  event.preventDefault();
  contextMenuItem.value = row;
  
  // 显示右键菜单
  nextTick(() => {
    if (contextMenuRef.value) {
      contextMenuRef.value.handleOpen();
    }
  });
};

const onContextMenuVisibleChange = (visible: boolean) => {
  if (!visible) {
    contextMenuItem.value = null;
  }
};

const clearSelection = () => {
  if (selectedPaths.value.size > 0 || currentRowPath.value) {
    selectedPaths.value = new Set<string>();
    setCurrentRow(null);
  }
};

const isRowSelected = (file: FileItem) => {
  return selectedPaths.value.has(file.path);
};

const toggleRowSelection = (file: FileItem, checked: boolean) => {
  const next = new Set<string>(selectedPaths.value);
  if (checked) {
    next.add(file.path);
  } else {
    next.delete(file.path);
  }
  selectedPaths.value = next;

  if (checked) {
    setCurrentRow(file);
  } else if (currentRowPath.value === file.path) {
    const remainingPaths = Array.from(next);
    const fallbackPath = remainingPaths[remainingPaths.length - 1] ?? null;
    const fallback = fallbackPath ? findFileByPath(fallbackPath) : null;
    setCurrentRow(fallback);
  }
};

const toggleSelectAll = (checked: boolean) => {
  if (checked) {
    const allPaths = displayFiles.value.map(file => file.path);
    selectedPaths.value = new Set<string>(allPaths);
    const first = allPaths.length > 0 ? findFileByPath(allPaths[0]) : null;
    setCurrentRow(first);
  } else {
    selectedPaths.value = new Set<string>();
    setCurrentRow(null);
  }
};

const handleRowClick = (row: FileItem, _column: any, event: MouseEvent) => {
  const checkboxElement = (event.target as HTMLElement | null)?.closest('.el-checkbox');
  if (checkboxElement) {
    return;
  }

  const isMultiToggle = event.metaKey || event.ctrlKey;

  if (isMultiToggle) {
    const next = new Set<string>(selectedPaths.value);
    if (next.has(row.path)) {
      next.delete(row.path);
    } else {
      next.add(row.path);
    }
    selectedPaths.value = next;

    if (next.has(row.path)) {
      setCurrentRow(row);
    } else {
      const remainingPaths = Array.from(next);
      const fallbackPath = remainingPaths[remainingPaths.length - 1] ?? null;
      const fallback = fallbackPath ? findFileByPath(fallbackPath) : null;
      setCurrentRow(fallback);
    }
  } else {
    selectedPaths.value = new Set<string>([row.path]);
    setCurrentRow(row);
  }
};

const handleDownload = async (file: FileItem) => {
  if (file.type === 'directory') {
    ElMessage.warning('无法下载文件夹');
    return;
  }
  
  try {
    emit('download', file);
  } catch (error) {
    ElMessage.error('下载失败');
  }
};

const handlePreview = (file: FileItem) => {
  if (file.type === 'directory') {
    ElMessage.warning('无法预览文件夹');
    return;
  }
  
  emit('preview', file);
};

const handleBatchPreview = () => {
  if (!canBatchPreview.value) return;
  const target = selectedItems.value[0];
  if (target) {
    handlePreview(target);
  }
};

const handleBatchDownload = () => {
  if (!canBatchDownload.value) return;
  selectedItems.value.forEach(file => {
    emit('download', file);
  });
};

const handleRename = (file: FileItem) => {
  renamingItem.value = file;
  newFileName.value = file.name;
  renameDialogVisible.value = true;
  
  nextTick(() => {
    renameInputRef.value?.focus();
    renameInputRef.value?.select();
  });
};

const handleBatchRename = () => {
  if (!canBatchRename.value) return;
  const target = selectedItems.value[0];
  if (target) {
    handleRename(target);
  }
};

const isTargetValidForDirectory = (directoryPath: string, targetDirectory: string): boolean => {
	const normalizedDirectory = joinPath(directoryPath);
	const normalizedTarget = joinPath(targetDirectory);
	if (normalizedTarget === normalizedDirectory) {
		return false;
	}
	return !normalizedTarget.startsWith(`${normalizedDirectory}/`);
};

const resolveMoveTargetDirectory = (input: string): string | null => {
	const value = (input || '').trim();
	if (!value) {
		return null;
	}
	if (value.startsWith('/')) {
		return joinPath(value);
	}
	const base = props.currentPath || '/';
	return joinPath(base, value);
};

const findDefaultMoveTarget = (items: FileItem[]): string => {
	for (const option of moveTargetOptions.value) {
		const candidate = option.path;
		if (items.every(item => item.type !== 'directory' || isTargetValidForDirectory(item.path, candidate))) {
			return candidate;
		}
	}
	return '';
};

const openMoveDialog = (items: FileItem[]) => {
	const movableItems = items.filter(item => !item.isReadonly);
	if (movableItems.length === 0) {
		ElMessage.warning('所选项目不可移动');
		return;
	}
	moveItems.value = movableItems.map(item => ({ ...item }));
	const defaultTarget = findDefaultMoveTarget(movableItems);
	moveTargetDirectory.value = defaultTarget;
	moveDialogVisible.value = true;

	nextTick(() => {
		moveSelectRef.value?.focus?.();
	});
};

const handleMove = (file: FileItem) => {
	openMoveDialog([file]);
};

const handleBatchMove = () => {
	if (!canBatchMove.value) return;
	openMoveDialog(selectedItems.value);
};

const confirmRename = async () => {
  if (!renamingItem.value) return;
  
  const newName = newFileName.value.trim();
  if (!newName) {
    ElMessage.warning('文件名不能为空');
    return;
  }
  
  if (newName === renamingItem.value.name) {
    renameDialogVisible.value = false;
    return;
  }
  
  if (!isValidFilename(newName)) {
    ElMessage.warning('文件名包含非法字符');
    return;
  }
  
  // 检查是否重名
  const exists = props.files.some(f => f.name === newName && f !== renamingItem.value);
  if (exists) {
    ElMessage.warning('文件名已存在');
    return;
  }
  
  renaming.value = true;
  try {
    const oldPath = joinPath(props.currentPath, renamingItem.value.name);
    const newPath = joinPath(props.currentPath, newName);
    
    emit('rename', oldPath, newPath);
    renameDialogVisible.value = false;
  } catch (error) {
    ElMessage.error('重命名失败');
  } finally {
    renaming.value = false;
  }
};

const resetRenameDialog = () => {
  newFileName.value = '';
  renamingItem.value = null;
  renaming.value = false;
};

const confirmMove = async () => {
	if (moveItems.value.length === 0) {
		return;
	}

	const resolvedTarget = resolveMoveTargetDirectory(moveTargetDirectory.value);
	if (!resolvedTarget) {
		ElMessage.warning('请选择或输入目标目录');
		return;
	}

	const invalidDirectories = moveItems.value.filter(item => item.type === 'directory' && !isTargetValidForDirectory(item.path, resolvedTarget));
	if (invalidDirectories.length > 0) {
		ElMessage.warning(`无法将 ${invalidDirectories.map(item => `"${item.name}"`).join('、')} 移动到其自身或子目录中`);
		return;
	}

	const operations = moveItems.value
		.map(item => {
			const oldPath = item.path;
			const newPath = joinPath(resolvedTarget, item.name);
			return { oldPath, newPath };
		})
		.filter(operation => operation.oldPath !== operation.newPath);

	if (operations.length === 0) {
		ElMessage.info('目标目录与当前目录相同，无需移动');
		return;
	}

	moving.value = true;
	try {
		if (operations.length === 1) {
			emit('move', operations[0].oldPath, operations[0].newPath);
		} else {
			emit('moveBatch', operations);
		}
		moveDialogVisible.value = false;
	} catch (error) {
		ElMessage.error('移动失败');
	} finally {
		moving.value = false;
	}
};

const resetMoveDialog = () => {
	moveTargetDirectory.value = '';
	moveItems.value = [];
	moving.value = false;
};

const handleDelete = async (file: FileItem) => {
  try {
    const confirmMessage = file.type === 'directory' 
      ? `确定要删除文件夹 "${file.name}" 及其所有内容吗？此操作不可恢复。`
      : `确定要删除文件 "${file.name}" 吗？此操作不可恢复。`;
      
    await ElMessageBox.confirm(
      confirmMessage,
      '确认删除',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        buttonSize: 'small'
      }
    );
    
    emit('delete', file);
  } catch {
    // 用户取消删除
  }
};

const handleBatchDelete = async () => {
  if (!canBatchDelete.value) return;
  const deletableItems = selectedItems.value;
  if (deletableItems.length === 0) return;

  const message = deletableItems.length === 1
    ? (deletableItems[0].type === 'directory'
      ? `确定要删除文件夹 "${deletableItems[0].name}" 及其所有内容吗？此操作不可恢复。`
      : `确定要删除文件 "${deletableItems[0].name}" 吗？此操作不可恢复。`)
    : `确定要删除以下 ${deletableItems.length} 项吗？此操作不可恢复。<br/>${deletableItems.map(item => `- ${item.name}`).join('<br/>')}`;

  try {
    await ElMessageBox.confirm(
      message,
      '确认删除',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        buttonSize: 'small',
        dangerouslyUseHTMLString: deletableItems.length > 1
      }
    );

    deletableItems.forEach(item => emit('delete', item));
    clearSelection();
  } catch {
    // 用户取消批量删除
  }
};

const showCreateFolderDialog = () => {
  newFolderName.value = '';
  createFolderDialogVisible.value = true;
  
  nextTick(() => {
    createFolderInputRef.value?.focus();
  });
};

const confirmCreateFolder = async () => {
  const folderName = newFolderName.value.trim();
  if (!folderName) {
    ElMessage.warning('文件夹名称不能为空');
    return;
  }
  
  if (!isValidFilename(folderName)) {
    ElMessage.warning('文件夹名称包含非法字符');
    return;
  }
  
  // 检查是否重名
  const exists = props.files.some(f => f.name === folderName);
  if (exists) {
    ElMessage.warning('文件夹名称已存在');
    return;
  }
  
  creating.value = true;
  try {
    emit('createFolder', props.currentPath, folderName);
    createFolderDialogVisible.value = false;
  } catch (error) {
    ElMessage.error('创建文件夹失败');
  } finally {
    creating.value = false;
  }
};

const resetCreateFolderDialog = () => {
  newFolderName.value = '';
  creating.value = false;
};

const handleUploadToCurrentFolder = () => {
  const timestamp = new Date().toISOString();
  const input = initializeFileInput();
  const hasInput = Boolean(input);
  console.log('[FileExplorer] handleUploadToCurrentFolder triggered', {
    currentPath: props.currentPath,
    hasInput,
    timestamp
  });

  // 通知父组件：即将打开文件选择对话框（用于抑制 HTTP 刷新导致的卡顿）
  try {
    emit('preUploadDialogOpen', { targetPath: props.currentPath, timestamp });
  } catch {
    // 忽略通知失败
  }

  const performClick = () => {
    const inputEl = initializeFileInput();
    if (!inputEl) {
      console.warn('[FileExplorer] fileInputRef missing, retrying on nextTick', {
        currentPath: props.currentPath,
        timestamp: new Date().toISOString()
      });
      nextTick(() => {
        const nextEl = fileInputRef.value;
        if (nextEl) {
          console.log('[FileExplorer] Delayed file dialog trigger', {
            currentPath: props.currentPath,
            timestamp: new Date().toISOString()
          });
          nextEl.click();
        }
      });
      return;
    }

    // 通过 requestAnimationFrame 确保点击在浏览器绘制后执行，避免被 loading 遮罩阻塞
    requestAnimationFrame(() => {
      console.log('[FileExplorer] Trigger file dialog click', {
        currentPath: props.currentPath,
        timestamp: new Date().toISOString()
      });
      // 标记：文件选择器打开（通知父组件）
      try {
        emit('preUploadDialogOpen', { targetPath: props.currentPath, timestamp: new Date().toISOString() });
      } catch {}
      inputEl.click();
    });
  };

  performClick();
};

const handleFileSelectFromInput = (input: HTMLInputElement) => {
  const files = input.files;
  
  if (!files || files.length === 0) {
    console.warn('[FileExplorer] File chooser closed without selection', {
      currentPath: props.currentPath,
      timestamp: new Date().toISOString()
    });
    try {
      emit('postUploadDialogClose', { targetPath: props.currentPath, timestamp: new Date().toISOString(), empty: true });
    } catch {}
    return;
  }
  
  const fileArray = Array.from(files);
  const selectedAt = new Date().toISOString();
  console.log('[FileExplorer] File chooser returned', {
    count: fileArray.length,
    names: fileArray.map(f => f.name),
    totalSize: fileArray.reduce((sum, f) => sum + f.size, 0),
    targetPath: props.currentPath,
    timestamp: selectedAt
  });
  console.log('[FileExplorer] Files selected for upload', {
    count: fileArray.length,
    names: fileArray.map(f => f.name),
    totalSize: fileArray.reduce((sum, f) => sum + f.size, 0),
    targetPath: props.currentPath,
    timestamp: selectedAt
  });

  fileArray.forEach(file => {
    console.log('[FileExplorer] Emitting upload for file', {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      selectedAt
    });
  });
  const targetPath = props.currentPath;
  const folderName = props.currentPath === '/' ? '根目录' : props.currentPath.split('/').pop() || '当前目录';
  
  emit('upload', fileArray, targetPath);
  
  // 清空输入
  input.value = '';

  ElMessage.success(`已选择 ${fileArray.length} 个文件上传到 "${folderName}"`);

  // 通知父组件：文件选择器已关闭
  try {
    emit('postUploadDialogClose', { targetPath: props.currentPath, timestamp: new Date().toISOString(), empty: false });
  } catch {}
};

const getFileIconClass = (file: FileItem) => {
  return {
    'directory-icon': file.type === 'directory',
    'file-icon': file.type === 'file',
    'readonly-item': file.isReadonly
  };
};

// 监听路径变化
watch(() => props.currentPath, (newPath) => {
  // 确保路径在历史记录中
  if (pathHistory.value[currentPathIndex.value] !== newPath) {
    if (!pathHistory.value.includes(newPath)) {
      if (currentPathIndex.value < pathHistory.value.length - 1) {
        pathHistory.value = pathHistory.value.slice(0, currentPathIndex.value + 1);
      }
      pathHistory.value.push(newPath);
      currentPathIndex.value = pathHistory.value.length - 1;
    } else {
      currentPathIndex.value = pathHistory.value.indexOf(newPath);
    }
  }
});

watch(displayFiles, (files) => {
  const availablePaths = new Set(files.map(file => file.path));
  const filtered = Array.from(selectedPaths.value).filter(path => availablePaths.has(path));
  if (filtered.length !== selectedPaths.value.size) {
    selectedPaths.value = new Set<string>(filtered);
  }

  if (currentRowPath.value) {
    if (!availablePaths.has(currentRowPath.value)) {
      setCurrentRow(null);
    } else {
      const current = findFileByPath(currentRowPath.value);
      if (current) {
        nextTick(() => {
          tableRef.value?.setCurrentRow(current);
        });
      }
    }
  }
});

watch(() => props.currentPath, () => {
  clearSelection();
  if (moveDialogVisible.value) {
    moveDialogVisible.value = false;
  }
  resetMoveDialog();
});

// 初始化
onMounted(() => {
  pathHistory.value = [props.currentPath || '/'];
  currentPathIndex.value = 0;
});

defineExpose({
  goBack,
  refreshFiles,
  showCreateFolderDialog,
  handleUploadToCurrentFolder,
  handleBatchPreview,
  handleBatchDownload,
  handleBatchRename,
  handleBatchMove,
  handleBatchDelete
});
</script>

<style scoped>
.file-explorer {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.explorer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.breadcrumb-container {
  flex: 1;
  min-width: 0;
}

.path-breadcrumb {
  flex: 1;
}

.breadcrumb-item {
  cursor: pointer;
  user-select: none;
}

.breadcrumb-item:hover {
  color: var(--el-color-primary);
}

.file-list-container {
  flex: 1;
  margin-top: 16px;
}

.file-table {
	height: 100%;
}

:deep(.file-table) {
	--el-table-current-row-bg-color: rgba(64, 158, 255, 0.18);
	--el-table-row-hover-bg-color: rgba(64, 158, 255, 0.08);
}

.move-tip {
	margin-top: 8px;
	color: var(--el-text-color-secondary);
	font-size: 12px;
}

:deep(.file-table .el-table__row.current-row td) {
	background-color: transparent;
	color: var(--el-text-color-primary);
}

.file-icon {
  font-size: 18px;
}

.directory-icon {
  color: var(--el-color-warning);
}

.file-icon.file-icon {
  color: var(--el-color-info);
}

.readonly-item {
  opacity: 0.7;
}

.file-name {
  font-weight: 500;
}

.file-name.readonly {
  color: var(--el-text-color-secondary);
}

.readonly-tag {
  margin-left: 8px;
}

.directory-indicator {
  color: var(--el-text-color-placeholder);
  font-style: italic;
}

.permissions {
  font-family: monospace;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

:deep(.el-table__row) {
  cursor: pointer;
}

:deep(.el-table__row:hover) {
  background-color: var(--el-table-row-hover-bg-color);
}

@media (max-width: 768px) {
  .explorer-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  
  :deep(.el-table) {
    font-size: 12px;
  }
  
  :deep(.el-button-group) {
    display: flex;
  }
  
  :deep(.el-button--small) {
    padding: 4px 6px;
  }
}
</style>
