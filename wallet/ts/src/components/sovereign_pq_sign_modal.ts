import { LitElement, html, css, TemplateResult } from 'lit';
import { keccak256, toBytes } from 'viem';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

export class SovereignPqSignModalElement extends BaseElement {
    static properties = {
        isOpen: { type: Boolean, state: true },
        request: { type: Object, state: true },
        viewMode: { type: String, state: true },
    };

    isOpen: boolean = false;
    request: any = null;
    viewMode: 'structured' | 'raw' = 'structured';

    private _resolve: ((value: boolean) => void) | null = null;

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
            z-index: 10001;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
            box-sizing: border-box;
        }
        .modal-card {
            width: 100%;
            max-width: 580px;
            background: #212529;
            border: 4px solid #55ff55;
            box-shadow: 0 6px #000;
            padding: 25px 15px 15px 15px;
            position: relative;
            color: #fff;
            box-sizing: border-box;
        }
        .modal-title {
            color: #55ff55;
            font-family: 'Press Start 2P', monospace;
            font-size: 0.72rem;
            margin-top: -38px;
            background: #212529;
            padding: 0 10px;
            display: inline-block;
            align-self: flex-start;
        }
        .modal-body {
            font-size: 0.68rem;
            line-height: 1.5;
        }
        .info-box {
            background: #111;
            padding: 10px;
            border: 2px solid #333;
            margin: 10px 0;
            font-family: monospace;
            font-size: 0.65rem;
        }
        .field-row {
            margin-bottom: 4px;
        }
        .field-label {
            color: #888;
        }
        .toggle-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }
        .toggle-btn {
            background: #30363d;
            border: 1px solid #555;
            color: #c9d1d9;
            padding: 2px 8px;
            font-size: 0.6rem;
            cursor: pointer;
        }
        .toggle-btn.active {
            background: #1f6feb;
            color: #fff;
            border-color: #388bfd;
        }
        .payload-pre {
            background: #000;
            color: #a8ffb2;
            padding: 6px;
            font-size: 0.6rem;
            word-break: break-all;
            white-space: pre-wrap;
            max-height: 90px;
            overflow-y: auto;
            margin: 4px 0 0 0;
        }
        .structured-box {
            background: #0d1117;
            border: 1px solid #30363d;
            padding: 6px;
            margin-top: 4px;
            max-height: 120px;
            overflow-y: auto;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.65rem;
        }
        th, td {
            border: 1px solid #30363d;
            padding: 3px 6px;
            text-align: left;
        }
        th { background: #161b22; color: #8b949e; }
        td { color: #c9d1d9; word-break: break-all; }
        .action-row {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 12px;
        }
        .btn {
            padding: 6px 14px;
            font-size: 0.68rem;
            font-weight: bold;
            cursor: pointer;
            border: none;
        }
        .btn-reject { background: #da3633; color: #fff; }
        .btn-approve { background: #238636; color: #fff; }
    `;

    override createRenderRoot(): HTMLElement {
        return this as unknown as HTMLElement;
    }

    prompt(request: any): Promise<boolean> {
        this.request = request;
        this.viewMode = 'structured';
        this.isOpen = true;
        this.requestUpdate();

        return new Promise<boolean>((resolve) => {
            this._resolve = resolve;
        });
    }

    approve() {
        this.handleDecision(true);
    }

    reject() {
        this.handleDecision(false);
    }

    private handleDecision(approved: boolean) {
        this.isOpen = false;
        if (this._resolve) {
            this._resolve(approved);
            this._resolve = null;
        }
        this.requestUpdate();
    }

    private decodePayload(calldata: string): { type: string; rows: Array<{ key: string; val: string }> } | null {
        if (!calldata || calldata === '0x' || calldata === '-') return null;
        const str = calldata.trim();

        if (str.startsWith('{') && str.endsWith('}')) {
            try {
                const parsed = JSON.parse(str);
                const rows = Object.entries(parsed).map(([k, v]) => ({
                    key: k,
                    val: typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v),
                }));
                return { type: 'JSON Payload', rows };
            } catch (_) {}
        }

        if (str.includes('=') && (str.includes('&') || !str.startsWith('0x'))) {
            try {
                const pairs = str.split('&').map(p => p.split('='));
                if (pairs.length > 0 && pairs[0].length === 2) {
                    const rows = pairs.map(([k, v]) => ({
                        key: decodeURIComponent(k),
                        val: decodeURIComponent(v || ''),
                    }));
                    return { type: 'State Parameters', rows };
                }
            } catch (_) {}
        }

        return null;
    }

    render(): TemplateResult {
        if (!this.isOpen || !this.request) return html``;
        const req = this.request;
        const rawCd = req.calldata || '';
        const decoded = this.decodePayload(rawCd);

        let calldataHash = '0x0';
        try {
            if (rawCd) {
                calldataHash = keccak256(toBytes(rawCd)).slice(0, 18) + '...';
            }
        } catch (_) {}

        return html`
            <div class="modal-overlay">
                <div class="nes-container is-dark with-title modal-card">
                    <p class="title modal-title" style="color: #55ff55 !important;">🛡️ Authorize Post-Quantum Signature</p>
                    <div class="modal-body">
                        <p style="color: #ff0; margin-bottom: 8px; font-size: 0.65rem;">
                            An on-chain state transition requires an explicit Post-Quantum Dilithium (ML-DSA-65) signature.
                        </p>

                        <div class="info-box">
                            <div class="field-row">
                                <span class="field-label">Request Type:</span>
                                <span style="color: #66fcf1; font-weight: bold;">
                                    ${req.type || 'Quantum-Wrapped Precompile Call'}
                                </span>
                            </div>
                            <div class="field-row">
                                <span class="field-label">Target:</span>
                                <span style="color: #fff; word-break: break-all;">
                                    ${req.target || '0x0000000000000000000000000000000000000003'}
                                </span>
                            </div>
                            <div class="field-row">
                                <span class="field-label">Key Scheme:</span>
                                <span style="color: #55ff55;">
                                    ${req.keyScheme || 'ML-DSA-65 (NIST FIPS 204)'}
                                </span>
                            </div>
                            <div class="field-row">
                                <span class="field-label">Signer Account:</span>
                                <span style="color: #aaa; word-break: break-all;">
                                    ${req.caller || 'Connected Account'}
                                </span>
                            </div>
                            <div class="field-row">
                                <span class="field-label">Description:</span>
                                <span style="color: #ffcc00;">
                                    ${req.summary || 'Authorize Post-Quantum Signature'}
                                </span>
                            </div>
                            <div class="field-row">
                                <span class="field-label">Calldata Hash:</span>
                                <span style="color: #888; font-size: 0.6rem;">
                                    ${calldataHash}
                                </span>
                            </div>
                            <div class="field-row" style="margin-top: 6px;">
                                <div class="toggle-row">
                                    <span class="field-label">Payload Data:</span>
                                    <div>
                                        <button
                                            type="button"
                                            class="toggle-btn ${this.viewMode === 'structured' ? 'active' : ''}"
                                            @click=${() => { this.viewMode = 'structured'; }}
                                        >Structured</button>
                                        <button
                                            type="button"
                                            class="toggle-btn ${this.viewMode === 'raw' ? 'active' : ''}"
                                            @click=${() => { this.viewMode = 'raw'; }}
                                        >Raw</button>
                                    </div>
                                </div>

                                ${this.viewMode === 'structured' && decoded
                                    ? html`
                                          <div class="structured-box">
                                              <table>
                                                  <thead><tr><th>Param</th><th>Value</th></tr></thead>
                                                  <tbody>
                                                      ${decoded.rows.map(
                                                          r => html`<tr><th>${r.key}</th><td>${r.val}</td></tr>`
                                                      )}
                                                  </tbody>
                                              </table>
                                          </div>
                                      `
                                    : html`<pre class="payload-pre">${rawCd || '0x'}</pre>`}
                            </div>
                        </div>

                        <div class="action-row" style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 15px;">
                            <button type="button" class="nes-btn is-error" style="font-size: 0.65rem;" @click=${() => this.handleDecision(false)}>
                                ❌ Reject
                            </button>
                            <button type="button" class="nes-btn is-success" style="font-size: 0.65rem;" @click=${() => this.handleDecision(true)}>
                                🛡️ Authorize & Sign
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-pq-sign-modal')) {
    customElements.define('sovereign-pq-sign-modal', SovereignPqSignModalElement);
}
