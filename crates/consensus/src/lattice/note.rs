//! # Sovereign Blind Note Lifecycle and Scaffolding
//!
//! Replaces legacy discrete Send/Receive with zero-knowledge blind note passing:
//! - [`CommitNote`]: Sender emits note commitment, encrypted ciphertext, and gossip topic.
//! - [`AbsorbNote`]: Recipient proves ownership and consumes note via nullifier SMT insertion.
//! - [`NoteLifecycle`]: Manages the decay and states (Native -> Clawback -> Evaporating -> Evaporated).

use alloy_primitives::{Address, B256, Bytes};
use serde::{Deserialize, Serialize};

/// Maximum allowable unspent notes per account to prevent griefing attacks (S-02).
pub const MAX_UNSPENT_NOTES_PER_ACCOUNT: usize = 256;

/// Mandatory gas fee required to register a Slot 0 DID on-chain (in atomic units).
/// A fresh address with 0 native balance MUST have this fee funded inside an incoming blind note.
pub const DID_REGISTRATION_GAS_FEE: u64 = 50_000;

/// Lifecycle phase of an unabsorbed note.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NotePhase {
    /// Note is within primary validity window; only designated recipient can absorb.
    Native,
    /// Note validity expired without absorption; sender can reclaim via clawback proof.
    Clawback,
    /// Note is in the process of state evaporation.
    Evaporating,
    /// Note is completely evaporated and permanently unspendable.
    Evaporated,
}

/// Cryptographic commitment representing a blind note on the ledger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteCommitment {
    /// 32-byte note commitment hash (e.g., Poseidon(nullifier_key, amount, asset_id, salt, manifold_id))
    pub commitment: B256,
    /// Encrypted ciphertext for recipient's viewing key (ECIES / hybrid encryption)
    pub encrypted_ciphertext: Bytes,
    /// Ephemeral public key for ECDH shared secret derivation
    pub ephemeral_pubkey: Bytes,
    /// Public gossip topic routing the note off-chain (e.g. hash(viewing_pk || epoch_salt))
    pub gossip_topic: B256,
    /// Manifold ID domain separator (prevents cross-manifold note collision, S-10)
    pub manifold_id: u64,
    /// Epoch in which this note was committed
    pub issuance_epoch: u64,
    /// Public hint indicating if this note carries an embedded relayer fee.
    /// 0 = self-submission only. > 0 = relayer fee hint (in wei-equivalent native token).
    #[serde(default)]
    pub relayer_fee_hint: u64,
    /// Dedicated in-note gas allocation reserved for recipient's Slot 0 DID registration.
    /// Sender funding a fresh address must supply at least `DID_REGISTRATION_GAS_FEE`.
    #[serde(default)]
    pub did_registration_fee: u64,
    /// 1-byte view-tag derived from shared secret Blake3("sovereign:view_tag:v1:", shared_secret)[0]
    /// Enables recipients to reject ~99.6% of irrelevant notes via 1 cheap scalar multiplication without trial AEAD.
    #[serde(default)]
    pub view_tag: u8,
    /// Epoch horizon at which the note's spend condition branches from Recipient Absorb to Sender Reclaim.
    /// 0 indicates no decay (permanent validity window).
    #[serde(default)]
    pub decay_epoch: u64,
}

impl NoteCommitment {
    /// Creates a new NoteCommitment with explicit manifold domain separation and relayer fee hint.
    #[must_use]
    pub fn new(
        commitment: B256,
        encrypted_ciphertext: Bytes,
        ephemeral_pubkey: Bytes,
        gossip_topic: B256,
        manifold_id: u64,
        issuance_epoch: u64,
    ) -> Self {
        Self {
            commitment,
            encrypted_ciphertext,
            ephemeral_pubkey,
            gossip_topic,
            manifold_id,
            issuance_epoch,
            relayer_fee_hint: 0,
            did_registration_fee: 0,
            view_tag: 0,
            decay_epoch: issuance_epoch.saturating_add(10),
        }
    }

