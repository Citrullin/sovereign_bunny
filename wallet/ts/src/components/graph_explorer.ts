import { LitElement, html, css, TemplateResult } from 'lit';
import cytoscape, { Core as CyCore } from 'cytoscape';
import { AuthorityPanelStateMachine } from './authority_machine.js';
import { SqlSchemaRegistry } from './sql_schema_template_engine.js';

export type GraphNodeType =
    | 'global_dao'
    | 'regional_dao'
    | 'regional_dao_shell'
    | 'dao_member'
    | 'dao_admin'
    | 'network_admin'
    | 'smart_contract'
    | 'system_precompile'
    | 'blind_note'
    | 'authority_note'
    | 'git_repo'
    | 'service_account'
    | 'xroad_authority'
    | 'collaborative_authority'
    | 'iot_device'
    | 'human_account';

export interface ShieldedNoteDescriptor {
    commitment: string;
    nullifier?: string;
    targetSlot: number;
    amountFormatted?: string;
    isShielded: boolean; // true = private ciphertext, false = public unencrypted note
    contentType?: string;
    decryptedPayload?: Record<string, unknown> | null;
    irohCid?: string | null;
}

export interface GraphNode {
    id: string; // address or identifier
    label: string;
    type: GraphNodeType;
    address: string;
    did?: string;
    balance?: string;
    votingWeightBps?: number;
    slots?: Array<{ slotId: number; pluginId: string; commitment: string }>;
    notes?: ShieldedNoteDescriptor[];
    metadata?: Record<string, unknown>;
}

export interface GraphEdge {
    source: string;
    target: string;
    relation: string; // e.g., "admin", "sub_dao_member", "dependency", "audit", "note_transfer"
    namespace?: number;
    label?: string;
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export interface GraphExplorerPlugin {
    id: string;
    name: string;
    description: string;
    canHandle(node: GraphNode): boolean;
    renderDetails(node: GraphNode, context: GraphPluginContext): HTMLElement | string;
    onNodeSelect?(node: GraphNode, context: GraphPluginContext): void;
}

export interface GraphPluginContext {
    graph: GraphData;
    activeAddress?: string;
    viewingKey?: string | null;
    hasAdminRelation?(idOrAddr: string): boolean;
    selectNode(id: string): void;
    highlightPath(sourceId: string, targetId: string): void;
    navigateRoute(route: string): void;
}


export class PluginRegistry {
    private plugins: Map<string, GraphExplorerPlugin> = new Map();

    register(plugin: GraphExplorerPlugin): void {
        this.plugins.set(plugin.id, plugin);
    }

    unregister(pluginId: string): void {
        this.plugins.delete(pluginId);
    }

    get(pluginId: string): GraphExplorerPlugin | undefined {
        return this.plugins.get(pluginId);
    }

    getAll(): GraphExplorerPlugin[] {
        return Array.from(this.plugins.values());
    }

