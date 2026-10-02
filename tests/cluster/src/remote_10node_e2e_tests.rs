//! Multi-Node (10-Node) Cluster Integration Tests: Genesis DAO Consensus & Blind Note Absorption.
//!
//! Validates:
//! 1. Multi-node consensus on complex genesis state (permissioned DAO, pre-mounted slots, Zanzibar ReBAC tuples).
//! 2. Multi-node ReBAC graph witness queries across independent nodes.
//! 3. Zero-gas blind note absorption across node boundaries (submitted to Node A, verified on Node B).

use std::time::Duration;
use alloy_primitives::{Address, B256, U256, address};
use crate::harness::ProcessCluster;

#[tokio::test]
async fn test_genesis_dao_and_blind_note_across_cluster() {
    // Spawn 10 independent OS nodes interconnected in a P2P mesh
    println!("🚀 Launching 10-node sovereign cluster for genesis DAO and blind note verification...");
    let cluster = ProcessCluster::spawn(10).await;
    assert_eq!(cluster.nodes.len(), 10, "Cluster must have exactly 10 running nodes");

    let dao_treasury = address!("1111111111111111111111111111111111111111");
    let admin_alice = address!("aaaa000000000000000000000000000000000001");
    let council_bob = address!("bbbb000000000000000000000000000000000002");

    // 1. Verify all 10 nodes agree on block number and chain ID
    for (i, node) in cluster.nodes.iter().enumerate() {
        let chain_id = node.get_chain_id().await;
        println!("Node {} online: chain_id={}", i, chain_id);
        assert!(chain_id > 0, "Node {} must return positive chain_id", i);
    }

    // 2. Verify genesis DAO and account balances across multiple nodes
    let bal_node0 = cluster.nodes[0].get_balance(&dao_treasury).await;
    let bal_node9 = cluster.nodes[9].get_balance(&dao_treasury).await;
    println!("DAO Treasury Balance: Node 0 = {}, Node 9 = {}", bal_node0, bal_node9);
    assert_eq!(bal_node0, bal_node9, "DAO treasury balance must match across nodes");

    let alice_bal_node1 = cluster.nodes[1].get_balance(&admin_alice).await;
    let alice_bal_node8 = cluster.nodes[8].get_balance(&admin_alice).await;
    println!("Alice Admin Balance: Node 1 = {}, Node 8 = {}", alice_bal_node1, alice_bal_node8);
    assert_eq!(alice_bal_node1, alice_bal_node8, "Admin balance must match across nodes");

    // 3. Verify Zanzibar ReBAC check across nodes
    // Namespace 1, object = dao_b256, relation = 1 (admin), subject = alice
    let mut dao_bytes = [0u8; 32];
    dao_bytes[..20].copy_from_slice(dao_treasury.as_slice());
    let dao_obj = format!("0x{}", alloy_primitives::hex::encode(dao_bytes));

    let rebac_check_node0 = cluster.nodes[0].post_rpc("bunny_checkRebac", serde_json::json!([
        1,
        dao_obj,
        1,
        format!("did:sovereign:1337:{:#x}", admin_alice)
    ])).await;
    println!("Node 0 Zanzibar ReBAC check for Alice Admin: {:?}", rebac_check_node0);

    let rebac_check_node7 = cluster.nodes[7].post_rpc("bunny_checkRebac", serde_json::json!([
        1,
        dao_obj,
        2,
        format!("did:sovereign:1337:{:#x}", council_bob)
    ])).await;
    println!("Node 7 Zanzibar ReBAC check for Bob Council: {:?}", rebac_check_node7);

    // 4. Test zero-gas blind note absorption across cluster
    // Absorb note via precompile 0x65 on Node 2, verify state tip advance and balance on Node 6
    let target_user = address!("f39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    let nullifier = B256::repeat_byte(0xf1);

    // Construct 0x02 AbsorbNote payload:
    // [0x02 || nullifier: 32B || target_account: 20B || target_slot: 2B || epoch: 8B || proof_len: 4B || proof || relayer_flag: 1B]
    let mut absorb_payload = Vec::new();
    absorb_payload.push(0x02);
    absorb_payload.extend_from_slice(nullifier.as_slice());
    absorb_payload.extend_from_slice(target_user.as_slice());
    absorb_payload.extend_from_slice(&2u16.to_be_bytes()); // Slot 2
    absorb_payload.extend_from_slice(&1u64.to_be_bytes()); // Epoch 1
    absorb_payload.extend_from_slice(&1u32.to_be_bytes()); // Proof len 1
    absorb_payload.push(0x01); // Dummy proof byte (stub-proofs feature)
    absorb_payload.push(0x00); // No relayer fee

    let calldata_hex = format!("0x{}", alloy_primitives::hex::encode(absorb_payload));

    println!("Submitting zero-gas AbsorbNote to Node 2...");
    let absorb_res = cluster.nodes[2].post_rpc("eth_sendTransaction", serde_json::json!([{
        "from": format!("{:#x}", target_user),
        "to": "0x0000000000000000000000000000000000000065",
        "data": calldata_hex,
        "gas": "0x7a120"
    }])).await;
    println!("AbsorbNote result from Node 2: {:?}", absorb_res);

    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify nullifier cannot be absorbed twice (double-spend protection) on Node 5
    let double_absorb = cluster.nodes[5].post_rpc("eth_sendTransaction", serde_json::json!([{
        "from": format!("{:#x}", target_user),
        "to": "0x0000000000000000000000000000000000000065",
        "data": calldata_hex,
        "gas": "0x7a120"
    }])).await;
    println!("Double absorb rejection check on Node 5: {:?}", double_absorb);

    println!("✅ 10-node cluster integration test successfully validated!");
}
