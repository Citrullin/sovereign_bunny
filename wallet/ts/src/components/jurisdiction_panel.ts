import { LitElement, html, css, TemplateResult } from 'lit';
import { JurisdictionStateMachine, JurisdictionState } from '../app/jurisdiction_machine.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<jurisdiction-panel>` Lit Component
 * Manages regulatory jurisdiction compliance, eIDAS 2.0 SD-JWT proofs, and ALLOW_LEGACY quantum policy.
 */
export class JurisdictionPanel extends BaseElement {
    static properties = {
        state: { type: String },
        jurisdiction: { type: String },
        compliant: { type: Boolean },
        mandate: { type: String },
        allowLegacy: { type: Boolean },
        isQuantumSecure: { type: Boolean },
        error: { type: String },
    };

    state: JurisdictionState = 'idle';
    jurisdiction: string = 'EU (eIDAS / BaFin)';
    compliant: boolean = false;
    mandate: string = 'MiCA / FinFRG Tier-2 Gate';
    allowLegacy: boolean = false;
    isQuantumSecure: boolean = true;
    error: string = '';

    private _machine: JurisdictionStateMachine | null = null;
    private _unsub: (() => void) | null = null;

    static styles = css`
        :host {
            display: block;
            font-family: inherit;
        }
        .jurisdiction-card {
            background: #111822;
            border: 2px solid #1f2d3d;
            border-radius: 8px;
            padding: 16px;
            color: #eee;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            border-bottom: 1px solid #1f2d3d;
            padding-bottom: 8px;
        }
        .title {
            font-size: 0.9rem;
            color: #66fcf1;
            font-weight: bold;
        }
        .badge {
            font-size: 0.7rem;
            padding: 2px 8px;
            border-radius: 4px;
            font-weight: bold;
        }
        .badge-compliant { background: #114422; color: #4ade80; border: 1px solid #4ade80; }
        .badge-noncompliant { background: #441111; color: #fb7185; border: 1px solid #fb7185; }
        .badge-pq { background: #2a1b4e; color: #d175ff; border: 1px solid #d175ff; }
        .badge-legacy { background: #554411; color: #facc15; border: 1px solid #facc15; }

        .btn {
            background: #1e293b;
            border: 1px solid #334155;
            color: #66fcf1;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.75rem;
            font-weight: bold;
        }
        .btn:hover {
            background: #2b3b52;
        }
        .policy-box {
            background: #182230;
            padding: 12px;
            border-radius: 6px;
            margin-top: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
    `;

    bindMachine(machine: JurisdictionStateMachine): void {
        this._unsub?.();
        this._machine = machine;
        const initialSnap = machine.getSnapshot();
        this.state = initialSnap.value;
        this.jurisdiction = initialSnap.context.jurisdiction;
        this.compliant = initialSnap.context.compliant;
        this.mandate = initialSnap.context.mandate;
        this.allowLegacy = initialSnap.context.allowLegacy;
        this.isQuantumSecure = initialSnap.context.isQuantumSecure;
        this.error = initialSnap.context.error || '';

        this._unsub = machine.subscribe((snap) => {
            this.state = snap.value;
            this.jurisdiction = snap.context.jurisdiction;
            this.compliant = snap.context.compliant;
            this.mandate = snap.context.mandate;
            this.allowLegacy = snap.context.allowLegacy;
            this.isQuantumSecure = snap.context.isQuantumSecure;
            this.error = snap.context.error || '';
            this.requestUpdate();
        });
    }

    disconnectedCallback(): void {
        super.disconnectedCallback?.();
        this._unsub?.();
    }

    toggleAllowLegacy(): void {
        this._machine?.send({ type: 'SET_ALLOW_LEGACY', allow: !this.allowLegacy });
    }

    submitProof(): void {
        this._machine?.send({
            type: 'SUBMIT_PREDICATE',
            predicateId: 1, // AgeAbove18
            zkProof: '0xmockzkproof12345678',
        });
    }

    render(): TemplateResult {
        return html`
            <div class="jurisdiction-card">
                <div class="header">
                    <span class="title">🛡️ Jurisdiction & Regulatory Compliance (Precompile 0x08)</span>
                    <span class="badge ${this.compliant ? 'badge-compliant' : 'badge-noncompliant'}">
                        ${this.compliant ? 'Compliant Gate Open' : 'Restricted (Verification Needed)'}
                    </span>
                </div>

                <p style="font-size: 0.75rem; color: #94a3b8; margin: 4px 0 10px 0;">
                    Active Jurisdiction: <strong>${this.jurisdiction}</strong> • Mandate: <strong>${this.mandate}</strong>
                </p>

                ${this.error ? html`<div style="color: #fb7185; font-size: 0.75rem; margin-bottom: 8px;">⚠️ ${this.error}</div>` : ''}

                <div class="policy-box">
                    <div>
                        <div style="font-size: 0.8rem; font-weight: bold; color: #fff;">Quantum Security Policy</div>
                        <div style="font-size: 0.7rem; color: #888; margin-top: 2px;">
                            ${this.allowLegacy
                                ? 'ALLOW_LEGACY=true (Classical Secp256k1 transactions permitted)'
                                : 'ALLOW_LEGACY=false (Post-quantum ML-DSA-65 strictly enforced)'}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <span class="badge ${this.isQuantumSecure ? 'badge-pq' : 'badge-legacy'}">
                            ${this.isQuantumSecure ? 'Quantum Protected' : 'Legacy Insecure'}
                        </span>
                        <button class="btn" @click=${this.toggleAllowLegacy}>
                            ${this.allowLegacy ? 'Enforce PQ Only' : 'Allow Legacy'}
                        </button>
                    </div>
                </div>

                <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
                    ${!this.compliant
                        ? html`
                              <button class="btn" @click=${this.submitProof}>
                                  📜 Submit eIDAS ZK-Predicate Proof
                              </button>
                          `
                        : ''}
                </div>
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('jurisdiction-panel')) {
    customElements.define('jurisdiction-panel', JurisdictionPanel);
}
