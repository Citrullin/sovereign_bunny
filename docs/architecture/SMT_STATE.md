# Sparse Merkle Tree (Poseidon-SMT) State Architecture

## 1. Overview

Sovereign Reth structures its primary state verification and nullifier sets using **Poseidon-hashed Sparse Merkle Trees (SMTs)** over the BN254 scalar field.

```
                      [ EpochSMTSnapshot Root ]
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
[ Account & CAR Storage SMT ]                     [ Nullifier & Compliance SMT ]
• Poseidon(Addr || Slot) ──► Value                • Poseidon(Domain || Nullifier)
• O(log N) Inclusion Proof                        • O(log N) Non-Inclusion Proof
• Zero-overhead Noir Circuit Verification         • Double-Spend & Sanctions Exclusion
```

---

## 2. Why Poseidon-SMT Over Verkle

While Verkle trees (EIP-6800) produce compact vector commitment proofs (~150 bytes), verifying Bandersnatch group operations inside arithmetic SNARK circuits incurs massive constraint counts.

| Metric | Bandersnatch Verkle Tree | Poseidon-SMT (BN254) |
|---|---|---|
| Native Proving Circuit | Expensive (Curve Emulation) | Direct Arithmetic Field ($O(1)$) |
| Proof Generation in Browser | Heavy (>500 MB RAM) | Lightweight (<50 MB RAM) |
| Non-Inclusion Proofs | Complex Multi-point Openings | Direct SMT Sibling Default Zero |
| Noir / Groth16 Prover | ~150,000 Constraints | ~4,200 Constraints per Path |

---

## 3. Leaf & Key Formatting

### 3.1 Account & CAR Storage Leaves
For state storage across CAR registers (Slots 0 to 63):
$$\text{LeafKey} = \text{Poseidon}(\text{Address} \parallel \text{SlotIndex})$$
$$\text{LeafValue} = \text{Poseidon}(\text{Sequence} \parallel \text{SlotCommitment} \parallel \text{Epoch})$$

### 3.2 Nullifier SMT Architecture (`crates/consensus/src/lattice/nullifier_smt.rs`)
To prevent double-spending across asynchronous account chains while preserving complete anonymity, the consensus layer maintains a dedicated Nullifier SMT:

1. **Spend Nullifiers:**
   Emitted when a recipient absorbs a note from superposition:
   $$\text{Key}_{\text{spend}} = \text{Poseidon}(\text{DOM\_SPEND\_NULLIFIER}, \text{sk}_{\text{spend}}, \rho)$$

2. **Reclamation Nullifiers:**
   Emitted when a sender claws back an unabsorbed note after $E_{\text{decay}}$:
   $$\text{Key}_{\text{reclaim}} = \text{Poseidon}(\text{DOM\_RECLAIM\_NULLIFIER}, \text{sk}_{\text{sender}}, \rho, E_{\text{decay}})$$

3. **Compliance Leaves:**
   $$\text{Key}_{\text{compliance}} = \text{Poseidon}(\text{0xC04D0001} \parallel \text{Address})$$

---

## 4. Stateless Non-Membership & Double-Spend Invariants

1. **Unspent Invariant Verification**:
   Before committing an `AbsorbNote` block, the consensus engine verifies that the nullifier key does **not** exist in the active Nullifier SMT:
   $$\text{Nullifier} \notin \text{Tree}(\text{EpochRoot})$$
   Because empty SMT nodes resolve to deterministically known constant zero hashes at each depth ($256$ levels), non-membership proofs require only $O(\log N)$ sibling hashes, easily checked within browser-grade Noir circuits.

2. **Atomic Nullifier Insertion**:
   Upon validating the absorption or reclamation proof, the consensus engine updates the leaf:
   $$\text{Tree}[\text{Nullifier}] \leftarrow \text{Poseidon}(\text{BlockHeight} \parallel \text{Epoch})$$
   Any subsequent attempt to submit either the recipient's spend nullifier or the sender's reclamation nullifier fails instantly on membership collision.

3. **Checkpoints & Reorg Isolation**:
   The SMT engine provides atomic checkpointing (`checkpoint()`) and rollback (`restore()`), allowing validators to simulate and unwind speculative candidate blocks during Snowman BFT rounds without corrupting the finalized state root.
