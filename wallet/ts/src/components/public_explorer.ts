import { LitElement, html, css, TemplateResult } from 'lit';

export interface NetworkStats {
    totalDids: number;
    activeAuthorities: number;
    epochHeight: number;
    blindNotePoolDepth: number;
    peerCount: number;
    totalTransactions: number;
    chainId: number;
    consensusModel: string;
}

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * <public-explorer> Typed Lit Web Component
 * Displays privacy-preserving aggregate network statistics without revealing personal identity or individual blind notes.
 */
export class PublicExplorer extends BaseElement {
    static properties = {
        _stats: { state: true },
        _loading: { state: true },
        _rpcUrl: { type: String, attribute: 'rpc-url' },
        address: { type: String, attribute: 'address' },
        _accountHeight: { state: true },
    };

    address: string = '';
    private _accountHeight: number = 0;
    private _stats: NetworkStats = {
        totalDids: 1,
        activeAuthorities: 7,
        epochHeight: 42,
        blindNotePoolDepth: 0,
        peerCount: 5,
        totalTransactions: 0,
        chainId: 1337,
        consensusModel: 'Snowman BFT + Account Lattice',
    };
    private _loading: boolean = false;
    private _rpcUrl: string = '/rpc';

    constructor() {
        super();
    }

    createRenderRoot(): HTMLElement {
        return this;
    }

    connectedCallback(): void {
        super.connectedCallback?.();
        this.fetchNetworkStats();
    }

