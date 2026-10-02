//! # Ephemeral Session Key & Blind Note Commitments
//!
//! Manages in-memory ephemeral session keys with 24-hour TTL, backed by
//! on-chain blind session commitments (Slot 0 / Slot 1 anchor).

use alloy_primitives::{Address, B256};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// Ephemeral session record cached in-memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EphemeralSessionKey {
    pub key_id: String,
    pub account: Address,
    pub client_id: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub session_secret: B256,
    pub blind_note_commitment: B256,
    pub gas_sponsored: bool,
}

impl EphemeralSessionKey {
    /// Computes deterministic null-link blind note commitment hash.
    #[must_use]
    pub fn compute_commitment(
        account: Address,
        client_id: &str,
        session_secret: B256,
        expires_at: u64,
    ) -> B256 {
        let input = format!("{account:#x}:{client_id}:{session_secret:#x}:{expires_at}");
        B256::from_slice(blake3::hash(input.as_bytes()).as_bytes())
    }
}

/// Thread-safe manager for ephemeral session keys.
#[derive(Debug, Default, Clone)]
pub struct EphemeralKeyManager {
    keys: Arc<RwLock<HashMap<String, EphemeralSessionKey>>>,
}

impl EphemeralKeyManager {
    #[must_use]
    pub fn new() -> Self {
        Self {
            keys: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Creates and caches a new ephemeral session key with a 24-hour TTL.
    pub fn create_session(
        &self,
        account: Address,
        client_id: &str,
        now_secs: u64,
        ttl_secs: u64,
    ) -> EphemeralSessionKey {
        let expires_at = now_secs + ttl_secs;
        let random_seed = blake3::hash(format!("{account:#x}:{client_id}:{now_secs}").as_bytes());
        let session_secret = B256::from_slice(random_seed.as_bytes());
        let commitment = EphemeralSessionKey::compute_commitment(
            account,
            client_id,
            session_secret,
            expires_at,
        );

        let key_id = format!("sess_{}", blake3::hash(commitment.as_slice()).to_hex());

        let record = EphemeralSessionKey {
            key_id: key_id.clone(),
            account,
            client_id: client_id.to_string(),
            created_at: now_secs,
            expires_at,
            session_secret,
            blind_note_commitment: commitment,
            gas_sponsored: account != Address::ZERO,
        };

        self.keys.write().unwrap().insert(key_id, record.clone());
        record
    }

    #[must_use]
    pub fn get(&self, key_id: &str) -> Option<EphemeralSessionKey> {
        self.keys.read().unwrap().get(key_id).cloned()
    }

    pub fn prune_expired(&self, now_secs: u64) {
        self.keys.write().unwrap().retain(|_, k| k.expires_at > now_secs);
    }

    #[must_use]
    pub fn verify_commitment(&self, key_id: &str, expected_commitment: B256) -> bool {
        self.keys
            .read()
            .unwrap()
            .get(key_id)
            .map(|k| k.blind_note_commitment == expected_commitment)
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ephemeral_session_key_lifecycle() {
        let mgr = EphemeralKeyManager::new();
        let alice = Address::repeat_byte(0xaa);
        let client_id = "nextcloud";
        let now = 1770000000;

        let session = mgr.create_session(alice, client_id, now, 86400);
        assert_eq!(session.account, alice);
        assert_eq!(session.client_id, "nextcloud");
        assert!(session.gas_sponsored);
        assert_eq!(session.expires_at, now + 86400);

        // Verification of commitment
        assert!(mgr.verify_commitment(&session.key_id, session.blind_note_commitment));

        // Expired session pruning
        mgr.prune_expired(now + 90000);
        assert!(mgr.get(&session.key_id).is_none());
    }
}
