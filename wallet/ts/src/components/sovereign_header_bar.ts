import { LitElement, html, css, TemplateResult } from 'lit';
import { WalletStateMachine, WalletState } from '../app/wallet_machine.js';
import { NetworkStateMachine, NetworkState } from '../app/network_machine.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<sovereign-header-bar>` Lit Component
 * Adheres strictly to the Single Responsibility Principle (SRP).
 * Responsible solely for the application top navigation bar, status badges,
 * and active wallet/connection indicators by reacting to XState machine snapshots.
 */
export class SovereignHeaderBar extends BaseElement {
    static properties = {
        apiMode: { type: String },
        cryptoWrap: { type: String },
        isQuantumSecure: { type: Boolean },
        allowLegacy: { type: Boolean },
        isRegistered: { type: Boolean },
        connectedAddress: { type: String },
        walletState: { type: String },
        networkState: { type: String },
        epochHeight: { type: Number },
        peerCount: { type: Number },
    };

    apiMode: string = 'legacy';
    cryptoWrap: string = 'wrapped';
    isQuantumSecure: boolean = true;
    allowLegacy: boolean = false;
    isRegistered: boolean = true;
    connectedAddress: string = '';
    walletState: WalletState = 'locked';
    networkState: NetworkState = 'disconnected';
    epochHeight: number = 1;
    peerCount: number = 0;

    private _walletUnsub: (() => void) | null = null;
    private _networkUnsub: (() => void) | null = null;

    static styles = css`
        :host {
            display: block;
            width: 100%;
            margin-bottom: 25px;
            border-bottom: 4px solid #fff;
            padding-bottom: 15px;
            font-family: inherit;
        }
        .header-container {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 12px;
        }
        .brand-section {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
        }
        .title {
            font-size: 1.4rem;
            margin: 0;
            color: #ff0;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .badge-group {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
        }
        .badge {
            font-size: 0.55rem;
            padding: 3px 8px;
            border-radius: 4px;
            font-family: monospace;
            font-weight: bold;
            text-transform: uppercase;
        }
        .badge-legacy { background: #209cee; color: #fff; }
        .badge-modern { background: #92cc41; color: #000; }
        .badge-wrapped { background: #f7d51d; color: #000; }
        .badge-pure { background: #e76e55; color: #fff; }
        .badge-secure { background: #92cc41; color: #000; }
        .badge-vulnerable { background: #e76e55; color: #fff; }
        .badge-unregistered { background: #f7d51d; color: #000; }
        .actions-section {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        .btn {
            padding: 4px 10px;
            font-size: 0.7rem;
            font-family: inherit;
            cursor: pointer;
            border-radius: 4px;
            font-weight: bold;
            border: 2px solid;
            transition: all 0.15s ease;
        }
        .btn-settings {
            background: #209cee;
            color: #fff;
            border-color: #1072b8;
        }
        .btn-wallet-connected {
            background: #222;
            color: #66fcf1;
            border-color: #66fcf1;
            font-family: monospace;
        }
        .btn-wallet-locked {
            background: #e76e55;
            color: #fff;
            border-color: #8f230f;
        }
    `;

    bindMachines(walletMachine: WalletStateMachine, networkMachine?: NetworkStateMachine): void {
        if (this._walletUnsub) this._walletUnsub();
        if (this._networkUnsub) this._networkUnsub();

        const wSnap = walletMachine.getSnapshot();
        this.walletState = wSnap.value;
        this.connectedAddress = wSnap.context.connectedAddress || '';

        this._walletUnsub = walletMachine.subscribe((snap) => {
            this.walletState = snap.value;
            this.connectedAddress = snap.context.connectedAddress || '';
            this.requestUpdate();
        });

        if (networkMachine) {
            const nSnap = networkMachine.getSnapshot();
            this.networkState = nSnap.value;
            this.epochHeight = nSnap.context.epochHeight;
            this.peerCount = nSnap.context.peerCount;

            this._networkUnsub = networkMachine.subscribe((snap) => {
                this.networkState = snap.value;
                this.epochHeight = snap.context.epochHeight;
                this.peerCount = snap.context.peerCount;
                this.requestUpdate();
            });
        }
    }

