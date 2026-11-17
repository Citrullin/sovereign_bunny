//! # Integration Tests: Account-Lattice Nonce Verification & Anti-Replay Security
//!
//! Validates:
//! 1. Monotonic sequence nonce enforcement on `StatelessTransitionFrame` transitions.
//! 2. Rejection of replayed, stale, and non-consecutive nonce attempts.
//! 3. Cross-curve and multi-backend nonce continuity across SGX, Noir UltraHonk, and Mesh Threshold Settlement.
//! 4. CAR Slot register transitions with monotonic nonce verification (`transition_slot_with_nonce`).

use alloy_primitives::{Address, B256, U256};
use sovereign_consensus::execution::stateless::{BackendType, StatelessTransitionFrame};
use sovereign_consensus::lattice::car_register::PolymorphicAccountRegister;

#[test]
fn test_stateless_frame_monotonic_nonce_success() {
    let account = Address::repeat_byte(0x11);
    let pre = B256::repeat_byte(0xaa);
    let post = B256::repeat_byte(0xbb);
    let tx_data_hash = B256::repeat_byte(0xcc);
    let vk = B256::repeat_byte(0xdd);

    // Initial transition: Nonce 0 -> 1
    let frame_1 = StatelessTransitionFrame {
        account,
        slot_id: 2,
        pre_commitment: pre,
        post_commitment: post,
        tx_data_hash,
        current_nonce: 0,
        proposed_nonce: 1,
        backend: BackendType::NoirUltraHonk,
        proof_payload: vec![0x42; 32],
    };
    assert!(frame_1.verify(vk).is_ok(), "Initial monotonic nonce transition (0 -> 1) must succeed");

    // Subsequent transition: Nonce 1 -> 2
    let frame_2 = StatelessTransitionFrame {
        account,
        slot_id: 2,
        pre_commitment: post,
        post_commitment: B256::repeat_byte(0xee),
        tx_data_hash: B256::repeat_byte(0xff),
        current_nonce: 1,
        proposed_nonce: 2,
        backend: BackendType::NoirUltraHonk,
        proof_payload: vec![0x42; 32],
    };
    assert!(frame_2.verify(vk).is_ok(), "Second monotonic nonce transition (1 -> 2) must succeed");
}

#[test]
fn test_stateless_frame_nonce_replay_rejected() {
    let account = Address::repeat_byte(0x22);
    let pre = B256::repeat_byte(0x10);
    let post = B256::repeat_byte(0x20);
    let tx_data_hash = B256::repeat_byte(0x30);
    let vk = B256::repeat_byte(0x40);

    // Replay attempt where proposed_nonce == current_nonce
    let replayed_frame = StatelessTransitionFrame {
        account,
        slot_id: 1,
        pre_commitment: pre,
        post_commitment: post,
        tx_data_hash,
        current_nonce: 5,
        proposed_nonce: 5, // REPLAY!
        backend: BackendType::SgxRevm,
        proof_payload: vec![0xfe; 64],
    };

    let err = replayed_frame.verify(vk).unwrap_err();
    assert_eq!(err, "StatelessTransitionFrame: Nonce must strictly increment monotonically");
}

#[test]
fn test_stateless_frame_nonce_gap_rejected() {
    let account = Address::repeat_byte(0x33);
    let pre = B256::repeat_byte(0x10);
    let post = B256::repeat_byte(0x20);
    let tx_data_hash = B256::repeat_byte(0x30);
    let vk = B256::repeat_byte(0x40);

    // Nonce gap skipping from 3 to 5 (not consecutive)
    let gap_frame = StatelessTransitionFrame {
        account,
        slot_id: 3,
        pre_commitment: pre,
        post_commitment: post,
        tx_data_hash,
        current_nonce: 3,
        proposed_nonce: 5, // GAP!
        backend: BackendType::MeshThresholdSettlement,
        proof_payload: vec![0xab; 32],
    };

    let err = gap_frame.verify(vk).unwrap_err();
    assert_eq!(err, "StatelessTransitionFrame: Nonce must strictly increment monotonically");
}

#[test]
fn test_cross_backend_nonce_continuity() {
    let account = Address::repeat_byte(0x44);
    let vk = B256::repeat_byte(0x55);

    // Backend 1: Hardware SGX (Nonce 0 -> 1)
    let sgx_frame = StatelessTransitionFrame {
        account,
        slot_id: 2,
        pre_commitment: B256::repeat_byte(0x01),
        post_commitment: B256::repeat_byte(0x02),
        tx_data_hash: B256::repeat_byte(0x11),
        current_nonce: 0,
        proposed_nonce: 1,
        backend: BackendType::SgxRevm,
        proof_payload: vec![0xfe; 64],
    };
    assert!(sgx_frame.verify(vk).is_ok());

    // Backend 2: Noir UltraHonk ZK circuit (Nonce 1 -> 2)
    let noir_frame = StatelessTransitionFrame {
        account,
        slot_id: 2,
        pre_commitment: B256::repeat_byte(0x02),
        post_commitment: B256::repeat_byte(0x03),
        tx_data_hash: B256::repeat_byte(0x22),
        current_nonce: 1,
        proposed_nonce: 2,
        backend: BackendType::NoirUltraHonk,
        proof_payload: vec![0xaa; 32],
    };
    assert!(noir_frame.verify(vk).is_ok());

    // Backend 3: Mesh Threshold Settlement (Nonce 2 -> 3)
    let mesh_frame = StatelessTransitionFrame {
        account,
        slot_id: 2,
        pre_commitment: B256::repeat_byte(0x03),
        post_commitment: B256::repeat_byte(0x04),
        tx_data_hash: B256::repeat_byte(0x33),
        current_nonce: 2,
        proposed_nonce: 3,
        backend: BackendType::MeshThresholdSettlement,
        proof_payload: vec![0xbb; 32],
    };
    assert!(mesh_frame.verify(vk).is_ok());
}

#[test]
fn test_car_register_monotonic_nonce_enforcement() {
    let owner = Address::repeat_byte(0x88);
    let mut car = PolymorphicAccountRegister::new_with_default_config(owner, U256::from(50_000));

    let initial_nonce = car.nonce;
    let new_com = B256::repeat_byte(0xcc);

    // Valid transition increments nonce by 1
    let tip = car.transition_slot_with_nonce(2, new_com, 1, initial_nonce + 1).unwrap();
    assert_ne!(tip, B256::ZERO);
    assert_eq!(car.nonce, initial_nonce + 1);

    // Replay attempt with stale nonce fails
    let stale_err = car.transition_slot_with_nonce(2, B256::repeat_byte(0xdd), 1, initial_nonce + 1).unwrap_err();
    assert_eq!(stale_err, "CAR_ERR: Nonce must strictly increment monotonically");

    // Skipping forward past monotonic sequence fails
    let gap_err = car.transition_slot_with_nonce(2, B256::repeat_byte(0xdd), 1, car.nonce + 5).unwrap_err();
    assert_eq!(gap_err, "CAR_ERR: Nonce must strictly increment monotonically");
}
