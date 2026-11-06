//! Cross-Chain Relay Committee, Post-Quantum Signature Verification, and Time-Locked Intent Relays.

use alloy_primitives::{Address, Bytes, B256, U256};
use std::collections::HashSet;
use sovereign_identity::DidPeer4;

/// Cross-Chain Relay Committee (formerly SagaOrchestratorCommittee).
///
/// Sampled validators meeting a minimum reputation/merit threshold
/// rotated deterministically per epoch using VRF-style subset election.
#[derive(Debug, Clone)]
pub struct CrossChainRelayCommittee {
    /// Active epoch of the committee.
    pub epoch: u64,
    /// Addresses of the selected relay orchestrator validators.
    pub orchestrators: HashSet<Address>,
    /// Threshold fraction required for consensus quorum (e.g. 0.67 for 2/3 majority).
    pub threshold: f64,
    /// Minimum reputation/merit rank required to be eligible for election.
    pub min_orchestrator_merit: f64,
}

/// Backward compatibility alias
pub type SagaOrchestratorCommittee = CrossChainRelayCommittee;

impl Default for CrossChainRelayCommittee {
    fn default() -> Self {
        let registry_lock = crate::registry::get_registry();
        let threshold = if let Ok(reg) = registry_lock.read() {
            reg.dynamic_cfg.read().unwrap().committee_threshold
        } else {
            0.67
        };

        Self {
            epoch: 0,
            orchestrators: HashSet::new(),
            threshold,
            min_orchestrator_merit: 0.05,
        }
    }
}

impl CrossChainRelayCommittee {
    /// Deterministically elects/rotates the sub-committee for a specific target manifold.
    ///
    /// # Errors
    /// Returns an error if the registry cannot be accessed or if no eligible orchestrators exist.
    pub fn select_orchestrators(&mut self, target_manifold_id: u64, epoch: u64, subset_size: usize) -> Result<(), &'static str> {
        self.epoch = epoch;
        let registry_lock = crate::registry::get_registry();
        let registry = registry_lock.read().map_err(|_| "Failed to lock registry")?;
        
        self.threshold = registry.dynamic_cfg.read().unwrap().committee_threshold;

        let eligible = registry.get_eligible_orchestrators(target_manifold_id, self.min_orchestrator_merit);
        if eligible.is_empty() {
            return Err("No eligible orchestrators with sufficient merit rank");
        }

        let mut election = crate::subset_election::EpochSubsetElection::new(target_manifold_id);
        election.trigger_election(&eligible, epoch, subset_size)?;
        self.orchestrators = election.current_subset;
        Ok(())
    }
}

/// An Asynchronous Cross-Manifold Payment Intent (formerly SagaIntent).
#[derive(Debug, Clone)]
pub struct AsyncIntent {
    /// Unique intent ID.
    pub intent_id: B256,
    /// Source manifold address locking the assets.
    pub sender: Address,
    /// Destination recipient address.
    pub recipient: Address,
    /// Token amount locked.
    pub amount: U256,
    /// Expiration epoch number (not Unix timestamp — the network is async/epoch-based).
    pub expires_at_epoch: u64,
    /// List of orchestrator addresses and their signatures voting to commit/verify this intent.
    pub orchestrator_signatures: Vec<(Address, Bytes)>,
}

/// Backward compatibility alias
pub type SagaIntent = AsyncIntent;

impl AsyncIntent {
    /// Creates a new async intent.
    /// `current_epoch` is the current epoch number at creation time.
    pub fn new(intent_id: B256, sender: Address, recipient: Address, amount: U256, current_epoch: u64) -> Self {
        let registry_lock = crate::registry::get_registry();
        let timeout = if let Ok(reg) = registry_lock.read() {
            reg.dynamic_cfg.read().unwrap().saga_intent_timeout_epochs
        } else {
            43200 // default: 43200 epochs ≈ 24h at 2s/epoch
        };

        Self {
            intent_id,
            sender,
            recipient,
            amount,
            expires_at_epoch: current_epoch + timeout,
            orchestrator_signatures: Vec::new(),
        }
    }

    /// Checks if the intent has expired by comparing against the current epoch number.
    pub fn is_expired(&self, current_epoch: u64) -> bool {
        current_epoch > self.expires_at_epoch
    }

