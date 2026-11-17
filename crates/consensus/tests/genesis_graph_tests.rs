use alloy_primitives::{B256, U256, address};
use sovereign_consensus::config::{
    GenesisGraphAccount, GenesisRelationTuple, GenesisSlotCommitment, NetworkGenesisConfig,
};
use sovereign_consensus::lattice::car_register::{AccountEntityKind, AccountGraph, PolymorphicAccountRegister};

#[test]
fn test_genesis_graph_initialization() {
    let mut config = NetworkGenesisConfig::default();
    let test_dao = address!("1111111111111111111111111111111111111111");
    let test_repo = address!("2222222222222222222222222222222222222222");
    let test_user = address!("3333333333333333333333333333333333333333");

    let slot_git_root = B256::repeat_byte(0xab);
    let slot_rebac_root = B256::repeat_byte(0xcd);

    config.graph_accounts.push(GenesisGraphAccount {
        address: test_dao,
        entity_kind: "DAO".to_string(),
        initial_balance: U256::from(100_000_000_000_000_000_000u128),
        did: Some("did:sovereign:1337:governance-dao".to_string()),
        initial_slots: vec![GenesisSlotCommitment {
            slot_id: 1,
            plugin_id: "core.zanzibar".to_string(),
            commitment: slot_rebac_root,
        }],
    });

    config.graph_accounts.push(GenesisGraphAccount {
        address: test_repo,
        entity_kind: "GitRepo".to_string(),
        initial_balance: U256::ZERO,
        did: Some("did:sovereign:1337:repo-kernel".to_string()),
        initial_slots: vec![GenesisSlotCommitment {
            slot_id: 3,
            plugin_id: "vcs.git_dag".to_string(),
            commitment: slot_git_root,
        }],
    });

    config.initial_rebac_tuples.push(GenesisRelationTuple {
        namespace: 1,
        object_id: B256::repeat_byte(0x01),
        relation: 1,
        subject: "did:sovereign:1337:user-admin".to_string(),
    });

    let mut graph = AccountGraph::new();
    graph.load_genesis(&config);

    // Verify DAO registration & slot mount
    let dao_node = graph.nodes.get(&test_dao).expect("DAO account should be registered in graph");
    assert!(matches!(dao_node.kind, AccountEntityKind::DaoTreasury { .. }));
    assert_eq!(dao_node.register.balance, U256::from(100_000_000_000_000_000_000u128));
    let slot1 = dao_node.register.slots.get(&1).expect("Slot 1 should be mounted on DAO");
    assert_eq!(slot1.commitment, slot_rebac_root);

    // Verify Git Repo registration & slot 3 mount
    let repo_node = graph.nodes.get(&test_repo).expect("Repo account should be registered in graph");
    assert!(matches!(repo_node.kind, AccountEntityKind::GitRepository { .. }));
    let slot3 = repo_node.register.slots.get(&3).expect("Slot 3 should be mounted on Git Repo");
    assert_eq!(slot3.commitment, slot_git_root);

    // Verify uninitialized account is not present in graph
    assert!(graph.nodes.get(&test_user).is_none());
}

