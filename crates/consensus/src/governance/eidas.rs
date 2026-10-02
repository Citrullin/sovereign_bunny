//! # eIDAS 2.0 ZK-Wrapped Verifiable Credentials
//!
//! Provides data types and verification bindings for eIDAS 2.0 SD-JWT-VC credentials
//! anchored against the EU List of Trusted Lists (LOTL) Merkle root in Slot 8.
//! Bridges QSCD hardware keys (Secp256r1) with zero-knowledge predicate proofs.

use alloy_primitives::{B256, Bytes};
use serde::{Deserialize, Serialize};

/// LOTL Merkle root anchored in Slot 8 of the governance account (eu.eidas.lotl).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LotlMerkleRoot {
    /// BLAKE3 Merkle root of all active QTSP X.509 certificate fingerprints
    pub root: B256,
    /// Epoch at which this root was last updated
    pub updated_epoch: u64,
    /// Schema version of the LOTL snapshot (EC publication version number)
    pub lotl_version: u32,
}

impl LotlMerkleRoot {
    /// Creates a new LotlMerkleRoot.
    #[must_use]
    pub fn new(root: B256, updated_epoch: u64, lotl_version: u32) -> Self {
        Self {
            root,
            updated_epoch,
            lotl_version,
        }
    }
}

/// Inclusion proof demonstrating that a QTSP certificate fingerprint is anchored in the LOTL root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QtspInclusionProof {
    /// SHA-256 fingerprint of the QTSP root certificate
    pub cert_fingerprint: [u8; 32],
    /// Merkle siblings for inclusion proof
    pub merkle_path: Vec<B256>,
    /// Leaf index in the LOTL Merkle tree
    pub leaf_index: u64,
}

/// QSCD hardware key binding record stored in DID Slot 0.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QscdBinding {
    /// Secp256r1 public key backed by the hardware QSCD (compressed 33-byte point)
    pub public_key: Bytes,
    /// Optional hardware device attestation (from device manufacturer CA or SGX)
    pub device_attestation: Option<Vec<u8>>,
    /// Whether this key is the active Qualified Electronic Signature (QES) key
    pub is_active_qes_key: bool,
}

/// Identifies an eIDAS predicate being proven in zero-knowledge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum EidasPredicateId {
    /// Country code belongs to EU member state
    EuResident = 0x01,
    /// Age >= 18 without revealing exact date of birth
    Over18 = 0x02,
    /// AML / KYC attribute present and signed by QTSP
    KycPassed = 0x03,
    /// Legal entity registration present (e.g. VAT / EORI)
    LegalEntity = 0x04,
    /// Issuer is authorized for QES issuance
    QesCapable = 0x05,
}

/// A zero-knowledge predicate proof over an eIDAS SD-JWT-VC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EidasPredicateProof {
    /// Predicate demonstrated by this proof
    pub predicate_id: EidasPredicateId,
    /// LOTL root hash against which the QTSP was proven
    pub lotl_root: B256,
    /// Per-request challenge nonce from relying party
    pub challenge_nonce: B256,
    /// Presenter's Secp256r1 QSCD public key
    pub account_pubkey: Bytes,
    /// Noir UltraHonk / Groth16 proof bytes
    pub proof_bytes: Bytes,
}

impl EidasPredicateProof {
    /// Verifies that the proof references the expected LOTL root and nonce.
    #[must_use]
    pub fn verify_context(&self, expected_lotl_root: B256, expected_nonce: B256) -> bool {
        self.lotl_root == expected_lotl_root && self.challenge_nonce == expected_nonce
    }
}
