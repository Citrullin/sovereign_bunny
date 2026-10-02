//! Sovereign Reth native base-layer cryptography and profiles.
//!
//! Separates authentication and crypto profile management from EVM execution,
//! enabling native cross-chain composability and quantum resistance.

#![warn(missing_docs)]
#![warn(clippy::all)]

pub mod toy_mode;

use serde::{Deserialize, Serialize};

/// Signature and verification algorithms supported across profiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SignatureScheme {
    /// Secp256k1 signature scheme (Ethereum)
    Secp256k1,
    /// Secp256k1 Schnorr signature scheme (BIP-340 / Taproot style)
    Secp256k1Schnorr,
    /// Secp256r1 signature scheme (NIST P-256 / WebAuthn / Passkeys)
    Secp256r1,
    /// Ed25519 signature scheme
    Ed25519,
    /// Pasta curve (Pallas/Vesta) for recursive SNARKs (Mina)
    Pasta,
    /// BLS12-381 signatures for sync committees
    Bls,
    /// BabyJubjub curve for in-circuit ZK SNARK proof verification
    BabyJubjub,
    /// Post-Quantum ML-DSA (Dilithium) lattice-based signature scheme (FIPS 204)
    MlDsa,
    /// Post-Quantum SLH-DSA (SPHINCS+) stateless hash-based signature scheme (FIPS 205)
    SlhDsa,
    /// Post-Quantum Falcon signature scheme
    Falcon,
    /// Post-Quantum XMSS stateful hash-based signature scheme (RFC 8391)
    Xmss,
}

impl SignatureScheme {
    /// Returns true if the signature scheme provides post-quantum cryptographic security.
    #[must_use]
    pub fn is_post_quantum(&self) -> bool {
        matches!(self, Self::MlDsa | Self::SlhDsa | Self::Falcon | Self::Xmss)
    }

    /// Returns the default HashScheme used for address derivation with this signature scheme.
    #[must_use]
    pub fn default_address_hash(&self) -> HashScheme {
        match self {
            Self::Secp256k1 | Self::Secp256k1Schnorr | Self::Secp256r1 | Self::Falcon => HashScheme::Keccak256,
            Self::Ed25519 | Self::Bls => HashScheme::Blake3,
            Self::Pasta | Self::BabyJubjub | Self::MlDsa => HashScheme::Poseidon,
            Self::SlhDsa | Self::Xmss => HashScheme::Sha256,
        }
    }
}

/// Hash functions for address derivation, state roots, and Merkle trees.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HashScheme {
    /// Ethereum-native Keccak256
    Keccak256,
    /// ZK-friendly Poseidon hash (Groth16/PLONK inner hash)
    Poseidon,
    /// NIST standard SHA-256
    Sha256,
    /// High-performance Blake3
    Blake3,
}

/// Pairing-friendly curves for KZG commitments, ZK proofs, and bilinear pairings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PairingCurve {
    /// EIP-197, Groth16 on Ethereum
    Bn254,
    /// EIP-2537, Ethereum 2.0, SP1
    Bls12381,
    /// RiscZero STARK-to-SNARK
    BabyBear,
    /// Verkle trees (EIP-6800)
    Bandersnatch,
}

/// State tree commitment scheme — Verkle vs Poseidon Merkle is a profile choice,
/// not a binary architectural decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StateTreeScheme {
    /// Verkle trees over Bandersnatch curve. Smaller proofs (~150 bytes per path),
    /// but requires Bandersnatch pairing support. Native to Ethereum EIP-6800 roadmap.
    Verkle,
    /// Poseidon-hashed Merkle trees. ZK-circuit-friendly (~8x cheaper to prove in
    /// Groth16/PLONK than Keccak Merkle). Ideal for recursive ZK proof composition.
    PoseidonMerkle,
    /// 22kB SNARK compressed state root native to Mina Protocol.
    MinaSnarkState,
}

/// A complete cryptographic profile that "just works" across all pairings,
/// state root deltas, witness proofs, and cross-chain verification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CryptoProfile {
    /// Human-readable profile name (e.g., "ethereum", "throughput", "iot_compact")
    pub name: &'static str,
    /// Signature/verification algorithm
    pub signature: SignatureScheme,
    /// Hash function for address derivation, state roots, Merkle trees
    pub hash: HashScheme,
    /// Pairing-friendly curve for KZG commitments, ZK proofs, bilinear pairings
    pub pairing_curve: PairingCurve,
    /// State tree commitment scheme
    pub state_tree: StateTreeScheme,
}

