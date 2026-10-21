// End-to-end typed interfaces matching Noir circuits in `circuits/*.nr`
// Bridges Noir Barretenberg / UltraHonk inputs and witnesses directly to TypeScript
import { sha256 } from 'viem';

export type NoirField = `0x${string}` | bigint;

/**
 * Circuit: circuits/pid_nullifier.nr
 * Sybil-resistant domain-scoped nullifier for eIDAS PID.
 * Claims at most one nullifier per domain without revealing human identity.
 */
export interface PidNullifierCircuitInputs {
    pid_unique_id: Uint8Array; // [u8; 64]
    pid_salt: NoirField;       // Field
    domain_id: NoirField;      // pub Field
    account_pubkey: Uint8Array;// pub [u8; 33] (Compressed Secp256k1)
}

export interface PidNullifierCircuitOutputs {
    nullifier: NoirField;      // pub Field
}

/**
 * Circuit: circuits/eidas_predicate.nr
 * Proves compliance predicate over an SD-JWT-VC credential against the Slot 8 LOTL root.
 */
export interface EidasPredicateCircuitInputs {
    raw_pid_jwt: Uint8Array;          // [u8; 4096]
    issuer_sig: Uint8Array;           // [u8; 64]
    qtsp_pubkey: Uint8Array;          // [u8; 64]
    qtsp_cert_fingerprint: Uint8Array;// [u8; 32]
    merkle_siblings: NoirField[];     // [Field; 32]
    leaf_index: bigint | number;      // u64
    lotl_root: NoirField;             // pub Field
    challenge_nonce: NoirField;       // pub Field
    account_pubkey: Uint8Array;       // pub [u8; 33]
    predicate_id: number;             // pub u8
    predicate_outcome?: boolean;      // pub bool
}


/**
 * Circuit: circuits/pq_ml_dsa_in_zk.nr
 * Proves valid ML-DSA (Dilithium) signature over a blind note commitment off-chain.
 * Public inputs (~64 bytes) go on-ledger (Precompile 0x65 / 0x07); 2.4KB signature stays private.
 */
export interface PqMlDsaInZkCircuitInputs {
    ml_dsa_signature: Uint8Array;    // [u8; 2420]
    ml_dsa_pubkey: Uint8Array;       // [u8; 1312]
    note_commitment: NoirField;      // pub Field
    account_pubkey_hash: NoirField;  // pub Field (blake3 hash)
    epoch: bigint | number;          // pub u64
}

/**
 * Circuit: circuits/pq_falcon_in_zk.nr
 * Proves valid Falcon-512 signature over a blind note commitment off-chain.
 */
export interface PqFalconInZkCircuitInputs {
    falcon_signature: Uint8Array;    // [u8; 690]
    falcon_pubkey: Uint8Array;       // [u8; 897]
    note_commitment: NoirField;      // pub Field
    account_pubkey_hash: NoirField;  // pub Field (blake3 hash)
    epoch: bigint | number;          // pub u64
}

export interface BlindNote {
    nullifier: `0x${string}`;
    commitment: `0x${string}`;
    target_account: `0x${string}`;
    target_slot: number;
    amount_wei: bigint;
    epoch: bigint;
    proof: `0x${string}`;
    view_tag?: number;
    decay_epoch?: bigint | number;
    relayer_flag?: number;
    cbor_metadata?: `0x${string}` | Record<string, any>;
}

/**
 * Derives a 1-byte view-tag from an ECDH shared secret:
 * view_tag = Hash("sovereign:view_tag:v1:", shared_secret)[0]
 */
export function deriveViewTag(sharedSecret: Uint8Array): number {
    const tag = new TextEncoder().encode("sovereign:view_tag:v1:");
    const combined = new Uint8Array(tag.length + sharedSecret.length);
    combined.set(tag, 0);
    combined.set(sharedSecret, tag.length);
    const hashHex = sha256(combined);
    return parseInt(hashHex.slice(2, 4), 16);
}