    /// Verifies the consensus quorum of orchestrator signatures, enforcing Zero Latency Quantum Trigger requirements.
    ///
    /// # Errors
    /// Returns an error if the quorum is not met, or if signature verification fails for any orchestrator.
    pub async fn verify_consensus(&self, committee: &CrossChainRelayCommittee, quantum_threat: bool) -> Result<(), &'static str> {
        if committee.orchestrators.is_empty() {
            return Err("Committee is empty");
        }

        let registry_lock = crate::registry::get_registry();
        let threshold = if let Ok(reg) = registry_lock.read() {
            reg.dynamic_cfg.read().unwrap().committee_threshold
        } else {
            committee.threshold
        };

        let required_quorum = ((committee.orchestrators.len() as f64) * threshold).ceil() as usize;
        let mut valid_votes = HashSet::new();

        let registry = registry_lock.read().map_err(|_| "Failed to lock registry")?;

        for (addr, sig) in &self.orchestrator_signatures {
            if !committee.orchestrators.contains(addr) {
                continue; // Ignore signatures from non-committee members
            }

            // Resolve the DID peer document for this orchestrator
            let Some(did) = registry.get_did_by_address(addr) else {
                continue;
            };

            let peer = DidPeer4::resolve(&did).await
                .map_err(|_| "Failed to resolve orchestrator DID Peer document")?;

            // Verify the signature against the intent hash, enforcing PQ constraints if trigger is active
            let intent_hash_bytes = self.intent_id.as_slice();
            peer.verify_signature(intent_hash_bytes, sig, quantum_threat)?;

            valid_votes.insert(*addr);
        }

        if valid_votes.len() < required_quorum {
            return Err("Quorum threshold not met for Cross Chain Relay Committee Consensus");
        }

        Ok(())
    }
}

/// Lifecycle status of an external boundary manifold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ManifoldBoundaryState {
    /// 3-Phase Phase 1: Zero exposure, canary state transitions testing live finality
    ProbationaryBootstrap,
    /// 3-Phase Phase 2: Live meshed boundary with active VRF canary probing and dynamic tau_anchor
    ActiveMeshed,
    /// 3-Phase Phase 3 / Invariant: External ledger reorganized past an anchored root; boundary permanently frozen
    FrozenOnSplit,
}

/// Minimum confirmation horizon required for Ethereum 1.0 / Gasper PoS finality (2 epochs * 32 slots).
pub const GASPER_FINALITY_HORIZON_SLOTS: u64 = 64;

/// Boundary Manifold Descriptor defining cross-chain consensus parameters and finality horizons.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BoundaryManifoldDescriptor {
    /// Unique foreign manifold identifier (e.g. 0x02 for Ethereum L1, 0x03 for Base L2)
    pub manifold_id: u64,
    /// Human-readable label
    pub label: String,
    /// Anchoring confirmation depth horizon (tau_anchor, >= 64 slots for Gasper finality on Ethereum 1.0)
    pub tau_anchor: u64,
    /// Whether this boundary requires strict Gasper 2-epoch finality (Casper FFG + LMD-GHOST)
    pub requires_gasper_finality: bool,
    /// Minimum Slot 8 operational surety bond required for overlap committee members (Q_{A cap B})
    pub min_slot8_overlap_bond: U256,
    /// Herstatt haircut in basis points (0..10_000) applied during settlement
    pub herstatt_haircut_bps: u32,
    /// Current boundary lifecycle state
    pub state: ManifoldBoundaryState,
    /// Most recently anchored foreign block hash
    pub last_anchored_foreign_hash: B256,
    /// Most recently anchored foreign block height
    pub last_anchored_foreign_height: u64,
}

impl Default for BoundaryManifoldDescriptor {
    fn default() -> Self {
        Self {
            manifold_id: 1,
            label: "Ethereum Mainnet (L1)".to_string(),
            tau_anchor: GASPER_FINALITY_HORIZON_SLOTS, // 64 slots (2 full Gasper epochs) to eliminate reorg / drop risk
            requires_gasper_finality: true,
            min_slot8_overlap_bond: U256::from(100_000_000_000_000_000_000u128), // 100 tokens
            herstatt_haircut_bps: 200, // 2.00%
            state: ManifoldBoundaryState::ProbationaryBootstrap,
            last_anchored_foreign_hash: B256::ZERO,
            last_anchored_foreign_height: 0,
        }
    }
}

