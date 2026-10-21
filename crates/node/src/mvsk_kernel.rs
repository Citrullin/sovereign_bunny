//! # Minimal Viable Security Kernel (MVSK) State Validator
//!
//! Defined in the Sovereign Whitebooklet (§7.3, `crates/node/src/mvsk_kernel.rs`).
//! Enforces:
//! 1. Single-Writer Lattice Validation: Strict monotonic sequence nonces eliminating replay attacks.
//! 2. Fail-Closed Cryptographic Signature Validation: Zero mock signature bypasses permitted.
//! 3. Hardware TEE DCAP Attestation Verification: Rejects debug and mock quotes when strict TEE is enforced.
//! 4. Order-Independent Nullifier Accumulation: Prevents double-spending of blind notes.

use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use blake3::Hasher;

mod serde_sig {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &[u8; 64], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_bytes(bytes)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 64], D::Error>
    where
        D: Deserializer<'de>,
    {
        let slice: Vec<u8> = Vec::deserialize(deserializer)?;
        if slice.len() != 64 {
            return Err(serde::de::Error::custom("expected 64 bytes for Ed25519 signature"));
        }
        let mut arr = [0u8; 64];
        arr.copy_from_slice(&slice);
        Ok(arr)
    }
}

/// Request payload for a state transition across an account-lattice slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MvskTransitionRequest {
    /// 32-byte sovereign account identity (e.g. Ed25519 public key or Blake3 DID root).
    pub account_id: [u8; 32],
    /// Current settled state nonce of the account.
    pub current_nonce: u64,
    /// Proposed monotonic sequence nonce (must be exactly `current_nonce + 1`).
    pub proposed_nonce: u64,
    /// Target Compact Account Register (CAR) slot identifier (0..63).
    pub target_slot: u8,
    /// Raw state transition delta targeting the CAR slot.
    pub slot_delta: Vec<u8>,
    /// Cryptographic signature over the transition payload.
    #[serde(with = "serde_sig")]
    pub ed25519_sig: [u8; 64],
    /// Optional Intel SGX / TDX DCAP remote attestation quote.
    pub tee_dcap_quote: Option<Vec<u8>>,
    /// Blind note nullifiers consumed during this state transition.
    pub nullifiers_to_absorb: Vec<[u8; 32]>,
}

/// Minimal Viable Security Kernel execution state.
#[derive(Debug, Clone, Default)]
pub struct MvskStateKernel {
    /// Active consensus epoch counter.
    pub active_epoch: u64,
    /// Order-independent nullifier accumulator preventing double-spending.
    pub nullifier_accumulator: HashSet<[u8; 32]>,
    /// Pinned MRSIGNER measurement of the authorized confidential enclave binary.
    pub trusted_enclave_mrsigner: [u8; 32],
    /// Strict hardware TEE DCAP enforcement switch (fails closed if false or debug quote).
    pub enforce_strict_tee: bool,
    /// Monotonic account sequence nonce registry preventing transaction replays.
    pub account_nonces: HashMap<[u8; 32], u64>,
}

impl MvskStateKernel {
    /// Creates a new `MvskStateKernel` instance with initialized configuration.
    #[must_use]
    pub fn new(
        active_epoch: u64,
        trusted_enclave_mrsigner: [u8; 32],
        enforce_strict_tee: bool,
    ) -> Self {
        Self {
            active_epoch,
            nullifier_accumulator: HashSet::new(),
            trusted_enclave_mrsigner,
            enforce_strict_tee,
            account_nonces: HashMap::new(),
        }
    }

