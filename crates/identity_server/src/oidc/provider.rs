//! # OIDC Identity Provider Surface
//!
//! Provides the core endpoints conforming to OpenID Connect Discovery 1.0
//! and Core 1.0 specifications:
//! - `get_openid_configuration`: `/.well-known/openid-configuration`
//! - `handle_authorization`: `/authorize`
//! - `handle_token_exchange`: `/token`
//! - `handle_userinfo`: `/userinfo`
//! - `handle_jwks`: `/.well-known/jwks.json`

use alloy_primitives::{Address, B256};
use serde::{Deserialize, Serialize};
use crate::session::{SessionCache, SessionRecord};
use crate::verifier::{verify_auth_request, AuthVerificationResult};
use crate::{AuthPath, IdTokenClaims, OidcConfiguration};

/// In-flight authorization code record mapped to verified claims.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthCodeRecord {
    pub code: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub claims: IdTokenClaims,
    pub created_at: u64,
    pub expires_at: u64,
}

/// Token endpoint response payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub id_token: String,
    pub expires_in: u64,
    pub session_id: String,
    pub gas_sponsored: bool,
}

/// Userinfo endpoint response payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfoResponse {
    pub sub: String,
    pub address: String,
    pub did: String,
    pub zanzibar_root: String,
}

/// State of the OIDC Identity Provider instance.
pub struct OidcProvider {
    pub config: OidcConfiguration,
    pub session_cache: SessionCache,
    pub ephemeral_keys: crate::session::ephemeral_key::EphemeralKeyManager,
    pub auth_codes: std::sync::Arc<std::sync::RwLock<std::collections::HashMap<String, AuthCodeRecord>>>,
}

impl OidcProvider {
    #[must_use]
    pub fn new(issuer: &str) -> Self {
        Self {
            config: OidcConfiguration::new(issuer),
            session_cache: SessionCache::new(),
            ephemeral_keys: crate::session::ephemeral_key::EphemeralKeyManager::new(),
            auth_codes: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// OpenID Connect Discovery document endpoint: `GET /.well-known/openid-configuration`
    #[must_use]
    pub fn get_openid_configuration(&self) -> OidcConfiguration {
        self.config.clone()
    }

    /// Handles authentication and issues an authorization code: `/authorize`
    pub fn handle_authorization(
        &self,
        client_id: &str,
        redirect_uri: &str,
        auth_path: &AuthPath,
        current_epoch: u64,
        now_secs: u64,
    ) -> Result<String, &'static str> {
        if client_id.is_empty() {
            return Err("Missing client_id in authorization request");
        }

        // 1. Verify credentials, Slot 0 DID anchor, and Slot 1 Zanzibar permissions
        let verified: AuthVerificationResult = verify_auth_request(auth_path, client_id, current_epoch)?;

        // 2. Fetch active Zanzibar root from global registry
        let zanzibar_root = sovereign_consensus::registry::get_registry()
            .read()
            .map(|r| r.zanzibar_engine.compute_rebac_root())
            .unwrap_or(B256::ZERO);

        let code_bytes = blake3::hash(format!("{}:{}:{}:{}", verified.subject_identifier, client_id, now_secs, rand_seed()).as_bytes());
        let code = format!("code_{}", code_bytes.to_hex());

        let claims = IdTokenClaims {
            iss: self.config.issuer.clone(),
            sub: verified.subject_identifier,
            aud: client_id.to_string(),
            exp: now_secs + 3600,
            iat: now_secs,
            nonce: None,
            account_address: verified.account,
            zanzibar_root,
        };

        let record = AuthCodeRecord {
            code: code.clone(),
            client_id: client_id.to_string(),
            redirect_uri: redirect_uri.to_string(),
            claims,
            created_at: now_secs,
            expires_at: now_secs + 300, // 5 min expiry for auth code
        };

        self.auth_codes.write().unwrap().insert(code.clone(), record);
        Ok(code)
    }

    /// Exchanges authorization code for access token, ID token, and session: `/token`
    pub fn handle_token_exchange(
        &self,
        code: &str,
        client_id: &str,
        now_secs: u64,
    ) -> Result<TokenResponse, &'static str> {
        let record = self.auth_codes.write().unwrap().remove(code)
            .ok_or("Invalid or already redeemed authorization code")?;

        if record.expires_at < now_secs {
            return Err("Authorization code has expired");
        }
        if record.client_id != client_id {
            return Err("Client ID mismatch for authorization code");
        }

        // Create ephemeral session with blind note commitment
        let ep_session = self.ephemeral_keys.create_session(
            record.claims.account_address,
            client_id,
            now_secs,
            86400,
        );
        let session_id = ep_session.key_id.clone();

        // Cache authenticated session with 24-hour TTL and grant gas sponsorship
        let session = SessionRecord {
            session_id: session_id.clone(),
            account: record.claims.account_address,
            client_id: client_id.to_string(),
            expires_at: ep_session.expires_at,
            gas_sponsored: ep_session.gas_sponsored,
        };
        self.session_cache.insert(session);

        // Encode ID token payload as JSON (in a production JWT setting, signed with IdP key)
        let id_token = serde_json::to_string(&record.claims).map_err(|_| "Failed to serialize ID token claims")?;

        let access_token = format!("at_{}", blake3::hash(format!("{}:access", session_id).as_bytes()).to_hex());

        Ok(TokenResponse {
            access_token,
            token_type: "Bearer".to_string(),
            id_token,
            expires_in: 3600,
            session_id,
            gas_sponsored: record.claims.account_address != Address::ZERO,
        })
    }

