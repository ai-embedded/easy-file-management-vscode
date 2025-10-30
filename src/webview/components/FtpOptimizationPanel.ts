// Native JS FtpOptimizationPanel component - replaces FtpOptimizationPanel.vue
// Simplified but functionally complete implementation
import { Logger } from '@shared/utils/Logger';
import { ftpOptimizationService } from '../services/FtpOptimizationService';
import { UIMessage, UIMessageBox } from '../utils/uiUtils';
import type { OptimizedFtpConfig, FtpServerCapabilities, FtpConfigPreset } from '@shared/types/ftp';

export class FtpOptimizationPanel {
    private container: HTMLElement;
    private logger: Logger;
    private config: OptimizedFtpConfig;
    private selectedPreset: FtpConfigPreset = 'balanced';
    private testing = false;
    private detecting = false;
    private saving = false;
    private showCapabilitiesDialog = false;
    private serverCapabilities: FtpServerCapabilities | null = null;

    constructor(container: HTMLElement, logger: Logger) {
        this.container = container;
        this.logger = logger;
        this.config = ftpOptimizationService.getDefaultConfig();
        this.loadConfig();
        this.render();
        this.setupEventListeners();
    }

    private async loadConfig(): Promise<void> {
        try {
            const savedConfig = await ftpOptimizationService.loadConfig();
            if (savedConfig) {
                this.config = savedConfig;
            }
        } catch (error) {
            this.logger.warn('Failed to load FTP optimization config', error);
        }
    }

