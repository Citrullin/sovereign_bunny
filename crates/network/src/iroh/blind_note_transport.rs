//! Off-chain P2P blind note transport and gossip mesh.
//!
//! Encodes private notes, manages ephemeral gossip topics,
//! provides 1-byte view-tag scanning for anonymous discovery,
//! and enables direct P2P blind courier delivery between sovereign nodes.

use alloy_primitives::{Address, B256, Bytes};
use sovereign_consensus::lattice::note::{NoteCommitment, MAX_UNSPENT_NOTES_PER_ACCOUNT};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};

/// An off-chain blind note message routed over the Iroh P2P mesh or public DA.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BlindNoteMessage {
    /// 32-byte note commitment hash matching on-chain register commitment
    pub note_commitment: B256,
    /// Encrypted ciphertext for recipient's viewing key
    pub encrypted_ciphertext: Bytes,
    /// Ephemeral public key for ECDH shared secret derivation
    pub ephemeral_pubkey: Bytes,
    /// 1-byte view-tag derived from shared secret (rejects ~99.6% without trial AEAD)
    #[serde(default)]
    pub view_tag: u8,
    /// Epoch horizon at which the note enters decay and sender can reclaim
    #[serde(default)]
    pub decay_epoch: u64,
    /// Gossip topic hash (e.g. hash(viewing_pk || epoch_salt))
    pub gossip_topic: B256,
    /// Manifold ID domain separator
    pub manifold_id: u64,
    /// Relayer fee hint
    pub relayer_fee_hint: u64,
    /// Unix timestamp of publication
    pub timestamp: u64,
    /// Deprecated optional hint (defaults to Address::ZERO for privacy)
    #[serde(default)]
    pub recipient_hint: Address,
}

impl BlindNoteMessage {
    /// Constructs a message from an on-chain `NoteCommitment`.
    pub fn from_note_commitment(note: &NoteCommitment, recipient_hint: Address) -> Self {
        Self {
            note_commitment: note.commitment,
            encrypted_ciphertext: note.encrypted_ciphertext.clone(),
            ephemeral_pubkey: note.ephemeral_pubkey.clone(),
            view_tag: note.view_tag,
            decay_epoch: note.decay_epoch,
            gossip_topic: note.gossip_topic,
            manifold_id: note.manifold_id,
            recipient_hint,
            relayer_fee_hint: note.relayer_fee_hint,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        }
    }

    /// Constructs an anonymous gossip note message with zero recipient address metadata.
    pub fn new_anonymous(note: &NoteCommitment) -> Self {
        Self::from_note_commitment(note, Address::ZERO)
    }

    /// Converts this P2P message back into an on-chain ledger `NoteCommitment`.
    pub fn to_note_commitment(&self, issuance_epoch: u64) -> NoteCommitment {
        NoteCommitment::with_decay_and_view_tag(
            self.note_commitment,
            self.encrypted_ciphertext.clone(),
            self.ephemeral_pubkey.clone(),
            self.gossip_topic,
            self.manifold_id,
            issuance_epoch,
            self.view_tag,
            self.decay_epoch,
        )
    }
}

/// Mesh router for dispatching and subscribing to blind note gossip topics.
#[derive(Default, Clone)]
pub struct BlindNoteRouter {
    /// Public gossip inboxes keyed by gossip topic
    topic_inboxes: Arc<RwLock<HashMap<B256, VecDeque<BlindNoteMessage>>>>,
    /// Direct P2P Blind Courier inboxes keyed by Iroh peer node ID (no on-chain address leak)
    peer_inboxes: Arc<RwLock<HashMap<String, VecDeque<BlindNoteMessage>>>>,
    /// Legacy address inboxes (retained for backward compatibility, capped)
    recipient_inboxes: Arc<RwLock<HashMap<Address, VecDeque<BlindNoteMessage>>>>,
}

