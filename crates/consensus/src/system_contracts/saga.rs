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

/// Sentinel commitment in Slot 7 (`allow_saga_locking = false`) indicating an account has opted out of Saga locks.
pub const SAGA_OPT_OUT_COMMITMENT: B256 = B256::repeat_byte(0xff);

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
    /// Per-participant authorization signatures or capability digests (`participant -> authorization_tag`)
    #[serde(default)]
    pub participant_approvals: std::collections::HashMap<Address, B256>,
    /// Snapshot of pre-saga slot commitments captured at `stage_and_lock` for safe compensation rollback
    #[serde(default)]
    pub pre_saga_snapshots: std::collections::HashMap<(Address, u16), B256>,
    pub created_epoch: u64,
    pub timeout_epoch: u64,
    pub status: SagaStatus,
    pub lock_id: B256,
}

impl LatticeSagaIntent {
    pub fn new(
        intent_id: B256,
        initiator: Address,
        mut target_accounts: Vec<Address>,
        created_epoch: u64,
        timeout_epoch: u64,
    ) -> Self {
        // Canonical lexicographical lock ordering (Dijkstra resource hierarchy invariant)
        target_accounts.sort();
        target_accounts.dedup();

        let mut buf = Vec::with_capacity(13 + 32 + 8);
        buf.extend_from_slice(b"SAGA_LOCK_V1:");
        buf.extend_from_slice(intent_id.as_slice());
        buf.extend_from_slice(&timeout_epoch.to_le_bytes());
        let lock_id = alloy_primitives::keccak256(&buf);

        let mut participant_approvals = std::collections::HashMap::new();
        for &acc in &target_accounts {
            let auth_tag = Self::compute_approval_tag(intent_id, lock_id, acc);
            participant_approvals.insert(acc, auth_tag);
        }

        Self {
            intent_id,
            initiator,
            target_accounts,
            pre_conditions: Vec::new(),
            mutations: Vec::new(),
            compensations: Vec::new(),
            participant_approvals,
            pre_saga_snapshots: std::collections::HashMap::new(),
            created_epoch,
            timeout_epoch,
            status: SagaStatus::Pending,
            lock_id,
        }
    }