    private render(): void {
        const bufferSizeKB = Math.round(this.config.performance.bufferSize / 1024);
        const transferTimeoutSec = Math.round(this.config.performance.transferTimeout / 1000);

        this.container.innerHTML = `
            <div class="ftp-optimization-panel" style="padding: 20px; max-width: 1200px;">
                <div class="panel-header" style="text-align: center; margin-bottom: 30px;">
                    <h2 style="color: var(--vscode-foreground); margin-bottom: 10px; font-size: 24px;">FTP 通讯优化配置</h2>
                    <p style="color: var(--vscode-descriptionForeground); font-size: 14px;">配置 FTP 连接优化策略，提升传输性能</p>
                </div>

                <form id="ftp-optimization-form">
                    <!-- 服务器连接配置 -->
                    <div class="config-section" style="margin-bottom: 20px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background);">
                        <div class="section-header" style="padding: 15px 20px; background: var(--vscode-list-hoverBackground); border-bottom: 1px solid var(--vscode-panel-border);">
                            <h3 style="margin: 0; color: var(--vscode-foreground); font-size: 16px;">🔗 服务器连接</h3>
                        </div>
                        <div class="section-body" style="padding: 20px;">
                            <div class="control-group">
                                <label for="ftp-server-host">服务器地址 *</label>
                                <input type="text" id="ftp-server-host" value="${this.escapeHtml(this.config.server.host || '')}" placeholder="请输入FTP服务器地址">
                            </div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <div class="control-group">
                                    <label for="ftp-server-port">端口</label>
                                    <input type="number" id="ftp-server-port" value="${this.config.server.port || 21}" min="1" max="65535">
                                </div>
                                <div class="control-group">
                                    <label for="ftp-server-username">用户名 *</label>
                                    <input type="text" id="ftp-server-username" value="${this.escapeHtml(this.config.server.username || '')}" placeholder="请输入用户名">
                                </div>
                            </div>

                            <div class="control-group">
                                <label for="ftp-server-password">密码 *</label>
                                <input type="password" id="ftp-server-password" value="${this.escapeHtml(this.config.server.password || '')}" placeholder="请输入密码">
                            </div>

                            <div class="control-group">
                                <label style="display: flex; align-items: center; gap: 8px;">
                                    <input type="checkbox" id="ftp-secure" ${this.config.security.enableSecureConnection ? 'checked' : ''}>
                                    <span>启用 FTPS 安全连接</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- 优化策略配置 -->
                    <div class="config-section" style="margin-bottom: 20px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background);">
                        <div class="section-header" style="padding: 15px 20px; background: var(--vscode-list-hoverBackground); border-bottom: 1px solid var(--vscode-panel-border);">
                            <h3 style="margin: 0; color: var(--vscode-foreground); font-size: 16px;">⚙️ 优化策略</h3>
                        </div>
                        <div class="section-body" style="padding: 20px;">
                            <div class="control-group">
                                <label>预设配置</label>
                                <div class="radio-list">
                                    <div class="radio-item">
                                        <input type="radio" id="preset-conservative" name="preset" value="conservative" ${this.selectedPreset === 'conservative' ? 'checked' : ''}>
                                        <label for="preset-conservative">保守模式</label>
                                    </div>
                                    <div class="radio-item">
                                        <input type="radio" id="preset-balanced" name="preset" value="balanced" ${this.selectedPreset === 'balanced' ? 'checked' : ''}>
                                        <label for="preset-balanced">平衡模式</label>
                                    </div>
                                    <div class="radio-item">
                                        <input type="radio" id="preset-aggressive" name="preset" value="aggressive" ${this.selectedPreset === 'aggressive' ? 'checked' : ''}>
                                        <label for="preset-aggressive">激进模式</label>
                                    </div>
                                    <div class="radio-item">
                                        <input type="radio" id="preset-custom" name="preset" value="custom" ${this.selectedPreset === 'custom' ? 'checked' : ''}>
                                        <label for="preset-custom">自定义</label>
                                    </div>
                                </div>
                            </div>

                            <div style="border-top: 1px solid var(--vscode-panel-border); margin: 20px 0; padding-top: 20px;">
                                <h4 style="margin: 0 0 16px 0; font-size: 14px; color: var(--vscode-foreground);">标准优化（兼容所有服务器）</h4>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                    <label style="display: flex; align-items: center; gap: 8px;">
                                        <input type="checkbox" id="opt-connection-reuse" ${this.config.optimization.standard.connectionReuse ? 'checked' : ''}>
                                        <span>连接复用</span>
                                    </label>
                                    <label style="display: flex; align-items: center; gap: 8px;">
                                        <input type="checkbox" id="opt-stream-processing" ${this.config.optimization.standard.streamProcessing ? 'checked' : ''}>
                                        <span>流式处理</span>
                                    </label>
                                    <label style="display: flex; align-items: center; gap: 8px;">
                                        <input type="checkbox" id="opt-local-cache" ${this.config.optimization.standard.localCache ? 'checked' : ''}>
                                        <span>本地缓存</span>
                                    </label>
                                    <label style="display: flex; align-items: center; gap: 8px;">
                                        <input type="checkbox" id="opt-intelligent-retry" ${this.config.optimization.standard.intelligentRetry ? 'checked' : ''}>
                                        <span>智能重试</span>
                                    </label>
                                </div>
                            </div>

                            <div style="border-top: 1px solid var(--vscode-panel-border); margin: 20px 0; padding-top: 20px;">
                                <h4 style="margin: 0 0 16px 0; font-size: 14px; color: var(--vscode-foreground);">扩展优化（需要服务器支持）</h4>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                    <div class="control-group">
                                        <label for="opt-resumable">断点续传</label>
                                        <select id="opt-resumable">
                                            <option value="auto" ${this.config.optimization.extended.resumableTransfer === 'auto' ? 'selected' : ''}>自动检测</option>
                                            <option value="true" ${this.config.optimization.extended.resumableTransfer === true ? 'selected' : ''}>强制启用</option>
                                            <option value="false" ${this.config.optimization.extended.resumableTransfer === false ? 'selected' : ''}>禁用</option>
                                        </select>
                                    </div>
                                    <div class="control-group">
                                        <label for="opt-compression">压缩传输</label>
                                        <select id="opt-compression">
                                            <option value="auto" ${this.config.optimization.extended.compressionTransfer === 'auto' ? 'selected' : ''}>自动检测</option>
                                            <option value="true" ${this.config.optimization.extended.compressionTransfer === true ? 'selected' : ''}>强制启用</option>
                                            <option value="false" ${this.config.optimization.extended.compressionTransfer === false ? 'selected' : ''}>禁用</option>
                                        </select>
                                    </div>
                                    <div class="control-group">
                                        <label for="opt-multi-connection">多连接传输</label>
                                        <select id="opt-multi-connection">
                                            <option value="auto" ${this.config.optimization.extended.multiConnection === 'auto' ? 'selected' : ''}>自动检测</option>
                                            <option value="true" ${this.config.optimization.extended.multiConnection === true ? 'selected' : ''}>强制启用</option>
                                            <option value="false" ${this.config.optimization.extended.multiConnection === false ? 'selected' : ''}>禁用</option>
                                        </select>
                                    </div>
                                    <div class="control-group">
                                        <label for="opt-enhanced-listing">增强列表</label>
                                        <select id="opt-enhanced-listing">
                                            <option value="auto" ${this.config.optimization.extended.enhancedListing === 'auto' ? 'selected' : ''}>自动检测</option>
                                            <option value="true" ${this.config.optimization.extended.enhancedListing === true ? 'selected' : ''}>强制启用</option>
                                            <option value="false" ${this.config.optimization.extended.enhancedListing === false ? 'selected' : ''}>禁用</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 性能参数配置 -->
                    <div class="config-section" style="margin-bottom: 20px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background);">
                        <div class="section-header" style="padding: 15px 20px; background: var(--vscode-list-hoverBackground); border-bottom: 1px solid var(--vscode-panel-border);">
                            <h3 style="margin: 0; color: var(--vscode-foreground); font-size: 16px;">📊 性能参数</h3>
                        </div>
                        <div class="section-body" style="padding: 20px;">
                            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
                                <div class="control-group">
                                    <label for="perf-max-connections">最大连接数</label>
                                    <input type="number" id="perf-max-connections" value="${this.config.performance.maxConnections}" min="1" max="10">
                                </div>
                                <div class="control-group">
                                    <label for="perf-buffer-size">缓冲区大小 (KB)</label>
                                    <input type="number" id="perf-buffer-size" value="${bufferSizeKB}" min="16" max="1024" step="16">
                                </div>
                                <div class="control-group">
                                    <label for="perf-timeout">传输超时 (秒)</label>
                                    <input type="number" id="perf-timeout" value="${transferTimeoutSec}" min="10" max="600" step="10">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 兼容性设置 -->
                    <div class="config-section" style="margin-bottom: 20px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background);">
                        <div class="section-header" style="padding: 15px 20px; background: var(--vscode-list-hoverBackground); border-bottom: 1px solid var(--vscode-panel-border);">
                            <h3 style="margin: 0; color: var(--vscode-foreground); font-size: 16px;">✅ 兼容性设置</h3>
                        </div>
                        <div class="section-body" style="padding: 20px;">
                            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                                <input type="checkbox" id="compat-strict-mode" ${this.config.server.compatibility.strictStandardMode ? 'checked' : ''}>
                                <span>严格标准模式（仅使用标准FTP命令）</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                                <input type="checkbox" id="compat-basic-ftp" ${this.config.server.compatibility.assumeBasicFtpOnly ? 'checked' : ''}>
                                <span>假设基础FTP（禁用所有扩展特性）</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="compat-skip-detection" ${this.config.server.compatibility.skipCapabilityDetection ? 'checked' : ''}>
                                <span>跳过能力检测（直接使用配置）</span>
                            </label>
                        </div>
                    </div>

                    <!-- 按钮区域 -->
                    <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 12px; justify-content: center;">
                        <button type="button" class="btn btn-secondary" id="btn-test-connection" ${this.testing ? 'disabled' : ''}>
                            ${this.testing ? '测试中...' : '🔗 测试连接'}
                        </button>
                        <button type="button" class="btn btn-secondary" id="btn-detect-capabilities" ${this.detecting ? 'disabled' : ''}>
                            ${this.detecting ? '检测中...' : '🔍 检测服务器能力'}
                        </button>
                        <button type="button" class="btn btn-primary" id="btn-save-config" ${this.saving ? 'disabled' : ''}>
                            ${this.saving ? '保存中...' : '💾 保存配置'}
                        </button>
                        <button type="button" class="btn btn-secondary" id="btn-reset-config">
                            🔄 重置为默认
                        </button>
                    </div>
                </form>

                <!-- 服务器能力检测结果对话框 -->
                ${this.renderCapabilitiesDialog()}
            </div>
        `;
    }