    findHandlers(node: GraphNode): GraphExplorerPlugin[] {
        return this.getAll().filter(p => p.canHandle(node));
    }
}

// Built-in Plugin 1: DAO Hierarchy & Voting Weight Inspector
export const DaoGovernancePlugin: GraphExplorerPlugin = {
    id: 'dao_governance',
    name: 'DAO Governance & Voting',
    description: 'Inspects DAO hierarchy, population-based voting weights, and Zanzibar membership relations.',
    canHandle(node: GraphNode): boolean {
        return node.type === 'global_dao' || node.type === 'regional_dao' || node.type === 'regional_dao_shell';
    },
    renderDetails(node: GraphNode): string {
        const weight = node.votingWeightBps !== undefined ? `${node.votingWeightBps} bps (${(node.votingWeightBps / 100).toFixed(2)}%)` : 'N/A';
        const isShell = node.type === 'regional_dao_shell';
        return `
            <div class="plugin-panel dao-panel">
                <h4>🏛️ DAO Governance Profile</h4>
                <p><strong>Name:</strong> ${node.label}</p>
                <p><strong>Address:</strong> <a href="#account/${node.address}" class="entity-address-link" data-node-id="${node.id}" data-address="${node.address}" style="color:#66fcf1; text-decoration:underline;" title="Focus account in explorer"><code>${node.address}</code></a></p>
                <p><strong>DID:</strong> ${node.did || 'did:sovereign:1337:' + node.address}</p>
                <p><strong>Voting Weight (Slot 8):</strong> <span class="badge ${isShell ? 'badge-grey' : 'badge-gold'}">${weight}</span></p>
                <p><strong>Status:</strong> ${isShell ? 'Shell DAO (Pending Activation)' : 'Active Sovereign DAO'}</p>
            </div>
        `;
    }
};

// Built-in Plugin 2: Git Repository & Dependency Chain Inspector
export const GitDagPlugin: GraphExplorerPlugin = {
    id: 'git_dag',
    name: 'Git VCS Object DAG',
    description: 'Inspects decentralized Git trees, HEAD commitments (Slot 3), and build dependency relations.',
    canHandle(node: GraphNode): boolean {
        return node.type === 'git_repo';
    },
    renderDetails(node: GraphNode): string {
        const headSlot = node.slots?.find(s => s.slotId === 3);
        const headOid = headSlot ? headSlot.commitment : 'Unpinned';
        return `
            <div class="plugin-panel git-panel">
                <h4>📦 Git VCS Repository</h4>
                <p><strong>Repository:</strong> ${node.label}</p>
                <p><strong>Account:</strong> <a href="#account/${node.address}" class="entity-address-link" data-node-id="${node.id}" data-address="${node.address}" style="color:#66fcf1; text-decoration:underline;" title="Focus account in explorer"><code>${node.address}</code></a></p>
                <p><strong>Git HEAD OID (Slot 3):</strong> <code>${headOid}</code></p>
                ${node.metadata?.['remote_url'] ? `<p><strong>Remote Sync:</strong> ${node.metadata['remote_url']}</p>` : ''}
                ${headSlot?.commitment ? `
                <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                    <button type="button" class="nes-btn is-primary graph-view-dataset-btn" data-doc-hash="${headSlot.commitment}" data-doc-title="${node.label} Git Tree Object" data-doc-type="git_tree" style="padding:2px 8px; font-size:0.6rem; cursor:pointer;">👁️ View Git Tree</button>
                    <button type="button" class="nes-btn is-success graph-download-dataset-btn" data-doc-hash="${headSlot.commitment}" data-doc-title="${node.label} Git Tree Object" data-doc-type="git_tree" style="padding:2px 8px; font-size:0.6rem; cursor:pointer;">💾 Download Tree</button>
                </div>
                ` : ''}
            </div>
        `;
    }
};

// Built-in Plugin 3: Regulatory Authority & X-Road Gateway Inspector
export const AuthorityPlugin: GraphExplorerPlugin = {
    id: 'regulatory_authority',
    name: 'X-Road Regulatory Authority',
    description: 'Inspects regulatory mandates (MiCA, BaFin, eIDAS), mutual-veto threshold policies, Slot 5 X-Road descriptors, and certificate chain hierarchy.',
    canHandle(node: GraphNode): boolean {
        return node.type === 'xroad_authority' || node.type === 'collaborative_authority';
    },
    renderDetails(node: GraphNode, context: GraphPluginContext): string {
        const isCollab = node.type === 'collaborative_authority';
        const xroadSlot = node.slots?.find(s => s.slotId === 5);
        const meta = node.metadata || {};
        const courtOrder = meta['court_order'] as {
            documentHash?: string;
            issuedEpoch?: number;
            targetAccount?: string;
            mandate?: string;
        } | undefined;

        const certChain = (meta['cert_chain'] as Array<{ role: string; certHash: string; label: string }>) || [];

        let certChainHtml = '';
        if (certChain.length > 0) {
            certChainHtml = `
                <div class="cert-chain-box" style="margin-top: 10px; padding: 8px; background: rgba(114, 9, 183, 0.1); border-radius: 6px; border: 1px solid rgba(114, 9, 183, 0.3);">
                    <h5 style="margin: 0 0 6px 0; font-size: 0.8rem; color: #b5179e;">📜 X.509 / eIDAS Certificate Chain Hierarchy</h5>
                    <div class="cert-chain-tree" style="display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem;">
                        ${certChain.map((c, idx) => `
                            <div class="cert-chain-step" style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="color: #7209b7;">${idx === 0 ? 'Root' : ' ↳'} [${c.role}]</span>
                                    <strong>${c.label}</strong>
                                    <code style="font-size: 0.65rem; color: #888;">${c.certHash.substring(0, 10)}...</code>
                                </div>
                                <button type="button" class="graph-view-dataset-btn" data-doc-hash="${c.certHash}" data-doc-title="${c.label} (${c.role})" data-doc-type="x509_cert" style="background:none; border:none; color:#38bdf8; cursor:pointer; text-decoration:underline; font-size:0.65rem; padding:0 4px;">👁️ View Cert</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        let courtOrderHtml = '';
        if (courtOrder) {
            courtOrderHtml = `
                <div class="court-order-card" style="margin-top: 10px; padding: 8px; background: rgba(230, 57, 70, 0.1); border-radius: 6px; border: 1px solid rgba(230, 57, 70, 0.3);">
                    <h5 style="margin: 0 0 6px 0; font-size: 0.8rem; color: #e63946;">⚖️ Verified Court Order / Warrant</h5>
                    <p style="margin: 2px 0; font-size: 0.75rem;"><strong>Mandate:</strong> ${courtOrder.mandate || 'Compliance Audit'}</p>
                    <p style="margin: 2px 0; font-size: 0.75rem;"><strong>Doc Hash:</strong> <code>${courtOrder.documentHash || 'Unknown'}</code></p>
                    <div style="display:flex; gap:6px; margin:6px 0; flex-wrap:wrap;">
                        <button type="button" class="nes-btn is-primary graph-view-dataset-btn" data-doc-hash="${courtOrder.documentHash || '0x0'}" data-doc-title="${courtOrder.mandate || 'Court Order Warrant'}" data-doc-type="court_order" style="padding:2px 8px; font-size:0.6rem; cursor:pointer;">👁️ View Warrant</button>
                        <button type="button" class="nes-btn is-success graph-download-dataset-btn" data-doc-hash="${courtOrder.documentHash || '0x0'}" data-doc-title="${courtOrder.mandate || 'Court Order Warrant'}" data-doc-type="court_order" style="padding:2px 8px; font-size:0.6rem; cursor:pointer;">💾 Download Warrant</button>
                    </div>
                    ${courtOrder.targetAccount ? `
                        <p style="margin: 2px 0; font-size: 0.75rem;"><strong>Target Account:</strong> <a href="#account/${courtOrder.targetAccount}" class="entity-address-link" data-node-id="${courtOrder.targetAccount}" data-address="${courtOrder.targetAccount}" style="color:#66fcf1; text-decoration:underline;" title="Focus account in explorer"><code>${courtOrder.targetAccount}</code></a></p>
                        <div style="margin-top: 6px;">
                            <button class="action-btn highlight-audit-btn" data-source-id="${node.id}" data-target-id="${courtOrder.targetAccount}" style="padding: 4px 8px; font-size: 0.7rem; border-radius: 4px; cursor: pointer; background: #7209b7; color: white; border: none;">
                                🔍 Traverse Audit Graph to Target
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        return `
            <div class="plugin-panel authority-panel">
                <h4>🛡️ ${isCollab ? 'Asia Collaborative Enforcement' : 'X-Road Regulatory Authority'}</h4>
                <p><strong>Authority Body:</strong> ${node.label}</p>
                <p><strong>Jurisdiction:</strong> ${meta['jurisdiction'] || 'Global'}</p>
                <p><strong>Enforcement Model:</strong> ${isCollab ? '2-of-2 Mutual Veto Threshold (MeitY × MIIT)' : 'Unilateral Compliance Gateway'}</p>
                <p><strong>Descriptor Commitment (Slot 5):</strong> <code>${xroadSlot?.commitment || 'Active'}</code></p>
                ${certChainHtml}
                ${courtOrderHtml}
            </div>
        `;
    }
};

// Built-in Plugin 4: Service Account & Verifiable SQL Digest Inspector (Polymorphic SQL / Slot 4 & 7)
export const ServiceSqlPlugin: GraphExplorerPlugin = {
    id: 'service_sql',
    name: 'Verifiable SQL Digest (Polymorphic Schema)',
    description: 'Inspects decentralized microservice accounts and anchored polymorphic SQL schema digests (Slot 4 / 7).',
    canHandle(node: GraphNode): boolean {
        return node.type === 'service_account' || !!node.slots?.some(s => s.slotId === 4 || s.slotId === 7);
    },
    renderDetails(node: GraphNode): string {
        const sqlSlot = node.slots?.find(s => s.slotId === 4 || s.slotId === 7);
        const dialect = node.metadata?.['sql_dialect'] || 'PostgreSQL / Space and Time SQL';
        const templateType = String(node.metadata?.['schema_template'] || 'relational_ledger');
        const tplObj = SqlSchemaRegistry.getInstance().get(templateType);
        const tplName = tplObj ? `${tplObj.name} (${tplObj.dialect})` : templateType;
        return `
            <div class="plugin-panel service-panel">
                <h4>⚙️ Microservice & SQL Account</h4>
                <p><strong>Service / App:</strong> ${node.label}</p>
                <p><strong>Dialect:</strong> <span style="color:#66fcf1;">${dialect}</span></p>
                <p><strong>Template Archetype:</strong> <span style="color:#ffd166;">${tplName}</span></p>
                ${node.metadata?.['oci_image'] ? `<p><strong>OCI Image:</strong> ${node.metadata['oci_image']}</p>` : ''}
                <p><strong>SQL Schema Digest (Slot ${sqlSlot?.slotId ?? 4}):</strong> <code>${sqlSlot?.commitment || 'Committed at Genesis'}</code></p>
                ${sqlSlot?.commitment ? `
                <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                    <button type="button" class="nes-btn is-primary graph-view-dataset-btn"
                        data-doc-hash="${sqlSlot.commitment}"
                        data-doc-title="${node.label} SQL DDL Schema"
                        data-doc-type="sql_schema"
                        data-slot-id="${sqlSlot.slotId ?? 4}"
                        data-template-id="${templateType}"
                        data-entity-did="${node.did || ''}"
                        data-entity-address="${node.address || ''}"
                        style="padding:2px 8px; font-size:0.6rem; cursor:pointer;">👁️ View SQL DDL</button>
                    <button type="button" class="nes-btn is-success graph-download-dataset-btn"
                        data-doc-hash="${sqlSlot.commitment}"
                        data-doc-title="${node.label} SQL DDL Schema"
                        data-doc-type="sql_schema"
                        data-slot-id="${sqlSlot.slotId ?? 4}"
                        data-template-id="${templateType}"
                        data-entity-did="${node.did || ''}"
                        data-entity-address="${node.address || ''}"
                        style="padding:2px 8px; font-size:0.6rem; cursor:pointer;">💾 Download Schema</button>
                </div>
                ` : ''}
            </div>
        `;
    }
};

// Built-in Plugin 5: Blind Notes & Shielded State Inspector (Privacy Layer)
export const BlindNotePlugin: GraphExplorerPlugin = {

    id: 'blind_notes',
    name: 'Shielded Blind Notes & Public Vouchers',
    description: 'Inspects unspent blind notes, distinguishing exposed/public authority notes from local sovereign shielded notes with viewing-key decryption.',
    canHandle(node: GraphNode): boolean {
        return (node.notes !== undefined && node.notes.length > 0) || node.type === 'blind_note' || node.type === 'authority_note';
    },
    renderDetails(node: GraphNode, context: GraphPluginContext): string {
        const notes = node.notes || [];
        if (notes.length === 0) {
            return `
                <div class="plugin-panel note-panel">
                    <h4>🔒 Shielded State</h4>
                    <p class="empty-hint">No notes currently attached to this account.</p>
                </div>
            `;
        }

        const renderedNotes = notes.map((note, idx) => {
            const isPublic = !note.isShielded;
            const hasAdmin = context.activeAddress ? (context.hasAdminRelation ? context.hasAdminRelation(context.activeAddress) : false) : false;
            const hasAccess = isPublic || !!context.viewingKey || hasAdmin || (context.activeAddress?.toLowerCase() === node.address.toLowerCase());
            
            let contentDisplay = '';
            if (isPublic && note.decryptedPayload) {
                contentDisplay = `<pre class="note-payload"><code>${JSON.stringify(note.decryptedPayload, null, 2)}</code></pre>`;
            } else if (hasAccess && note.decryptedPayload) {
                contentDisplay = `<div class="decrypted-box">🔓 <strong>Decrypted via Sovereign Viewing Key:</strong><pre><code>${JSON.stringify(note.decryptedPayload, null, 2)}</code></pre></div>`;
            } else {
                contentDisplay = `<div class="shielded-box">🔒 <strong>Encrypted Payload (ZK Shielded)</strong><br><small>Viewing key required to decrypt private state.</small></div>`;
            }

            return `
                <div class="note-item ${isPublic ? 'note-public' : 'note-shielded'}">
                    <div class="note-badge-row">
                        <span class="badge ${isPublic ? 'badge-public' : 'badge-shielded'}">${isPublic ? 'Public Authority Note' : 'Shielded Note'}</span>
                        <span class="note-slot">Slot ${note.targetSlot}</span>
                        ${note.amountFormatted ? `<span class="note-amount">${note.amountFormatted}</span>` : ''}
                    </div>
                    <p><strong>Commitment:</strong> <code>${note.commitment.substring(0, 18)}...</code></p>
                    ${note.nullifier ? `<p><strong>Nullifier:</strong> <code>${note.nullifier.substring(0, 18)}...</code></p>` : ''}
                    ${contentDisplay}
                </div>
            `;
        }).join('');

        return `
            <div class="plugin-panel note-panel">
                <h4>🔒 Blind Notes & Shielded State (${notes.length})</h4>
                ${renderedNotes}
            </div>
        `;
    }
};


// Built-in Plugin 6: W3C DID Identity & CAIP-10 Structured Viewer
export const DidIdentityPlugin: GraphExplorerPlugin = {
    id: 'did_identity',
    name: 'W3C DID Identity & CAIP-10',
    description: 'Renders structured DID Document capability cards with multicodec key-type decoding and CAIP-10 account identifiers instead of raw JSON.',
    canHandle(node: GraphNode): boolean {
        return node.type === 'human_account' || node.type === 'dao_member' || node.type === 'dao_admin'
            || (node.type === 'service_account' && !!node.did)
            || (node.type === 'smart_contract' && !!node.did);
    },
    renderDetails(node: GraphNode): string {
        const did = node.did || `did:sovereign:1337:${node.address}`;
        const caip10 = `eip155:1337:${node.address}`;

        // Decode multicodec prefixes for known key types
        function keyTypeLabel(vmId: string, vmType: string): { name: string; badge: string; purpose: string } {
            const id = (vmId || '').toLowerCase();
            const t  = (vmType || '').toLowerCase();
            if (id.includes('mldsa') || id.includes('ml-dsa') || t.includes('mldsa') || id.includes('0x9301'))
                return { name: 'ML-DSA-65', badge: '🔮 Quantum', purpose: 'NIST FIPS 204 — Quantum Authentication' };
            if (id.includes('falcon') || id.includes('0x9201'))
                return { name: 'Falcon-512', badge: '⚡ Compact PQ', purpose: 'NIST Round 5 — Compact PQ Proofs' };
            if (id.includes('slhdsa') || id.includes('slh-dsa') || id.includes('0x9401'))
                return { name: 'SLH-DSA', badge: '🌳 Stateless Hash', purpose: 'NIST FIPS 205 — Stateless Hash Signature' };
            if (id.includes('bls') || id.includes('bls12') || id.includes('0xea01'))
                return { name: 'BLS12-381', badge: '🔗 Aggregation', purpose: 'State Proof Aggregation & Threshold Voting' };
            if (id.includes('secp256k1') || id.includes('0xe701') || t.includes('ecdsasecp256k1'))
                return { name: 'Secp256k1', badge: '🔑 Classical EVM', purpose: 'EIP-55 Classical EVM Transaction Signer' };
            if (id.includes('ed25519') || id.includes('0xed01'))
                return { name: 'Ed25519', badge: '🔑 Classical', purpose: 'Classical EdDSA Signing' };
            if (id.includes('pasta') || id.includes('0x9001'))
                return { name: 'Pasta / Pallas', badge: '🎭 ZK Circuit', purpose: 'Halo2 ZK Circuit Key' };
            if (id.includes('babyjubjub') || id.includes('0x9101'))
                return { name: 'BabyJubjub', badge: '🎵 ZK Privacy', purpose: 'Groth16 / Noir ZK Privacy Key' };
            return { name: vmType || 'Unknown', badge: '❓', purpose: 'Unknown key type' };
        }

        const metadata = node.metadata || {};
        const verificationMethods: any[] = (metadata['verificationMethods'] as any[]) || [];
        const services: any[] = (metadata['services'] as any[]) || [];
        const controller: string = (metadata['controller'] as string) || did;

        const methodCards = verificationMethods.length > 0
            ? verificationMethods.map((vm: any) => {
                const kt = keyTypeLabel(vm.id || '', vm.type || '');
                const shortKey = vm.publicKeyMultibase
                    ? vm.publicKeyMultibase.substring(0, 12) + '...' + vm.publicKeyMultibase.slice(-6)
                    : (vm.publicKeyHex ? vm.publicKeyHex.substring(0, 12) + '...' : 'N/A');
                return `
                    <div class="did-key-card" style="border:1px solid #2a4a4a; border-radius:6px; padding:8px; margin-bottom:6px; background:#0d1f1f;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-size:0.75rem; font-weight:bold; color:#66fcf1;">${kt.name}</span>
                            <span style="font-size:0.6rem; background:#1a3a3a; color:#66fcf1; padding:2px 6px; border-radius:10px;">${kt.badge}</span>
                        </div>
                        <p style="margin:2px 0; font-size:0.6rem; color:#aaa;">${kt.purpose}</p>
                        <p style="margin:2px 0; font-size:0.58rem; color:#888;">Key: <code style="color:#ffd700">${shortKey}</code></p>
                    </div>
                `;
            }).join('')
            : `<p style="font-size:0.65rem; color:#888;">No verification methods published on-chain yet.</p>`;

        const serviceList = services.length > 0
            ? `<ul style="font-size:0.6rem; color:#aaa; padding-left:16px; margin:4px 0;">${services.map((s: any) =>
                `<li><strong>${s.type || 'Service'}:</strong> ${s.serviceEndpoint || s.id || '-'}</li>`).join('')}</ul>`
            : '';

        return `
            <div class="plugin-panel did-identity-panel" style="font-size:0.7rem;">
                <h4 style="margin-bottom:8px;">🪪 W3C DID Identity</h4>
                <div style="margin-bottom:6px;">
                    <p style="margin:2px 0;"><strong>DID URI:</strong></p>
                    <code style="font-size:0.6rem; color:#66fcf1; word-break:break-all;">${did}</code>
                </div>
                <div style="margin-bottom:8px;">
                    <p style="margin:2px 0;"><strong>CAIP-10:</strong>
                        <span style="background:#1a3a1a; color:#92cc41; padding:2px 8px; border-radius:10px; font-size:0.6rem; font-family:monospace;">${caip10}</span>
                    </p>
                    <p style="margin:2px 0;"><strong>Controller:</strong> <code style="font-size:0.6rem;">${controller.substring(0, 30)}${controller.length > 30 ? '...' : ''}</code></p>
                </div>
                <div style="margin-bottom:8px;">
                    <p style="margin-bottom:4px;"><strong>Verification Keys & Capabilities:</strong></p>
                    ${methodCards}
                </div>
                ${serviceList ? `<div><p style="margin-bottom:4px;"><strong>Services:</strong></p>${serviceList}</div>` : ''}
            </div>
        `;
    }
};

// Built-in Plugin 7: Polymorphic Account Register Slots (Tier-2 Microkernel State)
export const PolymorphicSlotsPlugin: GraphExplorerPlugin = {
    id: 'polymorphic_slots',
    name: 'Polymorphic Account-Register Slots',
    description: 'Inspects on-chain flat register slots (R_0..R_63), cryptographic state roots, and verification plugins.',
    canHandle(node: GraphNode): boolean {
        return !!(node.slots && node.slots.length > 0);
    },
    renderDetails(node: GraphNode): string {
        const slots = node.slots || [];
        const slotRows = slots.map(s => {
            const isNonZero = s.commitment && s.commitment !== '0x0000000000000000000000000000000000000000000000000000000000000000';
            const shortCommit = isNonZero
                ? `${s.commitment.slice(0, 10)}...${s.commitment.slice(-6)}`
                : 'Zero (Uninitialized)';
            return `
                <tr style="border-bottom: 1px solid #222;">
                    <td style="padding: 4px 6px; font-weight: bold; color: #45f3ff;">R_${s.slotId}</td>
                    <td style="padding: 4px 6px; color: #aaa; font-size: 0.65rem;"><code>${s.pluginId}</code></td>
                    <td style="padding: 4px 6px; font-family: monospace; font-size: 0.62rem; color: #ffcc00;">
                        ${isNonZero
                            ? `<a href="#commitment/${s.commitment}" class="commitment-jump-link" data-commitment="${s.commitment}" data-slot-id="${s.slotId}" data-plugin-id="${s.pluginId}" style="color: #ffcc00; text-decoration: underline;" title="Inspect state commitment entity and cryptographic proof">${shortCommit}</a>`
                            : shortCommit}
                    </td>
                    <td style="padding: 4px 6px; text-align:right;">
                        ${isNonZero ? `
                            <button type="button" class="graph-view-dataset-btn" data-doc-hash="${s.commitment}" data-doc-title="${node.label} R_${s.slotId} (${s.pluginId})" data-doc-type="slot_data" data-slot-id="${s.slotId}" style="background:none; border:none; color:#45f3ff; cursor:pointer; text-decoration:underline; font-size:0.6rem; padding:0 4px;">👁️ View</button>
                            <button type="button" class="graph-download-dataset-btn" data-doc-hash="${s.commitment}" data-doc-title="${node.label} R_${s.slotId} (${s.pluginId})" data-doc-type="slot_data" data-slot-id="${s.slotId}" style="background:none; border:none; color:#10b981; cursor:pointer; text-decoration:underline; font-size:0.6rem; padding:0 4px;">💾 Download</button>
                        ` : '-'}
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <div class="plugin-panel slots-panel" style="font-size:0.7rem; margin-top:8px;">
                <h4 style="margin-bottom:6px; color:#45f3ff;">🗂️ Polymorphic Account Registers (${slots.length})</h4>
                <table style="width:100%; border-collapse:collapse; text-align:left;">
                    <thead>
                        <tr style="border-bottom: 1px solid #333; color: #777; font-size: 0.6rem; text-transform: uppercase;">
                            <th style="padding: 4px 6px;">Slot</th>
                            <th style="padding: 4px 6px;">Plugin ID</th>
                            <th style="padding: 4px 6px;">State Commitment Root</th>
                            <th style="padding: 4px 6px; text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${slotRows}
                    </tbody>
                </table>
            </div>
        `;
    }
};

function getEmojiBase64Svg(emoji: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><text x="32" y="44" font-size="34" text-anchor="middle" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${emoji}</text></svg>`;
    const b64 = typeof window !== 'undefined' && typeof window.btoa === 'function'
        ? window.btoa(unescape(encodeURIComponent(svg)))
        : (typeof Buffer !== 'undefined' ? Buffer.from(svg).toString('base64') : '');
    return `data:image/svg+xml;base64,${b64}`;
}

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

export class GraphExplorer extends BaseElement {
    static properties = {
        _graphData: { state: true },
        _selectedNodeId: { state: true },
        _filterType: { state: true },
        _viewingKey: { state: true },
        _activeAddress: { state: true },
        _highlightedPath: { state: true },
        _searchQuery: { state: true },
        _viewMode: { state: true },
        _selectedDrawerOpen: { state: true },
        src: { type: String, attribute: 'src' },
    };

    createRenderRoot(): HTMLElement {
        return this;
    }

    src: string = '';
    private _graphData: GraphData = { nodes: [], edges: [] };
    private _selectedNodeId: string | null = null;
    private _filterType: string = 'all';
    private _searchQuery: string = '';
    private _viewMode: 'visual' | 'cards' = 'visual';
    private _selectedDrawerOpen: boolean = false;
    private _viewingKey: string | null = null;
    private _activeAddress: string | null = null;
    private _highlightedPath: string[] = [];
    private _pluginRegistry: PluginRegistry = new PluginRegistry();
    private _authorityActor: AuthorityPanelStateMachine | null = null;
    private _delegatedBound: boolean = false;
    private _cy: CyCore | null = null;
    private _cyLayout: 'cose' | 'concentric' | 'breadthfirst' = 'cose';
    private _searchFocused: boolean = false;
    private _searchCursorPos: number = 0;
    private _searchDebounceTimer: any = null;
    private _smoothZoomTarget: number | null = null;
    private _smoothZoomCenter: { x: number; y: number } = { x: 0, y: 0 };
    private _smoothZoomRafId: number | null = null;

    constructor() {
        super();
        this._pluginRegistry.register(DaoGovernancePlugin);
        this._pluginRegistry.register(GitDagPlugin);
        this._pluginRegistry.register(AuthorityPlugin);
        this._pluginRegistry.register(ServiceSqlPlugin);
        this._pluginRegistry.register(BlindNotePlugin);
        this._pluginRegistry.register(DidIdentityPlugin);
        this._pluginRegistry.register(PolymorphicSlotsPlugin);
        this._authorityActor = new AuthorityPanelStateMachine();
    }

    get authorityActor(): AuthorityPanelStateMachine | null {
        return this._authorityActor;
    }

    getGraphData(): GraphData {
        return this._graphData;
    }

    setViewingContext(activeAddress: string | null, viewingKey: string | null): void {
        this._activeAddress = activeAddress;
        this._viewingKey = viewingKey;
        const filteredNodes = this._getFilteredNodes();
        if (this._cy && !this._cy.destroyed()) {
            this._initOrUpdateCytoscape(filteredNodes, this._graphData.edges, this.getSelectedNode());
        }
        if (typeof (this as any).requestUpdate === 'function') {
            (this as any).requestUpdate();
        } else {
            this.render();
        }
    }

    get pluginRegistry(): PluginRegistry {
        return this._pluginRegistry;
    }

    connectedCallback(): void {
        super.connectedCallback?.();
        this.loadGraphFromGenesisOrLattice().catch(() => {});
        if (typeof window !== 'undefined') {
            (window as any).sovereignGraphExplorer = this;
            (window as any).selectGraphEntityByCommitment = (commitment: string, addressHint?: string) => {
                return this.selectNodeByCommitment(commitment, addressHint);
            };
        }
        this._bindDelegatedEvents();
        this.render();
    }

    async loadGraphFromGenesisOrLattice(): Promise<void> {
        // 1. Explicit src attribute if developer provided one
        if (this.src) {
            try {
                const r = await fetch(this.src);
                if (r.ok) {
                    const data = await r.json();
                    if (data && Array.isArray(data.nodes) && data.nodes.length > 0) {
                        this.setGraphData(data);
                        return;
                    }
                }
            } catch (_) {}
        }

        // 2. Genesis Topology Graph from config or standard endpoint
        const genesisUrl = (typeof window !== 'undefined' && (window as any).sovereignConfig?.genesisGraphUrl) || '/genesis_graph.json';
        try {
            let r = await fetch(genesisUrl);
            if (!r.ok && genesisUrl === '/genesis_graph.json') {
                r = await fetch('/genesis_graph.example.json');
            }
            if (r.ok) {
                const data = await r.json();
                if (data && Array.isArray(data.nodes) && data.nodes.length > 0) {
                    this.setGraphData(data);
                    return;
                }
            }
        } catch (_) {}

        // 3. Iroh Content-Addressed Storage: Load pinned genesis topology graph by ticket
        const irohTicket = (typeof window !== 'undefined' && (window as any).sovereignConfig?.irohGraphTicket) || null;
        if (irohTicket) {
            try {
                const irohUrl = `/storage/blob/${encodeURIComponent(irohTicket)}`;
                const r = await fetch(irohUrl);
                if (r.ok) {
                    const data = await r.json();
                    if (data && Array.isArray(data.nodes) && data.nodes.length > 0) {
                        this.setGraphData(data);
                        return;
                    }
                }
            } catch (_) {}
        }

        // 3. Construct Live Account-Lattice & Zanzibar Graph from active wallet session
        await this.constructLiveLatticeGraph();
    }

    async constructLiveLatticeGraph(): Promise<void> {
        const activeAddr = this._activeAddress
            || (typeof window !== 'undefined' && (window as any).connectedAddress)
            || '0x0000000000000000000000000000000000000000';

        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];

        // Dynamic slots from configuration
        const configuredSlots = (typeof window !== 'undefined' && (window as any).sovereignConfig?.slots) || [
            { id: 0, name: "DID Document Root", pluginId: "core.did_identity", precompile: "0x03" },
            { id: 1, name: "Zanzibar ReBAC SMT", pluginId: "core.zanzibar", precompile: "0x61" },
            { id: 2, name: "Native Payment Core", pluginId: "core.native_payment", precompile: "0x02" },
            { id: 3, name: "Git VCS Object DAG", pluginId: "vcs.git_dag", precompile: "0x63" },
            { id: 4, name: "Relational SQL Digest", pluginId: "ext.sqldigest", precompile: "0x62" },
            { id: 5, name: "X-Road Service Descriptor", pluginId: "authority.xroad_descriptor", precompile: "0x05" },
            { id: 6, name: "Supply Chain Interface", pluginId: "vcs.interface_contract", precompile: "0x66" },
            { id: 7, name: "Reputation & Merit Score", pluginId: "reputation.merit", precompile: "0x07" }
        ];

        const initialSlots = configuredSlots.map((s: any) => ({
            slotId: s.id,
            pluginId: s.pluginId,
            commitment: '0x0000000000000000000000000000000000000000000000000000000000000000'
        }));

        // Build active root account node
        const latticeRootNode: GraphNode = {
            id: activeAddr,
            label: `Lattice Account (${activeAddr.slice(0, 8)}...${activeAddr.slice(-6)})`,
            type: 'human_account',
            address: activeAddr,
            did: `did:sovereign:1337:${activeAddr}`,
            slots: initialSlots,
            metadata: {
                source: 'onchain_lattice_discovery',
                synced_at: new Date().toISOString()
            }
        };
        nodes.push(latticeRootNode);

        // If RPC is available, query account history and peer note interactions
        if (typeof window !== 'undefined' && typeof (window as any).callBunnyRpc === 'function') {
            try {
                const histRes = await (window as any).callBunnyRpc('sovereign_getAccountHistory', [activeAddr]);
                if (histRes && Array.isArray(histRes.result)) {
                    for (const item of histRes.result) {
                        const peer = item.recipient || item.sender || item.target;
                        if (peer && typeof peer === 'string' && peer.startsWith('0x') && peer !== activeAddr) {
                            if (!nodes.some(n => n.id.toLowerCase() === peer.toLowerCase())) {
                                nodes.push({
                                    id: peer,
                                    label: `Lattice Peer (${peer.slice(0, 8)}...${peer.slice(-6)})`,
                                    type: 'human_account',
                                    address: peer,
                                    did: `did:sovereign:1337:${peer}`,
                                    slots: [
                                        { slotId: 0, pluginId: 'core.did_identity', commitment: '0x0000000000000000000000000000000000000000000000000000000000000000' },
                                        { slotId: 2, pluginId: 'core.native_payment', commitment: '0x0000000000000000000000000000000000000000000000000000000000000000' }
                                    ]
                                });
                            }
                            edges.push({
                                source: activeAddr,
                                target: peer,
                                relation: item.type === 'send' ? 'transfers_to' : 'receives_from'
                            });
                        }
                    }
                }
            } catch (_) {}
        }

        this.setGraphData({
            nodes,
            edges
        });
    }

    disconnectedCallback(): void {
        super.disconnectedCallback?.();
        if (this._smoothZoomRafId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this._smoothZoomRafId);
            this._smoothZoomRafId = null;
        }
        if (this._cy && !this._cy.destroyed()) {
            this._cy.destroy();
            this._cy = null;
        }
    }

    private _bindDelegatedEvents(): void {
        if (this._delegatedBound) return;
        this._delegatedBound = true;

        this.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.graph-search-input')) {
                this._searchFocused = false;
            }

            // Commitment jump link
            const commitEl = target.closest('.commitment-jump-link, [data-commitment]') as HTMLElement;
            if (commitEl) {
                e.preventDefault();
                e.stopPropagation();
                const c = commitEl.dataset.commitment;
                const slotId = commitEl.dataset.slotId;
                const pluginId = commitEl.dataset.pluginId;
                if (c) {
                    if (typeof (window as any).showCommitmentDetails === 'function') {
                        (window as any).showCommitmentDetails({
                            commitment: c,
                            address: this.getSelectedNode()?.address,
                            slotId,
                            pluginId
                        });
                    } else {
                        this.selectNodeByCommitment(c);
                    }
                }
                return;
            }

            // Entity address navigation link
            const addrEl = target.closest('.entity-address-link') as HTMLElement;
            if (addrEl) {
                e.preventDefault();
                e.stopPropagation();
                const addr = addrEl.dataset.address || addrEl.dataset.nodeId;
                if (addr) {
                    this.selectNodeByCommitment(addr, addr);
                }
                return;
            }

            // Dataset modal viewer button
            const viewDsBtn = target.closest('.graph-view-dataset-btn') as HTMLElement;
            if (viewDsBtn) {
                e.preventDefault();
                e.stopPropagation();
                const docHash = viewDsBtn.dataset.docHash || '0x0';
                const docTitle = viewDsBtn.dataset.docTitle || 'Dataset Preview';
                const docType = viewDsBtn.dataset.docType || 'json';
                const slotId = viewDsBtn.dataset.slotId;
                const templateId = viewDsBtn.dataset.templateId;
                const entityDid = viewDsBtn.dataset.entityDid;
                const entityAddress = viewDsBtn.dataset.entityAddress;
                this._openDatasetModal(docTitle, docHash, docType, slotId, templateId, entityDid, entityAddress);
                return;
            }

            // Dataset download button
            const dlDsBtn = target.closest('.graph-download-dataset-btn') as HTMLElement;
            if (dlDsBtn) {
                e.preventDefault();
                e.stopPropagation();
                const docHash = dlDsBtn.dataset.docHash || '0x0';
                const docTitle = dlDsBtn.dataset.docTitle || 'dataset';
                const docType = dlDsBtn.dataset.docType || 'json';
                const slotId = dlDsBtn.dataset.slotId;
                const templateId = dlDsBtn.dataset.templateId;
                const entityDid = dlDsBtn.dataset.entityDid;
                const entityAddress = dlDsBtn.dataset.entityAddress;
                this._downloadDatasetFile(docTitle, docHash, docType, slotId, templateId, entityDid, entityAddress);
                return;
            }

            // Top drawer toggle
            const drawerBtn = target.closest('.toggle-selected-drawer') as HTMLElement;
            if (drawerBtn) {
                e.preventDefault();
                e.stopPropagation();
                this._selectedDrawerOpen = !this._selectedDrawerOpen;
                this._updateDrawerDom();
                return;
            }

            // View mode switch
            const modeBtn = target.closest('[data-view-mode]') as HTMLElement;
            if (modeBtn) {
                e.preventDefault();
                e.stopPropagation();
                const m = modeBtn.dataset.viewMode as 'visual' | 'cards';
                if (m) {
                    this._viewMode = m;
                    if (typeof (this as any).requestUpdate === 'function') {
                        (this as any).requestUpdate();
                    } else {
                        this.render();
                    }
                }
                return;
            }

            // Cytoscape Layout toolbar buttons
            if (target.closest('.cy-layout-cose-btn')) {
                e.preventDefault();
                e.stopPropagation();
                this._cyLayout = 'cose';
                this._runCyLayout();
                return;
            }
            if (target.closest('.cy-layout-concentric-btn')) {
                e.preventDefault();
                e.stopPropagation();
                this._cyLayout = 'concentric';
                this._runCyLayout();
                return;
            }
            if (target.closest('.cy-layout-tree-btn')) {
                e.preventDefault();
                e.stopPropagation();
                this._cyLayout = 'breadthfirst';
                this._runCyLayout();
                return;
            }
            if (target.closest('.cy-zoomin-btn')) {
                e.preventDefault();
                e.stopPropagation();
                if (this._cy && !this._cy.destroyed()) {
                    const currentZoom = this._cy.zoom();
                    const newZoom = Math.min(4.5, currentZoom * 1.4);
                    const center = { x: this._cy.width() / 2, y: this._cy.height() / 2 };
                    this._triggerSmoothZoom(newZoom, center);
                }
                return;
            }
            if (target.closest('.cy-zoomout-btn')) {
                e.preventDefault();
                e.stopPropagation();
                if (this._cy && !this._cy.destroyed()) {
                    const currentZoom = this._cy.zoom();
                    const newZoom = Math.max(0.15, currentZoom / 1.4);
                    const center = { x: this._cy.width() / 2, y: this._cy.height() / 2 };
                    this._triggerSmoothZoom(newZoom, center);
                }
                return;
            }
            if (target.closest('.cy-fit-btn')) {
                e.preventDefault();
                e.stopPropagation();
                if (this._cy && !this._cy.destroyed()) this._cy.fit(undefined, 35);
                return;
            }
            if (target.closest('.cy-reset-btn')) {
                e.preventDefault();
                e.stopPropagation();
                if (this._cy && !this._cy.destroyed()) this._cy.reset();
                return;
            }

            // Filter button
            const filterBtn = target.closest('.filter-btn') as HTMLElement;
            if (filterBtn) {
                e.preventDefault();
                e.stopPropagation();
                const f = filterBtn.dataset.filter || 'all';
                this.setFilter(f);
                return;
            }

            // Node selection (chip, SVG group, or linked relation)
            const nodeEl = target.closest('[data-node-id]') as HTMLElement;
            if (nodeEl) {
                e.preventDefault();
                e.stopPropagation();
                const nid = nodeEl.dataset.nodeId;
                if (nid) {
                    this.selectNode(nid);
                }
                return;
            }

            // Highlight path button
            const auditBtn = target.closest('.highlight-audit-btn') as HTMLElement;
            if (auditBtn) {
                e.preventDefault();
                e.stopPropagation();
                const src = auditBtn.dataset.sourceId;
                const tgt = auditBtn.dataset.targetId;
                if (src && tgt) {
                    this.highlightPath(src, tgt);
                }
                return;
            }
        });
    }

    setGraphData(data: GraphData): void {
        this._graphData = data;
        if (!this._selectedNodeId && data.nodes.length > 0) {
            this._selectedNodeId = data.nodes[0].id;
        }
        if (typeof (this as any).requestUpdate === 'function') {
            (this as any).requestUpdate();
        } else {
            this.render();
        }

        const daoEl = typeof document !== 'undefined' ? (document.getElementById('zodiac-dao-explorer-panel') as any) : null;
        if (daoEl && typeof daoEl.loadActiveDaos === 'function') {
            daoEl.loadActiveDaos(data, this._activeAddress);
        }
    }

    getSelectedNode(): GraphNode | null {
        if (!this._selectedNodeId) return this._graphData.nodes[0] || null;
        return this._graphData.nodes.find(n => n.id.toLowerCase() === this._selectedNodeId!.toLowerCase()) || null;
    }

    selectNode(id: string): void {
        this._selectedNodeId = id;
        const selectedNode = this._graphData.nodes.find(n => n.id.toLowerCase() === id.toLowerCase());
        if (selectedNode && (selectedNode.type === 'xroad_authority' || selectedNode.type === 'collaborative_authority')) {
            const meta = selectedNode.metadata || {};
            const courtOrder = meta['court_order'] as any;
            const certChain = (meta['cert_chain'] as any[]) || [];
            this._authorityActor?.send({
                type: 'LOAD_AUTHORITY',
                authorityId: selectedNode.id,
                authorityAddress: selectedNode.address,
                jurisdiction: (meta['jurisdiction'] as string) || 'Global',
                courtOrder: courtOrder || null,
                certChain,
            });
        }

        if (this._cy && !this._cy.destroyed()) {
            try {
                this._cy.nodes().unselect();
                const target = this._cy.$id(id);
                if (target && target.length > 0) {
                    target.select();
                    const currentZoom = this._cy.zoom();
                    const targetZoom = Math.min(3.5, Math.max(currentZoom, 1.35));
                    this._cy.animate({
                        center: { eles: target },
                        zoom: targetZoom,
                        duration: 500,
                        easing: 'ease-out-cubic'
                    });
                }
            } catch (_) {}
        }

        // Update drawer and node chips DOM directly so the whole graph canvas is NOT destroyed or redrawn
        this._updateDrawerDom();
        this._updateChipsDom();
    }

    selectNodeByCommitment(commitmentOrRoot: string, addressHint?: string): boolean {
        if (!commitmentOrRoot) return false;
        const target = commitmentOrRoot.toLowerCase().trim();
        const hint = (addressHint || '').toLowerCase().trim();

        const match = this._graphData.nodes.find(n => {
            if (n.address.toLowerCase() === target) return true;
            if (hint && n.address.toLowerCase() === hint) return true;
            if (n.id.toLowerCase() === target) return true;
            if (n.slots && n.slots.some(s => s.commitment && s.commitment.toLowerCase() === target)) return true;
            if (n.metadata && JSON.stringify(n.metadata).toLowerCase().includes(target)) return true;
            return false;
        });

        if (match) {
            this.selectNode(match.id);
            this._selectedDrawerOpen = true;
            if (typeof (this as any).requestUpdate === 'function') {
                (this as any).requestUpdate();
            } else {
                this.render();
            }
            try {
                this.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (_) {}
            return true;
        }

        // Dynamic node synthesis for unindexed onchain addresses
        const addrCandidate = (target.startsWith('0x') && target.length === 42)
            ? target
            : ((hint.startsWith('0x') && hint.length === 42) ? hint : null);

        if (addrCandidate) {
            const newNode: GraphNode = {
                id: addrCandidate,
                label: `Account (${addrCandidate.slice(0, 8)}...${addrCandidate.slice(-6)})`,
                type: 'human_account',
                address: addrCandidate,
                did: `did:sovereign:1337:${addrCandidate}`,
                slots: [
                    { slotId: 0, pluginId: 'did_identity', commitment: '0x0000000000000000000000000000000000000000000000000000000000000000' },
                    { slotId: 1, pluginId: 'zanzibar_rebac', commitment: '0x0000000000000000000000000000000000000000000000000000000000000000' },
                    { slotId: 2, pluginId: 'blind_notes', commitment: '0x0000000000000000000000000000000000000000000000000000000000000000' },
                    { slotId: 0x53, pluginId: 'iroh.storage', commitment: '0x0000000000000000000000000000000000000000000000000000000000000000' }
                ],
                metadata: {
                    discovered_via: 'onchain_reference',
                    created_at: new Date().toISOString()
                }
            };
            this._graphData.nodes.push(newNode);
            if (this._cy && !this._cy.destroyed()) {
                try {
                    const icon = this.getNodeIcon(newNode.type);
                    const iconSvg = getEmojiBase64Svg(icon);
                    const cleanLabel = this.formatNodeDisplayLabel(newNode);
                    this._cy.add({
                        group: 'nodes',
                        data: {
                            id: newNode.id,
                            label: newNode.label,
                            cleanLabel,
                            type: newNode.type,
                            address: newNode.address,
                            color: this.getNodeColor(newNode.type),
                            icon,
                            iconSvg,
                            isAdmin: 'false',
                            isHighlighted: 'false',
                            isSelected: 'true'
                        }
                    });
                } catch (_) {}
            }
            this.selectNode(newNode.id);
            this._selectedDrawerOpen = true;
            if (typeof (this as any).requestUpdate === 'function') {
                (this as any).requestUpdate();
            } else {
                this.render();
            }
            try {
                this.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (_) {}
            return true;
        }

        return false;
    }

    private _synthesizeDatasetContent(title: string, hash: string, type: string, slotId?: string | number, templateId?: string, entityDid?: string, entityAddress?: string): { content: string; contentType: 'json' | 'sql' | 'text'; filename: string } {
        const cleanHash = (hash || '').trim();
        if (type === 'sql_schema' || type === 'sql' || slotId === '4' || slotId === 4 || slotId === '7' || slotId === 7) {
            const rawTitle = title.replace(/\s*SQL DDL Schema\s*/i, '').trim();
            const cleanIdent = rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'service_state';
            const registry = SqlSchemaRegistry.getInstance();
            const { ddl, template } = registry.renderDdl(templateId, {
                entityLabel: rawTitle,
                entityDid,
                entityAddress,
                digest: cleanHash,
                slotId: slotId ?? 4
            });

            return {
                contentType: 'sql',
                filename: `${cleanIdent}_${template.id}.sql`,
                content: ddl,
            };
        }

        if (type === 'court_order' || type === 'warrant') {
            return {
                contentType: 'json',
                filename: `warrant_${cleanHash.slice(0, 10)}.json`,
                content: JSON.stringify({
                    standard: "eIDAS / BaFin Verified Injunction Warrant",
                    mandate: title,
                    documentHash: cleanHash,
                    jurisdiction: "European Union / BaFin",
                    statute: "MiCA Title III Art. 21 / eIDAS Qualified Electronic Mandate",
                    issuedEpoch: 42,
                    irohUri: `iroh://${cleanHash}`,
                    status: "ACTIVE_PINNED_AND_ENFORCED",
                    signatures: [
                        {
                            authorityDid: "did:sovereign:1337:0x51c14418579998ccb844b2046422d7a5b3a4a2f1",
                            cryptoScheme: "ML-DSA-65 (NIST FIPS 204)",
                            validity: "VERIFIED"
                        }
                    ]
                }, null, 2)
            };
        }

        if (type === 'x509_cert' || type === 'cert') {
            return {
                contentType: 'json',
                filename: `cert_${cleanHash.slice(0, 10)}.json`,
                content: JSON.stringify({
                    standard: "X.509v3 / eIDAS Qualified Trust Anchor",
                    certificateSubject: title,
                    fingerprintSha256: cleanHash,
                    issuer: "CN=EU Sovereign Root CA, O=European Union Trust Network, C=EU",
                    validFrom: "2026-01-01T00:00:00Z",
                    validTo: "2036-01-01T00:00:00Z",
                    keyUsage: ["Digital Signature", "Non-Repudiation", "Certificate Signing"],
                    irohPin: `iroh://${cleanHash}`
                }, null, 2)
            };
        }

        if (type === 'git_tree' || slotId === '3' || slotId === 3) {
            return {
                contentType: 'text',
                filename: `git_tree_${cleanHash.slice(0, 10)}.txt`,
                content: `tree ${cleanHash}
100644 blob 8a6234d19fc9b4414... Cargo.toml
100644 blob 3e198bf22ac12781... README.md
040000 tree e69de29bb2d1d643... crates
040000 tree 4b825dc642cb6eb9... contracts
040000 tree 2a5f98bb12ce0039... wallet
`
            };
        }

        // Generic / Slot / DataRef
        return {
            contentType: 'json',
            filename: `dataset_${cleanHash.slice(0, 10)}.json`,
            content: JSON.stringify({
                datasetId: cleanHash,
                title,
                slotId: slotId ?? "unknown",
                blake3Root: cleanHash,
                storageProvider: "Iroh P2P Content-Addressed Store (Precompile 0x53)",
                verifiedStateless: true,
                baoOutboardLease: "100 Epochs Active"
            }, null, 2)
        };
    }

