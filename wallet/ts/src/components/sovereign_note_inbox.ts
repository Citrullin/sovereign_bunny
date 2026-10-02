import { LitElement, html, css, TemplateResult } from 'lit';
import { DecryptedNote, NoteInboxActor, createNoteInboxMachineActor } from '../app/note_inbox_machine.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<sovereign-note-inbox>` Lit Component
 * Inspects incoming and unspent blind notes, decrypts shielded notes with a viewing key,
 * and executes note absorption or clawback lifecycles.
 */
export class SovereignNoteInbox extends BaseElement {
    static properties = {
        rpcUrl: { type: String, attribute: 'rpc-url' },
        address: { type: String, attribute: 'address' },
        viewingKey: { type: String, attribute: 'viewing-key' },
        filter: { type: String },
        notes: { state: true },
        selectedCommitment: { state: true },
        inboxState: { state: true },
    };

    rpcUrl: string = '/rpc';
    address: string = '';
    viewingKey: string = '';
    filter: 'all' | 'shielded' | 'unspent' | 'absorbed' = 'all';
    notes: DecryptedNote[] = [];
    selectedCommitment: string | null = null;
    inboxState: string = 'idle';

    private _actor: NoteInboxActor | null = null;
    private _subscription: any = null;

    static styles = css`
        :host {
            display: block;
            font-family: inherit;
        }
        .inbox-card {
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
            padding-bottom: 12px;
            margin-bottom: 12px;
        }
        .title {
            font-size: 1rem;
            color: #58a6ff;
            font-weight: bold;
        }
        .filter-group {
            display: flex;
            gap: 6px;
            margin-bottom: 12px;
        }
        .filter-btn {
            background: #21262d;
            border: 1px solid #30363d;
            color: #8b949e;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 0.75rem;
            cursor: pointer;
        }
        .filter-btn.active {
            background: #1f6feb;
            color: #ffffff;
            border-color: #388bfd;
        }
        .key-input-row {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
        }
        .key-input {
            flex: 1;
            background: #161b22;
            border: 1px solid #30363d;
            color: #c9d1d9;
            padding: 6px 10px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 0.75rem;
        }
        .action-btn {
            background: #238636;
            border: 1px solid rgba(240, 246, 252, 0.1);
            color: #ffffff;
            padding: 4px 10px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 0.72rem;
            cursor: pointer;
        }
        .action-btn:hover {
            background: #2ea043;
        }
        .action-btn.secondary {
            background: #21262d;
            border-color: #30363d;
            color: #c9d1d9;
        }
        .action-btn.warning {
            background: #da3633;
            color: #ffffff;
        }
        .notes-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .note-item {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 10px 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .note-item.shielded {
            border-left: 3px solid #a371f7;
        }
        .badge {
            font-size: 0.68rem;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 10px;
            text-transform: uppercase;
        }
        .badge-shielded {
            background: rgba(163, 113, 247, 0.2);
            color: #d2a8ff;
            border: 1px solid #a371f7;
        }
        .badge-public {
            background: rgba(86, 211, 100, 0.2);
            color: #56d364;
            border: 1px solid #238636;
        }
        .badge-status {
            font-size: 0.65rem;
            padding: 1px 5px;
            border-radius: 4px;
            background: #30363d;
            color: #c9d1d9;
        }
        .empty-state {
            text-align: center;
            padding: 24px;
            color: #8b949e;
            font-size: 0.8rem;
        }
    `;

    get actor(): NoteInboxActor | null {
        return this._actor;
    }

    set actor(newActor: NoteInboxActor | null) {
        if (this._subscription) {
            this._subscription.unsubscribe();
            this._subscription = null;
        }
        this._actor = newActor;
        if (this._actor) {
            this._subscription = this._actor.subscribe((snapshot) => {
                this.inboxState = snapshot.value as string;
                this.notes = snapshot.context.notes;
                this.selectedCommitment = snapshot.context.selectedCommitment;
                this.requestUpdate();
            });
        }
    }

