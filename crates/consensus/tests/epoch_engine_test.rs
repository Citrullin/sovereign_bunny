use alloy_primitives::{B256, U256};
use sovereign_consensus::epoch_engine::{
    execute_chandy_lamport_snapshot, finalize_epoch,
};
use sovereign_consensus::jurisdiction::MeritRank;
use sovereign_consensus::registry::ValidatorRegistry;
use sovereign_consensus::stateless::{LatticeBlock, LatticePayload};

#[test]
fn test_merit_distribution_and_promotion() {
    use sovereign_identity::did::SovereignDidDocument;

    // GIVEN: A registered account with real cryptographic keys, Rank0 merit, and reputation score > 0.95
    let mut registry = ValidatorRegistry::default();
    let seed = B256::repeat_byte(0x42);
    let doc = SovereignDidDocument::derive_from_seed(seed);
    let addr = doc.evm_address;
    let did = doc.did_uri.clone();

    // Sync full cryptographic identity
    registry.sync_identity_from_doc(doc);

    let mut frontier = registry.get_or_create_frontier(addr);
    frontier.merit_rank = MeritRank::Rank0;
    frontier.epochs_at_current_rank = 3; // Satisfy MERIT_RANK_COOLDOWN_EPOCHS
    registry.update_frontier(addr, frontier);

    registry.reputation.insert(did, 0.95);

    // Initial settled balance is zero
    assert_eq!(registry.get_account_balance(&addr), U256::ZERO);

    // WHEN: The full epoch finalization cycle executes for epoch 90 (Rank0 distribution interval)
    let epoch_id = 90;
    let consensus_root = B256::repeat_byte(0x11);
    let state_root = B256::repeat_byte(0x22);
    let checkpoint = finalize_epoch(&mut registry, epoch_id, consensus_root, state_root);

    // THEN: Payout is credited to settled account balance and frontier is auto-promoted to Rank4
    let credited_balance = registry.get_account_balance(&addr);
    assert!(credited_balance > U256::ZERO, "Account balance must be credited upon epoch finalization");

    let updated_frontier = registry.account_frontiers.get(&addr).unwrap();
    assert_eq!(updated_frontier.merit_rank, MeritRank::Rank4);
    assert_eq!(checkpoint.epoch_id, epoch_id);
}

#[test]
fn test_chandy_lamport_snapshot_and_in_flight() {
    use sovereign_identity::did::SovereignDidDocument;

    // GIVEN: Two registered accounts with real cryptographic DID keys
    let mut registry = ValidatorRegistry::default();
    let seed_alice = B256::repeat_byte(0x01);
    let seed_bob = B256::repeat_byte(0x02);

    let doc_alice = SovereignDidDocument::derive_from_seed(seed_alice);
    let doc_bob = SovereignDidDocument::derive_from_seed(seed_bob);

    let sender = doc_alice.evm_address;
    let recipient = doc_bob.evm_address;

    registry.sync_identity_from_doc(doc_alice);
    registry.sync_identity_from_doc(doc_bob);

    let mut frontier_sender = registry.get_or_create_frontier(sender);
    frontier_sender.sequence = 5;
    registry.update_frontier(sender, frontier_sender);

    let send_hash = B256::repeat_byte(0xaa);
    let send_block = LatticeBlock {
        account: sender,
        previous_hash: B256::ZERO,
        sequence: 1,
        payload: LatticePayload::Send {
            recipient,
            amount: U256::from(500),
        },
        signature: Vec::new(),
        static_witnesses: Vec::new(),
    };
    registry.lattice_blocks.insert(send_hash, send_block);

    // WHEN: A Chandy-Lamport distributed snapshot executes
    let (states, in_flight) = execute_chandy_lamport_snapshot(&registry);
    assert_eq!(states.get(&sender).copied(), Some(5));
    assert_eq!(in_flight.len(), 1);
    assert_eq!(in_flight[0].sender, sender);
    assert_eq!(in_flight[0].recipient, recipient);
    assert_eq!(in_flight[0].amount, U256::from(500));
    assert_eq!(in_flight[0].send_block_hash, send_hash);

    // Now insert matching receive block
    let recv_hash = B256::repeat_byte(0xbb);
    let recv_block = LatticeBlock {
        account: recipient,
        previous_hash: B256::ZERO,
        sequence: 1,
        payload: LatticePayload::Receive {
            send_block_hash: send_hash,
            amount: U256::from(500),
        },
        signature: Vec::new(),
        static_witnesses: Vec::new(),
    };
    registry.lattice_blocks.insert(recv_hash, recv_block);

    // Snapshot after receive: in-flight is empty
    let (_, in_flight_after) = execute_chandy_lamport_snapshot(&registry);
    assert!(in_flight_after.is_empty());
}

