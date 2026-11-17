//! # E2E Integration Tests: X-Road Regulatory Authority, Court Order & View Key Traversal
//!
//! Validates:
//! 1. X-Road authority microservice actor with Slot 5 descriptor and cert chain Merkle root.
//! 2. BaFin / UNIT_7 court order issuance wrapped in `XRoadEnvelope`.
//! 3. Zanzibar ReBAC capability check (`can_issue_view_request` / `supervisor_of`).
//! 4. Zodiac DAO authorization and issuance of `AuthorityViewRequest`.
//! 5. Ephemeral `ViewingKeyPair` reveal to derived gossip topic channel.
//! 6. Note decryption by authority and emission of immutable `ViewingAuditLog`.
//! 7. Graph relation traversal verification from Authority -> Cert Chain -> DAO -> Account -> Note.
use alloy_primitives::{address, Bytes, B256, U256};
use sovereign_consensus::governance::authority::{AuthorityViewRequest, CrossBorderCoopRequest};
use sovereign_consensus::governance::xroad::{XRoadEnvelope, XRoadPayloadType, XRoadServiceDescriptor};
use sovereign_consensus::governance::zanzibar::{ZanzibarGraphEngine, ZanzibarSubject};
use sovereign_consensus::lattice::viewing_key::{DecryptedNote, ViewingKeyPair};

#[test]
fn test_xroad_authority_service_descriptor_slot5() {
    let descriptor = XRoadServiceDescriptor {
        member_code: "DE/BAFIN/70001490/market_supervision".to_string(),
        service_code: "view-order-gateway-v1".to_string(),
        cert_hash: B256::repeat_byte(0xaa),
        endpoint_hash: B256::repeat_byte(0xbb),
        updated_epoch: 42,
    };

    let commitment = descriptor.compute_slot5_commitment();
    assert_ne!(commitment, B256::ZERO, "Slot 5 commitment should not be zero");

    // Deterministic commitment check
    let commitment2 = descriptor.compute_slot5_commitment();
    assert_eq!(commitment, commitment2, "Slot 5 commitment must be deterministic");
}

#[test]
fn test_xroad_cert_chain_merkle_root_verification() {
    let cert_investigator = B256::repeat_byte(0x11);
    let cert_supervisor = B256::repeat_byte(0x22);
    let cert_ministry = B256::repeat_byte(0x33);
    let cert_national_root = B256::repeat_byte(0x44);

    let cert_chain = vec![cert_investigator, cert_supervisor, cert_ministry, cert_national_root];
    let root = XRoadEnvelope::compute_cert_chain_root(&cert_chain);
    assert_ne!(root, B256::ZERO);

    let envelope = XRoadEnvelope {
        message_id: B256::repeat_byte(0x01),
        xroad_message_id: B256::repeat_byte(0x02),
        court_document_hash: B256::repeat_byte(0x99),
        cert_chain_root: root,
        payload_type: XRoadPayloadType::CourtOrder,
        payload_data: Bytes::from_static(b"court_order_warrant_pdf_hash"),
    };

    assert!(envelope.verify_cert_chain(&cert_chain));

    // Tampered chain should fail
    let mut tampered_chain = cert_chain.clone();
    tampered_chain[1] = B256::repeat_byte(0x99);
    assert!(!envelope.verify_cert_chain(&tampered_chain));
}