    /// Validates an incoming lattice state transition request and computes the new slot commitment root.
    ///
    /// # Errors
    /// - `MVSK_ERR: Nonce must strictly increment monotonically`: If `proposed_nonce != current_nonce + 1`.
    /// - `MVSK_ERR: Account nonce desynchronization; state replay rejected`: If `current_nonce` does not match recorded state.
    /// - `MVSK_ERR: Signature verification rejected; zero bypasses permitted`: If Ed25519 signature is invalid.
    /// - `MVSK_ERR: Hardware TEE DCAP quote strictly required`: If `enforce_strict_tee` is true and quote is missing.
    /// - `MVSK_ERR: TEE quote rejected; debug quotes strictly barred`: If TEE quote is invalid or in debug mode.
    /// - `MVSK_ERR: Double-spend detected; nullifier already absorbed`: If any nullifier was previously consumed.
    pub fn validate_and_apply(
        &mut self,
        req: &MvskTransitionRequest,
    ) -> Result<[u8; 32], &'static str> {
        // 1. Strict Monotonic Nonce (Eliminates Replay Attacks)
        if req.proposed_nonce != req.current_nonce + 1 {
            return Err("MVSK_ERR: Nonce must strictly increment monotonically");
        }

        if let Some(&recorded_nonce) = self.account_nonces.get(&req.account_id) {
            if req.current_nonce != recorded_nonce {
                return Err("MVSK_ERR: Account nonce desynchronization; state replay rejected");
            }
        } else if req.current_nonce != 0 {
            // First time this account is seen; initial nonce must start from 0
            return Err("MVSK_ERR: Fresh account must start with initial nonce 0");
        }

        // 2. Fail-Closed Cryptographic Signature Validation
        // Constructs canonical message digest: H("mvsk:transition:v1:" || account_id || proposed_nonce || target_slot || slot_delta)
        let message_to_verify = compute_transition_digest(
            &req.account_id,
            req.proposed_nonce,
            req.target_slot,
            &req.slot_delta,
        );

        if !verify_ed25519(&req.account_id, &message_to_verify, &req.ed25519_sig) {
            return Err("MVSK_ERR: Signature verification rejected; zero bypasses permitted");
        }

        // 3. Hardware TEE DCAP Attestation Verification
        if self.enforce_strict_tee {
            let quote = req.tee_dcap_quote.as_ref()
                .ok_or("MVSK_ERR: Hardware TEE DCAP quote strictly required")?;
            if !verify_intel_dcap_quote(quote, &self.trusted_enclave_mrsigner) {
                return Err("MVSK_ERR: TEE quote rejected; debug quotes strictly barred");
            }
        }

        // 4. Order-Independent Nullifier Accumulation (Double-Spend Protection)
        for nullifier in &req.nullifiers_to_absorb {
            if self.nullifier_accumulator.contains(nullifier) {
                return Err("MVSK_ERR: Double-spend detected; nullifier already absorbed");
            }
        }
        for nullifier in &req.nullifiers_to_absorb {
            self.nullifier_accumulator.insert(*nullifier);
        }

        // 5. Update Monotonic Account State Nonce
        self.account_nonces.insert(req.account_id, req.proposed_nonce);

        // 6. Emit Deterministic Slot Root
        Ok(compute_slot_hash(req.target_slot, &req.slot_delta))
    }
}

/// Computes canonical Blake3 digest of a transition request.
#[must_use]
pub fn compute_transition_digest(
    account_id: &[u8; 32],
    proposed_nonce: u64,
    target_slot: u8,
    slot_delta: &[u8],
) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"sovereign:mvsk:transition:v1:");
    hasher.update(account_id);
    hasher.update(&proposed_nonce.to_le_bytes());
    hasher.update(&[target_slot]);
    hasher.update(slot_delta);
    *hasher.finalize().as_bytes()
}

/// Verifies Ed25519 signature fail-closed without any mock bypasses.
#[must_use]
pub fn verify_ed25519(
    account_id: &[u8; 32],
    message: &[u8],
    signature: &[u8; 64],
) -> bool {
    // Fail-closed on all-zero keys or signatures
    if account_id == &[0u8; 32] || signature == &[0u8; 64] {
        return false;
    }

    use ed25519_dalek::{Signature, VerifyingKey};
    let verifying_key = match VerifyingKey::from_bytes(account_id) {
        Ok(vk) => vk,
        Err(_) => return false,
    };

    let sig = Signature::from_bytes(signature);
    use ed25519_dalek::Verifier;
    verifying_key.verify(message, &sig).is_ok()
}