/**
 * Derives a deterministic spending nullifier for a blind note:
 * Nullifier = H("sovereign:nullifier:v1:", sk_spend, salt)
 */
export function deriveNullifier(skSpend: Uint8Array, salt: Uint8Array): `0x${string}` {
    const tag = new TextEncoder().encode("sovereign:nullifier:v1:");
    const combined = new Uint8Array(tag.length + skSpend.length + salt.length);
    combined.set(tag, 0);
    combined.set(skSpend, tag.length);
    combined.set(salt, tag.length + skSpend.length);
    return sha256(combined);
}

/**
 * Derives a secondary sender reclamation nullifier:
 * Nullifier_reclaim = H("sovereign:reclaim_nullifier:v1:", sk_sender, salt, decay_epoch)
 */
export function deriveReclamationNullifier(skSender: Uint8Array, salt: Uint8Array, decayEpoch: bigint | number): `0x${string}` {
    const epochBig = BigInt(decayEpoch);
    const tag = new TextEncoder().encode("sovereign:reclaim_nullifier:v1:");
    const combined = new Uint8Array(tag.length + skSender.length + salt.length + 8);
    combined.set(tag, 0);
    combined.set(skSender, tag.length);
    combined.set(salt, tag.length + skSender.length);
    for (let i = 0; i < 8; i++) {
        combined[tag.length + skSender.length + salt.length + i] = Number((epochBig >> BigInt(i * 8)) & 0xffn);
    }
    return sha256(combined);
}

export interface CrossChainBlindNote {
    source_chain_id: bigint | number;
    target_chain_id: bigint | number;
    shadow_receipt_hash: `0x${string}`;
    note: BlindNote;
    cbor_payload: `0x${string}`;
}

export interface GenesisVoucherItem {
    target_account: `0x${string}` | string;
    target_slot: number;
    value: string;
    nullifier: `0x${string}` | string;
    secret: `0x${string}` | string;
    commitment: `0x${string}` | string;
    iroh_cid?: string | null;
    cbor_metadata?: `0x${string}` | null;
}

export interface GenesisVouchersDocument {
    network_name: string;
    chain_id: number;
    vouchers: GenesisVoucherItem[];
}

/**
 * Circuit: circuits/pin_note_redeem.nr
 * Proves knowledge of private PIN preimage to derive nullifier for Model 3 NFC notes.
 */
export interface PinNoteRedeemCircuitInputs {
    pin_hash: NoirField;  // private Field (poseidon(PIN))
    note_id: NoirField;   // pub Field (note commitment ID)
    salt: NoirField;      // pub Field (salt from tag)
}

export interface PinNoteRedeemCircuitOutputs {
    nullifier: NoirField; // pub Field
}

/**
 * Helper to validate and serialize typed Noir circuit inputs into Barretenberg witness map format.
 */
export function formatPidNullifierWitness(inputs: PidNullifierCircuitInputs): Record<string, string> {
    if (inputs.pid_unique_id.length !== 64) {
        throw new Error(`pid_unique_id must be 64 bytes, got ${inputs.pid_unique_id.length}`);
    }
    if (inputs.account_pubkey.length !== 33) {
        throw new Error(`account_pubkey must be 33 bytes (compressed), got ${inputs.account_pubkey.length}`);
    }
    return {
        pid_unique_id: Array.from(inputs.pid_unique_id).map(b => b.toString()),
        pid_salt: typeof inputs.pid_salt === 'bigint' ? `0x${inputs.pid_salt.toString(16)}` : inputs.pid_salt,
        domain_id: typeof inputs.domain_id === 'bigint' ? `0x${inputs.domain_id.toString(16)}` : inputs.domain_id,
        account_pubkey: Array.from(inputs.account_pubkey).map(b => b.toString()),
    } as any;
}

export function formatPinNoteRedeemWitness(inputs: PinNoteRedeemCircuitInputs): Record<string, string> {
    return {
        pin_hash: typeof inputs.pin_hash === 'bigint' ? `0x${inputs.pin_hash.toString(16)}` : inputs.pin_hash,
        note_id: typeof inputs.note_id === 'bigint' ? `0x${inputs.note_id.toString(16)}` : inputs.note_id,
        salt: typeof inputs.salt === 'bigint' ? `0x${inputs.salt.toString(16)}` : inputs.salt,
    } as any;
}

