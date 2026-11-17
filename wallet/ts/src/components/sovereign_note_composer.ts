import { LitElement, html, css, TemplateResult } from 'lit';
import { NoteComposerActor, createNoteComposerMachineActor } from '../app/note_composer_machine.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<sovereign-note-composer>` Lit Component
 * Interactive form to compose and commit blind notes, configure target register slots,
 * and mint zero-knowledge shielded or public on-chain commitments.
 */
export class SovereignNoteComposer extends BaseElement {
    static properties = {
        rpcUrl: { type: String, attribute: 'rpc-url' },
        sender: { type: String, attribute: 'sender' },
        recipient: { type: String },
        amount: { type: String },
        assetId: { type: String, attribute: 'asset-id' },
        targetSlot: { type: Number, attribute: 'target-slot' },
        payload: { type: String },
        isShielded: { type: Boolean, attribute: 'is-shielded' },
        composerState: { state: true },
        commitment: { state: true },
        txHash: { state: true },
        error: { state: true },
    };

    rpcUrl: string = '/rpc';
    sender: string = '';
    recipient: string = '';
    amount: string = '0';
    assetId: string = 'TBL';
    targetSlot: number = 0;
    payload: string = '';
    isShielded: boolean = false;

    composerState: string = 'composing';
    commitment: string | null = null;
    txHash: string | null = null;
    error: string | null = null;

    private _actor: NoteComposerActor | null = null;
    private _subscription: any = null;

    static styles = css`
        :host {
            display: block;
            font-family: inherit;
        }
        .composer-card {
            background: #0d1117;
            border: 2px solid #21262d;
            border-radius: 8px;
            padding: 16px;
            color: #c9d1d9;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #21262d;
            padding-bottom: 10px;
            margin-bottom: 14px;
        }
        .title {
            font-size: 1rem;
            color: #58a6ff;
            font-weight: bold;
        }
        .form-row {
            margin-bottom: 12px;
        }
        .form-row label {
            display: block;
            font-size: 0.75rem;
            color: #8b949e;
            margin-bottom: 4px;
            font-weight: 600;
        }
        .form-control {
            width: 100%;
            background: #161b22;
            border: 1px solid #30363d;
            color: #c9d1d9;
            padding: 8px 10px;
            border-radius: 6px;
            font-size: 0.8rem;
            box-sizing: border-box;
            font-family: monospace;
        }
        .grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }
        .toggle-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 14px;
            font-size: 0.8rem;
            color: #d2a8ff;
            cursor: pointer;
        }
        .btn-commit {
            width: 100%;
            background: #238636;
            border: 1px solid rgba(240, 246, 252, 0.1);
            color: #ffffff;
            padding: 10px;
            border-radius: 6px;
            font-weight: bold;
            font-size: 0.85rem;
            cursor: pointer;
            transition: background 0.15s;
        }
        .btn-commit:hover {
            background: #2ea043;
        }
        .btn-reset {
            background: #21262d;
            border: 1px solid #30363d;
            color: #8b949e;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 0.75rem;
            cursor: pointer;
            margin-top: 8px;
        }
        .result-box {
            background: #161b22;
            border: 1px solid #238636;
            border-radius: 6px;
            padding: 12px;
            margin-top: 14px;
        }
        .error-box {
            background: #2b1115;
            border: 1px solid #da3633;
            border-radius: 6px;
            padding: 10px;
            margin-top: 12px;
            color: #ff7b72;
            font-size: 0.78rem;
        }
        .hash-text {
            word-break: break-all;
            color: #58a6ff;
            font-size: 0.75rem;
            font-family: monospace;
        }
    `;

    get actor(): NoteComposerActor | null {
        return this._actor;
    }

    set actor(newActor: NoteComposerActor | null) {
        if (this._subscription) {
            this._subscription.unsubscribe();
            this._subscription = null;
        }
        this._actor = newActor;
        if (this._actor) {
            this._subscription = this._actor.subscribe((snapshot) => {
                this.composerState = snapshot.value as string;
                this.commitment = snapshot.context.commitment;
                this.txHash = snapshot.context.txHash;
                this.error = snapshot.context.error;
                this.requestUpdate();
            });
        }
    }

    connectedCallback(): void {
        if (typeof document !== 'undefined') {
            super.connectedCallback();
        }
        if (!this._actor) {
            const actor = createNoteComposerMachineActor({
                sender: this.sender,
                recipient: this.recipient,
                amount: BigInt(this.amount || '0'),
                assetId: this.assetId,
                targetSlot: this.targetSlot,
                payload: this.payload,
                isShielded: this.isShielded,
            });
            actor.start();
            this.actor = actor;
        }
    }

    disconnectedCallback(): void {
        super.disconnectedCallback();
        if (this._subscription) {
            this._subscription.unsubscribe();
            this._subscription = null;
        }
    }

