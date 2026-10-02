import { LitElement, html, css, TemplateResult } from 'lit';
import { TxHistoryStateMachine, SovereignTransaction, TxHistoryState } from '../app/tx_history_machine.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<tx-history>` Lit Component
 * Renders filterable transaction history table for Sovereign transactions.
 */
export class TxHistory extends BaseElement {
    static properties = {
        transactions: { type: Array },
        filter: { type: String },
        state: { type: String },
        address: { type: String },
    };

    transactions: SovereignTransaction[] = [];
    filter: 'all' | 'sent' | 'received' = 'all';
    state: TxHistoryState = 'idle';
    address: string = '';

    private _machine: TxHistoryStateMachine | null = null;
    private _unsub: (() => void) | null = null;

    static styles = css`
        :host {
            display: block;
            font-family: inherit;
        }
        .tx-card {
            background: #151520;
            border: 2px solid #2e2e42;
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
            font-size: 0.85rem;
            color: #66fcf1;
            font-weight: bold;
            text-transform: uppercase;
        }
        .filters {
            display: flex;
            gap: 6px;
        }
        .filter-btn {
            background: #242436;
            color: #aaa;
            border: 1px solid #444;
            padding: 4px 8px;
            font-size: 0.7rem;
            cursor: pointer;
            border-radius: 4px;
        }
        .filter-btn.active {
            background: #1f333a;
            color: #45f3ff;
            border-color: #45a29e;
            font-weight: bold;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.75rem;
            margin-top: 8px;
        }
        th {
            text-align: left;
            color: #777;
            padding: 6px 8px;
            border-bottom: 1px solid #333;
            font-size: 0.65rem;
            text-transform: uppercase;
        }
        td {
            padding: 8px;
            border-bottom: 1px solid #222;
            font-family: monospace;
        }
        .tx-hash {
            color: #45a29e;
        }
        .status-badge {
            font-size: 0.65rem;
            padding: 2px 6px;
            border-radius: 3px;
        }
        .status-success { background: #114422; color: #45f3ff; }
        .status-failed { background: #441111; color: #ff6b6b; }
        .status-pending { background: #443311; color: #f7d51d; }
    `;

    bindMachine(machine: TxHistoryStateMachine): void {
        this._unsub?.();
        this._machine = machine;
        const initialSnap = machine.getSnapshot();
        this.state = initialSnap.value;
        this.transactions = initialSnap.context.transactions;
        this.filter = initialSnap.context.filter;
        this.address = initialSnap.context.address;

        this._unsub = machine.subscribe((snap) => {
            this.state = snap.value;
            this.transactions = snap.context.transactions;
            this.filter = snap.context.filter;
            this.address = snap.context.address;
            this.requestUpdate();
        });
    }

    disconnectedCallback(): void {
        super.disconnectedCallback?.();
        this._unsub?.();
    }

    setFilter(filter: 'all' | 'sent' | 'received'): void {
        this._machine?.send({ type: 'SET_FILTER', filter });
    }

    get filteredTransactions(): SovereignTransaction[] {
        if (!this.transactions) return [];
        if (this.filter === 'all') return this.transactions;
        const normAddr = this.address.toLowerCase();
        if (this.filter === 'sent') {
            return this.transactions.filter((tx) => tx.from.toLowerCase() === normAddr);
        }
        if (this.filter === 'received') {
            return this.transactions.filter((tx) => tx.to.toLowerCase() === normAddr);
        }
        return this.transactions;
    }

    render(): TemplateResult {
        const txs = this.filteredTransactions;

        return html`
            <div class="tx-card">
                <div class="header">
                    <span class="title">Transaction History</span>
                    <div class="filters">
                        <button
                            class="filter-btn ${this.filter === 'all' ? 'active' : ''}"
                            @click=${() => this.setFilter('all')}
                        >
                            All
                        </button>
                        <button
                            class="filter-btn ${this.filter === 'sent' ? 'active' : ''}"
                            @click=${() => this.setFilter('sent')}
                        >
                            Sent
                        </button>
                        <button
                            class="filter-btn ${this.filter === 'received' ? 'active' : ''}"
                            @click=${() => this.setFilter('received')}
                        >
                            Received
                        </button>
                    </div>
                </div>

                ${this.state === 'loading'
                    ? html`<div style="text-align:center; padding:16px; color:#888;">Loading transactions...</div>`
                    : txs.length === 0
                    ? html`<div style="text-align:center; padding:16px; color:#666;">No transactions recorded.</div>`
                    : html`
                          <table>
                              <thead>
                                  <tr>
                                      <th>Tx Hash</th>
                                      <th>Type</th>
                                      <th>Amount</th>
                                      <th>Status</th>
                                  </tr>
                              </thead>
                              <tbody>
                                  ${txs.map(
                                      (tx) => html`
                                          <tr>
                                              <td class="tx-hash">${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}</td>
                                              <td>${tx.type || 'Transfer'}</td>
                                              <td>${tx.value}</td>
                                              <td>
                                                  <span class="status-badge status-${tx.status}">
                                                      ${tx.status}
                                                  </span>
                                              </td>
                                          </tr>
                                      `
                                  )}
                              </tbody>
                          </table>
                      `}
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('tx-history')) {
    customElements.define('tx-history', TxHistory);
}