    /// Retrieves claims for an active authenticated session: `/userinfo`
    pub fn handle_userinfo(&self, session_id: &str, now_secs: u64) -> Result<UserInfoResponse, &'static str> {
        self.session_cache.prune_expired(now_secs);
        let session = self.session_cache.get(session_id).ok_or("Invalid or expired session")?;

        let (did, zanzibar_root) = if let Ok(reg) = sovereign_consensus::registry::get_registry().read() {
            let did = reg.get_did_by_address(&session.account)
                .unwrap_or_else(|| format!("did:sovereign:{:#x}", session.account));
            let root = reg.zanzibar_engine.compute_rebac_root();
            (did, format!("{root:#x}"))
        } else {
            (format!("did:sovereign:{:#x}", session.account), format!("{:#x}", B256::ZERO))
        };

        Ok(UserInfoResponse {
            sub: format!("{:#x}", session.account),
            address: format!("{:#x}", session.account),
            did,
            zanzibar_root,
        })
    }

    /// Returns JWKS public key set for ID token verification: `/.well-known/jwks.json`
    #[must_use]
    pub fn handle_jwks(&self) -> serde_json::Value {
        serde_json::json!({
            "keys": [
                {
                    "kty": "OKP",
                    "crv": "Ed25519",
                    "use": "sig",
                    "kid": "sovereign-bunny-idp-v1",
                    "alg": "EdDSA"
                },
                {
                    "kty": "ZK",
                    "crv": "BN254",
                    "use": "sig",
                    "kid": "sovereign-bunny-zk-ultrahonk",
                    "alg": "ZK-UltraHonk"
                }
            ]
        })
    }
}

fn rand_seed() -> u64 {
    use std::time::SystemTime;
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_nanos() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use sovereign_consensus::governance::zanzibar::ZanzibarSubject;

    #[test]
    #[serial_test::serial]
    fn test_oidc_full_lifecycle_flow() {
        let provider = OidcProvider::new("https://siwe.homelab.local");
        let alice = Address::repeat_byte(0x55);
        let client_id = "nexterp";
        let now = 1770000000;

        // 1. Setup on-chain DID and Zanzibar access
        {
            let mut reg = sovereign_consensus::registry::get_registry().write().unwrap();
            reg.address_to_did.insert(alice, "did:sovereign:1:alice".to_string());
            let obj = B256::from_slice(blake3::hash(client_id.as_bytes()).as_bytes());
            reg.zanzibar_engine.add_named_tuple("oidc_service", obj, "access", ZanzibarSubject::User(alice));
        }

        // 2. Authorize
        let siwe_msg = format!(
            "domain.org wants you to sign in with your Ethereum account:\n{:#x}\n\nSign in to test\n\nURI: https://domain.org\nVersion: 1\nChain ID: 1\nNonce: 32891756\nIssued At: 2026-09-16T00:00:00Z",
            alice
        );
        let auth = AuthPath::Siwe { message: siwe_msg, signature: "0x123".to_string() };

        let code = provider.handle_authorization(client_id, "https://erp.homelab.local/callback", &auth, 10, now).unwrap();
        assert!(code.starts_with("code_"));

        // 3. Token exchange
        let token_resp = provider.handle_token_exchange(&code, client_id, now + 10).unwrap();
        assert_eq!(token_resp.token_type, "Bearer");
        assert!(token_resp.gas_sponsored);

        // 4. Userinfo check
        let userinfo = provider.handle_userinfo(&token_resp.session_id, now + 20).unwrap();
        assert_eq!(userinfo.address, format!("{alice:#x}"));
        assert_eq!(userinfo.did, "did:sovereign:1:alice");
    }
}