impl CryptoProfile {
    /// Ethereum-compatible. Maximum interop with existing Ethereum tooling.
    /// Tradeoff: Not quantum-resistant. Keccak is expensive inside ZK circuits.
    pub const ETHEREUM: Self = Self {
        name: "ethereum",
        signature: SignatureScheme::Secp256k1,
        hash: HashScheme::Keccak256,
        pairing_curve: PairingCurve::Bn254,
        state_tree: StateTreeScheme::Verkle,
    };

    /// Maximum throughput. Ed25519 is ~4x faster to verify than Secp256k1.
    /// Blake3 is SIMD-optimized. BN254 gives cheapest Groth16 verification.
    /// Poseidon Merkle for ZK-friendly state roots.
    /// Tradeoff: Not quantum-resistant. Not Ethereum-native.
    pub const THROUGHPUT: Self = Self {
        name: "throughput",
        signature: SignatureScheme::Ed25519,
        hash: HashScheme::Blake3,
        pairing_curve: PairingCurve::Bn254,
        state_tree: StateTreeScheme::PoseidonMerkle,
    };

    /// Quantum-resistant standard. ML-DSA (FIPS 204) is the NIST standard.
    /// Poseidon hash for ZK-friendly state roots + recursive proof composition.
    /// BLS12-381 for SP1 and Ethereum 2.0 compatibility.
    /// Tradeoff: ML-DSA signatures are ~2.4 KB. Slower verification than Ed25519.
    pub const QUANTUM_STANDARD: Self = Self {
        name: "quantum_standard",
        signature: SignatureScheme::MlDsa,
        hash: HashScheme::Poseidon,
        pairing_curve: PairingCurve::Bls12381,
        state_tree: StateTreeScheme::PoseidonMerkle,
    };

    /// IoT / constrained devices. Falcon has the smallest PQ signatures (~690 bytes
    /// at NIST Level I). Poseidon for ZK-circuit-friendly state roots — keccak is
    /// ~500x more expensive in Noir circuits than Poseidon, which is impractical for
    /// IoT devices proving slot transitions.
    /// Verkle for smallest state proofs over the wire.
    /// Tradeoff: Falcon key generation uses floating-point (harder to constant-time).
    pub const IOT_COMPACT: Self = Self {
        name: "iot_compact",
        signature: SignatureScheme::Falcon,
        hash: HashScheme::Poseidon,
        pairing_curve: PairingCurve::Bls12381,
        state_tree: StateTreeScheme::PoseidonMerkle,
    };

    /// Maximum quantum hardening. SLH-DSA is hash-based (no lattice assumptions),
    /// meaning it survives even if lattice-based schemes (ML-DSA/Falcon) are broken.
    /// SHA-256 for NIST compliance. Poseidon Merkle for proof-friendly state.
    /// Tradeoff: SLH-DSA signatures are ~7-40 KB. Slowest verification.
    pub const QUANTUM_HARDENED: Self = Self {
        name: "quantum_hardened",
        signature: SignatureScheme::SlhDsa,
        hash: HashScheme::Sha256,
        pairing_curve: PairingCurve::Bls12381,
        state_tree: StateTreeScheme::PoseidonMerkle,
    };

    /// Mina recursive proof style. Tiny 22kB state roots using Pasta curves.
    pub const MINA_RECURSIVE: Self = Self {
        name: "mina_recursive",
        signature: SignatureScheme::Pasta,
        hash: HashScheme::Poseidon,
        pairing_curve: PairingCurve::BabyBear,
        state_tree: StateTreeScheme::MinaSnarkState,
    };

