//! # In-Note Relayer & Gas Abstraction
//!
//! Models decentralized relayers subsidizing or relaying blind notes on behalf of accounts.
//! Replaces legacy centralized paymaster tables with in-note gas commitments.

use alloy_primitives::{Address, B256, Bytes, U256};
use serde::{Deserialize, Serialize};

/// An envelope wrapping a blind note with relayer sponsorship and gas parameters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RelayerEnvelope {
    /// Relayer account address submitting the transaction
    pub relayer_address: Address,
    /// Target note commitment hash being subsidized
    pub note_commitment: B256,
    /// Maximum gas fee the in-note payment slot authorizes the relayer to claim
    pub max_fee: U256,
    /// Relayer signature authenticating submission
    pub relayer_signature: Bytes,
    /// Epoch of validity for relay submission
    pub valid_until_epoch: u64,
}

impl RelayerEnvelope {
    /// Creates a new RelayerEnvelope.
    #[must_use]
    pub fn new(
        relayer_address: Address,
        note_commitment: B256,
        max_fee: U256,
        relayer_signature: Bytes,
        valid_until_epoch: u64,
    ) -> Self {
        Self {
            relayer_address,
            note_commitment,
            max_fee,
            relayer_signature,
            valid_until_epoch,
        }
    }

    /// Verifies if the relayer envelope is unexpired at the current epoch.
    #[must_use]
    pub fn is_valid_at_epoch(&self, current_epoch: u64) -> bool {
        current_epoch <= self.valid_until_epoch
    }
}

/// A registered relayer in the permissionless relayer network.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RelayerNode {
    /// Relayer's account address (receives fee credits upon successful note absorption)
    pub address: Address,
    /// Minimum relayer fee (in native wei-equivalent) required to service an absorption
    pub min_fee_threshold: U256,
    /// Optional Iroh peer ID for direct P2P note subscription & hole punching
    pub iroh_peer_id: Option<[u8; 32]>,
}

impl RelayerNode {
    /// Creates a new RelayerNode definition.
    #[must_use]
    pub fn new(address: Address, min_fee_threshold: U256, iroh_peer_id: Option<[u8; 32]>) -> Self {
        Self {
            address,
            min_fee_threshold,
            iroh_peer_id,
        }
    }
}

/// Fee settlement record committed to the epoch checkpoint when a relayer-assisted
/// absorption is finalized.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RelayerFeeRecord {
    /// Nullifier consumed by the absorbed note
    pub note_nullifier: B256,
    /// Relayer address that was credited
    pub relayer_address: Address,
    /// Exact fee amount paid to the relayer
    pub fee_amount: U256,
    /// Epoch in which the absorption was recorded
    pub epoch: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_relayer_node_and_fee_record_lifecycle() {
        let node = RelayerNode::new(
            Address::repeat_byte(0xaa),
            U256::from(50_000u64),
            Some([0x42; 32]),
        );
        assert_eq!(node.min_fee_threshold, U256::from(50_000u64));

        let record = RelayerFeeRecord {
            note_nullifier: B256::repeat_byte(0x99),
            relayer_address: node.address,
            fee_amount: U256::from(50_000u64),
            epoch: 42,
        };
        assert_eq!(record.epoch, 42);
        assert_eq!(record.relayer_address, Address::repeat_byte(0xaa));
    }
}