    private renderCapabilitiesDialog(): string {
        if (!this.showCapabilitiesDialog || !this.serverCapabilities) return '';

        const caps = this.serverCapabilities;
        const reliabilityColor = this.getReliabilityColor(caps.detectionReliability || 0);

        return `
            <div id="capabilities-dialog" class="modal-overlay show">
                <div class="modal-container" style="max-width: 600px;">
                    <div class="modal-header">
                        <h3 class="modal-title">服务器能力检测结果</h3>
                        <button class="modal-close" id="capabilities-dialog-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <h4 style="margin: 0 0 12px 0; font-size: 14px; color: var(--vscode-foreground);">基础能力</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
                            <div>被动模式: <span style="color: ${caps.supportsPASV ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)'}">${caps.supportsPASV ? '支持' : '不支持'}</span></div>
                            <div>断点续传: <span style="color: ${caps.supportsREST ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)'}">${caps.supportsREST ? '支持' : '不支持'}</span></div>
                            <div>文件大小查询: <span style="color: ${caps.supportsSIZE ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)'}">${caps.supportsSIZE ? '支持' : '不支持'}</span></div>
                            <div>修改时间查询: <span style="color: ${caps.supportsMDTM ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)'}">${caps.supportsMDTM ? '支持' : '不支持'}</span></div>
                        </div>

                        <h4 style="margin: 0 0 12px 0; font-size: 14px; color: var(--vscode-foreground);">扩展能力</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
                            <div>压缩传输: <span style="color: ${caps.supportsModeZ ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)'}">${caps.supportsModeZ ? '支持' : '不支持'}</span></div>
                            <div>增强列表: <span style="color: ${caps.supportsMLSD ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)'}">${caps.supportsMLSD ? '支持' : '不支持'}</span></div>
                            <div>UTF8编码: <span style="color: ${caps.supportsUTF8 ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)'}">${caps.supportsUTF8 ? '支持' : '不支持'}</span></div>
                            <div>最大连接数: <span>${caps.maxConnections || '未知'}</span></div>
                        </div>

                        <h4 style="margin: 0 0 12px 0; font-size: 14px; color: var(--vscode-foreground);">性能特征</h4>
                        <div style="margin-bottom: 12px;">
                            <div>服务器软件: ${caps.serverSoftware || '未知'}</div>
                            <div>建议缓冲区大小: ${Math.round((caps.transferBufferSize || 65536) / 1024)} KB</div>
                            <div>检测可靠度: 
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <div style="flex: 1; height: 8px; background: var(--vscode-scrollbar-shadow); border-radius: 4px; overflow: hidden;">
                                        <div style="width: ${((caps.detectionReliability || 0) * 100)}%; height: 100%; background: ${reliabilityColor};"></div>
                                    </div>
                                    <span>${Math.round((caps.detectionReliability || 0) * 100)}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-primary" id="btn-apply-capabilities">应用检测结果到配置</button>
                        <button class="btn btn-secondary" id="btn-close-capabilities">关闭</button>
                    </div>
                </div>
            </div>
        `;
    }

