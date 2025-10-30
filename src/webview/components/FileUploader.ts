// Native JS FileUploader component - replaces FileUploader.vue
import { Logger } from '@shared/utils/Logger';
import { formatFileSize } from '../utils/fileUtils';
import { UIMessage, UIMessageBox } from '../utils/uiUtils';
import type { FileProgress } from '../types';

type FileStatus = 'waiting' | 'uploading' | 'success' | 'error';

interface ExtendedFile {
    uid: string;
    name: string;
    size: number;
    file: File;
    status: FileStatus;
    progress?: number;
    uploadedSize?: number;
    errorMessage?: string;
    speed?: number;
    startTime?: number;
    lastUpdateTime?: number;
    lastUploadedSize?: number;
}

interface FileUploaderProps {
    currentPath: string;
    connected: boolean;
    maxFileSize?: number;
    allowedTypes?: string[];
    showStats?: boolean;
}

export class FileUploader {
    private container: HTMLElement;
    private logger: Logger;
    private props: FileUploaderProps;
    
    public onUpload?: (file: File, targetPath: string, onProgress: (progress: FileProgress) => void) => Promise<void>;
    public onUploadComplete?: (results: Array<{ file: File; success: boolean; error?: string }>) => void;
    public onUploadStart?: (files: ExtendedFile[]) => void;

    private fileList: ExtendedFile[] = [];
    private uploading = false;
    private uploadInput: HTMLInputElement | null = null;

    constructor(container: HTMLElement, logger: Logger, props: FileUploaderProps) {
        this.container = container;
        this.logger = logger;
        this.props = {
            maxFileSize: 100 * 1024 * 1024, // 100MB
            allowedTypes: [],
            showStats: true,
            ...props
        };
        this.render();
        this.setupEventListeners();
    }

