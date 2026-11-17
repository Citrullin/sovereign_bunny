//! # Phase 25: Door/Pool Decoupled Data Plane & O(1) Commitments
//!
//! Inspired by dCache architecture (Control Plane / Door vs Autonomous Data Pool),
//! this module implements O(1) ledger footprints for multi-terabyte data transfers.
//! The ledger commits a 32-byte BLAKE3 tree root; Iroh peers stream and verify Bao chunks.

use alloy_primitives::{Address, B256, Bytes};
use serde::{Deserialize, Serialize};

/// High-throughput content reference embedded in blind note payloads.
/// Carries O(1) state representation for petabyte-scale data payloads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataRef {
    /// 32-byte BLAKE3 tree root hash matching the on-chain Slot 1 commitment
    pub blake3_root: B256,
    /// Total content size in bytes
    pub size_bytes: u64,
    /// Optional seed Iroh node ID (Ed25519 32-byte pubkey) for initial chunk location
    pub seed_node: Option<[u8; 32]>,
    /// Content namespace string for Zanzibar Door access control evaluation
    pub namespace: String,
    /// Number of epochs this content is lease-pinned on data pools
    pub pin_lease_epochs: u64,
}

impl DataRef {
    /// Creates a new DataRef with verified parameters.
    #[must_use]
    pub fn new(
        blake3_root: B256,
        size_bytes: u64,
        seed_node: Option<[u8; 32]>,
        namespace: String,
        pin_lease_epochs: u64,
    ) -> Self {
        Self {
            blake3_root,
            size_bytes,
            seed_node,
            namespace,
            pin_lease_epochs,
        }
    }
}

/// Single-use bearer ticket issued by the control plane (Door) authorizing a client
/// to read chunks directly from an autonomous data pool without per-chunk ledger round-trips.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadTicket {
    /// Target content BLAKE3 root
    pub blake3_root: B256,
    /// Authorized reader account address
    pub reader: Address,
    /// Epoch height until which this ticket is valid
    pub valid_until_epoch: u64,
    /// Single-use nonce preventing ticket replay
    pub nonce: u64,
    /// Signature or authorization witness from the namespace owner or Door
    pub authorization_proof: Bytes,
}

impl ReadTicket {
    /// Checks if the read ticket is unexpired at the target epoch.
    #[must_use]
    pub fn is_valid_at_epoch(&self, epoch: u64) -> bool {
        epoch <= self.valid_until_epoch
    }
}

/// Third-Party Copy (TPC) request allowing two autonomous storage pools to transfer
/// bulk data directly between each other without routing bytes through the client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TpcRequest {
    /// Content BLAKE3 root to replicate
    pub blake3_root: B256,
    /// Source data pool Iroh peer ID
    pub source_pool: [u8; 32],
    /// Destination data pool Iroh peer ID
    pub dest_pool: [u8; 32],
    /// Zanzibar authorization token signed by content owner
    pub owner_auth_token: Bytes,
    /// Lease duration in epochs granted to the destination pool
    pub pin_lease_epochs: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_data_ref_and_read_ticket_lifecycle() {
        let root = B256::repeat_byte(0x33);
        let dref = DataRef::new(
            root,
            10_000_000_000, // 10 GB
            Some([0x11; 32]),
            "scientific_data/cern_experiment_01".to_string(),
            50,
        );
        assert_eq!(dref.size_bytes, 10_000_000_000);
        assert_eq!(dref.namespace, "scientific_data/cern_experiment_01");

        let ticket = ReadTicket {
            blake3_root: root,
            reader: Address::repeat_byte(0x55),
            valid_until_epoch: 120,
            nonce: 1,
            authorization_proof: Bytes::from(vec![1, 2, 3, 4]),
        };
        assert!(ticket.is_valid_at_epoch(100));
        assert!(!ticket.is_valid_at_epoch(121));
    }
}
