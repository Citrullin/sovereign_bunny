//! Saga Actor State Machine & Cross-Manifold Intent Coordination.
//! Handles multi-manifold transaction state machines: INITIATE_INTENT -> PREPARE_EXECUTION -> COMMIT / ROLLBACK.

use alloy_primitives::{Address, B256, U256};
use serde::{Deserialize, Serialize};

/// Discrete execution states for a Saga Transaction Actor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActorState {
    /// Cross-chain intent initiated.
    InitiateIntent,
    /// Target manifold preparing execution and checking attestation.
    PrepareExecution,
    /// Transaction committed successfully.
    Commit,
    /// Execution failed or timed out; intent rolled back.
    Rollback,
}

/// A Saga Actor instance coordinating distributed intents with rollback capabilities.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SagaActor {
    /// Unique Actor / Intent ID.
    pub actor_id: B256,
    /// Current state of the Saga state machine.
    pub state: ActorState,
    /// Source manifold address.
    pub sender: Address,
    /// Target manifold address.
    pub recipient: Address,
    /// Intended token amount.
    pub amount: U256,
    /// Intent creation epoch number.
    pub created_at: u64,
    /// Expiration window in epochs (not wall-clock seconds — the network is async/epoch-based).
    pub timeout_epochs: u64,
}

/// Backward compatibility alias
pub type CrossManifoldActor = SagaActor;

impl SagaActor {
    /// Initializes a new Saga Actor in `InitiateIntent` state.
    /// `current_epoch` is the current epoch number at creation time.
    pub fn new(actor_id: B256, sender: Address, recipient: Address, amount: U256, current_epoch: u64) -> Self {
        let registry_lock = crate::registry::get_registry();
        let timeout = if let Ok(reg) = registry_lock.try_read() {
            reg.dynamic_cfg.read().unwrap().saga_intent_timeout_epochs
        } else {
            43200 // default: 43200 epochs ≈ 24h at 2s/epoch
        };

        Self {
            actor_id,
            state: ActorState::InitiateIntent,
            sender,
            recipient,
            amount,
            created_at: current_epoch,
            timeout_epochs: timeout,
        }
    }

    /// Advances the state machine to `PREPARE_EXECUTION`.
    pub fn prepare(&mut self) -> Result<(), &'static str> {
        if self.state != ActorState::InitiateIntent {
            return Err("Invalid state transition to PrepareExecution");
        }
        self.state = ActorState::PrepareExecution;
        Ok(())
    }

    /// Commits the transaction trajectory upon verified target execution.
    pub fn commit(&mut self) -> Result<(), &'static str> {
        if self.state != ActorState::PrepareExecution {
            return Err("Invalid state transition to Commit");
        }
        self.state = ActorState::Commit;
        Ok(())
    }

    /// Triggers an automated Rollback, reverting the intent.
    pub fn rollback(&mut self) {
        self.state = ActorState::Rollback;
    }

    /// Evaluates timeout conditions based on `current_epoch` and auto-triggers Rollback if expired.
    pub fn evaluate_timeout(&mut self, current_epoch: u64) -> bool {
        let registry_lock = crate::registry::get_registry();
        let timeout = if let Ok(reg) = registry_lock.try_read() {
            reg.dynamic_cfg.read().unwrap().saga_intent_timeout_epochs
        } else {
            self.timeout_epochs
        };

        if self.state != ActorState::Commit && current_epoch > (self.created_at + timeout) {
            self.rollback();
            true
        } else {
            false
        }
    }

    /// Generates a cross-manifold attestation packet to trigger execution preparation on the target manifold.
    pub fn emit_prepare_attestation(
        &self,
        source_manifold_id: u64,
        target_manifold_id: u64,
        state_diff_blob_hash: B256,
        proof_scheme: crate::relay_mesh::ProofScheme,
        attestation_proof: Vec<u8>,
    ) -> Result<crate::relay_mesh::BasedMeshWrapper, &'static str> {
        if self.state != ActorState::InitiateIntent {
            return Err("Cannot emit prepare attestation: actor is not in InitiateIntent state");
        }

        let payload = serde_json::to_vec(self)
            .map_err(|_| "Failed to serialize actor state for cross-manifold message")?;

        let message = crate::relay_mesh::CrossManifoldMessage {
            message_id: self.actor_id,
            sender: self.sender,
            recipient: self.recipient,
            payload,
            timestamp: self.created_at,
        };

        crate::relay_mesh::BasedMeshWrapper::from_message(
            source_manifold_id,
            target_manifold_id,
            state_diff_blob_hash,
            proof_scheme,
            attestation_proof,
            &message,
        )
    }

    /// Processes an incoming attestation packet, verifying the ZK validity proof and advancing the actor state machine.
    pub fn process_attestation(
        &mut self,
        packet: &crate::relay_mesh::BasedMeshWrapper,
    ) -> Result<(), &'static str> {
        let message = packet.extract_message()?;

        if message.message_id != self.actor_id {
            return Err("Attestation message ID does not match actor ID");
        }

        let remote_actor: Self = serde_json::from_slice(&message.payload)
            .map_err(|_| "Failed to deserialize actor state payload")?;

        if remote_actor.sender != self.sender || remote_actor.recipient != self.recipient || remote_actor.amount != self.amount {
            return Err("Attestation actor state parameters do not match local actor state");
        }

        match self.state {
            ActorState::InitiateIntent => {
                self.prepare()?;
            }
            ActorState::PrepareExecution => {
                self.commit()?;
            }
            ActorState::Commit | ActorState::Rollback => {
                return Err("Actor is already in a terminal state");
            }
        }

        Ok(())
    }

    /// Processes an incoming attestation packet, requiring consensus sign-off from the Relay committee.
    pub async fn process_attestation_with_committee(
        &mut self,
        packet: &crate::relay_mesh::BasedMeshWrapper,
        committee: &crate::cross_chain_committee::CrossChainRelayCommittee,
        intent: &crate::cross_chain_committee::AsyncIntent,
        quantum_threat: bool,
    ) -> Result<(), &'static str> {
        intent.verify_consensus(committee, quantum_threat).await?;
        self.process_attestation(packet)
    }
}

