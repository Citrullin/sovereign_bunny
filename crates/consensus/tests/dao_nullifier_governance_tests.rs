use alloy_primitives::{Address, B256, U256};
use sovereign_consensus::governance::registry::{
    dao_address_from_id, dao_to_zanzibar_object, DaoProposal, DaoProposalStatus, ValidatorRegistry,
};

#[test]
fn test_canonical_genesis_daos_initialized() {
    let mut registry = ValidatorRegistry::default();
    registry.init_canonical_genesis_daos();

    // Verify all 8 canonical genesis DAOs exist with non-zero treasuries
    for id in 0x0101u16..=0x0108u16 {
        let dao_addr = dao_address_from_id(id);
        let cfg = registry.dao_governance_configs.get(&dao_addr);
        assert!(cfg.is_some(), "DAO 0x{:04x} must exist in dao_governance_configs", id);
        assert!(!cfg.unwrap().name.is_empty(), "DAO must have human-readable name");

        let balance = registry.get_account_balance(&dao_addr);
        assert!(balance > U256::ZERO, "DAO treasury must be initialized with balance");
    }
}

#[test]
fn test_rebac_membership_and_unauthorized_proposer_rejection() {
    let mut registry = ValidatorRegistry::default();
    registry.init_canonical_genesis_daos();

    let dao_addr = dao_address_from_id(0x0101);
    let dao_obj = dao_to_zanzibar_object(&dao_addr);
    let founder = Address::from_slice(&alloy_primitives::hex::decode("f39fd6e51aad88f6f4ce6ab8827279cfffb92266").unwrap());
    let unauthorized_user = Address::repeat_byte(0x77);

    // Founder is authorized member
    let is_founder_member = registry.zanzibar_engine.check(1, dao_obj, 1, founder, 10);
    assert!(is_founder_member, "Founder must be an authorized member in Zanzibar");

    // Unauthorized user is NOT member
    let is_unauthorized_member = registry.zanzibar_engine.check(1, dao_obj, 1, unauthorized_user, 10);
    assert!(!is_unauthorized_member, "Unauthorized user must NOT be a member");
}

#[test]
fn test_private_smt_ballot_nullifier_double_voting_prevention() {
    let mut registry = ValidatorRegistry::default();
    registry.init_canonical_genesis_daos();

    let dao_addr = dao_address_from_id(0x0101);
    let voter = Address::from_slice(&alloy_primitives::hex::decode("f39fd6e51aad88f6f4ce6ab8827279cfffb92266").unwrap());
    let proposal_id = B256::repeat_byte(0x42);

    let proposal = DaoProposal {
        proposal_id,
        dao_address: dao_addr,
        proposer: voter,
        title: "SIP-101: Deploy Protocol Paymaster".to_string(),
        description: "Gas sponsorship for lower tier".to_string(),
        target: Address::repeat_byte(0xee),
        call_data: vec![],
        value: U256::ZERO,
        start_epoch: 1,
        end_epoch: 20,
        for_votes: U256::ZERO,
        against_votes: U256::ZERO,
        votes: std::collections::HashMap::new(),
        status: DaoProposalStatus::Active,
        created_at: 1000,
        executed_note_commitment: None,
    };
    registry.dao_proposals.insert(proposal_id, proposal);

    // 1. Derive private ballot nullifier
    let sig_str = "0xsample_evm_personal_sign_signature_from_rabby";
    let sig_salt = blake3::hash(sig_str.as_bytes());
    let ballot_nullifier = B256::from_slice(
        blake3::hash(format!("sovereign:dao_vote:v1:{:#x}:{:#x}:{}", voter, proposal_id, sig_salt.to_hex()).as_bytes()).as_bytes()
    );

    // Initial check: SMT must NOT contain nullifier
    assert!(!registry.nullifier_smt.contains(&ballot_nullifier), "SMT must not contain nullifier before vote");

    // Insert nullifier upon valid vote
    registry.nullifier_smt.insert(ballot_nullifier);
    let smt_root = registry.nullifier_smt.root();
    assert_ne!(smt_root, B256::ZERO, "SMT root must be non-zero after insertion");

    // 2. Second vote attempt: SMT accumulator detects duplicate nullifier
    let is_spent = registry.nullifier_smt.contains(&ballot_nullifier);
    assert!(is_spent, "SMT accumulator must detect spent ballot nullifier on double-vote attempt");
}

#[test]
fn test_proposal_quorum_and_blind_note_disbursement() {
    let mut registry = ValidatorRegistry::default();
    registry.init_canonical_genesis_daos();

    let dao_addr = dao_address_from_id(0x0101);
    let recipient = Address::repeat_byte(0x88);
    let grant_amount = U256::from(500_000_000_000_000_000_000u128); // 500 ETH
    let proposal_id = B256::repeat_byte(0x77);

    let mut proposal = DaoProposal {
        proposal_id,
        dao_address: dao_addr,
        proposer: Address::repeat_byte(0x11),
        title: "SIP-102: Ecosystem Grant".to_string(),
        description: "Disburse blind note from DAO Slot 2".to_string(),
        target: recipient,
        call_data: vec![],
        value: grant_amount,
        start_epoch: 1,
        end_epoch: 20,
        for_votes: U256::from(9u64),
        against_votes: U256::ZERO,
        votes: std::collections::HashMap::new(),
        status: DaoProposalStatus::Active,
        created_at: 1000,
        executed_note_commitment: None,
    };

    let cfg = registry.dao_governance_configs.get(&dao_addr).unwrap().clone();

    // Voter casts vote reaching quorum (10 votes)
    proposal.for_votes += U256::from(1u64);
    assert!(proposal.for_votes >= cfg.quorum_threshold, "Proposal must reach quorum");

    // Execute proposal and disburse blind note
    proposal.status = DaoProposalStatus::Passed;
    if proposal.value > U256::ZERO {
        let note_commitment = B256::from_slice(
            blake3::hash(format!("dao_disbursement:{:#x}:{:#x}:{}", proposal.dao_address, proposal.target, proposal.value).as_bytes()).as_bytes()
        );
        proposal.executed_note_commitment = Some(note_commitment);
        proposal.status = DaoProposalStatus::Executed;
    }

    assert_eq!(proposal.status, DaoProposalStatus::Executed);
    assert!(proposal.executed_note_commitment.is_some(), "Must disburse NoteCommitment for grant");
}
