# Jurisdiction Reveal Protocol & zkCompliance

## 1. Protocol Motivation

Traditional compliance models enforce regulatory policies either via centralized blacklist smart contracts or validator-side transaction censorship. Sovereign Reth eliminates validator censorship by shifting policy enforcement to **cryptographic non-exclusion proofs** while requiring validators to transparently advertise their legal and operational jurisdiction.

---

## 2. Validator Jurisdiction Advertisement

Every validator node publicly publishes an authenticated `JurisdictionDescriptor` on its registered DID document and via Snowman epoch consensus:

```rust
pub struct JurisdictionDescriptor {
    pub manifold_id: u64,
    pub jurisdiction_id: String,        // e.g. "EU_MICA", "US_REG_D", "CH_FINMA"
    pub enforcing_q1_mask: u64,          // Quadrant 1 mask of enforced regulations
    pub vector_smt_root: B256,           // SMT commitment to the active compliance list
    pub epoch: u64,
    pub validator_signature: Vec<u8>,
}
```

Clients query this descriptor via the low-entropy RPC endpoint:
`sovereign_getJurisdictionDescriptor`

---

## 3. Client Verification Paths

```
                             [Client Application]
                                      │
                 Queries Validator's JurisdictionDescriptor
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
        [Path A: Hardware SGX]                [Path B: zkCompliance]
     • Sends witness to validator         • Fetches compliance SMT root
     • Validator checks bitmask in TEE    • Generates Noir non-inclusion proof
     • Returns DCAP Attestation Quote     • Submits ComplianceExclusionProof
                   │                                     │
                   └──────────────────┬──────────────────┘
                                      ▼
                      [Stateless Validator Ingestion]
                      • Verifies Proof / Quote Only
                      • Accepts Transaction into Block
```

### Path A: Validator SGX Attestation
For standard EVM wallets without local proving hardware:
1. The client sends transaction witness data to the validator.
2. The validator executes the compliance check inside an SGXv2 enclave.
3. The enclave generates a DCAP hardware attestation confirming the check passed.

### Path B: Client-Side zkCompliance (Noir Circuit)
For zero-trust clients:
1. The client retrieves the validator's `vector_smt_root` for the active epoch.
2. The client compiles an exclusion witness proving:
   $$\text{Poseidon}(\text{account\_address}) \notin \text{Tree}(\text{vector\_smt\_root})$$
3. The client submits the ~260-byte Groth16 proof alongside the transaction.
4. The validator verifies the ZK proof mathematically without querying external identity databases or inspecting private account metadata.

---

## 4. Anti-Front-Running Epoch Hold Guard

When a jurisdiction updates its enforcement list (`ComplianceDelta`), added addresses enter a mandatory `ComplianceDeltaHold` state:
- The delta is frozen until the subsequent epoch boundary ($E_{N+1}$) Chandy-Lamport snapshot.
- Transactions from newly added addresses are held, preventing malicious front-running before the new SMT root is globally finalized.

---

## 5. Zanzibar ReBAC Viewing Key Governance & Auditability

To reconcile sovereign individual privacy with regulatory and institutional audit compliance, Sovereign Reth decouples **Spending Capability** from **Viewing Capability** using Ephemeral Viewing Keys governed by Zanzibar ReBAC tuples (`crates/consensus/src/lattice/viewing_key.rs`):

```
                   [ CAR Register: Slot 1 Zanzibar SMT ]
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
[ Tuple: #can_view ]                              [ Tuple: #court_order_override ]
• Delegated Auditor / Tax authority               • X-Road Authority / Court Order
• Read-Only ephemeral viewing key                 • Threshold DAO / Multivendor reveal
• ZERO spending capability (sk_spend safe)        • Time-bounded jurisdictional audit
```

### 5.1 Decoupled Cryptographic Capabilities
- **Spending Key ($\text{sk}_{\text{spend}}$)**: Stays strictly within the user's isolated hardware enclave / browser storage (`accounts/<address>/`). Required to derive spend nullifiers and absorb notes.
- **Viewing Key ($v_{\text{recv}}$)**: Derived from the recipient's secret scalar. Allows decrypting encrypted note payloads and calculating 1-byte view-tags without enabling balance mutation or note spending.

### 5.2 Zanzibar Relationship-Based Access Control (CAR Slot 1)
Relationships are declared as canonical ReBAC tuples evaluated in sub-microsecond in-memory passes:
```text
account:0xAlice#owner@user:0xAlice
account:0xAlice#can_view@user:0xAuditorBob
account:0xAlice#court_order_override@authority:0xAuthorityEstFinma
```

1. **Selective Auditor Disclosure**: Alice can share an ephemeral viewing key with an auditor by inserting a `#can_view` tuple into CAR Slot 1.
2. **Authority Court Order Escalation**: Regulatory trust anchors registered in CAR Slot 5 (`XRoadDescriptor`) can submit cryptographic court order proofs (`CourtOrderDescriptor`) to unlock view keys under jurisdictional mandates.
3. **Graph Explorer Dynamic Gating**: The frontend `<graph-explorer>` and `<sovereign-note-inbox>` inspect these ReBAC tuples at runtime, dynamically withholding shielded notes and private relations from unauthorized viewers while rendering approved audit traces.

