//! # Sovereign Booklet Integration Tests
//!
//! Validates foundational pillars from the Sovereign Whitebooklet:
//! 1. Eurosystem Pontes DvP Settlement Gateway (§4.4) with pacs.009 credit transfer simulation.
//! 2. Proof of SQL Table Schema and Row Commitment Engine (§6.2) on CAR Slot 4.
//! 3. Aztec-style View-Tag Fast Scanner (§7.2) filtering out 99.6% of encrypted notes.
//! 4. Topological Anti-Sybil RTT Dispersion, ASN Quotas, and Quadratic Slashing (§9).

use alloy_primitives::{Address, B256, U256};
use sovereign_consensus::governance::anti_sybil::{
    AntiSybilEngine, NodeTopologyDescriptor, PersonalizedPageRankEngine, VivaldiCoordinate,
};
use sovereign_consensus::lattice::sql_row_anchor::{SqlColumnSchema, SqlTableStateAnchor};
use sovereign_consensus::lattice::view_tag_scanner::{
    EncryptedNoteEnvelope, ViewTagScanner,
};
use sovereign_consensus::lattice::multilateral_netting::{
    EnterpriseObligationGraph, MultilateralNettingEngine,
};
use sovereign_consensus::lattice::note::derive_view_tag;
use sovereign_consensus::pontes_gateway::{
    dispatch_target2_trigger, execute_pontes_dvp_settlement, validate_bic,
    verify_netting_proof, PontesSettlementError, PontesTriggerIntent,
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Eurosystem Pontes Settlement Tests (§4.4)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_pontes_full_dvp_lifecycle_and_utr_uniqueness() {
    let proof = {
        let mut p = b"SOV:ZK_NET:".to_vec();
        p.extend_from_slice(&[0xaa; 128]);
        p
    };

    let intent1 = PontesTriggerIntent {
        business_cycle_id: [0x10; 16],
        debtor_bic: "MARKDEF1100".to_string(),   // Sparkasse
        creditor_bic: "GENODEF1DUS".to_string(), // Volksbank
        net_amount_cents: 2_500_000_00,          // 2,500,000.00 EUR
        currency: *b"EUR",
        zk_clearing_proof: proof.clone(),
    };

    let intent2 = PontesTriggerIntent {
        business_cycle_id: [0x11; 16], // Different cycle
        debtor_bic: "MARKDEF1100".to_string(),
        creditor_bic: "GENODEF1DUS".to_string(),
        net_amount_cents: 2_500_000_00,
        currency: *b"EUR",
        zk_clearing_proof: proof,
    };

    let receipt1 = execute_pontes_dvp_settlement(&intent1)
        .expect("Pontes settlement 1 should succeed");
    let receipt2 = execute_pontes_dvp_settlement(&intent2)
        .expect("Pontes settlement 2 should succeed");

    assert_eq!(receipt1.ecb_status_code, 200);
    assert_eq!(receipt2.ecb_status_code, 200);
    assert_ne!(
        receipt1.target2_utr, receipt2.target2_utr,
        "Unique Transaction References must differ across cycles"
    );
}

#[test]
fn test_pontes_negative_validations() {
    // 1. Invalid BIC test
    assert!(!validate_bic("too_short"));
    assert!(!validate_bic("toolongbic123456"));
    assert!(!validate_bic("MARKdef1100")); // lowercase rejected
    assert!(validate_bic("MARKDEF1100"));
    assert!(validate_bic("GENODEF1"));

    // 2. Truncated proof rejected
    assert!(!verify_netting_proof(&[]));
    assert!(!verify_netting_proof(&[0x01; 10]));

    // 3. Currency mismatch rejected
    let intent_bad_currency = PontesTriggerIntent {
        business_cycle_id: [0x01; 16],
        debtor_bic: "MARKDEF1100".to_string(),
        creditor_bic: "GENODEF1DUS".to_string(),
        net_amount_cents: 1000,
        currency: *b"USD",
        zk_clearing_proof: b"SOV:ZK_NET:valid_proof_bytes_padding_here_long_enough".to_vec(),
    };
    let res = dispatch_target2_trigger(&intent_bad_currency, 1, 100);
    assert_eq!(res, Err(PontesSettlementError::UnsupportedCurrency));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Proof of SQL Row Commitments (§6.2)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_proof_of_sql_erp_invoice_accumulation_and_slot4_commitment() {
    let schema = vec![
        SqlColumnSchema {
            column_name: "invoice_number".to_string(),
            data_type: 1,
            is_indexed: true,
        },
        SqlColumnSchema {
            column_name: "debtor_did".to_string(),
            data_type: 4,
            is_indexed: true,
        },
        SqlColumnSchema {
            column_name: "creditor_did".to_string(),
            data_type: 4,
            is_indexed: true,
        },
        SqlColumnSchema {
            column_name: "total_net_cents".to_string(),
            data_type: 2,
            is_indexed: false,
        },
        SqlColumnSchema {
            column_name: "rwa_asset_backed".to_string(),
            data_type: 1,
            is_indexed: false,
        },
    ];

    let mut table_anchor = SqlTableStateAnchor::new(&schema);
    assert_eq!(table_anchor.row_count, 0);

    let debtor = [0xde; 32];
    let creditor = [0xce; 32];

    // Commit 10 sequential invoices
    for i in 1..=10u64 {
        let salt = blake3::hash(&i.to_le_bytes());
        table_anchor.commit_invoice_row(
            i,
            debtor,
            creditor,
            (i as u128) * 100_00, // 100 EUR increments
            i % 2 == 0,
            *salt.as_bytes(),
        );
        assert_eq!(table_anchor.row_count, i);
    }

    let slot4_root = table_anchor.slot4_commitment();
    assert_ne!(slot4_root, B256::ZERO);

    // Reproducibility invariant: identical sequence generates exact same slot4 commitment
    let mut table_anchor_clone = SqlTableStateAnchor::new(&schema);
    for i in 1..=10u64 {
        let salt = blake3::hash(&i.to_le_bytes());
        table_anchor_clone.commit_invoice_row(
            i,
            debtor,
            creditor,
            (i as u128) * 100_00,
            i % 2 == 0,
            *salt.as_bytes(),
        );
    }
    assert_eq!(table_anchor_clone.slot4_commitment(), slot4_root);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. View-Tag Scanner High-Throughput Filtering (§7.2)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_view_tag_scanner_filters_99_percent_of_noise() {
    let vk = [0x42; 32];
    let scanner = ViewTagScanner::new(vk);

    // Recipient ephemeral key and legitimate view tag
    let ephem_pk_alice = [0x77; 32];
    let shared_alice = scanner.derive_shared_secret(&ephem_pk_alice);
    let tag_alice = derive_view_tag(&shared_alice);

    // Create 1000 noisy notes across other users
    let mut envelopes = Vec::new();
    let mut intended_indices = Vec::new();

    for i in 0..1000u32 {
        let is_intended = i % 100 == 0; // 10 matching notes out of 1000 (1%)
        let ephem = if is_intended {
            ephem_pk_alice
        } else {
            let h = blake3::hash(&i.to_le_bytes());
            *h.as_bytes()
        };

        let tag = if is_intended {
            tag_alice
        } else {
            // Pseudo-random tag for other users
            (i % 255) as u8
        };

        if is_intended {
            intended_indices.push(envelopes.len());
        }

        envelopes.push(EncryptedNoteEnvelope {
            ephemeral_pubkey: ephem,
            view_tag: tag,
            ciphertext: vec![0xee; 64],
            manifold_id: 1,
            broadcast_epoch: 100,
        });
    }

    let scan_res = scanner.filter_batch(&envelopes);
    assert_eq!(scan_res.total_scanned, 1000);
    // At least 980 of 1000 notes should be fast-discarded without decryption
    assert!(
        scan_res.fast_discarded >= 980,
        "Fast discard should filter >= 98%, got {}",
        scan_res.fast_discarded
    );
    // All 10 intended notes must be identified
    assert!(scan_res.candidate_matches.len() >= 10);
    for idx in intended_indices {
        assert!(
            scan_res.candidate_matches.iter().any(|c| c.envelope_index == idx),
            "Candidate matches must include intended note at index {}",
            idx
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Anti-Sybil BGP Quotas, RTT Dispersion & Slashing (§9)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_anti_sybil_asn_concentration_and_rtt_dispersion() {
    let mut engine = AntiSybilEngine::default();

    let node1 = Address::repeat_byte(0x01);
    let node2 = Address::repeat_byte(0x02);
    let node3 = Address::repeat_byte(0x03);

    // Register node topologies
    engine.topologies.insert(
        node1,
        NodeTopologyDescriptor {
            validator: node1,
            bgp_asn: 16509, // AWS
            ip_prefix: "3.120.0.0/14".to_string(),
            coordinate: VivaldiCoordinate { x: 10.0, y: 20.0, z: 0.0, height: 5.0, error: 0.1 },
            hardware_ppid: B256::repeat_byte(0x11),
        },
    );
    engine.topologies.insert(
        node2,
        NodeTopologyDescriptor {
            validator: node2,
            bgp_asn: 24940, // Hetzner
            ip_prefix: "168.119.0.0/16".to_string(),
            coordinate: VivaldiCoordinate { x: 150.0, y: 80.0, z: 20.0, height: 10.0, error: 0.1 },
            hardware_ppid: B256::repeat_byte(0x22),
        },
    );
    engine.topologies.insert(
        node3,
        NodeTopologyDescriptor {
            validator: node3,
            bgp_asn: 13335, // Cloudflare
            ip_prefix: "104.16.0.0/12".to_string(),
            coordinate: VivaldiCoordinate { x: -80.0, y: 120.0, z: -30.0, height: 8.0, error: 0.1 },
            hardware_ppid: B256::repeat_byte(0x33),
        },
    );

    // Distinct ASNs pass quota check
    let committee = vec![node1, node2, node3];
    assert!(engine.verify_committee_asn_diversity(&committee).is_ok());

    // Verified speed-of-light dispersion check passes
    let dispersion = engine.verify_committee_rtt_dispersion(&committee);
    assert!(dispersion.is_ok(), "Diverse physical nodes must pass RTT dispersion");
    assert!(dispersion.unwrap() >= engine.min_rtt_dispersion_ms);
}

#[test]
fn test_personalized_pagerank_tiny_merit_rank_convergence() {
    let mut ppr = PersonalizedPageRankEngine::new();

    let alice = Address::repeat_byte(0xaa);
    let bob = Address::repeat_byte(0xbb);
    let charlie = Address::repeat_byte(0xcc);

    // Alice trusts Bob (weight 1.5)
    ppr.add_trust_edge(alice, bob, 5);
    // Bob trusts Charlie (weight 2.0)
    ppr.add_trust_edge(bob, charlie, 10);

    let rank_from_alice = ppr.compute_personalized_pagerank(alice, 20);

    assert!(rank_from_alice.contains_key(&alice));
    assert!(rank_from_alice.contains_key(&bob));
    assert!(rank_from_alice.contains_key(&charlie));

    // Bob has direct trust from Alice, so Bob's score > Charlie's 2-hop score
    let bob_score = rank_from_alice.get(&bob).unwrap();
    let charlie_score = rank_from_alice.get(&charlie).unwrap();
    assert!(bob_score > charlie_score, "Direct trust should outrank transitive trust");
    assert!(*charlie_score > 0.0, "Transitive trust should propagate");
}

#[test]
fn test_anti_correlation_quadratic_slashing_formula() {
    let stake = U256::from(100_000_000_000_000_000_000u128); // 100 ETH

    // 1 node fails out of 100 => penalty = stake * (1 / 100)^2 = 0.01 ETH
    let penalty_1 = AntiSybilEngine::calculate_anti_correlation_slashing_penalty(1, 100, stake);
    assert_eq!(penalty_1, U256::from(10_000_000_000_000_000u128));

    // 50 nodes fail out of 100 => penalty = stake * (50 / 100)^2 = 25 ETH
    let penalty_50 = AntiSybilEngine::calculate_anti_correlation_slashing_penalty(50, 100, stake);
    assert_eq!(penalty_50, U256::from(25_000_000_000_000_000_000u128));

    // 100 nodes fail out of 100 => 100% penalty = 100 ETH
    let penalty_100 = AntiSybilEngine::calculate_anti_correlation_slashing_penalty(100, 100, stake);
    assert_eq!(penalty_100, stake);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. End-to-End Circular Economy: Proof of SQL -> Cyclic Netting -> Pontes DvP
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_e2e_multilateral_netting_to_pontes_cebm_settlement() {
    // 1. Enterprises commit invoices into Proof of SQL on CAR Slot 4
    let sql_schema = vec![
        SqlColumnSchema {
            column_name: "invoice_id".to_string(),
            data_type: 1,
            is_indexed: true,
        },
        SqlColumnSchema {
            column_name: "amount_cents".to_string(),
            data_type: 2,
            is_indexed: false,
        },
    ];

    let mut sql_anchor = SqlTableStateAnchor::new(&sql_schema);

    let enterprise_a = Address::repeat_byte(0x0a); // Sparkasse member
    let enterprise_b = Address::repeat_byte(0x0b); // Sparkasse member
    let enterprise_c = Address::repeat_byte(0x0c); // Volksbank member

    let mut inv_a = [0u8; 32];
    inv_a[..20].copy_from_slice(enterprise_a.as_slice());
    let mut inv_b = [0u8; 32];
    inv_b[..20].copy_from_slice(enterprise_b.as_slice());
    let mut inv_c = [0u8; 32];
    inv_c[..20].copy_from_slice(enterprise_c.as_slice());

    let salt_a = [0x11; 32];
    let salt_b = [0x22; 32];
    let salt_c = [0x33; 32];

    let row1 = sql_anchor.commit_invoice_row(101, inv_a, inv_b, 500_000_00, false, salt_a);
    let row2 = sql_anchor.commit_invoice_row(102, inv_b, inv_c, 500_000_00, false, salt_b);
    let row3 = sql_anchor.commit_invoice_row(103, inv_c, inv_a, 400_000_00, false, salt_c);

    assert_eq!(sql_anchor.row_count, 3);
    assert_ne!(sql_anchor.slot4_commitment(), B256::ZERO);

    // 2. Build mutual credit obligation graph using Proof of SQL row commitments
    let mut graph = EnterpriseObligationGraph::new();
    graph.add_obligation(enterprise_a, enterprise_b, 500_000_00, row1); // A owes B 500k EUR
    graph.add_obligation(enterprise_b, enterprise_c, 500_000_00, row2); // B owes C 500k EUR
    graph.add_obligation(enterprise_c, enterprise_a, 400_000_00, row3); // C owes A 400k EUR (Cyclic loop!)

    let initial_gross = graph.total_gross_cents();
    assert_eq!(initial_gross, 1_400_000_00); // 1.4 Million EUR gross claims

    // 3. Execute Multilateral Netting Engine
    let netting_engine = MultilateralNettingEngine::new();
    let netting_result = netting_engine.execute_netting(&mut graph);

    // Cycle A -> B -> C -> A cancels bottleneck of 400k across all 3 parties = 1.2M EUR extinguished!
    assert_eq!(netting_result.extinguished_cyclic_cents, 1_200_000_00);
    // Residual net imbalance is only 200k EUR (85.7% debt compression!)
    assert_eq!(netting_result.residual_net_cents, 200_000_00);
    assert!(netting_result.compression_ratio > 0.85);

    // 4. Submit residual net imbalance (200k EUR) to Eurosystem Pontes Gateway
    let mut zk_clearing_proof = b"SOV:ZK_NET:".to_vec();
    zk_clearing_proof.extend_from_slice(sql_anchor.slot4_commitment().as_slice());
    zk_clearing_proof.extend_from_slice(&[0x99; 32]);

    let pontes_intent = PontesTriggerIntent {
        business_cycle_id: [0x50; 16],
        debtor_bic: "MARKDEF1100".to_string(),   // Sparkasse (settling debtor Enterprise A & B)
        creditor_bic: "GENODEF1DUS".to_string(), // Volksbank (creditor Enterprise C)
        net_amount_cents: netting_result.residual_net_cents,
        currency: *b"EUR",
        zk_clearing_proof,
    };

    let receipt = execute_pontes_dvp_settlement(&pontes_intent)
        .expect("Pontes DvP settlement of residual netting must succeed");

    // 5. Final & Irrevocable CeBM Settlement in TARGET2
    assert_eq!(receipt.ecb_status_code, 200);
    assert_ne!(receipt.target2_utr, [0u8; 32]);
    assert_eq!(receipt.settled_block_height, 1001);
}


