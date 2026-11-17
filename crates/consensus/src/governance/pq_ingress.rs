//! # Post-Quantum Wire Stripping & ZK Witness Compression
//!
//! Enforces that raw post-quantum signatures (ML-DSA, Falcon, SLH-DSA) never appear on-ledger.
//! All post-quantum accounts submit a [`PqWitnessEnvelope`] containing a succinct ZK proof
//! (~200 bytes) verifying knowledge of the PQ signature off-chain.

use alloy_primitives::{B256, Bytes};
use serde::{Deserialize, Serialize};

/// Supported post-quantum schemes compressed via ZK proofs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PqScheme {
    /// CRYSTALS-Dilithium / ML-DSA (FIPS 204)
    MlDsa,
    /// Falcon lattice-based signatures
    Falcon,
    /// SPHINCS+ / SLH-DSA (FIPS 205)
    SlhDsa,
}

/// A succinct on-chain envelope representing a ZK proof of a valid Post-Quantum signature.
/// Replaces raw 2.4KB - 40KB PQ signatures with a uniform ~200B UltraHonk / Groth16 witness proof.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PqWitnessEnvelope {
    /// Specific PQ scheme being proven
    pub scheme: PqScheme,
    /// ~200-byte succinct ZK proof verifying that a valid PQ signature over `user_op_or_commitment` exists
    pub zk_proof: Bytes,
    /// 32-byte cryptographic hash of the account's registered PQ public key (e.g. blake3(ml_dsa_pubkey))
    pub account_pubkey_hash: B256,
    /// Target note commitment or transaction hash being authorized
    pub commitment: B256,
    /// Epoch of validity (enforcing issuance_epoch ± 1 replay protection, S-01)
    pub epoch: u64,
}

impl PqWitnessEnvelope {
    /// Creates a new PqWitnessEnvelope.
    #[must_use]
    pub fn new(
        scheme: PqScheme,
        zk_proof: Bytes,
        account_pubkey_hash: B256,
        commitment: B256,
        epoch: u64,
    ) -> Self {
        Self {
            scheme,
            zk_proof,
            account_pubkey_hash,
            commitment,
            epoch,
        }
    }

    /// Verifies the envelope's epoch freshness against current consensus epoch (S-01).
    #[must_use]
    pub fn is_epoch_valid(&self, current_epoch: u64) -> bool {
        let min_epoch = self.epoch.saturating_sub(1);
        let max_epoch = self.epoch.saturating_add(1);
        current_epoch >= min_epoch && current_epoch <= max_epoch
    }
}

/// Evaluates whether a raw transaction or signature must be rejected due to PQ wire-stripping enforcement (S-03).
#[must_use]
pub fn should_reject_raw_pq_sig(is_enforcement_epoch_active: bool, signature_len: usize) -> bool {
    // If enforcement is active and signature length exceeds standard classical threshold (e.g. > 130 bytes),
    // raw PQ signatures are rejected at ingress.
    is_enforcement_epoch_active && signature_len > 130
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pq_witness_envelope_epoch_window() {
        let env = PqWitnessEnvelope::new(
            PqScheme::MlDsa,
            Bytes::from(vec![0x42; 200]),
            B256::repeat_byte(0xaa),
            B256::repeat_byte(0xbb),
            10,
        );

        assert!(env.is_epoch_valid(9), "Epoch 9 should be within window of 10");
        assert!(env.is_epoch_valid(10), "Epoch 10 should be valid");
        assert!(env.is_epoch_valid(11), "Epoch 11 should be within window of 10");
        assert!(!env.is_epoch_valid(8), "Epoch 8 should be rejected (S-01)");
        assert!(!env.is_epoch_valid(12), "Epoch 12 should be rejected (S-01)");
    }

    #[test]
    fn test_pq_wire_stripping_enforcement() {
        assert!(!should_reject_raw_pq_sig(false, 2420));
        assert!(should_reject_raw_pq_sig(true, 2420), "Raw 2420B ML-DSA must be rejected in enforcement epoch (S-03)");
        assert!(!should_reject_raw_pq_sig(true, 65), "Classical 65B signature is not rejected as raw PQ");
    }
}