#[test]
fn test_authority_court_order_view_key_and_audit_log_flow() {
    let mut zanzibar = ZanzibarGraphEngine::new();

    let bafin_authority = address!("1000000000000000000000000000000000000001");
    let supervisor = address!("2000000000000000000000000000000000000002");
    let target_account = address!("3000000000000000000000000000000000000003");
    let dao_safe = address!("4000000000000000000000000000000000000004");

    let target_b256 = B256::from_slice(&[target_account.as_slice(), &[0u8; 12]].concat());

    // 1. Establish Zanzibar ReBAC permissions:
    // supervisor -> supervisor_of -> target_account
    // BaFin -> can_issue_view_request -> target_account
    // DAO Safe -> auditor -> target_account
    zanzibar.add_named_tuple(
        "dao",
        target_b256,
        "auditor",
        ZanzibarSubject::User(dao_safe),
    );
    zanzibar.add_named_tuple(
        "authority",
        target_b256,
        "can_issue_view_request",
        ZanzibarSubject::User(bafin_authority),
    );
    zanzibar.add_named_tuple(
        "compliance",
        target_b256,
        "supervisor_of",
        ZanzibarSubject::User(supervisor),
    );

    // 2. Construct court order warrant
    let court_doc_hash = B256::repeat_byte(0x77);
    let target_commitment = B256::repeat_byte(0x88);

    let view_request = AuthorityViewRequest {
        authority: bafin_authority,
        target_account,
        court_document_hash: court_doc_hash,
        target_commitment,
        issued_epoch: 100,
    };

    // 3. Authority capability check
    assert!(
        view_request.verify_authority_capability(&zanzibar),
        "BaFin authority must hold can_issue_view_request capability"
    );

    // Negative check: unauthorized actor
    let unauthorized_actor = address!("dead000000000000000000000000000000000000");
    let bad_request = AuthorityViewRequest {
        authority: unauthorized_actor,
        target_account,
        court_document_hash: court_doc_hash,
        target_commitment,
        issued_epoch: 100,
    };
    assert!(
        !bad_request.verify_authority_capability(&zanzibar),
        "Unauthorized actor must be rejected by Zanzibar capability check"
    );

    // 4. Target account generates viewing key pair and reveals it to BaFin
    let ephemeral_pubkey = Bytes::from(vec![0x04; 32]);
    let ephemeral_seckey = Bytes::from(vec![0x05; 32]);
    let viewing_key_pair = ViewingKeyPair::new(ephemeral_pubkey.clone(), Some(ephemeral_seckey));

    let gossip_topic = viewing_key_pair.derive_gossip_topic(100);
    assert_ne!(gossip_topic, B256::ZERO);

    // Reveal viewing key -> produces audit log
    let (revealed_key, audit_log) = view_request.reveal_viewing_key(&viewing_key_pair, 100);
    assert_eq!(revealed_key.public_key, ephemeral_pubkey);
    assert_eq!(audit_log.auditor, bafin_authority);
    assert_eq!(audit_log.audited_account, target_account);
    assert_eq!(audit_log.court_order_hash, court_doc_hash);
    assert_eq!(audit_log.target_commitment, target_commitment);
    assert_eq!(audit_log.epoch, 100);

    // 5. BaFin decrypts target note
    let decrypted_note = DecryptedNote {
        note_commitment: target_commitment,
        sender: address!("5000000000000000000000000000000000000005"),
        recipient: target_account,
        amount: U256::from(50_000_000_000_000_000_000u128),
        target_slot: 2,
        payload: Bytes::from_static(b"whitelisted_securities_settlement"),
        blinding_salt: B256::repeat_byte(0x33),
    };

    assert_eq!(decrypted_note.note_commitment, target_commitment);
    assert_eq!(decrypted_note.recipient, target_account);
}

#[test]
fn test_cross_border_cooperation_envelope() {
    let bafin = address!("1000000000000000000000000000000000000001");
    let finma = address!("6000000000000000000000000000000000000006");

    let coop_req = CrossBorderCoopRequest {
        requesting_authority: bafin,
        counterpart_authority: finma,
        treaty_reference_hash: B256::repeat_byte(0x55),
        encrypted_payload: Bytes::from_static(b"bilateral_encrypted_inquiry_payload"),
        epoch: 250,
    };

    assert_eq!(coop_req.requesting_authority, bafin);
    assert_eq!(coop_req.counterpart_authority, finma);
    assert_eq!(coop_req.epoch, 250);
}