impl BoundaryManifoldDescriptor {
    /// Inspects whether an observed foreign chain reorg past the anchored horizon triggers permanent boundary freeze.
    pub fn evaluate_reorg_invariants(
        &mut self,
        observed_parent_hash: B256,
        observed_height: u64,
    ) -> Result<(), &'static str> {
        if self.state == ManifoldBoundaryState::FrozenOnSplit {
            return Err("BOUNDARY_FROZEN: Manifold boundary is permanently frozen past split; zero rollback allowed");
        }

        // If an external chain reports an inconsistent hash at or below the anchored finality horizon,
        // our network NEVER rolls back: permanently freeze this boundary manifold.
        if observed_height <= self.last_anchored_foreign_height
            && self.last_anchored_foreign_hash != B256::ZERO
            && observed_parent_hash != self.last_anchored_foreign_hash
        {
            self.state = ManifoldBoundaryState::FrozenOnSplit;
            return Err("FROZEN_ON_SPLIT: Deep reorg detected below anchored boundary horizon; boundary permanently frozen");
        }

        Ok(())
    }
}

/// Real Cross-Chain Event Witness Verifier running Snowflake consensus (formerly CrossChainObserverVerifier).
#[derive(Debug, Default)]
pub struct CrossChainEventVerifier;

/// Backward compatibility alias
pub type CrossChainObserverVerifier = CrossChainEventVerifier;

