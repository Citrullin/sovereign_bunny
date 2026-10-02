import { LitElement, html, css, TemplateResult } from 'lit';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

function getPluginIdForSlot(slotNum: number): string {
    switch (slotNum) {
        case 0: return 'core.did_identity';
        case 1: return 'core.zanzibar';
        case 2: return 'core.native_payment';
        case 3: return 'vcs.git_dag';
        case 4: return 'ext.sqldigest';
        case 5: return 'authority.xroad_descriptor';
        case 6: return 'vcs.interface_contract';
        case 7: return 'reputation.merit';
        case 8: return 'identity.lotl_root';
        case 0x53: return 'iroh.storage';
        case 0x0100: return 'lattice.account_height';
        default: return `slot_${slotNum}`;
    }
}

export class SovereignCommitmentModalElement extends BaseElement {
    static properties = {
        isOpen: { type: Boolean, state: true },
        params: { type: Object, state: true },
    };

    isOpen: boolean = false;
    params: any = null;

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
            z-index: 10003;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
            box-sizing: border-box;
        }
        .modal-card {
            width: 100%;
            max-width: 680px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            background: #161b22;
            border: 4px solid #ffd166;
            box-shadow: 0 6px #000;
            padding: 25px 15px 15px 15px;
            position: relative;
            color: #fff;
            box-sizing: border-box;
        }
        .modal-title {
            color: #ffd166;
            font-family: 'Press Start 2P', monospace;
            font-size: 0.7rem;
            margin-top: -38px;
            background: #161b22;
            padding: 0 10px;
            display: inline-block;
            align-self: flex-start;
        }
        .modal-body {
            overflow-y: auto;
            overflow-x: hidden;
            max-height: 75vh;
            padding-right: 6px;
            font-size: 0.7rem;
            line-height: 1.6;
        }
        .badge-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            border-bottom: 2px solid #333;
            padding-bottom: 8px;
        }
        .badge {
            padding: 2px 8px;
            font-size: 0.65rem;
            font-weight: bold;
            border-radius: 2px;
        }
        .badge-warning { background: #d29922; color: #000; }
        .badge-success { background: #238636; color: #fff; }

        .info-box {
            background: #0d1117;
            padding: 12px;
            border: 2px solid #30363d;
            margin-bottom: 12px;
            font-family: monospace;
            font-size: 0.65rem;
            border-radius: 4px;
        }
        .field-row {
            margin-bottom: 8px;
        }
        .field-label {
            color: #8b949e;
            text-transform: uppercase;
            font-size: 0.58rem;
            letter-spacing: 0.5px;
            display: block;
        }
        .field-val-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 2px;
        }
        .btn-copy {
            background: #21262d;
            border: 1px solid #30363d;
            color: #c9d1d9;
            padding: 2px 6px;
            font-size: 0.55rem;
            cursor: pointer;
        }
        .semantics-box {
            color: #c9d1d9;
            font-size: 0.65rem;
            margin-top: 4px;
            line-height: 1.4;
            background: rgba(0, 0, 0, 0.3);
            padding: 8px;
            border-radius: 3px;
        }
        .action-row {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            flex-wrap: wrap;
        }
        .btn {
            padding: 6px 14px;
            font-size: 0.65rem;
            font-weight: bold;
            cursor: pointer;
            border: none;
        }
        .btn-primary { background: #1f6feb; color: #fff; }
        .btn-warning { background: #d29922; color: #000; }
        .btn-close { background: #da3633; color: #fff; }
    `;

    open(params: any) {
        this.params = params;
        this.isOpen = true;
        this.requestUpdate();
    }

    close() {
        this.isOpen = false;
        this.requestUpdate();
    }

    copyRoot() {
        const hash = this.params?.commitment || '';
        navigator.clipboard.writeText(hash);
        const win = window as any;
        if (typeof win.showNesToast === 'function') {
            win.showNesToast("Commitment root hash copied to clipboard!", "success", 2000);
        }
    }

    focusInGraph() {
        const { commitment, address } = this.params || {};
        this.close();
        const win = window as any;
        if (win.switchAppTab) win.switchAppTab('tab-explorer');
        const graphEl = document.querySelector('graph-explorer') as any;
        if (graphEl && typeof graphEl.selectNodeByCommitment === 'function') {
            graphEl.selectNodeByCommitment(commitment, address);
        }
    }

    render(): TemplateResult {
        if (!this.isOpen || !this.params) return html``;
        const { commitment, address, slotId, pluginId, semantics, targetInfo } = this.params;
        const cleanCommitment = (commitment || '').trim();
        const cleanAddress = (address || '').trim();

        const slotNum = typeof slotId === 'string'
            ? parseInt(slotId.replace(/^0x/, ''), slotId.startsWith('0x') ? 16 : 10)
            : (slotId ?? 0);
        const slotStr = slotId !== undefined ? `Slot R_${slotNum}` : 'Microkernel Register';
        const effectivePlugin = pluginId || getPluginIdForSlot(slotNum);

        return html`
            <div class="modal-overlay" @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) this.close(); }}>
                <div class="modal-card">
                    <span class="modal-title">💎 State Commitment Root</span>
                    <div class="modal-body">
                        <div class="badge-row">
                            <div>
                                <span class="badge badge-warning">${slotStr}</span>
                                <span class="badge badge-success">Verified SMT Root</span>
                            </div>
                            <div style="color: #aaa; font-size: 0.65rem;">
                                Epoch ${(window as any).lastFinalizedEpoch || 42}
                            </div>
                        </div>

                        <div class="info-box">
                            <div class="field-row">
                                <span class="field-label">Cryptographic Commitment Root:</span>
                                <div class="field-val-row">
                                    <span style="color: #ffd166; word-break: break-all; font-weight: bold; font-size: 0.7rem;">
                                        ${cleanCommitment || '0x0000000000000000000000000000000000000000000000000000000000000000'}
                                    </span>
                                    <button class="btn-copy" @click=${this.copyRoot} title="Copy Root Hash">📋</button>
                                </div>
                            </div>

                            <div class="field-row">
                                <span class="field-label">Owning Account / Controller:</span>
                                <span style="color: #58a6ff; word-break: break-all;">
                                    ${cleanAddress || 'N/A'}
                                </span>
                            </div>

                            <div class="field-row">
                                <span class="field-label">Account Slot / Subsystem:</span>
                                <span style="color: #66fcf1; font-weight: bold;">
                                    ${effectivePlugin}
                                </span>
                            </div>

                            <div class="field-row">
                                <span class="field-label">Semantic Role & Slot Specification:</span>
                                <div class="semantics-box">
                                    ${semantics || `Slot ${slotNum} microkernel sparse merkle tree state commitment root.`}
                                </div>
                            </div>

                            ${targetInfo
                                ? html`
                                      <div class="field-row" style="background: rgba(102, 252, 241, 0.08); padding: 8px; border: 1px solid rgba(102, 252, 241, 0.3); border-radius: 4px;">
                                          <span class="field-label" style="color: #66fcf1;">Action Target:</span>
                                          <div style="color: #fff; font-size: 0.68rem; margin-top: 4px;">
                                              ${targetInfo}
                                          </div>
                                      </div>
                                  `
                                : ''}
                        </div>

                        <div class="action-row">
                            <button class="btn btn-primary" @click=${this.focusInGraph}>
                                🎯 Focus in Graph
                            </button>
                            <button class="btn btn-close" @click=${this.close}>
                                ✖️ Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-commitment-modal')) {
    customElements.define('sovereign-commitment-modal', SovereignCommitmentModalElement);
}