    private render(): void {
        const { connected, currentPath, showStats } = this.props;
        const uploadingFiles = this.fileList.filter(f => f.status === 'uploading').length;
        const completedCount = this.fileList.filter(f => f.status === 'success').length;
        const errorCount = this.fileList.filter(f => f.status === 'error').length;
        const overallProgress = this.calculateOverallProgress();

        this.container.innerHTML = `
            <div class="file-uploader-card" style="border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background);">
                <div class="uploader-header" style="padding: 16px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600; color: var(--vscode-foreground);">文件上传</span>
                    ${uploadingFiles > 0 ? `
                        <span class="badge badge-warning" style="padding: 4px 12px; border-radius: 12px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 12px;">
                            正在上传 ${uploadingFiles} 个文件
                        </span>
                    ` : ''}
                </div>

                <div class="upload-area" style="padding: 20px; margin: 20px; border: 2px dashed var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background); text-align: center; transition: all 0.3s;">
                    <div class="upload-content" style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
                        <div style="font-size: 48px; color: var(--vscode-button-background);">📤</div>
                        <div style="color: var(--vscode-foreground);">
                            <p style="margin: 0 0 8px 0; font-size: 16px;">
                                ${connected ? '将文件拖拽到此处，或' : '请先连接到服务器'}
                                ${connected ? '<span style="color: var(--vscode-button-background); cursor: pointer;" id="upload-click-text">点击上传</span>' : ''}
                            </p>
                            ${connected ? `
                                <p style="margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground);">
                                    支持多文件同时上传，最大单文件 ${formatFileSize(this.props.maxFileSize || 100 * 1024 * 1024)}
                                </p>
                                <p style="margin: 4px 0 0 0; font-size: 12px; color: var(--vscode-descriptionForeground);">
                                    目标目录: ${currentPath}
                                </p>
                            ` : ''}
                        </div>
                    </div>
                    <input type="file" id="file-upload-input" multiple style="display: none;" ${connected ? '' : 'disabled'}>
                </div>

                ${this.fileList.length > 0 ? `
                    <div class="file-list" style="margin: 0 20px 20px 20px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background); overflow: hidden;">
                        <div class="list-header" style="padding: 16px; background: var(--vscode-list-hoverBackground); border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-weight: 500; color: var(--vscode-foreground);">待上传文件 (${this.fileList.length})</span>
                            <div style="display: flex; gap: 8px;">
                                <button class="btn btn-secondary" id="upload-clear-all" ${this.uploading ? 'disabled' : ''} style="padding: 6px 12px; font-size: 12px;">
                                    清空
                                </button>
                                <button class="btn btn-primary" id="upload-start" ${!connected || this.uploading || this.fileList.length === 0 ? 'disabled' : ''} style="padding: 6px 12px; font-size: 12px;">
                                    ${this.uploading ? '上传中...' : '开始上传'}
                                </button>
                            </div>
                        </div>

                        <div class="file-items" style="max-height: 400px; overflow-y: auto;">
                            ${this.fileList.map((file, index) => `
                                <div class="file-item ${file.status}" style="padding: 12px 16px; border-bottom: 1px solid var(--vscode-panel-border); transition: all 0.3s;">
                                    <div class="file-info" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: ${file.status === 'uploading' || file.status === 'success' || file.status === 'error' ? '8px' : '0'};">
                                        <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
                                            <span style="font-size: 20px;">
                                                ${file.status === 'uploading' ? '⏳' : file.status === 'success' ? '✅' : file.status === 'error' ? '❌' : '📄'}
                                            </span>
                                            <div style="flex: 1; min-width: 0;">
                                                <div class="file-name" style="font-weight: 500; color: var(--vscode-foreground); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escapeHtml(file.name)}">
                                                    ${this.escapeHtml(file.name)}
                                                </div>
                                                <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">
                                                    ${formatFileSize(file.size)}
                                                </div>
                                            </div>
                                        </div>
                                        ${file.status !== 'uploading' ? `
                                            <button class="btn btn-danger btn-circle btn-small" data-index="${index}" style="padding: 4px; width: 28px; height: 28px; font-size: 14px;" title="删除">
                                                🗑
                                            </button>
                                        ` : ''}
                                    </div>

                                    ${file.status === 'uploading' || file.status === 'success' ? `
                                        <div class="progress-section" style="margin-top: 8px;">
                                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                                <div style="flex: 1; height: 6px; background: var(--vscode-scrollbar-shadow); border-radius: 3px; overflow: hidden;">
                                                    <div style="width: ${file.progress || 0}%; height: 100%; background: ${file.status === 'success' ? 'var(--vscode-testing-iconPassed, #3ba55c)' : 'var(--vscode-button-background)'}; transition: width 0.3s;"></div>
                                                </div>
                                                <span style="font-size: 12px; color: var(--vscode-descriptionForeground); min-width: 40px; text-align: right;">${file.progress || 0}%</span>
                                            </div>
                                            ${file.status === 'uploading' ? `
                                                <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--vscode-descriptionForeground);">
                                                    <span>${formatFileSize(file.uploadedSize || 0)} / ${formatFileSize(file.size)}</span>
                                                    ${file.speed ? `<span style="color: var(--vscode-button-background); font-weight: 500;">${this.formatSpeed(file.speed)}</span>` : ''}
                                                </div>
                                            ` : `
                                                <div style="font-size: 12px; color: var(--vscode-testing-iconPassed, #3ba55c); font-weight: 500;">
                                                    上传完成
                                                </div>
                                            `}
                                        </div>
                                    ` : ''}

                                    ${file.status === 'error' ? `
                                        <div style="margin-top: 8px; padding: 8px; background: var(--vscode-testing-iconFailed, #f14c4c)20; border-radius: 4px;">
                                            <span style="font-size: 12px; color: var(--vscode-errorForeground);">
                                                ${file.errorMessage || '上传失败'}
                                            </span>
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                ${showStats && this.fileList.length > 0 ? `
                    <div class="upload-stats" style="margin: 0 20px 20px 20px; padding: 16px; background: var(--vscode-list-hoverBackground); border-radius: 8px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;">
                        <div style="text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: var(--vscode-foreground);">${this.fileList.length}</div>
                            <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 4px;">总文件数</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: var(--vscode-testing-iconPassed, #3ba55c);">${completedCount}</div>
                            <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 4px;">已完成</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: var(--vscode-testing-iconFailed, #f14c4c);">${errorCount}</div>
                            <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 4px;">失败</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: var(--vscode-button-background);">${Math.round(overallProgress)}%</div>
                            <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 4px;">总进度</div>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        this.uploadInput = this.container.querySelector('#file-upload-input') as HTMLInputElement;
    }

    private setupEventListeners(): void {
        // Upload click text
        const uploadClickText = this.container.querySelector('#upload-click-text');
        uploadClickText?.addEventListener('click', () => {
            this.uploadInput?.click();
        });

        // Upload input change
        this.uploadInput?.addEventListener('change', (e) => {
            const files = Array.from((e.target as HTMLInputElement).files || []);
            if (files.length > 0) {
                this.handleFileChange(files);
                (e.target as HTMLInputElement).value = '';
            }
        });

        // Drag and drop
        const uploadArea = this.container.querySelector('.upload-area');
        uploadArea?.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.props.connected) {
                (uploadArea as HTMLElement).style.borderColor = 'var(--vscode-button-background)';
                (uploadArea as HTMLElement).style.background = 'var(--vscode-list-hoverBackground)';
            }
        });

        uploadArea?.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            (uploadArea as HTMLElement).style.borderColor = 'var(--vscode-panel-border)';
            (uploadArea as HTMLElement).style.background = 'var(--vscode-editor-background)';
        });

        uploadArea?.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            (uploadArea as HTMLElement).style.borderColor = 'var(--vscode-panel-border)';
            (uploadArea as HTMLElement).style.background = 'var(--vscode-editor-background)';
            
            if (this.props.connected) {
                const files = Array.from(e.dataTransfer?.files || []);
                if (files.length > 0) {
                    this.handleFileChange(files);
                }
            }
        });

        // Clear all button
        this.container.querySelector('#upload-clear-all')?.addEventListener('click', () => {
            this.handleClearAll();
        });

        // Start upload button
        this.container.querySelector('#upload-start')?.addEventListener('click', () => {
            this.handleStartUpload();
        });

        // Remove file buttons
        this.container.querySelectorAll('[data-index]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt((e.currentTarget as HTMLElement).dataset.index || '0');
                this.handleRemoveFile(index);
            });
        });
    }

    private handleFileChange(files: File[]): void {
        files.forEach(file => {
            // Check file size
            if (file.size > (this.props.maxFileSize || 100 * 1024 * 1024)) {
                UIMessage.error(`文件 "${file.name}" 超过最大限制 ${formatFileSize(this.props.maxFileSize || 100 * 1024 * 1024)}`);
                return;
            }

            // Check file type
            if (this.props.allowedTypes && this.props.allowedTypes.length > 0) {
                const fileExt = file.name.split('.').pop()?.toLowerCase();
                if (!fileExt || !this.props.allowedTypes.includes(fileExt)) {
                    UIMessage.error(`不支持的文件类型 "${fileExt}"`);
                    return;
                }
            }

            // Check duplicates
            const isDuplicate = this.fileList.some(f => f.name === file.name && f.size === file.size);
            if (isDuplicate) {
                UIMessage.warning(`文件 "${file.name}" 已存在`);
                return;
            }

            // Add to list
            const extendedFile: ExtendedFile = {
                uid: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                name: file.name,
                size: file.size,
                file: file,
                status: 'waiting'
            };

            this.fileList.push(extendedFile);
            UIMessage.success(`已添加文件 "${file.name}"`);
        });

        this.render();
        this.setupEventListeners();
    }

    private async handleClearAll(): Promise<void> {
        const hasUploading = this.fileList.some(f => f.status === 'uploading');
        if (hasUploading) {
            UIMessage.warning('存在正在上传的文件，无法清空');
            return;
        }

        if (this.fileList.length === 0) return;

        try {
            const confirmed = await UIMessageBox.confirm({
                title: '确认清空',
                message: '确定要清空所有文件吗？',
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type: 'warning'
            });

            if (confirmed) {
                this.fileList = [];
                this.render();
                this.setupEventListeners();
                UIMessage.success('已清空文件列表');
            }
        } catch {
            // User cancelled
        }
    }

    private handleRemoveFile(index: number): void {
        const file = this.fileList[index];
        if (file.status === 'uploading') {
            UIMessage.warning('无法删除正在上传的文件');
            return;
        }

        this.fileList.splice(index, 1);
        this.render();
        this.setupEventListeners();
        UIMessage.info(`已移除文件 "${file.name}"`);
    }

    private async handleStartUpload(): Promise<void> {
        if (!this.props.connected) {
            UIMessage.error('未连接到服务器');
            return;
        }

        const waitingFiles = this.fileList.filter(f => f.status === 'waiting' || f.status === 'error');
        if (waitingFiles.length === 0) {
            UIMessage.warning('没有待上传的文件');
            return;
        }

        this.uploading = true;
        this.onUploadStart?.(waitingFiles);
        const results: Array<{ file: File; success: boolean; error?: string }> = [];

        try {
            for (const fileItem of waitingFiles) {
                try {
                    fileItem.status = 'uploading';
                    fileItem.progress = 0;
                    fileItem.uploadedSize = 0;
                    fileItem.errorMessage = '';
                    fileItem.startTime = Date.now();
                    fileItem.lastUpdateTime = Date.now();
                    fileItem.lastUploadedSize = 0;
                    this.render();
                    this.setupEventListeners();

                    if (this.onUpload) {
                        await this.onUpload(fileItem.file, this.props.currentPath, (progress: FileProgress) => {
                            const now = Date.now();
                            const timeDiff = (now - (fileItem.lastUpdateTime || now)) / 1000;

                            if (timeDiff > 0.1) {
                                const bytesUploaded = progress.loaded - (fileItem.lastUploadedSize || 0);
                                fileItem.speed = Math.round(bytesUploaded / timeDiff);
                                fileItem.lastUpdateTime = now;
                                fileItem.lastUploadedSize = progress.loaded;
                            }

                            fileItem.progress = progress.percent;
                            fileItem.uploadedSize = progress.loaded;
                            this.render();
                            this.setupEventListeners();
                        });
                    }

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

                this.render();
                this.setupEventListeners();
            }

            this.onUploadComplete?.(results);

            const successCount = results.filter(r => r.success).length;
            const errorCount = results.filter(r => !r.success).length;

            if (errorCount === 0) {
                UIMessage.success(`所有文件上传完成 (${successCount} 个)`);
            } else {
                UIMessage.warning(`上传完成: 成功 ${successCount} 个，失败 ${errorCount} 个`);
            }
        } finally {
            this.uploading = false;
            this.render();
            this.setupEventListeners();
        }
    }

    private calculateOverallProgress(): number {
        if (this.fileList.length === 0) return 0;

        const totalProgress = this.fileList.reduce((sum, file) => {
            if (file.status === 'success') return sum + 100;
            if (file.status === 'uploading') return sum + (file.progress || 0);
            return sum;
        }, 0);

        return totalProgress / this.fileList.length;
    }

    private formatSpeed(bytesPerSecond: number): string {
        if (bytesPerSecond < 1024) {
            return `${bytesPerSecond} B/s`;
        } else if (bytesPerSecond < 1024 * 1024) {
            return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
        } else {
            return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Public methods
    addFiles(files: File[]): void {
        this.handleFileChange(files);
    }

    clearFiles(): void {
        this.fileList = [];
        this.render();
        this.setupEventListeners();
    }

    startUpload(): void {
        this.handleStartUpload();
    }

    updateProps(props: Partial<FileUploaderProps>): void {
        this.props = { ...this.props, ...props };
        this.render();
        this.setupEventListeners();
    }
}
