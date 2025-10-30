// Native JS StatusBar component - replaces StatusBar.vue
import { Logger } from '@shared/utils/Logger';
import { ConnectionStatus } from '@shared/types';
import { formatFileSize } from '../utils/fileUtils';

interface StatusBarState {
    connectionStatus: ConnectionStatus;
    serverInfo?: string;
    currentPath: string;
    currentOperation: string;
    operationInProgress: boolean;
    operationProgress: number | null;
    operationSpeed: number | null;
    operationDirection: 'upload' | 'download' | null;
    operationTransport: string | null;
    operationCancelable: boolean;
    fileStats?: {
        totalFiles: number;
        totalDirectories: number;
        totalSize: number;
    };
    networkStats?: {
        uploadSpeed: number;
        downloadSpeed: number;
        latency: number;
    };
}

export class StatusBar {
    private container: HTMLElement;
    private logger: Logger;
    private timeInterval: number | null = null;
    
    public onCancelOperation?: () => void;

    constructor(container: HTMLElement, logger: Logger) {
        this.container = container;
        this.logger = logger;
        this.startTimeUpdate();
    }

    update(state: StatusBarState): void {
        const {
            connectionStatus,
            serverInfo,
            currentPath,
            currentOperation,
            operationInProgress,
            operationProgress,
            operationSpeed,
            operationDirection,
            operationTransport,
            operationCancelable,
            fileStats,
            networkStats
        } = state;

        const connectionStatusText = this.getConnectionStatusText(connectionStatus);
        const connectionStatusIcon = this.getConnectionStatusIcon(connectionStatus);
        const currentTime = this.getCurrentTime();

        const sections: string[] = [];

        // 左侧：连接状态和路径
        const leftSection: string[] = [];
        leftSection.push(`<div class="status-item" style="display: flex; align-items: center; gap: 6px;">
            <span>${connectionStatusIcon}</span>
            <span>${connectionStatusText}</span>
            ${serverInfo ? `<span style="color: var(--vscode-descriptionForeground, #858585);">${this.escapeHtml(serverInfo)}</span>` : ''}
        </div>`);

        if (currentPath) {
            leftSection.push(`<div class="status-item" style="display: flex; align-items: center; gap: 6px;">
                <span>📁</span>
                <span style="color: var(--vscode-descriptionForeground, #858585); font-size: 12px;">${this.escapeHtml(currentPath)}</span>
            </div>`);
        }

        sections.push(`<div class="status-section" style="display: flex; align-items: center; gap: 16px;">${leftSection.join('')}</div>`);

        // 中间：操作状态
        if (currentOperation && operationInProgress) {
            const progressText = operationProgress !== null ? ` ${operationProgress}%` : '';
            const speedText = operationSpeed !== null ? ` | ${this.formatTransferRate(operationSpeed)}` : '';
            const transportText = operationTransport ? ` [${operationTransport}]` : '';
            const directionSymbol = operationDirection === 'upload' ? '⬆' : operationDirection === 'download' ? '⬇' : '';

            sections.push(`<div class="status-section" style="display: flex; align-items: center; gap: 8px;">
                <div class="status-item" style="display: flex; align-items: center; gap: 6px;">
                    <span class="loading" style="display: inline-block; width: 12px; height: 12px;"></span>
                    <span>${directionSymbol} ${this.escapeHtml(currentOperation)}${progressText}${speedText}${transportText}</span>
                </div>
            </div>`);
        }

        // 右侧：文件统计、网络状态、时间、取消按钮
        const rightSection: string[] = [];

        if (operationCancelable && operationInProgress) {
            rightSection.push(`<div class="status-item" style="cursor: pointer; padding: 4px 8px; border-radius: 4px;" id="status-cancel-btn" title="停止传输">
                <span style="display: inline-block; width: 8px; height: 8px; background: var(--vscode-errorForeground, #f48771); border-radius: 50%; margin-right: 4px;"></span>
                <span>停止</span>
            </div>`);
        }

        if (fileStats) {
            rightSection.push(`<div class="status-item" style="display: flex; align-items: center; gap: 6px;">
                <span>📄</span>
                <span style="color: var(--vscode-descriptionForeground, #858585); font-size: 12px;">
                    ${fileStats.totalFiles} 个项目
                    ${fileStats.totalSize > 0 ? ` (${formatFileSize(fileStats.totalSize)})` : ''}
                </span>
            </div>`);
        }

        if (networkStats) {
            rightSection.push(`<div class="status-item" style="display: flex; align-items: center; gap: 6px;">
                <span>📡</span>
                <span style="color: var(--vscode-descriptionForeground, #858585); font-size: 12px;">
                    ↑${this.formatTransferRate(networkStats.uploadSpeed, true)}
                    ↓${this.formatTransferRate(networkStats.downloadSpeed, true)}
                </span>
            </div>`);
        }

        rightSection.push(`<div class="status-item" style="color: var(--vscode-descriptionForeground, #858585); font-size: 12px;">
            🕐 ${currentTime}
        </div>`);

        sections.push(`<div class="status-section" style="display: flex; align-items: center; gap: 16px;">${rightSection.join('')}</div>`);

        this.container.innerHTML = `
            <div class="status-bar" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-statusBar-background, #007acc); color: var(--vscode-statusBar-foreground, #ffffff); font-size: 12px;">
                ${sections.join('')}
            </div>
        `;

        // 设置取消按钮事件
        const cancelBtn = this.container.querySelector('#status-cancel-btn');
        if (cancelBtn && this.onCancelOperation) {
            cancelBtn.addEventListener('click', () => {
                if (this.onCancelOperation) {
                    this.onCancelOperation();
                }
            });
        }
    }

    private getConnectionStatusText(status: ConnectionStatus): string {
        switch (status) {
            case ConnectionStatus.CONNECTED:
                return '已连接';
            case ConnectionStatus.CONNECTING:
                return '连接中...';
            case ConnectionStatus.ERROR:
                return '连接错误';
            case ConnectionStatus.DISCONNECTED:
            default:
                return '未连接';
        }
    }

    private getConnectionStatusIcon(status: ConnectionStatus): string {
        switch (status) {
            case ConnectionStatus.CONNECTED:
                return '🟢';
            case ConnectionStatus.CONNECTING:
                return '🟡';
            case ConnectionStatus.ERROR:
                return '🔴';
            case ConnectionStatus.DISCONNECTED:
            default:
                return '⚪';
        }
    }

    private formatTransferRate(bytesPerSecond: number, short: boolean = false): string {
        if (bytesPerSecond === 0) return '0 B/s';
        
        const k = 1024;
        const sizes = short ? ['B', 'K', 'M', 'G'] : ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
        
        return `${parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
    }

    private getCurrentTime(): string {
        const now = new Date();
        return now.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    private startTimeUpdate(): void {
        this.timeInterval = window.setInterval(() => {
            // 时间会在 update 时刷新，这里不需要单独更新
        }, 1000);
    }

    private stopTimeUpdate(): void {
        if (this.timeInterval !== null) {
            window.clearInterval(this.timeInterval);
            this.timeInterval = null;
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    dispose(): void {
        this.stopTimeUpdate();
    }
}