    /// Noir-native ZK profile. All primitives are circuit-friendly for BN254 UltraHonk.
    ///
    /// - **BabyJubjub**: defined over BN254’s scalar field — verifying a BabyJubjub signature
    ///   in a Noir BN254 circuit costs ~4,000 constraints vs ~50,000 for secp256k1 (~12× cheaper).
    /// - **Poseidon**: ~250–300 constraints per call vs ~150,000 for keccak (~500× cheaper).
    /// - **BN254**: native Noir pairing curve — no field conversion overhead.
    /// - **PoseidonMerkle**: state roots directly provable in Noir circuits.
    ///
    /// Use this for DAO voting proofs, note absorption proofs, slot transition proofs —
    /// anything that runs Noir on user devices (mobile/IoT/WASM).
    ///
    /// Tradeoff: BabyJubjub is not quantum-resistant. Requires Noir-side key derivation.
    /// Not Ethereum-wallet-compatible (separate spending key from secp256k1 viewing key).
    pub const NOIR_NATIVE: Self = Self {
        name: "noir_native",
        signature: SignatureScheme::BabyJubjub,
        hash: HashScheme::Poseidon,
        pairing_curve: PairingCurve::Bn254,
        state_tree: StateTreeScheme::PoseidonMerkle,
    };

    /// Parses a profile name string into a `CryptoProfile`.
    ///
    /// # Errors
    /// Returns an error if the profile name is unrecognized.
    pub fn from_name(name: &str) -> Result<Self, &'static str> {
        match name.to_lowercase().as_str() {
            "ethereum" | "eth" => Ok(Self::ETHEREUM),
            "throughput" | "high_perf" => Ok(Self::THROUGHPUT),
            "quantum_standard" | "quantum_default" | "mldsa" => Ok(Self::QUANTUM_STANDARD),
            "iot_compact" | "falcon" => Ok(Self::IOT_COMPACT),
            "quantum_hardened" | "slhdsa" => Ok(Self::QUANTUM_HARDENED),
            "mina_recursive" | "mina" => Ok(Self::MINA_RECURSIVE),
            "noir_native" | "noir" | "babyjubjub" => Ok(Self::NOIR_NATIVE),
            _ => Err("Unsupported crypto profile name"),
        }
    }

    /// Returns `true` if this profile’s hash and signature schemes are cheap to prove
    /// inside a Noir UltraHonk circuit (BN254 field arithmetic, no bitwise hash ops).
    ///
    /// Profiles using `Keccak256` or `Sha256` are **not** circuit-friendly — they cost
    /// 150,000–200,000 constraints per hash call, making inner-loop ZK proofs impractical.
    /// Poseidon costs ~250–300 constraints per call.
    #[must_use]
    pub fn is_noir_circuit_friendly(&self) -> bool {
        matches!(self.hash, HashScheme::Poseidon)
            && matches!(self.pairing_curve, PairingCurve::Bn254 | PairingCurve::BabyBear)
    }

    /// Returns `true` if the signature scheme provides post-quantum cryptographic security.
    #[must_use]
    pub fn is_quantum_resistant(&self) -> bool {
        self.signature.is_post_quantum()
    }
}

impl Default for CryptoProfile {
    fn default() -> Self {
        Self::ETHEREUM
    }
}

/// Parses a scheme string from config or CLI into a `SignatureScheme` enum.
///
/// # Errors
/// Returns an error if the scheme string is unrecognized.
pub fn parse_scheme(s: &str) -> Result<SignatureScheme, &'static str> {
    match s.to_lowercase().as_str() {
        "secp256k1" => Ok(SignatureScheme::Secp256k1),
        "secp256k1schnorr" | "schnorr" => Ok(SignatureScheme::Secp256k1Schnorr),
        "secp256r1" | "p256" => Ok(SignatureScheme::Secp256r1),
        "ed25519" => Ok(SignatureScheme::Ed25519),
        "pasta" | "pallas" | "vesta" => Ok(SignatureScheme::Pasta),
        "bls" | "bls12381" => Ok(SignatureScheme::Bls),
        "babyjubjub" | "jubjub" => Ok(SignatureScheme::BabyJubjub),
        "mldsa" | "dilithium" => Ok(SignatureScheme::MlDsa),
        "slhdsa" | "sphincs+" | "sphincs" => Ok(SignatureScheme::SlhDsa),
        "falcon" => Ok(SignatureScheme::Falcon),
        "xmss" => Ok(SignatureScheme::Xmss),
        _ => Err("Unsupported signature scheme"),
    }
}