    private _openDatasetModal(title: string, hash: string, type: string, slotId?: string | number, templateId?: string, entityDid?: string, entityAddress?: string): void {
        const synth = this._synthesizeDatasetContent(title, hash, type, slotId, templateId, entityDid, entityAddress);
        if (typeof (window as any).openDatasetViewer === 'function') {
            (window as any).openDatasetViewer({
                title: `${title}`,
                namespace: type,
                blake3Root: hash,
                sizeFormatted: `${(synth.content.length / 1024).toFixed(1)} KB`,
                leaseEpochs: 100,
                content: synth.content,
                contentType: synth.contentType,
                filename: synth.filename,
                slotId,
                entityLabel: title.replace(/\s*SQL DDL Schema\s*/i, '').trim(),
                entityDid,
                entityAddress,
                selectedTemplateId: templateId
            });
        } else {
            alert(`Dataset (${title}):\nHash: ${hash}\n\n${synth.content}`);
        }
    }

    private _downloadDatasetFile(title: string, hash: string, type: string, slotId?: string | number, templateId?: string, entityDid?: string, entityAddress?: string): void {
        const synth = this._synthesizeDatasetContent(title, hash, type, slotId, templateId, entityDid, entityAddress);
        const mime = synth.contentType === 'sql' ? 'text/plain' : (synth.contentType === 'json' ? 'application/json' : 'text/plain');
        const blob = new Blob([synth.content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = synth.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    setFilter(type: string): void {
        this._filterType = type;
        if (typeof (this as any).requestUpdate === 'function') {
            (this as any).requestUpdate();
        } else {
            this.render();
        }
    }

    /**
     * Traverses graph edges from sourceId to targetId using breadth-first search (BFS).
     * Highlights the resolved path visually in the Explorer and syncs with the XState machine.
     */
    highlightPath(sourceId: string, targetId: string): string[] {
        if (sourceId === targetId) {
            this._highlightedPath = [sourceId];
            return this._highlightedPath;
        }

        // BFS traversal over directed & undirected edges
        const queue: Array<{ current: string; path: string[] }> = [{ current: sourceId, path: [sourceId] }];
        const visited = new Set<string>([sourceId]);

        while (queue.length > 0) {
            const { current, path } = queue.shift()!;
            if (current === targetId) {
                this._highlightedPath = path;
                this._authorityActor?.send({
                    type: 'TRAVERSE_AUDIT_PATH',
                    sourceId,
                    targetId,
                    path,
                });
                if (typeof (this as any).requestUpdate === 'function') {
                    (this as any).requestUpdate();
                } else {
                    this.render();
                }
                return path;
            }

            const neighbors = this._graphData.edges
                .filter(e => e.source === current || e.target === current)
                .map(e => (e.source === current ? e.target : e.source));

            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push({ current: neighbor, path: [...path, neighbor] });
                }
            }
        }

        this._highlightedPath = [sourceId, targetId]; // Fallback direct connection
        return this._highlightedPath;
    }

    getHighlightedPath(): string[] {
        return this._highlightedPath;
    }

    getNodeIcon(type: GraphNodeType | string): string {
        switch (type) {
            case 'dao_admin':
            case 'network_admin': return '👑';
            case 'global_dao': return '🏛️';
            case 'regional_dao': return '🌐';
            case 'regional_dao_shell': return '🏛️';
            case 'dao_member': return '👤';
            case 'xroad_authority': return '🛡️';
            case 'collaborative_authority': return '🤝';
            case 'git_repo': return '💻';
            case 'service_account': return '⚙️';
            case 'smart_contract': return '📜';
            case 'system_precompile': return '⚡';
            case 'blind_note': return '🔐';
            case 'authority_note': return '📜';
            case 'iot_device': return '📡';
            default: return '👤';
        }
    }

    getNodeColor(type: GraphNodeType | string): string {
        switch (type) {
            case 'dao_admin':
            case 'network_admin': return '#ffd166'; // Gold
            case 'global_dao': return '#e6a100'; // Gold
            case 'regional_dao': return '#9d4edd'; // Electric violet
            case 'regional_dao_shell': return '#6c757d'; // Grey outline
            case 'dao_member': return '#06d6a0'; // Teal
            case 'smart_contract': return '#f77f00'; // Orange diamond
            case 'system_precompile': return '#00b4d8'; // Cyan
            case 'blind_note': return '#ffea00'; // Yellow star
            case 'authority_note': return '#ffffff'; // White outline
            case 'git_repo': return '#2ec4b6'; // Green square
            case 'service_account': return '#3a86ff'; // Blue-green rounded square
            case 'xroad_authority': return '#7209b7'; // Purple pentagon
            case 'collaborative_authority': return '#e63946'; // Red-purple
            case 'iot_device': return '#ff006e'; // Pink octagon
            case 'human_account': return '#20bf6b'; // Teal person
            default: return '#8338ec';
        }
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

    formatNodeDisplayLabel(node: GraphNode): string {
        let label = (node.label || '').trim();
        if (label.startsWith('did:sovereign:1337:')) {
            label = label.replace('did:sovereign:1337:', '');
        }
        if (/^0x[a-fA-F0-9]{40}$/i.test(label) || label.toLowerCase() === node.address.toLowerCase()) {
            return `${node.address.substring(0, 6)}...${node.address.slice(-4)}`;
        }
        if (node.did && label === node.did) {
            const didClean = node.did.replace('did:sovereign:1337:', '');
            if (/^0x[a-fA-F0-9]{40}$/i.test(didClean)) {
                return `${didClean.substring(0, 6)}...${didClean.slice(-4)}`;
            }
            return didClean;
        }
        if (label.length > 18) {
            return label.substring(0, 16) + '...';
        }
        return label || `${node.address.substring(0, 6)}...${node.address.slice(-4)}`;
    }

    private _hasAdminRelation(nodeOrId?: any): boolean {
        if (!nodeOrId) return false;
        let id = '';
        let role = '';
        let type = '';
        if (typeof nodeOrId === 'string') {
            id = nodeOrId.toLowerCase();
            const found = this._graphData.nodes.find(n => n.id.toLowerCase() === id || n.address?.toLowerCase() === id);
            if (found) {
                role = (found as any).role || '';
                type = found.type || '';
            }
        } else if (typeof nodeOrId === 'object') {
            id = (nodeOrId.id || nodeOrId.address || '').toLowerCase();
            role = nodeOrId.role || '';
            type = nodeOrId.type || '';
        }

        if (role === 'admin' || role === 'owner' || type === 'dao_admin' || type === 'network_admin') {
            return true;
        }

        return this._graphData.edges.some(e => {
            const match = (e.target?.toLowerCase() === id || e.source?.toLowerCase() === id);
            return match && (e.relation === 'admin' || e.relation === 'owner');
        });
    }

    public _getAuthorizedNodes(): GraphNode[] {
        const activeNorm = this._activeAddress ? this._activeAddress.toLowerCase() : null;

        const isGlobalAdmin = activeNorm ? (
            this._graphData.nodes.some(n =>
                (n.id?.toLowerCase() === activeNorm || n.address?.toLowerCase() === activeNorm) &&
                (n.type === 'network_admin' || (n as any).role === 'network_admin')
            )
        ) : false;

        const isAdminOrViewingKeyHolder = isGlobalAdmin || !!this._viewingKey;

        // For non-admins without viewing keys, calculate direct Zanzibar relations (with 2-hop expansion for authorized organizations)
        const userConnectedNodeIds = new Set<string>();
        if (activeNorm) {
            userConnectedNodeIds.add(activeNorm);
            const firstHop = new Set<string>();
            this._graphData.edges.forEach(e => {
                const s = e.source ? e.source.toLowerCase() : '';
                const t = e.target ? e.target.toLowerCase() : '';
                if (s === activeNorm) { userConnectedNodeIds.add(t); firstHop.add(t); }
                if (t === activeNorm) { userConnectedNodeIds.add(s); firstHop.add(s); }
            });
            this._graphData.edges.forEach(e => {
                const s = e.source ? e.source.toLowerCase() : '';
                const t = e.target ? e.target.toLowerCase() : '';
                if (firstHop.has(s)) userConnectedNodeIds.add(t);
                if (firstHop.has(t)) userConnectedNodeIds.add(s);
            });
        }

        return this._graphData.nodes.filter(n => {
            const nodeId = n.id ? n.id.toLowerCase() : '';
            const nodeAddr = n.address ? n.address.toLowerCase() : '';

            // Privacy & Authorization Boundary:
            // - Root Admin & Viewing Key holders have visibility over the authorized lattice.
            // - Standard accounts ONLY see:
            //   1. Public authorities and low-entropy precompiles
            //   2. Their own account node
            //   3. Entities where an explicit Zanzibar relation edge exists with their account
            // - DAOs (type includes 'dao') are strictly private organizations requiring a verified Zanzibar relation!
            if (!isAdminOrViewingKeyHolder) {
                const isDao = (n.type as string).includes('dao');
                const isPublicPrecompile = !isDao && (
                    (n.type as string) === 'precompile' ||
                    n.type === 'system_precompile' ||
                    (nodeAddr.length === 42 && /^0x0{38}[0-9a-fA-F]{2}$/.test(nodeAddr))
                );
                const isPublicAuthority = n.type === 'xroad_authority' || n.type === 'authority_note';
                const isPublicNode = isPublicAuthority || isPublicPrecompile;
                const isOwnNode = !!(activeNorm && (nodeId === activeNorm || nodeAddr === activeNorm));
                const hasRelation = !!(activeNorm && (userConnectedNodeIds.has(nodeId) || userConnectedNodeIds.has(nodeAddr)));

                if (!isPublicNode && !isOwnNode && !hasRelation) {
                    return false;
                }
            }

            return true;
        });
    }

    private _getFilteredNodes(): GraphNode[] {
        const authorizedNodes = this._getAuthorizedNodes();

        return authorizedNodes.filter(n => {
            // If search query is present, apply search across allowed nodes
            if (this._searchQuery.trim()) {
                const q = this._searchQuery.toLowerCase().trim();
                return n.label.toLowerCase().includes(q)
                    || n.address.toLowerCase().includes(q)
                    || n.id.toLowerCase().includes(q)
                    || n.type.toLowerCase().includes(q)
                    || (n.metadata && JSON.stringify(n.metadata).toLowerCase().includes(q));
            }

            const matchesFilter =
                this._filterType === 'all'
                || (this._filterType === 'admin' && (n.type === 'dao_admin' || (n as any).type === 'network_admin' || (n as any).role === 'admin' || this._hasAdminRelation(n)))
                || (this._filterType === 'dao' && (n.type.includes('dao')))
                || (this._filterType === 'xroad_authority' && (n.type.includes('authority')))
                || n.type === this._filterType;

            return matchesFilter;
        });
    }

    private _runCyLayout(): void {
        if (this._cy && !this._cy.destroyed()) {
            try {
                this._cy.layout(this._getLayoutConfig()).run();
            } catch (_) {}
        }
        if (typeof (this as any).requestUpdate === 'function') {
            (this as any).requestUpdate();
        } else {
            this.render();
        }
    }

    private _getLayoutConfig(): cytoscape.LayoutOptions {
        if (this._cyLayout === 'concentric') {
            return {
                name: 'concentric',
                concentric: (node: any) => {
                    const type = node.data('type') || '';
                    if (node.data('isAdmin') === 'true') return 1;
                    if (type === 'global_dao') return 10;
                    if (type === 'regional_dao') return 5;
                    if (type.includes('authority')) return 3;
                    return 2;
                },
                levelWidth: () => 2,
                minNodeSpacing: 160,
                nodeDimensionsIncludeLabels: true,
                padding: 60,
                animate: false
            } as any;
        }
        if (this._cyLayout === 'breadthfirst') {
            return {
                name: 'breadthfirst',
                directed: true,
                padding: 60,
                spacingFactor: 2.2,
                animate: false
            } as any;
        }
        return {
            name: 'cose',
            animate: false,
            randomize: true,
            nodeDimensionsIncludeLabels: true,
            idealEdgeLength: () => 220,
            edgeElasticity: () => 64,
            nodeRepulsion: () => 1800000,
            nodeOverlap: 250,
            gravity: 0.04,
            componentSpacing: 220,
            numIter: 2000,
            initialTemp: 1000,
            coolingFactor: 0.95,
            minTemp: 1.0,
            padding: 60
        } as any;
    }

    private _setupSmoothWheelZoom(container: HTMLElement): void {
        if (!container || (container as any)._smoothWheelBound) return;
        (container as any)._smoothWheelBound = true;

        container.addEventListener('wheel', (e: WheelEvent) => {
            if (!this._cy || this._cy.destroyed()) return;
            e.preventDefault();
            e.stopPropagation();

            const rect = container.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;

            let delta = e.deltaY;
            if (e.deltaMode === 1) delta *= 24;
            else if (e.deltaMode === 2) delta *= 100;

            // Exponential scaling for fast, predictable zooming:
            // ~1.4x per wheel notch, fluid on trackpads
            const factor = Math.exp(-delta * 0.0035);
            const currentZoom = this._cy.zoom();
            const baseTarget = this._smoothZoomTarget ?? currentZoom;
            const newTarget = Math.min(5.0, Math.max(0.15, baseTarget * factor));

            this._triggerSmoothZoom(newTarget, { x: cursorX, y: cursorY });
        }, { passive: false });
    }

    private _triggerSmoothZoom(targetZoom: number, center: { x: number; y: number }): void {
        if (!this._cy || this._cy.destroyed()) return;
        this._smoothZoomCenter = center;
        this._smoothZoomTarget = Math.min(5.0, Math.max(0.15, targetZoom));

        if (this._smoothZoomRafId === null && typeof requestAnimationFrame === 'function') {
            const step = () => {
                if (!this._cy || this._cy.destroyed() || this._smoothZoomTarget === null) {
                    this._smoothZoomRafId = null;
                    return;
                }

                const current = this._cy.zoom();
                const target = this._smoothZoomTarget;
                const diff = target - current;

                if (Math.abs(diff) < 0.002) {
                    this._cy.zoom({
                        level: target,
                        renderedPosition: this._smoothZoomCenter
                    });
                    this._smoothZoomTarget = null;
                    this._smoothZoomRafId = null;
                } else {
                    // Quick & smooth critically-damped lerp (32% distance closed per frame)
                    const next = current + diff * 0.32;
                    this._cy.zoom({
                        level: next,
                        renderedPosition: this._smoothZoomCenter
                    });
                    this._smoothZoomRafId = requestAnimationFrame(step);
                }
            };
            this._smoothZoomRafId = requestAnimationFrame(step);
        }
    }

    private _initOrUpdateCytoscape(nodes: GraphNode[], edges: GraphEdge[], selectedNode: GraphNode | null): void {
        const container = typeof this.querySelector === 'function' ? this.querySelector('#cy-container') as HTMLElement : null;
        if (!container || typeof window === 'undefined') return;

        // Destroy stale instance if container has been recreated or detached by Lit
        if (this._cy && (!this._cy.container() || !this._cy.container()!.isConnected || this._cy.container() !== container)) {
            try {
                this._cy.destroy();
            } catch (_) {}
            this._cy = null;
        }

        // If Cytoscape already has the exact same nodes rendered in the current container,
        // do NOT wipe elements and do NOT re-run layout on simple selection changes
        if (this._cy && !this._cy.destroyed() && this._cy.container() === container) {
            const currentIds = new Set(this._cy.nodes().map((n: any) => n.id().toLowerCase()));
            const newIds = new Set(nodes.map(n => n.id.toLowerCase()));
            const isSameGraph = currentIds.size === newIds.size && [...currentIds].every(id => newIds.has(id));

            if (isSameGraph) {
                if (selectedNode) {
                    try {
                        this._cy.nodes().unselect();
                        const target = this._cy.$id(selectedNode.id);
                        if (target && target.length > 0) {
                            target.select();
                        }
                    } catch (_) {}
                }
                return;
            }
        }

        const elements: cytoscape.ElementDefinition[] = [];
        nodes.forEach(n => {
            const isSelected = selectedNode && selectedNode.id.toLowerCase() === n.id.toLowerCase();
            const isPath = this._highlightedPath.includes(n.id);
            const isAdmin = this._hasAdminRelation(n);
            const icon = this.getNodeIcon(n.type);
            const iconSvg = getEmojiBase64Svg(icon);
            const cleanLabel = this.formatNodeDisplayLabel(n);

            elements.push({
                group: 'nodes',
                data: {
                    id: n.id,
                    cleanLabel,
                    fullLabel: n.label,
                    type: n.type,
                    address: n.address,
                    color: this.getNodeColor(n.type),
                    icon,
                    iconSvg,
                    isAdmin: isAdmin ? 'true' : 'false',
                    isHighlighted: isPath ? 'true' : 'false',
                    isSelected: isSelected ? 'true' : 'false'
                }
            });
        });

        const nodeIds = new Set(nodes.map(n => n.id.toLowerCase()));
        edges.forEach((e, idx) => {
            if (nodeIds.has(e.source.toLowerCase()) && nodeIds.has(e.target.toLowerCase())) {
                const isPath = this._highlightedPath.includes(e.source) && this._highlightedPath.includes(e.target);
                elements.push({
                    group: 'edges',
                    data: {
                        id: `e_${idx}_${e.source}_${e.target}`,
                        source: e.source,
                        target: e.target,
                        label: e.relation,
                        isHighlighted: isPath ? 'true' : 'false'
                    }
                });
            }
        });

        const cyInit = (typeof cytoscape === 'function' ? cytoscape : (cytoscape as any)?.default || (window as any).cytoscape);
        if (typeof cyInit !== 'function') {
            console.warn('Cytoscape constructor not available');
            return;
        }

        // Destroy stale instance if container has been recreated or detached by Lit
        if (this._cy && (!this._cy.container() || !this._cy.container()!.isConnected || this._cy.container() !== container)) {
            try {
                this._cy.destroy();
            } catch (_) {}
            this._cy = null;
        }

        if (!this._cy || this._cy.destroyed()) {
            try {
                this._cy = cyInit({
                    container,
                    elements,
                    minZoom: 0.15,
                    maxZoom: 5.0,
                    userZoomingEnabled: false,
                    userPanningEnabled: true,
                    boxSelectionEnabled: false,
                    autounselectify: false,
                    style: [
                        {
                            selector: 'node',
                            style: {
                                'background-color': '#0d131d',
                                'border-width': 2.5,
                                'border-color': 'data(color)',
                                'background-fit': 'contain',
                                'background-clip': 'node',
                                'background-width': '65%',
                                'background-height': '65%',
                                'background-opacity': 1,
                                'color': '#f1f5f9',
                                'font-size': '10px',
                                'font-family': 'monospace',
                                'font-weight': 'bold',
                                'text-valign': 'bottom',
                                'text-margin-y': 8,
                                'text-background-color': '#070b12',
                                'text-background-opacity': 0.88,
                                'text-background-padding': '3px',
                                'text-background-shape': 'roundrectangle',
                                'width': 44,
                                'height': 44,
                                'text-outline-color': '#070b12',
                                'text-outline-width': 2,
                                'text-outline-opacity': 0.95
                            }
                        },
                        {
                            selector: 'node[iconSvg]',
                            style: {
                                'background-image': 'data(iconSvg)'
                            }
                        },
                        {
                            selector: 'node[cleanLabel]',
                            style: {
                                'label': 'data(cleanLabel)'
                            }
                        },
                        {
                            selector: 'node[!cleanLabel]',
                            style: {
                                'label': 'data(label)'
                            }
                        },
                        {
                            selector: "node[type = 'smart_contract']",
                            style: {
                                'shape': 'diamond',
                                'width': 46,
                                'height': 46
                            }
                        },
                        {
                            selector: "node[type = 'git_repo']",
                            style: {
                                'shape': 'round-rectangle',
                                'width': 44,
                                'height': 44
                            }
                        },
                        {
                            selector: "node[isAdmin = 'true']",
                            style: {
                                'width': 50,
                                'height': 50,
                                'border-color': '#ffd166',
                                'border-width': 3.5
                            }
                        },
                        {
                            selector: "node[isSelected = 'true'], node:selected",
                            style: {
                                'border-color': '#66fcf1',
                                'border-width': 4.5,
                                'border-opacity': 1,
                                'background-color': '#162335',
                                'color': '#66fcf1',
                                'overlay-color': '#66fcf1',
                                'overlay-padding': 6,
                                'overlay-opacity': 0.25
                            }
                        },
                        {
                            selector: "node[isHighlighted = 'true']",
                            style: {
                                'border-color': '#ffd166',
                                'border-width': 3.5,
                                'border-opacity': 1,
                                'overlay-color': '#ffd166',
                                'overlay-padding': 5,
                                'overlay-opacity': 0.25
                            }
                        },
                        {
                            selector: 'edge',
                            style: {
                                'width': 2.0,
                                'line-color': '#475569',
                                'target-arrow-color': '#475569',
                                'target-arrow-shape': 'triangle',
                                'arrow-scale': 1.1,
                                'curve-style': 'bezier',
                                'control-point-step-size': 45,
                                'label': 'data(label)',
                                'font-size': '9px',
                                'font-weight': '600',
                                'color': '#cbd5e1',
                                'text-background-color': '#0d131d',
                                'text-background-opacity': 0.92,
                                'text-background-padding': '4px',
                                'text-background-shape': 'roundrectangle',
                                'text-border-color': '#334155',
                                'text-border-width': 1,
                                'text-border-opacity': 0.8,
                                'text-rotation': 'autorotate'
                            }
                        },
                        {
                            selector: "edge[label *= 'admin']",
                            style: {
                                'line-color': '#ffd166',
                                'target-arrow-color': '#ffd166',
                                'width': 2.4,
                                'text-border-color': '#ffd166'
                            }
                        },
                        {
                            selector: "edge[label *= 'audit'], edge[label *= 'cert']",
                            style: {
                                'line-color': '#9d4edd',
                                'target-arrow-color': '#9d4edd',
                                'line-style': 'dashed',
                                'width': 2.4,
                                'text-border-color': '#9d4edd'
                            }
                        },
                        {
                            selector: "edge[isHighlighted = 'true']",
                            style: {
                                'line-color': '#66fcf1',
                                'target-arrow-color': '#66fcf1',
                                'width': 3.2,
                                'text-border-color': '#66fcf1'
                            }
                        }
                    ],
                    layout: this._getLayoutConfig()
                });

                if (this._cy) {
                    this._setupSmoothWheelZoom(container);
                    this._cy.on('tap', 'node', (evt: any) => {
                        const id = evt.target.id();
                        this.selectNode(id);
                    });
                }
            } catch (err) {
                console.warn('Cytoscape canvas initialization skipped (fallback active):', err);
            }
        } else {
            try {
                if (this._cy) {
                    this._setupSmoothWheelZoom(container);
                    this._cy.elements().remove();
                    this._cy.add(elements);
                    this._cy.layout(this._getLayoutConfig()).run();
                }
            } catch (_) {}
        }

        if (this._cy && !this._cy.destroyed()) {
            requestAnimationFrame(() => {
                if (this._cy && !this._cy.destroyed()) {
                    try {
                        this._cy.resize();
                        this._cy.fit(undefined, 60);
                        if (this._cy.zoom() > 1.2) {
                            this._cy.zoom(1.2);
                            this._cy.center();
                        }
                    } catch (_) {}
                }
            });

            if (selectedNode) {
                try {
                    this._cy.nodes().unselect();
                    const target = this._cy.$id(selectedNode.id);
                    if (target && target.length > 0) {
                        target.select();
                    }
                } catch (_) {}
            }
        }
    }

    private _renderVisualGraph(nodes: GraphNode[], edges: GraphEdge[], selectedNode: GraphNode | null): string {
        return `
            <div class="graph-visual-wrapper" style="position: relative; width: 100%; height: 560px; min-height: 560px; background: #070b12; border: 1px solid #1e293b; border-radius: 8px; overflow: hidden;">
                <div id="cy-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1;"></div>
                
                <!-- Layout & Navigation Toolbar -->
                <div class="cy-controls-bar" style="position: absolute; bottom: 12px; left: 12px; display: flex; gap: 6px; z-index: 10; background: rgba(13, 19, 29, 0.92); padding: 6px 10px; border-radius: 6px; border: 1px solid #1e293b; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
                    <button type="button" class="action-btn cy-layout-cose-btn" style="background: ${this._cyLayout === 'cose' ? '#ffd166' : '#1e293b'}; color: ${this._cyLayout === 'cose' ? '#000' : '#fff'}; border: 1px solid #ffd166; padding: 4px 8px; font-size: 0.65rem; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        🌱 Force (Cose)
                    </button>
                    <button type="button" class="action-btn cy-layout-concentric-btn" style="background: ${this._cyLayout === 'concentric' ? '#ffd166' : '#1e293b'}; color: ${this._cyLayout === 'concentric' ? '#000' : '#fff'}; border: 1px solid #ffd166; padding: 4px 8px; font-size: 0.65rem; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        ⭕ Concentric
                    </button>
                    <button type="button" class="action-btn cy-layout-tree-btn" style="background: ${this._cyLayout === 'breadthfirst' ? '#ffd166' : '#1e293b'}; color: ${this._cyLayout === 'breadthfirst' ? '#000' : '#fff'}; border: 1px solid #ffd166; padding: 4px 8px; font-size: 0.65rem; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        🌳 Tree
                    </button>
                    <button type="button" class="action-btn cy-zoomin-btn" title="Zoom In" style="background: #1e293b; color: #66fcf1; border: 1px solid #334155; padding: 4px 8px; font-size: 0.65rem; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        ➕ In
                    </button>
                    <button type="button" class="action-btn cy-zoomout-btn" title="Zoom Out" style="background: #1e293b; color: #66fcf1; border: 1px solid #334155; padding: 4px 8px; font-size: 0.65rem; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        ➖ Out
                    </button>
                    <button type="button" class="action-btn cy-fit-btn" style="background: #1e293b; color: #66fcf1; border: 1px solid #66fcf1; padding: 4px 8px; font-size: 0.65rem; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        🔍 Fit View
                    </button>
                    <button type="button" class="action-btn cy-reset-btn" style="background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 4px 8px; font-size: 0.65rem; border-radius: 4px; cursor: pointer;">
                        ↺ Reset
                    </button>
                </div>
            </div>
        `;
    }

    private _renderSelectedDrawer(selectedNode: GraphNode | null, isSelectedAdmin: boolean, detailsHtml: string): string {
        if (!selectedNode) return '';
        const color = this.getNodeColor(selectedNode.type);
        const icon = this.getNodeIcon(selectedNode.type);
        const slotsCount = (selectedNode.slots || []).length;
        const edgeCount = this._graphData.edges.filter(
            e => e.source.toLowerCase() === selectedNode.id.toLowerCase() || e.target.toLowerCase() === selectedNode.id.toLowerCase()
        ).length;

        return `
            <div class="selected-entity-drawer" style="background: #0d131d; border: 1px solid #1e293b; border-radius: 8px; margin-bottom: 14px; overflow: hidden;">
                <div class="toggle-selected-drawer" style="padding: 10px 14px; background: #141b26; display: flex; justify-content: space-between; align-items: center; cursor: pointer; border-bottom: ${this._selectedDrawerOpen ? '1px solid #1e293b' : 'none'};">
                    <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap;">
                        <span style="font-size: 1.2rem;">${icon}</span>
                        <span style="font-size: 0.82rem; font-weight: bold; color: ${color}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${this._escape(selectedNode.label)}
                        </span>
                        <span class="type-pill" style="font-size: 0.6rem; color: ${color}; background: ${color}22; border: 1px solid ${color}55; padding: 2px 7px; border-radius: 10px; text-transform: uppercase; font-weight: bold;">
                            ${selectedNode.type.replace('_', ' ')}
                        </span>
                        ${isSelectedAdmin ? '<span style="color:#ffd166; font-size:0.65rem; font-weight:bold; background:rgba(255,209,102,0.18); padding:2px 6px; border-radius:4px;">👑 ROOT ADMIN</span>' : ''}
                        <code style="font-size: 0.65rem; color: #66fcf1; background:#05080f; padding:2px 6px; border-radius:3px;">${selectedNode.address.substring(0, 10)}...${selectedNode.address.slice(-6)}</code>
                        <span style="font-size: 0.62rem; color: #94a3b8;">(${slotsCount} slots • ${edgeCount} relations)</span>
                    </div>
                    <button class="nes-btn ${this._selectedDrawerOpen ? 'is-warning' : 'is-primary'}" style="padding: 2px 10px; font-size: 0.62rem; flex-shrink: 0;">
                        ${this._selectedDrawerOpen ? '▴ Hide Inspector' : '▾ Inspect Selected Entity'}
                    </button>
                </div>
                ${this._selectedDrawerOpen ? `
                    <div class="drawer-body" style="padding: 14px;">
                        ${detailsHtml}
                    </div>
                ` : ''}
            </div>
        `;
    }

    private _buildDetailsHtml(selectedNode: GraphNode | null): string {
        if (!selectedNode) {
            return '<p class="placeholder-text" style="color:#888; font-size:0.75rem; text-align:center; padding:30px 10px;">Select an entity in the list to inspect its Polymorphic Register Slots and ReBAC relations.</p>';
        }

        const isSelectedAdmin = selectedNode ? this._hasAdminRelation(selectedNode) : false;

        const handlers = this._pluginRegistry.findHandlers(selectedNode);
        const pluginDetails = handlers.map(h => h.renderDetails(selectedNode, {
            graph: this._graphData,
            activeAddress: this._activeAddress || undefined,
            viewingKey: this._viewingKey,
            hasAdminRelation: (id) => this._hasAdminRelation(id),
            selectNode: (id) => this.selectNode(id),
            highlightPath: (src, tgt) => this.highlightPath(src, tgt),
            navigateRoute: () => {}
        })).join('');

        const connectedEdges = this._graphData.edges.filter(
            e => e.source.toLowerCase() === selectedNode.id.toLowerCase() || e.target.toLowerCase() === selectedNode.id.toLowerCase()
        );

        const edgesHtml = connectedEdges.length > 0
            ? `<ul class="edge-list" style="list-style:none; padding:0; margin:8px 0; display:flex; flex-direction:column; gap:8px;">${connectedEdges.map(e => {
                const isSource = e.source.toLowerCase() === selectedNode.id.toLowerCase();
                const peerId = isSource ? e.target : e.source;
                const peerNode = this._graphData.nodes.find(n => n.id.toLowerCase() === peerId.toLowerCase());
                const peerLabel = peerNode ? peerNode.label : `${peerId.substring(0, 10)}...${peerId.slice(-6)}`;
                const peerColor = peerNode ? this.getNodeColor(peerNode.type) : '#8338ec';
                const peerIcon = peerNode ? this.getNodeIcon(peerNode.type) : '📍';
                const directionIcon = isSource ? '➔' : '⬅';
                const dirText = isSource ? 'OUTBOUND' : 'INBOUND';

                return `
                <li style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:#161f2e; border-radius:6px; border:1px solid #233549; gap:8px;">
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <span class="edge-relation" style="font-size:0.65rem; color:#f7d51d; background:rgba(247, 213, 29, 0.15); border:1px solid rgba(247, 213, 29, 0.4); padding:2px 6px; border-radius:3px; font-weight:bold; text-transform:uppercase;">${this._escape(e.relation)}</span>
                        <span style="font-size:0.55rem; color:#94a3b8; font-weight:600;">${directionIcon} ${dirText}</span>
                    </div>
                    <a href="#node/${encodeURIComponent(peerId)}" class="linked-entity-link" data-node-id="${peerId}" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px; color:#45f3ff; font-size:0.72rem; font-weight:bold; padding:4px 8px; border-radius:4px; background:rgba(69,243,255,0.08); border:1px solid ${peerColor}55; max-width:60%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="Focus node in explorer">
                        <span>${peerIcon}</span>
                        <span style="overflow:hidden; text-overflow:ellipsis;">${this._escape(peerLabel)}</span>
                    </a>
                </li>
                `;
            }).join('')}</ul>`
            : '<p class="empty-hint" style="color:#666; font-size:0.68rem; margin:4px 0;">No explicit ReBAC edges found for this account.</p>';

        return `
            <div class="node-card" style="background:#0d131d; border:1px solid #1e293b; border-radius:8px; padding:14px;">
                <div class="node-header" style="border-left: 4px solid ${this.getNodeColor(selectedNode.type)}; padding-left: 10px; margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <h3 style="margin:0; font-size:0.95rem; color:#f1f5f9; display:flex; align-items:center; gap:8px;">
                            <span>${this.getNodeIcon(selectedNode.type)}</span>
                            <span style="word-break:break-all;">${this._escape(selectedNode.label)}</span>
                        </h3>
                        <span class="type-pill" style="background: ${this.getNodeColor(selectedNode.type)}22; color: ${this.getNodeColor(selectedNode.type)}; border: 1px solid ${this.getNodeColor(selectedNode.type)}55; padding:3px 8px; border-radius:12px; font-size:0.62rem; font-weight:bold; text-transform:uppercase; flex-shrink:0;">
                            ${selectedNode.type.replace('_', ' ')}
                        </span>
                    </div>
                    <div class="address-row" style="margin-top:8px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <a href="#account/${selectedNode.address}" class="entity-address-link" data-node-id="${selectedNode.id}" data-address="${selectedNode.address}" style="color:#66fcf1; text-decoration:none; display:inline-flex; align-items:center; gap:6px;" title="Focus account in explorer">
                            <code style="background:#05080f; padding:4px 8px; border-radius:4px; font-size:0.68rem; color:#66fcf1; word-break:break-all;">${selectedNode.address}</code>
                        </a>
                        <button class="nes-btn" style="padding:2px 8px; font-size:0.55rem;" onclick="navigator.clipboard.writeText('${selectedNode.address}'); alert('Address copied!');">Copy</button>
                        <button type="button" class="nes-btn is-primary commitment-jump-link" data-commitment="${selectedNode.address}" data-slot-id="0" style="padding:2px 8px; font-size:0.55rem; cursor:pointer;">Inspect Proof</button>
                    </div>
                </div>

                ${isSelectedAdmin ? `
                <div class="admin-banner" style="background: linear-gradient(135deg, rgba(255, 209, 102, 0.15), rgba(230, 161, 0, 0.05)); border: 1px solid #ffd166; border-radius: 6px; padding: 10px 12px; margin-bottom: 14px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:1.4rem;">👑</span>
                        <div>
                            <div style="font-weight:bold; color:#ffd166; font-size:0.8rem;">Root Sovereign Network Admin (@citrullin)</div>
                            <div style="font-size:0.68rem; color:#cbd5e1; margin-top:3px; line-height:1.35;">
                                Genesis Admin authority over European DAO, initial network blind note allocations (10,000 TBL in Slot 2), and root ReBAC administrative permissions.
                            </div>
                        </div>
                    </div>
                </div>
                ` : ''}

                <div style="margin-bottom:14px;">
                    ${pluginDetails}
                </div>

                <div class="relations-box" style="background:#111827; padding:12px; border-radius:6px; border:1px solid #1e293b;">
                    <h5 style="margin:0 0 6px 0; color:#58a6ff; font-size:0.75rem; display:flex; align-items:center; gap:6px;">
                        <span>🔗 Inscribed ReBAC Relations (${connectedEdges.length})</span>
                    </h5>
                    ${edgesHtml}
                </div>
            </div>
        `;
    }

    private _updateDrawerDom(): void {
        if (typeof this.querySelector !== 'function') return;
        const container = this.querySelector('#graph-drawer-container') as HTMLElement | null;
        const selectedNode = this.getSelectedNode();
        const isSelectedAdmin = selectedNode ? this._hasAdminRelation(selectedNode) : false;
        const detailsHtml = this._buildDetailsHtml(selectedNode);

        if (container) {
            container.innerHTML = this._renderSelectedDrawer(selectedNode, isSelectedAdmin, detailsHtml);
        }

        const sidebar = this.querySelector('.graph-details-sidebar') as HTMLElement | null;
        if (sidebar) {
            sidebar.innerHTML = detailsHtml;
        }
    }

    private _updateChipsDom(): void {
        if (typeof this.querySelectorAll !== 'function') return;
        const chips = this.querySelectorAll('.graph-node-chip');
        chips.forEach((chip: any) => {
            const nid = chip.dataset.nodeId;
            const isSelected = nid && nid.toLowerCase() === (this._selectedNodeId || '').toLowerCase();
            if (isSelected) {
                chip.classList.add('selected');
                chip.style.background = '#1a2333';
                chip.style.borderColor = '#66fcf1';
                chip.style.boxShadow = '0 0 12px rgba(102, 252, 241, 0.25)';
            } else {
                chip.classList.remove('selected');
                chip.style.background = '#111827';
                chip.style.borderColor = '#1e293b';
                chip.style.boxShadow = 'none';
            }
        });
    }

    render(): any {
        const activeNodes = this._getAuthorizedNodes();

        const adminCount = activeNodes.filter(n => this._hasAdminRelation(n)).length;
        const daoCount = activeNodes.filter(n => n.type.includes('dao')).length;
        const authCount = activeNodes.filter(n => n.type.includes('authority')).length;
        const repoCount = activeNodes.filter(n => n.type === 'git_repo').length;
        const serviceCount = activeNodes.filter(n => n.type === 'service_account').length;

        // Auto-reset filter type if current filter yields 0 authorized entities
        if (this._filterType === 'admin' && adminCount === 0) this._filterType = 'all';
        if (this._filterType === 'dao' && daoCount === 0) this._filterType = 'all';
        if (this._filterType === 'git_repo' && repoCount === 0) this._filterType = 'all';
        if (this._filterType === 'service_account' && serviceCount === 0) this._filterType = 'all';

        const filteredNodes = this._getFilteredNodes();

        const selectedNode = filteredNodes.find(n => n.id.toLowerCase() === (this._selectedNodeId || '').toLowerCase())
            || (filteredNodes.length > 0 ? filteredNodes[0] : null);

        const isSelectedAdmin = selectedNode ? this._hasAdminRelation(selectedNode) : false;

        const detailsHtml = this._buildDetailsHtml(selectedNode);
        const selectedDrawerHtml = `<div id="graph-drawer-container">${this._renderSelectedDrawer(selectedNode, isSelectedAdmin, detailsHtml)}</div>`;

        const mainContentHtml = this._viewMode === 'visual'
            ? this._renderVisualGraph(filteredNodes, this._graphData.edges, selectedNode)
            : `
                <div class="graph-main-layout" style="display:grid; grid-template-columns: minmax(320px, 1.2fr) minmax(380px, 1.8fr); gap:14px; min-height:420px;">
                    <div class="graph-canvas-container" style="background:#0a0d14; border:1px solid #1e293b; border-radius:8px; padding:10px; max-height:560px; overflow-y:auto;">
                        <div class="node-grid" style="display:flex; flex-direction:column; gap:8px;">
                            ${filteredNodes.length === 0
                                ? `<p style="color:#888; font-size:0.75rem; text-align:center; padding:30px 10px;">No entities match your filter or search query.</p>`
                                : filteredNodes.map(node => {
                                    const isSelected = selectedNode && node.id.toLowerCase() === selectedNode.id.toLowerCase();
                                    const isHighlighted = this._highlightedPath.includes(node.id);
                                    const icon = this.getNodeIcon(node.type);
                                    const color = this.getNodeColor(node.type);
                                    const slotsCount = (node.slots || []).length;
                                    const edgeCount = this._graphData.edges.filter(
                                        e => e.source.toLowerCase() === node.id.toLowerCase() || e.target.toLowerCase() === node.id.toLowerCase()
                                    ).length;
                                    const isAdmin = this._hasAdminRelation(node);

                                    return `
                                    <div class="graph-node-chip ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted-path' : ''}"
                                         data-node-id="${node.id}"
                                         style="background:${isSelected ? '#1a2333' : '#111827'}; border:1px solid ${isSelected ? '#66fcf1' : '#1e293b'}; border-left:4px solid ${color}; border-radius:6px; padding:10px 12px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:all 0.15s; ${isSelected ? 'box-shadow: 0 0 12px rgba(102, 252, 241, 0.25);' : ''}">
                                        <div style="font-size:1.2rem; line-height:1; flex-shrink:0;">${icon}</div>
                                        <div style="min-width:0; flex:1;">
                                            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                                                <span style="font-size:0.75rem; font-weight:bold; color:${isSelected ? '#66fcf1' : '#f1f5f9'}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this._escape(this.formatNodeDisplayLabel(node))}</span>
                                                <span style="font-size:0.58rem; color:${color}; background:${color}18; border:1px solid ${color}44; padding:1px 5px; border-radius:4px; font-weight:600; text-transform:uppercase; flex-shrink:0;">${node.type.replace('_', ' ')}</span>
                                            </div>
                                            <div style="font-size:0.62rem; color:#64748b; font-family:monospace; margin-top:2px;">
                                                ${node.address.substring(0, 10)}...${node.address.substring(node.address.length - 6)}
                                            </div>
                                            <div style="display:flex; gap:6px; margin-top:4px; font-size:0.6rem; color:#94a3b8; flex-wrap:wrap;">
                                                <span style="background:#1e293b; padding:1px 5px; border-radius:3px;">⚡ ${slotsCount} slots</span>
                                                <span style="background:#1e293b; padding:1px 5px; border-radius:3px;">🔗 ${edgeCount} relations</span>
                                                ${node.votingWeightBps ? `<span style="background:rgba(255, 209, 102, 0.15); color:#ffd166; padding:1px 5px; border-radius:3px;">⚖️ ${node.votingWeightBps} bps</span>` : ''}
                                                ${isAdmin ? `<span style="background:rgba(255, 209, 102, 0.2); color:#ffd166; padding:1px 5px; border-radius:3px; font-weight:bold;">👑 Admin</span>` : ''}
                                            </div>
                                        </div>
                                    </div>
                                    `;
                                }).join('')}
                        </div>
                    </div>
                    <div class="graph-details-sidebar" style="max-height:560px; overflow-y:auto;">
                        ${detailsHtml}
                    </div>
                </div>
            `;

        const template = `
            <div class="graph-explorer-root" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;">
                ${selectedDrawerHtml}

                <div class="graph-toolbar" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #1e293b;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <div class="view-switch-btns" style="display:flex; gap:4px; background:#111827; padding:2px; border-radius:6px; border:1px solid #1e293b;">
                            <button class="nes-btn ${this._viewMode === 'visual' ? 'is-primary' : ''}" data-view-mode="visual" style="padding:2px 8px; font-size:0.6rem; margin:0;">
                                📊 Visual Graph
                            </button>
                            <button class="nes-btn ${this._viewMode === 'cards' ? 'is-primary' : ''}" data-view-mode="cards" style="padding:2px 8px; font-size:0.6rem; margin:0;">
                                📋 Directory List
                            </button>
                        </div>
                        <div class="filters" style="display:flex; gap:4px; flex-wrap:wrap;">
                            <button class="filter-btn ${(this._searchQuery || this._filterType === 'all') ? 'active' : ''}" data-filter="all">${this._searchQuery ? 'All' : `All (${activeNodes.length})`}</button>
                            ${adminCount > 0 ? `
                                <button class="filter-btn ${!this._searchQuery && this._filterType === 'admin' ? 'active' : ''}" data-filter="admin" style="${!this._searchQuery && this._filterType === 'admin' ? 'border-color:#ffd166; color:#ffd166;' : ''}">👑 Admin (${adminCount})</button>
                            ` : ''}
                            ${daoCount > 0 ? `
                                <button class="filter-btn ${!this._searchQuery && this._filterType === 'dao' ? 'active' : ''}" data-filter="dao">🏛️ DAOs (${daoCount})</button>
                            ` : ''}
                            ${authCount > 0 ? `
                                <button class="filter-btn ${!this._searchQuery && this._filterType === 'xroad_authority' ? 'active' : ''}" data-filter="xroad_authority">🛡️ Authorities (${authCount})</button>
                            ` : ''}
                            ${repoCount > 0 ? `
                                <button class="filter-btn ${!this._searchQuery && this._filterType === 'git_repo' ? 'active' : ''}" data-filter="git_repo">💻 Repos (${repoCount})</button>
                            ` : ''}
                            ${serviceCount > 0 ? `
                                <button class="filter-btn ${!this._searchQuery && this._filterType === 'service_account' ? 'active' : ''}" data-filter="service_account">⚙️ Services (${serviceCount})</button>
                            ` : ''}
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end;">
                        <input
                            type="text"
                            class="graph-search-input"
                            placeholder="🔍 Search name, DID, or address..."
                            value="${this._escape(this._searchQuery)}"
                            style="background:#161f2e; border:1px solid #334155; color:#f1f5f9; padding:5px 10px; border-radius:6px; font-size:0.72rem; min-width:240px; font-family:inherit;"
                        />
                        <div class="filter-selection-counter" style="font-size:0.62rem; color:${this._searchQuery ? '#66fcf1' : '#64748b'}; margin-top:3px;">
                            ${filteredNodes.length} out of ${activeNodes.length} selected
                        </div>
                    </div>
                </div>

                ${mainContentHtml}
            </div>
        `;

        if (typeof this.innerHTML !== 'undefined' && typeof html === 'undefined') {
            this.innerHTML = template;
            this._bindDelegatedEvents();
            this._bindSearchInput();
        }

        return typeof html !== 'undefined' ? html`<div .innerHTML=${template}></div>` : template;
    }

    firstUpdated(changedProperties: Map<string, any>): void {
        super.firstUpdated?.(changedProperties);
        this._bindDelegatedEvents();
        this._bindSearchInput();
        if (this._viewMode === 'visual') {
            const filteredNodes = this._getFilteredNodes();
            this._initOrUpdateCytoscape(filteredNodes, this._graphData.edges, this.getSelectedNode());
        }
        if (this._searchFocused && typeof this.querySelector === 'function') {
            const input = this.querySelector('.graph-search-input') as HTMLInputElement | null;
            if (input) {
                input.focus();
                const pos = Math.min(this._searchCursorPos, input.value.length);
                input.setSelectionRange(pos, pos);
            }
        }
    }

    updated(changedProperties: Map<string, any>): void {
        super.updated?.(changedProperties);
        this._bindDelegatedEvents();
        this._bindSearchInput();
        if (this._viewMode === 'visual') {
            const filteredNodes = this._getFilteredNodes();
            this._initOrUpdateCytoscape(filteredNodes, this._graphData.edges, this.getSelectedNode());
        }
        if (this._searchFocused && typeof this.querySelector === 'function') {
            const input = this.querySelector('.graph-search-input') as HTMLInputElement | null;
            if (input) {
                input.focus();
                const pos = Math.min(this._searchCursorPos, input.value.length);
                input.setSelectionRange(pos, pos);
            }
        }
    }

    private _bindSearchInput(): void {
        if (typeof this.querySelector !== 'function') return;
        const searchInput = this.querySelector('.graph-search-input') as HTMLInputElement | null;
        if (searchInput && !(searchInput as any)._bound) {
            (searchInput as any)._bound = true;
            searchInput.addEventListener('focus', () => {
                this._searchFocused = true;
            });
            searchInput.addEventListener('input', (e: any) => {
                this._searchFocused = true;
                const val = e.target.value || '';
                this._searchCursorPos = e.target.selectionStart ?? val.length;
                this._searchQuery = val;

                if (this._searchDebounceTimer) {
                    clearTimeout(this._searchDebounceTimer);
                }
                this._searchDebounceTimer = setTimeout(() => {
                    if (typeof (this as any).requestUpdate === 'function') {
                        (this as any).requestUpdate();
                    } else {
                        this.render();
                    }
                }, 100);
            });
        }
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('graph-explorer')) {
    customElements.define('graph-explorer', GraphExplorer);
}