    updateField(field: string, val: any): void {
        (this as any)[field] = val;
        if (!this.actor) return;
        if (field === 'recipient') this.actor.send({ type: 'SET_RECIPIENT', recipient: val });
        if (field === 'amount') {
            try {
                this.actor.send({ type: 'SET_AMOUNT', amount: BigInt(val || '0') });
            } catch (_) {}
        }
        if (field === 'assetId') this.actor.send({ type: 'SET_ASSET', assetId: val });
        if (field === 'targetSlot') this.actor.send({ type: 'SET_SLOT', targetSlot: Number(val) });
        if (field === 'payload') this.actor.send({ type: 'SET_PAYLOAD', payload: val });
        if (field === 'isShielded') this.actor.send({ type: 'SET_SHIELDED', isShielded: Boolean(val) });
    }

    commit(): void {
        let amt = 0n;
        try {
            amt = BigInt(this.amount || '0');
        } catch (_) {}

        this.actor?.send({ type: 'PREPARE_COMMIT' });
        this.dispatchEvent(
            new CustomEvent('commit-note', {
                detail: {
                    sender: this.sender,
                    recipient: this.recipient,
                    amount: amt,
                    assetId: this.assetId,
                    targetSlot: this.targetSlot,
                    payload: this.payload,
                    isShielded: this.isShielded,
                },
            })
        );
    }

    reset(): void {
        this.actor?.send({ type: 'RESET' });
        this.recipient = '';
        this.amount = '0';
        this.payload = '';
        this.isShielded = false;
        this.requestUpdate();
    }

    render(): TemplateResult {
        return html`
            <div class="composer-card">
                <div class="header">
                    <span class="title">✍️ Sovereign Blind Note Composer</span>
                    <span style="font-size: 0.72rem; color: #8b949e;">Status: <strong>${this.composerState}</strong></span>
                </div>

                <div class="form-row">
                    <label>Recipient Address / DID</label>
                    <input
                        class="form-control"
                        placeholder="0x... or did:sov:..."
                        .value=${this.recipient}
                        @input=${(e: any) => this.updateField('recipient', e.target.value)}
                    />
                </div>

                <div class="grid-2">
                    <div class="form-row">
                        <label>Asset ID</label>
                        <select
                            class="form-control"
                            .value=${this.assetId}
                            @change=${(e: any) => this.updateField('assetId', e.target.value)}
                        >
                            <option value="TBL">TBL (Native Sovereignty)</option>
                            <option value="DID_REGISTRATION_ASSET">DID Fee Credit</option>
                            <option value="USDC">USDC (Bridged)</option>
                            <option value="CUSTOM">Custom Manifold Asset</option>
                        </select>
                    </div>

                    <div class="form-row">
                        <label>Amount</label>
                        <input
                            class="form-control"
                            type="number"
                            min="0"
                            .value=${this.amount}
                            @input=${(e: any) => this.updateField('amount', e.target.value)}
                        />
                    </div>
                </div>

                <div class="grid-2">
                    <div class="form-row">
                        <label>Target Register Slot ($R_0 - R_{63}$)</label>
                        <input
                            class="form-control"
                            type="number"
                            min="0"
                            max="63"
                            .value=${this.targetSlot.toString()}
                            @input=${(e: any) => this.updateField('targetSlot', e.target.value)}
                        />
                    </div>

                    <div class="form-row">
                        <label>Calldata / Payload (Hex or UTF-8)</label>
                        <input
                            class="form-control"
                            placeholder="0x... or arbitrary text"
                            .value=${this.payload}
                            @input=${(e: any) => this.updateField('payload', e.target.value)}
                        />
                    </div>
                </div>

                <div class="toggle-row" @click=${() => this.updateField('isShielded', !this.isShielded)}>
                    <input type="checkbox" .checked=${this.isShielded} />
                    <span>🔒 Shield Note with ZK-SNARK Privacy (Viewing Key Required)</span>
                </div>

                ${this.error ? html`<div class="error-box">⚠️ ${this.error}</div>` : ''}

                ${this.composerState === 'committed'
                    ? html`
                          <div class="result-box">
                              <div style="color: #56d364; font-weight: bold; font-size: 0.82rem; margin-bottom: 6px;">
                                  ✅ Note Successfully Committed to Epoch Pool!
                              </div>
                              <div style="font-size: 0.72rem; color: #8b949e;">Commitment Hash:</div>
                              <div class="hash-text">${this.commitment || '0x'}</div>
                              <div style="font-size: 0.72rem; color: #8b949e; margin-top: 6px;">Transaction Hash:</div>
                              <div class="hash-text">${this.txHash || '0x'}</div>
                              <button class="btn-reset" @click=${this.reset}>Compose Another Note</button>
                          </div>
                      `
                    : html`
                          <button class="btn-commit" @click=${this.commit}>
                              ${this.composerState === 'committing' ? '⏳ Committing...' : '🚀 Commit Blind Note'}
                          </button>
                      `}
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-note-composer')) {
    customElements.define('sovereign-note-composer', SovereignNoteComposer);
}
