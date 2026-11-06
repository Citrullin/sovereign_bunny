//! # Order-Independent 256-Level Sparse Merkle Tree (SMT) for Nullifiers
//!
//! Provides fast, cryptographic, **order-independent** nullifier double-spend prevention
//! and verifiable 256-level inclusion and non-membership (exclusion) Merkle proofs (`M-10`, `I-28`).
//! Maintains a canonical set of spent nullifiers and tracks historical epoch-scoped SMT roots.

use alloy_primitives::B256;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

/// 256-level Sparse Merkle proof for a nullifier key (supporting both inclusion and non-membership).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NullifierSmtProof {
    /// The queried 256-bit nullifier key.
    pub nullifier: B256,
    /// True if the nullifier is present (spent) in the tree; false for a non-membership proof.
    pub is_included: bool,
    /// Sparse sibling hashes along the 256-bit path `(depth, sibling_hash)` for non-empty subtrees.
    pub non_zero_siblings: Vec<(u8, B256)>,
}

/// Order-independent Sparse Merkle Tree for consumed nullifiers.
///
/// Unlike a rolling hash (`H(prev_root || nullifier)`), `NullifierSmt` computes its root over
/// a canonical 256-level binary Radix/Sparse Merkle Tree keyed by the 256 bits of each nullifier.
/// Inserting `{n1, n2}` and `{n2, n1}` produces the exact same `current_root`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NullifierSmt {
    /// Canonical ordered set of spent nullifiers
    nullifiers: BTreeSet<B256>,
    /// Historical SMT roots recorded per epoch boundary
    epoch_roots: HashMap<u64, B256>,
    /// Current cached order-independent 256-level SMT root
    current_root: B256,
    /// Cleared-epoch bound: any absorb/claim operation before this epoch is rejected
    #[serde(default)]
    cleared_before_epoch: u64,
}

fn bit_at(key: &B256, depth: u8) -> bool {
    let byte_idx = (depth / 8) as usize;
    let bit_idx = 7 - (depth % 8);
    ((key.as_slice()[byte_idx] >> bit_idx) & 1) == 1
}

fn hash_leaf(nullifier: &B256) -> B256 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"sovereign:nullifier_smt:leaf:v2:");
    hasher.update(nullifier.as_slice());
    B256::from_slice(hasher.finalize().as_bytes())
}

fn hash_internal(depth: u8, left: &B256, right: &B256) -> B256 {
    if *left == B256::ZERO && *right == B256::ZERO {
        return B256::ZERO;
    }
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"sovereign:nullifier_smt:node:v2:");
    hasher.update(&[depth]);
    hasher.update(left.as_slice());
    hasher.update(right.as_slice());
    B256::from_slice(hasher.finalize().as_bytes())
}

fn compute_subtree_root(keys: &[B256], depth: u16) -> B256 {
    if keys.is_empty() {
        return B256::ZERO;
    }
    if depth == 256 {
        return hash_leaf(&keys[0]);
    }
    let d = depth as u8;
    let split_idx = keys.partition_point(|k| !bit_at(k, d));
    let left_root = compute_subtree_root(&keys[..split_idx], depth + 1);
    let right_root = compute_subtree_root(&keys[split_idx..], depth + 1);
    hash_internal(d, &left_root, &right_root)
}

fn build_proof_recursive(
    keys: &[B256],
    target: &B256,
    depth: u16,
    siblings: &mut Vec<(u8, B256)>,
) {
    if depth == 256 || keys.is_empty() {
        return;
    }
    let d = depth as u8;
    let split_idx = keys.partition_point(|k| !bit_at(k, d));
    let (left_keys, right_keys) = keys.split_at(split_idx);

    if !bit_at(target, d) {
        let sibling_root = compute_subtree_root(right_keys, depth + 1);
        if sibling_root != B256::ZERO {
            siblings.push((d, sibling_root));
        }
        build_proof_recursive(left_keys, target, depth + 1, siblings);
    } else {
        let sibling_root = compute_subtree_root(left_keys, depth + 1);
        if sibling_root != B256::ZERO {
            siblings.push((d, sibling_root));
        }
        build_proof_recursive(right_keys, target, depth + 1, siblings);
    }
}

impl NullifierSmt {
    /// Creates a new empty Nullifier SMT.
    #[must_use]
    pub fn new() -> Self {
        Self {
            nullifiers: BTreeSet::new(),
            epoch_roots: HashMap::new(),
            current_root: B256::ZERO,
            cleared_before_epoch: 0,
        }
    }

    /// Sets the cleared-epoch bound, pruning historical epoch roots strictly older than `cleared_epoch`.
    pub fn set_cleared_before_epoch(&mut self, cleared_epoch: u64) {
        self.cleared_before_epoch = cleared_epoch;
        self.epoch_roots.retain(|epoch, _| *epoch >= cleared_epoch);
    }

    /// Returns the current cleared-epoch bound.
    #[must_use]
    pub fn cleared_before_epoch(&self) -> u64 {
        self.cleared_before_epoch
    }

