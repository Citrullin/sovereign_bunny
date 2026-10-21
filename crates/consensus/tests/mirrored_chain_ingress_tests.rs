//! # Mirrored Foreign Chain Ingress & Blind Note Minting Integration Tests (CRIT-CC-01..04)
//!
//! Validates:
//! 1. Low-entropy mirrored precompiles `0x02` (Ethereum L1), `0x03` (Base), `0x04` (Gnosis).
//! 2. Stateless EVM MPT witness verification (account proof + storage proof) against canonical state roots.
//! 3. Automatic Aztec-style Blind Note derivation and anchoring into CAR Slot 2 ($R_2$).
//! 4. Zero-timestamp mesh boundary consensus and parent hash continuity.

use alloy_primitives::{Address, Bytes, B256, U256};
use sovereign_consensus::lattice::mpt::{bytes_to_nibbles, verify_account_and_storage_proof, verify_mpt_proof};
use sovereign_consensus::mesh::cross_chain_mesh::{CrossChainMeshEngine, MeshThresholdShardKey};
use sovereign_consensus::system_contracts::register_precompiles::{
    CrossChainIngressPayload, RegisterPrecompileRouter, PRECOMPILE_MIRROR_BASE, PRECOMPILE_MIRROR_ETH_L1,
    PRECOMPILE_MIRROR_GNOSIS,
};

/// Helper to encode raw bytes into an RLP byte-string.
fn encode_rlp_bytes(data: &[u8]) -> Vec<u8> {
    if data.len() == 1 && data[0] < 0x80 {
        vec![data[0]]
    } else if data.len() <= 55 {
        let mut out = Vec::with_capacity(1 + data.len());
        out.push(0x80 + data.len() as u8);
        out.extend_from_slice(data);
        out
    } else {
        let len_bytes = data.len().to_be_bytes();
        let skip = len_bytes.iter().take_while(|&&b| b == 0).count();
        let significant = &len_bytes[skip..];
        let mut out = Vec::with_capacity(1 + significant.len() + data.len());
        out.push(0xb7 + significant.len() as u8);
        out.extend_from_slice(significant);
        out.extend_from_slice(data);
        out
    }
}

/// Helper to encode an array of RLP items into an RLP list.
fn encode_rlp_list(items: &[&[u8]]) -> Vec<u8> {
    let mut payload = Vec::new();
    for item in items {
        payload.extend_from_slice(item);
    }
    if payload.len() <= 55 {
        let mut out = Vec::with_capacity(1 + payload.len());
        out.push(0xc0 + payload.len() as u8);
        out.extend_from_slice(&payload);
        out
    } else {
        let len_bytes = payload.len().to_be_bytes();
        let skip = len_bytes.iter().take_while(|&&b| b == 0).count();
        let significant = &len_bytes[skip..];
        let mut out = Vec::with_capacity(1 + significant.len() + payload.len());
        out.push(0xf7 + significant.len() as u8);
        out.extend_from_slice(significant);
        out.extend_from_slice(&payload);
        out
    }
}

/// Helper to compact-encode a nibble path.
fn encode_compact_path(nibbles: &[u8], is_leaf: bool) -> Vec<u8> {
    let mut out = Vec::new();
    let is_odd = (nibbles.len() % 2) != 0;
    let prefix = if is_leaf {
        if is_odd { 0x30 } else { 0x20 }
    } else {
        if is_odd { 0x10 } else { 0x00 }
    };

    if is_odd {
        out.push(prefix | (nibbles[0] & 0x0f));
        for chunk in nibbles[1..].chunks(2) {
            out.push((chunk[0] << 4) | (chunk[1] & 0x0f));
        }
    } else {
        out.push(prefix);
        for chunk in nibbles.chunks(2) {
            out.push((chunk[0] << 4) | (chunk[1] & 0x0f));
        }
    }
    out
}

#[test]
fn test_stateless_mpt_verification_single_node() {
    // 1. Create a key and value
    let key_hash = alloy_primitives::keccak256(b"secret_account_key");
    let key_nibbles = bytes_to_nibbles(key_hash.as_slice());
    let value_raw = b"1000000_native_sovereign_tokens";
    let val_rlp = encode_rlp_bytes(value_raw);

    // 2. Build single leaf node in MPT: [compact_path, val_rlp]
    let compact_path = encode_compact_path(&key_nibbles, true);
    let path_rlp = encode_rlp_bytes(&compact_path);

    let leaf_node_rlp = encode_rlp_list(&[&path_rlp, &val_rlp]);
    let root_hash = alloy_primitives::keccak256(&leaf_node_rlp);

    // 3. Verify MPT proof
    let proof = vec![leaf_node_rlp];
    let result = verify_mpt_proof(root_hash, key_hash.as_slice(), &proof).unwrap();
    assert_eq!(result, Some(value_raw.to_vec()));

    // Divergent key should return None
    let bad_key = alloy_primitives::keccak256(b"divergent_key");
    let bad_result = verify_mpt_proof(root_hash, bad_key.as_slice(), &proof).unwrap();
    assert_eq!(bad_result, None);
}

