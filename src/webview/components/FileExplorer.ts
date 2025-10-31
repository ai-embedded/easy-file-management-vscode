// Native JS FileExplorer component - Complete implementation
import { Logger } from '@shared/utils/Logger';
import type { FileItem } from '@shared/types';
import { formatFileSize, formatDate, isValidFilename, joinPath, isTextFile } from '../utils/fileUtils';
import { UIMessage, UIMessageBox } from '../utils/uiUtils';
import { showOpenDialog } from '../utils/messageUtils';

export interface FileExplorerToolbarState {
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

export class FileExplorer {
	private container: HTMLElement;
	private logger: Logger;
    
	public onPathChange?: (path: string) => void;
	public onDownload?: (file: FileItem) => void;
	public onPreview?: (file: FileItem) => void;
	public onRename?: (oldPath: string, newPath: string) => void;
	public onMove?: (oldPath: string, newPath: string) => void;
	public onMoveBatch?: (operations: Array<{ oldPath: string; newPath: string }>) => void;
	public onDelete?: (file: FileItem) => void;
	public onCreateFolder?: (path: string, name: string) => void;
	public onRefresh?: () => void;
	public onUpload?: (files: File[], targetPath: string) => void;
	public onToolbarStateChange?: (state: FileExplorerToolbarState) => void;

	private files: FileItem[] = [];
	private currentPath = '/';
	private directoryCache = new Map<string, FileItem[]>();
	private connected = false;
	private loading = false;
	private showPermissions = false;
	private selectedFiles = new Set<string>();
	private pathHistory: string[] = [];
	private contextMenuItem: FileItem | null = null;
	private contextMenuVisible = false;

	// Dialog states
	private renameDialogVisible = false;
	private renameFile: FileItem | null = null;
	private newFileName = '';
	private renaming = false;

	private moveDialogVisible = false;
	private moveItems: FileItem[] = [];
	private moveTargetDirectory = '';
	private moving = false;

	private createFolderDialogVisible = false;
	private newFolderName = '';
	private creating = false;
	private searchQuery = '';

	constructor(container: HTMLElement, logger: Logger) {
		this.container = container;
		this.logger = logger;
		this.render();
		this.setupEventListeners();
		this.updateToolbarState();
	}

	private buildDirectoryTreeMarkup(): string {
		const rootEntries = this.getSortedDirectories('/');
		if (rootEntries.length === 0) {
			return '<div style="color: var(--vscode-descriptionForeground); font-size: 12px;">暂无目录</div>';
		}
		return rootEntries.map((entry) => this.renderDirectoryNode(entry, 0)).join('');
	}

	private renderDirectoryNode(entry: FileItem, depth: number): string {
		const path = entry.path;
		const label = entry.name || (path === '/' ? '/' : path.split('/').filter(Boolean).pop() || '/');
		const children = this.getSortedDirectories(path);
		const isActive = this.currentPath === path;
		const isAncestor = this.currentPath.startsWith(path === '/' ? '/' : `${path}/`) && !isActive;
		const shouldExpand = children.length > 0 && (isActive || isAncestor);
		const indent = depth === 0 ? 0 : depth * 16;
		const highlightStyle = isActive
			? 'background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground);'
			: '';

		const childrenMarkup = shouldExpand
			? children.map((child) => this.renderDirectoryNode(child, depth + 1)).join('')
			: '';

		return `
            <div class="tree-node" data-path="${this.escapeHtml(path)}">
                <div class="tree-node-label" data-path="${this.escapeHtml(path)}" style="padding: 6px 8px; margin-left: ${indent}px; border-radius: 6px; display: flex; align-items: center; gap: 8px; cursor: pointer; ${highlightStyle}">
                    <span>📁</span>
                    <span>${this.escapeHtml(label)}</span>
                </div>
                ${childrenMarkup ? `<div class="tree-children">${childrenMarkup}</div>` : ''}
            </div>
        `;
	}

	private getSortedDirectories(path: string): FileItem[] {
		const items = this.directoryCache.get(path) ?? [];
		return [...items].sort((a, b) => a.name.localeCompare(b.name));
	}

	private buildSelectionSummary(totalVisible: number): string {
		const selectedCount = this.selectedFiles.size;
		if (selectedCount === 0) {
			return `${totalVisible} 项`;
		}

		const selectedItems = this.files.filter((file) => this.selectedFiles.has(file.path));
		const totalBytes = selectedItems.reduce((sum, file) => {
			if (file.type === 'directory') {
				return sum;
			}
			return sum + (file.size ?? 0);
		}, 0);

		const sizeText = totalBytes > 0 ? ` (${formatFileSize(totalBytes)})` : '';
		return `${selectedCount} 项已选${sizeText}`;
	}

	private getFileTypeDisplay(file: FileItem): string {
		if (file.type === 'directory') {
			return 'Folder';
		}
		const lowerName = file.name.toLowerCase();
		if (lowerName.endsWith('.js')) {return 'JavaScript';}
		if (lowerName.endsWith('.ts')) {return 'TypeScript';}
		if (lowerName.endsWith('.json')) {return 'JSON';}
		if (lowerName.endsWith('.html')) {return 'HTML';}
		if (lowerName.endsWith('.css')) {return 'CSS';}
		if (lowerName.endsWith('.svg')) {return 'SVG';}
		if (lowerName.endsWith('.png')) {return 'PNG';}
		if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {return 'JPEG';}
		if (lowerName.endsWith('.txt')) {return 'Text';}
		const parts = file.name.split('.');
		return parts.length > 1 ? parts.pop()!.toUpperCase() : 'File';
	}

