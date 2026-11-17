//! # Viewing Keys and Note Decryption
//!
//! Provides viewing key management for blind notes. Enables accounts, delegates,
//! and regulatory authorities (with verified court orders) to scan and decrypt notes
//! addressed to them or authorized for compliance audit.

use alloy_primitives::{Address, B256, Bytes};
use serde::{Deserialize, Serialize};

/// Asymmetric viewing key pair (e.g. X25519 or Jubjub/BabyJubjub)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewingKeyPair {
    /// Public viewing key exposed to senders for note encryption
    pub public_key: Bytes,
    /// Private viewing key held locally (never touches the ledger)
    #[serde(skip_serializing)]
    pub secret_key: Option<Bytes>,
}

impl ViewingKeyPair {
    /// Creates a viewing key pair.
    #[must_use]
    pub fn new(public_key: Bytes, secret_key: Option<Bytes>) -> Self {
        Self {
            public_key,
            secret_key,
        }
    }

    /// Derives the public gossip routing topic for this viewing key in a given epoch.
    #[must_use]
    pub fn derive_gossip_topic(&self, epoch: u64) -> B256 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"sovereign:viewing_topic:v1:");
        hasher.update(&epoch.to_le_bytes());
        hasher.update(self.public_key.as_ref());
        B256::from_slice(hasher.finalize().as_bytes())
    }
}

/// Decrypted blind note plaintext contents after successful viewing key application.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecryptedNote {
    /// Original note commitment
    pub note_commitment: B256,
    /// Originating sender address
    pub sender: Address,
    /// Intended recipient address
    pub recipient: Address,
    /// Transferred asset balance or denomination
    pub amount: alloy_primitives::U256,
    /// Target register slot (e.g. 2 for payment, 3 for git repo delta)
    pub target_slot: u16,
    /// Arbitrary application payload (e.g., interface delta, smart contract code)
    pub payload: Bytes,
    /// Random salt used in commitment creation
    pub blinding_salt: B256,
}

/// Audit log entry recorded when an authority or delegate inspects state using an authorized viewing key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewingAuditLog {
    /// Account whose state or notes were inspected
    pub audited_account: Address,
    /// Entity or authority performing the audit
    pub auditor: Address,
    /// Cryptographic hash of the warrant or court order authorizing inspection
    pub court_order_hash: B256,
    /// Epoch in which inspection was executed
    pub epoch: u64,
    /// Hash of the specific note commitment or slot inspected
    pub target_commitment: B256,
}