#[test]
fn test_bundle_genesis_graph_e2e() {
    let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/tinyblock-genesis/genesis_bundle.yaml");
    assert!(manifest_path.exists(), "tinyblock-genesis/genesis_bundle.yaml should exist");

    // Load compiled network_config.json from tinyblock-genesis
    let bundle_dir = manifest_path.parent().unwrap();
    let net_path = bundle_dir.join("network.yaml");
    assert!(net_path.exists());

    // Verify all core accounts and roles
    let mut config = NetworkGenesisConfig::default();
    config.network_name = "sovereign-bunny-mainnet".to_string();
    config.chain_id = 1337;

    let global_dao = address!("1111111111111111111111111111111111111111");
    // Derive sub-entities using circuit-safe Poseidon hierarchical child derivation
    let europe_dao = sovereign_consensus::lattice::car_register::derive_child_address(&global_dao, "sub_dao/europe");
    let bafin_auth = sovereign_consensus::lattice::car_register::derive_child_address(&europe_dao, "authority/bafin");
    let asia_collab = sovereign_consensus::lattice::car_register::derive_child_address(&global_dao, "authority/asia_collab");
    let sov_bunny_repo = sovereign_consensus::lattice::car_register::derive_child_address(&europe_dao, "repos/sovereign_bunny");
    let nexterp_srv = sovereign_consensus::lattice::car_register::derive_child_address(&europe_dao, "services/nexterp");
    let alice_admin = address!("a11ce00000000000000000000000000000000001");


    config.graph_accounts.push(GenesisGraphAccount {
        address: global_dao,
        entity_kind: "DAO".to_string(),
        initial_balance: U256::from(100_000_000_000_000_000_000_000_000u128),
        did: Some("did:sovereign:1337:dao-global-tinyblock".to_string()),
        initial_slots: vec![
            GenesisSlotCommitment { slot_id: 0, plugin_id: "core.did_identity".to_string(), commitment: B256::repeat_byte(0x01) },
            GenesisSlotCommitment { slot_id: 8, plugin_id: "dao.voting_weight".to_string(), commitment: B256::repeat_byte(0x08) },
        ],
    });

    config.graph_accounts.push(GenesisGraphAccount {
        address: europe_dao,
        entity_kind: "DAO".to_string(),
        initial_balance: U256::from(20_000_000_000_000_000_000_000_000u128),
        did: Some("did:sovereign:1337:dao-europe".to_string()),
        initial_slots: vec![
            GenesisSlotCommitment { slot_id: 8, plugin_id: "dao.voting_weight".to_string(), commitment: B256::from([0x92u8; 32]) },
        ],
    });

    config.graph_accounts.push(GenesisGraphAccount {
        address: bafin_auth,
        entity_kind: "Authority".to_string(),
        initial_balance: U256::ZERO,
        did: Some("did:sovereign:1337:bafin-de".to_string()),
        initial_slots: vec![
            GenesisSlotCommitment { slot_id: 5, plugin_id: "authority.xroad_descriptor".to_string(), commitment: B256::repeat_byte(0x05) },
        ],
    });

    config.graph_accounts.push(GenesisGraphAccount {
        address: asia_collab,
        entity_kind: "CollaborativeAuthority".to_string(),
        initial_balance: U256::ZERO,
        did: Some("did:sovereign:1337:asia-collab-enforcement".to_string()),
        initial_slots: vec![
            GenesisSlotCommitment { slot_id: 9, plugin_id: "authority.compliance_counter".to_string(), commitment: B256::repeat_byte(0x09) },
        ],
    });

    config.graph_accounts.push(GenesisGraphAccount {
        address: sov_bunny_repo,
        entity_kind: "GitRepository".to_string(),
        initial_balance: U256::ZERO,
        did: Some("did:sovereign:1337:repo-sovereign-bunny".to_string()),
        initial_slots: vec![
            GenesisSlotCommitment { slot_id: 3, plugin_id: "vcs.git_dag".to_string(), commitment: B256::repeat_byte(0x03) },
        ],
    });

    config.graph_accounts.push(GenesisGraphAccount {
        address: nexterp_srv,
        entity_kind: "Service".to_string(),
        initial_balance: U256::ZERO,
        did: Some("did:sovereign:1337:service-nexterp".to_string()),
        initial_slots: vec![
            GenesisSlotCommitment { slot_id: 4, plugin_id: "ext.sqldigest".to_string(), commitment: B256::repeat_byte(0x04) },
        ],
    });

    config.graph_accounts.push(GenesisGraphAccount {
        address: alice_admin,
        entity_kind: "User".to_string(),
        initial_balance: U256::from(10_000_000_000_000_000_000_000u128),
        did: Some("did:sovereign:1337:alice-admin".to_string()),
        initial_slots: vec![
            GenesisSlotCommitment { slot_id: 0, plugin_id: "core.did_identity".to_string(), commitment: B256::repeat_byte(0x91) },
        ],
    });

    let mut graph = AccountGraph::new();
    graph.load_genesis(&config);

    // 1. Verify Global DAO
    let gnode = graph.nodes.get(&global_dao).expect("Global DAO exists");
    assert!(matches!(gnode.kind, AccountEntityKind::DaoTreasury { .. }));
    assert!(gnode.register.slots.contains_key(&8), "Voting weight slot 8 must be mounted");

    // 2. Verify Regional DAO
    let enode = graph.nodes.get(&europe_dao).expect("Europe DAO exists");
    assert!(matches!(enode.kind, AccountEntityKind::DaoTreasury { .. }));

    // 3. Verify Regulatory Authority
    let bnode = graph.nodes.get(&bafin_auth).expect("BaFin authority exists");
    assert!(matches!(bnode.kind, AccountEntityKind::Authority { .. }));
    assert!(bnode.register.slots.contains_key(&5), "X-Road slot 5 mounted");

    // 4. Verify Collaborative Authority
    let anode = graph.nodes.get(&asia_collab).expect("Asia Collab exists");
    assert!(matches!(anode.kind, AccountEntityKind::CollaborativeAuthority { .. }));

    // 5. Verify Git Repo
    let rnode = graph.nodes.get(&sov_bunny_repo).expect("Repo exists");
    assert!(matches!(rnode.kind, AccountEntityKind::GitRepository { .. }));
    assert!(rnode.register.slots.contains_key(&3), "Git DAG slot 3 mounted");

    // 6. Verify Service Account
    let snode = graph.nodes.get(&nexterp_srv).expect("NextERP service exists");
    assert!(matches!(snode.kind, AccountEntityKind::Service { .. }));
    assert!(snode.register.slots.contains_key(&4), "SQL digest slot 4 mounted");

    // 7. Verify Human Account
    let cnode = graph.nodes.get(&alice_admin).expect("Alice admin exists");
    assert!(matches!(cnode.kind, AccountEntityKind::UserProfile));
    assert!(cnode.register.has_registered_did());
}

#[test]
fn test_bundle_genesis_negative_cases() {
    let mut graph = AccountGraph::new();
    let config = NetworkGenesisConfig::default();
    graph.load_genesis(&config);

    // Negative 1: Unknown un-registered account lookup must return None
    let unknown = address!("deaddeaddeaddeaddeaddeaddeaddeaddeaddead");
    assert!(graph.nodes.get(&unknown).is_none());

    // Negative 2: Fresh default account has no registered DID and cannot have slot mutations
    let unregistered_reg = PolymorphicAccountRegister::new_with_default_config(unknown, U256::ZERO);
    assert!(!unregistered_reg.has_registered_did(), "Fresh account MUST NOT have registered DID");

    // Negative 3: Verify non-existent slot returns None
    assert!(unregistered_reg.slots.get(&999).is_none());
}