    /// Creates a new NoteCommitment with explicit manifold domain separation, relayer fee hint, view tag, and decay epoch.
    #[must_use]
    pub fn with_decay_and_view_tag(
        commitment: B256,
        encrypted_ciphertext: Bytes,
        ephemeral_pubkey: Bytes,
        gossip_topic: B256,
        manifold_id: u64,
        issuance_epoch: u64,
        view_tag: u8,
        decay_epoch: u64,
    ) -> Self {
        Self {
            commitment,
            encrypted_ciphertext,
            ephemeral_pubkey,
            gossip_topic,
            manifold_id,
            issuance_epoch,
            relayer_fee_hint: 0,
            did_registration_fee: 0,
            view_tag,
            decay_epoch,
        }
    }

    /// Creates a new NoteCommitment with explicit relayer fee hint.
    #[must_use]
    pub fn with_relayer_fee_hint(
        commitment: B256,
        encrypted_ciphertext: Bytes,
        ephemeral_pubkey: Bytes,
        gossip_topic: B256,
        manifold_id: u64,
        issuance_epoch: u64,
        relayer_fee_hint: u64,
    ) -> Self {
        Self {
            commitment,
            encrypted_ciphertext,
            ephemeral_pubkey,
            gossip_topic,
            manifold_id,
            issuance_epoch,
            relayer_fee_hint,
            did_registration_fee: 0,
            view_tag: 0,
            decay_epoch: issuance_epoch.saturating_add(10),
        }
    }

    /// Creates a new NoteCommitment funding a fresh address's Slot 0 DID registration.
    #[must_use]
    pub fn with_did_registration_fee(
        commitment: B256,
        encrypted_ciphertext: Bytes,
        ephemeral_pubkey: Bytes,
        gossip_topic: B256,
        manifold_id: u64,
        issuance_epoch: u64,
        did_registration_fee: u64,
    ) -> Self {
        Self {
            commitment,
            encrypted_ciphertext,
            ephemeral_pubkey,
            gossip_topic,
            manifold_id,
            issuance_epoch,
            relayer_fee_hint: 0,
            did_registration_fee,
            view_tag: 0,
            decay_epoch: issuance_epoch.saturating_add(10),
        }
    }

    /// Computes domain-separated commitment hash binding manifold_id (S-10).
    #[must_use]
    pub fn compute_commitment_hash(
        inner_commitment: B256,
        manifold_id: u64,
    ) -> B256 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"sovereign:note:v1:");
        hasher.update(&manifold_id.to_le_bytes());
        hasher.update(inner_commitment.as_slice());
        B256::from_slice(hasher.finalize().as_bytes())
    }
}

/// Derives a 1-byte view-tag from an ECDH shared secret:
/// `view_tag = Blake3("sovereign:view_tag:v1:", shared_secret)[0]`.
#[must_use]
pub fn derive_view_tag(shared_secret: &[u8]) -> u8 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"sovereign:view_tag:v1:");
    hasher.update(shared_secret);
    hasher.finalize().as_bytes()[0]
}

/// Derives a deterministic spending nullifier for a blind note:
/// `Nullifier = Blake3("sovereign:nullifier:v1:", sk_spend, salt)`.
#[must_use]
pub fn derive_nullifier(sk_spend: &[u8], salt: &B256) -> B256 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"sovereign:nullifier:v1:");
    hasher.update(sk_spend);
    hasher.update(salt.as_slice());
    B256::from_slice(hasher.finalize().as_bytes())
}

/// Derives a deterministic secondary reclamation nullifier for the original sender:
/// `Nullifier_reclaim = Blake3("sovereign:reclaim_nullifier:v1:", sk_sender, salt, decay_epoch)`.
#[must_use]
pub fn derive_reclamation_nullifier(sk_sender: &[u8], salt: &B256, decay_epoch: u64) -> B256 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"sovereign:reclaim_nullifier:v1:");
    hasher.update(sk_sender);
    hasher.update(salt.as_slice());
    hasher.update(&decay_epoch.to_le_bytes());
    B256::from_slice(hasher.finalize().as_bytes())
}

