import { LitElement, html, css, TemplateResult } from 'lit';
import { decryptData } from '../storage_manager.js';
import { keccak256, toHex, stringToBytes, concatHex } from 'viem';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<sovereign-reveal-key-modal>` Lit Component
 * Encapsulates confidential secret material reveal with keystore decryption,
 * viem-based deterministic key derivation, and clipboard copy.
 * Replaces legacy #reveal-key-modal static DOM elements.
 */
export class SovereignRevealKeyModalElement extends BaseElement {
    static properties = {
        isOpen: { type: Boolean, state: true },
        keyName: { type: String, state: true },
        keyFragment: { type: String, state: true },
        pubKey: { type: String, state: true },
        stage: { type: String, state: true }, // 'password' | 'revealed'
        errorMsg: { type: String, state: true },
        isPasswordVisible: { type: Boolean, state: true },
        isDecrypting: { type: Boolean, state: true },
        secretValue: { type: String, state: true },
        secretLabel: { type: String, state: true },
    };

    isOpen: boolean = false;
    keyName: string = '';
    keyFragment: string = '';
    pubKey: string = '';
    stage: 'password' | 'revealed' = 'password';
    errorMsg: string = '';
    isPasswordVisible: boolean = false;
    isDecrypting: boolean = false;
    secretValue: string = '';
    secretLabel: string = 'Secret Material (Hex):';

    private _keystoreData: any = null;

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
            z-index: 10006;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 15px;
            box-sizing: border-box;
        }
        .modal-card {
            width: 100%;
            max-width: 540px;
            background: #161b22;
            border: 3px solid #f7d51d;
            box-shadow: 0 0 20px rgba(247, 213, 29, 0.3);
            border-radius: 8px;
            padding: 20px;
            color: #eee;
            box-sizing: border-box;
        }
        .modal-title {
            color: #f7d51d;
            font-size: 0.95rem;
            margin: 0 0 12px 0;
            font-weight: bold;
        }
        .desc-text {
            font-size: 0.7rem;
            color: #ddd;
            margin-bottom: 12px;
        }
        .key-name-highlight {
            color: #66fcf1;
            font-weight: bold;
        }
        .input-row {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
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
            margin-bottom: 8px;
            background: rgba(255, 0, 0, 0.1);
            padding: 6px;
            border: 1px solid #ff5555;
            border-radius: 4px;
        }
        .result-box {
            background: #05080f;
            border: 1px solid #e76e55;
            padding: 10px;
            border-radius: 4px;
            margin-top: 6px;
        }
        .warning-label {
            font-size: 0.62rem;
            color: #e76e55;
            font-weight: bold;
            margin-bottom: 4px;
        }
        .type-label {
            font-size: 0.62rem;
            color: #aaa;
            margin-bottom: 4px;
        }
        .secret-display {
            font-size: 0.62rem;
            color: #ffcc00;
            background: #111;
            padding: 6px;
            border-radius: 4px;
            word-break: break-all;
            white-space: pre-wrap;
            margin: 0 0 8px 0;
            max-height: 120px;
            overflow-y: auto;
            font-family: monospace;
        }
        .btn-row {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 10px;
        }
        .btn {
            padding: 6px 14px;
            font-size: 0.68rem;
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
        .btn-action {
            background: #21262d;
            border: 1px solid #30363d;
            color: #c9d1d9;
        }
        .btn-close {
            background: #1f6feb;
            color: #fff;
        }
    `;

    open(keyName: string, keyFragment: string, pubKey: string, keystoreData: any) {
        this.keyName = keyName;
        this.keyFragment = keyFragment || 'Key';
        this.pubKey = pubKey;
        this._keystoreData = keystoreData;
        this.stage = 'password';
        this.errorMsg = '';
        this.secretValue = '';
        this.isPasswordVisible = false;
        this.isDecrypting = false;
        this.isOpen = true;

        setTimeout(() => {
            const input = this.renderRoot?.querySelector('input') as HTMLInputElement | null;
            if (input) {
                input.value = '';
                input.focus();
            }
        }, 50);
    }

    close() {
        this.isOpen = false;
    }

    private togglePasswordVisibility() {
        this.isPasswordVisible = !this.isPasswordVisible;
    }

    private onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.handleReveal();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
        }
    }

    private deriveSecret(keyName: string, seedBytes: Uint8Array): { label: string; secret: string } {
        const deriveKey = (prefix: string) => {
            const prefixHex = toHex(stringToBytes(prefix));
            const seedHex = toHex(seedBytes);
            return keccak256(concatHex([prefixHex, seedHex]));
        };

        if (keyName.includes('Secp256k1')) {
            return {
                label: 'Secp256k1 Private Signing Key (Hex):',
                secret: deriveKey('sovereign:secp256k1:v1')
            };
        } else if (keyName.includes('Ed25519')) {
            return {
                label: 'Ed25519 Private Seed (Hex):',
                secret: deriveKey('sovereign:ed25519:v1')
            };
        } else if (keyName.includes('BLS')) {
            return {
                label: 'BLS12-381 Private Key Seed (Hex):',
                secret: deriveKey('sovereign:bls:v1')
            };
        } else if (keyName.includes('ML-DSA')) {
            return {
                label: 'ML-DSA-65 Private Seed (Hex):',
                secret: deriveKey('sovereign:mldsa:v1')
            };
        } else if (keyName.includes('SLH-DSA')) {
            return {
                label: 'SLH-DSA Secret PRF & Seed (Hex):',
                secret: deriveKey('sovereign:slhdsa:v1:sk_seed')
            };
        } else if (keyName.includes('Falcon')) {
            return {
                label: 'Falcon-512 Private Seed (Hex):',
                secret: deriveKey('sovereign:falcon:v1')
            };
        } else if (keyName.includes('XMSS')) {
            return {
                label: 'XMSS Private Seed (Hex):',
                secret: deriveKey('sovereign:xmss:v1')
            };
        }
        return {
            label: 'Secret Material (Hex):',
            secret: deriveKey('sovereign:default:v1')
        };
    }

    private async handleReveal() {
        const input = this.renderRoot?.querySelector('input') as HTMLInputElement | null;
        const password = input ? input.value : '';

        if (!password) {
            this.errorMsg = 'Please enter your keystore password.';
            return;
        }

        if (!this._keystoreData) {
            this.errorMsg = 'No encrypted keystore found for connected account. Please unlock or import wallet.';
            return;
        }

        this.isDecrypting = true;
        this.errorMsg = '';

        try {
            const decryptedStr = await decryptData(this._keystoreData, password);
            const decrypted = JSON.parse(decryptedStr);
            const auxSeed = decrypted.auxiliary_seed || '';
            const encoder = new TextEncoder();
            const seedBytes = encoder.encode(auxSeed.padEnd(32, ' ')).slice(0, 32);

            const derived = this.deriveSecret(this.keyName, seedBytes);
            this.secretLabel = derived.label;
            this.secretValue = derived.secret || auxSeed || JSON.stringify(decrypted, null, 2);
            this.stage = 'revealed';
        } catch (err) {
            this.errorMsg = '❌ Incorrect password. Decryption failed.';
        } finally {
            this.isDecrypting = false;
        }
    }

    private copySecret() {
        if (typeof navigator !== 'undefined' && navigator.clipboard && this.secretValue) {
            navigator.clipboard.writeText(this.secretValue);
            const win = window as any;
            if (typeof win.showNesToast === 'function') {
                win.showNesToast('📋 Secret key material copied to clipboard!', 'success', 2000);
            }
        }
    }

    render(): TemplateResult | string {
        if (!this.isOpen) return '';

        return html`
            <div class="modal-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this.close(); }}>
                <div class="modal-card">
                    <p class="modal-title">👁️ Reveal Secret Key Material</p>
                    <div class="desc-text">
                        Enter your wallet keystore password to decrypt and reveal the secret key material for
                        <strong class="key-name-highlight">${this.keyName} (${this.keyFragment})</strong>:
                    </div>

                    ${this.stage === 'password' ? html`
                        <div>
                            <div class="input-row">
                                <input
                                    type=${this.isPasswordVisible ? 'text' : 'password'}
                                    class="text-input"
                                    placeholder="Keystore password"
                                    @keydown=${this.onKeyDown}
                                >
                                <button
                                    type="button"
                                    class="btn-toggle-pw"
                                    @click=${this.togglePasswordVisibility}
                                >${this.isPasswordVisible ? '🙈' : '👁️'}</button>
                            </div>

                            ${this.errorMsg ? html`<div class="error-box">${this.errorMsg}</div>` : ''}

                            <div class="btn-row">
                                <button type="button" class="btn btn-cancel" @click=${this.close}>Cancel</button>
                                <button
                                    type="button"
                                    class="btn btn-confirm"
                                    ?disabled=${this.isDecrypting}
                                    @click=${this.handleReveal}
                                >${this.isDecrypting ? 'Decrypting...' : '🔓 Unlock & Reveal'}</button>
                            </div>
                        </div>
                    ` : html`
                        <div class="result-box">
                            <div class="warning-label">⚠️ CONFIDENTIAL PRIVATE KEY MATERIAL</div>
                            <div class="type-label">${this.secretLabel}</div>
                            <pre class="secret-display">${this.secretValue}</pre>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <button type="button" class="btn btn-action" @click=${this.copySecret}>📋 Copy Secret</button>
                                <button type="button" class="btn btn-close" @click=${this.close}>Close</button>
                            </div>
                        </div>
                    `}
                </div>
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-reveal-key-modal')) {
    customElements.define('sovereign-reveal-key-modal', SovereignRevealKeyModalElement);
}
