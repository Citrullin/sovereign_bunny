//! Iroh P2P Blind Note Mesh and Content-Addressed Transport.
//!
//! Coordinates decentralized node endpoints, DID Ed25519 identity bindings,
//! blind note peer gossip routing, and periodic committee topology sync.

pub mod blind_note_transport;

use alloy_primitives::Address;
use ed25519_dalek::{SigningKey, VerifyingKey};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// An active Iroh node endpoint tied to a DID keypair.
#[derive(Clone)]
pub struct IrohEndpoint {
    /// Node DID (e.g. "did:sovereign:1337:0x...")
    pub did: String,
    /// EVM address associated with the node
    pub address: Address,
    /// Ed25519 verifying key for P2P transport encryption / authentication
    pub verifying_key: VerifyingKey,
    /// Active multiaddresses / endpoints for this peer
    pub listening_addrs: Vec<String>,
    /// Connected peers mapped by DID: DID -> Endpoint info
    pub connected_peers: Arc<RwLock<HashMap<String, PeerInfo>>>,
    /// Current epoch height tracked by the transport
    pub epoch_height: Arc<RwLock<u64>>,
}

/// Metadata describing a connected peer on the Iroh mesh.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PeerInfo {
    /// Peer DID
    pub did: String,
    /// Peer EVM address
    pub address: Address,
    /// Base64 encoded Ed25519 verifying key
    pub verifying_key: String,
    /// Known network addresses
    pub endpoints: Vec<String>,
    /// Last observed ping / heartbeat unix timestamp
    pub last_seen: u64,
}

impl IrohEndpoint {
    /// Initializes a new `IrohEndpoint` bound to a DID and Ed25519 signing key.
    pub fn new(did: String, address: Address, signing_key: &SigningKey) -> Self {
        Self {
            did,
            address,
            verifying_key: signing_key.verifying_key(),
            listening_addrs: vec!["/ip4/0.0.0.0/tcp/11223".to_string()],
            connected_peers: Arc::new(RwLock::new(HashMap::new())),
            epoch_height: Arc::new(RwLock::new(1)),
        }
    }

    /// Connects to a remote peer and registers it in the active mesh topology.
    pub fn connect_peer(&self, peer: PeerInfo) {
        if let Ok(mut peers) = self.connected_peers.write() {
            peers.insert(peer.did.clone(), peer);
        }
    }

    /// Removes disconnected or stale peers.
    pub fn disconnect_peer(&self, peer_did: &str) {
        if let Ok(mut peers) = self.connected_peers.write() {
            peers.remove(peer_did);
        }
    }

    /// Performs epoch boundary GC and syncs topology with the new epoch validator committee.
    pub fn on_epoch_boundary(&self, new_epoch: u64, active_committee_dids: &[String]) {
        if let Ok(mut ep) = self.epoch_height.write() {
            *ep = new_epoch;
        }

        // Garbage collect peers that are no longer part of active committee if topology is restricted
        if !active_committee_dids.is_empty() {
            if let Ok(mut peers) = self.connected_peers.write() {
                let committee_set: std::collections::HashSet<&String> = active_committee_dids.iter().collect();
                peers.retain(|did, _| committee_set.contains(did));
            }
        }
    }

    /// Returns the number of connected peers.
    pub fn peer_count(&self) -> usize {
        self.connected_peers.read().map(|p| p.len()).unwrap_or(0)
    }
}