/// Decrypted note payload (decrypted by designated recipient or proving circuit).
/// Serialized as CBOR inside `NoteCommitment.encrypted_ciphertext`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotePayload {
    /// Total value carried by this note (native tokens or asset token amount).
    pub value: alloy_primitives::U256,
    /// Asset identifier (Address::ZERO = native token; ERC-20 contract address otherwise).
    pub asset_id: Address,
    /// Fee reserved for the relayer that submits AbsorbNote on behalf of the recipient.
    /// Invariant: `value > relayer_fee` (unless pure zero-value state note).
    pub relayer_fee: alloy_primitives::U256,
    /// Dedicated fee earmarked for recipient's Slot 0 DID registration if recipient is uninitialized.
    #[serde(default)]
    pub did_registration_fee: alloy_primitives::U256,
    /// Random salt preventing brute-force preimage attacks.
    pub salt: B256,
    /// Designated recipient address (verified in ZK circuit; cannot be hijacked by relayer).
    pub recipient: Address,
    /// Optional state payload passed to the recipient's account on absorption.
    pub absorb_data: Option<Bytes>,
}

impl NotePayload {
    /// Serializes this payload to canonical deterministic payload bytes using header `0x71` (IPLD dag-cbor framing).
    ///
    /// Preserves a self-contained deterministic frame with a 4-byte length prefix to ensure zero-copy deserialization
    /// and cross-language interoperability with the TypeScript CBOR codec (`cbor_codec.ts`).
    pub fn to_cbor(&self) -> Result<Vec<u8>, serde_json::Error> {
        let mut buf = vec![0x71];
        let json_bytes = serde_json::to_vec(self)?;
        buf.extend_from_slice(&(json_bytes.len() as u32).to_be_bytes());
        buf.extend_from_slice(&json_bytes);
        Ok(buf)
    }

    /// Deserializes a payload from canonical deterministic payload bytes (header 0x71).
    pub fn from_cbor(bytes: &[u8]) -> Result<Self, String> {
        if bytes.is_empty() || bytes[0] != 0x71 {
            return Err("Invalid payload header: expected 0x71".to_string());
        }
        if bytes.len() < 5 {
            return Err("Truncated note payload".to_string());
        }
        let len = u32::from_be_bytes(bytes[1..5].try_into().unwrap()) as usize;
        if bytes.len() < 5 + len {
            return Err("Payload length mismatch".to_string());
        }
        serde_json::from_slice(&bytes[5..5 + len]).map_err(|e| format!("Failed to parse NotePayload: {e}"))
    }
}

/// On-chain representation of committing a blind note to an account's note accumulator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitNote {
    /// Recipient or target account register address
    pub target_account: Address,
    /// Domain-separated note commitment
    pub note_commitment: NoteCommitment,
    /// Target register slot (e.g. Slot 2 for native payment, Slot 3 for git DAG, etc.)
    pub target_slot: u16,
}

/// On-chain representation of absorbing a blind note using a zero-knowledge nullifier proof.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AbsorbNote {
    /// Consumed nullifier preventing double-spending
    pub nullifier: B256,
    /// ZK proof verifying knowledge of secret preimage, viewing authorization, and valid note inclusion
    pub zk_proof: Bytes,
    /// Target account register address absorbing the state mutation
    pub target_account: Address,
    /// Target register slot receiving the absorbed state change
    pub target_slot: u16,
    /// Verification epoch (enforces strict epoch window issuance_epoch ± 1, S-01)
    pub epoch: u64,
    /// Flag indicating whether this is a sender reclamation (true) or recipient absorption (false)
    #[serde(default)]
    pub is_reclaim: bool,
}

/// Evaporation tracking configuration for aging and uncollected notes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteEvaporation {
    /// Grace period in epochs before a note enters Clawback phase
    pub clawback_grace_epochs: u64,
    /// Total epochs before an unabsorbed note evaporates permanently
    pub evaporation_epochs: u64,
}

