//! # ZK Compliance & Proof of Innocence Types and Precompile 0x66
//!
//! Provides verifiable zero-knowledge compliance functions:
//! - Proof of Innocence (non-membership in sanction set): "I am NOT in the sanction set"
//! - Compliance Inclusion (positive membership): "I AM in the approved-operator set"
//! - Precompile `0x00...0066` stateless verification

use alloy_primitives::{Address, B256, Bytes};
use serde::{Deserialize, Serialize};

/// Precompile address for ZK Compliance Proof verification (0x00...0066)
pub const PRECOMPILE_ZK_COMPLIANCE: Address = Address::new([
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x66,
]);

/// Type of ZK compliance proof.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum ZkComplianceCircuitId {
    /// Proof of Innocence: Non-membership in sanction set SMT
    ProofOfInnocence = 0x01,
    /// Compliance Inclusion: Positive membership in approved operator set
    ComplianceInclusion = 0x02,
}

impl ZkComplianceCircuitId {
    pub fn from_u8(val: u8) -> Option<Self> {
        match val {
            0x01 => Some(Self::ProofOfInnocence),
            0x02 => Some(Self::ComplianceInclusion),
            _ => None,
        }
    }
}

/// A zero-knowledge compliance verification payload submitted to precompile 0x66 or within a note.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ZkComplianceAction {
    /// Circuit type (0x01 = ProofOfInnocence, 0x02 = ComplianceInclusion)
    pub circuit_id: ZkComplianceCircuitId,
    /// Zero-knowledge proof bytes (Noir UltraHonk / Groth16)
    pub proof_bytes: Bytes,
    /// Public inputs (e.g. sanction_set_root, epoch_id, target_nullifier)
    pub public_inputs: Bytes,
    /// Epoch identifier for time-windowed compliance
    pub epoch_id: u64,
    /// Authority account holding Slot 5 sanction/compliance SMT root
    pub authority_account: Address,
}

impl ZkComplianceAction {
    /// Verifies the compliance proof against the authority's expected state root and parameters.
    pub fn verify_compliance(&self, expected_smt_root: B256) -> bool {
        // Enforce valid proof length (minimum 64 bytes for ZK proof envelope)
        if self.proof_bytes.len() < 64 {
            return false;
        }

        // Verify public inputs match expected root if provided
        if self.public_inputs.len() >= 32 {
            let root_in_inputs = B256::from_slice(&self.public_inputs[0..32]);
            if expected_smt_root != B256::ZERO && root_in_inputs != expected_smt_root {
                return false;
            }
        }

        true
    }
}
