// Sovereign Virtual CAR Inspector & Noir Prover Generator
// Supports the Sovereign Remix Plugin & Wallet Tree Explorer.
// Provides 64-slot introspection, global tree search, and automatic Noir Prover.toml synthesis.

import { VirtualCarBuffer } from './car_reconciler.js';

export interface SlotMetadata {
    slot: number;
    name: string;
    description: string;
    category: 'Identity' | 'AccessControl' | 'Privacy' | 'CodeProvenance' | 'Database' | 'Consensus' | 'Governance' | 'Coordination' | 'Staking' | 'DynamicSparse';
}

export const CANONICAL_SLOT_DEFINITIONS: Record<number, SlotMetadata> = {
    0: { slot: 0, name: 'W3C_DIF_IDENTITY', description: 'DID Document Poseidon root, public keys, monotonic nonces', category: 'Identity' },
    1: { slot: 1, name: 'ZANZIBAR_REBAC', description: 'Google Zanzibar relation tuples, edge digest accumulator', category: 'AccessControl' },
    2: { slot: 2, name: 'BLIND_NOTES', description: 'Shielded UTXO Sparse Merkle Tree, Aztec-style commitments & nullifiers', category: 'Privacy' },
    3: { slot: 3, name: 'GIT_DAG_AND_COBS', description: 'Canonical Git commit DAG, tree tips, and Git-native Collaborative Objects (issues, patches, reviews in git refs/cobs/ or git-bug)', category: 'CodeProvenance' },
    4: { slot: 4, name: 'PROOF_OF_SQL', description: 'Relational polynomial commitments, multilateral balance states', category: 'Database' },
    5: { slot: 5, name: 'EPOCH_CONSENSUS', description: 'Rotating Paxos lease, Snow epoch state, Lamport cuts', category: 'Consensus' },
    6: { slot: 6, name: 'DAO_GOVERNANCE_MATRIX', description: 'Voting weight, delegated MeritRank tallies', category: 'Governance' },
    7: { slot: 7, name: 'LATTICE_SAGA_LOCK', description: 'Policy byte (allow_saga_locking), lexicographical lock queue', category: 'Coordination' },
    8: { slot: 8, name: 'OPERATIONAL_SURETY', description: 'Locked $RAD / $TINY, canonical routing bonds, slash receipts', category: 'Staking' },
};

export interface DecodedSlot {
    slot: number;
    metadata: SlotMetadata;
    nonce: bigint;
    isDirty: boolean;
    rawHex: string;
    decodedSummary: string;
}

export interface TreeSearchMatch {
    slot: number;
    name: string;
    category: string;
    matchedField: 'name' | 'category' | 'description' | 'content';
    snippet: string;
}

export class CarTreeInspector {
    public static getSlotMetadata(slot: number): SlotMetadata {
        if (slot in CANONICAL_SLOT_DEFINITIONS) {
            return CANONICAL_SLOT_DEFINITIONS[slot];
        }
        return {
            slot,
            name: `DYNAMIC_SPARSE_SLOT_${slot}`,
            description: `User-defined dynamic sparse slot R_${slot}`,
            category: 'DynamicSparse',
        };
    }

    public static inspectSlot(buffer: VirtualCarBuffer, slot: number): DecodedSlot {
        const meta = this.getSlotMetadata(slot);
        const data = buffer.getSlot(slot);
        const nonce = buffer.nonces[slot] || 0n;
        const isDirty = (buffer.dirtyMask & (1n << BigInt(slot))) !== 0n;
        const hex = '0x' + Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');

        let summary = 'Zero / Uninitialized';
        if (data.some(b => b !== 0)) {
            if (slot === 0) {
                summary = `Identity Root: ${hex.slice(0, 10)}... (Nonce: ${nonce})`;
            } else if (slot === 1) {
                summary = `Zanzibar Edge Accumulator: ${hex.slice(0, 10)}...`;
            } else if (slot === 2) {
                summary = `Blind Note SMT Tip: ${hex.slice(0, 10)}...`;
            } else if (slot === 3) {
                summary = `Git Commit / Tree Root & COB Issues: ${hex.slice(0, 10)}...`;
            } else if (slot === 4) {
                summary = `Proof of SQL Table Commitment: ${hex.slice(0, 10)}...`;
            } else {
                summary = `Root: ${hex.slice(0, 14)}...`;
            }
        }

        return {
            slot,
            metadata: meta,
            nonce,
            isDirty,
            rawHex: hex,
            decodedSummary: summary,
        };
    }

    public static inspectAll(buffer: VirtualCarBuffer): DecodedSlot[] {
        const result: DecodedSlot[] = [];
        for (let i = 0; i < 64; i++) {
            result.push(this.inspectSlot(buffer, i));
        }
        return result;
    }

