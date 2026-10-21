import { LitElement, html, css, TemplateResult } from 'lit';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

export interface SovereignSettings {
    devMode: boolean;
    apiMode: 'legacy' | 'modern';
    cryptoWrap: 'wrapped' | 'pure';
    allowLegacy: boolean;
    reclaimTimeout: number;
    currencyTicker: string;
    rpcEndpoint: string;
    storageEndpoint: string;
}

/**
 * `<sovereign-settings-modal>` Lit Component
 * Encapsulates the API protocol, cryptography, and network settings dialog.
 * Replaces legacy #settings-modal static DOM elements.
 */
export class SovereignSettingsModalElement extends BaseElement {
    static properties = {
        isOpen: { type: Boolean, state: true },
        devMode: { type: Boolean, state: true },
        apiMode: { type: String, state: true },
        cryptoWrap: { type: String, state: true },
        allowLegacy: { type: Boolean, state: true },
        reclaimTimeout: { type: Number, state: true },
        currencyTicker: { type: String, state: true },
        rpcEndpoint: { type: String, state: true },
        storageEndpoint: { type: String, state: true },
    };

    isOpen: boolean = false;
    devMode: boolean = false;
    apiMode: 'legacy' | 'modern' = 'legacy';
    cryptoWrap: 'wrapped' | 'pure' = 'wrapped';
    allowLegacy: boolean = false;
    reclaimTimeout: number = 10;
    currencyTicker: string = 'TBL';
    rpcEndpoint: string = '/rpc';
    storageEndpoint: string = '/storage';

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
            z-index: 10004;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 15px;
            box-sizing: border-box;
        }
        .modal-card {
            width: 90%;
            max-width: 580px;
            max-height: 90vh;
            overflow-y: auto;
            background: #111528;
            border: 3px solid #66fcf1;
            box-shadow: 0 0 20px rgba(102, 252, 241, 0.3);
            border-radius: 8px;
            padding: 20px;
            color: #eee;
            font-size: 0.7rem;
            box-sizing: border-box;
        }
        .modal-title {
            color: #66fcf1;
            font-size: 0.95rem;
            margin: 0 0 16px 0;
            font-weight: bold;
        }
        .section-box {
            margin-bottom: 15px;
            padding: 12px;
            background: #090c15;
            border: 1px solid #30363d;
            border-radius: 6px;
        }
        .section-box.warning-border {
            border-color: #ffcc00;
            background: #1a1600;
        }
        .section-box.danger-border {
            border: 1px dashed #ff5555;
            background: #1a1010;
        }
        .section-title {
            color: #ffcc00;
            font-weight: bold;
            margin-bottom: 8px;
            display: block;
        }
        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
        }
        .hint-text {
            font-size: 0.62rem;
            color: #8b949e;
            display: block;
            margin-top: 4px;
            line-height: 1.4;
        }
        .hint-text.alert {
            color: #ff5555;
        }
        .field-group {
            margin-bottom: 12px;
        }
        .field-label {
            color: #ffcc00;
            display: block;
            margin-bottom: 4px;
            font-size: 0.68rem;
        }
        .text-input, .select-input {
            width: 100%;
            padding: 6px 10px;
            background: #090c15;
            border: 1px solid #45f3ff;
            color: #fff;
            font-size: 0.68rem;
            border-radius: 4px;
            outline: none;
            box-sizing: border-box;
            font-family: inherit;
        }
        .btn-row {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 20px;
        }
        .btn {
            padding: 8px 16px;
            font-size: 0.7rem;
            font-weight: bold;
            cursor: pointer;
            border: none;
            border-radius: 4px;
        }
        .btn-primary {
            background: #238636;
            color: #fff;
        }
        .btn-danger {
            background: #da3633;
            color: #fff;
            width: 100%;
        }
    `;

    createRenderRoot(): HTMLElement {
        return this as unknown as HTMLElement;
    }

    open(currentSettings?: Partial<SovereignSettings>) {
        if (currentSettings) {
            if (currentSettings.devMode !== undefined) this.devMode = currentSettings.devMode;
            if (currentSettings.apiMode !== undefined) this.apiMode = currentSettings.apiMode;
            if (currentSettings.cryptoWrap !== undefined) this.cryptoWrap = currentSettings.cryptoWrap;
            if (currentSettings.allowLegacy !== undefined) this.allowLegacy = currentSettings.allowLegacy;
            if (currentSettings.reclaimTimeout !== undefined) this.reclaimTimeout = currentSettings.reclaimTimeout;
            if (currentSettings.currencyTicker !== undefined) this.currencyTicker = currentSettings.currencyTicker;
            if (currentSettings.rpcEndpoint !== undefined) this.rpcEndpoint = currentSettings.rpcEndpoint;
            if (currentSettings.storageEndpoint !== undefined) this.storageEndpoint = currentSettings.storageEndpoint;
        }
        this.isOpen = true;
    }

    close() {
        this.isOpen = false;
    }

    private saveAndClose() {
        const settings: SovereignSettings = {
            devMode: this.devMode,
            apiMode: this.apiMode,
            cryptoWrap: this.cryptoWrap,
            allowLegacy: this.allowLegacy,
            reclaimTimeout: this.reclaimTimeout,
            currencyTicker: this.currencyTicker,
            rpcEndpoint: this.rpcEndpoint,
            storageEndpoint: this.storageEndpoint,
        };

        this.dispatchEvent(new CustomEvent('settings-saved', {
            bubbles: true,
            composed: true,
            detail: settings
        }));

        const win = window as any;
        if (typeof win.applySettingsFromComponent === 'function') {
            win.applySettingsFromComponent(settings);
        }

        this.close();
    }

    private clearCache() {
        const win = window as any;
        if (typeof win.clearInstanceData === 'function') {
            win.clearInstanceData();
        } else if (typeof win.showNativeConfirm === 'function') {
            win.showNativeConfirm('Purge unconfirmed states, outbox and cache data?', 'Clear Cache').then((ok: boolean) => {
                if (ok && typeof win.showNesToast === 'function') {
                    localStorage.removeItem('sovereign_outbox_queue');
                    win.showNesToast('🧹 Cache cleared successfully.', 'success', 2000);
                }
            });
        }
    }

    render(): TemplateResult | string {
        if (!this.isOpen) return '';

        return html`
            <div class="modal-overlay" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.85); z-index: 10004; display: flex; justify-content: center; align-items: center; padding: 15px; box-sizing: border-box;" @click=${(e: Event) => { if (e.target === e.currentTarget) this.close(); }}>
                <div class="nes-container is-dark with-title" style="width: 90%; max-width: 600px; max-height: 90vh; overflow-y: auto; background: #212529; border: 4px solid #66fcf1; box-shadow: 0 8px #000; padding: 25px 20px 20px 20px; color: #fff; font-size: 0.7rem; box-sizing: border-box;">
                    <p class="title" style="color: #66fcf1; background: #212529; font-size: 0.8rem; font-family: 'Press Start 2P', monospace;">⚙️ SETTINGS</p>

                    <!-- Developer Mode Toggle -->
                    <div class="section-box warning-border" style="margin-bottom: 15px; padding: 12px; background: #1a1600; border: 2px dashed #ffcc00; border-radius: 4px;">
                        <label class="section-title" style="color: #ffcc00; font-weight: bold; margin-bottom: 8px; display: block;">🛠️ Developer Options:</label>
                        <label class="checkbox-row" style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input
                                type="checkbox"
                                class="nes-checkbox is-dark"
                                ?checked=${this.devMode}
                                @change=${(e: Event) => { this.devMode = (e.target as HTMLInputElement).checked; }}
                            >
                            <span>Enable Developer Mode</span>
                        </label>
                        ${this.devMode ? html`
                            <span class="hint-text" style="color: #ffcc00; margin-top: 8px; font-size: 0.62rem; display: block; line-height: 1.4;">
                                ⚠️ <b>WARNING:</b> Developer mode exposes experimental CAIP-25/gRPC streaming, bare-metal bytecode debugging, Iroh DA storage uploads, and cache purging controls.
                            </span>
                        ` : ''}
                    </div>

                    <!-- Cryptographic Execution Mode (Legacy API) -->
                    <div class="section-box" style="margin-bottom: 15px; padding: 12px; background: #090c15; border: 1px solid #30363d; border-radius: 4px;">
                        <label class="field-label" style="color: #ffcc00; display: block; margin-bottom: 4px; font-size: 0.68rem;">Cryptographic Execution Mode:</label>
                        <div class="nes-select is-dark">
                            <select
                                style="font-size: 0.68rem;"
                                .value=${this.cryptoWrap}
                                @change=${(e: Event) => { this.cryptoWrap = (e.target as HTMLSelectElement).value as any; }}
                            >
                                <option value="pure">Legacy Pure Crypto (EIP-712 Structured Rabby/MetaMask Signing)</option>
                                <option value="wrapped">Quantum Wrapper (Zero-Touch Post-Quantum Settlement)</option>
                            </select>
                        </div>
                        <span class="hint-text" style="color: #66fcf1; font-size: 0.62rem; display: block; margin-top: 4px; line-height: 1.4;">
                            ${this.cryptoWrap === 'pure' 
                                ? '🛡️ Pure Mode: Dispatches transactions and signatures through your connected EVM wallet extension (Rabby/MetaMask) with interactive signature prompts.' 
                                : '⚡ Quantum Wrapper: Settles lattice blocks via in-WASM ML-DSA zero-touch post-quantum signatures.'}
                        </span>
                    </div>

                    ${this.devMode ? html`
                        <!-- API Protocol Architecture -->
                        <div class="field-group" style="margin-bottom: 12px;">
                            <label class="field-label" style="color: #ffcc00; display: block; margin-bottom: 4px; font-size: 0.68rem;">API Protocol Architecture:</label>
                            <div class="nes-select is-dark">
                                <select
                                    style="font-size: 0.68rem;"
                                    .value=${this.apiMode}
                                    @change=${(e: Event) => { this.apiMode = (e.target as HTMLSelectElement).value as any; }}
                                >
                                    <option value="legacy">Legacy API (EVM Bytecode Precompiles / EIP-1193)</option>
                                    <option value="modern">Modern API (CAIP-25 / gRPC over HTTP-3 / CBOR)</option>
                                </select>
                            </div>
                            <span class="hint-text" style="font-size: 0.62rem; color: #8b949e; display: block; margin-top: 4px; line-height: 1.4;">Legacy API runs via standard EVM bytecode transactions. Modern API uses high-speed CAIP/gRPC streaming.</span>
                        </div>

                        ${this.apiMode === 'modern' ? html`
                            <div class="section-box" style="background: #002b36; border: 2px solid #2aa198; padding: 12px; border-radius: 4px; margin-bottom: 15px;">
                                <span style="color: #2aa198; font-weight: bold;">⚡ Modern CAIP-25 / gRPC Mode Active:</span><br>
                                <span class="hint-text" style="color: #eee; font-size: 0.62rem; display: block; margin-top: 4px; line-height: 1.4;">Post-Quantum state transitions are dispatched natively via StatelessTransitionFrames over HTTP/3 (QUIC). No outer Secp256k1 wrapper needed!</span>
                            </div>
                        ` : ''}
                    ` : ''}

                    <!-- Account Security Policy -->
                    <div class="section-box" style="margin-bottom: 15px; padding: 12px; background: #090c15; border: 1px solid #30363d; border-radius: 4px;">
                        <label class="field-label" style="color: #ffcc00; display: block; margin-bottom: 4px; font-size: 0.68rem;">Account Security Policy (ALLOW_LEGACY):</label>
                        <label class="checkbox-row" style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input
                                type="checkbox"
                                class="nes-checkbox is-dark"
                                ?checked=${this.allowLegacy}
                                @change=${(e: Event) => { this.allowLegacy = (e.target as HTMLInputElement).checked; }}
                            >
                            <span>Permit Classical Secp256k1 Transactions (ALLOW_LEGACY=true)</span>
                        </label>
                        <span class="hint-text alert" style="color: #ff5555; font-size: 0.62rem; display: block; margin-top: 4px; line-height: 1.4;">⚠️ WARNING: Enabling this allows transactions without post-quantum signatures. Sovereign defaults to strict post-quantum security.</span>
                    </div>

                    <!-- Auto-Reclaim Timeout -->
                    <div class="field-group" style="margin-bottom: 12px;">
                        <label class="field-label" style="color: #ffcc00; display: block; margin-bottom: 4px; font-size: 0.68rem;">Lattice Send Auto-Reclaim Timeout (Epochs):</label>
                        <input
                            type="number"
                            class="nes-input is-dark"
                            style="font-size: 0.68rem;"
                            min="1"
                            max="1000"
                            .value=${String(this.reclaimTimeout)}
                            @change=${(e: Event) => { this.reclaimTimeout = parseInt((e.target as HTMLInputElement).value) || 10; }}
                        >
                        <span class="hint-text" style="font-size: 0.62rem; color: #8b949e; display: block; margin-top: 4px; line-height: 1.4;">Unclaimed send transactions can be reclaimed by sender after this many epochs (32 blocks/epoch). Default: 10 epochs.</span>
                    </div>

                    <!-- Native Currency Ticker -->
                    <div class="field-group" style="margin-bottom: 12px;">
                        <label class="field-label" style="color: #ffcc00; display: block; margin-bottom: 4px; font-size: 0.68rem;">Native Currency Ticker:</label>
                        <input
                            type="text"
                            class="nes-input is-dark"
                            style="font-size: 0.68rem;"
                            .value=${this.currencyTicker}
                            @change=${(e: Event) => { this.currencyTicker = (e.target as HTMLInputElement).value || 'TBL'; }}
                        >
                        <span class="hint-text" style="font-size: 0.62rem; color: #8b949e; display: block; margin-top: 4px; line-height: 1.4;">Configure display ticker for native balance and transactions (Default: TBL).</span>
                    </div>

                    <!-- Custom Endpoints -->
                    <div class="field-group" style="margin-bottom: 12px;">
                        <label class="field-label" style="color: #ffcc00; display: block; margin-bottom: 4px; font-size: 0.68rem;">Lattice JSON-RPC Endpoint:</label>
                        <input
                            type="text"
                            class="nes-input is-dark"
                            style="font-size: 0.68rem;"
                            .value=${this.rpcEndpoint}
                            @change=${(e: Event) => { this.rpcEndpoint = (e.target as HTMLInputElement).value || '/rpc'; }}
                        >
                    </div>
                    <div class="field-group" style="margin-bottom: 12px;">
                        <label class="field-label" style="color: #ffcc00; display: block; margin-bottom: 4px; font-size: 0.68rem;">Iroh Storage DA Port:</label>
                        <input
                            type="text"
                            class="nes-input is-dark"
                            style="font-size: 0.68rem;"
                            .value=${this.storageEndpoint}
                            @change=${(e: Event) => { this.storageEndpoint = (e.target as HTMLInputElement).value || '/storage'; }}
                        >
                    </div>

                    ${this.devMode ? html`
                        <!-- Dev Tools & Cache Reset -->
                        <div class="section-box danger-border" style="margin-bottom: 15px; padding: 12px; background: #1a1010; border: 2px dashed #ff5555; border-radius: 4px;">
                            <label style="color: #ff5555; display: block; margin-bottom: 5px; font-weight: bold;">🛠️ Developer Mode & Cache Management:</label>
                            <span class="hint-text" style="color: #bbb; margin-bottom: 8px; font-size: 0.62rem; display: block; line-height: 1.4;">Purges temporary activitypub outbox cache, transaction history, nonces, and unconfirmed states. <strong>Preserves your encrypted keystores, private keys, and addresses.</strong></span>
                            <button type="button" class="nes-btn is-error" style="width: 100%; font-size: 0.7rem;" @click=${this.clearCache}>🧹 Clear Instance / Cache Data</button>
                        </div>
                    ` : ''}

                    <div style="display: flex; justify-content: space-between; gap: 10px; margin-top: 20px;">
                        <button type="button" class="nes-btn is-error" style="font-size: 0.7rem;" @click=${this.close}>Close</button>
                        <button type="button" class="nes-btn is-success" style="font-size: 0.7rem;" @click=${this.saveAndClose}>Save & Close</button>
                    </div>
                </div>
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-settings-modal')) {
    customElements.define('sovereign-settings-modal', SovereignSettingsModalElement);
}
