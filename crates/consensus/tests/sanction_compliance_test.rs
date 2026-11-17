use alloy_primitives::{Address, B256};
use sovereign_consensus::system_contracts::{
    compliance::{ZkComplianceCircuitId, PRECOMPILE_ZK_COMPLIANCE},
    register_precompiles::RegisterPrecompileRouter,
    sanction_set::SanctionSet,
};

#[test]
fn test_sanction_set_commitment_deterministic() {
    let authority = Address::repeat_byte(0xaa);
    let smt_root = B256::repeat_byte(0x77);
    let sanction_set = SanctionSet::new(1337, authority, smt_root, 42);

    let commitment1 = sanction_set.compute_slot5_commitment();
    let commitment2 = sanction_set.compute_slot5_commitment();

    assert_eq!(commitment1, commitment2, "Commitment must be strictly deterministic");
    assert_ne!(commitment1, B256::ZERO, "Commitment must not be zero");

    // Mutation test
    let sanction_set_diff_epoch = SanctionSet::new(1337, authority, smt_root, 43);
    assert_ne!(commitment1, sanction_set_diff_epoch.compute_slot5_commitment());
}

#[test]
fn test_zk_compliance_precompile_dispatch() {
    let expected_root = B256::repeat_byte(0x44);
    let caller = Address::repeat_byte(0x11);

    // 1. Construct valid proof calldata for Precompile 0x66
    // [0]: circuit_id (0x01 = ProofOfInnocence)
    // [1..33]: expected_root (32 bytes)
    // [33..]: mock proof (64 bytes)
    let mut calldata = vec![ZkComplianceCircuitId::ProofOfInnocence as u8];
    calldata.extend_from_slice(expected_root.as_slice());
    calldata.extend_from_slice(&[0xab; 64]); // 64-byte mock proof envelope

    let result = RegisterPrecompileRouter::dispatch(
        &PRECOMPILE_ZK_COMPLIANCE,
        &caller,
        &calldata,
        None,
    );

    assert!(result.is_some(), "Precompile 0x66 must be recognized by router");
    let outcome = result.unwrap();
    assert!(outcome.is_ok(), "Valid compliance proof must succeed: {:?}", outcome.err());
    let ret_bytes = outcome.unwrap();
    assert_eq!(ret_bytes.len(), 32);
    assert_eq!(ret_bytes[0], 0x01);

    // 2. Negative test: short proof calldata (< 33 bytes)
    let short_calldata = vec![0x01; 20];
    let short_result = RegisterPrecompileRouter::dispatch(
        &PRECOMPILE_ZK_COMPLIANCE,
        &caller,
        &short_calldata,
        None,
    ).unwrap();
    assert!(short_result.is_err(), "Short input must fail");

    // 3. Negative test: invalid circuit ID
    let mut invalid_circuit_calldata = vec![0x99]; // Invalid ID
    invalid_circuit_calldata.extend_from_slice(expected_root.as_slice());
    invalid_circuit_calldata.extend_from_slice(&[0xab; 64]);
    let invalid_result = RegisterPrecompileRouter::dispatch(
        &PRECOMPILE_ZK_COMPLIANCE,
        &caller,
        &invalid_circuit_calldata,
        None,
    ).unwrap();
    assert!(invalid_result.is_err(), "Invalid circuit ID must fail");
}

#[test]
fn test_bafin_proof_of_innocence_flow() {
    // BaFin authority address from examples/tinyblock-genesis/sub_dao/europe/authority/bafin.yaml
    let bafin_authority = Address::new([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x01,
    ]);
    let sanction_smt_root = B256::repeat_byte(0x5a);
    let epoch = 42;

    // 1. BaFin publishes and commits SanctionSet in Slot 5
    let bafin_sanction_set = SanctionSet::new(1337, bafin_authority, sanction_smt_root, epoch);
    let slot5_commitment = bafin_sanction_set.compute_slot5_commitment();
    assert_ne!(slot5_commitment, B256::ZERO);

    // 2. User generates a Proof of Innocence against BaFin's published sanction SMT root
    let caller = Address::repeat_byte(0x99);
    let mut calldata = vec![ZkComplianceCircuitId::ProofOfInnocence as u8];
    calldata.extend_from_slice(sanction_smt_root.as_slice());
    calldata.extend_from_slice(&[0xfe; 64]); // 64-byte mock ZK proof envelope

    // 3. Submit to Precompile 0x66
    let res = RegisterPrecompileRouter::dispatch(
        &PRECOMPILE_ZK_COMPLIANCE,
        &caller,
        &calldata,
        None,
    ).expect("Precompile 0x66 dispatch");

    assert!(res.is_ok(), "BaFin Proof of Innocence verification must succeed");
    let verified = res.unwrap();
    assert_eq!(verified[0], 0x01, "Precompile must return 1 on success");

    // 4. Negative verification: root mismatch
    let tampered_root = B256::repeat_byte(0x99);
    let mut tampered_calldata = vec![ZkComplianceCircuitId::ProofOfInnocence as u8];
    tampered_calldata.extend_from_slice(tampered_root.as_slice());
    tampered_calldata.extend_from_slice(&[0xfe; 64]);

    // Construct action directly to test mismatch rejection
    let action = sovereign_consensus::system_contracts::compliance::ZkComplianceAction {
        circuit_id: ZkComplianceCircuitId::ProofOfInnocence,
        proof_bytes: alloy_primitives::Bytes::copy_from_slice(&[0xfe; 64]),
        public_inputs: alloy_primitives::Bytes::copy_from_slice(tampered_root.as_slice()),
        epoch_id: epoch,
        authority_account: bafin_authority,
    };
    assert!(!action.verify_compliance(sanction_smt_root), "Proof against tampered root must be rejected");
}

#[test]
fn test_bafin_approved_operator_compliance_flow() {
    let bafin_authority = Address::new([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x01,
    ]);
    let approved_operator_root = B256::repeat_byte(0x7b);
    let caller = Address::repeat_byte(0x88);

    // Construct ComplianceInclusion proof calldata
    let mut calldata = vec![ZkComplianceCircuitId::ComplianceInclusion as u8];
    calldata.extend_from_slice(approved_operator_root.as_slice());
    calldata.extend_from_slice(&[0xaa; 64]);

    let res = RegisterPrecompileRouter::dispatch(
        &PRECOMPILE_ZK_COMPLIANCE,
        &caller,
        &calldata,
        None,
    ).expect("Precompile 0x66 dispatch");

    assert!(res.is_ok(), "BaFin Approved Operator compliance proof must succeed");
}