#[test]
fn test_finalize_epoch_creates_checkpoint() {
    use sovereign_identity::did::SovereignDidDocument;

    // GIVEN: A validator registry with real cryptographic validator keys
    let mut registry = ValidatorRegistry::default();
    let seed_val = B256::repeat_byte(0x77);
    let doc_val = SovereignDidDocument::derive_from_seed(seed_val);
    registry.sync_identity_from_doc(doc_val);

    let epoch_id = 1;
    let consensus_root = B256::repeat_byte(0x11);
    let state_root = B256::repeat_byte(0x22);

    // WHEN: The epoch is finalized
    let checkpoint = finalize_epoch(&mut registry, epoch_id, consensus_root, state_root);

    // THEN: An immutable EpochCheckpoint is produced and committed to the registry
    assert_eq!(checkpoint.epoch_id, epoch_id);
    assert_eq!(checkpoint.consensus_root, consensus_root);
    assert_eq!(checkpoint.state_root, state_root);
    assert_ne!(checkpoint.snapshot_hash, B256::ZERO);

    let latest = registry.latest_checkpoint.as_ref().unwrap();
    assert_eq!(latest.epoch_id, checkpoint.epoch_id);
    assert_eq!(latest.consensus_root, checkpoint.consensus_root);
    assert_eq!(latest.state_root, checkpoint.state_root);
    assert_eq!(latest.snapshot_hash, checkpoint.snapshot_hash);
}

#[test]
fn test_derive_next_epoch_seed_and_marker() {
    use sovereign_consensus::epoch_engine::{derive_next_epoch_seed, ThresholdEpochMarker};
    use sovereign_crypto::{bls_derive_pk_g2, bls_sign_message};
    use sovereign_identity::did::SovereignDidDocument;

    // GIVEN: Prior epoch seed and global frontier root
    let seed_0 = B256::repeat_byte(0xaa);
    let root_0 = B256::repeat_byte(0xbb);

    // Derive real cryptographic validator keys
    let val_seed = B256::repeat_byte(0x55);
    let leader_seed = B256::repeat_byte(0x66);
    let doc_val = SovereignDidDocument::derive_from_seed(val_seed);
    let doc_leader = SovereignDidDocument::derive_from_seed(leader_seed);

    let target_validator = doc_val.evm_address;
    let issuer_leader = doc_leader.evm_address;

    // WHEN: Next epoch entropy seed is derived
    let seed_1 = derive_next_epoch_seed(seed_0, root_0);

    // THEN: Seed is non-zero, mutated, and strictly deterministic
    assert_ne!(seed_1, B256::ZERO);
    assert_ne!(seed_1, seed_0);
    assert_eq!(seed_1, derive_next_epoch_seed(seed_0, root_0));

    // Sign the marker using leader's real BLS key
    let sk: [u8; 32] = *leader_seed.as_ref();
    let pk = bls_derive_pk_g2(&sk);

    let mut marker = ThresholdEpochMarker {
        epoch_id: 1,
        previous_global_root: root_0,
        target_validator,
        issuer_leader,
        threshold_signature: Vec::new(),
        committee_aggregated_pk: pk.clone(),
        participant_count: 1,
    };
    let msg = marker.signing_message();
    let sig = bls_sign_message(&sk, &msg);
    marker.threshold_signature = sig;

    assert_eq!(marker.epoch_id, 1);
    assert_eq!(marker.target_validator, target_validator);
    assert_eq!(marker.issuer_leader, issuer_leader);
    assert!(!marker.threshold_signature.is_empty());
    assert!(!marker.committee_aggregated_pk.is_empty());
}