    #[must_use]
    pub fn compute_approval_tag(intent_id: B256, lock_id: B256, participant: Address) -> B256 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"sovereign:saga_approval:v1:");
        hasher.update(intent_id.as_slice());
        hasher.update(lock_id.as_slice());
        hasher.update(participant.as_slice());
        B256::from_slice(hasher.finalize().as_bytes())
    }

    pub fn authorize_participant(&mut self, participant: Address) {
        let tag = Self::compute_approval_tag(self.intent_id, self.lock_id, participant);
        self.participant_approvals.insert(participant, tag);
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
                    if current_lock == SAGA_OPT_OUT_COMMITMENT {
                        return Err("Precondition failed: target account opted out of saga locking (allow_saga_locking = false)");
                    }
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

    /// Stages the saga using strict Two-Phase Locking (2PL):
    /// Phase 1 (Validation): Verify lexicographical order, participant approvals, and lock availability across ALL accounts before mutating any state.
    /// Phase 2 (Acquisition): Snapshot pre-saga slot commitments and write `intent.lock_id` to Slot 7 on all target accounts.
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
        if intent.target_accounts.is_empty() {
            return Err("Cannot stage intent: target_accounts cannot be empty");
        }

        // Enforce strict ascending lexicographical order of target accounts to prevent deadlocks
        for window in intent.target_accounts.windows(2) {
            if window[0] >= window[1] {
                return Err("SAGA_DEADLOCK_ERR: target_accounts must be strictly sorted in ascending lexicographical order");
            }
        }

        // Verify every mutated/compensated account is included in target_accounts and has valid participant approval
        for m in intent.mutations.iter().chain(intent.compensations.iter()) {
            if !intent.target_accounts.contains(&m.account) {
                return Err("SAGA_AUTH_ERR: mutation targets an account outside target_accounts");
            }
        }

        // Phase 1 (Atomic Pre-Check): Verify all target accounts exist, have valid approval tags, and are unlocked in Slot 7
        for &addr in &intent.target_accounts {
            let expected_tag = LatticeSagaIntent::compute_approval_tag(intent.intent_id, intent.lock_id, addr);
            match intent.participant_approvals.get(&addr) {
                Some(&tag) if tag == expected_tag => {}
                _ => return Err("SAGA_AUTH_ERR: missing or invalid participant approval signature"),
            }

            let reg = accounts.get(&addr)
                .ok_or("Target account register missing during lock pre-check")?;

            if let Some(lock_slot) = reg.slots.get(&SLOT_SAGA_LOCK) {
                if lock_slot.commitment == SAGA_OPT_OUT_COMMITMENT {
                    return Err("SAGA_OPT_OUT_ERR: target account has allow_saga_locking = false in Slot 7");
                }
                if lock_slot.commitment != B256::ZERO && lock_slot.commitment != intent.lock_id {
                    return Err("Contended lock: target account is locked by an active saga");
                }
            }
        }

        Self::evaluate_predicates(intent, accounts)?;

        // Snapshot pre-saga slot commitments before acquiring locks
        intent.pre_saga_snapshots.clear();
        for m in &intent.mutations {
            if let Some(reg) = accounts.get(&m.account) {
                let prev = reg.slots.get(&m.slot_id).map(|s| s.commitment).unwrap_or(B256::ZERO);
                intent.pre_saga_snapshots.insert((m.account, m.slot_id), prev);
            }
        }

        // Phase 2 (Lock Acquisition): Acquire lock on Slot 7 for each target account
        for addr in &intent.target_accounts {
            let reg = accounts.get_mut(addr)
                .ok_or("Target account register missing during lock acquisition")?;

            if !reg.slots.contains_key(&SLOT_SAGA_LOCK) {
                reg.mount_slot(
                    SLOT_SAGA_LOCK,
                    intent.lock_id,
                    B256::ZERO,
                    "saga.lock_policy".to_string(),
                )?;
            } else {
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

        // Verify all target accounts still hold this saga's active lock_id in Slot 7
        for addr in &intent.target_accounts {
            let reg = accounts.get(addr)
                .ok_or("Account missing during commit lock verification")?;
            let current_lock = reg.slots.get(&SLOT_SAGA_LOCK).map(|s| s.commitment).unwrap_or(B256::ZERO);
            if current_lock != intent.lock_id {
                return Err("SAGA_LOCK_ERR: target account Slot 7 does not match intent.lock_id");
            }
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

    /// Reverts staged changes by applying compensations and clearing Slot 7 locks,
    /// strictly verifying that each target account holds `Slot 7 == intent.lock_id` before mutating.
    pub fn rollback(
        intent: &mut LatticeSagaIntent,
        accounts: &mut std::collections::HashMap<Address, crate::lattice::car_register::PolymorphicAccountRegister>,
        current_epoch: u64,
    ) -> Result<(), &'static str> {
        if intent.status != SagaStatus::Staged {
            return Err("SAGA_ROLLBACK_ERR: can only rollback a Staged saga");
        }

        // Verify all target accounts hold this saga's lock in Slot 7 before applying any compensation
        for addr in &intent.target_accounts {
            let reg = accounts.get(addr)
                .ok_or("Account missing during rollback lock verification")?;
            let current_lock = reg.slots.get(&SLOT_SAGA_LOCK).map(|s| s.commitment).unwrap_or(B256::ZERO);
            if current_lock != intent.lock_id {
                return Err("SAGA_LOCK_ERR: cannot rollback account whose Slot 7 lock does not match intent.lock_id");
            }
        }

        // Apply compensations (mounting the slot if not yet mounted so compensation state is recorded)
        for comp in &intent.compensations {
            if let Some(reg) = accounts.get_mut(&comp.account) {
                if reg.slots.contains_key(&comp.slot_id) {
                    reg.transition_slot(comp.slot_id, comp.new_commitment, current_epoch)?;
                } else {
                    reg.mount_slot(
                        comp.slot_id,
                        comp.new_commitment,
                        comp.schema_hash,
                        format!("slot_{}", comp.slot_id),
                    )?;
                }
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

    #[test]
    fn test_saga_atomic_2pl_opt_out_and_unauthorized_rejection() {
        use std::collections::HashMap;
        use crate::lattice::car_register::PolymorphicAccountRegister;

        let alice = Address::repeat_byte(0x10);
        let bob = Address::repeat_byte(0x20);
        let mut accounts = HashMap::new();
        accounts.insert(alice, PolymorphicAccountRegister::new_with_default_config(alice, U256::ZERO));
        let mut reg_bob = PolymorphicAccountRegister::new_with_default_config(bob, U256::ZERO);
        // Bob configures allow_saga_locking = false in Slot 7
        reg_bob.transition_slot(SLOT_SAGA_LOCK, SAGA_OPT_OUT_COMMITMENT, 1).unwrap();
        accounts.insert(bob, reg_bob);

        let intent_id = B256::repeat_byte(0xee);
        let mut intent = LatticeSagaIntent::new(intent_id, alice, vec![bob, alice], 10, 50);
        // Verify canonical lexicographical sorting happened automatically
        assert_eq!(intent.target_accounts, vec![alice, bob]);

        // Attempt to stage when Bob has opted out -> must fail atomically without locking Alice!
        let res = LatticeSagaCoordinator::stage_and_lock(&mut intent, &mut accounts, 15);
        assert!(res.is_err());
        assert_eq!(
            accounts.get(&alice).unwrap().slots.get(&SLOT_SAGA_LOCK).unwrap().commitment,
            B256::ZERO,
            "Atomic 2PL pre-check must not leave Alice locked when Bob rejects lock"
        );
    }
}