#[test]
fn test_2tier_account_and_storage_mpt_verification() {
    let escrow_contract = Address::repeat_byte(0x55);
    let storage_key = B256::repeat_byte(0x77);
    let deposit_amount = U256::from(50_000_000);

    // 1. Storage Trie: Leaf node storing the deposit amount
    let storage_key_hash = alloy_primitives::keccak256(storage_key.as_slice());
    let storage_nibbles = bytes_to_nibbles(storage_key_hash.as_slice());
    let amt_bytes = deposit_amount.to_be_bytes::<32>();
    // Trim leading zeroes for canonical RLP storage encoding
    let skip = amt_bytes.iter().take_while(|&&b| b == 0).count();
    let compact_amt = &amt_bytes[skip..];
    let amt_rlp = encode_rlp_bytes(compact_amt);

    let storage_path_rlp = encode_rlp_bytes(&encode_compact_path(&storage_nibbles, true));
    let storage_leaf_node = encode_rlp_list(&[&storage_path_rlp, &amt_rlp]);
    let storage_root = alloy_primitives::keccak256(&storage_leaf_node);
    let storage_proof = vec![storage_leaf_node];

    // 2. Account Trie: Leaf node storing [nonce, balance, storage_root, code_hash]
    let nonce_rlp = encode_rlp_bytes(&[1]);
    let balance_rlp = encode_rlp_bytes(&[0]);
    let storage_root_rlp = encode_rlp_bytes(storage_root.as_slice());
    let code_hash_rlp = encode_rlp_bytes(B256::repeat_byte(0xc0).as_slice());

    let account_state_rlp = encode_rlp_list(&[&nonce_rlp, &balance_rlp, &storage_root_rlp, &code_hash_rlp]);

    let account_path = alloy_primitives::keccak256(escrow_contract.as_slice());
    let account_nibbles = bytes_to_nibbles(account_path.as_slice());
    let account_path_rlp = encode_rlp_bytes(&encode_compact_path(&account_nibbles, true));
    let account_leaf_node = encode_rlp_list(&[&account_path_rlp, &encode_rlp_bytes(&account_state_rlp)]);
    let state_root = alloy_primitives::keccak256(&account_leaf_node);
    let account_proof = vec![account_leaf_node];

    // 3. Verify 2-tier proof statelessly
    let proved_val = verify_account_and_storage_proof(
        state_root,
        &escrow_contract,
        &storage_key,
        &account_proof,
        &storage_proof,
    ).unwrap();

    assert_eq!(proved_val, deposit_amount);
}