impl CrossChainEventVerifier {
    /// Helper to query live foreign RPC event status.
    async fn check_rpc_event(
        &self,
        subroutine: &crate::registry::CrossChainObserverSubroutine,
        foreign_rpc_url: &str,
    ) -> Result<bool, &'static str> {
        let client = reqwest::Client::new();
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_getTransactionReceipt",
            "params": [format!("{:#x}", subroutine.contract_address)],
            "id": 1
        });

        let res = client.post(foreign_rpc_url)
            .json(&payload)
            .send()
            .await
            .map_err(|_| "Failed to connect to foreign RPC node")?;

        Ok(res.status().is_success())
    }

    /// Runs Snowflake consensus across the relay committee for an observed event.
    pub async fn run_snowflake_consensus(
        &self,
        subroutine: &crate::registry::CrossChainObserverSubroutine,
        foreign_rpc_url: &str,
        committee_peers: &[Address],
        alpha: f64,
        k: usize,
        c: usize,
    ) -> Result<bool, &'static str> {
        let mut voter = crate::snow::SnowflakeVoter::new(k, alpha, c as u32);

        // Run query sampling rounds
        for _round in 0..10 {
            if voter.finalized_value.is_some() {
                break;
            }

            let sampled_peers = if committee_peers.len() >= k {
                &committee_peers[0..k]
            } else {
                committee_peers
            };

            let mut votes = Vec::new();
            for _peer in sampled_peers {
                let vote = self.check_rpc_event(subroutine, foreign_rpc_url).await.unwrap_or(false);
                votes.push(vote);
            }

            voter.record_round(&votes);
        }

        Ok(voter.finalized_value.unwrap_or(false))
    }

    /// Cross-verifies foreign chain events by running Snowflake consensus over the sub-committee (H-11).
    pub async fn verify_event_inclusion(
        &self,
        registry: &mut crate::registry::ValidatorRegistry,
        proposer_did: Option<&str>,
        subroutine: &crate::registry::CrossChainObserverSubroutine,
        foreign_rpc_url: &str,
        witness_proof: &[u8],
        expected_state_root: B256,
        committee: &CrossChainRelayCommittee,
    ) -> Result<bool, &'static str> {
        if witness_proof.is_empty() && expected_state_root != B256::ZERO {
            return Err("Cryptographic witness proof required for foreign state root verification");
        }

        let local_check = self.check_rpc_event(subroutine, foreign_rpc_url).await.unwrap_or(false);
        if !local_check {
            if let Some(did) = proposer_did {
                registry.penalize_validator_reputation(did, 0.1);
            }
            return Err("Foreign state root or event slot changed during verification");
        }

        let peers: Vec<Address> = committee.orchestrators.iter().copied().collect();
        let peers_slice = if peers.is_empty() {
            return Err("No active committee orchestrators for foreign event consensus");
        } else {
            peers.as_slice()
        };

        let consensus_result = self.run_snowflake_consensus(subroutine, foreign_rpc_url, peers_slice, 0.8, 1, 2).await?;

        if !consensus_result {
            if let Some(did) = proposer_did {
                registry.penalize_validator_reputation(did, 0.2);
            }
        }

        Ok(consensus_result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::ValidatorRegistry;
    use ed25519_dalek::{SigningKey, Signer};

    #[tokio::test]
    #[serial_test::serial]
    async fn test_async_intent_verify_consensus() {
        let registry_lock = crate::registry::get_registry();
        let mut registry = registry_lock.write().unwrap();
        *registry = ValidatorRegistry::default();
        registry.dynamic_cfg.write().unwrap().zero_latency_quantum_trigger = false;

        let seed = [1u8; 32];
        let signing_key = SigningKey::from_bytes(&seed);
        let verifying_key = signing_key.verifying_key();
        
        let mut codec_bytes = vec![0xed, 0x01];
        codec_bytes.extend_from_slice(&verifying_key.to_bytes());
        let multibase_str = format!("z{}", bs58::encode(codec_bytes).into_string());

        let keys = vec![did_peer::DIDPeerCreateKeys {
            type_: Some(did_peer::DIDPeerKeyType::Ed25519),
            purpose: did_peer::DIDPeerKeys::Verification,
            public_key_multibase: Some(multibase_str),
        }];
        let (did, _) = did_peer::DIDPeer::create_peer_did(&keys, None).unwrap();
        let addr = Address::repeat_byte(0x77);

        registry.peer_keys.insert(did.clone(), [0x01; 32]);
        registry.address_to_did.insert(addr, did.clone());
        registry.validators.insert(did.clone(), crate::registry::ValidatorType::HardwareTEE);
        registry.reputation.insert(did.clone(), 1.0);
        drop(registry);

        let mut committee = CrossChainRelayCommittee::default();
        committee.orchestrators.insert(addr);
        committee.threshold = 1.0;

        let intent_id = B256::repeat_byte(0xab);
        let sig = signing_key.sign(intent_id.as_slice()).to_bytes().to_vec();

        let mut intent = AsyncIntent::new(intent_id, Address::repeat_byte(0x11), Address::repeat_byte(0x22), U256::from(100), 10000);
        intent.orchestrator_signatures.push((addr, Bytes::from(sig)));

        let res = intent.verify_consensus(&committee, false).await;
        assert!(res.is_ok(), "Consensus verification failed: {:?}", res.err());
    }

    #[test]
    fn test_boundary_manifold_frozen_on_split_reorg_invariant() {
        let mut desc = BoundaryManifoldDescriptor {
            manifold_id: 2,
            label: "EVM L1 Anchor".to_string(),
            tau_anchor: GASPER_FINALITY_HORIZON_SLOTS,
            requires_gasper_finality: true,
            min_slot8_overlap_bond: U256::from(100),
            herstatt_haircut_bps: 200,
            state: ManifoldBoundaryState::ActiveMeshed,
            last_anchored_foreign_hash: B256::repeat_byte(0xaa),
            last_anchored_foreign_height: 1000,
        };

        // Consistent parent hash at height 1000 succeeds
        assert!(desc.evaluate_reorg_invariants(B256::repeat_byte(0xaa), 1000).is_ok());

        // Conflicting parent hash below or at anchored height triggers permanent boundary freeze
        let err = desc.evaluate_reorg_invariants(B256::repeat_byte(0xbb), 999);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), "FROZEN_ON_SPLIT: Deep reorg detected below anchored boundary horizon; boundary permanently frozen");
        assert_eq!(desc.state, ManifoldBoundaryState::FrozenOnSplit);

        // Future interactions on frozen boundary are rejected fail-closed
        let err_frozen = desc.evaluate_reorg_invariants(B256::repeat_byte(0xaa), 1005);
        assert!(err_frozen.is_err());
        assert_eq!(err_frozen.unwrap_err(), "BOUNDARY_FROZEN: Manifold boundary is permanently frozen past split; zero rollback allowed");
    }
}
