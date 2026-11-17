//! # Session Management & Gas Sponsorship
//!
//! Maintains in-memory ephemeral sessions and integrates native gas sponsorship.

use alloy_primitives::Address;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

pub mod ephemeral_key;
pub use ephemeral_key::{EphemeralKeyManager, EphemeralSessionKey};

/// Ephemeral session record cached in-memory with TTL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub session_id: String,
    pub account: Address,
    pub client_id: String,
    pub expires_at: u64,
    pub gas_sponsored: bool,
}

/// Thread-safe ephemeral session cache.
#[derive(Debug, Default, Clone)]
pub struct SessionCache {
    sessions: Arc<RwLock<HashMap<String, SessionRecord>>>,
}

impl SessionCache {
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn insert(&self, session: SessionRecord) {
        self.sessions.write().unwrap().insert(session.session_id.clone(), session);
    }

    #[must_use]
    pub fn get(&self, session_id: &str) -> Option<SessionRecord> {
        self.sessions.read().unwrap().get(session_id).cloned()
    }

    pub fn prune_expired(&self, current_time: u64) {
        self.sessions.write().unwrap().retain(|_, s| s.expires_at > current_time);
    }
}
