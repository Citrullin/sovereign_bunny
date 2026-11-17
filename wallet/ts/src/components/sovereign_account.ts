import { LitElement, html, css, TemplateResult } from 'lit';
import { WalletStateMachine } from '../app/wallet_machine.js';
import { NetworkStateMachine } from '../app/network_machine.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<sovereign-account>` Lit Component
 * Displays balance card, DID badge, ActivityPub handle, and security posture.
 */
export class SovereignAccount extends BaseElement {
    static properties = {
        address: { type: String },
        balance: { type: String },
        ticker: { type: String },
        did: { type: String },
        didRegistered: { type: Boolean },
        activityPubHandle: { type: String },
        activityPubMounted: { type: Boolean },
        epochHeight: { type: Number },
        isPostQuantum: { type: Boolean },
    };

    address: string = '';
    balance: string = '0.0000';
    ticker: string = 'TBL';
    did: string = '';
    didRegistered: boolean = false;
    activityPubHandle: string = '';
    activityPubMounted: boolean = false;
    epochHeight: number = 1;
    isPostQuantum: boolean = true;

    private _walletUnsub: (() => void) | null = null;
    private _networkUnsub: (() => void) | null = null;

    static styles = css`
        :host {
            display: block;
            font-family: inherit;
        }
        .account-card {
            background: #14141e;
            border: 2px solid #2d2d3f;
            border-radius: 8px;
            padding: 16px;
            color: #eee;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .title {
            font-size: 0.85rem;
            color: #888;
            text-transform: uppercase;
        }
        .balance-hero {
            display: flex;
            align-items: baseline;
            gap: 8px;
            margin: 8px 0 16px 0;
        }
        .balance-value {
            font-size: 1.6rem;
            font-weight: bold;
            color: #45f3ff;
            font-family: monospace;
        }
        .balance-ticker {
            font-size: 0.9rem;
            color: #f7d51d;
            font-weight: bold;
        }
        .meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            font-size: 0.75rem;
        }
        .meta-item {
            background: #1c1c2b;
            padding: 8px 10px;
            border-radius: 4px;
            border: 1px solid #333;
        }
        .meta-label {
            color: #777;
            font-size: 0.65rem;
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        .meta-value {
            font-family: monospace;
            word-break: break-all;
            color: #fff;
        }
        .badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.65rem;
            font-weight: bold;
        }
        .badge-success { background: #114422; color: #45f3ff; border: 1px solid #45f3ff; }
        .badge-warning { background: #443311; color: #f7d51d; border: 1px solid #f7d51d; }
        .badge-pq { background: #2a1b4e; color: #d175ff; border: 1px solid #d175ff; }
    `;

    bindMachines(wallet: WalletStateMachine, network: NetworkStateMachine): void {
        this._walletUnsub?.();
        this._networkUnsub?.();

        const walletSnap = wallet.getSnapshot();
        this.address = walletSnap.context.connectedAddress || '';
        const activeProfile = walletSnap.context.profiles[walletSnap.context.activeProfileIndex];
        if (activeProfile) {
            this.did = activeProfile.did || '';
            this.didRegistered = !!activeProfile.registered;
            this.activityPubHandle = activeProfile.activityPubHandle || `@${this.address.slice(0, 8)}@sovereign`;
        }

        const netSnap = network.getSnapshot();
        this.epochHeight = netSnap.context.epochHeight;

        this._walletUnsub = wallet.subscribe((snap) => {
            const ctx = snap.context;
            this.address = ctx.connectedAddress || '';
            const profile = ctx.profiles[ctx.activeProfileIndex];
            if (profile) {
                this.did = profile.did || '';
                this.didRegistered = !!profile.registered;
                this.activityPubHandle = profile.activityPubHandle || `@${this.address.slice(0, 8)}@sovereign`;
            }
            this.requestUpdate();
        });

        this._networkUnsub = network.subscribe((snap) => {
            this.epochHeight = snap.context.epochHeight;
            this.requestUpdate();
        });
    }

    disconnectedCallback(): void {
        super.disconnectedCallback?.();
        this._walletUnsub?.();
        this._networkUnsub?.();
    }

    render(): TemplateResult {
        return html`
            <div class="account-card">
                <div class="header">
                    <span class="title">Active Sovereign Account</span>
                    <span class="badge badge-pq">🛡️ EIP-8141 ML-DSA-65</span>
                </div>

                <div class="balance-hero">
                    <div class="balance-value">${this.balance}</div>
                    <div class="balance-ticker">${this.ticker}</div>
                </div>

                <div class="meta-grid">
                    <div class="meta-item">
                        <div class="meta-label">Controller Address</div>
                        <div class="meta-value">${this.address || 'Not Connected'}</div>
                    </div>

                    <div class="meta-item">
                        <div class="meta-label">Decentralized Identifier</div>
                        <div class="meta-value">
                            ${this.did || 'None'}
                            <span class="badge ${this.didRegistered ? 'badge-success' : 'badge-warning'}">
                                ${this.didRegistered ? 'Registered' : 'Unregistered'}
                            </span>
                        </div>
                    </div>

                    <div class="meta-item">
                        <div class="meta-label">ActivityPub Actor</div>
                        <div class="meta-value">
                            ${this.activityPubHandle || 'None'}
                            <span class="badge ${this.activityPubMounted ? 'badge-success' : 'badge-warning'}">
                                ${this.activityPubMounted ? 'Slot Mounted' : 'Unmounted'}
                            </span>
                        </div>
                    </div>

                    <div class="meta-item">
                        <div class="meta-label">Network Finalized Epoch</div>
                        <div class="meta-value">Epoch ${this.epochHeight}</div>
                    </div>
                </div>
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-account')) {
    customElements.define('sovereign-account', SovereignAccount);
}
