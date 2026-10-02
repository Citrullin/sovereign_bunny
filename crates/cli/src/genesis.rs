use std::collections::BTreeMap;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use alloy_primitives::{Address, B256, Bytes, U256};
use serde::{Deserialize, Serialize};
use sovereign_consensus::config::{
    GenesisBlindNote, GenesisContract, GenesisGraphAccount, GenesisRelationTuple,
    GenesisSlotCommitment, NetworkGenesisConfig,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSpecYaml {
    pub network_name: Option<String>,
    pub chain_id: Option<u64>,
    pub ticker: Option<String>,
    #[serde(default)]
    pub accounts: Vec<SpecAccount>,
    #[serde(default)]
    pub rebac_tuples: Vec<SpecRebacTuple>,
    #[serde(default)]
    pub contracts: Vec<SpecContract>,
    #[serde(default)]
    pub blind_notes: Vec<SpecBlindNote>,
    #[serde(default)]
    pub permissioned_dao: Option<SpecPermissionedDao>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecSlot {
    pub slot_id: u16,
    pub plugin_id: String,
    pub commitment: String, // hex or string representation
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecAccount {
    pub address: String,
    pub entity_kind: String,
    #[serde(default)]
    pub initial_balance: Option<String>,
    pub did: Option<String>,
    #[serde(default)]
    pub slots: Vec<SpecSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecRebacTuple {
    pub namespace: u32,
    pub object_id: String, // hex string or string representation
    pub relation: u32,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecContract {
    pub address: String,
    pub name: String,
    #[serde(default)]
    pub balance: Option<String>,
    pub runtime_code: String, // hex bytecode
    #[serde(default)]
    pub storage: BTreeMap<String, String>, // key hex -> value hex
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecBlindNote {
    pub target_account: String,
    pub target_slot: u16,
    pub value: String,
    #[serde(default)]
    pub nullifier: Option<String>,
    #[serde(default)]
    pub secret: Option<String>,
    #[serde(default)]
    pub gossip_topic: Option<String>,
    #[serde(default)]
    pub iroh_cid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecDaoMember {
    pub address: String,
    pub role: String, // "admin", "council", "auditor", etc.
    pub did: Option<String>,
    #[serde(default)]
    pub slots: Vec<SpecSlot>,
    #[serde(default)]
    pub initial_balance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecPermissionedDao {
    pub treasury_address: String,
    pub dao_name: String,
    pub dao_did: Option<String>,
    #[serde(default)]
    pub initial_balance: Option<String>,
    #[serde(default)]
    pub slots: Vec<SpecSlot>,
    #[serde(default)]
    pub members: Vec<SpecDaoMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedGenesisVouchers {
    pub network_name: String,
    pub chain_id: u64,
    pub vouchers: Vec<ExportedVoucherItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedVoucherItem {
    pub target_account: String,
    pub target_slot: u16,
    pub value: String,
    pub nullifier: String,
    pub secret: String,
    pub commitment: String,
    pub iroh_cid: Option<String>,
}

pub struct GenesisCompiler;

impl GenesisCompiler {
    pub fn compile_from_spec<P: AsRef<Path>>(spec_path: P) -> eyre::Result<NetworkGenesisConfig> {
        let content = std::fs::read_to_string(spec_path)?;
        let spec: GraphSpecYaml = if content.trim_start().starts_with('{') {
            serde_json::from_str(&content)?
        } else {
            serde_yaml::from_str(&content)?
        };

        let mut config = NetworkGenesisConfig::default();
        if let Some(name) = spec.network_name {
            config.network_name = name;
        }
        if let Some(id) = spec.chain_id {
            config.chain_id = id;
        }
        if let Some(ticker) = spec.ticker {
            config.ticker = ticker;
        }

        // 1. Process regular graph accounts
        for acc in spec.accounts {
            let address: Address = acc.address.parse()?;
            let initial_balance = parse_balance(acc.initial_balance.as_deref());

            let mut initial_slots = Vec::new();
            for s in acc.slots {
                let commitment_b256 = parse_or_hash_b256(&s.commitment)?;
                initial_slots.push(GenesisSlotCommitment {
                    slot_id: s.slot_id,
                    plugin_id: s.plugin_id,
                    commitment: commitment_b256,
                });
            }

            config.graph_accounts.push(GenesisGraphAccount {
                address,
                entity_kind: acc.entity_kind,
                initial_balance,
                did: acc.did,
                initial_slots,
            });
        }

        // 2. Process permissioned DAO if configured
        if let Some(dao) = spec.permissioned_dao {
            let treasury_addr: Address = dao.treasury_address.parse()?;
            let treasury_bal = parse_balance(dao.initial_balance.as_deref());
            let dao_did = dao.dao_did.unwrap_or_else(|| format!("did:sovereign:{}:{:#x}", config.chain_id, treasury_addr));

            let mut dao_slots = Vec::new();
            for s in dao.slots {
                let commitment_b256 = parse_or_hash_b256(&s.commitment)?;
                dao_slots.push(GenesisSlotCommitment {
                    slot_id: s.slot_id,
                    plugin_id: s.plugin_id,
                    commitment: commitment_b256,
                });
            }

            config.graph_accounts.push(GenesisGraphAccount {
                address: treasury_addr,
                entity_kind: "DAO".to_string(),
                initial_balance: treasury_bal,
                did: Some(dao_did.clone()),
                initial_slots: dao_slots,
            });

            // Derive namespace 1 (DAO governance)
            let dao_b256 = B256::from_slice(&[treasury_addr.as_slice(), &[0u8; 12]].concat());

            for member in dao.members {
                let m_addr: Address = member.address.parse()?;
                let m_bal = parse_balance(member.initial_balance.as_deref());
                let m_did = member.did.unwrap_or_else(|| format!("did:sovereign:{}:{:#x}", config.chain_id, m_addr));

                let mut m_slots = Vec::new();
                for s in member.slots {
                    let commitment_b256 = parse_or_hash_b256(&s.commitment)?;
                    m_slots.push(GenesisSlotCommitment {
                        slot_id: s.slot_id,
                        plugin_id: s.plugin_id,
                        commitment: commitment_b256,
                    });
                }

                config.graph_accounts.push(GenesisGraphAccount {
                    address: m_addr,
                    entity_kind: "User".to_string(),
                    initial_balance: m_bal,
                    did: Some(m_did.clone()),
                    initial_slots: m_slots,
                });

                // Role mapping: 1 = admin, 2 = council, 3 = auditor, 4 = member
                let rel_id = match member.role.to_lowercase().as_str() {
                    "admin" | "owner" => 1,
                    "council" | "manager" => 2,
                    "auditor" => 3,
                    _ => 4,
                };

                config.initial_rebac_tuples.push(GenesisRelationTuple {
                    namespace: 1, // DAO namespace
                    object_id: dao_b256,
                    relation: rel_id,
                    subject: m_did,
                });
            }
        }

        // 3. Process explicit ReBAC tuples
        for t in spec.rebac_tuples {
            let obj_id = parse_or_hash_b256(&t.object_id)?;
            config.initial_rebac_tuples.push(GenesisRelationTuple {
                namespace: t.namespace,
                object_id: obj_id,
                relation: t.relation,
                subject: t.subject,
            });
        }

        // 4. Process predeployed EVM contracts
        for c in spec.contracts {
            let address: Address = c.address.parse()?;
            let balance = parse_balance(c.balance.as_deref());
            let clean_code = c.runtime_code.trim().trim_start_matches("0x");
            let code_bytes = alloy_primitives::hex::decode(clean_code)?;

            let mut storage = BTreeMap::new();
            for (k, v) in c.storage {
                let k_b256 = parse_b256(&k)?;
                let v_b256 = parse_b256(&v)?;
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

        // 5. Process pre-seeded blind notes
        for note in spec.blind_notes {
            let target_account: Address = note.target_account.parse()?;
            let value = parse_balance(Some(&note.value));

            let nullifier_b256 = if let Some(n) = note.nullifier {
                parse_b256(&n)?
            } else {
                let seed = format!("nullifier:{:#x}:{}:{}", target_account, note.target_slot, value);
                B256::from_slice(blake3::hash(seed.as_bytes()).as_bytes())
            };

            let secret_bytes = if let Some(s) = note.secret {
                parse_or_hash_b256(&s)?
            } else {
                let seed = format!("secret:{:#x}:{}:{}", target_account, note.target_slot, value);
                B256::from_slice(blake3::hash(seed.as_bytes()).as_bytes())
            };

            // Commitment = H(nullifier || secret || value)
            let mut hasher = blake3::Hasher::new();
            hasher.update(nullifier_b256.as_slice());
            hasher.update(secret_bytes.as_slice());
            hasher.update(&value.to_be_bytes::<32>());
            let commitment_b256 = B256::from_slice(hasher.finalize().as_bytes());

            let gossip_b256 = if let Some(gt) = note.gossip_topic {
                parse_b256(&gt)?
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

        Ok(config)
    }

    /// Compiles all genesis artifacts:
    /// 1. `genesis.json`: Standard EVM alloc format for Reth/EVM node
    /// 2. `network_config`: NetworkGenesisConfig for Consensus DAG
    /// 3. `vouchers`: Exported secret vouchers for onboarding
    pub fn compile_all<P: AsRef<Path>>(
        spec_path: P,
        evm_genesis_path: P,
        network_config_path: P,
        vouchers_path: Option<P>,
    ) -> eyre::Result<(NetworkGenesisConfig, serde_json::Value)> {
        let config = Self::compile_from_spec(spec_path)?;

        // Build EVM alloc block
        let mut alloc_obj = serde_json::Map::new();

        // Include graph accounts
        for acc in &config.graph_accounts {
            let mut acc_entry = serde_json::Map::new();
            acc_entry.insert("balance".to_string(), serde_json::Value::String(format!("{:#x}", acc.initial_balance)));
            alloc_obj.insert(format!("{:#x}", acc.address), serde_json::Value::Object(acc_entry));
        }

        // Include pre-deployed smart contracts
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

        // Write evm_genesis_path
        let evm_str = serde_json::to_string_pretty(&evm_genesis)?;
        let mut f_evm = File::create(evm_genesis_path)?;
        f_evm.write_all(evm_str.as_bytes())?;

        // Write network_config_path
        let net_str = serde_json::to_string_pretty(&config)?;
        let mut f_net = File::create(&network_config_path)?;
        f_net.write_all(net_str.as_bytes())?;

        // Write vouchers if requested
        if let Some(vp) = vouchers_path {
            let mut vouchers = Vec::new();
            for note in &config.genesis_blind_notes {
                vouchers.push(ExportedVoucherItem {
                    target_account: format!("{:#x}", note.target_account),
                    target_slot: note.target_slot,
                    value: format!("{:#x}", note.value),
                    nullifier: format!("{:#x}", note.nullifier),
                    secret: format!("{:#x}", note.commitment),
                    commitment: format!("{:#x}", note.commitment),
                    iroh_cid: note.iroh_cid.clone(),
                });
            }
            let voucher_bundle = ExportedGenesisVouchers {
                network_name: config.network_name.clone(),
                chain_id: config.chain_id,
                vouchers,
            };
            let v_str = serde_json::to_string_pretty(&voucher_bundle)?;
            let mut f_v = File::create(vp)?;
            f_v.write_all(v_str.as_bytes())?;
        }

        // Auto-generate web/WASM wallet configuration `sovereign.config.json`
        let wallet_config = serde_json::json!({
            "networkName": config.network_name,
            "chainId": config.chain_id,
            "rpcUrl": "/rpc",
            "storageUrl": "/storage",
            "ticker": config.ticker,
            "enclaveCapability": "SimulatedDev",
            "slots": [
                { "id": 0, "name": "DID Document Root", "pluginId": "core.did_identity", "precompile": "0x03" },
                { "id": 1, "name": "Zanzibar ReBAC SMT", "pluginId": "core.zanzibar", "precompile": "0x61" },
                { "id": 2, "name": "Native Payment Core", "pluginId": "core.native_payment", "precompile": "0x02" },
                { "id": 3, "name": "Git VCS Object DAG", "pluginId": "vcs.git_dag", "precompile": "0x63" },
                { "id": 4, "name": "Relational SQL Digest", "pluginId": "ext.sqldigest", "precompile": "0x62" },
                { "id": 5, "name": "X-Road Service Descriptor", "pluginId": "authority.xroad_descriptor", "precompile": "0x05" },
                { "id": 6, "name": "Supply Chain Interface", "pluginId": "vcs.interface_contract", "precompile": "0x66" },
                { "id": 7, "name": "Reputation & Merit Score", "pluginId": "reputation.merit", "precompile": "0x07" }
            ]
        });
        let wallet_str = serde_json::to_string_pretty(&wallet_config)?;
        if let Some(parent) = network_config_path.as_ref().parent() {
            let wallet_out = parent.join("sovereign.config.json");
            let _ = std::fs::write(&wallet_out, &wallet_str);
        }


        Ok((config, evm_genesis))
    }

    pub fn write_genesis<P: AsRef<Path>>(config: &NetworkGenesisConfig, out_path: P) -> eyre::Result<()> {
        let json = serde_json::to_string_pretty(config)?;
        let mut file = File::create(out_path)?;
        file.write_all(json.as_bytes())?;
        Ok(())
    }
}

pub(crate) fn parse_balance(bal_opt: Option<&str>) -> U256 {
    if let Some(bal) = bal_opt {
        let clean = bal.trim().trim_start_matches("0x").trim_start_matches("0X");
        U256::from_str_radix(clean, 16)
            .or_else(|_| clean.parse::<U256>())
            .unwrap_or_default()
    } else {
        U256::ZERO
    }
}

pub(crate) fn parse_b256(s: &str) -> eyre::Result<B256> {
    let clean = s.trim().trim_start_matches("0x");
    if clean.len() == 64 {
        let bytes = alloy_primitives::hex::decode(clean)?;
        Ok(B256::from_slice(&bytes))
    } else if clean.len() == 40 {
        let bytes = alloy_primitives::hex::decode(clean)?;
        let mut b32 = [0u8; 32];
        b32[12..32].copy_from_slice(&bytes);
        Ok(B256::from(b32))
    } else {
        eyre::bail!("Invalid 32-byte hex string: {}", s);
    }
}


pub(crate) fn parse_or_hash_b256(s: &str) -> eyre::Result<B256> {
    let trimmed = s.trim();
    if trimmed.starts_with("0x") && trimmed.len() == 66 {
        parse_b256(trimmed)
    } else {
        let hash = blake3::hash(trimmed.as_bytes());
        Ok(B256::from_slice(hash.as_bytes()))
    }
}

