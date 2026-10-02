//! # Regulatory Authority Functions, View Requests, and Cross-Border Cooperation
//!
//! Models regulatory authorities as sovereign actors with verifiable capability checks:
//! - ZkComplianceFunction: Programmable compliance function pushed to regulated accounts.
//! - ViewRequest: Private viewing key request referencing a verified court document/warrant.
//! - CrossBorderCoop: Mutual legal assistance request between independent regulatory authorities.

use alloy_primitives::{Address, B256, Bytes};
use serde::{Deserialize, Serialize};

/// A zero-knowledge compliance function that an authority instructs a regulated account to execute.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ZkComplianceFunction {
    /// Authority issuing the compliance mandate
    pub authority: Address,
    /// Target regulated account
    pub target_account: Address,
    /// 32-byte hash of the Noir circuit or WASM verification program
    pub compliance_program_hash: B256,
    /// Parameters/constraints passed into the compliance circuit
    pub parameters: Bytes,
    /// Deadline epoch for executing and verifying compliance
    pub deadline_epoch: u64,
}

/// A request from an authority to view private note state or specific slot changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorityViewRequest {
    /// Requesting regulatory authority
    pub authority: Address,
    /// Target account being inspected
    pub target_account: Address,
    /// Cryptographic hash of the court order, warrant, or formal investigation document
    pub court_document_hash: B256,
    /// Target register slot or note commitment to be decrypted
    pub target_commitment: B256,
    /// Epoch of warrant issuance
    pub issued_epoch: u64,
}

impl AuthorityViewRequest {
    /// Validates whether the requesting authority holds the required Zanzibar capability
    /// (e.g. `can_issue_view_request` or `supervisor_of`) over the target account or namespace.
    #[must_use]
    pub fn verify_authority_capability(
        &self,
        zanzibar: &super::zanzibar::ZanzibarGraphEngine,
    ) -> bool {
        let target_b256 = B256::from_slice(&[self.target_account.as_slice(), &[0u8; 12]].concat());
        zanzibar.check_named("authority", target_b256, "can_issue_view_request", self.authority, 5)
            || zanzibar.check_named("compliance", target_b256, "supervisor_of", self.authority, 5)
            || zanzibar.check_named("dao", target_b256, "auditor", self.authority, 5)
    }

    /// Reveals an authorized viewing key and returns the created ViewingAuditLog entry.
    pub fn reveal_viewing_key(
        &self,
        viewing_key_pair: &crate::lattice::viewing_key::ViewingKeyPair,
        audit_epoch: u64,
    ) -> (crate::lattice::viewing_key::ViewingKeyPair, crate::lattice::viewing_key::ViewingAuditLog) {
        let audit_log = crate::lattice::viewing_key::ViewingAuditLog {
            audited_account: self.target_account,
            auditor: self.authority,
            court_order_hash: self.court_document_hash,
            epoch: audit_epoch,
            target_commitment: self.target_commitment,
        };

        (viewing_key_pair.clone(), audit_log)
    }
}

/// Inter-agency cross-border mutual assistance request between regulatory authorities.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrossBorderCoopRequest {
    /// Requesting foreign authority
    pub requesting_authority: Address,
    /// Counterpart domestic authority
    pub counterpart_authority: Address,
    /// Treaty or cooperation mandate reference hash
    pub treaty_reference_hash: B256,
    /// Encrypted bilateral note payload
    pub encrypted_payload: Bytes,
    /// Request timestamp / epoch
    pub epoch: u64,
}
