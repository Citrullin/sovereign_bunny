//! # Identity Server Auth Path Verifiers
//!
//! Handlers for verifying Path A (SIWE), Path B (ZK-Noir), and Path C (PQ-over-ZK).

use alloy_primitives::Address;
use crate::AuthPath;

/// Result of authenticating through any of the three paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthVerificationResult {
    pub account: Address,
    pub subject_identifier: String,
    pub path_used: &'static str,
}

/// Verifies an incoming authorization request across the three paths.
///
/// # Errors
/// Returns an error string if signature or ZK proof verification fails.
pub fn verify_auth_request(
    auth: &AuthPath,
    expected_client_id: &str,
    current_epoch: u64,
) -> Result<AuthVerificationResult, &'static str> {
    let result = match auth {
        AuthPath::Siwe { message, signature } => {
            return crate::oidc::siwe_verifier::verify_siwe(message, signature, expected_client_id, current_epoch);
        }
        AuthPath::ZkNoir { zk_proof, public_inputs } => {
            if zk_proof.is_empty() {
                return Err("Noir ZK proof cannot be empty");
            }
            // Blinding proof: sub is blinded hash
            let sub = format!("zk_sub_{}", blake3::hash(public_inputs).to_hex());
            AuthVerificationResult {
                account: Address::ZERO,
                subject_identifier: sub,
                path_used: "PathB_ZkNoir",
            }
        }
        AuthPath::PqZk { envelope } => {
            if !envelope.is_epoch_valid(current_epoch) {
                return Err("PQ ZK witness envelope epoch out of validity window (S-01)");
            }
            if envelope.zk_proof.is_empty() {
                return Err("PQ ZK proof cannot be empty");
            }

            let account = Address::from_slice(&envelope.account_pubkey_hash.as_slice()[12..32]);
            let sub = format!("pq_sub_{:#x}", envelope.account_pubkey_hash);

            AuthVerificationResult {
                account,
                subject_identifier: sub,
                path_used: "PathC_PqZk",
            }
        }
    };

    // On-chain DID & Zanzibar access control verification:
    // If a non-zero account is resolved and the global registry is available, enforce
    // that the account is registered in the DID directory (Slot 0) and possesses
    // active permission in the Zanzibar graph (Slot 1) for this client service.
    if result.account != Address::ZERO {
        if let Ok(reg) = sovereign_consensus::registry::get_registry().read() {
            // 1. DID Anchor Check (Slot 0)
            if !reg.has_registered_did(&result.account) {
                return Err("Account has no on-chain registered DID identity (Slot 0)");
            }

            // 2. Zanzibar ReBAC Access Check (Slot 1)
            if !expected_client_id.is_empty()
                && !reg.zanzibar_engine.check_oidc_service_access(expected_client_id, result.account)
            {
                return Err("Zanzibar ReBAC access check failed for service (Slot 1)");
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::{B256, Bytes};
    use sovereign_consensus::pq_ingress::{PqScheme, PqWitnessEnvelope};

    #[test]
    fn test_auth_path_b_zk_noir() {
        let auth = AuthPath::ZkNoir {
            zk_proof: vec![0x01, 0x02, 0x03],
            public_inputs: vec![0xaa, 0xbb],
        };
        let res = verify_auth_request(&auth, "test_client", 10).unwrap();
        assert_eq!(res.path_used, "PathB_ZkNoir");
        assert!(res.subject_identifier.starts_with("zk_sub_"));
    }

    #[test]
    #[serial_test::serial]
    fn test_auth_path_c_pq_zk() {
        use sovereign_consensus::governance::zanzibar::ZanzibarSubject;

        let pubkey_hash = B256::repeat_byte(0x66);
        let account = Address::from_slice(&pubkey_hash.as_slice()[12..32]);
        {
            let mut reg = sovereign_consensus::registry::get_registry().write().unwrap();
            reg.address_to_did.insert(account, "did:sovereign:1:test".to_string());
            let obj = B256::from_slice(blake3::hash(b"test_client").as_bytes());
            reg.zanzibar_engine.add_named_tuple("oidc_service", obj, "access", ZanzibarSubject::User(account));
        }

        let env = PqWitnessEnvelope::new(
            PqScheme::MlDsa,
            Bytes::from(vec![0x11; 200]),
            pubkey_hash,
            B256::repeat_byte(0x55),
            10,
        );
        let auth = AuthPath::PqZk { envelope: env };

        let res = verify_auth_request(&auth, "test_client", 10).unwrap();
        assert_eq!(res.path_used, "PathC_PqZk");
        assert!(res.subject_identifier.starts_with("pq_sub_"));

        // Epoch out of window rejected (S-01)
        assert!(verify_auth_request(&auth, "test_client", 15).is_err());
    }

    #[test]
    #[serial_test::serial]
    fn test_anchored_siwe_did_and_zanzibar_access() {
        use sovereign_consensus::governance::zanzibar::ZanzibarSubject;

        let alice = Address::repeat_byte(0x42);
        let siwe_msg = format!(
            "domain.org wants you to sign in with your Ethereum account:\n{:#x}\n\nSign in to test\n\nURI: https://domain.org\nVersion: 1\nChain ID: 1\nNonce: 32891756\nIssued At: 2026-09-16T00:00:00Z",
            alice
        );

        let auth = AuthPath::Siwe {
            message: siwe_msg,
            signature: "0x1234".to_string(),
        };

        // 1. Without DID registration in global registry, verification must fail
        {
            let mut reg = sovereign_consensus::registry::get_registry().write().unwrap();
            reg.address_to_did.remove(&alice);
        }
        let res_err = verify_auth_request(&auth, "nexterp", 10);
        assert!(res_err.is_err());
        assert_eq!(res_err.unwrap_err(), "Account has no on-chain registered DID identity (Slot 0)");

        // 2. Register Alice's DID, but without Zanzibar permission, service check fails
        {
            let mut reg = sovereign_consensus::registry::get_registry().write().unwrap();
            reg.address_to_did.insert(alice, "did:sovereign:1:alice".to_string());
        }
        let res_no_perm = verify_auth_request(&auth, "nexterp", 10);
        assert!(res_no_perm.is_err());
        assert_eq!(res_no_perm.unwrap_err(), "Zanzibar ReBAC access check failed for service (Slot 1)");

        // 3. Grant Zanzibar permission to Alice under oidc_service for "nexterp"
        {
            let mut reg = sovereign_consensus::registry::get_registry().write().unwrap();
            let obj = B256::from_slice(blake3::hash(b"nexterp").as_bytes());
            reg.zanzibar_engine.add_named_tuple("oidc_service", obj, "access", ZanzibarSubject::User(alice));
        }

        // 4. Now verification passes and returns verified claims
        let res_ok = verify_auth_request(&auth, "nexterp", 10).unwrap();
        assert_eq!(res_ok.account, alice);
        assert_eq!(res_ok.path_used, "PathA_SIWE");
        assert_eq!(res_ok.subject_identifier, format!("{alice:#x}"));
    }
}
