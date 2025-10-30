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
    private moveFile: FileItem | null = null;
    private moveTargetDirectory = '';
    private moving = false;

    private createFolderDialogVisible = false;
    private newFolderName = '';
    private creating = false;

    constructor(container: HTMLElement, logger: Logger) {
        this.container = container;
        this.logger = logger;
        this.render();
        this.setupEventListeners();
        this.updateToolbarState();
    }

    private render(): void {
        const pathSegments = this.getPathSegments();
        const displayFiles = this.getDisplayFiles();

        this.container.innerHTML = `
            <div class="file-explorer" style="display: ${this.connected ? 'block' : 'none'};">
                <div class="explorer-header" style="padding: 16px; border-bottom: 1px solid var(--vscode-panel-border);">
                    <div class="breadcrumb-container">
                        <div class="breadcrumb">
                            <span class="breadcrumb-item" data-path="/" style="cursor: pointer; padding: 4px 8px; border-radius: 4px;">
                                🏠
                            </span>
                            ${pathSegments.map((segment, index) => `
                                <span class="breadcrumb-separator">/</span>
                                <span class="breadcrumb-item" data-path="${this.getPathUpTo(index)}" style="cursor: pointer; padding: 4px 8px; border-radius: 4px;">
                                    ${this.escapeHtml(segment)}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <div class="file-list-container" style="position: relative;">
                    ${this.loading ? '<div class="loading" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);"></div>' : ''}
                    <table class="file-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr>
                                <th style="width: 48px; padding: 8px;">
                                    <input type="checkbox" id="select-all" ${this.isAllSelected() ? 'checked' : ''} ${this.isIndeterminate() ? 'indeterminate' : ''}>
                                </th>
                                <th style="width: 60px; padding: 8px;"></th>
                                <th style="text-align: left; padding: 8px;">名称</th>
                                <th style="text-align: right; width: 100px; padding: 8px;">大小</th>
                                <th style="width: 180px; padding: 8px;">修改时间</th>
                                ${this.showPermissions ? '<th style="width: 100px; padding: 8px;">权限</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${displayFiles.length === 0 ? `
                                <tr>
                                    <td colspan="${this.showPermissions ? 6 : 5}" style="text-align: center; padding: 40px; color: var(--vscode-descriptionForeground);">
                                        暂无文件
                                    </td>
                                </tr>
                            ` : displayFiles.map(file => `
                                <tr class="file-row" data-path="${this.escapeHtml(file.path)}" style="cursor: pointer;">
                                    <td style="text-align: center; padding: 8px;" onclick="event.stopPropagation();">
                                        <input type="checkbox" class="file-checkbox" data-path="${this.escapeHtml(file.path)}" ${this.isRowSelected(file) ? 'checked' : ''}>
                                    </td>
                                    <td style="text-align: center; padding: 8px;">
                                        <span style="font-size: 20px;">${file.type === 'directory' ? '📁' : '📄'}</span>
                                    </td>
                                    <td style="padding: 8px;">
                                        <span class="file-name" ${file.isReadonly ? 'style="color: var(--vscode-descriptionForeground);"' : ''}>
                                            ${this.escapeHtml(file.name)}
                                        </span>
                                        ${file.isReadonly ? '<span style="margin-left: 8px; padding: 2px 6px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; font-size: 11px;">只读</span>' : ''}
                                    </td>
                                    <td style="text-align: right; padding: 8px; color: var(--vscode-descriptionForeground);">
                                        ${file.type === 'file' ? formatFileSize(file.size) : '--'}
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
                    <div class="modal-container" style="max-width: 400px;">
                        <div class="modal-header">
                            <h3 class="modal-title">移动</h3>
                            <button class="modal-close" id="move-dialog-close">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="control-group">
                                <label for="move-target">目标目录</label>
                                <input type="text" id="move-target" placeholder="可选择或输入目标路径，支持 ../" style="width: 100%;">
                                <div class="hint-text">支持输入绝对路径或相对路径（例如 ../documents）。</div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-secondary" id="move-dialog-cancel">取消</button>
                            <button class="btn btn-primary" id="move-dialog-confirm">确定</button>
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
        // Breadcrumb navigation
        this.container.querySelectorAll('.breadcrumb-item').forEach(item => {
            item.addEventListener('click', () => {
                const path = (item as HTMLElement).dataset.path;
                if (path) {
                    this.navigateToPath(path);
                }
            });
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
    }

    private setupContextMenu(): void {
        const contextMenu = this.container.querySelector('#context-menu') as HTMLElement;
        if (!contextMenu) return;

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
        if (!contextMenu) return;

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
        return '/' + segments.slice(0, index + 1).join('/');
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
        return this.files.length > 0 && this.selectedFiles.size === this.files.length;
    }

    private isIndeterminate(): boolean {
        return this.selectedFiles.size > 0 && this.selectedFiles.size < this.files.length;
    }

    private isRowSelected(file: FileItem): boolean {
        return this.selectedFiles.has(file.path);
    }

    private toggleSelectAll(checked: boolean): void {
        if (checked) {
            this.files.forEach(file => this.selectedFiles.add(file.path));
        } else {
            this.selectedFiles.clear();
        }
        this.render();
        this.updateToolbarState();
    }

    private toggleRowSelection(file: FileItem, selected: boolean): void {
        if (selected) {
            this.selectedFiles.add(file.path);
        } else {
            this.selectedFiles.delete(file.path);
        }
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
        this.moveFile = file;
        this.moveTargetDirectory = this.currentPath;
        this.moveDialogVisible = true;
        this.updateMoveDialog();
    }

    private async confirmMove(): Promise<void> {
        if (!this.moveFile || !this.moveTargetDirectory.trim()) {
            UIMessage.warning('请选择或输入目标目录');
            return;
        }

        try {
            this.moving = true;
            this.updateMoveDialog();

            const oldPath = this.moveFile.path;
            const newPath = joinPath(this.moveTargetDirectory.trim(), this.moveFile.name);
            
            await this.onMove?.(oldPath, newPath);
            
            this.moveDialogVisible = false;
            this.resetMoveDialog();
        } catch (error) {
            UIMessage.error('移动失败');
            this.logger.error('Move failed', error);
        } finally {
            this.moving = false;
        }
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
            const input = dialog.querySelector('#move-target') as HTMLInputElement;
            if (input) {
                input.value = this.moveTargetDirectory;
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
        this.moveFile = null;
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

        this.onToolbarStateChange?.(state);
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Public methods
    setFiles(files: FileItem[]): void {
        this.files = files;
        this.render();
        this.setupEventListeners();
        this.updateToolbarState();
    }

    setCurrentPath(path: string): void {
        if (this.currentPath !== path) {
            this.pathHistory.push(this.currentPath);
            this.currentPath = path;
            this.render();
            this.setupEventListeners();
        }
    }

    setLoading(loading: boolean): void {
        this.loading = loading;
        this.render();
        this.setupEventListeners();
        this.updateToolbarState();
    }

    setVisible(visible: boolean): void {
        const explorer = this.container.querySelector('.file-explorer') as HTMLElement;
        if (explorer) {
            explorer.style.display = visible ? 'block' : 'none';
        }
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
        if (selectedFiles.length === 1) {
            this.handleMove(selectedFiles[0]);
        } else if (selectedFiles.length > 1) {
            // Batch move - need to implement
            UIMessage.info('批量移动功能待实现');
        }
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