impl BlindNoteRouter {
    /// Creates a new `BlindNoteRouter`.
    pub fn new() -> Self {
        Self {
            topic_inboxes: Arc::new(RwLock::new(HashMap::new())),
            peer_inboxes: Arc::new(RwLock::new(HashMap::new())),
            recipient_inboxes: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Dispatches a blind note message across the public gossip mesh.
    ///
    /// Enforces `MAX_UNSPENT_NOTES_PER_ACCOUNT` to protect node memory from unbounded mailbox flooding attacks (HIGH-NEW-04).
    pub fn route_note(&self, msg: BlindNoteMessage) {
        if let Ok(mut topics) = self.topic_inboxes.write() {
            let inbox = topics.entry(msg.gossip_topic).or_default();
            if inbox.len() >= MAX_UNSPENT_NOTES_PER_ACCOUNT {
                inbox.pop_front();
            }
            inbox.push_back(msg.clone());
        }
        if msg.recipient_hint != Address::ZERO {
            if let Ok(mut addrs) = self.recipient_inboxes.write() {
                let inbox = addrs.entry(msg.recipient_hint).or_default();
                if inbox.len() >= MAX_UNSPENT_NOTES_PER_ACCOUNT {
                    inbox.pop_front();
                }
                inbox.push_back(msg);
            }
        }
    }

    /// Dispatches a blind note directly to a known counterparty peer (Blind Courier path).
    /// Zero on-chain metadata or public gossip footprint.
    pub fn route_direct_courier(&self, peer_node_id: &str, msg: BlindNoteMessage) {
        if let Ok(mut peers) = self.peer_inboxes.write() {
            let inbox = peers.entry(peer_node_id.to_string()).or_default();
            if inbox.len() >= MAX_UNSPENT_NOTES_PER_ACCOUNT {
                inbox.pop_front();
            }
            inbox.push_back(msg);
        }
    }

    /// Scans a gossip topic and returns only notes matching the expected 1-byte view-tag.
    /// This rejects ~99.6% of irrelevant notes before the client performs AEAD trial decryption.
    pub fn scan_topic_with_view_tag(&self, topic: &B256, expected_view_tag: u8) -> Vec<BlindNoteMessage> {
        self.topic_inboxes
            .read()
            .ok()
            .and_then(|t| {
                t.get(topic).map(|q| {
                    q.iter()
                        .filter(|msg| msg.view_tag == expected_view_tag)
                        .cloned()
                        .collect()
                })
            })
            .unwrap_or_default()
    }

    /// Fetches all blind notes received for a specific gossip topic.
    pub fn get_notes_by_topic(&self, topic: &B256) -> Vec<BlindNoteMessage> {
        self.topic_inboxes
            .read()
            .ok()
            .and_then(|t| t.get(topic).map(|q| q.iter().cloned().collect()))
            .unwrap_or_default()
    }

    /// Drains notes received directly via Blind Courier for this local node.
    pub fn drain_courier_notes(&self, local_peer_id: &str) -> Vec<BlindNoteMessage> {
        if let Ok(mut peers) = self.peer_inboxes.write() {
            peers.remove(local_peer_id).map(|q| q.into_iter().collect()).unwrap_or_default()
        } else {
            Vec::new()
        }
    }

    /// Fetches and drains blind notes addressed to a specific recipient (legacy).
    pub fn drain_notes_for_recipient(&self, recipient: &Address) -> Vec<BlindNoteMessage> {
        if let Ok(mut addrs) = self.recipient_inboxes.write() {
            addrs.remove(recipient).map(|q| q.into_iter().collect()).unwrap_or_default()
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blind_note_router_fifo_capacity() {
        let router = BlindNoteRouter::new();
        let topic = B256::repeat_byte(0xaa);
        let recipient = Address::repeat_byte(0xbb);

        // Push MAX + 5 notes
        for i in 0..(MAX_UNSPENT_NOTES_PER_ACCOUNT + 5) {
            let msg = BlindNoteMessage {
                note_commitment: B256::repeat_byte(i as u8),
                encrypted_ciphertext: Bytes::default(),
                ephemeral_pubkey: Bytes::default(),
                view_tag: 0,
                decay_epoch: 100,
                gossip_topic: topic,
                manifold_id: 1,
                recipient_hint: recipient,
                relayer_fee_hint: 0,
                timestamp: i as u64,
            };
            router.route_note(msg);
        }

        let drained = router.drain_notes_for_recipient(&recipient);
        assert_eq!(drained.len(), MAX_UNSPENT_NOTES_PER_ACCOUNT);
        // The first 5 notes (0..5) should have been evicted by FIFO pop_front
        assert_eq!(drained.first().unwrap().note_commitment, B256::repeat_byte(5));
        assert_eq!(
            drained.last().unwrap().note_commitment,
            B256::repeat_byte((MAX_UNSPENT_NOTES_PER_ACCOUNT + 4) as u8)
        );
    }

    #[test]
    fn test_view_tag_filtering_efficacy() {
        let router = BlindNoteRouter::new();
        let topic = B256::repeat_byte(0x55);
        let target_view_tag = 0x42u8;

        // Route 256 notes with sequential view tags 0..256
        for i in 0..256 {
            let msg = BlindNoteMessage {
                note_commitment: B256::repeat_byte(i as u8),
                encrypted_ciphertext: Bytes::default(),
                ephemeral_pubkey: Bytes::default(),
                view_tag: i as u8,
                decay_epoch: 50,
                gossip_topic: topic,
                manifold_id: 1,
                recipient_hint: Address::ZERO, // Anonymous
                relayer_fee_hint: 0,
                timestamp: i as u64,
            };
            router.route_note(msg);
        }

        // View-tag scanning must filter out 255 out of 256 notes (~99.61% rejection)
        let matched = router.scan_topic_with_view_tag(&topic, target_view_tag);
        assert_eq!(matched.len(), 1, "Only the note matching target_view_tag must hit");
        assert_eq!(matched[0].view_tag, target_view_tag);
        assert_eq!(matched[0].note_commitment, B256::repeat_byte(target_view_tag));
    }

    #[test]
    fn test_direct_courier_privacy() {
        let router = BlindNoteRouter::new();
        let peer_alice = "iroh_node_peer_alice_12345";
        let note = NoteCommitment::with_decay_and_view_tag(
            B256::repeat_byte(0xee),
            Bytes::from_static(b"encrypted_secret_data"),
            Bytes::from_static(b"ephemeral_pk"),
            B256::repeat_byte(0x99),
            1,
            10,
            0x7a,
            20,
        );

        let msg = BlindNoteMessage::new_anonymous(&note);
        assert_eq!(msg.recipient_hint, Address::ZERO, "Direct courier must have ZERO recipient address hint");

        router.route_direct_courier(peer_alice, msg);

        // Topic inboxes must be empty (zero public gossip footprint)
        assert_eq!(router.get_notes_by_topic(&B256::repeat_byte(0x99)).len(), 0);

        // Draining courier for Alice retrieves the note
        let received = router.drain_courier_notes(peer_alice);
        assert_eq!(received.len(), 1);
        assert_eq!(received[0].view_tag, 0x7a);
        assert_eq!(received[0].decay_epoch, 20);

        // Subsequent drain is empty
        assert_eq!(router.drain_courier_notes(peer_alice).len(), 0);
    }
}
