// Native JS ConnectionPanel component - Complete implementation
import { Logger } from '@shared/utils/Logger';
import { ConnectionStatus, type ConnectionConfig } from '@shared/types';
import { saveState, getState, postMessage, showOpenDialog, log } from '../utils/messageUtils';
import { UIMessage, UIMessageBox } from '../utils/uiUtils';
import {
	getSupportedConnectionTypes,
	getConnectionTypeDisplayName,
	getDefaultPort,
	getTransportDefinitions,
	supportsDirectConnection,
	type ConnectionType
} from '../services/ServiceFactory';
import { summarizeConnectionConfig } from '@shared/utils/connectionSummary';

const VALIDATION_ERROR_CODE = 'VALIDATION_FAILED';

interface FormErrors {
    [key: string]: string;
}

export class ConnectionPanel {
	private container: HTMLElement;
	private logger: Logger;
    
	public onConnect?: (config: ConnectionConfig) => void;
	public onDisconnect?: () => void;
	public onConnectionStatusChange?: (status: ConnectionStatus) => void;
	public onDownloadSettingsChange?: (path: string | null) => void;

	private form: ConnectionConfig = {
		type: 'http',
		host: '127.0.0.1',
		port: 8080,
		timeout: 30000,
		headers: {},
		username: '',
		password: '',
		passive: true,
		dataFormat: 'protobuf',
		baudRate: 115200,
		dataBits: 8,
		stopBits: 1,
		parity: 'none',
		flowControl: 'none'
	};

	private downloadDirectoryInput = '';
	private defaultDownloadDirectory = '';
	private activeTab: 'connection' | 'download' = 'connection';
	private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
	private connecting = false;
	private saving = false;
	private errors: FormErrors = {};
	private downloadPathLoading = false;

	private networkConnectionTypeSet = new Set<ConnectionType>(
		getTransportDefinitions()
			.filter((definition) => definition.refreshSensitive)
			.map((definition) => definition.id as ConnectionType)
	);

	constructor(container: HTMLElement, logger: Logger) {
		this.container = container;
		this.logger = logger;
		this.loadState();
		this.render();
	}

