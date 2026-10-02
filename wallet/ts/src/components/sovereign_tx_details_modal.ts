import { LitElement, html, css, TemplateResult } from 'lit';
import { SovereignDebugger } from '../debugger.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

export class SovereignTxDetailsModalElement extends BaseElement {
    static properties = {
        isOpen: { type: Boolean, state: true },
        tx: { type: Object, state: true },
        viewMode: { type: String, state: true },
    };

    isOpen: boolean = false;
    tx: any = null;
    viewMode: 'structured' | 'raw' = 'structured';

    private _debugger: SovereignDebugger = new SovereignDebugger();

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
            z-index: 10002;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
            box-sizing: border-box;
        }
        .modal-card {
            width: 100%;
            max-width: 700px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            background: #212529;
            color: #fff;
            box-sizing: border-box;
        }
        .modal-title {
            color: #f7d51d !important;
            font-family: 'Press Start 2P', monospace;
            font-size: 0.75rem;
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
        .badge-send { background: #d29922; color: #000; }
        .badge-receive { background: #238636; color: #fff; }
        .badge-reclaim { background: #1f6feb; color: #fff; }
        .badge-activitypub { background: #8957e5; color: #fff; }
        .badge-dark { background: #30363d; color: #c9d1d9; }
        .badge-settled { background: #238636; color: #fff; }

        .info-box {
            background: #111;
            padding: 10px;
            border: 2px solid #444;
            margin-bottom: 12px;
            font-family: monospace;
            font-size: 0.65rem;
        }
        .field-row {
            margin-bottom: 6px;
        }
        .field-label {
            color: #888;
            display: block;
        }
        .field-value {
            word-break: break-all;
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
            padding: 8px;
            border: 1px solid #333;
            color: #a8ffb2;
            max-height: 140px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-all;
            margin-top: 4px;
            font-size: 0.62rem;
            line-height: 1.4;
        }
        .structured-box {
            background: #0d1117;
            border: 1px solid #30363d;
            padding: 8px;
            margin-top: 4px;
            max-height: 160px;
            overflow-y: auto;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.65rem;
        }
        th, td {
            border: 1px solid #30363d;
            padding: 4px 6px;
            text-align: left;
        }
        th {
            background: #161b22;
            color: #8b949e;
        }
        td {
            color: #c9d1d9;
            word-break: break-all;
        }
        .action-row {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            flex-wrap: wrap;
            margin-top: 15px;
        }
    `;

    override createRenderRoot(): HTMLElement {
        return this as unknown as HTMLElement;
    }

    open(tx: any) {
        this.tx = tx;
        this.viewMode = 'structured';
        this.isOpen = true;
        if (tx && tx.hash && typeof history !== 'undefined' && typeof history.pushState === 'function') {
            history.pushState(null, '', '#tx/' + tx.hash);
        }
        this.requestUpdate();
    }

    close() {
        this.isOpen = false;
        if (typeof window !== 'undefined' && window.location && typeof history !== 'undefined' && typeof history.pushState === 'function') {
            if (window.location.hash.startsWith('#0x') || window.location.hash.startsWith('#tx/')) {
                history.pushState(null, '', window.location.pathname + '#explorer');
            }
        }
        this.requestUpdate();
    }

    async inspectInDebugger() {
        let rawCd = this.tx?.calldata || '';
        const target = this.tx?.counterparty || '';
        const hash = this.tx?.hash || '';

        // If calldata is missing, "0x", or identical to hash, try to resolve full transaction bytes
        if (!rawCd || rawCd === '0x' || (hash && rawCd.toLowerCase() === hash.toLowerCase())) {
            if (this.tx?.type === 'send' && this.tx?.counterparty) {
                // Synthesize sweepTransfer calldata
                rawCd = '0x38827724' + this.tx.counterparty.replace(/^0x/, '').padStart(64, '0');
            } else if (hash) {
                const win = typeof window !== 'undefined' ? (window as any) : {};
                if (typeof win.callBunnyRpc === 'function') {
                    try {
                        const rpcRes = await win.callBunnyRpc("sovereign_getTransactionByHash", [hash]);
                        if (rpcRes?.result?.calldata && rpcRes.result.calldata !== '0x' && rpcRes.result.calldata.toLowerCase() !== hash.toLowerCase()) {
                            rawCd = rpcRes.result.calldata;
                        }
                    } catch (_) {}
                    if (!rawCd || rawCd === '0x' || rawCd.toLowerCase() === hash.toLowerCase()) {
                        try {
                            const ethRes = await win.callBunnyRpc("eth_getTransactionByHash", [hash]);
                            if (ethRes?.result?.input && ethRes.result.input !== '0x') {
                                rawCd = ethRes.result.input;
                            }
                        } catch (_) {}
                    }
                }
            }
        }

        if (!rawCd || rawCd === '0x') {
            rawCd = hash || '0x';
        }

        this.close();
        const win = typeof window !== 'undefined' ? (window as any) : {};
        if (typeof win.dissectTransactionInDebugger === 'function') {
            win.dissectTransactionInDebugger(rawCd, target);
        }
    }

    copyLink() {
        const hash = this.tx?.hash || '';
        const origin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
        const pathname = typeof window !== 'undefined' ? window.location?.pathname || '' : '';
        const link = `${origin}${pathname}#tx/${hash}`;
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(link);
        }
        const win = typeof window !== 'undefined' ? (window as any) : {};
        if (typeof win.showNesToast === 'function') {
            win.showNesToast("🔗 State change link copied to clipboard!", "success", 2000);
        }
    }

    private decodePayload(calldata: string, counterparty?: string, txType?: string): { type: string; rows: Array<{ key: string; val: string }> } | null {
        if (!calldata || calldata === '0x' || calldata === '-') return null;
        const str = calldata.trim();
        const normTarget = (counterparty || '').toLowerCase();

        // 1. Try JSON parsing
        if (str.startsWith('{') && str.endsWith('}')) {
            try {
                const parsed = JSON.parse(str);

                // 1A. Polymorphic W3C DID Document
                const isDid = (parsed.id && typeof parsed.id === 'string' && parsed.id.startsWith('did:')) ||
                    normTarget.endsWith('0003') || txType === 'did';
                if (isDid) {
                    const rows: Array<{ key: string; val: string }> = [];
                    if (parsed.id) rows.push({ key: 'DID Identifier (URI)', val: parsed.id });
                    if (parsed.blockchainAccountId) {
                        rows.push({ key: 'Blockchain Account ID', val: parsed.blockchainAccountId });
                    }
                    if (Array.isArray(parsed.verificationMethod) && parsed.verificationMethod.length > 0) {
                        parsed.verificationMethod.forEach((vm: any, i: number) => {
                            const prefix = parsed.verificationMethod.length > 1 ? `Verification Method #${i + 1}` : 'Primary Verification Method';
                            rows.push({ key: `${prefix} (Type)`, val: `${vm.type || 'EcdsaSecp256k1VerificationKey2019'} (${vm.id || 'primary'})` });
                            if (vm.controller) rows.push({ key: `${prefix} Controller`, val: vm.controller });
                            if (vm.publicKeyHex) rows.push({ key: `${prefix} Public Key (Hex)`, val: vm.publicKeyHex });
                            if (vm.publicKeyMultibase) rows.push({ key: `${prefix} Multibase Key`, val: vm.publicKeyMultibase });
                        });
                    }
                    if (parsed.authentication) {
                        const authStr = Array.isArray(parsed.authentication)
                            ? parsed.authentication.map((a: any) => typeof a === 'string' ? a : (a.id || JSON.stringify(a))).join(', ')
                            : String(parsed.authentication);
                        rows.push({ key: 'Authentication Suites', val: authStr });
                    }
                    if (parsed.assertionMethod) {
                        const assertStr = Array.isArray(parsed.assertionMethod)
                            ? parsed.assertionMethod.map((a: any) => typeof a === 'string' ? a : (a.id || JSON.stringify(a))).join(', ')
                            : String(parsed.assertionMethod);
                        rows.push({ key: 'Assertion Method (PQ ML-DSA)', val: assertStr });
                    }
                    if (parsed.service) {
                        const srvStr = Array.isArray(parsed.service)
                            ? parsed.service.map((s: any) => `${s.type || 'Service'}: ${s.serviceEndpoint || ''}`).join('; ')
                            : String(parsed.service);
                        rows.push({ key: 'Decentralized Service Endpoints', val: srvStr });
                    }
                    if (parsed['@context']) {
                        const ctxStr = Array.isArray(parsed['@context']) ? parsed['@context'].join(', ') : String(parsed['@context']);
                        rows.push({ key: 'W3C Context Specifications', val: ctxStr });
                    }
                    return { type: '🪪 W3C DID Document (Precompile 0x03 • Sovereign Identity)', rows };
                }

                // 1B. Polymorphic Google Zanzibar ReBAC Access Control Tuple
                if (normTarget.endsWith('0061') || parsed.namespace || parsed.relation || parsed.object) {
                    const rows: Array<{ key: string; val: string }> = [];
                    if (parsed.namespace) rows.push({ key: 'Zanzibar Namespace', val: parsed.namespace });
                    if (parsed.object) rows.push({ key: 'Resource / Object', val: parsed.object });
                    if (parsed.relation) rows.push({ key: 'ReBAC Relation', val: parsed.relation });
                    if (parsed.subject) rows.push({ key: 'Authorized Subject', val: parsed.subject });
                    if (parsed.caveat) rows.push({ key: 'Conditional Caveat', val: typeof parsed.caveat === 'object' ? JSON.stringify(parsed.caveat) : String(parsed.caveat) });
                    return { type: '🛡️ Google Zanzibar ReBAC Access Control Tuple (Precompile 0x61)', rows };
                }

                // 1C. Polymorphic ActivityPub Activity (W3C ActivityStreams)
                if (parsed.actor || parsed.published || (parsed['@context'] && String(parsed['@context']).includes('activitystreams'))) {
                    const rows: Array<{ key: string; val: string }> = [];
                    if (parsed.type) rows.push({ key: 'Activity Type', val: parsed.type });
                    if (parsed.actor) rows.push({ key: 'Fediverse Actor', val: parsed.actor });
                    if (parsed.object) {
                        const objContent = typeof parsed.object === 'object' ? (parsed.object.content || JSON.stringify(parsed.object)) : String(parsed.object);
                        rows.push({ key: 'Fediverse Content / Object', val: objContent });
                    }
                    if (parsed.to) rows.push({ key: 'Recipients (To)', val: Array.isArray(parsed.to) ? parsed.to.join(', ') : String(parsed.to) });
                    if (parsed.published) rows.push({ key: 'Published Timestamp', val: parsed.published });
                    return { type: '📡 ActivityPub Federated Activity (W3C ActivityStreams)', rows };
                }

                // 1D. Polymorphic Storage DA DataRef
                if (normTarget.endsWith('0053') || parsed.datasetId || parsed.blake3Root || parsed.irohTicket) {
                    const rows: Array<{ key: string; val: string }> = [];
                    if (parsed.namespace) rows.push({ key: 'Storage Namespace', val: parsed.namespace });
                    if (parsed.blake3Root) rows.push({ key: 'BLAKE3 Verified Root', val: parsed.blake3Root });
                    if (parsed.leaseEpochs) rows.push({ key: 'Pin Lease Duration', val: `${parsed.leaseEpochs} Epochs` });
                    if (parsed.irohTicket) rows.push({ key: 'Iroh Blob Ticket', val: parsed.irohTicket });
                    return { type: '📦 O(1) Storage DA DataRef (Precompile 0x53 • Iroh)', rows };
                }

                // Fallback structured JSON fields
                const rows = Object.entries(parsed).map(([k, v]) => ({
                    key: k,
                    val: typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v),
                }));
                return { type: 'Structured JSON Payload', rows };
            } catch (_) {}
        }

        // 2. Specialized Precompile & Hex Decoders via SovereignDebugger
        if (str.startsWith('0x') && str.length > 2) {
            try {
                const decoded = this._debugger.decodeCalldata(counterparty || '0x0000000000000000000000000000000000000001', str);
                if (decoded && decoded.functionSignature) {
                    const rows: Array<{ key: string; val: string }> = [
                        { key: 'Function Call', val: decoded.functionSignature },
                        { key: 'Execution Mode', val: decoded.mode },
                        { key: 'Target Contract', val: decoded.targetName }
                    ];
                    if (decoded.params) {
                        for (const [k, v] of Object.entries(decoded.params)) {
                            rows.push({
                                key: k,
                                val: typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)
                            });
                        }
                    }
                    return { type: `⚡ ${decoded.targetName} (${decoded.functionSignature})`, rows };
                }
            } catch (_) {}
        }

        // 3. CAIP URL-encoded Parameters
        if (str.includes('=') && (str.includes('&') || !str.startsWith('0x'))) {
            try {
                const pairs = str.split('&').map(p => p.split('='));
                if (pairs.length > 0 && pairs[0].length === 2) {
                    const rows = pairs.map(([k, v]) => ({
                        key: decodeURIComponent(k),
                        val: decodeURIComponent(v || ''),
                    }));
                    return { type: 'CAIP State Mutation Parameters', rows };
                }
            } catch (_) {}
        }

        return null;
    }

    render(): TemplateResult {
        if (!this.isOpen || !this.tx) return html``;
        const tx = this.tx;
        const rawCd = tx.calldata || tx.hash || '0x';
        const decoded = this.decodePayload(rawCd, tx.counterparty, tx.type);

        const badgeTypeClass =
            tx.type === 'send' ? 'badge-send'
            : tx.type === 'receive' ? 'badge-receive'
            : tx.type === 'reclaim' ? 'badge-reclaim'
            : tx.type === 'activitypub' ? 'badge-activitypub'
            : 'badge-dark';

        const timeStr = tx.timestamp && tx.timestamp > 0 ? new Date(tx.timestamp).toLocaleString() : '';

        return html`
            <style>
                ${SovereignTxDetailsModalElement.styles}
            </style>
            <div class="modal-overlay" @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) this.close(); }}>
                <div class="nes-container is-dark with-title modal-card">
                    <p class="title modal-title">📜 Transaction Details</p>
                    <div class="modal-body">
                        <div class="badge-row">
                            <div>
                                <span class="badge ${badgeTypeClass}">${(tx.type || 'TX').toUpperCase()}</span>
                                <span class="badge badge-settled">${tx.status || 'Settled'}</span>
                            </div>
                            <div style="color: #aaa; font-size: 0.65rem;">
                                Epoch ${tx.epoch || 0} ${timeStr ? '• ' + timeStr : ''}
                            </div>
                        </div>

                        <div class="info-box">
                            <div class="field-row">
                                <span class="field-label">Transaction Hash:</span>
                                <span class="field-value" style="color: #66fcf1; font-weight: bold;">
                                    ${tx.hash ? tx.hash : '-'}
                                </span>
                            </div>
                            <div class="field-row">
                                <span class="field-label">Sender / Account:</span>
                                <span class="field-value" style="color: #fff;">
                                    ${tx.account || '-'}
                                </span>
                            </div>
                            <div class="field-row">
                                <span class="field-label">Counterparty / Receiver:</span>
                                <span class="field-value" style="color: #ff0;">
                                    ${tx.counterparty || '-'}
                                </span>
                            </div>
                            <div class="field-row">
                                <span class="field-label">Value / Amount:</span>
                                <span class="field-value" style="color: #55ff55; font-weight: bold;">
                                    ${tx.amount || '0'}
                                </span>
                            </div>
                            <div class="field-row">
                                <div class="toggle-row">
                                    <span class="field-label">Payload / Calldata:</span>
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
                                        >Raw Hex</button>
                                    </div>
                                </div>

                                ${this.viewMode === 'structured' && decoded
                                    ? html`
                                          <div class="structured-box">
                                              <div style="color: #58a6ff; font-weight: bold; font-size: 0.6rem; margin-bottom: 4px;">
                                                  ${decoded.type}
                                              </div>
                                              <table>
                                                  <thead><tr><th>Field</th><th>Value</th></tr></thead>
                                                  <tbody>
                                                      ${decoded.rows.map(
                                                          r => html`<tr><th>${r.key}</th><td>${r.val}</td></tr>`
                                                      )}
                                                  </tbody>
                                              </table>
                                          </div>
                                      `
                                    : html`<pre class="payload-pre">${rawCd}</pre>`}
                            </div>
                        </div>

                        <div class="action-row">
                            <button type="button" class="nes-btn is-primary" @click=${this.inspectInDebugger}>
                                🐞 Inspect in Debugger
                            </button>
                            <button type="button" class="nes-btn is-warning" @click=${this.copyLink}>
                                🔗 Copy Link
                            </button>
                            <button type="button" class="nes-btn is-error" @click=${this.close}>
                                ✖ Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-tx-details-modal')) {
    customElements.define('sovereign-tx-details-modal', SovereignTxDetailsModalElement);
}
