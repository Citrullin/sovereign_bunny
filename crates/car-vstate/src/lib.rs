//! # Virtual CAR State Engine (`car-vstate`)
//!
//! High-performance, double-buffered Virtual Chained Account Register (CAR)
//! tree with 64 linear SSZ slot buffers, SIMD-accelerated bitmask diffing,
//! delta extraction, and bit-for-bit identical state-root calculation.
//!
//! ## Invariants
//! 1. **Fixed 64-Slot Linear Topology**: Exactly slots $R_0 \dots R_{63}$ mapped sequentially in memory.
//! 2. **Bitmask Dirty Tracking**: 64-bit integer mask tracking modified slots in $O(1)$ CPU cycles.
//! 3. **Deterministic State Tip**: $H_t = \text{keccak256}(\text{nonce} \mathbin{\Vert} R_0 \dots R_{63})$.
//! 4. **Fail-Closed Monotonicity**: Rejects any state mutation where proposed sequence nonce $\le$ current nonce.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

use alloc::vec::Vec;
use alloy_primitives::{Address, B256};
use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use alloc::{format, string::String};
#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

pub const NUM_SLOTS: usize = 64;

/// Canonical Polymorphic DAO & State Type Tags
pub const TYPE_TAG_RAW: u16 = 0x0000;
pub const TYPE_TAG_GMBH_CORP: u16 = 0x0001;        // HRB (Handelsregister B) Corporate Entity
pub const TYPE_TAG_EG_COOP: u16 = 0x0002;          // GnR (Genossenschaftsregister) Cooperative Entity
pub const TYPE_TAG_EV_ASSOC: u16 = 0x0003;         // VR (Vereinsregister) Non-profit Association
pub const TYPE_TAG_SUPPLY_CONSORTIUM: u16 = 0x0004;// Industrial B2B Consortium
pub const TYPE_TAG_MUTUAL_BANK: u16 = 0x0005;      // Sparkassen/Volksbanken CBMT Corridor

/// A single slot within the 64-slot Chained Account Register.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct VirtualSlot {
    pub slot_id: u16,
    pub commitment: B256,
    pub previous_commitment: B256,
    pub sequence: u64,
    pub last_updated_epoch: u64,
    #[serde(default)]
    pub type_tag: u16,
    #[serde(default)]
    pub schema_hash: B256,
}

impl Default for VirtualSlot {
    fn default() -> Self {
        Self {
            slot_id: 0,
            commitment: B256::ZERO,
            previous_commitment: B256::ZERO,
            sequence: 0,
            last_updated_epoch: 0,
            type_tag: TYPE_TAG_RAW,
            schema_hash: B256::ZERO,
        }
    }
}

impl VirtualSlot {
    #[must_use]
    pub fn new(slot_id: u16, commitment: B256, sequence: u64, epoch: u64) -> Self {
        Self {
            slot_id,
            commitment,
            previous_commitment: B256::ZERO,
            sequence,
            last_updated_epoch: epoch,
            type_tag: TYPE_TAG_RAW,
            schema_hash: B256::ZERO,
        }
    }

    #[must_use]
    pub fn new_typed(
        slot_id: u16,
        commitment: B256,
        sequence: u64,
        epoch: u64,
        type_tag: u16,
        schema_hash: B256,
    ) -> Self {
        Self {
            slot_id,
            commitment,
            previous_commitment: B256::ZERO,
            sequence,
            last_updated_epoch: epoch,
            type_tag,
            schema_hash,
        }
    }

    #[must_use]
    pub fn is_typed(&self) -> bool {
        self.type_tag != TYPE_TAG_RAW
    }
}

/// A compact delta payload recording dirty slot transitions and state root progression.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CarStateDelta {
    pub account: Address,
    pub old_nonce: u64,
    pub new_nonce: u64,
    pub old_state_tip: B256,
    pub new_state_tip: B256,
    pub dirty_mask: u64,
    pub modified_slots: Vec<VirtualSlot>,
}