    async fetchNetworkStats(): Promise<void> {
        this._loading = true;
        this.requestUpdate?.();

        try {
            // Also grab live consensus epoch from window or /rpc if available
            const currentEpoch = (typeof window !== 'undefined' && (window as any).lastFinalizedEpoch) || null;

            let rpcEndpoint = this._rpcUrl || '/rpc';
            if (typeof document !== 'undefined') {
                const inputVal = (document.getElementById('rpc-endpoint-input') as HTMLInputElement)?.value;
                if (inputVal) rpcEndpoint = inputVal;
            }
            if (rpcEndpoint.startsWith('/') && typeof window !== 'undefined') {
                rpcEndpoint = `${window.location.origin}${rpcEndpoint}`;
            }

            let data: any = null;
            if (typeof (window as any)?.callBunnyRpc === 'function') {
                try {
                    data = await (window as any).callBunnyRpc('sovereign_getNetworkStats', []);
                } catch (_) {}
            }

            if (!data || !data.result) {
                if (typeof fetch !== 'undefined') {
                    const res = await fetch(rpcEndpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            jsonrpc: '2.0',
                            id: 1,
                            method: 'sovereign_getNetworkStats',
                            params: [],
                        }),
                    });
                    if (res.ok) {
                        data = await res.json();
                    }
                }
            }

            if (data && data.result) {
                this._stats = { ...this._stats, ...data.result };
            } else if (currentEpoch) {
                this._stats = { ...this._stats, epochHeight: currentEpoch };
            }

            if (this.address) {
                let mData: any = null;
                if (typeof (window as any)?.callBunnyRpc === 'function') {
                    try {
                        mData = await (window as any).callBunnyRpc('sovereign_getAccountLatticeMetrics', [this.address]);
                    } catch (_) {}
                }
                if (!mData || !mData.result) {
                    if (typeof fetch !== 'undefined') {
                        const metricsRes = await fetch(rpcEndpoint, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                jsonrpc: '2.0',
                                id: 2,
                                method: 'sovereign_getAccountLatticeMetrics',
                                params: [this.address],
                            }),
                        });
                        if (metricsRes.ok) {
                            mData = await metricsRes.json();
                        }
                    }
                }
                if (mData && mData.result && mData.result.account_height !== undefined) {
                    try {
                        this._accountHeight = Number(BigInt(mData.result.account_height));
                    } catch (_) {
                        this._accountHeight = Number(mData.result.account_height) || 0;
                    }
                }
            }
        } catch (e) {
            // Keep default / fallback stats in case of offline/test mode
        } finally {
            this._loading = false;
            this.requestUpdate?.();
        }
    }

    setNetworkStats(stats: Partial<NetworkStats>): void {
        this._stats = { ...this._stats, ...stats };
        this.requestUpdate?.();
    }

    getNetworkStats(): NetworkStats {
        return this._stats;
    }

    _jumpToNetworkTxs(): void {
        if (typeof window !== 'undefined') {
            if (typeof (window as any).switchAppTab === 'function') {
                (window as any).switchAppTab('tab-explorer');
            }
            if (typeof (window as any).filterTransactions === 'function') {
                (window as any).filterTransactions('network');
            }
            const el = document.getElementById('explorer-history-container');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    render(): any {
        return html`
            <div class="public-explorer-root" style="font-family: inherit; color: #e0e0e0; background: #121820; border-radius: 8px; padding: 16px; border: 1px solid #1e293b;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #1e293b; padding-bottom: 10px;">
                    <div>
                        <h3 style="margin: 0; font-size: 1.1rem; color: #66fcf1; display: flex; align-items: center; gap: 8px;">
                            🌐 Sovereign Network Public Explorer
                        </h3>
                        <p style="margin: 4px 0 0 0; font-size: 0.75rem; color: #94a3b8;">
                            Zero-Knowledge Public Verification • Privacy-Preserving Network Telemetry
                        </p>
                    </div>
                    <button class="refresh-stats-btn"
                            @click=${() => this.fetchNetworkStats()}
                            style="background: #1e293b; border: 1px solid #334155; color: #66fcf1; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: all 0.2s;">
                        ${this._loading ? '⏳ Refreshing...' : '🔄 Refresh'}
                    </button>
                </div>

                <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
                    <div class="stat-card" style="background: #182230; padding: 12px; border-radius: 6px; border: 1px solid #233549;">
                        <span style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase;">Total DID Registrations</span>
                        <div style="font-size: 1.4rem; font-weight: bold; color: #38bdf8; margin-top: 4px;">
                            ${this._stats.totalDids}
                        </div>
                        <small style="font-size: 0.65rem; color: #64748b;">Slot 0 Inscribed W3C DIDs</small>
                    </div>

                    <div class="stat-card" style="background: #182230; padding: 12px; border-radius: 6px; border: 1px solid #233549;">
                        <span style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase;">Active Regulatory Authorities</span>
                        <div style="font-size: 1.4rem; font-weight: bold; color: #c084fc; margin-top: 4px;">
                            ${this._stats.activeAuthorities}
                        </div>
                        <small style="font-size: 0.65rem; color: #64748b;">Slot 5 X-Road Descriptors</small>
                    </div>

                    <div class="stat-card" style="background: #182230; padding: 12px; border-radius: 6px; border: 1px solid #233549;">
                        <span style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase;">Consensus Epoch Height</span>
                        <div style="font-size: 1.4rem; font-weight: bold; color: #34d399; margin-top: 4px;">
                            #${this._stats.epochHeight}
                        </div>
                        <small style="font-size: 0.65rem; color: #64748b;">Snowman BFT Cuts Finalized</small>
                    </div>

                    <div class="stat-card" style="background: #182230; padding: 12px; border-radius: 6px; border: 1px solid #233549;">
                        <span style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase;">Aggregate Blind Note Pool</span>
                        <div style="font-size: 1.4rem; font-weight: bold; color: #facc15; margin-top: 4px;">
                            ${this._stats.blindNotePoolDepth}
                        </div>
                        <small style="font-size: 0.65rem; color: #64748b;">Shielded Unspent Notes (Depth)</small>
                    </div>

                    <div class="stat-card" style="background: #182230; padding: 12px; border-radius: 6px; border: 1px solid #233549;">
                        <span style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase;">P2P Mesh Peers</span>
                        <div style="font-size: 1.4rem; font-weight: bold; color: #4ade80; margin-top: 4px;">
                            ${this._stats.peerCount}
                        </div>
                        <small style="font-size: 0.65rem; color: #64748b;">WireGuard Overlay Nodes</small>
                    </div>

                    <div class="stat-card" style="background: #182230; padding: 12px; border-radius: 6px; border: 1px solid #233549; cursor: pointer; transition: border-color 0.2s;"
                         title="Click to view all settled transactions across the network"
                         @click=${() => this._jumpToNetworkTxs()}>
                        <span style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase;">Total Settled TXs 🔗</span>
                        <div style="font-size: 1.4rem; font-weight: bold; color: #fb7185; margin-top: 4px;">
                            ${this._stats.totalTransactions}
                        </div>
                        <small style="font-size: 0.65rem; color: #64748b;">Stateless Precompile Transactions (Click to view)</small>
                    </div>

                    ${this.address ? html`
                    <div class="stat-card" style="background: #182230; padding: 12px; border-radius: 6px; border: 1px solid #233549;">
                        <span style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase;">Account Lattice Height</span>
                        <div style="font-size: 1.4rem; font-weight: bold; color: #66fcf1; margin-top: 4px;">
                            ${this._accountHeight}
                        </div>
                        <small style="font-size: 0.65rem; color: #64748b;">Slot 0x0100 Monotonic Height</small>
                    </div>
                    ` : ''}
                </div>

                <div class="privacy-notice" style="margin-top: 16px; padding: 10px; background: rgba(56, 189, 248, 0.05); border-left: 3px solid #38bdf8; border-radius: 4px; font-size: 0.7rem; color: #94a3b8;">
                    🔒 <strong>Privacy Invariant:</strong> Individual account balances, shielded note ciphertexts, and private relationship tuples are never revealed by this explorer. Users retain unilateral sovereignty over view-key disclosure.
                </div>
            </div>
        `;
    }
}

if (typeof window !== 'undefined') {
    (window as any).refreshPublicExplorer = function() {
        const el = document.getElementById('sovereign-public-explorer') as any;
        if (el && typeof el.fetchNetworkStats === 'function') {
            return el.fetchNetworkStats();
        }
    };
}

if (typeof customElements !== 'undefined' && !customElements.get('public-explorer')) {
    customElements.define('public-explorer', PublicExplorer);
}