    disconnectedCallback(): void {
        super.disconnectedCallback?.();
        if (this._walletUnsub) {
            this._walletUnsub();
            this._walletUnsub = null;
        }
        if (this._networkUnsub) {
            this._networkUnsub();
            this._networkUnsub = null;
        }
    }

    onSettingsClick(): void {
        this.dispatchEvent(new CustomEvent('open-settings-requested', { bubbles: true, composed: true }));
        const modal = document.querySelector('sovereign-settings-modal') as any;
        if (modal && typeof modal.open === 'function') {
            modal.open();
        }
    }

    onWalletClick(): void {
        this.dispatchEvent(new CustomEvent('wallet-action-requested', {
            bubbles: true,
            composed: true,
            detail: { address: this.connectedAddress, state: this.walletState }
        }));
    }

    createRenderRoot(): HTMLElement {
        return this as unknown as HTMLElement;
    }

    render(): any {
        const addrDisplay = this.connectedAddress
            ? `Rabby: ${this.connectedAddress.slice(0, 6)}...${this.connectedAddress.slice(-4)}`
            : (this.walletState === 'locked' ? 'Rabby: Locked' : 'Rabby: Disconnected');

        const htmlStr = `
            <header style="margin-bottom: 25px; border-bottom: 4px solid #fff; padding-bottom: 15px;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <h1 style="font-size: 1.4rem; margin: 0; color: #ff0; display: flex; align-items: center; gap: 8px;">
                            <span>⭐</span> Sovereign Wallet
                        </h1>
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span id="header-api-badge" class="nes-badge" style="font-size: 0.55rem;">
                                <span class="${this.apiMode === 'modern' ? 'is-success' : 'is-primary'}">
                                    API: ${this.apiMode === 'modern' ? 'Modern (CAIP)' : 'Legacy'}
                                </span>
                            </span>
                            ${this.apiMode === 'legacy' ? `
                                <span id="header-wrap-badge" class="nes-badge" style="font-size: 0.55rem;">
                                    <span class="${this.cryptoWrap === 'wrapped' ? 'is-warning' : 'is-error'}">
                                        Wrap: ${this.cryptoWrap === 'wrapped' ? 'Quantum' : 'Pure Classical'}
                                    </span>
                                </span>
                            ` : ''}
                            <span id="header-security-badge" class="nes-badge" style="font-size: 0.55rem;">
                                <span class="${this.isQuantumSecure ? 'is-success' : (this.allowLegacy ? 'is-error' : 'is-warning')}">
                                    PQ: ${this.isQuantumSecure ? 'Secure' : (this.allowLegacy ? 'Vulnerable' : 'Unregistered')}
                                </span>
                            </span>
                            ${this.epochHeight > 0 ? `
                                <span class="nes-badge" style="font-size: 0.55rem;">
                                    <span class="is-dark">Epoch ${this.epochHeight}</span>
                                </span>
                            ` : ''}
                        </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <button type="button" class="nes-btn is-primary" id="open-settings-btn" style="padding: 3px 10px; font-size: 0.65rem;">
                            ⚙️ Settings
                        </button>
                        <button
                            type="button"
                            class="nes-btn ${this.connectedAddress ? 'is-success' : 'is-error'}"
                            id="active-wallet-address"
                            style="padding: 3px 10px; font-size: 0.7rem; font-family: monospace;"
                        >
                            ${addrDisplay}
                        </button>
                    </div>
                </div>
            </header>
        `;

        this.innerHTML = htmlStr;
        if (typeof this.querySelector !== 'function') return typeof html !== 'undefined' ? html`<div .innerHTML="${htmlStr}"></div>` : undefined;

        const settingsBtn = this.querySelector('#open-settings-btn') as HTMLElement | null;
        if (settingsBtn) {
            settingsBtn.onclick = () => this.onSettingsClick();
        }
        const walletBtn = this.querySelector('#active-wallet-address') as HTMLElement | null;
        if (walletBtn) {
            walletBtn.onclick = () => this.onWalletClick();
        }

        return typeof html !== 'undefined' ? html`<div .innerHTML="${htmlStr}"></div>` : undefined;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-header-bar')) {
    customElements.define('sovereign-header-bar', SovereignHeaderBar);
}