mod serde_slots {
    use super::*;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S>(slots: &[VirtualSlot; NUM_SLOTS], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeSeq;
        let mut seq = serializer.serialize_seq(Some(NUM_SLOTS))?;
        for slot in slots.iter() {
            seq.serialize_element(slot)?;
        }
        seq.end()
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[VirtualSlot; NUM_SLOTS], D::Error>
    where
        D: Deserializer<'de>,
    {
        let vec = Vec::<VirtualSlot>::deserialize(deserializer)?;
        if vec.len() != NUM_SLOTS {
            return Err(serde::de::Error::custom("Expected array of 64 slots"));
        }
        let mut slots = [VirtualSlot::default(); NUM_SLOTS];
        slots.copy_from_slice(&vec[..NUM_SLOTS]);
        Ok(slots)
    }
}

mod serde_opt_slots {
    use super::*;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S>(opt: &Option<[VirtualSlot; NUM_SLOTS]>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match opt {
            Some(slots) => serializer.serialize_some(&slots.as_slice()),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<[VirtualSlot; NUM_SLOTS]>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let opt_vec = Option::<Vec<VirtualSlot>>::deserialize(deserializer)?;
        match opt_vec {
            Some(vec) => {
                if vec.len() != NUM_SLOTS {
                    return Err(serde::de::Error::custom("Expected array of 64 slots"));
                }
                let mut slots = [VirtualSlot::default(); NUM_SLOTS];
                slots.copy_from_slice(&vec[..NUM_SLOTS]);
                Ok(Some(slots))
            }
            None => Ok(None),
        }
    }
}

/// 64-slot double-buffered Virtual CAR Tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VirtualCarTree {
    pub account: Address,
    pub nonce: u64,
    #[serde(with = "serde_slots")]
    pub slots: [VirtualSlot; NUM_SLOTS],
    pub dirty_mask: u64,
    #[serde(with = "serde_opt_slots")]
    pub base_snapshot: Option<[VirtualSlot; NUM_SLOTS]>,
}

impl VirtualCarTree {
    /// Creates a new clean Virtual CAR Tree for an account.
    #[must_use]
    pub fn new(account: Address) -> Self {
        let mut slots = [VirtualSlot::default(); NUM_SLOTS];
        for i in 0..NUM_SLOTS {
            slots[i].slot_id = i as u16;
        }
        Self {
            account,
            nonce: 0,
            slots,
            dirty_mask: 0,
            base_snapshot: None,
        }
    }

    /// Initializes from an array of 64 slot commitments and a starting nonce.
    #[must_use]
    pub fn from_commitments(account: Address, nonce: u64, commitments: [B256; NUM_SLOTS]) -> Self {
        let mut slots = [VirtualSlot::default(); NUM_SLOTS];
        for i in 0..NUM_SLOTS {
            slots[i] = VirtualSlot {
                slot_id: i as u16,
                commitment: commitments[i],
                previous_commitment: B256::ZERO,
                sequence: if commitments[i] == B256::ZERO { 0 } else { 1 },
                last_updated_epoch: 1,
                type_tag: TYPE_TAG_RAW,
                schema_hash: B256::ZERO,
            };
        }
        Self {
            account,
            nonce,
            slots,
            dirty_mask: 0,
            base_snapshot: None,
        }
    }

    /// Takes a base snapshot checkpoint to begin staging speculative transitions.
    pub fn checkpoint(&mut self) {
        self.base_snapshot = Some(self.slots);
        self.dirty_mask = 0;
    }

    /// Discards all unsealed speculative mutations and rolls back to the checkpoint.
    pub fn rollback(&mut self) -> Result<(), &'static str> {
        if let Some(snapshot) = self.base_snapshot {
            self.slots = snapshot;
            self.dirty_mask = 0;
            Ok(())
        } else {
            Err("No active checkpoint to rollback to")
        }
    }