/**
 * Circuit: circuits/private_unit_vote.nr
 * Proves voter membership in an epoch SMT, derives a deterministic nullifier,
 * and constrains vote_choice to binary unit value {0, 1}.
 */
export interface PrivateUnitVoteCircuitInputs {
    // Private Inputs
    voter_secret_key: NoirField;
    vote_blinding: NoirField;
    smt_leaf_index: bigint | number;
    smt_siblings: NoirField[]; // [Field; 32]
    vote_choice: NoirField;    // 0 or 1

    // Public Inputs
    proposal_id: NoirField;
    proposal_scope: NoirField;
    voter_registration_smt_root: NoirField;
    derived_nullifier: NoirField;
    vote_commitment: NoirField;
    public_vote_weight: NoirField; // Must be 1
}

export function formatPrivateUnitVoteWitness(inputs: PrivateUnitVoteCircuitInputs): Record<string, string> {
    const toHexStr = (val: NoirField) => (typeof val === 'bigint' ? `0x${val.toString(16)}` : val);
    if (inputs.smt_siblings.length !== 32) {
        throw new Error(`smt_siblings must have length 32, got ${inputs.smt_siblings.length}`);
    }
    return {
        voter_secret_key: toHexStr(inputs.voter_secret_key),
        vote_blinding: toHexStr(inputs.vote_blinding),
        smt_leaf_index: inputs.smt_leaf_index.toString(),
        smt_siblings: inputs.smt_siblings.map(toHexStr) as any,
        vote_choice: toHexStr(inputs.vote_choice),
        proposal_id: toHexStr(inputs.proposal_id),
        proposal_scope: toHexStr(inputs.proposal_scope),
        voter_registration_smt_root: toHexStr(inputs.voter_registration_smt_root),
        derived_nullifier: toHexStr(inputs.derived_nullifier),
        vote_commitment: toHexStr(inputs.vote_commitment),
        public_vote_weight: toHexStr(inputs.public_vote_weight),
    } as any;
}

/**
 * TypeScript types and witness formatter for State Lineage Telemetry Circuit (circuits/state_lineage_telemetry.nr).
 */
export interface StateLineageTelemetryCircuitInputs {
    voter_or_trader_sk: NoirField;
    account_id: NoirField;
    epoch: bigint | number;
    tip_hash: NoirField;
    leaf_value: NoirField;
    merkle_path_index: bigint | number;
    merkle_siblings: NoirField[]; // [Field; 32]

    settled_state_root: NoirField;
    lineage_nullifier: NoirField;
    telemetry_tier: number; // 0 = Subsidized, 1 = Quantized, 2 = SovereignDark
}

export function formatStateLineageTelemetryWitness(inputs: StateLineageTelemetryCircuitInputs): Record<string, string> {
    const toHexStr = (val: NoirField) => (typeof val === 'bigint' ? `0x${val.toString(16)}` : val);
    if (inputs.merkle_siblings.length !== 32) {
        throw new Error(`merkle_siblings must have length 32, got ${inputs.merkle_siblings.length}`);
    }
    return {
        voter_or_trader_sk: toHexStr(inputs.voter_or_trader_sk),
        account_id: toHexStr(inputs.account_id),
        epoch: inputs.epoch.toString(),
        tip_hash: toHexStr(inputs.tip_hash),
        leaf_value: toHexStr(inputs.leaf_value),
        merkle_path_index: inputs.merkle_path_index.toString(),
        merkle_siblings: inputs.merkle_siblings.map(toHexStr) as any,
        settled_state_root: toHexStr(inputs.settled_state_root),
        lineage_nullifier: toHexStr(inputs.lineage_nullifier),
        telemetry_tier: inputs.telemetry_tier.toString(),
    } as any;
}