	private render(): void {
		const connectionTypeOptions = this.getConnectionTypeOptions();
		const isNetworkType = this.isNetworkType(this.form.type);
		const isConnected = this.connectionStatus === ConnectionStatus.CONNECTED;
		const urlPrefix = this.getUrlPrefix();
		const statusText = this.getConnectionStatusText(this.connectionStatus);
		const statusIcon = this.getConnectionStatusIcon(this.connectionStatus);
		const connectDisabled = this.connecting || isConnected;
		const disconnectDisabled = !isConnected || this.connecting;
		const connectLabel = this.connecting ? '连接中…' : (isConnected ? '已连接' : '立即连接');
		const connectionSummary = this.getConnectionSummary();

		this.container.innerHTML = `
            <div class="connection-panel">
                <div class="tabs">
                    <button class="tab-btn ${this.activeTab === 'connection' ? 'active' : ''}" data-tab="connection">
                        远程连接设置
                    </button>
                    <button class="tab-btn ${this.activeTab === 'download' ? 'active' : ''}" data-tab="download">
                        下载设置
                    </button>
                </div>

                <div class="tab-content" id="connection-tab" style="display: ${this.activeTab === 'connection' ? 'block' : 'none'};">
                    <div class="connection-status-card" style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; padding: 16px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent);">
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <div style="display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600;">
                                <span>${statusIcon}</span>
                                <span>${statusText}</span>
                            </div>
                            <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">${this.escapeHtml(connectionSummary)}</div>
                        </div>
                        <div style="display: flex; gap: 12px;">
                            <button type="button" class="btn btn-success" id="btn-panel-connect" ${connectDisabled ? 'disabled' : ''}>
                                ${connectLabel}
                            </button>
                            <button type="button" class="btn btn-danger" id="btn-panel-disconnect" ${disconnectDisabled ? 'disabled' : ''}>
                                断开连接
                            </button>
                        </div>
                        ${this.connecting ? '<div style="font-size: 12px; color: var(--vscode-descriptionForeground);">正在尝试与远程服务建立连接…</div>' : ''}
                    </div>

                    <form class="connection-form" id="connection-form">
                        <div class="control-group">
                            <label for="connection-type">连接类型 *</label>
                            <select id="connection-type" ${isConnected ? 'disabled' : ''}>
                                ${connectionTypeOptions.map(opt => 
		`<option value="${opt.value}" ${opt.disabled ? 'disabled' : ''} ${this.form.type === opt.value ? 'selected' : ''}>${opt.label}</option>`
	).join('')}
                            </select>
                            ${this.errors.type ? `<span class="error-text">${this.errors.type}</span>` : ''}
                        </div>

                        ${isNetworkType ? `
                            <div class="control-group">
                                <label for="connection-host">服务器地址 *</label>
                                <div style="display: flex; gap: 8px;">
                                    <span style="padding: 10px 12px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 6px 0 0 6px;">${urlPrefix}</span>
                                    <input type="text" id="connection-host" value="${this.form.host || ''}" placeholder="请输入服务器IP地址" ${isConnected ? 'disabled' : ''} style="flex: 1; border-radius: 0 6px 6px 0; border-left: none;">
                                </div>
                                ${this.errors.host ? `<span class="error-text">${this.errors.host}</span>` : ''}
                            </div>

                            <div class="control-group">
                                <label for="connection-port">端口 *</label>
                                <input type="number" id="connection-port" value="${this.form.port || 8080}" min="1" max="65535" placeholder="端口号" ${isConnected ? 'disabled' : ''}>
                                ${this.errors.port ? `<span class="error-text">${this.errors.port}</span>` : ''}
                            </div>
                        ` : ''}

                        ${this.form.type === 'serial' ? `
                            <div class="control-group">
                                <div class="alert alert-info">
                                    <strong>串口连接说明</strong><br>
                                    串口连接将通过Web Serial API直接与串口设备通信。连接时会弹出设备选择对话框，请选择对应的USB转串口设备。
                                </div>
                            </div>

                            <div class="control-group">
                                <label for="baud-rate">波特率 *</label>
                                <select id="baud-rate" ${isConnected ? 'disabled' : ''}>
                                    ${[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map(rate =>
		`<option value="${rate}" ${this.form.baudRate === rate ? 'selected' : ''}>${rate}</option>`
	).join('')}
                                </select>
                                ${this.errors.baudRate ? `<span class="error-text">${this.errors.baudRate}</span>` : ''}
                            </div>

                            <div class="control-group">
                                <label>数据位</label>
                                <div class="radio-list">
                                    <div class="radio-item">
                                        <input type="radio" id="data-bits-7" name="data-bits" value="7" ${this.form.dataBits === 7 ? 'checked' : ''} ${isConnected ? 'disabled' : ''}>
                                        <label for="data-bits-7">7位</label>
                                    </div>
                                    <div class="radio-item">
                                        <input type="radio" id="data-bits-8" name="data-bits" value="8" ${this.form.dataBits === 8 ? 'checked' : ''} ${isConnected ? 'disabled' : ''}>
                                        <label for="data-bits-8">8位</label>
                                    </div>
                                </div>
                            </div>

                            <div class="control-group">
                                <label>停止位</label>
                                <div class="radio-list">
                                    <div class="radio-item">
                                        <input type="radio" id="stop-bits-1" name="stop-bits" value="1" ${this.form.stopBits === 1 ? 'checked' : ''} ${isConnected ? 'disabled' : ''}>
                                        <label for="stop-bits-1">1位</label>
                                    </div>
                                    <div class="radio-item">
                                        <input type="radio" id="stop-bits-2" name="stop-bits" value="2" ${this.form.stopBits === 2 ? 'checked' : ''} ${isConnected ? 'disabled' : ''}>
                                        <label for="stop-bits-2">2位</label>
                                    </div>
                                </div>
                            </div>

                            <div class="control-group">
                                <label>奇偶校验</label>
                                <div class="radio-list">
                                    <div class="radio-item">
                                        <input type="radio" id="parity-none" name="parity" value="none" ${this.form.parity === 'none' ? 'checked' : ''} ${isConnected ? 'disabled' : ''}>
                                        <label for="parity-none">无校验</label>
                                    </div>
                                    <div class="radio-item">
                                        <input type="radio" id="parity-even" name="parity" value="even" ${this.form.parity === 'even' ? 'checked' : ''} ${isConnected ? 'disabled' : ''}>
                                        <label for="parity-even">偶校验</label>
                                    </div>
                                    <div class="radio-item">
                                        <input type="radio" id="parity-odd" name="parity" value="odd" ${this.form.parity === 'odd' ? 'checked' : ''} ${isConnected ? 'disabled' : ''}>
                                        <label for="parity-odd">奇校验</label>
                                    </div>
                                </div>
                            </div>

                            <div class="control-group">
                                <label>流控制</label>
                                <div class="radio-list">
                                    <div class="radio-item">
                                        <input type="radio" id="flow-none" name="flow-control" value="none" ${this.form.flowControl === 'none' ? 'checked' : ''} ${isConnected ? 'disabled' : ''}>
                                        <label for="flow-none">无</label>
                                    </div>
                                    <div class="radio-item">
                                        <input type="radio" id="flow-hardware" name="flow-control" value="hardware" ${this.form.flowControl === 'hardware' ? 'checked' : ''} ${isConnected ? 'disabled' : ''}>
                                        <label for="flow-hardware">硬件流控制</label>
                                    </div>
                                </div>
                            </div>
                        ` : ''}

                        <div class="control-group">
                            <label for="connection-timeout">超时时间</label>
                            <input type="number" id="connection-timeout" value="${this.form.timeout || 30000}" min="5000" max="60000" step="1000" placeholder="超时时间(毫秒)" ${isConnected ? 'disabled' : ''}>
                            ${this.errors.timeout ? `<span class="error-text">${this.errors.timeout}</span>` : ''}
                        </div>

                        ${this.form.type === 'ftp' ? `
                            <div class="control-group">
                                <label for="ftp-username">用户名 *</label>
                                <input type="text" id="ftp-username" value="${this.form.username || ''}" placeholder="请输入FTP用户名" ${isConnected ? 'disabled' : ''}>
                                ${this.errors.username ? `<span class="error-text">${this.errors.username}</span>` : ''}
                            </div>

                            <div class="control-group">
                                <label for="ftp-password">密码 *</label>
                                <input type="password" id="ftp-password" value="${this.form.password || ''}" placeholder="请输入FTP密码" ${isConnected ? 'disabled' : ''}>
                                ${this.errors.password ? `<span class="error-text">${this.errors.password}</span>` : ''}
                            </div>

                            <div class="control-group">
                                <label>传输模式</label>
                                <div class="radio-list">
                                    <div class="radio-item">
                                        <input type="radio" id="ftp-passive" name="ftp-passive" value="true" ${this.form.passive === true ? 'checked' : ''} ${isConnected ? 'disabled' : ''}>
                                        <label for="ftp-passive">被动模式 (PASV)</label>
                                    </div>
                                    <div class="radio-item">
                                        <input type="radio" id="ftp-active" name="ftp-passive" value="false" ${this.form.passive === false ? 'checked' : ''} ${isConnected ? 'disabled' : ''}>
                                        <label for="ftp-active">主动模式 (PORT)</label>
                                    </div>
                                </div>
                            </div>
                        ` : ''}


                        <div class="control-group" style="margin-top: 24px;">
                            <button type="button" class="btn btn-success" id="btn-save-connection" ${this.saving ? 'disabled' : ''}>
                                ${this.saving ? '保存中...' : '保存设置'}
                            </button>
                            <button type="button" class="btn btn-secondary" id="btn-reset-connection" ${isConnected || this.connecting ? 'disabled' : ''}>
                                重置
                            </button>
                        </div>
                    </form>
                </div>

                <div class="tab-content" id="download-tab" style="display: ${this.activeTab === 'download' ? 'block' : 'none'};">
                    <form class="download-settings-form">
                        <div class="control-group">
                            <label for="download-directory">默认下载目录</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="download-directory" value="${this.downloadDirectoryInput}" placeholder="请选择或输入默认下载目录" ${this.downloadPathLoading ? 'disabled' : ''} style="flex: 1;">
                                <button type="button" class="btn btn-secondary" id="btn-browse-download" ${this.downloadPathLoading ? 'disabled' : ''}>
                                    ${this.downloadPathLoading ? '加载中...' : '浏览'}
                                </button>
                            </div>
                            <div class="hint-text">此路径将在保存文件时作为默认位置。</div>
                        </div>

                        <div class="control-group" style="margin-top: 24px;">
                            <button type="button" class="btn btn-success" id="btn-save-download" ${this.downloadPathLoading ? 'disabled' : ''}>
                                保存设置
                            </button>
                            <button type="button" class="btn btn-secondary" id="btn-reset-download" ${this.downloadPathLoading ? 'disabled' : ''}>
                                重置
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;

		this.setupEventListeners();
	}

	private setupEventListeners(): void {
		// Tab switching
		this.container.querySelectorAll('.tab-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				const tab = (btn as HTMLElement).dataset.tab as 'connection' | 'download';
				this.activeTab = tab;
				this.render();
			});
		});

		// Connection form
		const connectionType = this.container.querySelector('#connection-type') as HTMLSelectElement;
		connectionType?.addEventListener('change', () => {
			this.handleTypeChange();
		});

		// Form inputs
		['connection-host', 'connection-port', 'connection-timeout', 'ftp-username', 'ftp-password'].forEach(id => {
			const input = this.container.querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement;
			if (input) {
				input.addEventListener('input', () => {
					this.updateFormValue(id, input.value);
					this.clearError(id);
				});
			}
		});

		this.attachNumberInputWheelGuard(['connection-port', 'connection-timeout']);

		// Serial port inputs
		['baud-rate', 'data-bits', 'stop-bits', 'parity', 'flow-control'].forEach(name => {
			const inputs = this.container.querySelectorAll(`[name="${name}"]`) as NodeListOf<HTMLInputElement>;
			inputs.forEach(input => {
				input.addEventListener('change', () => {
					this.updateSerialFormValue(name, input.value);
				});
			});
		});

		// FTP passive mode
		const ftpPassiveInputs = this.container.querySelectorAll('[name="ftp-passive"]') as NodeListOf<HTMLInputElement>;
		ftpPassiveInputs.forEach(input => {
			input.addEventListener('change', () => {
				this.form.passive = input.value === 'true';
			});
		});

		// Buttons
		this.container.querySelector('#btn-save-connection')?.addEventListener('click', () => this.handleSave());
		this.container.querySelector('#btn-reset-connection')?.addEventListener('click', () => this.handleReset());
		this.container.querySelector('#btn-browse-download')?.addEventListener('click', () => this.handleBrowseDownloadPath());
		this.container.querySelector('#btn-save-download')?.addEventListener('click', () => this.handleDownloadSettingsSave());
		this.container.querySelector('#btn-reset-download')?.addEventListener('click', () => this.handleDownloadPathReset());
		this.container.querySelector('#btn-panel-connect')?.addEventListener('click', () => {
			void this.handleConnectClick();
		});
		this.container.querySelector('#btn-panel-disconnect')?.addEventListener('click', () => {
			void this.handleDisconnectClick();
		});
	}

	private handleTypeChange(): void {
		const select = this.container.querySelector('#connection-type') as HTMLSelectElement;
		const newType = select.value as ConnectionType;
        
		this.form.type = newType;
        
		if (this.isNetworkType(newType)) {
			if (!this.form.host) {
				this.form.host = '127.0.0.1';
			}
			this.form.port = this.getDefaultPort(newType);
		}
        
		// Clean unrelated fields
		if (newType !== 'ftp') {
			this.form.username = '';
			this.form.password = '';
			this.form.passive = true;
		}
        
		if (newType !== 'http') {
			this.form.headers = {};
		}
        
		if (newType !== 'tcp') {
			this.form.dataFormat = 'protobuf';
		}
        
		if (newType !== 'serial') {
			this.form.baudRate = 115200;
			this.form.dataBits = 8;
			this.form.stopBits = 1;
			this.form.parity = 'none';
			this.form.flowControl = 'none';
		} else {
			this.form.host = '';
			this.form.port = 0;
		}
        
		this.errors = {};
		this.render();
	}

	private updateFormValue(id: string, value: string): void {
		if (id === 'connection-host') {
			this.form.host = value;
		} else if (id === 'connection-port') {
			this.form.port = parseInt(value, 10) || 8080;
		} else if (id === 'connection-timeout') {
			this.form.timeout = parseInt(value, 10) || 30000;
		} else if (id === 'ftp-username') {
			this.form.username = value;
		} else if (id === 'ftp-password') {
			this.form.password = value;
		}
	}

	private updateSerialFormValue(name: string, value: string): void {
		if (name === 'data-bits') {
			this.form.dataBits = parseInt(value, 10) as 7 | 8;
		} else if (name === 'stop-bits') {
			this.form.stopBits = parseInt(value, 10) as 1 | 2;
		} else if (name === 'parity') {
			this.form.parity = value as 'none' | 'even' | 'odd';
		} else if (name === 'flow-control') {
			this.form.flowControl = value as 'none' | 'hardware';
		}
	}

	private clearError(field: string): void {
		delete this.errors[field];
		const errorEl = this.container.querySelector(`#${field}`)?.parentElement?.querySelector('.error-text');
		if (errorEl) {
			errorEl.remove();
		}
	}

	private attachNumberInputWheelGuard(ids: string[]): void {
		ids.forEach((id) => {
			const input = this.container.querySelector(`#${id}`) as HTMLInputElement | null;
			if (!input) {
				return;
			}

			const handleWheel = (event: WheelEvent) => {
				if (document.activeElement === input) {
					input.blur();
				}
				event.preventDefault();
			};

			input.addEventListener('wheel', handleWheel, { passive: false });
		});
	}

	private validate(): boolean {
		this.errors = {};
        
		if (!this.form.type) {
			this.errors.type = '请选择连接类型';
		}
        
		if (this.isNetworkType(this.form.type)) {
			if (!this.form.host || !this.form.host.trim()) {
				this.errors.host = '请输入服务器地址';
			} else {
				const hostPattern = /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^localhost$|^[a-zA-Z0-9.-]+$/;
				if (!hostPattern.test(this.form.host)) {
					this.errors.host = '请输入有效的IP地址、域名或localhost';
				}
			}
            
			if (!this.form.port || this.form.port < 1 || this.form.port > 65535) {
				this.errors.port = '端口号必须在1-65535之间';
			}
		}
        
		if (this.form.timeout && (this.form.timeout < 5000 || this.form.timeout > 60000)) {
			this.errors.timeout = '超时时间必须在5-60秒之间';
		}
        
		if (this.form.type === 'ftp') {
			if (!this.form.username || !this.form.username.trim()) {
				this.errors.username = '请输入FTP用户名';
			}
			if (!this.form.password || !this.form.password.trim()) {
				this.errors.password = '请输入FTP密码';
			}
		}
        
		if (this.form.type === 'serial') {
			if (!this.form.baudRate) {
				this.errors.baudRate = '请选择波特率';
			}
		}
        
		if (Object.keys(this.errors).length > 0) {
			this.render();
			return false;
		}
        
		return true;
	}

	private async handleSave(): Promise<void> {
		if (!this.validate()) {
			UIMessage.error('请检查必填字段是否填写完整');
			return;
		}
        
		try {
			this.saving = true;
			this.render();
            
			const config = this.buildConnectionConfig();
			const stateData = this.buildStatePayload(config);
			postMessage('saveState', { state: stateData });
			saveState(stateData);
            
			// 延迟重置状态，给用户视觉反馈
			setTimeout(() => {
				this.saving = false;
				this.render();
				UIMessage.success('配置已保存');
				this.logger.info('Connection settings saved', { summary: summarizeConnectionConfig(config) });
			}, 300);
		} catch (error) {
			this.saving = false;
			this.render();
			UIMessage.error('保存设置失败');
			this.logger.error('Save failed', error);
		}
	}

	private handleReset(): void {
		this.form = {
			type: 'http',
			host: '127.0.0.1',
			port: 8080,
			timeout: 30000,
			headers: {},
			username: '',
			password: '',
			passive: true,
			dataFormat: 'protobuf',
			baudRate: 115200,
			dataBits: 8,
			stopBits: 1,
			parity: 'none',
			flowControl: 'none'
		};
		this.errors = {};
		this.render();
	}

	private async handleBrowseDownloadPath(): Promise<void> {
		try {
			this.downloadPathLoading = true;
			this.render();
            
			const result = await showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false
			});
            
			const selected = Array.isArray(result) && result.length > 0 ? result[0] : undefined;
			if (selected) {
				this.downloadDirectoryInput = selected;
				this.emitDownloadSettingsChange(selected);
			}
		} finally {
			this.downloadPathLoading = false;
			this.render();
		}
	}

	private async handleDownloadSettingsSave(): Promise<void> {
		try {
			const config = this.buildConnectionConfig();
			const stateData = this.buildStatePayload(config);
			postMessage('saveState', { state: stateData });
			saveState(stateData);
			this.emitDownloadSettingsChange(this.downloadDirectoryInput || null);
			UIMessage.success('下载设置已保存');
		} catch (error) {
			UIMessage.error('保存下载设置失败');
			this.logger.error('Download settings save failed', error);
		}
	}

	private handleDownloadPathReset(): void {
		if (this.defaultDownloadDirectory) {
			this.downloadDirectoryInput = this.defaultDownloadDirectory;
			this.emitDownloadSettingsChange(this.defaultDownloadDirectory);
			UIMessage.success('已恢复默认下载目录');
			return;
		}
		this.requestDefaultDownloadPath();
	}

	private async handleConnectClick(): Promise<void> {
		if (this.connecting || this.connectionStatus === ConnectionStatus.CONNECTED) {
			return;
		}

		let statusUpdated = false;

		try {
			const config = await this.getValidatedConfig();
			this.connecting = true;
			this.connectionStatus = ConnectionStatus.CONNECTING;
			this.onConnectionStatusChange?.(ConnectionStatus.CONNECTING);
			statusUpdated = true;
			this.render();

			if (this.onConnect) {
				await this.onConnect(config);
			} else {
				UIMessage.warning('未绑定连接处理器');
			}
		} catch (error) {
			const errorCode = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
			const message = error instanceof Error ? error.message : '连接请求失败';

			if (errorCode === VALIDATION_ERROR_CODE) {
				UIMessage.warning(message || '请先完善连接配置');
			} else {
				UIMessage.error(message || '连接请求失败');
				if (statusUpdated) {
					this.connectionStatus = ConnectionStatus.DISCONNECTED;
					this.onConnectionStatusChange?.(ConnectionStatus.DISCONNECTED);
				}
			}
		} finally {
			this.connecting = false;
			this.render();
		}
	}

	private async handleDisconnectClick(): Promise<void> {
		if (this.connecting || this.connectionStatus !== ConnectionStatus.CONNECTED) {
			return;
		}

		const confirmed = await UIMessageBox.confirm({
			title: '确认断开',
			message: '确定要断开当前连接吗？',
			confirmButtonText: '断开',
			cancelButtonText: '取消',
			type: 'warning'
		});

		if (!confirmed) {
			return;
		}

		this.connectionStatus = ConnectionStatus.DISCONNECTED;
		this.onConnectionStatusChange?.(ConnectionStatus.DISCONNECTED);
		this.render();

		if (this.onDisconnect) {
			await this.onDisconnect();
		}
	}

	private requestDefaultDownloadPath(): void {
		const requestId = `default-download-${Date.now()}`;
		this.downloadPathLoading = true;
		this.render();
		postMessage('requestDefaultDownloadPath', { requestId });
        
		setTimeout(() => {
			this.downloadPathLoading = false;
			this.render();
		}, 8000);
	}

	private getConnectionSummary(): string {
		try {
			const config: ConnectionConfig = {
				...this.form
			} as ConnectionConfig;
			return summarizeConnectionConfig(config);
		} catch {
			return '配置尚未完成';
		}
	}

	private getConnectionStatusText(status: ConnectionStatus): string {
		switch (status) {
			case ConnectionStatus.CONNECTED:
				return '已连接';
			case ConnectionStatus.CONNECTING:
				return '连接中…';
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

	private escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text ?? '';
		return div.innerHTML;
	}

	private buildConnectionConfig(): ConnectionConfig {
		const config = JSON.parse(JSON.stringify(this.form)) as ConnectionConfig;
        
		if (config.type === 'ftp' && (!config.username || !config.password)) {
			throw new Error('FTP连接需要用户名和密码');
		}
        
		return config;
	}

	private buildStatePayload(config: ConnectionConfig) {
		return {
			connectionForm: config,
			downloadSettings: {
				defaultDownloadPath: this.downloadDirectoryInput.trim() || null
			}
		};
	}

	private emitDownloadSettingsChange(path: string | null): void {
		const normalized = path ? path.trim() : null;
		this.onDownloadSettingsChange?.(normalized ? normalized : null);
	}

	private loadState(): void {
		try {
			const state = getState();
			if (state.connectionForm) {
				this.form = { ...this.form, ...state.connectionForm };
			}
			if (state.downloadSettings?.defaultDownloadPath) {
				this.downloadDirectoryInput = state.downloadSettings.defaultDownloadPath;
				this.defaultDownloadDirectory = state.downloadSettings.defaultDownloadPath;
			}
		} catch (error) {
			this.logger.warn('Failed to load state', error);
		}
	}

	private getConnectionTypeOptions(): Array<{ label: string; value: string; disabled?: boolean }> {
		return getSupportedConnectionTypes().map(type => ({
			value: type,
			label: getConnectionTypeDisplayName(type),
			disabled: false
		}));
	}

	private isNetworkType(type: string | undefined | null): boolean {
		if (!type) {return false;}
		return this.networkConnectionTypeSet.has(type as ConnectionType);
	}

	private getUrlPrefix(): string {
		switch (this.form.type) {
			case 'ftp': return 'ftp://';
			case 'http': return 'http://';
			case 'tcp': return 'tcp://';
			case 'serial': return 'serial://';
			default: return '';
		}
	}

	private getDefaultPort(type: ConnectionType): number {
		if (supportsDirectConnection(type)) {
			const port = getDefaultPort(type);
			if (typeof port === 'number') {
				return port;
			}
		}
        
		if (type === 'serial') {
			return 0;
		}
        
		return 8080;
	}

	// Public methods
	setConnectionStatus(status: ConnectionStatus): void {
		this.connectionStatus = status;
		this.render();
	}

	setConnecting(connecting: boolean): void {
		this.connecting = connecting;
		this.render();
	}

	async getValidatedConfig(): Promise<ConnectionConfig> {
		if (!this.validate()) {
			const error = new Error('表单验证失败') as Error & { code?: string };
			error.code = VALIDATION_ERROR_CODE;
			throw error;
		}
        
		return this.buildConnectionConfig();
	}

	getDownloadSettings(): { defaultDownloadPath: string | null } {
		return {
			defaultDownloadPath: this.downloadDirectoryInput.trim() || null
		};
	}

	setDownloadDirectory(path: string | null, options: { emit?: boolean } = {}): void {
		const normalized = path ? path.trim() : '';
		this.downloadDirectoryInput = normalized;
		if (normalized) {
			this.defaultDownloadDirectory = normalized;
		}

		if (options.emit) {
			this.emitDownloadSettingsChange(normalized || null);
		}

		this.render();
	}
}
