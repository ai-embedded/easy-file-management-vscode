// Native JS FtpPerformanceMonitor component - replaces FtpPerformanceMonitor.vue
// Simplified but functionally complete implementation
import { Logger } from '@shared/utils/Logger';
import { ftpPerformanceService, type PerformanceEvent } from '../services/FtpPerformanceService';
import { UIMessage } from '../utils/uiUtils';
import { formatFileSize } from '../utils/fileUtils';

export class FtpPerformanceMonitor {
    private container: HTMLElement;
    private logger: Logger;
    private isMonitoring = true;
    private refreshing = false;
    private logLevel = 'all';
    private speedTrend = 0;
    private monitoringInterval: number | null = null;

    // Current stats
    private currentStats = {
        transferSpeed: 0,
        activeConnections: 0,
        maxConnections: 3,
        successRate: 98.5,
        totalTransfers: 156,
        totalDataTransferred: 2048 * 1024 * 1024
    };

    // Pool stats
    private poolStats = {
        poolSize: 5,
        idleConnections: 3,
        waitingQueue: 0,
        reuseCount: 89
    };

    // Optimization stats
    private optimizationStats = {
        standardImprovement: 25,
        extendedImprovement: 45,
        connectionReuseSavings: 350,
        cacheHitRate: 78,
        compressionSavings: 512 * 1024 * 1024
    };

    // Error stats
    private errorStats = {
        networkErrors: 3,
        timeoutErrors: 1,
        authErrors: 0,
        retrySuccesses: 12,
        maxRetries: 3
    };

    // Server stats
    private serverStats = {
        responseTime: 125,
        serverLoad: 45,
        supportedFeatures: ['PASV', 'EPSV', 'REST', 'SIZE', 'MLSD'],
        detectionReliability: 4.5
    };

    // Logs
    private logs: Array<{ id: number; timestamp: number; level: string; message: string }> = [];
    private logIdCounter = 1;

    constructor(container: HTMLElement, logger: Logger) {
        this.container = container;
        this.logger = logger;
        this.startMonitoring();
        this.render();
        this.setupEventListeners();
    }

    private startMonitoring(): void {
        if (this.monitoringInterval) return;

        ftpPerformanceService.startMonitoring(2000);

        ftpPerformanceService.on('metricsUpdated', (metrics: any) => {
            this.updateStatsFromService(metrics);
        });

        ftpPerformanceService.on('transferEvent', (event: PerformanceEvent) => {
            this.addEventToLog(event);
        });

        ftpPerformanceService.on('connectionEvent', (event: PerformanceEvent) => {
            this.addEventToLog(event);
        });

        ftpPerformanceService.on('optimizationEvent', (event: PerformanceEvent) => {
            this.addEventToLog(event);
        });

        this.updateStatsFromService();
        this.loadRecentEvents();

        this.monitoringInterval = window.setInterval(() => {
            this.updateStatsFromService();
        }, 2000);
    }

