// Native JS FilePreview component - replaces FilePreview.vue
import { Logger } from '@shared/utils/Logger';
import type { FileItem } from '@shared/types';
import { formatFileSize, getFileExtension } from '../utils/fileUtils';

interface FilePreviewState {
    fileItem: FileItem | null;
    content: string;
    loading: boolean;
    error: string;
}

export class FilePreview {
    private container: HTMLElement;
    private logger: Logger;
    
    public onDownload?: (file: FileItem) => void;
    public onRefresh?: (file: FileItem) => void;

    constructor(container: HTMLElement, logger: Logger) {
        this.container = container;
        this.logger = logger;
    }

    update(state: FilePreviewState): void {
        const { fileItem, content, loading, error } = state;

        if (loading) {
            this.container.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; padding: 40px;">
                    <div class="loading"></div>
                    <span style="margin-left: 12px;">正在加载文件内容...</span>
                </div>
            `;
            return;
        }

        if (error) {
            this.container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; text-align: center;">
                    <div style="font-size: 48px; color: var(--vscode-errorForeground, #f48771); margin-bottom: 20px;">⚠️</div>
                    <div style="color: var(--vscode-errorForeground, #f48771); font-size: 18px; font-weight: 600; margin-bottom: 12px;">加载失败</div>
                    <div style="color: var(--vscode-foreground, #cccccc); font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
                        ${this.escapeHtml(error)}
                    </div>
                    ${fileItem ? `
                        <button class="btn btn-primary" id="preview-retry-btn" style="margin-top: 10px;">
                            重试
                        </button>
                    ` : ''}
                </div>
            `;

            if (fileItem) {
                const retryBtn = this.container.querySelector('#preview-retry-btn');
                retryBtn?.addEventListener('click', () => {
                    if (this.onRefresh && fileItem) {
                        this.onRefresh(fileItem);
                    }
                });
            }
            return;
        }

        if (!content) {
            this.container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 20px;">📄</div>
                    <div style="color: var(--vscode-foreground, #cccccc); font-size: 14px;">文件内容为空</div>
                </div>
            `;
            return;
        }

        // 显示文件信息
        const fileExtension = fileItem ? getFileExtension(fileItem.name) : '';
        const lineCount = content.split('\n').length;
        const charCount = content.length;
        const languageClass = this.getLanguageClass(fileExtension);

        this.container.innerHTML = `
            <div style="display: flex; flex-direction: column; height: 100%;">
                <div style="padding: 16px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background);">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                        <span style="font-size: 18px;">📄</span>
                        <span style="font-weight: 600; color: var(--vscode-editor-foreground);">${fileItem ? this.escapeHtml(fileItem.name) : '文件预览'}</span>
                        ${fileExtension ? `<span class="badge badge-info" style="padding: 2px 8px; border-radius: 4px; background: var(--vscode-badge-background, #4a9eff); color: var(--vscode-badge-foreground, #fff); font-size: 11px;">${fileExtension.toUpperCase()}</span>` : ''}
                        ${fileItem ? `<span style="color: var(--vscode-descriptionForeground, #858585); font-size: 12px;">${formatFileSize(fileItem.size)}</span>` : ''}
                    </div>
                    <div style="display: flex; gap: 16px; color: var(--vscode-descriptionForeground, #858585); font-size: 12px;">
                        <span>行数: ${lineCount}</span>
                        <span>字符数: ${charCount}</span>
                        <span>大小: ${formatFileSize(content.length)}</span>
                    </div>
                </div>
                <div style="flex: 1; overflow: auto; padding: 16px; background: var(--vscode-textCodeBlock-background, #1e1e1e);">
                    <pre class="file-content ${languageClass}" style="margin: 0; padding: 0; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.6; color: var(--vscode-editor-foreground); white-space: pre-wrap; word-wrap: break-word;"><code>${this.escapeHtml(content)}</code></pre>
                </div>
            </div>
        `;

        // 自动滚动到顶部
        const contentElement = this.container.querySelector('.file-content');
        if (contentElement) {
            contentElement.scrollTop = 0;
        }
    }

    private getLanguageClass(ext: string): string {
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
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
