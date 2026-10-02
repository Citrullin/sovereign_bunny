//! # X-Road Service Descriptor & Governance Envelopes
//!
//! Models regulatory and inter-agency cross-border cooperation as microservice actors.
//! Authorities host verifiable service descriptors in Slot 5 of their CAR account.

use alloy_primitives::{B256, Bytes};
use serde::{Deserialize, Serialize};

/// Type of X-Road envelope payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum XRoadPayloadType {
    /// Judicial court order or warrant
    CourtOrder,
    /// ZK compliance function requiring execution
    ZkComplianceFunction,
    /// Private viewing key request on regulated address
    ViewKeyRequest,
    /// Inter-agency cross-border mutual assistance request
    CrossBorderCoopRequest,
    /// Official document attestation
    DocumentAttestation,
    /// Supply-chain regulatory audit record
    SupplyChainRecord,
}

/// Service descriptor anchored in Slot 5 of an authority's CAR account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct XRoadServiceDescriptor {
    /// Authority identifier (e.g. "EE/GOV/70001490/treasury")
    pub member_code: String,
    /// Subsystem service name (e.g. "asset-compliance-v1")
    pub service_code: String,
    /// Cryptographic hash of the active X.509 TLS and signing certificates
    pub cert_hash: B256,
    /// Blake3 hash of the HTTPS/gRPC X-Road security server endpoint URI
    pub endpoint_hash: B256,
    /// Epoch of last certificate rotation or descriptor update
    pub updated_epoch: u64,
}

impl XRoadServiceDescriptor {
    /// Computes cryptographic commitment for Slot 5 storage.
    #[must_use]
    pub fn compute_slot5_commitment(&self) -> B256 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"sovereign:xroad:slot5:v1:");
        hasher.update(self.member_code.as_bytes());
        hasher.update(self.service_code.as_bytes());
        hasher.update(self.cert_hash.as_slice());
        hasher.update(self.endpoint_hash.as_slice());
        hasher.update(&self.updated_epoch.to_le_bytes());
        B256::from_slice(hasher.finalize().as_bytes())
    }
}

/// On-chain or inter-actor envelope carrying an X-Road message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct XRoadEnvelope {
    /// Unique internal message identifier
    pub message_id: B256,
    /// X-Road protocol transaction identifier
    pub xroad_message_id: B256,
    /// Cryptographic hash of the court order, warrant, or formal document
    pub court_document_hash: B256,
    /// Merkle root of the authority's certificate chain
    pub cert_chain_root: B256,
    /// Envelope payload category
    pub payload_type: XRoadPayloadType,
    /// Encrypted or CBOR-encoded payload data
    pub payload_data: Bytes,
}

impl XRoadEnvelope {
    /// Computes the Merkle root of a certificate chain array (e.g. investigator, supervisor, ministry).
    #[must_use]
    pub fn compute_cert_chain_root(cert_hashes: &[B256]) -> B256 {
        if cert_hashes.is_empty() {
            return B256::ZERO;
        }
        let mut current = cert_hashes.to_vec();
        while current.len() > 1 {
            let mut next = Vec::new();
            for chunk in current.chunks(2) {
                let mut hasher = blake3::Hasher::new();
                hasher.update(b"sovereign:cert_chain:node:v1:");
                hasher.update(chunk[0].as_slice());
                if chunk.len() > 1 {
                    hasher.update(chunk[1].as_slice());
                } else {
                    hasher.update(chunk[0].as_slice());
                }
                next.push(B256::from_slice(hasher.finalize().as_bytes()));
            }
            current = next;
        }
        current[0]
    }

    /// Verifies that the envelope's cert_chain_root matches the expected certificate chain hashes.
    #[must_use]
    pub fn verify_cert_chain(&self, cert_hashes: &[B256]) -> bool {
        self.cert_chain_root == Self::compute_cert_chain_root(cert_hashes)
    }
}
