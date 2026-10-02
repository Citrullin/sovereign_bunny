//! # Per-Jurisdiction Sanction Set SMT Root (Slot 5)
//!
//! Models per-jurisdiction regulatory sanction sets and approved operator lists
//! anchored into Slot 5 of regulatory authorities' CAR accounts.

use alloy_primitives::{Address, B256};
use serde::{Deserialize, Serialize};

/// Sanction set root anchored in Slot 5 of an authority's CAR account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SanctionSet {
    /// Domain-separating manifold ID
    pub manifold_id: u64,
    /// Authority owning and updating this sanction set
    pub authority: Address,
    /// Sparse Merkle Tree (SMT) root of sanctioned addresses/nullifiers
    pub smt_root: B256,
    /// Epoch of last SMT root publication or revocation cut
    pub epoch_updated: u64,
}

impl SanctionSet {
    /// Creates a new SanctionSet anchor descriptor.
    #[must_use]
    pub fn new(manifold_id: u64, authority: Address, smt_root: B256, epoch_updated: u64) -> Self {
        Self {
            manifold_id,
            authority,
            smt_root,
            epoch_updated,
        }
    }

    /// Computes the deterministic commitment for Slot 5 storage.
    #[must_use]
    pub fn compute_slot5_commitment(&self) -> B256 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"sovereign:sanction_set:slot5:v1:");
        hasher.update(&self.manifold_id.to_le_bytes());
        hasher.update(self.authority.as_slice());
        hasher.update(self.smt_root.as_slice());
        hasher.update(&self.epoch_updated.to_le_bytes());
        B256::from_slice(hasher.finalize().as_bytes())
    }
}
