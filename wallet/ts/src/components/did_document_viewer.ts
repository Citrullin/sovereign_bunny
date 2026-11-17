import { CborCodec } from './cbor_codec.js';
import { W3cDidDocument, W3cVerificationMethod } from '../types.js';

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {} as unknown as typeof HTMLElement;

/**
 * <did-document-viewer> Typed Web Component
 * Decodes and visualizes DID Documents, CBOR payloads, and state diffs.
 */
export class DidDocumentViewer extends BaseElement {
    static get observedAttributes(): string[] {
        return ['doc', 'cbor-hex', 'prev-doc'];
    }

    private _doc: W3cDidDocument | null = null;
    private _prevDoc: W3cDidDocument | null = null;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback(): void {
        this.render();
    }

    attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
        if (oldVal === newVal) return;
        if (name === 'doc') {
            try {
                this._doc = typeof newVal === 'string' ? JSON.parse(newVal) : newVal;
            } catch (_) {
                this._doc = null;
            }
        } else if (name === 'cbor-hex') {
            try {
                this._doc = newVal ? CborCodec.decode(newVal) : null;
            } catch (e) {
                console.warn("Failed to decode CBOR in did-document-viewer:", e);
                this._doc = null;
            }
        } else if (name === 'prev-doc') {
            try {
                this._prevDoc = typeof newVal === 'string' ? JSON.parse(newVal) : newVal;
            } catch (_) {
                this._prevDoc = null;
            }
        }
        this.render();
    }

    setDocument(doc: any, prevDoc: any = null): void {
        this._doc = doc;
        this._prevDoc = prevDoc;
        this.render();
    }

    private _escape(str: string): string {
        return (str || '').replace(/[&<>"']/g, (m) => {
            switch (m) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#039;';
                default: return m;
            }
        });
    }

    render(): void {
        if (!this.shadowRoot) return;

        if (!this._doc) {
            this.shadowRoot.innerHTML = `
                <style>
                    :host { display: block; font-family: 'Courier New', monospace; font-size: 11px; }
                    .empty { color: #888; font-style: italic; padding: 8px; border: 1px dashed #444; border-radius: 4px; }
                </style>
                <div class="empty">No DID Document loaded.</div>
            `;
            return;
        }

        const doc = this._doc;
        const didUri = doc.id || 'N/A';
        const vms: W3cVerificationMethod[] = doc.verificationMethod || [];
        const isPqReady = vms.some((vm: W3cVerificationMethod) =>
            vm.type?.includes('MlDsa') ||
            vm.type?.includes('Dilithium') ||
            vm.type?.includes('Falcon') ||
            vm.publicKeyMultibase?.startsWith('z')
        );

        let diffHtml = '';
        if (this._prevDoc) {
            const prevVms: W3cVerificationMethod[] = this._prevDoc.verificationMethod || [];
            const addedVms = vms.filter((vm: W3cVerificationMethod) => !prevVms.some((p: W3cVerificationMethod) => p.id === vm.id));
            const removedVms = prevVms.filter((p: W3cVerificationMethod) => !vms.some((vm: W3cVerificationMethod) => vm.id === p.id));

            if (addedVms.length > 0 || removedVms.length > 0) {
                diffHtml = `
                    <div class="diff-box">
                        <div class="diff-title">⚡ Slot 0 State Transition Diff</div>
                        ${addedVms.map((a: W3cVerificationMethod) => `<div class="diff-add">+ Key Added: ${this._escape(a.id)} (${this._escape(a.type)})</div>`).join('')}
                        ${removedVms.map((r: W3cVerificationMethod) => `<div class="diff-rem">- Key Revoked: ${this._escape(r.id)}</div>`).join('')}
                    </div>
                `;
            }
        }

        const vmRows = vms.map((vm: W3cVerificationMethod, idx: number) => {
            const isPq = vm.type?.includes('MlDsa') || vm.type?.includes('Dilithium') || vm.type?.includes('Falcon');
            const keyPreview = vm.publicKeyMultibase || ((vm as any).publicKeyHex ? '0x' + (vm as any).publicKeyHex : 'N/A');
            return `
                <tr class="${isPq ? 'pq-row' : ''}">
                    <td>#${idx + 1}</td>
                    <td><strong>${this._escape(vm.id || '')}</strong></td>
                    <td><span class="badge ${isPq ? 'pq-badge' : 'secp-badge'}">${this._escape(vm.type || 'Unknown')}</span></td>
                    <td class="key-cell" title="${this._escape(keyPreview)}">${this._escape(keyPreview.slice(0, 24))}...</td>
                </tr>
            `;
        }).join('');

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    font-family: 'Courier New', monospace;
                    font-size: 11px;
                    background: #0f1015;
                    color: #ddd;
                    border: 2px solid #333;
                    border-radius: 6px;
                    padding: 12px;
                }
                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid #333;
                    padding-bottom: 8px;
                    margin-bottom: 10px;
                }
                .did-title {
                    font-size: 12px;
                    font-weight: bold;
                    color: #66fcf1;
                    word-break: break-all;
                }
                .badge {
                    display: inline-block;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 9px;
                    font-weight: bold;
                }
                .pq-badge {
                    background: #45f3ff;
                    color: #000;
                }
                .secp-badge {
                    background: #ffcc00;
                    color: #000;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 6px;
                }
                th {
                    text-align: left;
                    color: #888;
                    border-bottom: 1px solid #222;
                    padding: 4px;
                }
                td {
                    padding: 4px;
                    border-bottom: 1px solid #1a1a24;
                }
                .pq-row {
                    background: rgba(69, 243, 255, 0.05);
                }
                .key-cell {
                    color: #aaa;
                    font-size: 10px;
                }
                .diff-box {
                    background: #181926;
                    border-left: 3px solid #ffcc00;
                    padding: 6px 10px;
                    margin-bottom: 10px;
                    font-size: 10px;
                }
                .diff-title {
                    color: #ffcc00;
                    font-weight: bold;
                    margin-bottom: 4px;
                }
                .diff-add { color: #00ff66; }
                .diff-rem { color: #ff5555; }
                .raw-toggle {
                    margin-top: 8px;
                    cursor: pointer;
                    color: #888;
                    font-size: 10px;
                    text-decoration: underline;
                }
                .raw-content {
                    display: none;
                    margin-top: 6px;
                    background: #050508;
                    padding: 8px;
                    border-radius: 4px;
                    max-height: 140px;
                    overflow: auto;
                    font-size: 9px;
                    color: #92cc41;
                }
            </style>
            <div class="header">
                <span class="did-title">🆔 ${this._escape(didUri)}</span>
                <span class="badge ${isPqReady ? 'pq-badge' : 'secp-badge'}">${isPqReady ? '🛡️ QuantumNative' : '⚠️ Classical'}</span>
            </div>
            ${diffHtml}
            <div>
                <strong>Verification Methods (${vms.length}):</strong>
                <table>
                    <thead>
                        <tr><th>#</th><th>Key ID</th><th>Suite</th><th>Public Key</th></tr>
                    </thead>
                    <tbody>
                        ${vmRows || '<tr><td colspan="4" style="color:#666;">No keys declared</td></tr>'}
                    </tbody>
                </table>
            </div>
            <div class="raw-toggle" id="toggle-raw">▶ Show JSON-LD Wire Data</div>
            <pre class="raw-content" id="raw-box">${this._escape(JSON.stringify(doc, null, 2))}</pre>
        `;

        const toggleBtn = this.shadowRoot.getElementById('toggle-raw');
        const rawBox = this.shadowRoot.getElementById('raw-box');
        if (toggleBtn && rawBox) {
            toggleBtn.addEventListener('click', () => {
                const isHidden = rawBox.style.display === 'none' || !rawBox.style.display;
                rawBox.style.display = isHidden ? 'block' : 'none';
                toggleBtn.textContent = isHidden ? '▼ Hide JSON-LD Wire Data' : '▶ Show JSON-LD Wire Data';
            });
        }
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('did-document-viewer')) {
    customElements.define('did-document-viewer', DidDocumentViewer);
}