// =========================================================================
// DECLARATIVE LATTICE SAGA PROTOCOL (Intent-Based System)
// =========================================================================

/// Canonical slot ID for Lattice Saga Locks
pub const SLOT_SAGA_LOCK: u16 = 7;

/// Discrete status of a declarative Lattice Saga Intent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SagaStatus {
    Pending,
    Simulating,
    Staged,
    Committed,
    RolledBack,
}

/// A predicate that must hold over a target account's slot before a saga can execute.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotPredicate {
    pub account: Address,
    pub slot_id: u16,
    pub predicate_type: PredicateType,
    pub expected_value: B256,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicateType {
    CommitmentEquals,
    SequenceAtLeast,
    SlotUnlocked,
    ZanzibarRelationActive,
}

/// A declarative mutation applied to an account slot during a saga.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotMutation {
    pub account: Address,
    pub slot_id: u16,
    pub new_commitment: B256,
    pub type_tag: u16,
    pub schema_hash: B256,
}

/// A multi-actor declarative intent coordinating atomic state transitions across CAR slots.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LatticeSagaIntent {
    pub intent_id: B256,
    pub initiator: Address,
    pub target_accounts: Vec<Address>,
    pub pre_conditions: Vec<SlotPredicate>,
    pub mutations: Vec<SlotMutation>,
    pub compensations: Vec<SlotMutation>,
    pub created_epoch: u64,
    pub timeout_epoch: u64,
    pub status: SagaStatus,
    pub lock_id: B256,
}

impl LatticeSagaIntent {
    pub fn new(
        intent_id: B256,
        initiator: Address,
        target_accounts: Vec<Address>,
        created_epoch: u64,
        timeout_epoch: u64,
    ) -> Self {
        let mut buf = Vec::with_capacity(13 + 32 + 8);
        buf.extend_from_slice(b"SAGA_LOCK_V1:");
        buf.extend_from_slice(intent_id.as_slice());
        buf.extend_from_slice(&timeout_epoch.to_le_bytes());
        let lock_id = alloy_primitives::keccak256(&buf);

        Self {
            intent_id,
            initiator,
            target_accounts,
            pre_conditions: Vec::new(),
            mutations: Vec::new(),
            compensations: Vec::new(),
            created_epoch,
            timeout_epoch,
            status: SagaStatus::Pending,
            lock_id,
        }
    }

    pub fn add_precondition(&mut self, account: Address, slot_id: u16, pred_type: PredicateType, expected: B256) {
        self.pre_conditions.push(SlotPredicate {
            account,
            slot_id,
            predicate_type: pred_type,
            expected_value: expected,
        });
    }