    private stopMonitoring(): void {
        if (this.monitoringInterval) {
            window.clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        ftpPerformanceService.stopMonitoring();
        ftpPerformanceService.off('metricsUpdated', this.updateStatsFromService);
        ftpPerformanceService.off('transferEvent', this.addEventToLog);
        ftpPerformanceService.off('connectionEvent', this.addEventToLog);
        ftpPerformanceService.off('optimizationEvent', this.addEventToLog);
    }

    private updateStatsFromService(metrics?: any): void {
        const summary = ftpPerformanceService.getPerformanceSummary();

        if (summary.current) {
            const oldSpeed = this.currentStats.transferSpeed;
            this.currentStats.transferSpeed = summary.current.transferSpeed;
            this.currentStats.activeConnections = summary.current.activeConnections;
            this.currentStats.maxConnections = summary.current.maxConnections;
            this.currentStats.successRate = summary.current.successRate;
            this.currentStats.totalTransfers = summary.current.totalTransfers;
            this.currentStats.totalDataTransferred = summary.current.totalDataTransferred;

            if (oldSpeed > 0) {
                this.speedTrend = ((this.currentStats.transferSpeed - oldSpeed) / oldSpeed) * 100;
            }
        }

        const connectionMetrics = ftpPerformanceService.getConnectionPoolMetrics();
        Object.assign(this.poolStats, connectionMetrics);

        const optimizationMetrics = ftpPerformanceService.getOptimizationMetrics();
        Object.assign(this.optimizationStats, optimizationMetrics);

        const errorMetrics = ftpPerformanceService.getErrorMetrics();
        Object.assign(this.errorStats, errorMetrics);

        const serverMetrics = ftpPerformanceService.getServerMetrics();
        Object.assign(this.serverStats, serverMetrics);

        this.render();
        this.setupEventListeners();
    }

    private addEventToLog(event: PerformanceEvent): void {
        this.logs.unshift({
            id: this.logIdCounter++,
            timestamp: event.timestamp,
            level: event.level,
            message: event.message
        });

        if (this.logs.length > 50) {
            this.logs = this.logs.slice(0, 50);
        }

        this.render();
        this.setupEventListeners();
    }

    private loadRecentEvents(): void {
        const events = ftpPerformanceService.getRecentEvents(20);
        this.logs = events.map(event => ({
            id: this.logIdCounter++,
            timestamp: event.timestamp,
            level: event.level,
            message: event.message
        }));
    }

    private render(): void {
        const filteredLogs = this.logLevel === 'all' 
            ? this.logs 
            : this.logs.filter(log => log.level === this.logLevel);

        this.container.innerHTML = `
            <div class="ftp-performance-monitor" style="padding: 20px; max-width: 1400px;">
                <div class="monitor-header" style="text-align: center; margin-bottom: 30px;">
                    <h2 style="color: var(--vscode-foreground); margin-bottom: 10px; font-size: 24px;">FTP 性能监控</h2>
                    <p style="color: var(--vscode-descriptionForeground); font-size: 14px; margin-bottom: 20px;">实时监控 FTP 传输性能和优化效果</p>
                    <div style="display: flex; justify-content: center; align-items: center; gap: 15px;">
                        <label style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="monitor-toggle" ${this.isMonitoring ? 'checked' : ''}>
                            <span>${this.isMonitoring ? '监控中' : '已暂停'}</span>
                        </label>
                        <button class="btn btn-secondary" id="btn-refresh-data" ${this.refreshing ? 'disabled' : ''}>
                            🔄 ${this.refreshing ? '刷新中...' : '刷新数据'}
                        </button>
                        <button class="btn btn-secondary" id="btn-export-report">
                            📥 导出报告
                        </button>
                    </div>
                </div>

                <!-- Overview Cards -->
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px;">
                    <div class="metric-card" style="border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 20px; text-align: center; background: var(--vscode-editor-background);">
                        <div style="font-size: 28px; font-weight: bold; color: var(--vscode-button-background); margin-bottom: 5px;">
                            ${this.formatSpeed(this.currentStats.transferSpeed)}
                        </div>
                        <div style="font-size: 14px; color: var(--vscode-descriptionForeground); margin-bottom: 10px;">当前传输速度</div>
                        <div style="display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 12px; color: ${this.speedTrend > 0 ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)'};">
                            ${this.speedTrend > 0 ? '↑' : '↓'} ${Math.abs(this.speedTrend).toFixed(1)}%
                        </div>
                    </div>

                    <div class="metric-card" style="border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 20px; text-align: center; background: var(--vscode-editor-background);">
                        <div style="font-size: 28px; font-weight: bold; color: var(--vscode-button-background); margin-bottom: 5px;">
                            ${this.currentStats.activeConnections}/${this.currentStats.maxConnections}
                        </div>
                        <div style="font-size: 14px; color: var(--vscode-descriptionForeground); margin-bottom: 10px;">活动连接数</div>
                        <div style="margin-top: 10px;">
                            <div style="height: 4px; background: var(--vscode-scrollbar-shadow); border-radius: 2px; overflow: hidden;">
                                <div style="width: ${(this.currentStats.activeConnections / this.currentStats.maxConnections) * 100}%; height: 100%; background: ${this.getConnectionColor()};"></div>
                            </div>
                        </div>
                    </div>

                    <div class="metric-card" style="border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 20px; text-align: center; background: var(--vscode-editor-background);">
                        <div style="font-size: 28px; font-weight: bold; color: var(--vscode-testing-iconPassed); margin-bottom: 5px;">
                            ${this.currentStats.successRate.toFixed(1)}%
                        </div>
                        <div style="font-size: 14px; color: var(--vscode-descriptionForeground); margin-bottom: 10px;">传输成功率</div>
                        <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">
                            ✅ ${this.currentStats.totalTransfers} 次传输
                        </div>
                    </div>

                    <div class="metric-card" style="border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 20px; text-align: center; background: var(--vscode-editor-background);">
                        <div style="font-size: 28px; font-weight: bold; color: var(--vscode-button-background); margin-bottom: 5px;">
                            ${formatFileSize(this.currentStats.totalDataTransferred)}
                        </div>
                        <div style="font-size: 14px; color: var(--vscode-descriptionForeground); margin-bottom: 10px;">累计传输量</div>
                        <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">
                            📊 今日传输
                        </div>
                    </div>
                </div>

                <!-- Detailed Stats -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 30px;">
                    <div class="stats-card" style="border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background);">
                        <div class="card-header" style="padding: 15px 20px; background: var(--vscode-list-hoverBackground); border-bottom: 1px solid var(--vscode-panel-border);">
                            <h3 style="margin: 0; color: var(--vscode-foreground); font-size: 16px;">📈 优化效果统计</h3>
                        </div>
                        <div class="card-body" style="padding: 20px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                <span>标准优化提升:</span>
                                <span style="color: var(--vscode-testing-iconPassed);">+${this.optimizationStats.standardImprovement}%</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                <span>扩展功能提升:</span>
                                <span style="color: var(--vscode-button-background);">+${this.optimizationStats.extendedImprovement}%</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                <span>连接复用节省:</span>
                                <span>${this.optimizationStats.connectionReuseSavings}ms</span>
                            </div>
                            <div style="margin-bottom: 12px;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                    <span>缓存命中率:</span>
                                    <span>${this.optimizationStats.cacheHitRate}%</span>
                                </div>
                                <div style="height: 6px; background: var(--vscode-scrollbar-shadow); border-radius: 3px; overflow: hidden;">
                                    <div style="width: ${this.optimizationStats.cacheHitRate}%; height: 100%; background: ${this.getCacheColor()};"></div>
                                </div>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>压缩传输节省:</span>
                                <span>${formatFileSize(this.optimizationStats.compressionSavings)}</span>
                            </div>
                        </div>
                    </div>

                    <div class="stats-card" style="border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background);">
                        <div class="card-header" style="padding: 15px 20px; background: var(--vscode-list-hoverBackground); border-bottom: 1px solid var(--vscode-panel-border);">
                            <h3 style="margin: 0; color: var(--vscode-foreground); font-size: 16px;">⚠️ 错误和重试统计</h3>
                        </div>
                        <div class="card-body" style="padding: 20px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                <span>网络错误:</span>
                                <span style="color: var(--vscode-testing-iconQueued);">${this.errorStats.networkErrors}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                <span>超时错误:</span>
                                <span style="color: var(--vscode-testing-iconFailed);">${this.errorStats.timeoutErrors}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                <span>认证错误:</span>
                                <span style="color: var(--vscode-testing-iconFailed);">${this.errorStats.authErrors}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                <span>重试成功次数:</span>
                                <span style="color: var(--vscode-testing-iconPassed);">${this.errorStats.retrySuccesses}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>最大重试次数:</span>
                                <span>${this.errorStats.maxRetries}</span>
                            </div>
                        </div>
                    </div>

                    <div class="stats-card" style="border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background);">
                        <div class="card-header" style="padding: 15px 20px; background: var(--vscode-list-hoverBackground); border-bottom: 1px solid var(--vscode-panel-border);">
                            <h3 style="margin: 0; color: var(--vscode-foreground); font-size: 16px;">🖥️ 服务器性能指标</h3>
                        </div>
                        <div class="card-body" style="padding: 20px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                <span>响应延迟:</span>
                                <span>${this.serverStats.responseTime}ms</span>
                            </div>
                            <div style="margin-bottom: 12px;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                    <span>服务器负载:</span>
                                    <span>${this.serverStats.serverLoad.toFixed(0)}%</span>
                                </div>
                                <div style="height: 6px; background: var(--vscode-scrollbar-shadow); border-radius: 3px; overflow: hidden;">
                                    <div style="width: ${this.serverStats.serverLoad}%; height: 100%; background: ${this.getServerLoadColor()};"></div>
                                </div>
                            </div>
                            <div style="margin-bottom: 12px;">
                                <div style="margin-bottom: 8px;">支持的功能:</div>
                                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                                    ${this.serverStats.supportedFeatures.map(f => `
                                        <span style="padding: 2px 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; font-size: 11px;">${f}</span>
                                    `).join('')}
                                </div>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>检测可靠度:</span>
                                <span>${this.serverStats.detectionReliability.toFixed(1)}/5</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Logs -->
                <div class="log-section" style="border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background);">
                    <div class="log-header" style="padding: 15px 20px; background: var(--vscode-list-hoverBackground); border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: var(--vscode-foreground); font-size: 16px;">📋 实时日志</h3>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <select id="log-level-filter" style="padding: 6px 12px; font-size: 12px;">
                                <option value="all" ${this.logLevel === 'all' ? 'selected' : ''}>全部</option>
                                <option value="error" ${this.logLevel === 'error' ? 'selected' : ''}>错误</option>
                                <option value="warn" ${this.logLevel === 'warn' ? 'selected' : ''}>警告</option>
                                <option value="info" ${this.logLevel === 'info' ? 'selected' : ''}>信息</option>
                            </select>
                            <button class="btn btn-secondary" id="btn-clear-logs" style="padding: 6px 12px; font-size: 12px;">
                                清空日志
                            </button>
                        </div>
                    </div>
                    <div class="log-container" style="max-height: 300px; overflow-y: auto; padding: 8px; font-family: 'Consolas', 'Monaco', monospace; font-size: 12px;">
                        ${filteredLogs.length === 0 ? `
                            <div style="text-align: center; padding: 40px; color: var(--vscode-descriptionForeground);">
                                暂无日志
                            </div>
                        ` : filteredLogs.map(log => `
                            <div class="log-entry log-${log.level}" style="display: flex; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); background: ${this.getLogBackground(log.level)};">
                                <span style="color: var(--vscode-descriptionForeground); margin-right: 10px; min-width: 80px;">
                                    ${this.formatTime(log.timestamp)}
                                </span>
                                <span style="font-weight: bold; margin-right: 10px; min-width: 50px; color: ${this.getLogLevelColor(log.level)};">
                                    ${log.level.toUpperCase()}
                                </span>
                                <span style="flex: 1; color: var(--vscode-foreground);">
                                    ${this.escapeHtml(log.message)}
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    private setupEventListeners(): void {
        // Monitor toggle
        const toggle = this.container.querySelector('#monitor-toggle') as HTMLInputElement;
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                this.isMonitoring = (e.target as HTMLInputElement).checked;
                if (this.isMonitoring) {
                    this.startMonitoring();
                } else {
                    this.stopMonitoring();
                }
                this.render();
                this.setupEventListeners();
            });
        }