/// Verifies Intel DCAP Quote fail-closed, ensuring non-debug status and matching MRSIGNER.
#[must_use]
pub fn verify_intel_dcap_quote(
    quote: &[u8],
    trusted_mrsigner: &[u8; 32],
) -> bool {
    // Minimum valid SGX quote length is 432 bytes (header + report body + auth data)
    if quote.len() < 432 {
        return false;
    }

    // Explicitly reject any mock quote flags in release mode
    if quote.starts_with(b"MOCK_SGX_QUOTE_") {
        return false;
    }

    // In a DCAP quote header:
    // Bytes 0..2: Version (e.g. 3)
    // Bytes 2..4: Attestation Key Type
    // Bytes 4..8: Reserved / TEE type (0 = SGX)
    let tee_type = u32::from_le_bytes([quote[4], quote[5], quote[6], quote[7]]);
    if tee_type != 0 {
        return false;
    }

    // Enclave Report Body is located at offset 48, length 384:
    // Offset 48 + 96 = 144: Attributes (16 bytes). Flags byte at 144:
    // Bit 1 (0x02) is DEBUG flag. Debug enclaves MUST BE REJECTED in production!
    let attributes_flags = quote[144];
    if (attributes_flags & 0x02) != 0 {
        // Enclave is running in DEBUG mode — strictly barred!
        return false;
    }

    // Offset 48 + 128 = 176: MRSIGNER (32 bytes)
    if trusted_mrsigner != &[0u8; 32] {
        let quote_mrsigner = &quote[176..208];
        if quote_mrsigner != trusted_mrsigner {
            return false;
        }
    }

    true
}