#[test]
fn test_precompile_mirrored_chain_ingress_and_car_slot2_minting() {
    let escrow_contract = Address::repeat_byte(0x88);
    let storage_key = B256::repeat_byte(0x99);
    let deposit_amount = U256::from(1_000_000);
    let recipient_did = Address::repeat_byte(0x42);

    // Build valid MPT proofs for Ethereum L1
    let storage_key_hash = alloy_primitives::keccak256(storage_key.as_slice());
    let storage_nibbles = bytes_to_nibbles(storage_key_hash.as_slice());
    let amt_bytes = deposit_amount.to_be_bytes::<32>();
    let skip = amt_bytes.iter().take_while(|&&b| b == 0).count();
    let amt_rlp = encode_rlp_bytes(&amt_bytes[skip..]);
    let storage_path_rlp = encode_rlp_bytes(&encode_compact_path(&storage_nibbles, true));
    let storage_leaf_node = encode_rlp_list(&[&storage_path_rlp, &amt_rlp]);
    let storage_root = alloy_primitives::keccak256(&storage_leaf_node);

    let nonce_rlp = encode_rlp_bytes(&[0]);
    let balance_rlp = encode_rlp_bytes(&[0]);
    let storage_root_rlp = encode_rlp_bytes(storage_root.as_slice());
    let code_hash_rlp = encode_rlp_bytes(B256::repeat_byte(0x00).as_slice());
    let account_state_rlp = encode_rlp_list(&[&nonce_rlp, &balance_rlp, &storage_root_rlp, &code_hash_rlp]);

    let account_path = alloy_primitives::keccak256(escrow_contract.as_slice());
    let account_nibbles = bytes_to_nibbles(account_path.as_slice());
    let account_path_rlp = encode_rlp_bytes(&encode_compact_path(&account_nibbles, true));
    let account_leaf_node = encode_rlp_list(&[&account_path_rlp, &encode_rlp_bytes(&account_state_rlp)]);
    let state_root = alloy_primitives::keccak256(&account_leaf_node);

    // 1. Anchor state root in the global registry
    {
        let mut reg = sovereign_consensus::governance::registry::get_registry().write().unwrap();
        let shard = MeshThresholdShardKey {
            foreign_chain_id: 1,
            shard_index: 0,
            threshold_pubkey: vec![0x11; 48],
            shard_public_share: vec![0x22; 48],
            pop_signature: vec![0x33; 96],
        };
        let _ = reg.cross_chain_mesh.register_foreign_chain_interface(5, 1, vec![shard]);
        let _ = reg.anchor_foreign_head(
            1,
            19_500_000,
            B256::repeat_byte(0xfa),
            B256::repeat_byte(0xf9),
            state_root,
            100,
            vec![0x99; 64],
        );
    }

    // 2. Prepare ingress payload
    let payload = CrossChainIngressPayload {
        recipient: recipient_did,
        amount: deposit_amount,
        view_tag: 0x7a,
        ephemeral_pubkey: Bytes::copy_from_slice(&[0x02; 33]),
        encrypted_ciphertext: Bytes::copy_from_slice(b"encrypted_ingress_deposit"),
        escrow_address: escrow_contract,
        storage_key,
        account_proof: vec![account_leaf_node],
        storage_proof: vec![storage_leaf_node],
        state_root: Some(state_root),
    };
    let payload_bytes = serde_json::to_vec(&payload).unwrap();

    // 3. Dispatch to Precompile 0x02 (Ethereum L1)
    let caller = Address::repeat_byte(0xaa);
    let dispatch_res = RegisterPrecompileRouter::dispatch(
        &PRECOMPILE_MIRROR_ETH_L1,
        &caller,
        &payload_bytes,
        None,
    );

    assert!(dispatch_res.is_some(), "PRECOMPILE_MIRROR_ETH_L1 must be recognized by router");
    let note_commitment_bytes = dispatch_res.unwrap().expect("Ingress verification must succeed");
    assert_eq!(note_commitment_bytes.len(), 32);

    // 4. Verify recipient CAR Slot 2 was anchored
    {
        let reg = sovereign_consensus::governance::registry::get_registry().read().unwrap();
        let recipient_car = reg.account_registers.get(&recipient_did).expect("Recipient CAR must exist");
        let slot2 = recipient_car.slots.get(&2).expect("Slot 2 must be mounted");
        assert_eq!(slot2.commitment.as_slice(), note_commitment_bytes.as_ref());
    }

    // 5. Test Precompile 0x03 (Base) and 0x04 (Gnosis) routing
    let base_res = RegisterPrecompileRouter::dispatch(&PRECOMPILE_MIRROR_BASE, &caller, &payload_bytes, None);
    assert!(base_res.is_some(), "PRECOMPILE_MIRROR_BASE (0x03) must be recognized");

    let gnosis_res = RegisterPrecompileRouter::dispatch(&PRECOMPILE_MIRROR_GNOSIS, &caller, &payload_bytes, None);
    assert!(gnosis_res.is_some(), "PRECOMPILE_MIRROR_GNOSIS (0x04) must be recognized");
}

#[test]
fn test_boundary_consensus_parent_hash_continuity() {
    let mut engine = CrossChainMeshEngine::new();
    let shard = MeshThresholdShardKey {
        foreign_chain_id: 8453,
        shard_index: 0,
        threshold_pubkey: vec![0x33; 48],
        shard_public_share: vec![0x44; 48],
        pop_signature: vec![0x55; 96],
    };
    engine.register_foreign_chain_interface(5, 8453, vec![shard]).unwrap();

    let gen_hash = B256::repeat_byte(0x01);
    let b1_hash = B256::repeat_byte(0x02);
    let b2_hash = B256::repeat_byte(0x03);

    // Advance head 1
    engine.update_canonical_foreign_head(8453, 100, b1_hash, gen_hash).unwrap();

    // Advance head 2 with valid parent continuity
    let ok_adv = engine.update_canonical_foreign_head(8453, 101, b2_hash, b1_hash);
    assert!(ok_adv.is_ok());

    // Discontinuous parent hash must fail
    let bad_parent = B256::repeat_byte(0xee);
    let bad_adv = engine.update_canonical_foreign_head(8453, 102, B256::repeat_byte(0x04), bad_parent);
    assert!(bad_adv.is_err(), "Discontinuous parent hash must be rejected");

    // Non-monotonic block height must fail
    let regressed_adv = engine.update_canonical_foreign_head(8453, 99, B256::repeat_byte(0x05), b2_hash);
    assert!(regressed_adv.is_err(), "Regressed block number must be rejected");
}
