// Native JS UI utilities - replaces Element Plus message/notification components
import type { FileItem } from '@shared/types';

export type MessageType = 'success' | 'warning' | 'error' | 'info';

interface MessageOptions {
    message: string;
    duration?: number;
    showClose?: boolean;
}

interface NotificationOptions {
    title: string;
    message: string;
    type?: MessageType;
    duration?: number;
}

interface ConfirmOptions {
    title?: string;
    message: string;
    confirmButtonText?: string;
    cancelButtonText?: string;
    type?: MessageType;
}

export class UIMessage {
    private static messageContainer: HTMLElement | null = null;

    private static ensureContainer(): HTMLElement {
        if (!this.messageContainer) {
            this.messageContainer = document.createElement('div');
            this.messageContainer.id = 'ui-message-container';
            this.messageContainer.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                pointer-events: none;
            `;
            document.body.appendChild(this.messageContainer);
        }
        return this.messageContainer;
    }

    static show(options: MessageOptions, type: MessageType = 'info'): void {
        const container = this.ensureContainer();
        const messageEl = document.createElement('div');
        const duration = options.duration ?? 3000;

        messageEl.className = `ui-message ui-message-${type}`;
        messageEl.style.cssText = `
            margin-bottom: 12px;
            padding: 12px 16px;
            background-color: var(--vscode-notifications-background);
            border: 1px solid var(--vscode-notifications-border);
            border-radius: 4px;
            color: var(--vscode-notifications-foreground);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            pointer-events: auto;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 300px;
            max-width: 500px;
            animation: slideInRight 0.3s ease;
        `;

        const icon = this.getIcon(type);
        messageEl.innerHTML = `
            <span style="font-size: 16px;">${icon}</span>
            <span style="flex: 1;">${this.escapeHtml(options.message)}</span>
            ${options.showClose ? '<span style="cursor: pointer; font-size: 18px; opacity: 0.7;">&times;</span>' : ''}
        `;

        if (options.showClose) {
            const closeBtn = messageEl.querySelector('span:last-child');
            closeBtn?.addEventListener('click', () => this.remove(messageEl));
        }

        container.appendChild(messageEl);

        if (duration > 0) {
            setTimeout(() => {
                this.remove(messageEl);
            }, duration);
        }

        messageEl.addEventListener('click', () => {
            if (!options.showClose) {
                this.remove(messageEl);
            }
        });
    }

    static success(message: string | MessageOptions, duration?: number): void {
        const options = typeof message === 'string' ? { message, duration } : message;
        this.show(options, 'success');
    }

    static warning(message: string | MessageOptions, duration?: number): void {
        const options = typeof message === 'string' ? { message, duration } : message;
        this.show(options, 'warning');
    }

    static error(message: string | MessageOptions, duration?: number): void {
        const options = typeof message === 'string' ? { message, duration } : message;
        this.show(options, 'error');
    }

    static info(message: string | MessageOptions, duration?: number): void {
        const options = typeof message === 'string' ? { message, duration } : message;
        this.show(options, 'info');
    }

    private static remove(element: HTMLElement): void {
        element.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            element.remove();
            if (this.messageContainer && this.messageContainer.children.length === 0) {
                this.messageContainer.remove();
                this.messageContainer = null;
            }
        }, 300);
    }

    private static getIcon(type: MessageType): string {
        switch (type) {
            case 'success': return '✓';
            case 'error': return '✕';
            case 'warning': return '⚠';
            case 'info': return 'ℹ';
            default: return '';
        }
    }

    private static escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

export class UINotification {
    static show(options: NotificationOptions): void {
        UIMessage.show({
            message: `<strong>${this.escapeHtml(options.title)}</strong><br>${this.escapeHtml(options.message)}`,
            duration: options.duration ?? 4500
        }, options.type ?? 'info');
    }

    private static escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

export class UIMessageBox {
    static async confirm(options: ConfirmOptions | string): Promise<boolean> {
        return new Promise((resolve) => {
            const opts = typeof options === 'string' 
                ? { message: options }
                : options;

            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s ease;
            `;

            const container = document.createElement('div');
            container.className = 'modal-container';
            container.style.cssText = `
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 8px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                max-width: 500px;
                width: 90%;
                animation: slideIn 0.3s ease;
            `;

            const icon = this.getIcon(opts.type ?? 'warning');
            container.innerHTML = `
                <div style="padding: 20px; border-bottom: 1px solid var(--vscode-panel-border);">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">${icon}</span>
                        <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: var(--vscode-foreground);">
                            ${this.escapeHtml(opts.title ?? '确认')}
                        </h3>
                    </div>
                    <p style="margin: 0; color: var(--vscode-foreground); line-height: 1.6;">
                        ${this.escapeHtml(opts.message)}
                    </p>
                </div>
                <div style="padding: 16px 20px; border-top: 1px solid var(--vscode-panel-border); display: flex; justify-content: flex-end; gap: 12px;">
                    <button class="btn btn-secondary" data-action="cancel">${opts.cancelButtonText ?? '取消'}</button>
                    <button class="btn btn-primary" data-action="confirm">${opts.confirmButtonText ?? '确定'}</button>
                </div>
            `;

            const handleCancel = () => {
                overlay.remove();
                resolve(false);
            };

            const handleConfirm = () => {
                overlay.remove();
                resolve(true);
            };

            container.querySelector('[data-action="cancel"]')?.addEventListener('click', handleCancel);
            container.querySelector('[data-action="confirm"]')?.addEventListener('click', handleConfirm);

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    handleCancel();
                }
            });

            overlay.appendChild(container);
            document.body.appendChild(overlay);

            // Focus confirm button
            setTimeout(() => {
                (container.querySelector('[data-action="confirm"]') as HTMLElement)?.focus();
            }, 100);
        });
    }

    static async alert(message: string, title: string = '提示', options?: { confirmButtonText?: string }): Promise<void> {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s ease;
            `;

            const container = document.createElement('div');
            container.className = 'modal-container';
            container.style.cssText = `
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 8px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                max-width: 500px;
                width: 90%;
                animation: slideIn 0.3s ease;
            `;

            container.innerHTML = `
                <div style="padding: 20px; border-bottom: 1px solid var(--vscode-panel-border);">
                    <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: var(--vscode-foreground); margin-bottom: 12px;">
                        ${this.escapeHtml(title)}
                    </h3>
                    <p style="margin: 0; color: var(--vscode-foreground); line-height: 1.6;">
                        ${this.escapeHtml(message)}
                    </p>
                </div>
                <div style="padding: 16px 20px; border-top: 1px solid var(--vscode-panel-border); display: flex; justify-content: flex-end;">
                    <button class="btn btn-primary" data-action="confirm">${options?.confirmButtonText ?? '确定'}</button>
                </div>
            `;

            const handleConfirm = () => {
                overlay.remove();
                resolve();
            };

            container.querySelector('[data-action="confirm"]')?.addEventListener('click', handleConfirm);

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    handleConfirm();
                }
            });

            overlay.appendChild(container);
            document.body.appendChild(overlay);

            setTimeout(() => {
                (container.querySelector('[data-action="confirm"]') as HTMLElement)?.focus();
            }, 100);
        });
    }

    private static getIcon(type: MessageType): string {
        switch (type) {
            case 'success': return '✓';
            case 'error': return '✕';
            case 'warning': return '⚠';
            case 'info': return 'ℹ';
            default: return '⚠';
        }
    }

    private static escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    
    @keyframes slideIn {
        from {
            transform: translateY(-20px);
            opacity: 0;
        }
        to {
            transform: translateY(0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);