        // Refresh button
        this.container.querySelector('#btn-refresh-data')?.addEventListener('click', () => this.handleRefreshData());

        // Export button
        this.container.querySelector('#btn-export-report')?.addEventListener('click', () => this.handleExportReport());

        // Log level filter
        const logLevelFilter = this.container.querySelector('#log-level-filter') as HTMLSelectElement;
        if (logLevelFilter) {
            logLevelFilter.addEventListener('change', (e) => {
                this.logLevel = (e.target as HTMLSelectElement).value;
                this.render();
                this.setupEventListeners();
            });
        }

        // Clear logs button
        this.container.querySelector('#btn-clear-logs')?.addEventListener('click', () => this.handleClearLogs());
    }

    private async handleRefreshData(): Promise<void> {
        this.refreshing = true;
        this.render();
        this.setupEventListeners();

        try {
            this.updateStatsFromService();
            this.loadRecentEvents();
            UIMessage.success('数据刷新完成');
        } catch (error) {
            UIMessage.error('数据刷新失败');
        } finally {
            this.refreshing = false;
            this.render();
            this.setupEventListeners();
        }
    }

    private handleExportReport(): void {
        try {
            const report = ftpPerformanceService.generateReport(24);
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ftp-performance-report-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            UIMessage.success('性能报告已导出');
        } catch (error) {
            UIMessage.error('报告生成失败');
            this.logger.error('Report generation failed', error);
        }
    }

    private handleClearLogs(): void {
        ftpPerformanceService.clearHistory();
        this.logs = [];
        this.render();
        this.setupEventListeners();
        UIMessage.success('日志已清空');
    }

    private formatSpeed(speed: number): string {
        if (speed < 1024) return `${speed.toFixed(0)} B/s`;
        if (speed < 1024 * 1024) return `${(speed / 1024).toFixed(1)} KB/s`;
        return `${(speed / (1024 * 1024)).toFixed(1)} MB/s`;
    }

    private formatTime(timestamp: number): string {
        return new Date(timestamp).toLocaleTimeString('zh-CN');
    }

    private getConnectionColor(): string {
        const ratio = this.currentStats.activeConnections / this.currentStats.maxConnections;
        if (ratio < 0.5) return 'var(--vscode-testing-iconPassed, #3ba55c)';
        if (ratio < 0.8) return 'var(--vscode-testing-iconQueued, #dcb67a)';
        return 'var(--vscode-testing-iconFailed, #f14c4c)';
    }

    private getCacheColor(): string {
        if (this.optimizationStats.cacheHitRate >= 80) return 'var(--vscode-testing-iconPassed, #3ba55c)';
        if (this.optimizationStats.cacheHitRate >= 60) return 'var(--vscode-testing-iconQueued, #dcb67a)';
        return 'var(--vscode-testing-iconFailed, #f14c4c)';
    }

    private getServerLoadColor(): string {
        if (this.serverStats.serverLoad < 50) return 'var(--vscode-testing-iconPassed, #3ba55c)';
        if (this.serverStats.serverLoad < 80) return 'var(--vscode-testing-iconQueued, #dcb67a)';
        return 'var(--vscode-testing-iconFailed, #f14c4c)';
    }

    private getLogLevelColor(level: string): string {
        switch (level) {
            case 'error': return 'var(--vscode-errorForeground, #f48771)';
            case 'warn': return 'var(--vscode-testing-iconQueued, #dcb67a)';
            case 'info': return 'var(--vscode-button-background)';
            default: return 'var(--vscode-foreground)';
        }
    }

    private getLogBackground(level: string): string {
        switch (level) {
            case 'error': return 'rgba(241, 76, 76, 0.1)';
            case 'warn': return 'rgba(220, 182, 122, 0.1)';
            case 'info': return 'transparent';
            default: return 'transparent';
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    dispose(): void {
        this.stopMonitoring();
    }
}
