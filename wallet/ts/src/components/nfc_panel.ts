import { LitElement, html, css, TemplateResult } from 'lit';
import { NfcStateMachine, NfcState } from '../app/nfc_machine.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<nfc-panel>` Lit Component
 * Hardware NFC tag interaction, Model 1 bounded debit, and Model 3 PIN-based nullifier voucher redemption.
 */
export class NfcPanel extends BaseElement {
    static properties = {
        state: { type: String },
        model: { type: Number },
        pin: { type: String },
        error: { type: String },
        nullifier: { type: String },
        recipientAddress: { type: String },
    };

    state: NfcState = 'idle';
    model: 1 | 2 | 3 | null = null;
    pin: string = '';
    error: string = '';
    nullifier: string = '';
    recipientAddress: string = '';

    private _nfcMachine: NfcStateMachine | null = null;
    private _unsub: (() => void) | null = null;

    static styles = css`
        :host {
            display: block;
            font-family: inherit;
        }
        .nfc-card {
            background: #121820;
            border: 2px solid #233549;
            border-radius: 8px;
            padding: 16px;
            color: #eee;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            border-bottom: 1px solid #1e293b;
            padding-bottom: 8px;
        }
        .title {
            font-size: 0.9rem;
            color: #66fcf1;
            font-weight: bold;
        }
        .status-badge {
            font-size: 0.7rem;
            padding: 2px 8px;
            border-radius: 4px;
            text-transform: uppercase;
            font-weight: bold;
        }
        .status-idle { background: #222; color: #888; }
        .status-scanning { background: #554411; color: #facc15; }
        .status-tag_read { background: #114422; color: #4ade80; }
        .status-verifying_proof { background: #2a1b4e; color: #c084fc; }
        .status-absorbing { background: #1f333a; color: #38bdf8; }
        .status-done { background: #114422; color: #4ade80; }
        .status-error { background: #441111; color: #fb7185; }

        .btn {
            background: #1e293b;
            border: 1px solid #334155;
            color: #66fcf1;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.75rem;
            font-weight: bold;
        }
        .btn:hover {
            background: #2a3a4e;
        }
        .input-group {
            margin: 12px 0;
            display: flex;
            gap: 8px;
        }
        input {
            background: #0d131a;
            border: 1px solid #334155;
            color: #fff;
            padding: 6px 10px;
            border-radius: 4px;
            font-family: inherit;
            font-size: 0.8rem;
        }
    `;

    bindMachine(machine: NfcStateMachine): void {
        this._unsub?.();
        this._nfcMachine = machine;
        const initialSnap = machine.getSnapshot();
        this.state = initialSnap.value;
        this.model = initialSnap.context.model;
        this.nullifier = initialSnap.context.nullifier || '';
        this.recipientAddress = initialSnap.context.recipientAddress || '';
        this.error = initialSnap.context.error || '';

        this._unsub = machine.subscribe((snap) => {
            this.state = snap.value;
            this.model = snap.context.model;
            this.nullifier = snap.context.nullifier || '';
            this.recipientAddress = snap.context.recipientAddress || '';
            this.error = snap.context.error || '';
            this.requestUpdate();
        });
    }

    disconnectedCallback(): void {
        super.disconnectedCallback?.();
        this._unsub?.();
    }

    startScan(): void {
        this._nfcMachine?.send({ type: 'START_SCAN' });
    }

    verifyPin(): void {
        this._nfcMachine?.send({ type: 'VERIFY_PROOF', pin: this.pin });
    }

    render(): TemplateResult {
        return html`
            <div class="nfc-card">
                <div class="header">
                    <span class="title">📱 Hardware NFC & ZK-Nullifier Terminal</span>
                    <span class="status-badge status-${this.state}">${this.state}</span>
                </div>

                <p style="font-size: 0.75rem; color: #94a3b8; margin: 4px 0 12px 0;">
                    Supports NTAG 216 / NTAG 424 DNA bounded debit cards and Model 3 PIN-redeemable nullifiers.
                </p>

                ${this.error ? html`<div style="color: #fb7185; font-size: 0.75rem; margin-bottom: 8px;">⚠️ ${this.error}</div>` : ''}

                ${this.state === 'idle'
                    ? html`<button class="btn" @click=${this.startScan}>📡 Scan Physical NFC Tag</button>`
                    : ''}

                ${this.state === 'scanning'
                    ? html`<div style="color: #facc15; font-size: 0.8rem;">Tap card to reader or phone sensor...</div>`
                    : ''}

                ${this.state === 'tag_read' && this.model === 3
                    ? html`
                          <div>
                              <p style="font-size: 0.75rem;">Model 3 Nullifier Tag Detected. Enter Voucher PIN:</p>
                              <div class="input-group">
                                  <input
                                      type="password"
                                      placeholder="PIN Code"
                                      .value=${this.pin}
                                      @input=${(e: any) => (this.pin = e.target.value)}
                                  />
                                  <button class="btn" @click=${this.verifyPin}>Verify & Derive Nullifier</button>
                              </div>
                          </div>
                      `
                    : ''}

                ${this.nullifier
                    ? html`
                          <div style="background: #182230; padding: 8px; border-radius: 4px; margin-top: 8px; font-family: monospace; font-size: 0.7rem;">
                              <span style="color: #4ade80;">Derived Nullifier:</span> ${this.nullifier.slice(0, 18)}...
                          </div>
                      `
                    : ''}
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('nfc-panel')) {
    customElements.define('nfc-panel', NfcPanel);
}
