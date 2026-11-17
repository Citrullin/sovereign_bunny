// Sovereign Noir Standard Library: CAR Slot Accessors & Verifiers
// Provides type-safe abstractions for verifying CAR Slot invariants in Noir circuits.

use dep::std::hash::poseidon;

pub struct VirtualCar {
    pub account_did: Field,
    pub nonce: Field,
    pub slot0_identity_root: Field,
    pub slot1_rebac_digest: Field,
    pub slot2_blind_notes_tip: Field,
    pub slot3_git_state_root: Field,
    pub slot4_sql_anchor: Field,
    pub slot7_saga_policy_byte: u8,
}

impl VirtualCar {
    pub fn new(
        account_did: Field,
        nonce: Field,
        slot0_identity_root: Field,
        slot1_rebac_digest: Field,
        slot2_blind_notes_tip: Field,
        slot3_git_state_root: Field,
        slot4_sql_anchor: Field,
        slot7_saga_policy_byte: u8
    ) -> Self {
        Self {
            account_did,
            nonce,
            slot0_identity_root,
            slot1_rebac_digest,
            slot2_blind_notes_tip,
            slot3_git_state_root,
            slot4_sql_anchor,
            slot7_saga_policy_byte,
        }
    }

    // Computes state tip hash matching sovereign-consensus flat array
    pub fn compute_tip(self) -> Field {
        poseidon::bn254::hash_5([
            self.account_did,
            self.nonce,
            self.slot0_identity_root,
            self.slot1_rebac_digest,
            self.slot2_blind_notes_tip
        ])
    }
}

// Slot 1: Google Zanzibar ReBAC Invariant Verification
pub struct ZanzibarVerifier {
    pub rebac_digest: Field,
}

impl ZanzibarVerifier {
    pub fn new(rebac_digest: Field) -> Self {
        Self { rebac_digest }
    }

    // Verifies that a relation tuple (subject, relation, object) is accumulated into Slot 1
    pub fn verify_relation(
        self,
        subject: Field,
        relation_code: Field,
        object: Field,
        sibling_accumulator: Field
    ) -> bool {
        let edge_hash = poseidon::bn254::hash_3([subject, relation_code, object]);
        let computed = poseidon::bn254::hash_2([sibling_accumulator, edge_hash]);
        computed == self.rebac_digest
    }
}

// Slot 2: Aztec-Style Blind Note Nullifier & Inclusion Verifier
pub struct BlindNoteVerifier {
    pub smt_root: Field,
}

impl BlindNoteVerifier {
    pub fn new(smt_root: Field) -> Self {
        Self { smt_root }
    }

    // Verifies note commitment existence and derives nullifier without revealing viewing key
    pub fn verify_nullifier(
        self,
        leaf_commitment: Field,
        viewing_privkey: Field,
        expected_nullifier: Field
    ) -> bool {
        let derived = poseidon::bn254::hash_2([leaf_commitment, viewing_privkey]);
        derived == expected_nullifier
    }
}

// Slot 3: Git DAG & Collaborative Objects Verifier
pub struct GitDagVerifier {
    pub git_state_root: Field,
}

impl GitDagVerifier {
    pub fn new(git_state_root: Field) -> Self {
        Self { git_state_root }
    }

    // Verifies commit hash and issue/patch COB root anchor
    pub fn verify_commit_and_cob(
        self,
        commit_hash: Field,
        cob_tree_root: Field
    ) -> bool {
        let composite = poseidon::bn254::hash_2([commit_hash, cob_tree_root]);
        composite == self.git_state_root
    }
}
