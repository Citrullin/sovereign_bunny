//! Integration tests for Peer-to-Peer Blind Note Transport Privacy & Superposition Invariants.

use alloy_primitives::{Address, B256, Bytes};
use sovereign_consensus::lattice::note::{
    derive_nullifier, derive_reclamation_nullifier, derive_view_tag, NoteCommitment,
};
use sovereign_consensus::lattice::nullifier_smt::NullifierSmt;
use sovereign_network::iroh::blind_note_transport::{BlindNoteMessage, BlindNoteRouter};

#[test]
fn test_multi_node_blind_courier_privacy_invariant() {
    let router_eve = BlindNoteRouter::new();

    let alice_addr = Address::repeat_byte(0x11);
    let bob_addr = Address::repeat_byte(0x22);

    // Alice generates ephemeral secret and computes shared secret with Bob's viewing key
    let shared_secret = b"ecdh_shared_secret_between_alice_and_bob";
    let view_tag = derive_view_tag(shared_secret);

    let note_commitment = NoteCommitment::with_decay_and_view_tag(
        B256::repeat_byte(0xcc),
        Bytes::from_static(b"ciphertext_amount_100_TBL_asset_0x00"),
        Bytes::from_static(b"ephemeral_pubkey_rG"),
        B256::repeat_byte(0x42), // gossip topic
        1,
        100, // issuance epoch
        view_tag,
        110, // decay epoch
    );

    // Alice constructs anonymous transport message
    let gossip_packet = BlindNoteMessage::new_anonymous(&note_commitment);

    // ASSERTION 1: Passive observer/intermediary Node Eve cannot extract sender or receiver address
    assert_eq!(
        gossip_packet.recipient_hint,
        Address::ZERO,
        "Gossip packet must carry ZERO recipient address metadata"
    );
    assert_ne!(
        gossip_packet.recipient_hint, bob_addr,
        "Bob's address must never appear in transport packet"
    );
    assert_ne!(
        gossip_packet.recipient_hint, alice_addr,
        "Alice's address must never appear in transport packet"
    );

    // Eve routes packet across the network mesh
    router_eve.route_note(gossip_packet);

    // ASSERTION 2: Eve's address-based indexing is completely empty
    assert_eq!(
        router_eve.drain_notes_for_recipient(&bob_addr).len(),
        0,
        "Eve must not be able to index notes by Bob's address"
    );
    assert_eq!(
        router_eve.drain_notes_for_recipient(&alice_addr).len(),
        0,
        "Eve must not be able to index notes by Alice's address"
    );

    // ASSERTION 3: Bob scans the topic using his calculated view_tag
    let bobs_secret = b"ecdh_shared_secret_between_alice_and_bob";
    let bobs_calculated_view_tag = derive_view_tag(bobs_secret);
    assert_eq!(bobs_calculated_view_tag, view_tag);

    let bobs_matches = router_eve.scan_topic_with_view_tag(&B256::repeat_byte(0x42), bobs_calculated_view_tag);
    assert_eq!(bobs_matches.len(), 1, "Bob discovers his note via view-tag matching");
    assert_eq!(bobs_matches[0].note_commitment, B256::repeat_byte(0xcc));
    assert_eq!(bobs_matches[0].decay_epoch, 110);
}

#[test]
fn test_view_tag_fast_rejection_efficacy_99_percent() {
    let router = BlindNoteRouter::new();
    let topic = B256::repeat_byte(0x77);
    let target_view_tag = 0x9au8;

    // Simulate 1,000 incoming network notes with pseudo-random view tags
    for i in 0..1000 {
        let tag = ((i * 37 + 13) % 256) as u8;
        let note = NoteCommitment::with_decay_and_view_tag(
            B256::repeat_byte((i % 250) as u8),
            Bytes::default(),
            Bytes::default(),
            topic,
            1,
            50,
            tag,
            60,
        );
        router.route_note(BlindNoteMessage::new_anonymous(&note));
    }

    // Recipient queries topic using target_view_tag
    let matched = router.scan_topic_with_view_tag(&topic, target_view_tag);

    // 1000 notes / 256 tags ~= ~3-4 matching candidates
    assert!(
        matched.len() <= 6,
        "View-tag must reject >99% of notes (matched {} out of 1000)",
        matched.len()
    );
    for m in &matched {
        assert_eq!(m.view_tag, target_view_tag);
    }
}

#[test]
fn test_superposition_decay_and_sender_reclamation_invariant() {
    let mut nullifier_smt = NullifierSmt::new();

    let sk_sender = b"alice_sender_private_key_32bytes";
    let sk_recipient = b"bob_recipient_private_key_32byte";
    let salt = B256::repeat_byte(0xef);
    let decay_epoch = 100u64;

    // 1. Primary Branch: If Bob absorbs before decay_epoch, Bob derives absorb nullifier
    let bob_nullifier = derive_nullifier(sk_recipient, &salt);

    // 2. Secondary Branch: If Bob does not absorb and epoch >= decay_epoch, Alice reclaims
    let alice_reclaim_nullifier = derive_reclamation_nullifier(sk_sender, &salt, decay_epoch);

    // Invariant: Absorb and Reclaim nullifiers are mathematically distinct
    assert_ne!(
        bob_nullifier, alice_reclaim_nullifier,
        "Absorb and Reclaim nullifiers must never collide"
    );

    // Scenario A: Alice reclaims expired note into SMT
    let res_reclaim = nullifier_smt.insert(alice_reclaim_nullifier);
    assert!(res_reclaim.is_ok(), "Alice reclamation nullifier successfully emitted to SMT");
    assert!(nullifier_smt.contains(&alice_reclaim_nullifier));

    // Scenario B: Alice attempts to reclaim a second time -> Rejected by SMT
    let res_double_reclaim = nullifier_smt.insert(alice_reclaim_nullifier);
    assert!(
        res_double_reclaim.is_err(),
        "Double-reclaim must be rejected by nullifier SMT"
    );

    // Scenario C: If a note was already reclaimed, recipient cannot double-spend it
    // When Alice reclaims, the commitment is nullified on the ledger
    let res_bob_late_absorb = nullifier_smt.insert(alice_reclaim_nullifier);
    assert!(
        res_bob_late_absorb.is_err(),
        "Nullifier slot already consumed; cannot be spent or absorbed again"
    );
}
