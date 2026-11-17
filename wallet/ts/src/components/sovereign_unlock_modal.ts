import { LitElement, html, css, TemplateResult } from 'lit';
import { decryptData } from '../storage_manager.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<sovereign-unlock-modal>` Lit Component
 * Encapsulates the keystore decryption dialog, password input, and unlock lifecycle.
 * Replaces legacy #unlock-modal static DOM elements.
 */
export class SovereignUnlockModalElement extends BaseElement {
    static properties = {
        isOpen: { type: Boolean, state: true },
        address: { type: String, state: true },
        errorMsg: { type: String, state: true },
        isPasswordVisible: { type: Boolean, state: true },
        isSubmitting: { type: Boolean, state: true },
    };

    isOpen: boolean = false;
    address: string = '';
    errorMsg: string = '';
    isPasswordVisible: boolean = false;
    isSubmitting: boolean = false;

    private _keystoreData: any = null;
    private _onUnlockCallback: ((decrypted: any) => Promise<void>) | null = null;
    private _resolve: ((value: boolean) => void) | null = null;

    static styles = css`
        :host {
            display: contents;
            font-family: inherit;
        }
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.85);
            z-index: 10005;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 15px;
            box-sizing: border-box;
        }
        .modal-card {
            width: 90%;
            max-width: 480px;
            background: #111528;
            border: 3px solid #66fcf1;
            box-shadow: 0 0 20px rgba(102, 252, 241, 0.3);
            border-radius: 8px;
            padding: 20px;
            color: #eee;
            box-sizing: border-box;
        }
        .modal-title {
            font-size: 1.1rem;
            color: #66fcf1;
            text-align: center;
            margin: 0 0 12px 0;
            font-weight: bold;
        }
        .account-info {
            font-size: 0.7rem;
            color: #ddd;
            margin-bottom: 12px;
            word-break: break-all;
        }
        .account-code {
            color: #ffcc00;
            font-size: 0.68rem;
            font-family: monospace;
        }
        .field-group {
            margin-bottom: 15px;
        }
        .field-label {
            font-size: 0.68rem;
            color: #fff;
            display: block;
            margin-bottom: 6px;
        }
        .input-row {
            display: flex;
            gap: 8px;
        }
        .text-input {
            flex: 1;
            padding: 8px 10px;
            background: #090c15;
            border: 1px solid #45f3ff;
            color: #fff;
            font-size: 0.72rem;
            border-radius: 4px;
            outline: none;
            font-family: monospace;
        }
        .btn-toggle-pw {
            padding: 4px 10px;
            background: #1f2a3e;
            border: 1px solid #45f3ff;
            color: #fff;
            cursor: pointer;
            border-radius: 4px;
        }
        .error-box {
            color: #ff5555;
            font-size: 0.65rem;
            margin-bottom: 12px;
            background: rgba(255, 0, 0, 0.1);
            padding: 6px;
            border: 1px solid #ff5555;
            border-radius: 4px;
        }
        .btn-row {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            margin-top: 15px;
        }
        .btn {
            padding: 8px 14px;
            font-size: 0.7rem;
            font-weight: bold;
            cursor: pointer;
            border: none;
            border-radius: 4px;
        }
        .btn-cancel {
            background: #da3633;
            color: #fff;
        }
        .btn-confirm {
            background: #238636;
            color: #fff;
        }
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    `;

    createRenderRoot(): HTMLElement {
        return this as unknown as HTMLElement;
    }

    open(address: string, keystoreData: any, onUnlock?: (decrypted: any) => Promise<void>): Promise<boolean> {
        this.address = address;
        this._keystoreData = keystoreData;
        this._onUnlockCallback = onUnlock || null;
        this.errorMsg = '';
        this.isSubmitting = false;
        this.isPasswordVisible = false;
        this.isOpen = true;
        this.requestUpdate();

        setTimeout(() => {
            const input = (typeof this.querySelector === 'function' ? this.querySelector('input') : null) ||
                          (typeof (this as any).renderRoot?.querySelector === 'function' ? (this as any).renderRoot.querySelector('input') : null) as HTMLInputElement | null;
            if (input) {
                input.value = '';
                input.focus();
            }
        }, 50);

        return new Promise((resolve) => {
            this._resolve = resolve;
        });
    }