    pub fn add_mutation(&mut self, account: Address, slot_id: u16, new_comm: B256, type_tag: u16, schema: B256) {
        self.mutations.push(SlotMutation {
            account,
            slot_id,
            new_commitment: new_comm,
            type_tag,
            schema_hash: schema,
        });
    }

    pub fn add_compensation(&mut self, account: Address, slot_id: u16, comp_comm: B256, type_tag: u16, schema: B256) {
        self.compensations.push(SlotMutation {
            account,
            slot_id,
            new_commitment: comp_comm,
            type_tag,
            schema_hash: schema,
        });
    }
}

/// Autonomous coordinator for evaluating, staging, committing, and rolling back multi-slot sagas.
pub struct LatticeSagaCoordinator;

impl LatticeSagaCoordinator {
    /// Evaluates pre-conditions across all target account registers.
    pub fn evaluate_predicates(
        intent: &LatticeSagaIntent,
        accounts: &std::collections::HashMap<Address, crate::lattice::car_register::PolymorphicAccountRegister>,
    ) -> Result<(), &'static str> {
        for pred in &intent.pre_conditions {
            let reg = accounts.get(&pred.account)
                .ok_or("Precondition target account not found in active lattice")?;

            let slot = reg.slots.get(&pred.slot_id);

            match pred.predicate_type {
                PredicateType::CommitmentEquals => {
                    let comm = slot.map(|s| s.commitment).unwrap_or(B256::ZERO);
                    if comm != pred.expected_value {
                        return Err("Precondition failed: slot commitment mismatch");
                    }
                }
                PredicateType::SequenceAtLeast => {
                    let seq = slot.map(|s| s.sequence).unwrap_or(0);
                    let min_seq = u64::from_le_bytes(pred.expected_value[0..8].try_into().unwrap());
                    if seq < min_seq {
                        return Err("Precondition failed: slot sequence below required minimum");
                    }
                }
                PredicateType::SlotUnlocked => {
                    let lock_slot = reg.slots.get(&SLOT_SAGA_LOCK);
                    let current_lock = lock_slot.map(|s| s.commitment).unwrap_or(B256::ZERO);
                    if current_lock != B256::ZERO && current_lock != intent.lock_id {
                        return Err("Precondition failed: target account slot 7 is locked by another saga");
                    }
                }
                PredicateType::ZanzibarRelationActive => {
                    let zanzibar_slot = reg.slots.get(&1);
                    if zanzibar_slot.is_none() || zanzibar_slot.unwrap().commitment == B256::ZERO {
                        return Err("Precondition failed: required Zanzibar relation accumulator not initialized");
                    }
                }
            }
        }
        Ok(())
    }

    /// Stages the saga by locking Slot 7 on all involved target accounts.
    pub fn stage_and_lock(
        intent: &mut LatticeSagaIntent,
        accounts: &mut std::collections::HashMap<Address, crate::lattice::car_register::PolymorphicAccountRegister>,
        current_epoch: u64,
    ) -> Result<(), &'static str> {
        if intent.status != SagaStatus::Pending && intent.status != SagaStatus::Simulating {
            return Err("Cannot stage intent: invalid initial status");
        }
        if current_epoch > intent.timeout_epoch {
            intent.status = SagaStatus::RolledBack;
            return Err("Cannot stage intent: already expired");
        }

        Self::evaluate_predicates(intent, accounts)?;

        // Acquire lock on Slot 7 for each target account
        for addr in &intent.target_accounts {
            let reg = accounts.get_mut(addr)
                .ok_or("Target account register missing during lock acquisition")?;

            if !reg.slots.contains_key(&SLOT_SAGA_LOCK) {
                reg.mount_slot(
                    SLOT_SAGA_LOCK,
                    intent.lock_id,
                    B256::ZERO,
                    "LATTICE_SAGA_LOCK".to_string(),
                )?;
            } else {
                let current_lock = reg.slots.get(&SLOT_SAGA_LOCK).unwrap().commitment;
                if current_lock != B256::ZERO && current_lock != intent.lock_id {
                    return Err("Contended lock: target account is locked by an active saga");
                }
                reg.transition_slot(SLOT_SAGA_LOCK, intent.lock_id, current_epoch)?;
            }
        }

        intent.status = SagaStatus::Staged;
        Ok(())
    }

    /// Atomically applies all planned slot mutations and releases the Slot 7 locks.
    pub fn commit(
        intent: &mut LatticeSagaIntent,
        accounts: &mut std::collections::HashMap<Address, crate::lattice::car_register::PolymorphicAccountRegister>,
        current_epoch: u64,
    ) -> Result<(), &'static str> {
        if intent.status != SagaStatus::Staged {
            return Err("Cannot commit intent: must be in Staged status");
        }
        if current_epoch > intent.timeout_epoch {
            // Expired while staged -> must execute compensation rollback
            return Self::rollback(intent, accounts, current_epoch);
        }

        // Apply all mutations
        for mut_spec in &intent.mutations {
            let reg = accounts.get_mut(&mut_spec.account)
                .ok_or("Account missing during mutation application")?;

            if !reg.slots.contains_key(&mut_spec.slot_id) {
                reg.mount_slot(
                    mut_spec.slot_id,
                    mut_spec.new_commitment,
                    mut_spec.schema_hash,
                    format!("slot_{}", mut_spec.slot_id),
                )?;
            } else {
                reg.transition_slot(mut_spec.slot_id, mut_spec.new_commitment, current_epoch)?;
            }
        }

        // Release Slot 7 locks
        for addr in &intent.target_accounts {
            if let Some(reg) = accounts.get_mut(addr) {
                if reg.slots.contains_key(&SLOT_SAGA_LOCK) {
                    reg.transition_slot(SLOT_SAGA_LOCK, B256::ZERO, current_epoch)?;
                }
            }
        }

        intent.status = SagaStatus::Committed;
        Ok(())
    }

    /// Reverts staged changes by applying compensations and clearing Slot 7 locks.
    pub fn rollback(
        intent: &mut LatticeSagaIntent,
        accounts: &mut std::collections::HashMap<Address, crate::lattice::car_register::PolymorphicAccountRegister>,
        current_epoch: u64,
    ) -> Result<(), &'static str> {
        // Apply compensations if available
        for comp in &intent.compensations {
            if let Some(reg) = accounts.get_mut(&comp.account) {
                if reg.slots.contains_key(&comp.slot_id) {
                    let _ = reg.transition_slot(comp.slot_id, comp.new_commitment, current_epoch);
                }
            }
        }

        // Release Slot 7 locks
        for addr in &intent.target_accounts {
            if let Some(reg) = accounts.get_mut(addr) {
                if reg.slots.contains_key(&SLOT_SAGA_LOCK) {
                    let _ = reg.transition_slot(SLOT_SAGA_LOCK, B256::ZERO, current_epoch);
                }
            }
        }

        intent.status = SagaStatus::RolledBack;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay_mesh::ProofScheme;

    #[tokio::test]
    async fn test_saga_actor_attestation_flow() {
        let actor_id = B256::repeat_byte(0x99);
        let sender = Address::repeat_byte(0x12);
        let recipient = Address::repeat_byte(0x34);
        let amount = U256::from(1000);
        let current_time = 10000;

        let source_actor = SagaActor::new(actor_id, sender, recipient, amount, current_time);
        assert_eq!(source_actor.state, ActorState::InitiateIntent);

        let packet = source_actor.emit_prepare_attestation(
            65001,
            65002,
            B256::ZERO,
            ProofScheme::Groth16Bn254,
            vec![0u8; 32],
        ).unwrap();

        let mut target_actor = SagaActor::new(actor_id, sender, recipient, amount, current_time);
        target_actor.process_attestation(&packet).unwrap();
        assert_eq!(target_actor.state, ActorState::PrepareExecution);

        // Reset nullifier tracking to allow the commit attestation step in unit test
        {
            let registry_lock = crate::registry::get_registry();
            registry_lock.write().unwrap().processed_manifold_messages.clear();
        }

        target_actor.process_attestation(&packet).unwrap();
        assert_eq!(target_actor.state, ActorState::Commit);
    }

    #[test]
    fn test_declarative_lattice_saga_coordination() {
        use std::collections::HashMap;
        use crate::lattice::car_register::PolymorphicAccountRegister;

        let alice = Address::repeat_byte(0xaa);
        let bob = Address::repeat_byte(0xbb);
        let mut accounts = HashMap::new();

        let mut reg_alice = PolymorphicAccountRegister::new_with_default_config(alice, U256::ZERO);
        let reg_bob = PolymorphicAccountRegister::new_with_default_config(bob, U256::ZERO);

        let initial_comm = B256::repeat_byte(0x11);
        reg_alice.mount_slot(1, initial_comm, B256::ZERO, "slot_1".to_string()).unwrap();

        accounts.insert(alice, reg_alice);
        accounts.insert(bob, reg_bob);

        let intent_id = B256::repeat_byte(0x77);
        let mut intent = LatticeSagaIntent::new(intent_id, alice, vec![alice, bob], 100, 150);

        // Pre-condition: Alice slot 1 must equal initial_comm, and Slot 7 must be unlocked
        intent.add_precondition(alice, 1, PredicateType::CommitmentEquals, initial_comm);
        intent.add_precondition(alice, SLOT_SAGA_LOCK, PredicateType::SlotUnlocked, B256::ZERO);
        intent.add_precondition(bob, SLOT_SAGA_LOCK, PredicateType::SlotUnlocked, B256::ZERO);

        // Mutations: Alice debits note in Slot 2, Bob credits note in Slot 2
        let note_alice = B256::repeat_byte(0x22);
        let note_bob = B256::repeat_byte(0x33);
        intent.add_mutation(alice, 2, note_alice, 0x0001, B256::ZERO);
        intent.add_mutation(bob, 2, note_bob, 0x0001, B256::ZERO);

        // Compensations
        intent.add_compensation(alice, 2, B256::ZERO, 0x0001, B256::ZERO);
        intent.add_compensation(bob, 2, B256::ZERO, 0x0001, B256::ZERO);

        // 1. Stage and Lock
        LatticeSagaCoordinator::stage_and_lock(&mut intent, &mut accounts, 105).unwrap();
        assert_eq!(intent.status, SagaStatus::Staged);

        // Verify Slot 7 is locked on both accounts
        let alice_lock = accounts.get(&alice).unwrap().slots.get(&SLOT_SAGA_LOCK).unwrap().commitment;
        let bob_lock = accounts.get(&bob).unwrap().slots.get(&SLOT_SAGA_LOCK).unwrap().commitment;
        assert_eq!(alice_lock, intent.lock_id);
        assert_eq!(bob_lock, intent.lock_id);

        // 2. Commit
        LatticeSagaCoordinator::commit(&mut intent, &mut accounts, 110).unwrap();
        assert_eq!(intent.status, SagaStatus::Committed);

        // Verify mutations applied
        assert_eq!(accounts.get(&alice).unwrap().slots.get(&2).unwrap().commitment, note_alice);
        assert_eq!(accounts.get(&bob).unwrap().slots.get(&2).unwrap().commitment, note_bob);

        // Verify Slot 7 locks released
        assert_eq!(accounts.get(&alice).unwrap().slots.get(&SLOT_SAGA_LOCK).unwrap().commitment, B256::ZERO);
        assert_eq!(accounts.get(&bob).unwrap().slots.get(&SLOT_SAGA_LOCK).unwrap().commitment, B256::ZERO);
    }

    #[test]
    fn test_lattice_saga_timeout_and_compensation_rollback() {
        use std::collections::HashMap;
        use crate::lattice::car_register::PolymorphicAccountRegister;

        let charlie = Address::repeat_byte(0xcc);
        let mut accounts = HashMap::new();
        let reg_charlie = PolymorphicAccountRegister::new_with_default_config(charlie, U256::ZERO);
        accounts.insert(charlie, reg_charlie);

        let intent_id = B256::repeat_byte(0x88);
        let mut intent = LatticeSagaIntent::new(intent_id, charlie, vec![charlie], 100, 120);

        let comp_comm = B256::repeat_byte(0x55);
        intent.add_mutation(charlie, 4, B256::repeat_byte(0x99), 0x0004, B256::ZERO);
        intent.add_compensation(charlie, 4, comp_comm, 0x0004, B256::ZERO);

        LatticeSagaCoordinator::stage_and_lock(&mut intent, &mut accounts, 105).unwrap();
        assert_eq!(intent.status, SagaStatus::Staged);

        // Commit attempted after timeout (epoch 125 > timeout 120) -> auto rollbacks
        assert!(LatticeSagaCoordinator::commit(&mut intent, &mut accounts, 125).is_ok());
        assert_eq!(intent.status, SagaStatus::RolledBack);

        // Check lock released and compensation applied
        assert_eq!(accounts.get(&charlie).unwrap().slots.get(&SLOT_SAGA_LOCK).unwrap().commitment, B256::ZERO);
        assert_eq!(accounts.get(&charlie).unwrap().slots.get(&4).unwrap().commitment, comp_comm);
    }
}
