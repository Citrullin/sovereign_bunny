import { LitElement, html, css, TemplateResult } from 'lit';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

export type DialogType = 'info' | 'warning' | 'error' | 'success';

/**
 * `<sovereign-app-dialog>` Lit Component
 * Adheres strictly to the Single Responsibility Principle (SRP).
 * Replaces dozens of scattered procedural DOM mutations of app-dialog-modal,
 * title, body, and button elements with a clean reactive component and promise-based API.
 */
export class SovereignAppDialog extends BaseElement {
    static properties = {
        isOpen: { type: Boolean },
        isConfirm: { type: Boolean },
        title: { type: String },
        message: { type: String },
        dialogType: { type: String },
    };

    isOpen: boolean = false;
    isConfirm: boolean = false;
    title: string = 'Notification';
    message: string = '';
    dialogType: DialogType = 'info';

    private _resolve: ((val: boolean) => void) | null = null;

    static styles = css`
        :host {
            display: contents;
        }
        .overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.85);
            z-index: 10002;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 15px;
            box-sizing: border-box;
        }
        .dialog-card {
            width: 95%;
            max-width: 520px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            padding: 20px;
            border: 3px solid #ffcc00;
            box-shadow: 0 0 20px rgba(255, 204, 0, 0.3);
            box-sizing: border-box;
            background: #111528;
            color: #eee;
            border-radius: 8px;
            font-family: inherit;
        }
        .dialog-card.type-error {
            border-color: #ff5555;
            box-shadow: 0 0 20px rgba(255, 85, 85, 0.3);
        }
        .dialog-card.type-success {
            border-color: #45f3ff;
            box-shadow: 0 0 20px rgba(69, 243, 255, 0.3);
        }
        .dialog-title {
            font-size: 0.95rem;
            color: #ffcc00;
            margin: 0 0 10px 0;
            font-weight: bold;
        }
        .dialog-title.type-error { color: #ff5555; }
        .dialog-title.type-success { color: #45f3ff; }
        .dialog-body-container {
            flex: 1 1 auto;
            overflow-y: auto;
            overflow-x: hidden;
            max-height: 55vh;
            margin-bottom: 16px;
            padding-right: 5px;
        }
        .dialog-body {
            font-size: 0.72rem;
            color: #eee;
            line-height: 1.5;
            margin: 0;
            word-break: break-word;
            white-space: pre-wrap;
            font-family: monospace;
        }
        .dialog-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            border-top: 1px solid #333;
            padding-top: 10px;
        }
        .btn {
            padding: 6px 14px;
            font-size: 0.72rem;
            cursor: pointer;
            border-radius: 4px;
            font-weight: bold;
            border: 2px solid;
            font-family: inherit;
        }
        .btn-cancel {
            background: #331111;
            color: #ff6b6b;
            border-color: #ff4444;
        }
        .btn-ok {
            background: #113322;
            color: #45f3ff;
            border-color: #45a29e;
        }
    `;

    showAlert(message: string, title = 'Notification', type: DialogType = 'info'): Promise<void> {
        return new Promise((resolve) => {
            this.title = title;
            let safeMsg = typeof message === 'string' ? message : String(message || '');
            if (safeMsg.length > 500) {
                safeMsg = safeMsg.slice(0, 480) + '\n... [truncated]';
            }
            this.message = safeMsg;
            this.dialogType = type;
            this.isConfirm = false;
            this.isOpen = true;
            this._resolve = () => {
                this.isOpen = false;
                resolve();
            };
            this.requestUpdate();
        });
    }

    showConfirm(message: string, title = 'Confirm Action'): Promise<boolean> {
        return new Promise((resolve) => {
            this.title = title;
            this.message = message;
            this.dialogType = 'warning';
            this.isConfirm = true;
            this.isOpen = true;
            this._resolve = (val: boolean) => {
                this.isOpen = false;
                resolve(val);
            };
            this.requestUpdate();
        });
    }

    close(val: boolean = false): void {
        if (this._resolve) {
            const cb = this._resolve;
            this._resolve = null;
            cb(val);
        }
        this.isOpen = false;
        this.requestUpdate();
    }

    private _handleOk(): void {
        if (this._resolve) {
            const cb = this._resolve;
            this._resolve = null;
            cb(true);
        }
    }

    private _handleCancel(): void {
        if (this._resolve) {
            const cb = this._resolve;
            this._resolve = null;
            cb(false);
        }
    }

    private _handleOverlayClick(e: MouseEvent): void {
        if ((e.target as HTMLElement).classList.contains('overlay') && !this.isConfirm) {
            this._handleOk();
        }
    }

    render(): TemplateResult {
        if (!this.isOpen) return html``;

        return html`
            <div class="overlay" @click=${this._handleOverlayClick}>
                <div class="dialog-card type-${this.dialogType}">
                    <h3 class="dialog-title type-${this.dialogType}">${this.title}</h3>
                    <div class="dialog-body-container">
                        <p class="dialog-body">${this.message}</p>
                    </div>
                    <div class="dialog-actions">
                        ${this.isConfirm ? html`
                            <button type="button" class="btn btn-cancel" @click=${this._handleCancel}>
                                Cancel
                            </button>
                        ` : ''}
                        <button type="button" class="btn btn-ok" @click=${this._handleOk}>
                            OK
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-app-dialog')) {
    customElements.define('sovereign-app-dialog', SovereignAppDialog);
}
