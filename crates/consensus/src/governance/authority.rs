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

/// Supported cryptographic curve profile for authority public keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AuthorityCurveProfile {
    Secp256k1,
    P256,
    Ed25519,
    MlDsa,
    Falcon,
}

/// An immutable Authority Root Record anchored to consensus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorityRootRecord {
    pub authority_id: String,
    pub primary_address: Address,
    pub curve_profile: AuthorityCurveProfile,
    pub public_key: Bytes,
    pub epoch_from: u64,
    pub supersedes_authority_id: Option<String>,
    pub metadata_digest: B256,
}

impl AuthorityRootRecord {
    #[must_use]
    pub fn compute_record_digest(&self) -> B256 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"authority.root.record.v1");
        hasher.update(self.authority_id.as_bytes());
        hasher.update(self.primary_address.as_slice());
        hasher.update(&[self.curve_profile as u8]);
        hasher.update(self.public_key.as_ref());
        hasher.update(&self.epoch_from.to_le_bytes());
        if let Some(ref sup) = self.supersedes_authority_id {
            hasher.update(sup.as_bytes());
        }
        hasher.update(self.metadata_digest.as_slice());
        B256::from_slice(hasher.finalize().as_bytes())
    }
}

/// A ballot cast by an eligible appointer in an authority-change election.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorityVoteBallot {
    pub voter: Address,
    pub proposed_authority_digest: B256,
    pub epoch: u64,
    pub in_favor: bool,
    pub signature: Bytes,
}

/// Two-phase epoch window consensus configuration for authority appointments.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorityElectionConfig {
    pub reg_window_epochs: u64,
    pub vote_window_epochs: u64,
    pub min_quorum_participants: usize,
}

impl Default for AuthorityElectionConfig {
    fn default() -> Self {
        Self {
            reg_window_epochs: 3,
            vote_window_epochs: 5,
            min_quorum_participants: 3,
        }
    }
}

/// Tracks the lifecycle of an in-flight authority change proposal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorityProposalState {
    pub proposed_record: AuthorityRootRecord,
    pub proposed_digest: B256,
    pub proposal_epoch: u64,
    pub reg_close_epoch: u64,
    pub vote_close_epoch: u64,
    pub registered_voters: std::collections::HashSet<Address>,
    pub cast_votes: std::collections::HashMap<Address, bool>,
}

/// Authority Registry tracking current root, historical roots by epoch, and two-phase election consensus.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorityRegistry {
    pub active_root: AuthorityRootRecord,
    pub history: Vec<AuthorityRootRecord>,
    pub election_config: AuthorityElectionConfig,
    pub active_proposal: Option<AuthorityProposalState>,
}

impl AuthorityRegistry {
    #[must_use]
    pub fn new(genesis_root: AuthorityRootRecord, election_config: AuthorityElectionConfig) -> Self {
        Self {
            active_root: genesis_root,
            history: Vec::new(),
            election_config,
            active_proposal: None,
        }
    }

    /// Returns the active authority record at a specific logical epoch.
    #[must_use]
    pub fn get_authority_at_epoch(&self, epoch: u64) -> &AuthorityRootRecord {
        if self.active_root.epoch_from <= epoch {
            return &self.active_root;
        }
        for record in self.history.iter().rev() {
            if record.epoch_from <= epoch {
                return record;
            }
        }
        &self.active_root
    }

    /// Initiates an authority replacement proposal (Phase 1 registration window opens).
    pub fn propose_authority_change(
        &mut self,
        new_record: AuthorityRootRecord,
        current_epoch: u64,
    ) -> Result<B256, &'static str> {
        if self.active_proposal.is_some() {
            return Err("An authority election is already active");
        }
        let digest = new_record.compute_record_digest();
        let reg_close = current_epoch + self.election_config.reg_window_epochs;
        let vote_close = reg_close + self.election_config.vote_window_epochs;

        self.active_proposal = Some(AuthorityProposalState {
            proposed_record: new_record,
            proposed_digest: digest,
            proposal_epoch: current_epoch,
            reg_close_epoch: reg_close,
            vote_close_epoch: vote_close,
            registered_voters: std::collections::HashSet::new(),
            cast_votes: std::collections::HashMap::new(),
        });

