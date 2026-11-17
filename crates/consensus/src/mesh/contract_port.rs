//! # Cross-Manifold Smart Contract Porting & Shadow Contracts
//!
//! Enables smart contracts to be portably migrated across manifold boundaries via
//! blind notes, or referenced across manifolds via shadow proxies.

use alloy_primitives::{Address, B256, Bytes};
use serde::{Deserialize, Serialize};

/// Contract bytecode representation (inline or content-addressed via Iroh).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContractBytecode {
    /// Inline bytecode (<= 128 KB)
    Inline(Bytes),
    /// Content-addressed via Iroh (Bao-verified hash and size)
    IrohCid { hash: B256, size_bytes: u64 },
}

/// Authorization and state payload to port a smart contract across manifold boundaries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContractPortingPayload {
    /// Source manifold ID
    pub source_manifold_id: u64,
    /// Originating contract address on the source manifold
    pub contract_address: Address,
    /// Full bytecode or Iroh CID
    pub bytecode: ContractBytecode,
    /// Current state storage root
    pub state_root: B256,
    /// Verkle inclusion proof for state root
    pub state_inclusion_proof: Bytes,
    /// Creator's Zanzibar authorization proof (owner relation)
    pub creator_auth_proof: Bytes,
    /// Flag indicating if the contract declared itself portable
    pub portability_flag: bool,
    /// Destination manifold ID
    pub destination_manifold_id: u64,
}

/// Shadow contract: a manifold-local proxy backed by cross-manifold state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShadowContract {
    /// Local proxy contract address
    pub local_address: Address,
    /// Canonical manifold ID
    pub canonical_manifold_id: u64,
    /// Canonical contract address on home manifold
    pub canonical_address: Address,
    /// Latest known state root of the canonical contract
    pub last_known_state_root: B256,
    /// Public relay note topic for state sync updates
    pub relay_gossip_topic: [u8; 32],
}

/// Reverse Shadow Contract: holds a pointer to a canonical contract on another manifold.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReverseShadowContract {
    pub local_address: Address,
    pub local_manifold_id: u64,
    pub canonical_manifold_id: u64,
    pub canonical_address: Address,
    pub last_canonical_tip: B256,
    pub state_update_topic: [u8; 32],
    pub has_operator_rights: bool,
}
