//! # Sparse Merkle Tree for Nullifiers
//!
//! Provides fast, cryptographic nullifier double-spend prevention and verifiable inclusion/exclusion.
//! Maintains an append-only set of spent nullifiers and tracks historical epoch-scoped nullifier roots.

use alloy_primitives::B256;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Sparse Merkle Tree representation for consumed nullifiers.
///
/// # Phase 1 Implementation Note (MED-NEW-01)
///
/// The current implementation uses an in-memory `HashSet` for O(1) double-spend
/// prevention and a rolling BLAKE3 accumulator for the `current_root`. This provides
/// correct and cryptographically-sound double-spend prevention for Phase 1.
///
/// **What this is NOT**: A real sparse Merkle tree with Merkle proof paths.
/// The `current_root` is a rolling accumulator hash (`H(prev_root || nullifier)`),
/// not a Merkle root that can be used to generate inclusion/exclusion proofs
/// without replaying the full nullifier log.
///
/// **Phase 2 upgrade path**: Replace with `jellyfish-merkle` (Apache license,
/// Aptos-proven) to enable verifiable inclusion/exclusion proofs for ZK-Compliance
/// circuits and cross-chain nullifier verification.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NullifierSmt {
    /// In-memory spent nullifier set
    nullifiers: HashSet<B256>,
    /// Historical SMT roots recorded per epoch boundary
    epoch_roots: HashMap<u64, B256>,
    /// Current cached root
    current_root: B256,
}

impl NullifierSmt {
    /// Creates a new empty Nullifier SMT.
    #[must_use]
    pub fn new() -> Self {
        Self {
            nullifiers: HashSet::new(),
            epoch_roots: HashMap::new(),
            current_root: B256::ZERO,
        }
    }

    /// Checks if a nullifier has already been spent.
    #[must_use]
    pub fn contains(&self, nullifier: &B256) -> bool {
        self.nullifiers.contains(nullifier)
    }

    /// Marks a nullifier as spent and recomputes the active accumulator root.
    ///
    /// # Errors
    /// Returns an error if the nullifier was already consumed (double-spend).
    pub fn insert(&mut self, nullifier: B256) -> Result<B256, &'static str> {
        if self.nullifiers.contains(&nullifier) {
            return Err("Nullifier has already been consumed (double-spend rejected)");
        }
        self.nullifiers.insert(nullifier);

        // Update root by rolling accumulator hash
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"sovereign:nullifier_smt:v1:");
        hasher.update(self.current_root.as_slice());
        hasher.update(nullifier.as_slice());
        self.current_root = B256::from_slice(hasher.finalize().as_bytes());

        Ok(self.current_root)
    }

    /// Records the finalized SMT root for the completed epoch.
    pub fn checkpoint_epoch(&mut self, epoch_id: u64) -> B256 {
        self.epoch_roots.insert(epoch_id, self.current_root);
        self.current_root
    }

    /// Returns the current SMT root hash.
    #[must_use]
    pub fn root(&self) -> B256 {
        self.current_root
    }

    /// Returns the historical root for an epoch if recorded.
    #[must_use]
    pub fn get_epoch_root(&self, epoch_id: u64) -> Option<B256> {
        self.epoch_roots.get(&epoch_id).copied()
    }

    /// Total count of consumed nullifiers.
    #[must_use]
    pub fn len(&self) -> usize {
        self.nullifiers.len()
    }

    /// Returns true if no nullifiers have been consumed yet.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.nullifiers.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nullifier_smt_double_spend() {
        let mut smt = NullifierSmt::new();
        let n1 = B256::repeat_byte(0x11);
        let n2 = B256::repeat_byte(0x22);

        assert!(smt.insert(n1).is_ok());
        assert!(smt.contains(&n1));
        assert!(!smt.contains(&n2));

        // Double spend rejected
        let res = smt.insert(n1);
        assert!(res.is_err(), "Duplicate nullifier must be rejected");

        // Different nullifier accepted
        assert!(smt.insert(n2).is_ok());
        assert_eq!(smt.len(), 2);
    }

    #[test]
    fn test_nullifier_smt_checkpoint() {
        let mut smt = NullifierSmt::new();
        let n = B256::repeat_byte(0x33);
        let r1 = smt.insert(n).unwrap();
        let cp = smt.checkpoint_epoch(5);
        assert_eq!(r1, cp);
        assert_eq!(smt.get_epoch_root(5), Some(r1));
        assert_eq!(smt.get_epoch_root(6), None);
    }
}
