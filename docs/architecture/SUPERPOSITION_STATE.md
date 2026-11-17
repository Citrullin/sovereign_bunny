# Superposition State Semantics, Blind Notes & Reclamation

## 1. Overview

In Sovereign Reth's Account-Lattice architecture, state transitions obey strict **Superposition State Semantics**:

> **Core Invariant:** Because each account chain advances independently and asynchronously, a sender cannot mutate a recipient's account register directly. Value or capabilities travel as an unspent commitment held in **Superposition** until the recipient absorbs it onto their own thread—or, upon expiration, the sender reclaims it.

```
SENDER (ALICE):                               RECIPIENT (BOB):
  CAR Register (Slot 2)                          CAR Register (Slot 2)
  [Emit NoteCommitment C]                        [Absorb Note Block]
           │                                              ▲
           │                                              │
           ▼                                              │
 ┌────────────────────────────────────────────────────────┴────────────────────┐
 │                            SUPERPOSITION STATE                              │
 │  • Unspent Note Commitment: C = Commit(payload, ρ, pk_recv)                 │
 │  • Transport: Direct Iroh QUIC (Blind Courier) or Gossip + 1-Byte View-Tag  │
 │  • Active Window: [issuance_epoch .. decay_epoch)                           │
 └────────────────────────────┬────────────────────────────────────────────────┘
                              │
                    decay_epoch elapsed?
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
   [Bob Absorbs Note]               [Alice Reclaims Note]
   • Derive spend nullifier         • Derive reclamation nullifier
     H(sk_spend, ρ)                   H(sk_sender, ρ, decay_epoch)
   • Commit to Nullifier SMT        • Commit to Nullifier SMT
   • Increment Bob Slot 2           • Return funds to Alice Slot 2
```

---

## 2. Blind Note Superposition Mechanics

### 2.1 Note Commitment Derivation
When Alice transfers assets or grants capabilities privately to Bob:
1. Alice samples high-entropy secret blinding randomness $\rho \xleftarrow{\$} \mathbb{F}_q$.
2. Alice encrypts the payload using Bob's public key (or ephemeral Diffie-Hellman secret $S = r \cdot P_{\text{recv}}$).
3. Alice derives the 1-byte view-tag $T = \mathcal{H}_{\text{tag}}(S)[0]$.
4. Alice computes the cryptographic commitment:
   $$C = \text{Poseidon}(\text{DOM\_NOTE}, \text{payload\_digest}, \rho, \text{pk}_{\text{recv}})$$
5. Alice records the note issuance in her local account thread and emits `NoteCommitment { commitment: C, view_tag: T, decay_epoch: E_decay, ... }`.

At this point, Alice's balance in CAR Slot 2 is deducted, but **Bob's register is untouched**. The note floats in superposition across the network.

---

## 3. Collapsing Superposition onto the Recipient Thread

To collapse the note from superposition onto Bob's local thread, Bob produces an `AbsorbNote` lattice block accompanied by a zero-knowledge proof enforcing the **4 Circuit Invariants**:

1. **Accumulator Inclusion**: The commitment $C$ is a valid member of the global historical note commitment accumulator tree.
2. **Correct Nullifier Derivation**: The spend nullifier is correctly derived from Bob's private spending key without revealing either the secret key or the blinding factor $\rho$:
   $$\text{Nullifier}_{\text{spend}} = \text{Poseidon}(\text{DOM\_SPEND\_NULLIFIER}, \text{sk}_{\text{spend}}, \rho)$$
3. **Register Mutation**: The recipient's CAR Slot 2 (Native Payment / Note Balance) is safely incremented by the note's unblinded face value.
4. **Nullifier Publication**: The derived $\text{Nullifier}_{\text{spend}}$ is written into the global consensus Sparse Merkle Tree (SMT). If the nullifier already exists in the SMT, the block is rejected as a double-spend.

Once the block is committed, the note's superposition permanently collapses into Bob's concrete register state.

---

## 4. Stale Notes, Decay Epoch ($E_{\text{decay}}$) & Branching Reclamation

In an asynchronous lattice, the recipient may go offline, lose access, or refuse to absorb a note. Without an expiration mechanism, funds would remain trapped in superposition indefinitely. Sovereign Reth solves this via a **deterministic branching spend condition** governed by `decay_epoch`:

$$\text{Valid Spender} = \begin{cases} \text{Recipient (Bob)}, & \text{epoch} < E_{\text{decay}} \\ \text{Recipient (Bob) } \lor \text{ Sender (Alice)}, & \text{epoch} \ge E_{\text{decay}} \end{cases}$$

### 4.1 Sender Reclamation Nullifier
If $E_{\text{decay}}$ is reached and Bob has not absorbed the note, Alice can execute a clawback by deriving the secondary reclamation nullifier:
$$\text{Nullifier}_{\text{reclaim}} = \text{Poseidon}(\text{DOM\_RECLAIM\_NULLIFIER}, \text{sk}_{\text{sender}}, \rho, E_{\text{decay}})$$

Key properties of this construction:
- **Orthogonality**: $\text{Nullifier}_{\text{reclaim}} \neq \text{Nullifier}_{\text{spend}}$. The sender cannot derive the recipient's spend nullifier, nor can third parties correlate the reclamation nullifier with the original commitment $C$.
- **Race Condition Prevention**: Both nullifiers write to the identical consensus Nullifier SMT. Whichever nullifier commits first consumes the note. Once $\text{Nullifier}_{\text{reclaim}}$ is inserted into the SMT, Bob's late attempt to absorb using $\text{Nullifier}_{\text{spend}}$ will be rejected as spent.
- **Client Autonomy**: The sender triggers reclamation directly through their client wallet (e.g. via `<sovereign-note-inbox>`) without requiring centralized escrow intervention or validator permission.

---

## 5. Account-Lattice Send/Receive Auto-Reclaim at Epoch Boundaries

For non-shielded, public account-lattice transactions (standard `Send` and `Receive` blocks or Saga intents):

1. **Deterministic Trigger:**
   Epochs function as the network's high-frequency reference tick (30–60 seconds). During each epoch finalization (`finalize_epoch`), the `SuperpositionReclaimer` scans the `SuperpositionIndex` for entries where:
   $$\text{created\_at\_epoch} + \text{timeout\_epochs} \le \text{current\_epoch}$$
   *(With $T_{\text{epochs}} = 5\text{ ticks}$, timeouts resolve within ~2.5–5 minutes, ensuring sender funds are never locked for extended periods).*

2. **Non-Blocking Reclaim Block Creation:**
   Instead of locking Alice's account, the network generates a **new Reclaim block** on Alice's account chain:
   - Alice's account remains asynchronous and free to produce subsequent blocks.
   - The expired balance is credited back to Alice.
   - For Saga intents, `SagaActor::rollback()` is triggered, safely reverting cross-chain intent escrows.

3. **Inclusion in Epoch Snapshot:**
   The reclaimed state is finalized in the epoch's Chandy-Lamport snapshot, guaranteeing cryptographic consistency without manual user intervention.
