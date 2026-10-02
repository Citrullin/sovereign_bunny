import { LitElement, html, css, TemplateResult } from 'lit';
import type { WalletProfile } from '../app/globals.js';
import { WalletStateMachine, WalletState } from '../app/wallet_machine.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<sovereign-wallet>` Lit Component
 * Responsible for profile selection, onboarding wizard, and key status.
 */
export class SovereignWallet extends BaseElement {
    static properties = {
        step: { type: Number },
        profiles: { type: Array },
        activeProfileIndex: { type: Number },
        connectedAddress: { type: String },
        walletState: { type: String },
        errorMessage: { type: String },
    };

    step: number = 1;
    profiles: WalletProfile[] = [];
    activeProfileIndex: number = -1;
    connectedAddress: string = '';
    walletState: WalletState = 'locked';
    errorMessage: string = '';

    private _walletActor: WalletStateMachine | null = null;
    private _unsubscribe: (() => void) | null = null;

    static styles = css`
        :host {
            display: block;
            font-family: inherit;
        }
        .wallet-card {
            background: #1a1a24;
            border: 2px solid #3a3a4c;
            border-radius: 8px;
            padding: 16px;
            color: #eee;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            border-bottom: 1px solid #333;
            padding-bottom: 8px;
        }
        .title {
            font-size: 0.9rem;
            font-weight: bold;
            color: #66fcf1;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .state-badge {
            font-size: 0.7rem;
            padding: 2px 8px;
            border-radius: 4px;
            text-transform: uppercase;
            font-weight: bold;
        }
        .state-locked { background: #551111; color: #ff6b6b; border: 1px solid #ff6b6b; }
        .state-unlocking { background: #554411; color: #f7d51d; border: 1px solid #f7d51d; }
        .state-ready { background: #114422; color: #45f3ff; border: 1px solid #45f3ff; }
        .state-syncing { background: #223355; color: #66fcf1; border: 1px solid #66fcf1; }

        .profile-list {
            margin: 12px 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .profile-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: #242436;
            border: 1px solid #444;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .profile-item:hover {
            border-color: #66fcf1;
            background: #2b2b40;
        }
        .profile-item.active {
            border-color: #45f3ff;
            background: #1f333a;
        }
        .profile-addr {
            font-family: monospace;
            font-size: 0.75rem;
            color: #fff;
        }
        .profile-did {
            font-size: 0.65rem;
            color: #888;
        }
        .btn {
            background: #0b0c10;
            color: #66fcf1;
            border: 1px solid #45a29e;
            padding: 6px 12px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: bold;
        }
        .btn:hover:not(:disabled) {
            background: #1f2833;
            border-color: #66fcf1;
        }
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .btn-danger {
            color: #ff6b6b;
            border-color: #ff4444;
        }
        .btn-danger:hover:not(:disabled) {
            background: #331111;
        }
        .error-banner {
            background: #3b1111;
            border: 1px solid #ff4444;
            color: #ff9999;
            padding: 6px 10px;
            font-size: 0.7rem;
            border-radius: 4px;
            margin-top: 8px;
        }
        .wizard-steps {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
        }
        .wizard-step-indicator {
            flex: 1;
            text-align: center;
            padding: 4px;
            font-size: 0.65rem;
            border-radius: 3px;
            background: #222;
            color: #777;
        }
        .wizard-step-indicator.active {
            background: #1f333a;
            color: #66fcf1;
            border: 1px solid #45a29e;
        }
    `;

    setWalletActor(actor: WalletStateMachine): void {
        if (this._unsubscribe) {
            this._unsubscribe();
        }
        this._walletActor = actor;
        const initialSnap = actor.getSnapshot();
        this.walletState = initialSnap.value;
        this.profiles = initialSnap.context.profiles;
        this.activeProfileIndex = initialSnap.context.activeProfileIndex;
        this.connectedAddress = initialSnap.context.connectedAddress || '';
        this.errorMessage = initialSnap.context.error || '';

        this._unsubscribe = actor.subscribe((snapshot) => {
            this.walletState = snapshot.value;
            this.profiles = snapshot.context.profiles;
            this.activeProfileIndex = snapshot.context.activeProfileIndex;
            this.connectedAddress = snapshot.context.connectedAddress || '';
            this.errorMessage = snapshot.context.error || '';
            this.requestUpdate();
        });
    }

    disconnectedCallback(): void {
        super.disconnectedCallback?.();
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
    }

    switchProfile(index: number): void {
        this._walletActor?.send({ type: 'SWITCH_PROFILE', index });
        this.dispatchEvent(new CustomEvent('profile-switched', { detail: { index } }));
    }

    lockWallet(): void {
        this._walletActor?.send({ type: 'LOCK' });
        this.dispatchEvent(new CustomEvent('wallet-locked'));
    }

    render(): TemplateResult {
        const hasProfiles = this.profiles && this.profiles.length > 0;

        return html`
            <div class="wallet-card">
                <div class="header">
                    <span class="title">🔐 Sovereign Wallet</span>
                    <span class="state-badge state-${this.walletState}">
                        ${this.walletState}
                    </span>
                </div>

                ${this.errorMessage ? html`<div class="error-banner">⚠️ ${this.errorMessage}</div>` : ''}

                <div class="wizard-steps">
                    <div class="wizard-step-indicator ${this.step === 1 ? 'active' : ''}">1. Connect</div>
                    <div class="wizard-step-indicator ${this.step === 2 ? 'active' : ''}">2. Storage</div>
                    <div class="wizard-step-indicator ${this.step === 3 ? 'active' : ''}">3. Unlock / Keys</div>
                </div>

                ${hasProfiles
                    ? html`
                          <div class="profile-list">
                              ${this.profiles.map(
                                  (p, idx) => html`
                                      <div
                                          class="profile-item ${idx === this.activeProfileIndex ? 'active' : ''}"
                                          @click=${() => this.switchProfile(idx)}
                                      >
                                          <div>
                                              <div class="profile-addr">${p.address}</div>
                                              <div class="profile-did">${p.did}</div>
                                          </div>
                                          ${idx === this.activeProfileIndex
                                              ? html`<span style="color:#45f3ff; font-size:0.7rem;">● Active</span>`
                                              : ''}
                                      </div>
                                  `
                              )}
                          </div>
                      `
                    : html`
                          <div style="font-size:0.75rem; color:#888; text-align:center; padding: 12px 0;">
                              No local profiles discovered. Connect account or initialize keystore.
                          </div>
                      `}

                <div style="display:flex; justify-content: flex-end; gap:8px; margin-top:12px;">
                    ${this.walletState === 'ready'
                        ? html`
                              <button class="btn btn-danger" @click=${this.lockWallet}>Lock</button>
                          `
                        : ''}
                </div>
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-wallet')) {
    customElements.define('sovereign-wallet', SovereignWallet);
}