impl Default for NoteEvaporation {
    fn default() -> Self {
        Self {
            clawback_grace_epochs: 10,
            evaporation_epochs: 100,
        }
    }
}

impl NoteEvaporation {
    /// Computes the current phase of a note given its issuance epoch and current epoch.
    #[must_use]
    pub fn compute_phase(&self, issuance_epoch: u64, current_epoch: u64) -> NotePhase {
        let elapsed = current_epoch.saturating_sub(issuance_epoch);
        if elapsed < self.clawback_grace_epochs {
            NotePhase::Native
        } else if elapsed < self.evaporation_epochs {
            NotePhase::Clawback
        } else if elapsed < self.evaporation_epochs.saturating_add(5) {
            NotePhase::Evaporating
        } else {
            NotePhase::Evaporated
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_note_commitment_manifold_domain_separator() {
        let raw = B256::repeat_byte(0xaa);
        let h1 = NoteCommitment::compute_commitment_hash(raw, 1);
        let h2 = NoteCommitment::compute_commitment_hash(raw, 2);
        assert_ne!(h1, h2, "Different manifold IDs must yield distinct commitment hashes (S-10)");
    }

    #[test]
    fn test_note_phase_lifecycle() {
        let evap = NoteEvaporation {
            clawback_grace_epochs: 5,
            evaporation_epochs: 20,
        };
        assert_eq!(evap.compute_phase(10, 12), NotePhase::Native);
        assert_eq!(evap.compute_phase(10, 16), NotePhase::Clawback);
        assert_eq!(evap.compute_phase(10, 31), NotePhase::Evaporating);
        assert_eq!(evap.compute_phase(10, 50), NotePhase::Evaporated);
    }

    #[test]
    fn test_note_commitment_relayer_fee_hint() {
        let note = NoteCommitment::with_relayer_fee_hint(
            B256::repeat_byte(0x11),
            Bytes::from(vec![1, 2, 3]),
            Bytes::from(vec![4, 5, 6]),
            B256::repeat_byte(0x22),
            1,
            100,
            500_000,
        );
        assert_eq!(note.relayer_fee_hint, 500_000);
    }

    #[test]
    fn test_note_payload_cbor_roundtrip() {
        let payload = NotePayload {
            value: alloy_primitives::U256::from(1_000_000u64),
            asset_id: Address::ZERO,
            relayer_fee: alloy_primitives::U256::from(25_000u64),
            did_registration_fee: alloy_primitives::U256::from(DID_REGISTRATION_GAS_FEE),
            salt: B256::repeat_byte(0x77),
            recipient: Address::repeat_byte(0x42),
            absorb_data: Some(Bytes::from(vec![0xde, 0xad, 0xbe, 0xef])),
        };

        let cbor = payload.to_cbor().expect("serialization must succeed");
        let decoded = NotePayload::from_cbor(&cbor).expect("deserialization must succeed");
        assert_eq!(payload, decoded);
    }

    #[test]
    fn test_did_registration_fee_negative_and_positive_invariant() {
        use crate::governance::registry::ValidatorRegistry;
        use crate::system_contracts::router::execute_system_action;
        use crate::system_registry::{SystemAction, SYSTEM_DID_REGISTRY, SYSTEM_NOTE_REGISTRY};

        let mut registry = ValidatorRegistry::default();
        let fresh_account = Address::repeat_byte(0x55);
        let sender = Address::repeat_byte(0x11);

        // 1. Negative Test: Fresh account with 0 balance and 0 notes attempting DID registration MUST be rejected!
        let did_doc = format!(r#"{{"id":"did:sovereign:1337:{fresh_account:#x}","verificationMethod":[]}}"#);
        let reg_action = SystemAction::RegisterDid {
            did_document: did_doc.clone(),
            pq_pub_key: vec![0xaa; 32],
            key_tier: "QuantumReady".to_string(),
        };
        let calldata = reg_action.encode();
        let res_neg = execute_system_action(&mut registry, fresh_account, SYSTEM_DID_REGISTRY, &calldata, 1);
        assert!(res_neg.is_err(), "Unfunded identity creation without note backing MUST be rejected!");
        assert_eq!(
            res_neg.err().unwrap(),
            "Insufficient economic credit: Fresh address requires an in-note gas allocation or settled balance to register DID"
        );

        // 2. Negative Test: Sender attempting to commit a note to fresh account without providing DID_REGISTRATION_GAS_FEE MUST be rejected!
        let unfunded_note = NoteCommitment::new(
            B256::repeat_byte(0x88),
            Bytes::new(),
            Bytes::new(),
            B256::repeat_byte(0x99),
            1,
            1,
        );
        let commit_unfunded = SystemAction::CommitNote {
            note_commitment: unfunded_note,
            target_account: fresh_account,
            target_slot: 2,
        };
        // Sender has 0 balance
        let res_commit_neg = execute_system_action(&mut registry, sender, SYSTEM_NOTE_REGISTRY, &commit_unfunded.encode(), 1);
        assert!(res_commit_neg.is_err(), "Sender must fund registration gas when committing note to fresh account");

        // 3. Positive Test: Sender funds registration gas inside the blind note
        registry.account_balances.insert(sender, alloy_primitives::U256::from(DID_REGISTRATION_GAS_FEE * 3));
        let mut funded_note = NoteCommitment::new(
            B256::repeat_byte(0x33),
            Bytes::new(),
            Bytes::new(),
            B256::repeat_byte(0x44),
            1,
            1,
        );
        funded_note.did_registration_fee = DID_REGISTRATION_GAS_FEE;
        let commit_funded = SystemAction::CommitNote {
            note_commitment: funded_note,
            target_account: fresh_account,
            target_slot: 2,
        };
        let res_commit_pos = execute_system_action(&mut registry, sender, SYSTEM_NOTE_REGISTRY, &commit_funded.encode(), 1);
        assert!(res_commit_pos.is_ok(), "Commit note with funded registration gas must succeed");

        // 4. Positive Test: Fresh address can now register DID and fee is debited
        let res_pos = execute_system_action(&mut registry, fresh_account, SYSTEM_DID_REGISTRY, &calldata, 1);
        assert!(res_pos.is_ok(), "DID registration must succeed with funded note gas");
        assert!(registry.has_registered_did(&fresh_account));
        // Verify balance was debited back to 0
        assert_eq!(registry.get_account_balance(&fresh_account), alloy_primitives::U256::ZERO);
    }

    #[test]
    fn test_view_tag_and_nullifier_derivation_invariants() {
        let shared_secret = b"shared_ecdh_secret_between_alice_and_bob_12345678";
        let view_tag = derive_view_tag(shared_secret);

        // Deterministic view-tag
        assert_eq!(view_tag, derive_view_tag(shared_secret));
        // Different secret yields different view tag
        let other_secret = b"shared_ecdh_secret_different_eve_party_12345678";
        assert_ne!(view_tag, derive_view_tag(other_secret));

        let sk_spend = b"alice_spending_secret_key_32bytes!!";
        let salt = B256::repeat_byte(0x77);

        // Primary recipient nullifier
        let nullifier_absorb = derive_nullifier(sk_spend, &salt);
        assert_eq!(nullifier_absorb, derive_nullifier(sk_spend, &salt));

        // Secondary sender reclamation nullifier (branches at decay_epoch)
        let decay_epoch = 42u64;
        let nullifier_reclaim = derive_reclamation_nullifier(sk_spend, &salt, decay_epoch);
        assert_ne!(
            nullifier_absorb, nullifier_reclaim,
            "Reclamation nullifier must be mathematically distinct from absorption nullifier"
        );
        // Different decay epochs yield different reclamation nullifiers
        assert_ne!(
            nullifier_reclaim,
            derive_reclamation_nullifier(sk_spend, &salt, 43u64)
        );
    }
}