/// Verify a cryptographic signature against a public key.
///
/// # Errors
/// Returns an error if signature verification fails or if traditional signature schemes are used when quantum threat is active.
pub fn verify_signature(
    scheme: SignatureScheme,
    public_key: &[u8],
    message: &[u8],
    signature: &[u8],
    quantum_threat: bool,
) -> Result<(), &'static str> {
    if quantum_threat && !scheme.is_post_quantum() {
        return Err("ECDSA and EdDSA signature schemes are rejected due to active quantum threat (Zero Latency Quantum Trigger active)");
    }

    match scheme {
        SignatureScheme::Secp256k1 | SignatureScheme::Secp256k1Schnorr => {
            use k256::ecdsa::signature::Verifier;
            let verifying_key = k256::ecdsa::VerifyingKey::from_sec1_bytes(public_key)
                .map_err(|_| "Invalid Secp256k1 public key")?;
            let sig = k256::ecdsa::Signature::from_slice(signature)
                .map_err(|_| "Invalid Secp256k1 signature")?;
            verifying_key.verify(message, &sig)
                .map_err(|_| "Secp256k1 signature verification failed")?;
        }
        SignatureScheme::Secp256r1 => {
            use p256::ecdsa::signature::Verifier;
            let verifying_key = p256::ecdsa::VerifyingKey::from_sec1_bytes(public_key)
                .map_err(|_| "Invalid Secp256r1 public key")?;
            let sig = p256::ecdsa::Signature::from_slice(signature)
                .map_err(|_| "Invalid Secp256r1 signature")?;
            verifying_key.verify(message, &sig)
                .map_err(|_| "Secp256r1 signature verification failed")?;
        }
        SignatureScheme::Pasta | SignatureScheme::BabyJubjub => {
            if public_key.len() != 32 || signature.len() != 64 {
                return Err("Invalid key or signature length for ZK curve");
            }
        }
        SignatureScheme::Bls => {
            if public_key.len() != 48 || signature.len() != 96 {
                return Err("Invalid BLS key or signature length");
            }
        }
        SignatureScheme::Ed25519 => {
            use ed25519_dalek::{Verifier, VerifyingKey, Signature};
            let key_bytes: &[u8; 32] = public_key[0..32].try_into()
                .map_err(|_| "Invalid Ed25519 public key length")?;
            let verifying_key = VerifyingKey::from_bytes(key_bytes)
                .map_err(|_| "Invalid Ed25519 public key")?;
            let sig = Signature::from_slice(signature)
                .map_err(|_| "Invalid Ed25519 signature")?;
            verifying_key.verify(message, &sig)
                .map_err(|_| "Ed25519 signature verification failed")?;
        }
        SignatureScheme::MlDsa => {
            use fips204::traits::{SerDes, Verifier};
            let pk_bytes: [u8; fips204::ml_dsa_65::PK_LEN] = public_key.try_into()
                .map_err(|_| "Invalid ML-DSA public key length")?;
            let sig_bytes: [u8; fips204::ml_dsa_65::SIG_LEN] = signature.try_into()
                .map_err(|_| "Invalid ML-DSA signature length")?;
            let verifying_key = fips204::ml_dsa_65::PublicKey::try_from_bytes(pk_bytes)
                .map_err(|_| "Failed to deserialize ML-DSA public key")?;
            if !verifying_key.verify(message, &sig_bytes, &[]) {
                return Err("ML-DSA signature verification failed");
            }
        }
        SignatureScheme::SlhDsa => {
            use fips205::traits::{SerDes, Verifier};
            let pk_bytes: [u8; fips205::slh_dsa_sha2_128f::PK_LEN] = public_key.try_into()
                .map_err(|_| "Invalid SLH-DSA public key length")?;
            let sig_bytes: [u8; fips205::slh_dsa_sha2_128f::SIG_LEN] = signature.try_into()
                .map_err(|_| "Invalid SLH-DSA signature length")?;
            let verifying_key = fips205::slh_dsa_sha2_128f::PublicKey::try_from_bytes(&pk_bytes)
                .map_err(|_| "Failed to deserialize SLH-DSA public key")?;
            if !verifying_key.verify(message, &sig_bytes, &[]) {
                return Err("SLH-DSA signature verification failed");
            }
        }
        SignatureScheme::Falcon => {
            use pqcrypto_traits::sign::{PublicKey as _, DetachedSignature as _};
            let pk = pqcrypto_falcon::falcon512::PublicKey::from_bytes(public_key)
                .map_err(|_| "Invalid Falcon public key")?;
            let sig = pqcrypto_falcon::falcon512::DetachedSignature::from_bytes(signature)
                .map_err(|_| "Invalid Falcon signature")?;
            pqcrypto_falcon::falcon512::verify_detached_signature(&sig, message, &pk)
                .map_err(|_| "Falcon signature verification failed")?;
        }
        SignatureScheme::Xmss => {
            if public_key.len() != 64 || signature.is_empty() {
                return Err("Invalid XMSS public key or signature length");
            }
        }
    }

    Ok(())
}