    /// Checks if a nullifier has already been spent.
    #[must_use]
    pub fn contains(&self, nullifier: &B256) -> bool {
        self.nullifiers.contains(nullifier)
    }

    /// Marks a nullifier as spent and recomputes the order-independent 256-level SMT root.
    ///
    /// # Errors
    /// Returns an error if the nullifier was already consumed (double-spend).
    pub fn insert(&mut self, nullifier: B256) -> Result<B256, &'static str> {
        if self.nullifiers.contains(&nullifier) {
            return Err("Nullifier has already been consumed (double-spend rejected)");
        }
        self.nullifiers.insert(nullifier);
        let sorted_keys: Vec<B256> = self.nullifiers.iter().copied().collect();
        self.current_root = compute_subtree_root(&sorted_keys, 0);
        Ok(self.current_root)
    }

    /// Generates a verifiable 256-level Sparse Merkle proof of inclusion or non-membership.
    #[must_use]
    pub fn generate_proof(&self, nullifier: B256) -> NullifierSmtProof {
        let is_included = self.nullifiers.contains(&nullifier);
        let sorted_keys: Vec<B256> = self.nullifiers.iter().copied().collect();
        let mut non_zero_siblings = Vec::new();
        build_proof_recursive(&sorted_keys, &nullifier, 0, &mut non_zero_siblings);
        NullifierSmtProof {
            nullifier,
            is_included,
            non_zero_siblings,
        }
    }

    /// Verifies an inclusion or non-membership proof against an expected 256-level SMT root.
    #[must_use]
    pub fn verify_proof(root: B256, proof: &NullifierSmtProof) -> bool {
        let mut sibling_map = HashMap::new();
        for &(depth, sib) in &proof.non_zero_siblings {
            sibling_map.insert(depth, sib);
        }

        let mut curr = if proof.is_included {
            hash_leaf(&proof.nullifier)
        } else {
            B256::ZERO
        };

        for depth in (0u16..256).rev() {
            let d = depth as u8;
            let sibling = sibling_map.get(&d).copied().unwrap_or(B256::ZERO);
            curr = if !bit_at(&proof.nullifier, d) {
                hash_internal(d, &curr, &sibling)
            } else {
                hash_internal(d, &sibling, &curr)
            };
        }

        curr == root
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
    fn test_nullifier_smt_double_spend_and_order_independence() {
        let mut smt_a = NullifierSmt::new();
        let mut smt_b = NullifierSmt::new();
        let n1 = B256::repeat_byte(0x11);
        let n2 = B256::repeat_byte(0x22);
        let n3 = B256::repeat_byte(0xa5);

        assert!(smt_a.insert(n1).is_ok());
        assert!(smt_a.contains(&n1));
        assert!(!smt_a.contains(&n2));

        // Double spend rejected
        let res = smt_a.insert(n1);
        assert!(res.is_err(), "Duplicate nullifier must be rejected");

        // Different nullifiers accepted
        assert!(smt_a.insert(n2).is_ok());
        assert!(smt_a.insert(n3).is_ok());
        assert_eq!(smt_a.len(), 3);

        // Insert in reverse order into smt_b -> root MUST be identical (order-independent)
        smt_b.insert(n3).unwrap();
        smt_b.insert(n1).unwrap();
        smt_b.insert(n2).unwrap();
        assert_eq!(smt_a.root(), smt_b.root(), "SMT root must be strictly order-independent");

        // Verify inclusion proof for n2 and non-membership proof for unspent n4
        let inc_proof = smt_a.generate_proof(n2);
        assert!(inc_proof.is_included);
        assert!(NullifierSmt::verify_proof(smt_a.root(), &inc_proof));

        let n4 = B256::repeat_byte(0xfe);
        let exc_proof = smt_a.generate_proof(n4);
        assert!(!exc_proof.is_included);
        assert!(NullifierSmt::verify_proof(smt_a.root(), &exc_proof));
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

    #[test]
    fn test_nullifier_smt_cleared_epoch_bound() {
        let mut smt = NullifierSmt::new();
        let n1 = B256::repeat_byte(0x44);
        let n2 = B256::repeat_byte(0x55);
        let r1 = smt.insert(n1).unwrap();
        smt.checkpoint_epoch(10);
        let r2 = smt.insert(n2).unwrap();
        smt.checkpoint_epoch(20);

        assert_eq!(smt.get_epoch_root(10), Some(r1));
        assert_eq!(smt.get_epoch_root(20), Some(r2));
        assert_eq!(smt.cleared_before_epoch(), 0);

        // Advance cleared_before_epoch to 15
        smt.set_cleared_before_epoch(15);
        assert_eq!(smt.cleared_before_epoch(), 15);
        // Epoch 10 pruned, Epoch 20 retained
        assert_eq!(smt.get_epoch_root(10), None);
        assert_eq!(smt.get_epoch_root(20), Some(r2));
    }
}
