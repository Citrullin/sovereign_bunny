// Typed Sovereign Transaction and Note Envelopes
// Complies with Phase 17 & Phase 22 specifications for native PQ-over-ZK and blind note passing.

export type Hex = `0x${string}`;

/// Base Sovereign Transaction Envelope (Extends standard EIP-1559 layout with PQ witness proofs).
export interface SovereignTxEnvelope {
    type: '0x5'; // Sovereign-native envelope type
    to: Hex;
    nonce: bigint;
    gasLimit: bigint;
    maxPriorityFeePerGas: bigint;
    maxFeePerGas: bigint;
    value: bigint;
    data: Hex;
    chainId: bigint;
    /// STARK-stripped / Noir compressed Post-Quantum witness proof (~200B)
    pqProof?: Hex;
    /// Cryptographic profile identifier (e.g., 'quantum_standard', 'throughput', 'high_security')
    profileName?: string;
    /// Replay protection boundary: target epoch of intent creation
    intentEpoch?: bigint;
}

/// Commit-Note Envelope: Wraps precompile calldata with private note commitment metadata
export interface CommitNoteEnvelope extends SovereignTxEnvelope {
    /// 32-byte cryptographic note commitment
    noteCommitment: Hex;
    /// ECIES encrypted note body (recipient viewing key ECDH)
    encryptedCiphertext: Hex;
    /// Ephemeral public key used for note encryption
    ephemeralPubkey: Hex;
    /// Gossip discovery topic: blake3/sha256(viewing_pk || epoch_salt)
    gossipTopic: Hex;
}

/// Absorb-Note Envelope: Burns note via zero-knowledge nullifier proof
export interface AbsorbNoteEnvelope extends SovereignTxEnvelope {
    /// 32-byte nullifier deriving from spending secret
    nullifier: Hex;
    /// UltraHonk/Groth16 ZK proof proving balance ownership and valid nullifier derivation
    noirProof: Hex;
    /// Verkle inclusion proof verifying commitment is present in account accumulator
    verkleInclusion: Hex;
}

/// X-Road Microservice Actor Envelope for typed government & inter-authority actions
export interface XRoadTxEnvelope extends SovereignTxEnvelope {
    /// Globally unique X-Road message identifier
    xroadMessageId: Hex;
    /// Cryptographic hash of underlying court order / legal predicate
    courtDocumentHash: Hex;
    /// Merkle root of the verified X.509 certificate chain
    certChainRoot: Hex;
}

/// PQ-Wrapped Envelope: Contains compressed STARK proof for ML-DSA / Falcon PQ signatures
export interface PqWrappedEnvelope extends SovereignTxEnvelope {
    pqScheme: 'ml_dsa_65' | 'falcon_512' | 'slh_dsa_sha2_128f';
    /// Public key commitment hash
    pqPublicKeyCommitment: Hex;
    /// STARK proof of valid signature verification
    pqStarkProof: Hex;
}

/// Reverse Shadow Contract Descriptor for cross-manifold pointer execution
export interface ReverseShadowContractDescriptor {
    localAddress: Hex;
    localManifoldId: bigint;
    canonicalManifoldId: bigint;
    canonicalAddress: Hex;
    lastCanonicalTip: Hex;
    stateUpdateTopic: Hex;
    hasOperatorRights: boolean;
}

/// Helper to serialize an envelope to deterministic JSON or wire representation
export function serializeSovereignEnvelope(envelope: SovereignTxEnvelope): string {
    return JSON.stringify(envelope, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
}