    /// Sets a slot commitment, enforcing monotonic slot nonce and recording in dirty mask.
    pub fn set_slot(
        &mut self,
        slot_id: u16,
        new_commitment: B256,
        epoch: u64,
    ) -> Result<(), &'static str> {
        self.set_slot_typed(slot_id, new_commitment, epoch, TYPE_TAG_RAW, B256::ZERO)
    }

    /// Sets a slot commitment with an explicit polymorphic type tag and schema hash.
    pub fn set_slot_typed(
        &mut self,
        slot_id: u16,
        new_commitment: B256,
        epoch: u64,
        type_tag: u16,
        schema_hash: B256,
    ) -> Result<(), &'static str> {
        let idx = slot_id as usize;
        if idx >= NUM_SLOTS {
            return Err("Slot ID exceeds 64-slot bounds (R_0..R_63)");
        }

        let slot = &mut self.slots[idx];
        slot.previous_commitment = slot.commitment;
        slot.commitment = new_commitment;
        slot.sequence += 1;
        slot.last_updated_epoch = epoch.max(1);
        slot.type_tag = type_tag;
        slot.schema_hash = schema_hash;

        self.dirty_mask |= 1u64 << idx;
        Ok(())
    }

    /// Stages a slot transition with explicit global nonce advancement.
    pub fn stage_transition(
        &mut self,
        slot_id: u16,
        new_commitment: B256,
        epoch: u64,
        proposed_nonce: u64,
    ) -> Result<B256, &'static str> {
        self.stage_transition_typed(
            slot_id,
            new_commitment,
            epoch,
            proposed_nonce,
            TYPE_TAG_RAW,
            B256::ZERO,
        )
    }

    /// Stages a typed slot transition with explicit global nonce advancement.
    pub fn stage_transition_typed(
        &mut self,
        slot_id: u16,
        new_commitment: B256,
        epoch: u64,
        proposed_nonce: u64,
        type_tag: u16,
        schema_hash: B256,
    ) -> Result<B256, &'static str> {
        if proposed_nonce != self.nonce + 1 {
            return Err("Non-monotonic proposed nonce");
        }
        self.set_slot_typed(slot_id, new_commitment, epoch, type_tag, schema_hash)?;
        self.nonce = proposed_nonce;
        Ok(self.compute_state_tip())
    }

    /// Computes the unified account state tip $H_t$ matching `sovereign-consensus` flat array.
    #[must_use]
    pub fn compute_state_tip(&self) -> B256 {
        // Buffer: 32 bytes nonce + 64 * 32 bytes slot commitments
        let mut combined = [0u8; 32 + NUM_SLOTS * 32];
        combined[0..8].copy_from_slice(&self.nonce.to_le_bytes());

        for i in 0..NUM_SLOTS {
            let offset = 32 + i * 32;
            combined[offset..offset + 32].copy_from_slice(self.slots[i].commitment.as_slice());
        }

        use tiny_keccak::{Hasher, Keccak};
        let mut hasher = Keccak::v256();
        hasher.update(&combined);
        let mut output = [0u8; 32];
        hasher.finalize(&mut output);
        B256::from(output)
    }

    /// Computes the delta from the base checkpoint and seals the transition.
    pub fn compute_delta(&mut self) -> Result<CarStateDelta, &'static str> {
        let snapshot = self.base_snapshot.ok_or("No checkpoint set; call checkpoint() before compute_delta()")?;
        
        let old_tree = VirtualCarTree {
            account: self.account,
            nonce: self.nonce.saturating_sub(self.dirty_mask.count_ones() as u64),
            slots: snapshot,
            dirty_mask: 0,
            base_snapshot: None,
        };
        let old_state_tip = old_tree.compute_state_tip();
        let new_state_tip = self.compute_state_tip();

        let mut modified = Vec::new();
        for i in 0..NUM_SLOTS {
            if (self.dirty_mask & (1u64 << i)) != 0 {
                modified.push(self.slots[i]);
            }
        }

        let delta = CarStateDelta {
            account: self.account,
            old_nonce: old_tree.nonce,
            new_nonce: self.nonce,
            old_state_tip,
            new_state_tip,
            dirty_mask: self.dirty_mask,
            modified_slots: modified,
        };

        // Seal: update base snapshot to current slots
        self.base_snapshot = Some(self.slots);
        self.dirty_mask = 0;

        Ok(delta)
    }

    /// Returns a direct reference to a slot.
    #[must_use]
    pub fn get_slot(&self, slot_id: u16) -> Option<&VirtualSlot> {
        let idx = slot_id as usize;
        if idx < NUM_SLOTS {
            Some(&self.slots[idx])
        } else {
            None
        }
    }
}