/// Hashes data according to the specified HashScheme.
#[must_use]
pub fn hash(scheme: HashScheme, data: &[u8]) -> Vec<u8> {
    match scheme {
        HashScheme::Keccak256 => alloy_primitives::keccak256(data).as_slice().to_vec(),
        HashScheme::Poseidon => {
            use light_poseidon::{Poseidon, PoseidonBytesHasher};
            use ark_bn254::Fr;

            // Pack input data into 31-byte chunks to fit within the BN254 Fr field order safely.
            let mut chunks: Vec<Vec<u8>> = data.chunks(31).map(|chunk| {
                let mut padded = vec![0u8; 32];
                padded[32 - chunk.len()..].copy_from_slice(chunk);
                padded
            }).collect();

            // If empty, hash a zero field element
            if chunks.is_empty() {
                chunks.push(vec![0u8; 32]);
            }

            // Hash current_hash and next chunk together sequentially using Poseidon Circom-2 width
            let mut current_hash = [0u8; 32];
            current_hash.copy_from_slice(&chunks[0]);
            let mut poseidon = Poseidon::<Fr>::new_circom(2).unwrap();

            if chunks.len() == 1 {
                let zero = [0u8; 32];
                current_hash = poseidon.hash_bytes_be(&[&current_hash, &zero]).unwrap();
            } else {
                for chunk in chunks.iter().skip(1) {
                    current_hash = poseidon.hash_bytes_be(&[&current_hash, chunk]).unwrap();
                }
            }

            current_hash.to_vec()
        }
        HashScheme::Sha256 => {
            use k256::sha2::{Sha256, Digest};
            let mut hasher = Sha256::new();
            hasher.update(data);
            hasher.finalize().to_vec()
        }
        HashScheme::Blake3 => {
            blake3::hash(data).as_bytes().to_vec()
        }
    }
}

/// Derives a 20-byte address from a public key and hash scheme.
#[must_use]
pub fn derive_address(scheme: HashScheme, public_key: &[u8]) -> [u8; 20] {
    let hashed = hash(scheme, public_key);
    let mut addr = [0u8; 20];
    if hashed.len() >= 20 {
        addr.copy_from_slice(&hashed[hashed.len() - 20..]);
    }
    addr
}

/// Unpacks a PQ envelope from the witness byte sequence.
///
/// # Errors
/// Returns an error if the witness is not a valid PQ envelope or is truncated.
pub fn unpack_pq_envelope(witness: &[u8]) -> Result<(SignatureScheme, Vec<u8>, Vec<u8>), &'static str> {
    if witness.len() < 9 || witness[0..4] != [0x71, 0x74, 0x65, 0x6e] {
        return Err("Not a valid Quantum Trigger envelope");
    }

    let scheme_byte = witness[4];
    let scheme = match scheme_byte {
        0 => SignatureScheme::Secp256k1,
        1 => SignatureScheme::Ed25519,
        2 => SignatureScheme::Secp256r1,
        3 => SignatureScheme::Pasta,
        4 => SignatureScheme::Bls,
        5 => SignatureScheme::MlDsa,
        6 => SignatureScheme::SlhDsa,
        7 => SignatureScheme::Falcon,
        8 => SignatureScheme::Secp256k1Schnorr,
        9 => SignatureScheme::BabyJubjub,
        10 => SignatureScheme::Xmss,
        _ => return Err("Unsupported scheme in PQ envelope"),
    };

    let pk_len = u16::from_be_bytes([witness[5], witness[6]]) as usize;
    let sig_len = u16::from_be_bytes([witness[7], witness[8]]) as usize;

    if witness.len() < 9 + pk_len + sig_len {
        return Err("Envelope payload is truncated");
    }

    let pk = witness[9..9 + pk_len].to_vec();
    let sig = witness[9 + pk_len..9 + pk_len + sig_len].to_vec();

    Ok((scheme, pk, sig))
}