    connectedCallback(): void {
        if (typeof document !== 'undefined') {
            super.connectedCallback();
        }
        if (!this._actor) {
            const actor = createNoteInboxMachineActor({
                address: this.address,
                viewingKey: this.viewingKey || null,
                notes: this.notes,
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

    setFilter(filter: 'all' | 'shielded' | 'unspent' | 'absorbed'): void {
        this.filter = filter;
        this.requestUpdate();
    }

    applyViewingKey(): void {
        if (!this.viewingKey.trim()) return;
        this.actor?.send({ type: 'SET_VIEWING_KEY', viewingKey: this.viewingKey.trim() });
    }

    triggerScan(): void {
        this.actor?.send({ type: 'SCAN' });
        this.dispatchEvent(new CustomEvent('scan-notes', { detail: { address: this.address } }));
    }

    absorb(commitment: string): void {
        this.actor?.send({ type: 'ABSORB_NOTE', commitment });
        this.dispatchEvent(new CustomEvent('absorb-note', { detail: { commitment } }));
    }

    initiateClawback(commitment: string): void {
        this.actor?.send({ type: 'INITIATE_CLAWBACK', commitment });
        this.dispatchEvent(new CustomEvent('initiate-clawback', { detail: { commitment } }));
    }

    reclaim(commitment: string): void {
        this.actor?.send({ type: 'RECLAIM_NOTE', commitment });
        this.dispatchEvent(new CustomEvent('reclaim-note', { detail: { commitment } }));
    }

    get filteredNotes(): DecryptedNote[] {
        return this.notes.filter((note) => {
            if (this.filter === 'shielded') return note.isShielded;
            if (this.filter === 'unspent') return note.status === 'unspent';
            if (this.filter === 'absorbed') return note.status === 'absorbed';
            return true;
        });
    }

    render(): TemplateResult {
        const displayed = this.filteredNotes;

        return html`
            <div class="inbox-card">
                <div class="header">
                    <span class="title">📥 Sovereign Note Inbox</span>
                    <span style="font-size: 0.72rem; color: #8b949e;">
                        State: <strong style="color: #58a6ff;">${this.inboxState}</strong>
                    </span>
                </div>

                <div class="key-input-row">
                    <input
                        type="password"
                        class="key-input"
                        placeholder="Ephemeral Viewing Key (0x... / base64)"
                        .value=${this.viewingKey}
                        @input=${(e: any) => (this.viewingKey = e.target.value)}
                    />
                    <button class="action-btn secondary" @click=${this.applyViewingKey}>🔑 Unlock Shielded</button>
                    <button class="action-btn" @click=${this.triggerScan}>🔄 Scan Inbox</button>
                </div>

                <div class="filter-group">
                    <button
                        class="filter-btn ${this.filter === 'all' ? 'active' : ''}"
                        @click=${() => this.setFilter('all')}
                    >
                        All (${this.notes.length})
                    </button>
                    <button
                        class="filter-btn ${this.filter === 'unspent' ? 'active' : ''}"
                        @click=${() => this.setFilter('unspent')}
                    >
                        Unspent
                    </button>
                    <button
                        class="filter-btn ${this.filter === 'shielded' ? 'active' : ''}"
                        @click=${() => this.setFilter('shielded')}
                    >
                        🔒 Shielded ZK
                    </button>
                    <button
                        class="filter-btn ${this.filter === 'absorbed' ? 'active' : ''}"
                        @click=${() => this.setFilter('absorbed')}
                    >
                        Absorbed
                    </button>
                </div>

                <div class="notes-list">
                    ${displayed.length === 0
                        ? html`<div class="empty-state">No notes found matching current filter.</div>`
                        : displayed.map(
                              (note) => html`
                                  <div class="note-item ${note.isShielded ? 'shielded' : ''}">
                                      <div>
                                          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                              <span class="badge ${note.isShielded ? 'badge-shielded' : 'badge-public'}">
                                                  ${note.isShielded ? '🔒 Shielded' : '🌐 Public'}
                                              </span>
                                              <span class="badge-status">${note.status}</span>
                                              ${note.targetSlot !== undefined
                                                  ? html`<span class="badge-status">Slot R_${note.targetSlot}</span>`
                                                  : ''}
                                              ${note.viewTag !== undefined
                                                  ? html`<span class="badge-status">Tag 0x${note.viewTag.toString(16).padStart(2, '0')}</span>`
                                                  : ''}
                                              ${note.decayEpoch !== undefined
                                                  ? html`<span class="badge-status">Decay Ep.${note.decayEpoch}</span>`
                                                  : ''}
                                          </div>
                                          <div style="font-family: monospace; font-size: 0.75rem; color: #58a6ff;">
                                              ${note.commitment.slice(0, 10)}...${note.commitment.slice(-8)}
                                          </div>
                                          <div style="font-size: 0.7rem; color: #8b949e; margin-top: 2px;">
                                              Amount: <strong style="color: #c9d1d9;">${note.amount.toString()}</strong>
                                              | Asset: ${note.assetId} | From: ${note.sender.slice(0, 8)}...
                                          </div>
                                      </div>

                                      <div style="display: flex; gap: 6px;">
                                          ${note.status === 'unspent'
                                              ? html`
                                                    <button
                                                        class="action-btn"
                                                        @click=${() => this.absorb(note.commitment)}
                                                    >
                                                        ⚡ Absorb
                                                    </button>
                                                    <button
                                                        class="action-btn warning"
                                                        title="Reclaim note after decay epoch"
                                                        @click=${() => this.reclaim(note.commitment)}
                                                    >
                                                        ⏳ Reclaim
                                                    </button>
                                                    <button
                                                        class="action-btn secondary"
                                                        @click=${() => this.initiateClawback(note.commitment)}
                                                    >
                                                        ↩ Clawback
                                                    </button>
                                                `
                                              : ''}
                                      </div>
                                  </div>
                              `
                          )}
                </div>
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-note-inbox')) {
    customElements.define('sovereign-note-inbox', SovereignNoteInbox);
}
