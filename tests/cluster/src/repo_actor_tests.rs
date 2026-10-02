use alloy_primitives::{address, Address, Bytes, B256};
use sovereign_consensus::governance::repo_actor::{
    evaluate_repo_actor_note, DeltaType, InterfaceDelta, RepoActorDecision, RepoActorNote, RepoActorState,
};

#[test]
fn test_repo_actor_state_slot3_git_head_and_supply_chain_lattice() {
    let repo_engine = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let initial_git_oid = B256::repeat_byte(0x11);
    let initial_interface_commitment = B256::repeat_byte(0x22);

    let mut state = RepoActorState {
        git_head: initial_git_oid,
        branch: "main".to_string(),
        interface_commitment: initial_interface_commitment,
        last_advanced_epoch: 10,
        pinned_deps: vec![],
    };

    assert_eq!(state.git_head, initial_git_oid);
    assert_eq!(state.branch, "main");

    // 1. Non-breaking Additive change note
    let new_head = B256::repeat_byte(0x33);
    let additive_delta = InterfaceDelta {
        old_commitment: initial_interface_commitment,
        new_commitment: B256::repeat_byte(0x44),
        delta_type: DeltaType::Additive,
        summary: Some("Added new getter getAccountLatticeHeight".to_string()),
    };

    let nonbreaking_note = RepoActorNote {
        upstream_repo: repo_engine,
        new_upstream_head: new_head,
        slot3_witness: Bytes::from(vec![0xaa, 0xbb, 0xcc]),
        interface_delta: additive_delta.clone(),
        is_breaking: false,
        suggested_adapter: None,
    };

    // Evaluate: tests pass -> AutoAccepted
    let decision = evaluate_repo_actor_note(&nonbreaking_note, true, false);
    match decision {
        RepoActorDecision::AutoAccepted { nullifier } => {
            assert_ne!(nullifier, B256::ZERO);
            // Advance state
            state.git_head = new_head;
            state.interface_commitment = additive_delta.new_commitment;
            state.last_advanced_epoch = 11;
        }
        _ => panic!("Expected AutoAccepted for nonbreaking change with passing tests"),
    }

    assert_eq!(state.git_head, new_head);

    // 2. Breaking change note with auto-adapter
    let breaking_head = B256::repeat_byte(0x55);
    let breaking_delta = InterfaceDelta {
        old_commitment: state.interface_commitment,
        new_commitment: B256::repeat_byte(0x66),
        delta_type: DeltaType::Renaming,
        summary: Some("Renamed method from legacy signature".to_string()),
    };

    let breaking_note = RepoActorNote {
        upstream_repo: repo_engine,
        new_upstream_head: breaking_head,
        slot3_witness: Bytes::from(vec![0xdd, 0xee]),
        interface_delta: breaking_delta,
        is_breaking: true,
        suggested_adapter: Some(Bytes::from(b"patch:adapter".to_vec())),
    };

    // Auto-adapter available and tests pass
    let adapted_decision = evaluate_repo_actor_note(&breaking_note, true, true);
    match adapted_decision {
        RepoActorDecision::AutoAdapted { adapter_commit, nullifier } => {
            assert_ne!(adapter_commit, B256::ZERO);
            assert_ne!(nullifier, B256::ZERO);
        }
        _ => panic!("Expected AutoAdapted when adapter is available"),
    }

    // 3. Breaking change without adapter -> Contention (open note / human review)
    let contention_decision = evaluate_repo_actor_note(&breaking_note, true, false);
    match contention_decision {
        RepoActorDecision::Contention { reason } => {
            assert!(reason.contains("Breaking change"));
        }
        _ => panic!("Expected Contention for unhandled breaking change"),
    }

    // 4. Test failure -> Contention
    let failed_ci_decision = evaluate_repo_actor_note(&nonbreaking_note, false, false);
    match failed_ci_decision {
        RepoActorDecision::Contention { reason } => {
            assert!(reason.contains("Sandboxed CI test matrix failed"));
        }
        _ => panic!("Expected Contention when CI test fails"),
    }
}