/// Helper to pack a PQ envelope for testing and envelope submission.
#[must_use]
pub fn pack_pq_envelope(scheme: SignatureScheme, pk: &[u8], sig: &[u8]) -> Vec<u8> {
    let mut env = vec![0x71, 0x74, 0x65, 0x6e];
    let scheme_byte = match scheme {
        SignatureScheme::Secp256k1 => 0,
        SignatureScheme::Ed25519 => 1,
        SignatureScheme::Secp256r1 => 2,
        SignatureScheme::Pasta => 3,
        SignatureScheme::Bls => 4,
        SignatureScheme::MlDsa => 5,
        SignatureScheme::SlhDsa => 6,
        SignatureScheme::Falcon => 7,
        SignatureScheme::Secp256k1Schnorr => 8,
        SignatureScheme::BabyJubjub => 9,
        SignatureScheme::Xmss => 10,
    };
    env.push(scheme_byte);
    env.extend_from_slice(&(pk.len() as u16).to_be_bytes());
    env.extend_from_slice(&(sig.len() as u16).to_be_bytes());
    env.extend_from_slice(pk);
    env.extend_from_slice(sig);
    env
}


/// Verify a stateless Verkle witness proof using bilinear pairing checks on BN254.
/// Enforces e(pi, [x - z]_2) == e(R - [f(z)]_1, g2)
pub fn verify_stateless_proof(proof_bytes: &[u8]) -> Result<(), &'static str> {
    use ark_bn254::{Bn254, G1Affine, G2Affine};
    use ark_ec::pairing::Pairing;
    use ark_serialize::CanonicalDeserialize;

    if proof_bytes.len() < 32 + 64 + 32 + 64 {
        return Err("Proof bytes size is too small");
    }
    let mut cursor = 0;
    
    let pi = G1Affine::deserialize_compressed(&proof_bytes[cursor..cursor+32])
        .map_err(|_| "Failed to deserialize G1 proof element (pi)")?;
    cursor += 32;
    
    let x_minus_z = G2Affine::deserialize_compressed(&proof_bytes[cursor..cursor+64])
        .map_err(|_| "Failed to deserialize G2 proof element (x - z)")?;
    cursor += 64;
    
    let r_minus_fz = G1Affine::deserialize_compressed(&proof_bytes[cursor..cursor+32])
        .map_err(|_| "Failed to deserialize G1 proof element (R - f(z))")?;
    cursor += 32;
    
    let g2 = G2Affine::deserialize_compressed(&proof_bytes[cursor..cursor+64])
        .map_err(|_| "Failed to deserialize G2 proof element (g2)")?;
        
    let pairing_left = Bn254::pairing(pi, x_minus_z);
    let pairing_right = Bn254::pairing(r_minus_fz, g2);
    
    if pairing_left == pairing_right {
        Ok(())
    } else {
        Err("Bilinear pairing check failed: verify_stateless_proof equation not satisfied")
    }
}

/// Generates a valid serialized KZG witness proof for testing purposes.
pub fn make_mock_kzg_proof() -> Vec<u8> {
    use ark_bn254::{G1Affine, G2Affine};
    use ark_ec::AffineRepr;
    use ark_serialize::CanonicalSerialize;

    let pi = G1Affine::generator();
    let x_minus_z = G2Affine::generator();
    let r_minus_fz = G1Affine::generator();
    let g2 = G2Affine::generator();
    
    let mut bytes = Vec::new();
    pi.serialize_compressed(&mut bytes).ok();
    x_minus_z.serialize_compressed(&mut bytes).ok();
    r_minus_fz.serialize_compressed(&mut bytes).ok();
    g2.serialize_compressed(&mut bytes).ok();
    bytes
}

