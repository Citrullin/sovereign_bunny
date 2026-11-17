use alloy_primitives::{Address, B256, U256};
use sovereign_consensus::precompile_router::execute_system_action;
use sovereign_consensus::registry::ValidatorRegistry;
use sovereign_consensus::system_registry::{
    SystemAction, SYSTEM_DID_REGISTRY, SYSTEM_RECEIVE_HOOK, SYSTEM_SAGA_ESCROW,
};

#[test]
fn test_precompile_router_receive_hook() {
    // GIVEN: A recipient with an existing send block in the lattice
    let mut registry = ValidatorRegistry::default();
    let caller = Address::repeat_byte(0x11);
    let send_hash = B256::repeat_byte(0x22);

    let send_block = sovereign_consensus::stateless::LatticeBlock {
        account: Address::repeat_byte(0x01),
        previous_hash: B256::ZERO,
        sequence: 1,
        payload: sovereign_consensus::stateless::LatticePayload::Send {
            recipient: caller,
            amount: U256::from(100),
        },
        signature: Vec::new(),
        static_witnesses: Vec::new(),
    };
    registry.lattice_blocks.insert(send_hash, send_block);

    // WHEN: A Receive system action is dispatched to SYSTEM_RECEIVE_HOOK
    let action = SystemAction::Receive {
        send_block_hash: send_hash,
        amount: U256::from(100),
    };
    let calldata = action.encode();
    let res = execute_system_action(&mut registry, caller, SYSTEM_RECEIVE_HOOK, &calldata, 1);

    // THEN: Precompile execution succeeds
    assert!(res.is_ok());
}

#[test]
fn test_precompile_router_saga_escrow() {
    // GIVEN: A caller account locking balance into a Saga intent
    let mut registry = ValidatorRegistry::default();
    let caller = Address::repeat_byte(0x11);
    let target = Address::repeat_byte(0x22);
    let intent_id = B256::repeat_byte(0x33);
    registry.address_to_did.insert(caller, "did:sovereign:1337:caller".to_string());
    registry.credit_account_balance(caller, U256::from(1000));

    // WHEN: SagaEscrow system action is dispatched to SYSTEM_SAGA_ESCROW
    let action = SystemAction::SagaEscrow {
        intent_id,
        target_account: target,
        amount: U256::from(500),
        expire_epoch: 10,
    };
    let calldata = action.encode();
    let res = execute_system_action(&mut registry, caller, SYSTEM_SAGA_ESCROW, &calldata, 1);

    // THEN: Intent escrow is registered, actor state created, and frontier locked
    assert!(res.is_ok());
    assert!(registry.intent_escrows.contains_key(&intent_id));
    assert!(registry.actors.contains_key(&intent_id));
    let frontier = registry.account_frontiers.get(&caller).unwrap();
    assert!(frontier.locked);
    // Solvency guarantee: caller balance is debited by the escrow amount
    assert_eq!(registry.get_account_balance(&caller), U256::from(500));
}

#[test]
fn test_precompile_router_register_did() {
    // GIVEN: A caller deriving a Secp256k1 multibase DID document
    let mut registry = ValidatorRegistry::default();

    let signing_key = k256::ecdsa::SigningKey::from_slice(&[0x42; 32]).unwrap();
    let verifying_key = signing_key.verifying_key();
    let sec1_point = verifying_key.to_sec1_point(true);
    let secp_raw = sec1_point.as_bytes();

    let mut secp_pub = vec![0xe7, 0x01];
    secp_pub.extend_from_slice(secp_raw);
    let multibase_str = format!("z{}", bs58::encode(secp_pub).into_string());

    let uncompressed = verifying_key.to_sec1_point(false);
    let hash = alloy_primitives::keccak256(&uncompressed.as_bytes()[1..]);
    let mut derived = [0u8; 20];
    derived.copy_from_slice(&hash[12..32]);
    let caller = Address::from(derived);

    let did_doc_json = serde_json::json!({
        "verificationMethod": [{
            "id": format!("did:sovereign:1337:{}#key-1", caller),
            "type": "EcdsaSecp256k1VerificationKey2019",
            "publicKeyMultibase": multibase_str
        }]
    }).to_string();

    // Negative test: fresh address with zero gas and zero notes MUST be rejected
    let action = SystemAction::RegisterDid {
        did_document: did_doc_json.clone(),
        pq_pub_key: vec![0x01; 32],
        key_tier: "QuantumReady".to_string(),
    };
    let calldata = action.encode();
    let res_neg = execute_system_action(&mut registry, caller, SYSTEM_DID_REGISTRY, &calldata, 1);
    assert!(res_neg.is_err(), "Zero-gas fresh address DID registration MUST fail");
    assert_eq!(
        res_neg.err().unwrap(),
        "Insufficient economic credit: Fresh address requires an in-note gas allocation or settled balance to register DID"
    );

    // WHEN: A sender commits a blind note to this fresh address with DID_REGISTRATION_GAS_FEE
    let sender = Address::repeat_byte(0x99);
    let reg_fee = sovereign_consensus::lattice::note::DID_REGISTRATION_GAS_FEE;
    registry.account_balances.insert(sender, alloy_primitives::U256::from(reg_fee * 2));
    let mut note_commit = sovereign_consensus::lattice::note::NoteCommitment::new(
        alloy_primitives::B256::repeat_byte(0x77),
        alloy_primitives::Bytes::new(),
        alloy_primitives::Bytes::new(),
        alloy_primitives::B256::repeat_byte(0x88),
        1,
        1,
    );
    note_commit.did_registration_fee = reg_fee;
    let commit_action = SystemAction::CommitNote {
        note_commitment: note_commit,
        target_account: caller,
        target_slot: 2,
    };
    let commit_res = execute_system_action(&mut registry, sender, sovereign_consensus::system_registry::SYSTEM_NOTE_REGISTRY, &commit_action.encode(), 1);
    assert!(commit_res.is_ok(), "Note commitment funding registration gas must succeed");

    // THEN: Registration now succeeds because recipient has in-note registration gas funded
    let res = execute_system_action(&mut registry, caller, SYSTEM_DID_REGISTRY, &calldata, 1);
    assert!(res.is_ok(), "RegisterDid failed: {:?}", res.err());
    let expected_did = format!("did:sovereign:{}:{}", registry.chain_id, caller.to_string().to_lowercase());
    let registered_did = registry.address_to_did.get(&caller).cloned().unwrap_or_default();
    assert!(registered_did.starts_with("did:peer:4") || registered_did == expected_did, "Unexpected registered DID: {}", registered_did);
    assert!(registry.pq_keys.contains_key(&caller));
}