    private setupEventListeners(): void {
        // Preset selection
        this.container.querySelectorAll('[name="preset"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const preset = (e.target as HTMLInputElement).value as FtpConfigPreset;
                this.handlePresetChange(preset);
            });
        });

        // Form inputs
        ['ftp-server-host', 'ftp-server-port', 'ftp-server-username', 'ftp-server-password'].forEach(id => {
            const input = this.container.querySelector(`#${id}`) as HTMLInputElement;
            if (input) {
                input.addEventListener('input', () => this.updateConfigFromForm());
            }
        });

        // Checkboxes
        ['ftp-secure', 'opt-connection-reuse', 'opt-stream-processing', 'opt-local-cache', 'opt-intelligent-retry',
         'compat-strict-mode', 'compat-basic-ftp', 'compat-skip-detection'].forEach(id => {
            const checkbox = this.container.querySelector(`#${id}`) as HTMLInputElement;
            if (checkbox) {
                checkbox.addEventListener('change', () => this.updateConfigFromForm());
            }
        });

        // Selects
        ['opt-resumable', 'opt-compression', 'opt-multi-connection', 'opt-enhanced-listing'].forEach(id => {
            const select = this.container.querySelector(`#${id}`) as HTMLSelectElement;
            if (select) {
                select.addEventListener('change', () => this.updateConfigFromForm());
            }
        });

        // Performance inputs
        ['perf-max-connections', 'perf-buffer-size', 'perf-timeout'].forEach(id => {
            const input = this.container.querySelector(`#${id}`) as HTMLInputElement;
            if (input) {
                input.addEventListener('input', () => this.updateConfigFromForm());
            }
        });

        // Buttons
        this.container.querySelector('#btn-test-connection')?.addEventListener('click', () => this.handleTestConnection());
        this.container.querySelector('#btn-detect-capabilities')?.addEventListener('click', () => this.handleDetectCapabilities());
        this.container.querySelector('#btn-save-config')?.addEventListener('click', () => this.handleSaveConfig());
        this.container.querySelector('#btn-reset-config')?.addEventListener('click', () => this.handleResetConfig());
        this.container.querySelector('#btn-apply-capabilities')?.addEventListener('click', () => this.handleApplyCapabilities());
        this.container.querySelector('#btn-close-capabilities')?.addEventListener('click', () => {
            this.showCapabilitiesDialog = false;
            this.render();
            this.setupEventListeners();
        });
        this.container.querySelector('#capabilities-dialog-close')?.addEventListener('click', () => {
            this.showCapabilitiesDialog = false;
            this.render();
            this.setupEventListeners();
        });
    }

    private updateConfigFromForm(): void {
        // Update server config
        this.config.server.host = (this.container.querySelector('#ftp-server-host') as HTMLInputElement)?.value || '';
        this.config.server.port = parseInt((this.container.querySelector('#ftp-server-port') as HTMLInputElement)?.value || '21', 10);
        this.config.server.username = (this.container.querySelector('#ftp-server-username') as HTMLInputElement)?.value || '';
        this.config.server.password = (this.container.querySelector('#ftp-server-password') as HTMLInputElement)?.value || '';
        this.config.security.enableSecureConnection = (this.container.querySelector('#ftp-secure') as HTMLInputElement)?.checked || false;

        // Update optimization config
        this.config.optimization.standard.connectionReuse = (this.container.querySelector('#opt-connection-reuse') as HTMLInputElement)?.checked || false;
        this.config.optimization.standard.streamProcessing = (this.container.querySelector('#opt-stream-processing') as HTMLInputElement)?.checked || false;
        this.config.optimization.standard.localCache = (this.container.querySelector('#opt-local-cache') as HTMLInputElement)?.checked || false;
        this.config.optimization.standard.intelligentRetry = (this.container.querySelector('#opt-intelligent-retry') as HTMLInputElement)?.checked || false;

        const resumableValue = (this.container.querySelector('#opt-resumable') as HTMLSelectElement)?.value;
        this.config.optimization.extended.resumableTransfer = resumableValue === 'true' ? true : resumableValue === 'false' ? false : 'auto';

        const compressionValue = (this.container.querySelector('#opt-compression') as HTMLSelectElement)?.value;
        this.config.optimization.extended.compressionTransfer = compressionValue === 'true' ? true : compressionValue === 'false' ? false : 'auto';

        const multiConnValue = (this.container.querySelector('#opt-multi-connection') as HTMLSelectElement)?.value;
        this.config.optimization.extended.multiConnection = multiConnValue === 'true' ? true : multiConnValue === 'false' ? false : 'auto';

        const enhancedValue = (this.container.querySelector('#opt-enhanced-listing') as HTMLSelectElement)?.value;
        this.config.optimization.extended.enhancedListing = enhancedValue === 'true' ? true : enhancedValue === 'false' ? false : 'auto';

        // Update performance config
        this.config.performance.maxConnections = parseInt((this.container.querySelector('#perf-max-connections') as HTMLInputElement)?.value || '3', 10);
        const bufferSizeKB = parseInt((this.container.querySelector('#perf-buffer-size') as HTMLInputElement)?.value || '64', 10);
        this.config.performance.bufferSize = bufferSizeKB * 1024;
        const timeoutSec = parseInt((this.container.querySelector('#perf-timeout') as HTMLInputElement)?.value || '60', 10);
        this.config.performance.transferTimeout = timeoutSec * 1000;

        // Update compatibility config
        this.config.server.compatibility.strictStandardMode = (this.container.querySelector('#compat-strict-mode') as HTMLInputElement)?.checked || false;
        this.config.server.compatibility.assumeBasicFtpOnly = (this.container.querySelector('#compat-basic-ftp') as HTMLInputElement)?.checked || false;
        this.config.server.compatibility.skipCapabilityDetection = (this.container.querySelector('#compat-skip-detection') as HTMLInputElement)?.checked || false;

        this.selectedPreset = 'custom';
        this.render();
        this.setupEventListeners();
    }

    private handlePresetChange(preset: FtpConfigPreset): void {
        this.selectedPreset = preset;
        if (preset !== 'custom') {
            this.config = ftpOptimizationService.generatePresetConfig(preset);
            this.render();
            this.setupEventListeners();
            UIMessage.success(`已应用${preset === 'conservative' ? '保守' : preset === 'aggressive' ? '激进' : '平衡'}模式预设配置`);
        }
    }

    private async handleTestConnection(): Promise<void> {
        this.updateConfigFromForm();
        const validation = ftpOptimizationService.validateConfig(this.config);
        if (!validation.isValid) {
            UIMessage.error(validation.errors.join('; '));
            return;
        }

        try {
            this.testing = true;
            this.render();
            this.setupEventListeners();

            await ftpOptimizationService.testConnection(this.config);
            UIMessage.success('连接测试成功！');
        } catch (error) {
            UIMessage.error('连接测试失败，请检查配置');
            this.logger.error('Connection test failed', error);
        } finally {
            this.testing = false;
            this.render();
            this.setupEventListeners();
        }
    }

    private async handleDetectCapabilities(): Promise<void> {
        this.updateConfigFromForm();
        const validation = ftpOptimizationService.validateConfig(this.config);
        if (!validation.isValid) {
            UIMessage.error(validation.errors.join('; '));
            return;
        }

        try {
            this.detecting = true;
            this.render();
            this.setupEventListeners();

            this.serverCapabilities = await ftpOptimizationService.detectServerCapabilities(this.config);
            this.showCapabilitiesDialog = true;
            this.render();
            this.setupEventListeners();
            UIMessage.success('服务器能力检测完成');
        } catch (error) {
            UIMessage.error('服务器能力检测失败');
            this.logger.error('Capability detection failed', error);
        } finally {
            this.detecting = false;
            this.render();
            this.setupEventListeners();
        }
    }

    private handleApplyCapabilities(): void {
        if (!this.serverCapabilities) return;

        this.config = ftpOptimizationService.optimizeConfigFromCapabilities(this.config, this.serverCapabilities);
        this.selectedPreset = 'custom';
        this.showCapabilitiesDialog = false;
        this.render();
        this.setupEventListeners();
        UIMessage.success('已根据检测结果优化配置');
    }

    private async handleSaveConfig(): Promise<void> {
        this.updateConfigFromForm();
        const validation = ftpOptimizationService.validateConfig(this.config);
        if (!validation.isValid) {
            UIMessage.error(validation.errors.join('; '));
            return;
        }

        try {
            this.saving = true;
            this.render();
            this.setupEventListeners();

            await ftpOptimizationService.saveConfig(this.config);
            UIMessage.success('配置保存成功！');
        } catch (error) {
            UIMessage.error('配置保存失败');
            this.logger.error('Config save failed', error);
        } finally {
            this.saving = false;
            this.render();
            this.setupEventListeners();
        }
    }

    private async handleResetConfig(): Promise<void> {
        try {
            const confirmed = await UIMessageBox.confirm({
                title: '确认重置',
                message: '确定要重置为默认配置吗？',
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type: 'warning'
            });

            if (confirmed) {
                this.config = ftpOptimizationService.getDefaultConfig();
                this.selectedPreset = 'balanced';
                this.render();
                this.setupEventListeners();
                UIMessage.success('已重置为默认配置');
            }
        } catch {
            // User cancelled
        }
    }

    private getReliabilityColor(reliability: number): string {
        if (reliability >= 0.8) return 'var(--vscode-testing-iconPassed, #3ba55c)';
        if (reliability >= 0.6) return 'var(--vscode-testing-iconQueued, #dcb67a)';
        return 'var(--vscode-testing-iconFailed, #f14c4c)';
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Public methods
    getConfig(): OptimizedFtpConfig {
        this.updateConfigFromForm();
        return this.config;
    }

    setConfig(config: OptimizedFtpConfig): void {
        this.config = config;
        this.render();
        this.setupEventListeners();
    }
}