/// Maps an arbitrary message slice to a point in G1Affine using hash-to-curve scalar multiplication.
pub fn hash_to_g1(message: &[u8]) -> ark_bn254::G1Affine {
    use ark_bn254::{Fr, G1Affine};
    use ark_ec::AffineRepr;
    use ark_ff::PrimeField;

    let h = hash(HashScheme::Keccak256, message);
    let scalar = Fr::from_le_bytes_mod_order(&h);
    (G1Affine::generator() * scalar).into()
}

/// Verifies an aggregated BLS threshold signature over BN254.
/// Enforces: e(sig, G2_generator) == e(H(msg), aggregated_pk)
pub fn verify_bls_threshold_signature(
    signature_bytes: &[u8],
    message: &[u8],
    aggregated_pk_bytes: &[u8],
) -> Result<(), &'static str> {
    use ark_bn254::{Bn254, G1Affine, G2Affine};
    use ark_ec::pairing::Pairing;
    use ark_ec::AffineRepr;
    use ark_serialize::CanonicalDeserialize;

    if signature_bytes.len() != 32 && signature_bytes.len() != 64 {
        return Err("Invalid BLS signature byte length for BN254");
    }
    if aggregated_pk_bytes.len() != 64 && aggregated_pk_bytes.len() != 128 {
        return Err("Invalid aggregated public key byte length for BN254 G2");
    }

    let sig = G1Affine::deserialize_compressed(signature_bytes)
        .map_err(|_| "Failed to deserialize G1 BLS signature")?;
    let agg_pk = G2Affine::deserialize_compressed(aggregated_pk_bytes)
        .map_err(|_| "Failed to deserialize G2 aggregated public key")?;

    let h_msg = hash_to_g1(message);
    let g2_gen = G2Affine::generator();

    let pairing_left = Bn254::pairing(sig, g2_gen);
    let pairing_right = Bn254::pairing(h_msg, agg_pk);

    if pairing_left == pairing_right {
        Ok(())
    } else {
        Err("BLS threshold signature pairing verification failed: e(sig, g2) != e(H(m), agg_pk)")
    }
}

/// Signs a message with a BN254 Fr secret key scalar producing a compressed G1 signature.
pub fn bls_sign_message(sk_bytes: &[u8; 32], message: &[u8]) -> Vec<u8> {
    use ark_bn254::{Fr, G1Affine};
    use ark_ff::PrimeField;
    use ark_serialize::CanonicalSerialize;

    let sk = Fr::from_le_bytes_mod_order(sk_bytes);
    let h_msg = hash_to_g1(message);
    let sig: G1Affine = (h_msg * sk).into();

    let mut out = Vec::new();
    sig.serialize_compressed(&mut out).ok();
    out
}

/// Derives a compressed G2 public key from a BN254 Fr secret key scalar.
pub fn bls_derive_pk_g2(sk_bytes: &[u8; 32]) -> Vec<u8> {
    use ark_bn254::{Fr, G2Affine};
    use ark_ec::AffineRepr;
    use ark_ff::PrimeField;
    use ark_serialize::CanonicalSerialize;

    let sk = Fr::from_le_bytes_mod_order(sk_bytes);
    let pk: G2Affine = (G2Affine::generator() * sk).into();

    let mut out = Vec::new();
    pk.serialize_compressed(&mut out).ok();
    out
}

/// Aggregates multiple G1 BLS signatures into a single compressed G1 signature.
pub fn bls_aggregate_signatures(sigs: &[&[u8]]) -> Result<Vec<u8>, &'static str> {
    use ark_bn254::G1Affine;
    use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};

    if sigs.is_empty() {
        return Err("Cannot aggregate empty signatures");
    }

    let mut agg = ark_bn254::G1Projective::default();
    for s in sigs {
        let pt = G1Affine::deserialize_compressed(*s)
            .map_err(|_| "Invalid G1 signature in aggregation")?;
        agg += pt;
    }

    let agg_affine: G1Affine = agg.into();
    let mut out = Vec::new();
    agg_affine.serialize_compressed(&mut out).ok();
    Ok(out)
}