        Ok(digest)
    }

    /// Phase 1: Registers participation intent during registration window.
    pub fn register_participation(&mut self, voter: Address, current_epoch: u64) -> Result<(), &'static str> {
        let proposal = self.active_proposal.as_mut().ok_or("No active authority election")?;
        if current_epoch > proposal.reg_close_epoch {
            return Err("Participation registration window has closed");
        }
        proposal.registered_voters.insert(voter);
        Ok(())
    }

    /// Phase 2: Casts a vote ballot during voting window.
    pub fn cast_vote(&mut self, ballot: AuthorityVoteBallot, current_epoch: u64) -> Result<(), &'static str> {
        let proposal = self.active_proposal.as_mut().ok_or("No active authority election")?;
        if current_epoch <= proposal.reg_close_epoch {
            return Err("Voting window is not open yet (currently in registration phase)");
        }
        if current_epoch > proposal.vote_close_epoch {
            return Err("Voting window has closed");
        }
        if ballot.proposed_authority_digest != proposal.proposed_digest {
            return Err("Ballot digest does not match active proposed authority");
        }
        if !proposal.registered_voters.contains(&ballot.voter) {
            return Err("Voter did not register during registration window (unregistered appointers are excluded from quorum)");
        }
        proposal.cast_votes.insert(ballot.voter, ballot.in_favor);
        Ok(())
    }

    /// Finalizes the election upon or past vote_close_epoch.
    /// Requires 2/3 supermajority of registered cohort (missing registered votes default to NO).
    pub fn finalize_election(&mut self, current_epoch: u64) -> Result<bool, &'static str> {
        let proposal = self.active_proposal.as_ref().ok_or("No active election to finalize")?;
        if current_epoch <= proposal.vote_close_epoch {
            return Err("Voting window is still open");
        }

        let registered_count = proposal.registered_voters.len();
        if registered_count < self.election_config.min_quorum_participants {
            self.active_proposal = None;
            return Err("Election failed: registered turnout fell below minimum quorum floor");
        }

        let mut votes_yes = 0usize;
        for voter in &proposal.registered_voters {
            if let Some(&in_favor) = proposal.cast_votes.get(voter) {
                if in_favor {
                    votes_yes += 1;
                }
            }
            // Missing registered vote defaults to NO
        }

        let supermajority_threshold = (registered_count * 2 + 2) / 3; // ceil(2/3 * registered_count)
        let proposal_state = self.active_proposal.take().unwrap();

        if votes_yes >= supermajority_threshold {
            let mut new_root = proposal_state.proposed_record;
            new_root.epoch_from = current_epoch;
            let old_root = std::mem::replace(&mut self.active_root, new_root);
            self.history.push(old_root);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_authority_two_phase_epoch_consensus_lifecycle() {
        let genesis_root = AuthorityRootRecord {
            authority_id: "eu.qtsp.genesis".to_string(),
            primary_address: Address::repeat_byte(0x01),
            curve_profile: AuthorityCurveProfile::Secp256k1,
            public_key: Bytes::from(vec![0x02; 33]),
            epoch_from: 0,
            supersedes_authority_id: None,
            metadata_digest: B256::repeat_byte(0x11),
        };

        let mut registry = AuthorityRegistry::new(genesis_root.clone(), AuthorityElectionConfig {
            reg_window_epochs: 2,
            vote_window_epochs: 3,
            min_quorum_participants: 3,
        });

        assert_eq!(registry.get_authority_at_epoch(5).authority_id, "eu.qtsp.genesis");

        // 1. Propose authority change at epoch 10
        let new_candidate = AuthorityRootRecord {
            authority_id: "eu.qtsp.v2".to_string(),
            primary_address: Address::repeat_byte(0x02),
            curve_profile: AuthorityCurveProfile::P256,
            public_key: Bytes::from(vec![0x03; 33]),
            epoch_from: 16,
            supersedes_authority_id: Some("eu.qtsp.genesis".to_string()),
            metadata_digest: B256::repeat_byte(0x22),
        };
        let proposal_digest = registry.propose_authority_change(new_candidate, 10).unwrap();

        let v1 = Address::repeat_byte(0x11);
        let v2 = Address::repeat_byte(0x22);
        let v3 = Address::repeat_byte(0x33);

        // 2. Phase 1: Register participation (epochs 10..12)
        registry.register_participation(v1, 11).unwrap();
        registry.register_participation(v2, 11).unwrap();
        registry.register_participation(v3, 12).unwrap();

        // Late registration at epoch 13 fails:
        assert!(registry.register_participation(Address::repeat_byte(0x44), 13).is_err());

        // 3. Premature voting at epoch 12 fails:
        let ballot_v1 = AuthorityVoteBallot {
            voter: v1,
            proposed_authority_digest: proposal_digest,
            epoch: 12,
            in_favor: true,
            signature: Bytes::new(),
        };
        assert!(registry.cast_vote(ballot_v1.clone(), 12).is_err());

        // 4. Phase 2: Vote in window (epochs 13..15)
        registry.cast_vote(AuthorityVoteBallot {
            epoch: 13,
            ..ballot_v1
        }, 13).unwrap();

        registry.cast_vote(AuthorityVoteBallot {
            voter: v2,
            proposed_authority_digest: proposal_digest,
            epoch: 14,
            in_favor: true,
            signature: Bytes::new(),
        }, 14).unwrap();

        // v3 does not vote -> defaults to NO

        // 5. Finalize election at epoch 16 (2/3 of 3 = 2 votes needed, got 2 YES)
        let passed = registry.finalize_election(16).unwrap();
        assert!(passed);

        // Active root is now eu.qtsp.v2
        assert_eq!(registry.get_authority_at_epoch(16).authority_id, "eu.qtsp.v2");
        // History at epoch 5 still resolves to genesis authority
        assert_eq!(registry.get_authority_at_epoch(5).authority_id, "eu.qtsp.genesis");
    }
}