	private ensurePathChainInCache(path: string): void {
		if (!path) {
			return;
		}

		if (!this.directoryCache.has('/')) {
			this.directoryCache.set('/', []);
		}

		const segments = path.split('/').filter(Boolean);
		let current = '/';

		for (const segment of segments) {
			const nextPath = current === '/' ? `/${segment}` : `${current}/${segment}`;
			const siblings = this.directoryCache.get(current) ?? [];

			if (!siblings.some((item) => item.path === nextPath)) {
				siblings.push({
					name: segment,
					path: nextPath,
					type: 'directory',
					size: 0,
					lastModified: new Date(),
					permissions: '',
					isReadonly: false
				});
				siblings.sort((a, b) => a.name.localeCompare(b.name));
				this.directoryCache.set(current, siblings);
			}

			if (!this.directoryCache.has(nextPath)) {
				this.directoryCache.set(nextPath, []);
			}

			current = nextPath;
		}
	}

	private triggerToolbarAction(buttonId: string): void {
		const target = document.getElementById(buttonId);
		target?.click();
	}

	private render(): void {
		const pathSegments = this.getPathSegments();
		const displayFiles = this.getDisplayFiles();
		const treeMarkup = this.buildDirectoryTreeMarkup();
		const selectionSummary = this.buildSelectionSummary(displayFiles.length);
		const permissionsHeader = this.showPermissions ? '<th style="width: 100px; padding: 8px;">权限</th>' : '';
		const noDataColspan = this.showPermissions ? 7 : 6;

		this.container.innerHTML = `
            <div class="file-explorer" style="display: ${this.connected ? 'flex' : 'none'}; height: 100%; background: var(--vscode-editor-background);">
                <aside class="file-explorer-sidebar" style="width: 240px; border-right: 1px solid var(--vscode-panel-border); padding: 16px 12px; overflow-y: auto;">
                    <div style="font-weight: 600; margin-bottom: 12px;">目录</div>
                    <div id="directory-tree">
                        ${treeMarkup}
                    </div>
                </aside>
                <section class="file-explorer-main" style="flex: 1; display: flex; flex-direction: column;">
                    <div class="explorer-header" style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; border-bottom: 1px solid var(--vscode-panel-border);">
                        <div class="breadcrumb-container">
                            <div class="breadcrumb">
                                <span class="breadcrumb-item" data-path="/" style="cursor: pointer; padding: 4px 8px; border-radius: 4px;">
                                    /
                                </span>
                                ${pathSegments.map((segment, index) => `
                                    <span class="breadcrumb-separator">/</span>
                                    <span class="breadcrumb-item" data-path="${this.getPathUpTo(index)}" style="cursor: pointer; padding: 4px 8px; border-radius: 4px;">
                                        ${this.escapeHtml(segment)}
                                    </span>
                                `).join('')}
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="position: relative;">
                                <input type="search" id="file-search-input" placeholder="Search files..." value="${this.escapeHtml(this.searchQuery)}" style="padding: 6px 32px; border-radius: 6px; background: color-mix(in srgb, var(--vscode-editor-background) 90%, transparent); border: 1px solid var(--vscode-panel-border); color: var(--vscode-editor-foreground);">
                                <span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--vscode-descriptionForeground); pointer-events: none;">🔍</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <button class="btn btn-circle btn-small" id="header-download" title="下载所选">
                                    ⬇
                                </button>
                                <button class="btn btn-circle btn-small btn-danger" id="header-delete" title="删除所选">
                                    🗑
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="file-list-container" style="flex: 1; position: relative;">
                        ${this.loading ? '<div class="loading" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);"></div>' : ''}
                        <table class="file-table" style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr>
                                    <th style="width: 48px; padding: 8px;">
                                        <input type="checkbox" id="select-all" ${this.isAllSelected() ? 'checked' : ''} ${this.isIndeterminate() ? 'indeterminate' : ''}>
                                    </th>
                                    <th style="width: 40px; padding: 8px;"></th>
                                    <th style="text-align: left; padding: 8px;">名称</th>
                                    <th style="text-align: right; width: 120px; padding: 8px;">大小</th>
                                    <th style="width: 140px; padding: 8px;">类型</th>
                                    <th style="width: 180px; padding: 8px;">修改时间</th>
                                    ${permissionsHeader}
                                </tr>
                            </thead>
                            <tbody>
                                ${displayFiles.length === 0 ? `
                                    <tr>
                                        <td colspan="${noDataColspan}" style="text-align: center; padding: 48px; color: var(--vscode-descriptionForeground);">
                                            暂无文件
                                        </td>
                                    </tr>
                                ` : displayFiles.map(file => `
                                    <tr class="file-row ${this.isRowSelected(file) ? 'selected' : ''}" data-path="${this.escapeHtml(file.path)}" style="cursor: pointer;">
                                        <td style="text-align: center; padding: 8px;" onclick="event.stopPropagation();">
                                            <input type="checkbox" class="file-checkbox" data-path="${this.escapeHtml(file.path)}" ${this.isRowSelected(file) ? 'checked' : ''}>
                                        </td>
                                        <td style="text-align: center; padding: 8px;">
                                            <span style="font-size: 18px;">${file.type === 'directory' ? '📁' : '📄'}</span>
                                        </td>
                                        <td style="padding: 8px;">
                                            <span class="file-name" ${file.isReadonly ? 'style="color: var(--vscode-descriptionForeground);"' : ''}>
                                                ${this.escapeHtml(file.name)}
                                            </span>
                                            ${file.isReadonly ? '<span style="margin-left: 8px; padding: 2px 6px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; font-size: 11px;">只读</span>' : ''}
                                        </td>
                                        <td style="text-align: right; padding: 8px;">
                                            ${file.type === 'directory' ? '--' : formatFileSize(file.size ?? 0)}
                                        </td>
                                        <td style="padding: 8px; color: var(--vscode-descriptionForeground);">
                                            ${this.getFileTypeDisplay(file)}
                                        </td>
                                        <td style="padding: 8px; color: var(--vscode-descriptionForeground);">
                                            ${file.lastModified ? formatDate(file.lastModified) : '未知时间'}
                                        </td>
                                        ${this.showPermissions ? `
                                            <td style="padding: 8px; color: var(--vscode-descriptionForeground);">
                                                ${file.permissions || '-'}
                                            </td>
                                        ` : ''}
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>

                    <div style="padding: 8px 16px; border-top: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 12px;">
                        ${selectionSummary}
                    </div>
                </section>
            </div>

            <!-- Context Menu -->
                <div id="context-menu" class="context-menu" style="display: none;">
                    <div class="context-menu-item" id="ctx-preview" style="padding: 8px 16px; cursor: pointer;">
                        预览
                    </div>
                    <div class="context-menu-item" id="ctx-download" style="padding: 8px 16px; cursor: pointer;">
                        下载
                    </div>
                    <div class="context-menu-item" id="ctx-rename" style="padding: 8px 16px; cursor: pointer;">
                        重命名
                    </div>
                    <div class="context-menu-item" id="ctx-move" style="padding: 8px 16px; cursor: pointer;">
                        移动
                    </div>
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-item" id="ctx-delete" style="padding: 8px 16px; cursor: pointer;">
                        删除
                    </div>
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-item" id="ctx-create-folder" style="padding: 8px 16px; cursor: pointer;">
                        新建文件夹
                    </div>
                    <div class="context-menu-item" id="ctx-refresh" style="padding: 8px 16px; cursor: pointer;">
                        刷新
                    </div>
                </div>

                <!-- Rename Dialog -->
                <div id="rename-dialog" class="modal-overlay" style="display: none;">
                    <div class="modal-container" style="max-width: 400px;">
                        <div class="modal-header">
                            <h3 class="modal-title">重命名</h3>
                            <button class="modal-close" id="rename-dialog-close">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="control-group">
                                <label for="rename-input">新名称</label>
                                <input type="text" id="rename-input" placeholder="请输入新的文件名" style="width: 100%;">
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-secondary" id="rename-dialog-cancel">取消</button>
                            <button class="btn btn-primary" id="rename-dialog-confirm">确定</button>
                        </div>
                    </div>
                </div>

                <!-- Move Dialog -->
                <div id="move-dialog" class="modal-overlay" style="display: none;">
                    <div class="modal-container" style="max-width: 420px;">
                        <div class="modal-header">
                            <h3 class="modal-title">${this.moveItems.length > 1 ? `移动 (${this.moveItems.length} 项)` : '移动'}</h3>
                            <button class="modal-close" id="move-dialog-close">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="control-group">
                                <label>选中项</label>
                                <div id="move-selected-list" style="max-height: 160px; overflow-y: auto; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: color-mix(in srgb, var(--vscode-editor-background) 90%, transparent);">
                                    ${this.buildMoveItemsListMarkup()}
                                </div>
                            </div>
                            <div class="control-group">
                                <label for="move-target">目标目录</label>
                                <input type="text" id="move-target" value="${this.escapeHtml(this.moveTargetDirectory)}" placeholder="可选择或输入目标路径，支持 ../" style="width: 100%;">
                                <div class="hint-text">支持输入绝对路径或相对路径（例如 ../documents）。</div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-secondary" id="move-dialog-cancel">取消</button>
                            <button class="btn btn-primary" id="move-dialog-confirm">${this.moving ? '移动中...' : '确定'}</button>
                        </div>
                    </div>
                </div>

                <!-- Create Folder Dialog -->
                <div id="create-folder-dialog" class="modal-overlay" style="display: none;">
                    <div class="modal-container" style="max-width: 400px;">
                        <div class="modal-header">
                            <h3 class="modal-title">新建文件夹</h3>
                            <button class="modal-close" id="create-folder-dialog-close">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="control-group">
                                <label for="folder-name-input">文件夹名称</label>
                                <input type="text" id="folder-name-input" placeholder="请输入文件夹名称" style="width: 100%;">
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-secondary" id="create-folder-dialog-cancel">取消</button>
                            <button class="btn btn-primary" id="create-folder-dialog-confirm">创建</button>
                        </div>
                    </div>
                </div>

                <!-- Hidden file input for upload -->
                <input type="file" id="file-upload-input" multiple style="display: none;">
            </div>
        `;
	}

	private setupEventListeners(): void {
		// Directory tree navigation
		this.container.querySelectorAll('.tree-node-label').forEach((node) => {
			node.addEventListener('click', () => {
				const path = (node as HTMLElement).dataset.path;
				if (path) {
					this.navigateToPath(path);
				}
			});
		});

		// Breadcrumb navigation
		this.container.querySelectorAll('.breadcrumb-item').forEach(item => {
			item.addEventListener('click', () => {
				const path = (item as HTMLElement).dataset.path;
				if (path) {
					this.navigateToPath(path);
				}
			});
		});

		// Search input
		const searchInput = this.container.querySelector('#file-search-input') as HTMLInputElement;
		searchInput?.addEventListener('input', (e) => {
			this.searchQuery = (e.target as HTMLInputElement).value;
			this.render();
			this.setupEventListeners();
			this.updateToolbarState();
		});

		// File row click
		this.container.querySelectorAll('.file-row').forEach(row => {
			row.addEventListener('click', (e) => {
				if ((e.target as HTMLElement).tagName !== 'INPUT') {
					const path = (row as HTMLElement).dataset.path;
					const file = this.files.find(f => f.path === path);
					if (file) {
						this.handleRowClick(file);
					}
				}
			});

			row.addEventListener('dblclick', () => {
				const path = (row as HTMLElement).dataset.path;
				const file = this.files.find(f => f.path === path);
				if (file) {
					this.handleDoubleClick(file);
				}
			});

			row.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				const path = (row as HTMLElement).dataset.path;
				const file = this.files.find(f => f.path === path);
				if (file) {
					this.handleRightClick(file, e);
				}
			});
		});

		// Checkbox selection
		const selectAll = this.container.querySelector('#select-all') as HTMLInputElement;
		selectAll?.addEventListener('change', () => {
			this.toggleSelectAll(selectAll.checked);
		});

		this.container.querySelectorAll('.file-checkbox').forEach(checkbox => {
			checkbox.addEventListener('change', () => {
				const path = (checkbox as HTMLElement).dataset.path;
				const file = this.files.find(f => f.path === path);
				if (file) {
					this.toggleRowSelection(file, (checkbox as HTMLInputElement).checked);
				}
			});
		});

		// Context menu
		this.setupContextMenu();

		// Dialogs
		this.setupDialogs();

		// Upload
		const uploadInput = this.container.querySelector('#file-upload-input') as HTMLInputElement;
		uploadInput?.addEventListener('change', (e) => {
			const files = Array.from((e.target as HTMLInputElement).files || []);
			if (files.length > 0) {
				this.onUpload?.(files, this.currentPath);
				uploadInput.value = '';
			}
		});

		// Header quick actions
		this.container.querySelector('#header-download')?.addEventListener('click', () => this.triggerToolbarAction('btn-download'));
		this.container.querySelector('#header-delete')?.addEventListener('click', () => this.triggerToolbarAction('btn-delete'));
	}

	private setupContextMenu(): void {
		const contextMenu = this.container.querySelector('#context-menu') as HTMLElement;
		if (!contextMenu) {return;}

		// Context menu items
		contextMenu.querySelector('#ctx-preview')?.addEventListener('click', () => {
			if (this.contextMenuItem) {
				this.handlePreview(this.contextMenuItem);
			}
			this.hideContextMenu();
		});

		contextMenu.querySelector('#ctx-download')?.addEventListener('click', () => {
			if (this.contextMenuItem) {
				this.handleDownload(this.contextMenuItem);
			}
			this.hideContextMenu();
		});

		contextMenu.querySelector('#ctx-rename')?.addEventListener('click', () => {
			if (this.contextMenuItem) {
				this.handleRename(this.contextMenuItem);
			}
			this.hideContextMenu();
		});

		contextMenu.querySelector('#ctx-move')?.addEventListener('click', () => {
			if (this.contextMenuItem) {
				this.handleMove(this.contextMenuItem);
			}
			this.hideContextMenu();
		});

		contextMenu.querySelector('#ctx-delete')?.addEventListener('click', () => {
			if (this.contextMenuItem) {
				this.handleDelete(this.contextMenuItem);
			}
			this.hideContextMenu();
		});

		contextMenu.querySelector('#ctx-create-folder')?.addEventListener('click', () => {
			this.showCreateFolderDialog();
			this.hideContextMenu();
		});

		contextMenu.querySelector('#ctx-refresh')?.addEventListener('click', () => {
			this.onRefresh?.();
			this.hideContextMenu();
		});

		// Hide context menu on click outside
		document.addEventListener('click', () => {
			this.hideContextMenu();
		});
	}

	private setupDialogs(): void {
		// Rename dialog
		const renameDialog = this.container.querySelector('#rename-dialog') as HTMLElement;
		renameDialog?.querySelector('#rename-dialog-close')?.addEventListener('click', () => {
			this.renameDialogVisible = false;
			this.updateRenameDialog();
		});
		renameDialog?.querySelector('#rename-dialog-cancel')?.addEventListener('click', () => {
			this.renameDialogVisible = false;
			this.updateRenameDialog();
		});
		renameDialog?.querySelector('#rename-dialog-confirm')?.addEventListener('click', () => {
			this.confirmRename();
		});
		const renameInput = renameDialog?.querySelector('#rename-input') as HTMLInputElement;
		renameInput?.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				this.confirmRename();
			}
		});

		// Move dialog
		const moveDialog = this.container.querySelector('#move-dialog') as HTMLElement;
		moveDialog?.querySelector('#move-dialog-close')?.addEventListener('click', () => {
			this.moveDialogVisible = false;
			this.updateMoveDialog();
		});
		moveDialog?.querySelector('#move-dialog-cancel')?.addEventListener('click', () => {
			this.moveDialogVisible = false;
			this.updateMoveDialog();
		});
		moveDialog?.querySelector('#move-dialog-confirm')?.addEventListener('click', () => {
			this.confirmMove();
		});
		const moveInput = moveDialog?.querySelector('#move-target') as HTMLInputElement;
		moveInput?.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				this.confirmMove();
			}
		});

		// Create folder dialog
		const createFolderDialog = this.container.querySelector('#create-folder-dialog') as HTMLElement;
		createFolderDialog?.querySelector('#create-folder-dialog-close')?.addEventListener('click', () => {
			this.createFolderDialogVisible = false;
			this.updateCreateFolderDialog();
		});
		createFolderDialog?.querySelector('#create-folder-dialog-cancel')?.addEventListener('click', () => {
			this.createFolderDialogVisible = false;
			this.updateCreateFolderDialog();
		});
		createFolderDialog?.querySelector('#create-folder-dialog-confirm')?.addEventListener('click', () => {
			this.confirmCreateFolder();
		});
		const folderNameInput = createFolderDialog?.querySelector('#folder-name-input') as HTMLInputElement;
		folderNameInput?.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				this.confirmCreateFolder();
			}
		});
	}

	private handleRowClick(file: FileItem): void {
		// Single click - could be used for selection
	}

	private handleDoubleClick(file: FileItem): void {
		if (file.type === 'directory') {
			this.navigateToPath(file.path);
		} else {
			this.handlePreview(file);
		}
	}

	private handleRightClick(file: FileItem, e: MouseEvent): void {
		this.contextMenuItem = file;
		this.showContextMenu(e.clientX, e.clientY);
	}

	private showContextMenu(x: number, y: number): void {
		const contextMenu = this.container.querySelector('#context-menu') as HTMLElement;
		if (!contextMenu) {return;}

		contextMenu.style.display = 'block';
		contextMenu.style.left = `${x}px`;
		contextMenu.style.top = `${y}px`;

		// Update menu item states
		const item = this.contextMenuItem;
		if (item) {
			(contextMenu.querySelector('#ctx-preview') as HTMLElement).style.opacity = 
                (item.type === 'directory' || !isTextFile(item.name)) ? '0.5' : '1';
			(contextMenu.querySelector('#ctx-download') as HTMLElement).style.opacity = 
                item.type === 'directory' ? '0.5' : '1';
			(contextMenu.querySelector('#ctx-rename') as HTMLElement).style.opacity = 
                item.isReadonly ? '0.5' : '1';
			(contextMenu.querySelector('#ctx-move') as HTMLElement).style.opacity = 
                item.isReadonly ? '0.5' : '1';
			(contextMenu.querySelector('#ctx-delete') as HTMLElement).style.opacity = 
                item.isReadonly ? '0.5' : '1';
		}

		this.contextMenuVisible = true;
	}

	private hideContextMenu(): void {
		const contextMenu = this.container.querySelector('#context-menu') as HTMLElement;
		if (contextMenu) {
			contextMenu.style.display = 'none';
		}
		this.contextMenuVisible = false;
	}

	private navigateToPath(path: string): void {
		if (this.currentPath !== path) {
			this.pathHistory.push(this.currentPath);
			this.currentPath = path;
			this.onPathChange?.(path);
			this.updateToolbarState();
		}
	}

	private getPathSegments(): string[] {
		const segments = this.currentPath.split('/').filter(s => s);
		return segments;
	}

	private getPathUpTo(index: number): string {
		const segments = this.getPathSegments();
		return `/${  segments.slice(0, index + 1).join('/')}`;
	}

	private getDisplayFiles(): FileItem[] {
		return [...this.files].sort((a, b) => {
			if (a.type !== b.type) {
				return a.type === 'directory' ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});
	}

	private isAllSelected(): boolean {
		const visibleFiles = this.getDisplayFiles();
		return visibleFiles.length > 0 && visibleFiles.every(file => this.selectedFiles.has(file.path));
	}

	private isIndeterminate(): boolean {
		const visibleFiles = this.getDisplayFiles();
		if (visibleFiles.length === 0) {
			return false;
		}
		const selectedVisible = visibleFiles.filter(file => this.selectedFiles.has(file.path)).length;
		return selectedVisible > 0 && selectedVisible < visibleFiles.length;
	}

	private isRowSelected(file: FileItem): boolean {
		return this.selectedFiles.has(file.path);
	}

	private toggleSelectAll(checked: boolean): void {
		const visibleFiles = this.getDisplayFiles();
		if (checked) {
			visibleFiles.forEach(file => this.selectedFiles.add(file.path));
		} else {
			visibleFiles.forEach(file => this.selectedFiles.delete(file.path));
		}
		this.render();
		this.setupEventListeners();
		this.updateToolbarState();
	}

	private toggleRowSelection(file: FileItem, selected: boolean): void {
		if (selected) {
			this.selectedFiles.add(file.path);
		} else {
			this.selectedFiles.delete(file.path);
		}
		this.render();
		this.setupEventListeners();
		this.updateToolbarState();
	}

	private async handlePreview(file: FileItem): Promise<void> {
		if (file.type === 'directory') {
			UIMessage.warning('无法预览文件夹');
			return;
		}
		this.onPreview?.(file);
	}

	private async handleDownload(file: FileItem): Promise<void> {
		if (file.type === 'directory') {
			UIMessage.warning('无法下载文件夹');
			return;
		}
		this.onDownload?.(file);
	}

	private handleRename(file: FileItem): void {
		if (file.isReadonly) {
			UIMessage.warning('只读文件无法重命名');
			return;
		}
		this.renameFile = file;
		this.newFileName = file.name;
		this.renameDialogVisible = true;
		this.updateRenameDialog();
        
		setTimeout(() => {
			const input = this.container.querySelector('#rename-input') as HTMLInputElement;
			if (input) {
				input.focus();
				input.select();
			}
		}, 100);
	}

	private async confirmRename(): Promise<void> {
		if (!this.renameFile || !this.newFileName.trim()) {
			UIMessage.warning('文件名不能为空');
			return;
		}

		if (!isValidFilename(this.newFileName)) {
			UIMessage.warning('文件名包含非法字符');
			return;
		}

		const existingFile = this.files.find(f => f.name === this.newFileName && f.path !== this.renameFile!.path);
		if (existingFile) {
			UIMessage.warning('文件名已存在');
			return;
		}

		try {
			this.renaming = true;
			this.updateRenameDialog();

			const oldPath = this.renameFile.path;
			const newPath = joinPath(this.currentPath, this.newFileName.trim());
            
			await this.onRename?.(oldPath, newPath);
            
			this.renameDialogVisible = false;
			this.resetRenameDialog();
		} catch (error) {
			UIMessage.error('重命名失败');
			this.logger.error('Rename failed', error);
		} finally {
			this.renaming = false;
		}
	}

	private handleMove(file: FileItem): void {
		if (file.isReadonly) {
			UIMessage.warning('只读文件无法移动');
			return;
		}
		this.moveItems = [file];
		this.moveTargetDirectory = this.currentPath;
		this.moveDialogVisible = true;
		this.updateMoveDialog();
		setTimeout(() => {
			const input = this.container.querySelector('#move-target') as HTMLInputElement;
			input?.focus();
			input?.select();
		}, 100);
	}

	private async confirmMove(): Promise<void> {
		const targetInput = this.container.querySelector('#move-target') as HTMLInputElement;
		if (targetInput) {
			this.moveTargetDirectory = targetInput.value;
		}

		if (!this.moveItems.length || !this.moveTargetDirectory.trim()) {
			UIMessage.warning('请选择或输入目标目录');
			return;
		}

		const resolvedTarget = this.resolveMoveTargetDirectory(this.moveTargetDirectory.trim());
		if (!resolvedTarget) {
			UIMessage.warning('请输入有效的目标目录');
			return;
		}

		const invalidDirectories = this.moveItems.filter(item => item.type === 'directory' && !this.isTargetValidForDirectory(item.path, resolvedTarget));
		if (invalidDirectories.length > 0) {
			UIMessage.warning(`无法将 ${invalidDirectories.map(item => `"${item.name}"`).join('、')} 移动到其自身或子目录中`);
			return;
		}

		const operations = this.moveItems
			.map(item => {
				const newPath = joinPath(resolvedTarget, item.name);
				return { oldPath: item.path, newPath };
			})
			.filter(operation => operation.oldPath !== operation.newPath);

		if (operations.length === 0) {
			UIMessage.info('目标目录与当前目录相同，无需移动');
			return;
		}

		try {
			this.moving = true;
			this.updateMoveDialog();

			if (operations.length === 1) {
				await this.onMove?.(operations[0].oldPath, operations[0].newPath);
			} else {
				this.onMoveBatch?.(operations);
			}

			this.moveDialogVisible = false;
			this.resetMoveDialog();
			this.updateMoveDialog();
		} catch (error) {
			UIMessage.error('移动失败');
			this.logger.error('Move failed', error);
		} finally {
			this.moving = false;
			this.updateMoveDialog();
		}
	}

	private resolveMoveTargetDirectory(input: string): string | null {
		if (!input) {
			return null;
		}

		let target = input.trim();
		if (!target) {
			return null;
		}

		if (!target.startsWith('/')) {
			const baseSegments = this.currentPath === '/' ? [] : this.currentPath.split('/').filter(Boolean);
			const segments = target.split('/').filter(Boolean);
			for (const segment of segments) {
				if (segment === '..') {
					if (baseSegments.length > 0) {
						baseSegments.pop();
					}
					continue;
				}
				if (segment === '.' || segment === '') {
					continue;
				}
				baseSegments.push(segment);
			}
			target = `/${  baseSegments.join('/')}`;
		}

		target = target.replace(/\/{2,}/g, '/');
		if (!target.startsWith('/')) {
			target = `/${  target}`;
		}
		if (target.length > 1) {
			target = target.replace(/\/+$/g, '');
		}
		return target || '/';
	}

	private isTargetValidForDirectory(sourcePath: string, targetPath: string): boolean {
		if (!sourcePath || !targetPath) {
			return false;
		}

		if (sourcePath === targetPath) {
			return false;
		}

		const sourceWithSlash = sourcePath.endsWith('/') ? sourcePath : `${sourcePath}/`;
		const targetWithSlash = targetPath.endsWith('/') ? targetPath : `${targetPath}/`;

		return !targetWithSlash.startsWith(sourceWithSlash);
	}

	private async handleDelete(file: FileItem): Promise<void> {
		if (file.isReadonly) {
			UIMessage.warning('只读文件无法删除');
			return;
		}

		const confirmed = await UIMessageBox.confirm({
			title: '确认删除',
			message: `确定要删除 "${file.name}" 吗？此操作无法撤销。`,
			confirmButtonText: '删除',
			cancelButtonText: '取消',
			type: 'warning'
		});

		if (confirmed) {
			this.onDelete?.(file);
		}
	}

	private showCreateFolderDialog(): void {
		this.newFolderName = '';
		this.createFolderDialogVisible = true;
		this.updateCreateFolderDialog();
        
		setTimeout(() => {
			const input = this.container.querySelector('#folder-name-input') as HTMLInputElement;
			if (input) {
				input.focus();
			}
		}, 100);
	}

	private async confirmCreateFolder(): Promise<void> {
		if (!this.newFolderName.trim()) {
			UIMessage.warning('文件夹名称不能为空');
			return;
		}

		if (!isValidFilename(this.newFolderName.trim())) {
			UIMessage.warning('文件夹名称包含非法字符');
			return;
		}

		const existingFile = this.files.find(f => f.name === this.newFolderName.trim() && f.type === 'directory');
		if (existingFile) {
			UIMessage.warning('文件夹名称已存在');
			return;
		}

		try {
			this.creating = true;
			this.updateCreateFolderDialog();

			await this.onCreateFolder?.(this.currentPath, this.newFolderName.trim());
            
			this.createFolderDialogVisible = false;
			this.resetCreateFolderDialog();
		} catch (error) {
			UIMessage.error('创建文件夹失败');
			this.logger.error('Create folder failed', error);
		} finally {
			this.creating = false;
		}
	}

	private updateRenameDialog(): void {
		const dialog = this.container.querySelector('#rename-dialog') as HTMLElement;
		if (dialog) {
			dialog.classList.toggle('show', this.renameDialogVisible);
			const input = dialog.querySelector('#rename-input') as HTMLInputElement;
			if (input) {
				input.value = this.newFileName;
			}
			const confirmBtn = dialog.querySelector('#rename-dialog-confirm') as HTMLButtonElement;
			if (confirmBtn) {
				confirmBtn.disabled = this.renaming;
				confirmBtn.textContent = this.renaming ? '重命名中...' : '确定';
			}
		}
	}

	private updateMoveDialog(): void {
		const dialog = this.container.querySelector('#move-dialog') as HTMLElement;
		if (dialog) {
			dialog.classList.toggle('show', this.moveDialogVisible);
			const title = dialog.querySelector('.modal-title');
			if (title) {
				title.textContent = this.moveItems.length > 1 ? `移动 (${this.moveItems.length} 项)` : '移动';
			}
			const input = dialog.querySelector('#move-target') as HTMLInputElement;
			if (input) {
				input.value = this.moveTargetDirectory;
			}
			const list = dialog.querySelector('#move-selected-list');
			if (list) {
				list.innerHTML = this.buildMoveItemsListMarkup();
			}
			const confirmBtn = dialog.querySelector('#move-dialog-confirm') as HTMLButtonElement;
			if (confirmBtn) {
				confirmBtn.disabled = this.moving;
				confirmBtn.textContent = this.moving ? '移动中...' : '确定';
			}
		}
	}

	private updateCreateFolderDialog(): void {
		const dialog = this.container.querySelector('#create-folder-dialog') as HTMLElement;
		if (dialog) {
			dialog.classList.toggle('show', this.createFolderDialogVisible);
			const input = dialog.querySelector('#folder-name-input') as HTMLInputElement;
			if (input) {
				input.value = this.newFolderName;
			}
			const confirmBtn = dialog.querySelector('#create-folder-dialog-confirm') as HTMLButtonElement;
			if (confirmBtn) {
				confirmBtn.disabled = this.creating;
				confirmBtn.textContent = this.creating ? '创建中...' : '创建';
			}
		}
	}

	private resetRenameDialog(): void {
		this.renameFile = null;
		this.newFileName = '';
		this.renaming = false;
	}

	private resetMoveDialog(): void {
		this.moveItems = [];
		this.moveTargetDirectory = '';
		this.moving = false;
	}

	private resetCreateFolderDialog(): void {
		this.newFolderName = '';
		this.creating = false;
	}

	private updateToolbarState(): void {
		const selectedCount = this.selectedFiles.size;
		const selectedFiles = this.files.filter(f => this.selectedFiles.has(f.path));
		const hasSelectedFiles = selectedCount > 0;
		const hasSelectedDirs = selectedFiles.some(f => f.type === 'directory');
		const hasSelectedReadonly = selectedFiles.some(f => f.isReadonly);

		const state: FileExplorerToolbarState = {
			canGoBack: this.pathHistory.length > 0,
			loading: this.loading,
			canCreateFolder: this.connected && !this.loading,
			canUpload: this.connected && !this.loading,
			canBatchPreview: hasSelectedFiles && selectedFiles.every(f => f.type === 'file' && isTextFile(f.name)),
			canBatchDownload: hasSelectedFiles && !hasSelectedDirs,
			canBatchRename: hasSelectedFiles === 1 && !hasSelectedReadonly,
			canBatchMove: hasSelectedFiles > 0 && !hasSelectedReadonly,
			canBatchDelete: hasSelectedFiles > 0 && !hasSelectedReadonly
		};

		const headerDownload = this.container.querySelector('#header-download') as HTMLButtonElement | null;
		if (headerDownload) {
			headerDownload.disabled = !state.canBatchDownload || this.loading;
		}
		const headerDelete = this.container.querySelector('#header-delete') as HTMLButtonElement | null;
		if (headerDelete) {
			headerDelete.disabled = !state.canBatchDelete || this.loading;
		}

		this.onToolbarStateChange?.(state);
	}

	private buildMoveItemsListMarkup(): string {
		if (this.moveItems.length === 0) {
			return '<div style="font-size: 12px; color: var(--vscode-descriptionForeground);">暂无选中项</div>';
		}

		const items = this.moveItems
			.map(item => `<li style="font-size: 12px; line-height: 18px;">${this.escapeHtml(item.name)}${item.type === 'directory' ? ' /' : ''}</li>`)
			.join('');

		return `<ul style="margin: 0; padding-left: 18px; list-style: disc;">${items}</ul>`;
	}

	private escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	// Public methods
	setFiles(files: FileItem[], path?: string): void {
		const targetPath = path ?? this.currentPath;
		this.files = files;
		if (targetPath) {
			const directories = files.filter(file => file.type === 'directory');
			this.directoryCache.set(targetPath, directories.sort((a, b) => a.name.localeCompare(b.name)));
			this.ensurePathChainInCache(targetPath);
		}
		this.render();
		this.setupEventListeners();
		this.updateToolbarState();
	}

	setCurrentPath(path: string): void {
		if (this.currentPath !== path) {
			this.pathHistory.push(this.currentPath);
			this.currentPath = path;
			this.selectedFiles.clear();
			this.searchQuery = '';
			this.ensurePathChainInCache(path);
			this.render();
			this.setupEventListeners();
			this.updateToolbarState();
		}
	}

	setLoading(loading: boolean): void {
		this.loading = loading;
		this.render();
		this.setupEventListeners();
		this.updateToolbarState();
	}

	setVisible(visible: boolean): void {
		if (this.connected === visible) {
			const explorer = this.container.querySelector('.file-explorer') as HTMLElement;
			if (explorer) {
				explorer.style.display = visible ? 'flex' : 'none';
			}
			return;
		}

		this.connected = visible;
		this.render();
		this.setupEventListeners();
		this.updateToolbarState();
	}

	goBack(): void {
		if (this.pathHistory.length > 0) {
			const previousPath = this.pathHistory.pop()!;
			this.currentPath = previousPath;
			this.onPathChange?.(previousPath);
			this.render();
			this.setupEventListeners();
			this.updateToolbarState();
		}
	}

	refreshFiles(): void {
		this.onRefresh?.();
	}

	handleUploadToCurrentFolder(): void {
		const input = this.container.querySelector('#file-upload-input') as HTMLInputElement;
		input?.click();
	}

	showCreateFolderDialogPublic(): void {
		this.showCreateFolderDialog();
	}

	handleBatchPreview(): void {
		const selectedFiles = this.files.filter(f => this.selectedFiles.has(f.path));
		const files = selectedFiles.filter(f => f.type === 'file' && isTextFile(f.name));
		if (files.length > 0) {
			this.onPreview?.(files[0]);
		}
	}

	handleBatchDownload(): void {
		const selectedFiles = this.files.filter(f => this.selectedFiles.has(f.path) && f.type === 'file');
		selectedFiles.forEach(file => {
			this.onDownload?.(file);
		});
	}

	handleBatchRename(): void {
		const selectedFiles = this.files.filter(f => this.selectedFiles.has(f.path));
		if (selectedFiles.length === 1) {
			this.handleRename(selectedFiles[0]);
		}
	}

	handleBatchMove(): void {
		const selectedFiles = this.files.filter(f => this.selectedFiles.has(f.path));
		if (selectedFiles.length === 0) {
			return;
		}

		const movableItems = selectedFiles.filter(item => !item.isReadonly);
		if (movableItems.length === 0) {
			UIMessage.warning('所选项目不可移动');
			return;
		}

		if (movableItems.length === 1) {
			this.handleMove(movableItems[0]);
			return;
		}

		this.moveItems = movableItems;
		this.moveTargetDirectory = this.currentPath;
		this.moveDialogVisible = true;
		this.updateMoveDialog();
		setTimeout(() => {
			const input = this.container.querySelector('#move-target') as HTMLInputElement;
			input?.focus();
			input?.select();
		}, 100);
	}

	async handleBatchDelete(): Promise<void> {
		const selectedFiles = this.files.filter(f => this.selectedFiles.has(f.path));
		const confirmed = await UIMessageBox.confirm({
			title: '确认删除',
			message: `确定要删除选中的 ${selectedFiles.length} 项吗？此操作无法撤销。`,
			confirmButtonText: '删除',
			cancelButtonText: '取消',
			type: 'warning'
		});

		if (confirmed) {
			selectedFiles.forEach(file => {
				this.onDelete?.(file);
			});
		}
	}
}