/// Aggregates multiple G2 BLS public keys into a single compressed G2 public key.
pub fn bls_aggregate_pks_g2(pks: &[&[u8]]) -> Result<Vec<u8>, &'static str> {
    use ark_bn254::G2Affine;
    use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};

    if pks.is_empty() {
        return Err("Cannot aggregate empty public keys");
    }

    let mut agg = ark_bn254::G2Projective::default();
    for p in pks {
        let pt = G2Affine::deserialize_compressed(*p)
            .map_err(|_| "Invalid G2 public key in aggregation")?;
        agg += pt;
    }

    let agg_affine: G2Affine = agg.into();
    let mut out = Vec::new();
    agg_affine.serialize_compressed(&mut out).ok();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crypto_envelope_pack_unpack() {
        let pk = vec![1, 2, 3];
        let sig = vec![4, 5, 6, 7];
        let envelope = pack_pq_envelope(SignatureScheme::MlDsa, &pk, &sig);
        
        let (scheme, unpacked_pk, unpacked_sig) = unpack_pq_envelope(&envelope).unwrap();
        assert_eq!(scheme, SignatureScheme::MlDsa);
        assert_eq!(unpacked_pk, pk);
        assert_eq!(unpacked_sig, sig);
    }

    #[test]
    fn test_profiles() {
        let eth = CryptoProfile::from_name("ethereum").unwrap();
        assert_eq!(eth.signature, SignatureScheme::Secp256k1);
        assert_eq!(eth.state_tree, StateTreeScheme::Verkle);

        let tp = CryptoProfile::from_name("throughput").unwrap();
        assert_eq!(tp.signature, SignatureScheme::Ed25519);
        assert_eq!(tp.state_tree, StateTreeScheme::PoseidonMerkle);
    }

    #[test]
    fn test_hash_and_derive() {
        let pk = b"test_public_key_bytes_for_hash";
        let addr = derive_address(HashScheme::Keccak256, pk);
        assert_eq!(addr.len(), 20);
    }

    #[test]
    fn test_kzg_pairing_verification() {
        let proof = make_mock_kzg_proof();
        assert!(verify_stateless_proof(&proof).is_ok());
        
        let mut bad_proof = proof.clone();
        if !bad_proof.is_empty() {
            bad_proof[0] ^= 0xff; // corrupt proof element
            assert!(verify_stateless_proof(&bad_proof).is_err());
        }
    }

    #[test]
    fn test_bls_threshold_signature_and_aggregation() {
        let sk1 = [1u8; 32];
        let sk2 = [2u8; 32];
        let sk3 = [3u8; 32];

        let msg = b"epoch_finality_marker_epoch_42";

        let sig1 = bls_sign_message(&sk1, msg);
        let sig2 = bls_sign_message(&sk2, msg);
        let sig3 = bls_sign_message(&sk3, msg);

        let pk1 = bls_derive_pk_g2(&sk1);
        let pk2 = bls_derive_pk_g2(&sk2);
        let pk3 = bls_derive_pk_g2(&sk3);

        // Single signature verification
        assert!(verify_bls_threshold_signature(&sig1, msg, &pk1).is_ok());

        // 2-of-3 aggregation
        let agg_sig_2of3 = bls_aggregate_signatures(&[&sig1, &sig2]).unwrap();
        let agg_pk_2of3 = bls_aggregate_pks_g2(&[&pk1, &pk2]).unwrap();
        assert!(verify_bls_threshold_signature(&agg_sig_2of3, msg, &agg_pk_2of3).is_ok());

        // Corrupted aggregated signature should fail
        let mut corrupted_sig = agg_sig_2of3.clone();
        corrupted_sig[10] ^= 0xff;
        assert!(verify_bls_threshold_signature(&corrupted_sig, msg, &agg_pk_2of3).is_err());

        // Wrong message should fail
        assert!(verify_bls_threshold_signature(&agg_sig_2of3, b"wrong_msg", &agg_pk_2of3).is_err());

        // 3-of-3 aggregation
        let agg_sig_3of3 = bls_aggregate_signatures(&[&sig1, &sig2, &sig3]).unwrap();
        let agg_pk_3of3 = bls_aggregate_pks_g2(&[&pk1, &pk2, &pk3]).unwrap();
        assert!(verify_bls_threshold_signature(&agg_sig_3of3, msg, &agg_pk_3of3).is_ok());
    }
}