#[test]
fn test_finalize_epoch_with_real_bls_threshold_markers() {
    use sovereign_consensus::epoch_engine::{finalize_epoch_with_markers, ThresholdEpochMarker};
    use sovereign_crypto::{bls_sign_message, bls_derive_pk_g2, bls_aggregate_signatures, bls_aggregate_pks_g2};
    use sovereign_identity::did::SovereignDidDocument;

    let mut registry = ValidatorRegistry::default();
    let epoch_id = 42;
    let root_prev = B256::repeat_byte(0x55);

    // 1. Generate 3 real committee member identities from cryptographic seeds using SovereignDidDocument
    let seed1 = B256::repeat_byte(0x11);
    let seed2 = B256::repeat_byte(0x22);
    let seed3 = B256::repeat_byte(0x33);

    let doc1 = SovereignDidDocument::derive_from_seed(seed1);
    let doc2 = SovereignDidDocument::derive_from_seed(seed2);
    let doc3 = SovereignDidDocument::derive_from_seed(seed3);

    let val1_addr = doc1.evm_address;
    let val2_addr = doc2.evm_address;
    let _val3_addr = doc3.evm_address;

    // Register full DID documents into the registry as active validators
    registry.sync_identity_from_doc(doc1.clone());
    registry.sync_identity_from_doc(doc2.clone());
    registry.sync_identity_from_doc(doc3.clone());

    registry.validators.insert(doc1.did_uri.clone(), sovereign_consensus::registry::ValidatorType::HardwareTEE);
    registry.validators.insert(doc2.did_uri.clone(), sovereign_consensus::registry::ValidatorType::HardwareTEE);
    registry.validators.insert(doc3.did_uri.clone(), sovereign_consensus::registry::ValidatorType::HardwareTEE);

    let target_val = val1_addr;
    let leader = val2_addr;

    let mut marker = ThresholdEpochMarker {
        epoch_id,
        previous_global_root: root_prev,
        target_validator: target_val,
        issuer_leader: leader,
        threshold_signature: Vec::new(),
        committee_aggregated_pk: Vec::new(),
        participant_count: 2,
    };

    let msg = marker.signing_message();

    // 2. Real BLS signing keys for the committee members
    let sk1: [u8; 32] = *seed1.as_ref();
    let sk2: [u8; 32] = *seed2.as_ref();
    let sk3: [u8; 32] = *seed3.as_ref();

    let pk1 = bls_derive_pk_g2(&sk1);
    let pk2 = bls_derive_pk_g2(&sk2);
    let pk3 = bls_derive_pk_g2(&sk3);

    let sig1 = bls_sign_message(&sk1, &msg);
    let sig2 = bls_sign_message(&sk2, &msg);

    // 2-of-3 threshold signature and pk aggregation
    let agg_sig = bls_aggregate_signatures(&[&sig1, &sig2]).unwrap();
    let agg_pk = bls_aggregate_pks_g2(&[&pk1, &pk2]).unwrap();

    marker.threshold_signature = agg_sig;
    marker.committee_aggregated_pk = agg_pk;

    // 3. Quorum check: with 3 registered validators, quorum is (3*2)/3 + 1 = 3.
    // If only 2 participants sign, finalization must fail quorum:
    marker.participant_count = 2;
    let res_quorum_fail = finalize_epoch_with_markers(
        &mut registry,
        epoch_id,
        B256::repeat_byte(0xaa),
        B256::repeat_byte(0xbb),
        &[marker.clone()],
    );
    assert!(res_quorum_fail.is_err(), "Must reject when below 2n/3 + 1 quorum");

    // 4. When 3-of-3 quorum is collected (sig3 added):
    let sig3 = bls_sign_message(&sk3, &msg);
    let full_agg_sig = bls_aggregate_signatures(&[&sig1, &sig2, &sig3]).unwrap();
    let full_agg_pk = bls_aggregate_pks_g2(&[&pk1, &pk2, &pk3]).unwrap();

    let mut full_marker = marker.clone();
    full_marker.threshold_signature = full_agg_sig;
    full_marker.committee_aggregated_pk = full_agg_pk;
    full_marker.participant_count = 3;

    let res = finalize_epoch_with_markers(
        &mut registry,
        epoch_id,
        B256::repeat_byte(0xaa),
        B256::repeat_byte(0xbb),
        &[full_marker.clone()],
    );
    assert!(res.is_ok(), "Must succeed when full committee signs and verifies");
    let checkpoint = res.unwrap();
    assert_eq!(checkpoint.epoch_id, epoch_id);
    assert_eq!(checkpoint.validator_signatures.len(), 1);

    // 5. Corrupted BLS signature is rejected
    let mut bad_marker = full_marker.clone();
    bad_marker.threshold_signature[5] ^= 0xff;
    let bad_res = finalize_epoch_with_markers(
        &mut registry,
        epoch_id,
        B256::repeat_byte(0xaa),
        B256::repeat_byte(0xbb),
        &[bad_marker],
    );
    assert!(bad_res.is_err());

    // 6. Mismatched committee pk is rejected
    let bad_agg_pk = bls_aggregate_pks_g2(&[&pk1, &pk2]).unwrap(); // missing pk3
    let mut mismatched_pk_marker = full_marker;
    mismatched_pk_marker.committee_aggregated_pk = bad_agg_pk;
    let mismatch_res = finalize_epoch_with_markers(
        &mut registry,
        epoch_id,
        B256::repeat_byte(0xaa),
        B256::repeat_byte(0xbb),
        &[mismatched_pk_marker],
    );
    assert!(mismatch_res.is_err());
}