    close() {
        this.isOpen = false;
        this.requestUpdate();
        if (this._resolve) {
            this._resolve(false);
            this._resolve = null;
        }
    }

    private togglePasswordVisibility() {
        this.isPasswordVisible = !this.isPasswordVisible;
        this.requestUpdate();
    }

    private onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.handleUnlock();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
        }
    }

    private async handleUnlock() {
        const input = (typeof this.querySelector === 'function' ? this.querySelector('input') : null) ||
                      (typeof (this as any).renderRoot?.querySelector === 'function' ? (this as any).renderRoot.querySelector('input') : null) as HTMLInputElement | null;
        const password = input ? input.value : '';

        if (!password) {
            this.errorMsg = 'Please enter your keystore password / PIN.';
            this.requestUpdate();
            return;
        }

        this.isSubmitting = true;
        this.errorMsg = '';
        this.requestUpdate();

        try {
            const decryptedStr = await decryptData(this._keystoreData, password);
            const decrypted = JSON.parse(decryptedStr);

            if (this._onUnlockCallback) {
                await this._onUnlockCallback(decrypted);
            }

            this.dispatchEvent(new CustomEvent('unlocked', {
                bubbles: true,
                composed: true,
                detail: { address: this.address, decrypted }
            }));

            this.isOpen = false;
            this.requestUpdate();
            if (this._resolve) {
                this._resolve(true);
                this._resolve = null;
            }
        } catch (err) {
            this.errorMsg = '❌ Incorrect password / PIN. Please try again.';
        } finally {
            this.isSubmitting = false;
            this.requestUpdate();
        }
    }

    render(): TemplateResult | string {
        if (!this.isOpen) return '';

        return html`
            <div class="modal-overlay" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.85); z-index: 99999; display: flex; justify-content: center; align-items: center; padding: 15px; box-sizing: border-box;" @click=${(e: Event) => { if (e.target === e.currentTarget) this.close(); }}>
                <div class="nes-container is-dark with-title" style="width: 90%; max-width: 520px; background: #212529; border: 4px solid #66fcf1; box-shadow: 0 8px #000; padding: 25px 20px 20px 20px; color: #fff;">
                    <p class="title" style="color: #66fcf1; background: #212529; font-size: 0.85rem; font-family: 'Press Start 2P', monospace;">🔐 UNLOCK KEYSTORE</p>
                    <div style="font-size: 0.7rem; color: #ddd; margin-bottom: 15px; word-break: break-all;">
                        Encrypted storage found for account:<br>
                        <code style="color: #ffcc00; font-size: 0.68rem; font-family: monospace;">${this.address || '0x...'}</code>
                    </div>

                    <div class="nes-field" style="margin-bottom: 15px;">
                        <label style="font-size: 0.68rem; color: #fff; display: block; margin-bottom: 6px;">Enter Password / PIN:</label>
                        <div style="display: flex; gap: 8px;">
                            <input
                                type=${this.isPasswordVisible ? 'text' : 'password'}
                                class="nes-input is-dark"
                                style="font-size: 0.75rem; flex: 1;"
                                placeholder="Enter PIN / password to decrypt"
                                @keydown=${this.onKeyDown}
                            >
                            <button
                                type="button"
                                class="nes-btn is-primary"
                                style="font-size: 0.7rem; padding: 0 12px;"
                                @click=${this.togglePasswordVisibility}
                            >${this.isPasswordVisible ? '🙈' : '👁️'}</button>
                        </div>
                    </div>

                    ${this.errorMsg ? html`<div style="color: #ff5555; font-size: 0.65rem; margin-bottom: 12px; background: rgba(255, 0, 0, 0.15); padding: 8px; border: 2px solid #ff5555;">${this.errorMsg}</div>` : ''}

                    <div style="display: flex; justify-content: space-between; gap: 10px; margin-top: 20px;">
                        <button type="button" class="nes-btn is-error" style="font-size: 0.7rem;" @click=${this.close}>Close</button>
                        <button
                            type="button"
                            class="nes-btn is-success"
                            style="font-size: 0.7rem;"
                            ?disabled=${this.isSubmitting}
                            @click=${this.handleUnlock}
                        >${this.isSubmitting ? 'Decrypting...' : '🔓 Decrypt & Unlock'}</button>
                    </div>
                </div>
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-unlock-modal')) {
    customElements.define('sovereign-unlock-modal', SovereignUnlockModalElement);
}