    public static search(buffer: VirtualCarBuffer, query: string): TreeSearchMatch[] {
        const q = query.trim().toLowerCase();
        if (!q) return [];

        const matches: TreeSearchMatch[] = [];
        for (let i = 0; i < 64; i++) {
            const inspected = this.inspectSlot(buffer, i);
            const meta = inspected.metadata;

            if (meta.name.toLowerCase().includes(q)) {
                matches.push({ slot: i, name: meta.name, category: meta.category, matchedField: 'name', snippet: meta.name });
            } else if (meta.category.toLowerCase().includes(q)) {
                matches.push({ slot: i, name: meta.name, category: meta.category, matchedField: 'category', snippet: meta.category });
            } else if (meta.description.toLowerCase().includes(q)) {
                matches.push({ slot: i, name: meta.name, category: meta.category, matchedField: 'description', snippet: meta.description });
            } else if (inspected.rawHex.toLowerCase().includes(q)) {
                matches.push({ slot: i, name: meta.name, category: meta.category, matchedField: 'content', snippet: inspected.rawHex.slice(0, 20) + '...' });
            }
        }
        return matches;
    }

    /// Generates Prover.toml inputs for Noir circuits using live Virtual CAR roots.
    public static generateNoirProverToml(
        circuit: 'private_unit_vote' | 'eidas_predicate' | 'pid_nullifier',
        buffer: VirtualCarBuffer,
        options: {
            voterSecretKey?: string;
            voteChoice?: 0 | 1;
            proposalId?: string;
            proposalScope?: string;
        } = {}
    ): string {
        const slot1Hex = '0x' + Array.from(buffer.getSlot(1)).map(b => b.toString(16).padStart(2, '0')).join('');
        const slot2Hex = '0x' + Array.from(buffer.getSlot(2)).map(b => b.toString(16).padStart(2, '0')).join('');
        const slot6Hex = '0x' + Array.from(buffer.getSlot(6)).map(b => b.toString(16).padStart(2, '0')).join('');

        if (circuit === 'private_unit_vote') {
            const voterSecret = options.voterSecretKey || '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
            const choice = options.voteChoice !== undefined ? options.voteChoice : 1;
            const proposalId = options.proposalId || '0x42';
            const proposalScope = options.proposalScope || '0x01';
            const registrationRoot = slot6Hex !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? slot6Hex : slot1Hex;

            // Generate 32-element SMT siblings array (zero-filled for root match in local test)
            const siblingsFormatted = Array(32).fill('"0x0000000000000000000000000000000000000000000000000000000000000000"').join(',\n  ');

            return `# Auto-generated Prover.toml from Sovereign Virtual CAR Tree
# Circuit: private_unit_vote.nr

# Private Inputs:
voter_secret_key = "${voterSecret}"
vote_blinding = "0x09a8b7c6d5e4f32109a8b7c6d5e4f32109a8b7c6d5e4f32109a8b7c6d5e4f321"
smt_leaf_index = 0
smt_siblings = [
  ${siblingsFormatted}
]
vote_choice = ${choice}

# Public Inputs:
proposal_id = "${proposalId}"
proposal_scope = "${proposalScope}"
voter_registration_smt_root = "${registrationRoot}"
derived_nullifier = "0x11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff"
vote_commitment = "0xfeeeddcba09876543210feeeddcba09876543210feeeddcba09876543210feee"
public_vote_weight = 1
`;
        }

        if (circuit === 'pid_nullifier') {
            return `# Auto-generated Prover.toml from Sovereign Virtual CAR Tree
# Circuit: pid_nullifier.nr

identity_secret = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
nullifier_root = "${slot2Hex}"
epoch = 1
`;
        }

        return `# Default Sovereign CAR Prover Configuration\ncar_slot_0 = "${buffer.getSlot(0)}"\n`;
    }

    /// Prepares a JSON payload for Remix IDE webview communication via @remixproject/plugin
    public static toRemixPluginMessage(buffer: VirtualCarBuffer, action: 'treeState' | 'witnessReady'): Record<string, any> {
        return {
            source: 'sovereign-remix-plugin',
            action,
            timestamp: Date.now(),
            dirtyCount: Number(buffer.dirtyMask),
            slots: this.inspectAll(buffer).map(s => ({
                slot: s.slot,
                name: s.metadata.name,
                category: s.metadata.category,
                nonce: s.nonce.toString(),
                isDirty: s.isDirty,
                hex: s.rawHex,
                summary: s.decodedSummary,
            })),
        };
    }
}
