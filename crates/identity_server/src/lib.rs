//! # Sovereign OIDC Identity Server
//!
//! Forked architecture from SpruceID siwe-oidc, serving as a dedicated OIDC Identity Provider (IdP):
//! - Path A: SIWE (Sign-In with Ethereum, EIP-4361 standard)
//! - Path B: ZK-Noir (zkOIDC proof of identity blinding)
//! - Path C: PQ-over-ZK (succinct ZK proof of post-quantum signature, raw PQ never hits network)

pub mod oidc;
pub mod session;
pub mod verifier;

pub use oidc::provider::OidcProvider;

use alloy_primitives::{Address, B256};
use serde::{Deserialize, Serialize};

/// Standard OIDC configuration response conforming to OpenID Connect Discovery 1.0.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OidcConfiguration {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub userinfo_endpoint: String,
    pub jwks_uri: String,
    pub response_types_supported: Vec<String>,
    pub subject_types_supported: Vec<String>,
    pub id_token_signing_alg_values_supported: Vec<String>,
}

impl OidcConfiguration {
    #[must_use]
    pub fn new(issuer: &str) -> Self {
        Self {
            issuer: issuer.to_string(),
            authorization_endpoint: format!("{issuer}/authorize"),
            token_endpoint: format!("{issuer}/token"),
            userinfo_endpoint: format!("{issuer}/userinfo"),
            jwks_uri: format!("{issuer}/.well-known/jwks.json"),
            response_types_supported: vec!["code".to_string(), "id_token".to_string()],
            subject_types_supported: vec!["public".to_string(), "pairwise".to_string()],
            id_token_signing_alg_values_supported: vec!["RS256".to_string(), "EdDSA".to_string(), "ZK-UltraHonk".to_string()],
        }
    }
}

/// Verification path chosen by the authenticating client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthPath {
    /// Standard EVM wallet signature (EIP-4361)
    Siwe { message: String, signature: String },
    /// Zero-knowledge blinding proof (Noir UltraHonk)
    ZkNoir { zk_proof: Vec<u8>, public_inputs: Vec<u8> },
    /// Post-quantum key possession proven via succinct ZK witness envelope
    PqZk { envelope: sovereign_consensus::pq_ingress::PqWitnessEnvelope },
}

/// Claims delivered in the issued ID token.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdTokenClaims {
    pub iss: String,
    pub sub: String,
    pub aud: String,
    pub exp: u64,
    pub iat: u64,
    pub nonce: Option<String>,
    pub account_address: Address,
    pub zanzibar_root: B256,
}