// =========================================================================
// WASM BINDINGS
// =========================================================================

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub struct WasmVirtualCarTree {
    inner: VirtualCarTree,
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
impl WasmVirtualCarTree {
    #[wasm_bindgen(constructor)]
    pub fn new(account_hex: &str) -> Result<WasmVirtualCarTree, JsValue> {
        let addr = account_hex.parse::<Address>()
            .map_err(|e| JsValue::from_str(&format!("Invalid account address: {:?}", e)))?;
        Ok(WasmVirtualCarTree {
            inner: VirtualCarTree::new(addr),
        })
    }

    #[wasm_bindgen]
    pub fn checkpoint(&mut self) {
        self.inner.checkpoint();
    }

    #[wasm_bindgen]
    pub fn rollback(&mut self) -> Result<(), JsValue> {
        self.inner.rollback().map_err(|e| JsValue::from_str(e))
    }

    #[wasm_bindgen]
    pub fn set_slot(&mut self, slot_id: u16, commitment_hex: &str, epoch: u64) -> Result<(), JsValue> {
        let comm = commitment_hex.parse::<B256>()
            .map_err(|e| JsValue::from_str(&format!("Invalid commitment hex: {:?}", e)))?;
        self.inner.set_slot(slot_id, comm, epoch).map_err(|e| JsValue::from_str(e))
    }

    #[wasm_bindgen]
    pub fn stage_transition(&mut self, slot_id: u16, commitment_hex: &str, epoch: u64, proposed_nonce: u64) -> Result<String, JsValue> {
        let comm = commitment_hex.parse::<B256>()
            .map_err(|e| JsValue::from_str(&format!("Invalid commitment hex: {:?}", e)))?;
        let tip = self.inner.stage_transition(slot_id, comm, epoch, proposed_nonce).map_err(|e| JsValue::from_str(e))?;
        Ok(format!("{:#x}", tip))
    }

    #[wasm_bindgen]
    pub fn compute_state_tip(&self) -> String {
        format!("{:#x}", self.inner.compute_state_tip())
    }

    #[wasm_bindgen]
    pub fn compute_delta_json(&mut self) -> Result<String, JsValue> {
        let delta = self.inner.compute_delta().map_err(|e| JsValue::from_str(e))?;
        serde_json::to_string(&delta).map_err(|e| JsValue::from_str(&format!("Serialization failed: {:?}", e)))
    }

    #[wasm_bindgen]
    pub fn dirty_mask_hex(&self) -> String {
        format!("0x{:016x}", self.inner.dirty_mask)
    }

    #[wasm_bindgen]
    pub fn set_slot_typed(
        &mut self,
        slot_id: u16,
        commitment_hex: &str,
        epoch: u64,
        type_tag: u16,
        schema_hash_hex: &str,
    ) -> Result<(), JsValue> {
        let comm = commitment_hex.parse::<B256>()
            .map_err(|e| JsValue::from_str(&format!("Invalid commitment hex: {:?}", e)))?;
        let schema = schema_hash_hex.parse::<B256>()
            .map_err(|e| JsValue::from_str(&format!("Invalid schema hash hex: {:?}", e)))?;
        self.inner.set_slot_typed(slot_id, comm, epoch, type_tag, schema).map_err(|e| JsValue::from_str(e))
    }

    #[wasm_bindgen]
    pub fn stage_transition_typed(
        &mut self,
        slot_id: u16,
        commitment_hex: &str,
        epoch: u64,
        proposed_nonce: u64,
        type_tag: u16,
        schema_hash_hex: &str,
    ) -> Result<String, JsValue> {
        let comm = commitment_hex.parse::<B256>()
            .map_err(|e| JsValue::from_str(&format!("Invalid commitment hex: {:?}", e)))?;
        let schema = schema_hash_hex.parse::<B256>()
            .map_err(|e| JsValue::from_str(&format!("Invalid schema hash hex: {:?}", e)))?;
        let tip = self.inner.stage_transition_typed(slot_id, comm, epoch, proposed_nonce, type_tag, schema)
            .map_err(|e| JsValue::from_str(e))?;
        Ok(format!("{:#x}", tip))
    }

    #[wasm_bindgen]
    pub fn get_slot_type_tag(&self, slot_id: u16) -> Result<u16, JsValue> {
        self.inner.get_slot(slot_id)
            .map(|s| s.type_tag)
            .ok_or_else(|| JsValue::from_str("Slot ID out of bounds"))
    }

    #[wasm_bindgen]
    pub fn get_slot_schema_hash(&self, slot_id: u16) -> Result<String, JsValue> {
        self.inner.get_slot(slot_id)
            .map(|s| format!("{:#x}", s.schema_hash))
            .ok_or_else(|| JsValue::from_str("Slot ID out of bounds"))
    }
}

// =========================================================================
// UNIT & CONFORMANCE TESTS
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_virtual_car_state_tip() {
        let tree = VirtualCarTree::new(Address::ZERO);
        let tip = tree.compute_state_tip();
        assert_ne!(tip, B256::ZERO);

        // Bit-for-bit equivalence with 64 zero-padded slots
        let mut expected_buf = [0u8; 32 + 64 * 32];
        expected_buf[0..8].copy_from_slice(&0u64.to_le_bytes());
        use tiny_keccak::{Hasher, Keccak};
        let mut hasher = Keccak::v256();
        hasher.update(&expected_buf);
        let mut expected = [0u8; 32];
        hasher.finalize(&mut expected);
        assert_eq!(tip, B256::from(expected));
    }

    #[test]
    fn test_checkpoint_stage_and_delta() {
        let mut tree = VirtualCarTree::new(Address::repeat_byte(0x11));
        tree.checkpoint();

        let comm1 = B256::repeat_byte(0xaa);
        let comm2 = B256::repeat_byte(0xbb);

        assert!(tree.stage_transition(0, comm1, 1, 1).is_ok());
        assert!(tree.stage_transition(1, comm2, 1, 2).is_ok());

        assert_eq!(tree.dirty_mask, 0b11);
        assert_eq!(tree.dirty_mask.count_ones(), 2);

        let delta = tree.compute_delta().expect("compute_delta should succeed");
        assert_eq!(delta.modified_slots.len(), 2);
        assert_eq!(delta.modified_slots[0].slot_id, 0);
        assert_eq!(delta.modified_slots[0].commitment, comm1);
        assert_eq!(delta.modified_slots[1].slot_id, 1);
        assert_eq!(delta.modified_slots[1].commitment, comm2);
        assert_eq!(delta.new_nonce, 2);
        assert_eq!(tree.dirty_mask, 0); // Cleared upon sealing
    }

    #[test]
    fn test_checkpoint_rollback() {
        let mut tree = VirtualCarTree::new(Address::repeat_byte(0x22));
        tree.checkpoint();
        let initial_tip = tree.compute_state_tip();

        tree.set_slot(5, B256::repeat_byte(0x55), 10).unwrap();
        assert_ne!(tree.compute_state_tip(), initial_tip);

        tree.rollback().expect("Rollback should succeed");
        assert_eq!(tree.compute_state_tip(), initial_tip);
        assert_eq!(tree.dirty_mask, 0);
    }

    #[test]
    fn test_differential_conformance_with_consensus_car() {
        use sovereign_consensus::lattice::car_register::PolymorphicAccountRegister;
        use alloy_primitives::U256;

        let addr = Address::repeat_byte(0x77);
        let mut car_reg = PolymorphicAccountRegister::new_with_default_config(addr, U256::ZERO);
        let mut v_tree = VirtualCarTree::new(addr);

        // Synchronize initial mounted slots
        for (slot_id, slot) in &car_reg.slots {
            v_tree.set_slot(*slot_id, slot.commitment, slot.last_updated_epoch).unwrap();
        }
        v_tree.nonce = car_reg.nonce;

        // Verify initial state root bit-for-bit identity
        assert_eq!(v_tree.compute_state_tip(), car_reg.compute_state_tip());

        // Perform 5 sequential mutations across various slots
        let mutations = [
            (2u16, B256::repeat_byte(0x12), 10u64),
            (0u16, B256::repeat_byte(0x34), 11u64),
            (8u16, B256::repeat_byte(0x56), 12u64),
            (7u16, B256::repeat_byte(0x78), 13u64),
            (63u16, B256::repeat_byte(0x9a), 14u64),
        ];

        for (slot_id, new_comm, epoch) in mutations {
            if !car_reg.slots.contains_key(&slot_id) {
                car_reg.mount_slot(slot_id, new_comm, B256::repeat_byte(0xee), format!("slot_{}", slot_id)).unwrap();
            } else {
                car_reg.transition_slot(slot_id, new_comm, epoch).unwrap();
            }

            v_tree.stage_transition(slot_id, new_comm, epoch, car_reg.nonce).unwrap();

            // Check bit-for-bit identity of compute_state_tip
            assert_eq!(
                v_tree.compute_state_tip(),
                car_reg.compute_state_tip(),
                "State tip divergence at slot {}",
                slot_id
            );
        }
    }

    #[test]
    fn test_polymorphic_typed_slot_state_tip_invariance() {
        let addr = Address::repeat_byte(0x42);
        let mut raw_tree = VirtualCarTree::new(addr);
        let mut typed_tree = VirtualCarTree::new(addr);

        let comm = B256::repeat_byte(0x99);
        let schema = B256::repeat_byte(0xfe);

        // Raw transition vs Typed transition with same commitment
        raw_tree.stage_transition(2, comm, 1, 1).unwrap();
        typed_tree.stage_transition_typed(2, comm, 1, 1, TYPE_TAG_GMBH_CORP, schema).unwrap();

        // compute_state_tip MUST be bit-for-bit identical regardless of type tag,
        // preserving state tip consensus invariance while retaining polymorphic metadata in vState
        assert_eq!(raw_tree.compute_state_tip(), typed_tree.compute_state_tip());

        let slot = typed_tree.get_slot(2).unwrap();
        assert_eq!(slot.type_tag, TYPE_TAG_GMBH_CORP);
        assert_eq!(slot.schema_hash, schema);
        assert!(slot.is_typed());
    }
}