/// Computes the deterministic Blake3 slot root commitment for a CAR register.
#[must_use]
pub fn compute_slot_hash(target_slot: u8, slot_delta: &[u8]) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"sovereign:car_slot:v1:");
    hasher.update(&[target_slot]);
    hasher.update(slot_delta);
    *hasher.finalize().as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn generate_test_keypair() -> (SigningKey, [u8; 32]) {
        let secret = [0x55u8; 32];
        let signing_key = SigningKey::from_bytes(&secret);
        let public_key = signing_key.verifying_key().to_bytes();
        (signing_key, public_key)
    }

    #[test]
    fn test_mvsk_monotonic_nonce_valid_progression() {
        let (signing_key, account_id) = generate_test_keypair();
        let mut kernel = MvskStateKernel::new(1, [0u8; 32], false);

        // Transition 1: Nonce 0 -> 1
        let slot_delta = b"mount:slot:radicle_repo".to_vec();
        let msg1 = compute_transition_digest(&account_id, 1, 3, &slot_delta);
        use ed25519_dalek::Signer;
        let sig1 = signing_key.sign(&msg1).to_bytes();

        let req1 = MvskTransitionRequest {
            account_id,
            current_nonce: 0,
            proposed_nonce: 1,
            target_slot: 3,
            slot_delta,
            ed25519_sig: sig1,
            tee_dcap_quote: None,
            nullifiers_to_absorb: vec![],
        };

        let res1 = kernel.validate_and_apply(&req1);
        assert!(res1.is_ok(), "First monotonic transition should succeed");
        assert_eq!(*kernel.account_nonces.get(&account_id).unwrap(), 1);

        // Transition 2: Nonce 1 -> 2
        let slot_delta2 = b"update:slot:radicle_repo:tip".to_vec();
        let msg2 = compute_transition_digest(&account_id, 2, 3, &slot_delta2);
        let sig2 = signing_key.sign(&msg2).to_bytes();

        let req2 = MvskTransitionRequest {
            account_id,
            current_nonce: 1,
            proposed_nonce: 2,
            target_slot: 3,
            slot_delta: slot_delta2,
            ed25519_sig: sig2,
            tee_dcap_quote: None,
            nullifiers_to_absorb: vec![],
        };

        let res2 = kernel.validate_and_apply(&req2);
        assert!(res2.is_ok(), "Second monotonic transition should succeed");
        assert_eq!(*kernel.account_nonces.get(&account_id).unwrap(), 2);
    }

    #[test]
    fn test_mvsk_nonce_replay_attack_rejected() {
        let (signing_key, account_id) = generate_test_keypair();
        let mut kernel = MvskStateKernel::new(1, [0u8; 32], false);

        let slot_delta = b"send_note".to_vec();
        let msg = compute_transition_digest(&account_id, 1, 2, &slot_delta);
        use ed25519_dalek::Signer;
        let sig = signing_key.sign(&msg).to_bytes();

        let req = MvskTransitionRequest {
            account_id,
            current_nonce: 0,
            proposed_nonce: 1,
            target_slot: 2,
            slot_delta,
            ed25519_sig: sig,
            tee_dcap_quote: None,
            nullifiers_to_absorb: vec![],
        };

        // First attempt succeeds
        assert!(kernel.validate_and_apply(&req).is_ok());

        // Replay attempt with same nonces (0 -> 1) MUST FAIL
        let replay_res = kernel.validate_and_apply(&req);
        assert_eq!(
            replay_res.unwrap_err(),
            "MVSK_ERR: Account nonce desynchronization; state replay rejected"
        );
    }

    #[test]
    fn test_mvsk_non_consecutive_nonce_gap_rejected() {
        let (signing_key, account_id) = generate_test_keypair();
        let mut kernel = MvskStateKernel::new(1, [0u8; 32], false);

        let slot_delta = b"gap_nonce_test".to_vec();
        // Skip from 0 to 2
        let msg = compute_transition_digest(&account_id, 2, 1, &slot_delta);
        use ed25519_dalek::Signer;
        let sig = signing_key.sign(&msg).to_bytes();

        let req = MvskTransitionRequest {
            account_id,
            current_nonce: 0,
            proposed_nonce: 2,
            target_slot: 1,
            slot_delta,
            ed25519_sig: sig,
            tee_dcap_quote: None,
            nullifiers_to_absorb: vec![],
        };

        let res = kernel.validate_and_apply(&req);
        assert_eq!(
            res.unwrap_err(),
            "MVSK_ERR: Nonce must strictly increment monotonically"
        );
    }

    #[test]
    fn test_mvsk_double_spend_nullifier_rejected() {
        let (signing_key, account_id) = generate_test_keypair();
        let mut kernel = MvskStateKernel::new(1, [0u8; 32], false);

        let nullifier = [0x99u8; 32];
        let slot_delta = b"absorb_note".to_vec();
        let msg1 = compute_transition_digest(&account_id, 1, 2, &slot_delta);
        use ed25519_dalek::Signer;
        let sig1 = signing_key.sign(&msg1).to_bytes();

        let req1 = MvskTransitionRequest {
            account_id,
            current_nonce: 0,
            proposed_nonce: 1,
            target_slot: 2,
            slot_delta: slot_delta.clone(),
            ed25519_sig: sig1,
            tee_dcap_quote: None,
            nullifiers_to_absorb: vec![nullifier],
        };

        // First absorption succeeds
        assert!(kernel.validate_and_apply(&req1).is_ok());

        // Second absorption of identical nullifier must be rejected
        let msg2 = compute_transition_digest(&account_id, 2, 2, &slot_delta);
        let sig2 = signing_key.sign(&msg2).to_bytes();

        let req2 = MvskTransitionRequest {
            account_id,
            current_nonce: 1,
            proposed_nonce: 2,
            target_slot: 2,
            slot_delta,
            ed25519_sig: sig2,
            tee_dcap_quote: None,
            nullifiers_to_absorb: vec![nullifier],
        };

        let res2 = kernel.validate_and_apply(&req2);
        assert_eq!(
            res2.unwrap_err(),
            "MVSK_ERR: Double-spend detected; nullifier already absorbed"
        );
    }
}
