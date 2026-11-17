use std::collections::BTreeMap;
use std::path::Path;
use alloy_primitives::{Address, B256, Bytes, U256};
use serde::{Deserialize, Serialize};
use sovereign_consensus::config::{
    GenesisBlindNote, GenesisContract, GenesisGraphAccount, GenesisRelationTuple,
    GenesisSlotCommitment, NetworkGenesisConfig,
};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GenesisBundleManifest {
    pub schema_version: String,
    pub bundle_type: String, // "network_genesis" | "sub_genesis"
    pub bundle_id: String,
    pub parent_genesis_cid: Option<String>,
    pub compiled_by: Option<String>,
    pub sections: BundleSections,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BundleSections {
    pub network: Option<String>,
    pub whitelist: Option<String>,
    pub global_dao: Option<String>,
    pub voting_weights: Option<String>,
    #[serde(default)]
    pub sub_daos: Vec<String>,
    #[serde(default)]
    pub authorities: Vec<String>,
    #[serde(default)]
    pub repos: Vec<String>,
    #[serde(default)]
    pub services: Vec<String>,
    #[serde(default)]
    pub contracts: Vec<String>,
    #[serde(default)]
    pub blind_notes: Vec<String>,
    #[serde(default)]
    pub rebac: Vec<String>,
    #[serde(default)]
    pub sql: Vec<String>,
    #[serde(default)]
    pub git_mirrors: Vec<String>,
    #[serde(default)]
    pub iot: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NetworkYaml {
    pub network_name: Option<String>,
    pub chain_id: Option<u64>,
    pub ticker: Option<String>,
    pub manifold_id: Option<u64>,
    pub block_time_ms: Option<u64>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WhitelistYaml {
    #[serde(default)]
    pub admin_addresses: Vec<String>,
    #[serde(default)]
    pub node_operators: Vec<NodeOperatorEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeOperatorEntry {
    pub address: String,
    pub alias: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VotingWeightsYaml {
    #[serde(default)]
    pub sub_daos: Vec<SpecSubDaoRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecSubDaoRef {
    pub address: String,
    pub region: String,
    pub voting_weight_bps: u16,
    #[serde(default)]
    pub is_shell: bool,
    #[serde(default)]
    pub sub_genesis_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecDaoAccountFile {
    pub address: String,
    pub entity_kind: String,
    pub name: Option<String>,
    pub region: Option<String>,
    pub voting_weight_bps: Option<u16>,
    #[serde(default)]
    pub is_shell: bool,
    pub did: Option<String>,
    #[serde(default)]
    pub initial_balance: Option<String>,
    #[serde(default)]
    pub slots: Vec<crate::genesis::SpecSlot>,
    #[serde(default)]
    pub members: Vec<crate::genesis::SpecDaoMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecAuthorityFile {
    pub address: String,
    pub entity_kind: String,
    pub did: Option<String>,
    pub authority_jurisdiction: Option<String>,
    pub authority_body: Option<String>,
    pub authority_url: Option<String>,
    #[serde(default)]
    pub regulatory_frameworks: Vec<String>,
    pub xroad_member_code: Option<String>,
    pub xroad_supervised_entity: Option<String>,
    #[serde(default)]
    pub slots: Vec<crate::genesis::SpecSlot>,
    pub blind_note: Option<SpecPublicBlindNote>,
    pub threshold_control: Option<SpecThresholdControl>,
    pub compliance_model: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecPublicBlindNote {
    #[serde(default)]
    pub is_public: bool,
    pub target_slot: u16,
    #[serde(default)]
    pub value: Option<String>,
    pub content_type: Option<String>,
    #[serde(default)]
    pub payload: serde_json::Value,
    pub nullifier: Option<String>,
    pub secret: Option<String>,
    pub iroh_cid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecThresholdControl {
    pub threshold: u8,
    #[serde(default)]
    pub signers: Vec<String>,
    #[serde(default)]
    pub scheme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecGitRepoFile {
    pub address: String,
    pub entity_kind: String,
    pub did: Option<String>,
    pub repo_name: String,
    pub remote_url: String,
    pub local_mirror_alias: String,
    #[serde(default)]
    pub slots: Vec<crate::genesis::SpecSlot>,
    #[serde(default)]
    pub depends_on: Vec<SpecRepoDependency>,
    pub threshold_control: Option<SpecThresholdControl>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecRepoDependency {
    pub repo_account: String,
    pub relation: String,
    pub pinned_commitment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecServiceFile {
    pub address: String,
    pub entity_kind: String,
    pub did: Option<String>,
    pub service_name: String,
    pub oci_image: String,
    pub oci_digest: String,
    #[serde(default)]
    pub slots: Vec<crate::genesis::SpecSlot>,
    pub sql_genesis: Option<SpecSqlGenesisRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecSqlGenesisRef {
    pub schema_ref: Option<String>,
    pub initial_data_ref: Option<String>,
    pub proof_of_sql_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecSqlSchemaFile {
    pub schema_version: Option<String>,
    pub target_account: String,
    pub target_slot: u16,
    pub oci_source: Option<String>,
    pub schema_digest_algorithm: Option<String>,
    #[serde(default)]
    pub tables: Vec<SpecSqlTable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecSqlTable {
    pub name: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecSqlInsertsFile {
    pub target_account: Option<String>,
    #[serde(default)]
    pub initial_inserts: Vec<SpecSqlInsert>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecSqlInsert {
    pub table: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecProofOfSqlFile {
    pub target_account: Option<String>,
    pub proof_type: String,
    pub query: String,
    pub expected_result: serde_json::Value,
    pub schema_commitment: String,
    pub prover: String,
    pub proof_bytes: String,
    pub verifier_key: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecGitMirrorFile {
    pub remote_url: String,
    pub local_alias: String,
    pub mirror_type: String,
    pub linked_repo_account: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecIoTFile {
    pub address: String,
    pub thing_description_url: String,
    pub td_version: String,
    pub td_digest: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecRebacTuplesFile {
    #[serde(default)]
    pub tuples: Vec<crate::genesis::SpecRebacTuple>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenesisBundleOutput {
    pub config: NetworkGenesisConfig,
    pub evm_genesis: serde_json::Value,
    pub bundle_manifest: GenesisBundleManifest,
    pub whitelist: WhitelistYaml,
    pub git_mirrors: Vec<SpecGitMirrorFile>,
    pub proof_of_sql_stubs: Vec<SpecProofOfSqlFile>,
}

pub struct GenesisBundleCompiler;

impl GenesisBundleCompiler {
    pub fn compile_from_bundle<P: AsRef<Path>>(bundle_dir: P) -> eyre::Result<GenesisBundleOutput> {
        let dir = bundle_dir.as_ref();
        let manifest_path = dir.join("genesis_bundle.yaml");
        if !manifest_path.exists() {
            eyre::bail!("genesis_bundle.yaml not found in directory: {}", dir.display());
        }

        let manifest_content = std::fs::read_to_string(&manifest_path)?;
        let manifest: GenesisBundleManifest = serde_yaml::from_str(&manifest_content)?;

        let mut config = NetworkGenesisConfig::default();

        // 1. Network config
        if let Some(ref net_rel) = manifest.sections.network {
            let net_path = dir.join(net_rel);
            if net_path.exists() {
                let s = std::fs::read_to_string(&net_path)?;
                let net_yaml: NetworkYaml = serde_yaml::from_str(&s)?;
                if let Some(name) = net_yaml.network_name {
                    config.network_name = name;
                }
                if let Some(id) = net_yaml.chain_id {
                    config.chain_id = id;
                }
                if let Some(ticker) = net_yaml.ticker {
                    config.ticker = ticker;
                }
            }
        }

        // 2. Whitelist
        let mut whitelist_data = WhitelistYaml::default();
        if let Some(ref wl_rel) = manifest.sections.whitelist {
            let wl_path = dir.join(wl_rel);
            if wl_path.exists() {
                let s = std::fs::read_to_string(&wl_path)?;
                whitelist_data = serde_yaml::from_str(&s)?;
            }
        }

        // 3. Global DAO Treasury
        let mut global_dao_addr: Option<Address> = None;
        if let Some(ref dao_rel) = manifest.sections.global_dao {
            let dao_path = dir.join(dao_rel);
            if dao_path.exists() {
                let s = std::fs::read_to_string(&dao_path)?;
                let gdao: SpecDaoAccountFile = serde_yaml::from_str(&s)?;
                let addr: Address = gdao.address.parse()?;
                global_dao_addr = Some(addr);
                let bal = crate::genesis::parse_balance(gdao.initial_balance.as_deref());
                let did = gdao.did.unwrap_or_else(|| format!("did:sovereign:{}:{:#x}", config.chain_id, addr));

                let mut slots = Vec::new();
                for slot in gdao.slots {
                    let commitment = crate::genesis::parse_or_hash_b256(&slot.commitment)?;
                    slots.push(GenesisSlotCommitment {
                        slot_id: slot.slot_id,
                        plugin_id: slot.plugin_id,
                        commitment,
                    });
                }

                config.graph_accounts.push(GenesisGraphAccount {
                    address: addr,
                    entity_kind: gdao.entity_kind,
                    initial_balance: bal,
                    did: Some(did),
                    initial_slots: slots,
                });
            }
        }

        // 4. Sub-DAOs
        for sub_rel in &manifest.sections.sub_daos {
            let sub_path = dir.join(sub_rel);
            if sub_path.exists() {
                let s = std::fs::read_to_string(&sub_path)?;
                let sdao: SpecDaoAccountFile = serde_yaml::from_str(&s)?;
                let addr: Address = sdao.address.parse()?;
                let bal = crate::genesis::parse_balance(sdao.initial_balance.as_deref());
                let did = sdao.did.unwrap_or_else(|| format!("did:sovereign:{}:{:#x}", config.chain_id, addr));

                let mut slots = Vec::new();
                for slot in sdao.slots {
                    let commitment = crate::genesis::parse_or_hash_b256(&slot.commitment)?;
                    slots.push(GenesisSlotCommitment {
                        slot_id: slot.slot_id,
                        plugin_id: slot.plugin_id,
                        commitment,
                    });
                }

                config.graph_accounts.push(GenesisGraphAccount {
                    address: addr,
                    entity_kind: sdao.entity_kind,
                    initial_balance: bal,
                    did: Some(did.clone()),
                    initial_slots: slots,
                });

                // Add members if specified
                let dao_b256 = B256::from_slice(&[addr.as_slice(), &[0u8; 12]].concat());
                for m in sdao.members {
                    let m_addr: Address = m.address.parse()?;
                    let m_bal = crate::genesis::parse_balance(m.initial_balance.as_deref());
                    let m_did = m.did.unwrap_or_else(|| format!("did:sovereign:{}:{:#x}", config.chain_id, m_addr));

                    let mut m_slots = Vec::new();
                    for slot in m.slots {
                        let commitment = crate::genesis::parse_or_hash_b256(&slot.commitment)?;
                        m_slots.push(GenesisSlotCommitment {
                            slot_id: slot.slot_id,
                            plugin_id: slot.plugin_id,
                            commitment,
                        });
                    }

                    config.graph_accounts.push(GenesisGraphAccount {
                        address: m_addr,
                        entity_kind: "User".to_string(),
                        initial_balance: m_bal,
                        did: Some(m_did.clone()),
                        initial_slots: m_slots,
                    });

                    let rel_id = match m.role.to_lowercase().as_str() {
                        "admin" | "owner" => 1,
                        "council" | "manager" => 2,
                        "auditor" => 3,
                        _ => 4,
                    };

                    config.initial_rebac_tuples.push(GenesisRelationTuple {
                        namespace: 1,
                        object_id: dao_b256,
                        relation: rel_id,
                        subject: m_did,
                    });
                }

                // If global DAO is defined, add sub_dao membership tuple (relation 5)
                if let Some(gaddr) = global_dao_addr {
                    let gdao_b256 = B256::from_slice(&[gaddr.as_slice(), &[0u8; 12]].concat());
                    config.initial_rebac_tuples.push(GenesisRelationTuple {
                        namespace: 1,
                        object_id: gdao_b256,
                        relation: 5, // sub_dao_member
                        subject: did,
                    });
                }
            }
        }

        // 5. Authorities
        for auth_rel in &manifest.sections.authorities {
            let auth_path = dir.join(auth_rel);
            if auth_path.exists() {
                let s = std::fs::read_to_string(&auth_path)?;
                let auth: SpecAuthorityFile = serde_yaml::from_str(&s)?;
                let addr: Address = auth.address.parse()?;
                let did = auth.did.unwrap_or_else(|| format!("did:sovereign:{}:{:#x}", config.chain_id, addr));

                let mut slots = Vec::new();
                for slot in auth.slots {
                    let commitment = crate::genesis::parse_or_hash_b256(&slot.commitment)?;
                    slots.push(GenesisSlotCommitment {
                        slot_id: slot.slot_id,
                        plugin_id: slot.plugin_id,
                        commitment,
                    });
                }

                config.graph_accounts.push(GenesisGraphAccount {
                    address: addr,
                    entity_kind: auth.entity_kind,
                    initial_balance: U256::ZERO,
                    did: Some(did),
                    initial_slots: slots,
                });
            }
        }

        // 6. Repos
        for repo_rel in &manifest.sections.repos {
            let repo_path = dir.join(repo_rel);
            if repo_path.exists() {
                let s = std::fs::read_to_string(&repo_path)?;
                let repo: SpecGitRepoFile = serde_yaml::from_str(&s)?;
                let addr: Address = repo.address.parse()?;
                let did = repo.did.unwrap_or_else(|| format!("did:sovereign:{}:{:#x}", config.chain_id, addr));

                let mut slots = Vec::new();
                for slot in repo.slots {
                    let commitment = crate::genesis::parse_or_hash_b256(&slot.commitment)?;
                    slots.push(GenesisSlotCommitment {
                        slot_id: slot.slot_id,
                        plugin_id: slot.plugin_id,
                        commitment,
                    });
                }

                config.graph_accounts.push(GenesisGraphAccount {
                    address: addr,
                    entity_kind: repo.entity_kind,
                    initial_balance: U256::ZERO,
                    did: Some(did),
                    initial_slots: slots,
                });
            }
        }

        // 7. Services
        for srv_rel in &manifest.sections.services {
            let srv_path = dir.join(srv_rel);
            if srv_path.exists() {
                let s = std::fs::read_to_string(&srv_path)?;
                let srv: SpecServiceFile = serde_yaml::from_str(&s)?;
                let addr: Address = srv.address.parse()?;
                let did = srv.did.unwrap_or_else(|| format!("did:sovereign:{}:{:#x}", config.chain_id, addr));

                let mut slots = Vec::new();
                for slot in srv.slots {
                    let commitment = crate::genesis::parse_or_hash_b256(&slot.commitment)?;
                    slots.push(GenesisSlotCommitment {
                        slot_id: slot.slot_id,
                        plugin_id: slot.plugin_id,
                        commitment,
                    });
                }

                config.graph_accounts.push(GenesisGraphAccount {
                    address: addr,
                    entity_kind: srv.entity_kind,
                    initial_balance: U256::ZERO,
                    did: Some(did),
                    initial_slots: slots,
                });
            }
        }

        // 8. Predeployed Contracts
        for contract_rel in &manifest.sections.contracts {
            let c_path = dir.join(contract_rel);
            if c_path.exists() {
                let s = std::fs::read_to_string(&c_path)?;
                let c: crate::genesis::SpecContract = serde_yaml::from_str(&s)?;
                let address: Address = c.address.parse()?;
                let balance = crate::genesis::parse_balance(c.balance.as_deref());
                let clean_code = c.runtime_code.trim().trim_start_matches("0x");
                let code_bytes = alloy_primitives::hex::decode(clean_code)?;

                let mut storage = BTreeMap::new();
                for (k, v) in c.storage {
                    let k_b256 = crate::genesis::parse_b256(&k)?;
                    let v_b256 = crate::genesis::parse_b256(&v)?;
                    storage.insert(k_b256, v_b256);
                }

                config.predeployed_contracts.push(GenesisContract {
                    address,
                    name: c.name,
                    balance,
                    runtime_code: Bytes::from(code_bytes),
                    storage,
                });
            }
        }

        // 9. Blind Notes
        for note_rel in &manifest.sections.blind_notes {
            let note_path = dir.join(note_rel);
            if note_path.exists() {
                let s = std::fs::read_to_string(&note_path)?;
                let note: crate::genesis::SpecBlindNote = serde_yaml::from_str(&s)?;
                let target_account: Address = note.target_account.parse()?;
                let value = crate::genesis::parse_balance(Some(&note.value));

                let nullifier_b256 = if let Some(n) = note.nullifier {
                    crate::genesis::parse_b256(&n)?
                } else {
                    let seed = format!("nullifier:{:#x}:{}:{}", target_account, note.target_slot, value);
                    B256::from_slice(blake3::hash(seed.as_bytes()).as_bytes())
                };

                let secret_bytes = if let Some(s) = note.secret {
                    crate::genesis::parse_or_hash_b256(&s)?
                } else {
                    let seed = format!("secret:{:#x}:{}:{}", target_account, note.target_slot, value);
                    B256::from_slice(blake3::hash(seed.as_bytes()).as_bytes())
                };

                let mut hasher = blake3::Hasher::new();
                hasher.update(nullifier_b256.as_slice());
                hasher.update(secret_bytes.as_slice());
                hasher.update(&value.to_be_bytes::<32>());
                let commitment_b256 = B256::from_slice(hasher.finalize().as_bytes());

                let gossip_b256 = if let Some(gt) = note.gossip_topic {
                    crate::genesis::parse_b256(&gt)?
                } else {
                    B256::from_slice(blake3::hash(format!("topic:{:#x}", target_account).as_bytes()).as_bytes())
                };

                let ciphertext = Bytes::from(format!(
                    "{{\"recipient\":\"{:#x}\",\"slot\":{},\"amount\":\"{}\"}}",
                    target_account, note.target_slot, value
                ).into_bytes());

                let ephemeral_pubkey = Bytes::from([0x04u8; 65].to_vec());

                config.genesis_blind_notes.push(GenesisBlindNote {
                    commitment: commitment_b256,
                    target_account,
                    target_slot: note.target_slot,
                    value,
                    encrypted_ciphertext: ciphertext,
                    ephemeral_pubkey,
                    gossip_topic: gossip_b256,
                    manifold_id: 1,
                    nullifier: nullifier_b256,
                    iroh_cid: note.iroh_cid,
                });
            }
        }

        // 10. ReBAC tuples
        for rebac_rel in &manifest.sections.rebac {
            let rebac_path = dir.join(rebac_rel);
            if rebac_path.exists() {
                let s = std::fs::read_to_string(&rebac_path)?;
                let rfile: SpecRebacTuplesFile = serde_yaml::from_str(&s)?;
                for t in rfile.tuples {
                    let obj_id = crate::genesis::parse_or_hash_b256(&t.object_id)?;
                    config.initial_rebac_tuples.push(GenesisRelationTuple {
                        namespace: t.namespace,
                        object_id: obj_id,
                        relation: t.relation,
                        subject: t.subject,
                    });
                }
            }
        }

        // 11. Git Mirrors
        let mut git_mirrors = Vec::new();
        for mirror_rel in &manifest.sections.git_mirrors {
            let m_path = dir.join(mirror_rel);
            if m_path.exists() {
                let s = std::fs::read_to_string(&m_path)?;
                let mirror: SpecGitMirrorFile = serde_yaml::from_str(&s)?;
                git_mirrors.push(mirror);
            }
        }

        // 12. SQL Anchors & Proof of SQL stubs
        let mut proof_of_sql_stubs = Vec::new();
        for sql_rel in &manifest.sections.sql {
            let sql_path = dir.join(sql_rel);
            if sql_path.exists() {
                let s = std::fs::read_to_string(&sql_path)?;
                if s.contains("proof_type:") {
                    if let Ok(stub) = serde_yaml::from_str::<SpecProofOfSqlFile>(&s) {
                        proof_of_sql_stubs.push(stub);
                    }
                }
            }
        }

        // Build EVM alloc block
        let mut alloc_obj = serde_json::Map::new();
        for acc in &config.graph_accounts {
            let mut acc_entry = serde_json::Map::new();
            acc_entry.insert("balance".to_string(), serde_json::Value::String(format!("{:#x}", acc.initial_balance)));
            alloc_obj.insert(format!("{:#x}", acc.address), serde_json::Value::Object(acc_entry));
        }

        for contract in &config.predeployed_contracts {
            let mut contract_entry = serde_json::Map::new();
            contract_entry.insert("balance".to_string(), serde_json::Value::String(format!("{:#x}", contract.balance)));
            contract_entry.insert("code".to_string(), serde_json::Value::String(format!("0x{}", alloy_primitives::hex::encode(&contract.runtime_code))));

            if !contract.storage.is_empty() {
                let mut st_map = serde_json::Map::new();
                for (k, v) in &contract.storage {
                    st_map.insert(format!("{:#x}", k), serde_json::Value::String(format!("{:#x}", v)));
                }
                contract_entry.insert("storage".to_string(), serde_json::Value::Object(st_map));
            }

            alloc_obj.insert(format!("{:#x}", contract.address), serde_json::Value::Object(contract_entry));
        }

        let evm_genesis = serde_json::json!({
            "config": {
                "chainId": config.chain_id,
                "homesteadBlock": 0,
                "eip150Block": 0,
                "eip155Block": 0,
                "eip158Block": 0,
                "byzantiumBlock": 0,
                "constantinopleBlock": 0,
                "petersburgBlock": 0,
                "istanbulBlock": 0,
                "muirGlacierBlock": 0,
                "berlinBlock": 0,
                "londonBlock": 0,
                "arrowGlacierBlock": 0,
                "grayGlacierBlock": 0,
                "shanghaiTime": 0,
                "cancunTime": 0,
                "pragueTime": 0,
                "parisBlock": 0,
                "mergeNetsplitBlock": 0,
                "terminalTotalDifficulty": 0
            },
            "nonce": "0x0",
            "timestamp": "0x0",
            "extraData": "0x",
            "gasLimit": "0x1c9c380",
            "difficulty": "0x0",
            "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
            "coinbase": "0x0000000000000000000000000000000000000000",
            "alloc": alloc_obj
        });

        Ok(GenesisBundleOutput {
            config,
            evm_genesis,
            bundle_manifest: manifest,
            whitelist: whitelist_data,
            git_mirrors,
            proof_of_sql_stubs,
        })
    }

    pub fn write_bundle_output<P: AsRef<Path>>(
        output: &GenesisBundleOutput,
        out_dir: P,
    ) -> eyre::Result<()> {
        let dir = out_dir.as_ref();
        std::fs::create_dir_all(dir)?;

        // 1. genesis.json
        let evm_str = serde_json::to_string_pretty(&output.evm_genesis)?;
        std::fs::write(dir.join("genesis.json"), evm_str)?;

        // 2. network_config.json
        let net_str = serde_json::to_string_pretty(&output.config)?;
        std::fs::write(dir.join("network_config.json"), net_str)?;

        // 3. vouchers.json
        let mut vouchers = Vec::new();
        for note in &output.config.genesis_blind_notes {
            vouchers.push(crate::genesis::ExportedVoucherItem {
                target_account: format!("{:#x}", note.target_account),
                target_slot: note.target_slot,
                value: format!("{:#x}", note.value),
                nullifier: format!("{:#x}", note.nullifier),
                secret: format!("{:#x}", note.commitment),
                commitment: format!("{:#x}", note.commitment),
                iroh_cid: note.iroh_cid.clone(),
            });
        }
        let voucher_bundle = crate::genesis::ExportedGenesisVouchers {
            network_name: output.config.network_name.clone(),
            chain_id: output.config.chain_id,
            vouchers,
        };
        let v_str = serde_json::to_string_pretty(&voucher_bundle)?;
        std::fs::write(dir.join("vouchers.json"), v_str)?;

        // 4. whitelist.json
        let wl_str = serde_json::to_string_pretty(&output.whitelist)?;
        std::fs::write(dir.join("whitelist.json"), wl_str)?;

        // 5. git_mirrors.json
        let gm_str = serde_json::to_string_pretty(&output.git_mirrors)?;
        std::fs::write(dir.join("git_mirrors.json"), gm_str)?;

        // 6. proof_of_sql_stubs.json
        let sql_str = serde_json::to_string_pretty(&output.proof_of_sql_stubs)?;
        std::fs::write(dir.join("proof_of_sql_stubs.json"), sql_str)?;

        // 7. genesis_graph.json (Iroh document topology for authorized graph traversal)
        let mut nodes = Vec::new();
        for acc in &output.config.graph_accounts {
            let mut slots = Vec::new();
            for s in &acc.initial_slots {
                slots.push(serde_json::json!({
                    "slotId": s.slot_id,
                    "pluginId": s.plugin_id,
                    "commitment": format!("{:#x}", s.commitment)
                }));
            }
            let label = acc.did.clone().unwrap_or_else(|| format!("Account {:#x}", acc.address));
            let node_type = match acc.entity_kind.to_lowercase().as_str() {
                "dao" | "global_dao" => "global_dao",
                "authority" | "xroad_authority" => "xroad_authority",
                "gitrepository" | "repo" => "git_repo",
                "service" => "service_account",
                "user" | "human_account" => "human_account",
                _ => "service_account"
            };

            nodes.push(serde_json::json!({
                "id": format!("{:#x}", acc.address),
                "label": label,
                "type": node_type,
                "address": format!("{:#x}", acc.address),
                "balance": format!("{:#x}", acc.initial_balance),
                "slots": slots
            }));
        }

        let mut edges = Vec::new();
        for t in &output.config.initial_rebac_tuples {
            let rel_name = match t.relation {
                1 => "admin",
                2 => "council",
                3 => "audit",
                4 => "member",
                5 => "sub_dao_member",
                _ => "viewer"
            };
            // Clean subject DID to address if present
            let target_addr = if let Some(stripped) = t.subject.strip_prefix("did:sovereign:1337:") {
                stripped.to_string()
            } else {
                t.subject.clone()
            };

            edges.push(serde_json::json!({
                "source": format!("{:#x}", t.object_id),
                "target": target_addr,
                "relation": rel_name,
                "label": format!("ReBAC: {}", rel_name)
            }));
        }

        let topology = serde_json::json!({
            "nodes": nodes,
            "edges": edges
        });
        let top_str = serde_json::to_string_pretty(&topology)?;
        std::fs::write(dir.join("genesis_graph.json"), top_str)?;

        // 8. sovereign.config.json (for web/wallet)
        let wallet_config = serde_json::json!({
            "networkName": output.config.network_name,
            "chainId": output.config.chain_id,
            "rpcUrl": "/rpc",
            "storageUrl": "/storage",
            "genesisGraphUrl": "/genesis_graph.json",
            "ticker": output.config.ticker,
            "enclaveCapability": "SimulatedDev",
            "slots": [
                { "id": 0, "name": "DID Document Root", "pluginId": "core.did_identity", "precompile": "0x03" },
                { "id": 1, "name": "Zanzibar ReBAC SMT", "pluginId": "core.zanzibar", "precompile": "0x61" },
                { "id": 2, "name": "Native Payment Core", "pluginId": "core.native_payment", "precompile": "0x02" },
                { "id": 3, "name": "Git VCS Object DAG", "pluginId": "vcs.git_dag", "precompile": "0x63" },
                { "id": 4, "name": "Relational SQL Digest", "pluginId": "ext.sqldigest", "precompile": "0x62" },
                { "id": 5, "name": "X-Road Service Descriptor", "pluginId": "authority.xroad_descriptor", "precompile": "0x05" },
                { "id": 6, "name": "Supply Chain Interface", "pluginId": "vcs.interface_contract", "precompile": "0x66" },
                { "id": 7, "name": "Reputation & Merit Score", "pluginId": "reputation.merit", "precompile": "0x07" },
                { "id": 8, "name": "DAO Voting Weight", "pluginId": "dao.voting_weight", "precompile": "0x08" }
            ]
        });
        let wallet_str = serde_json::to_string_pretty(&wallet_config)?;
        std::fs::write(dir.join("sovereign.config.json"), wallet_str)?;

        Ok(())
    }
}
