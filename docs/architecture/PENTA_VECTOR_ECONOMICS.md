# The Penta-Vector Emission Model, Slashing Matrix & VFS Storage Economics

> [!WARNING]
> **Architectural Reconciliation Notice (Sovereign Whitebooklet v0.4 Alignment)**:
> The initial conceptual framing of a synthetic 100% inflationary token emission pool and fee burning ("deflationary value accrual") in this draft is **formally deprecated** in favor of the production economic doctrine established in **"Sovereign Bunny: Collaborative Acceleration (co/acc)"** (§4, `docs/booklet/sovereign-booklet.tex`):
> 1. **Zero Inflationary Minting ($\Delta M = \Delta Y$)**: Money is strictly an accounting invariant of verified physical output and productive debt clearance. Validators and operators are compensated via **fee-funded revenue splits** (Operator Pool, Commons Fund, Mutual Insurance Reserve), NOT unbacked inflationary token emissions.
> 2. **Commercial Bank Money Tokens (CBMT) & Eurosystem Pontes**: Liquidity is endogenously created as commercial bank deposits (CBMT) matching industrial invoices committed in CAR Slot 4, clearing wholesale in Central Bank Money (CeBM) over Eurosystem Pontes (TARGET2 / TIPS).
> 3. **Capital-Backed Bonds vs. Unbacked Reputation**: Slashing forfeits capital-backed bonds held in escrow in settlement units (EUR / CBMT), while subjective AI merit and social outreach affect non-financialized reputation only.
> 4. **Storage Endowment vs. Decaying Burn**: Permanent storage is funded via an Arweave-style conservative endowment model rather than burned tokens with decaying credits.

## 1. Historical Context: The Penta-Vector Conceptual Model

```
                    ┌─────────────────────────────────────────────────┐
                    │      GLOBAL EPOCH EMISSION POOL (100% MAX)      │
                    └────────────────────────┬────────────────────────┘
                                             │
      ┌─────────────────┬────────────────────┼───────────────────┬─────────────────┐
      ▼ (Max 20%)       ▼ (Max 20%)          ▼ (Max 20%)         ▼ (Max 20%)       ▼ (Max 20%)
┌──────────────┐ ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  EXECUTION   │ │ MESH & EPOCH │    │  ZK STORAGE  │    │   AI MERIT   │    │  WORK, CODE  │
│  & ENCLAVES  │ │  CONSENSUS   │    │  (Iroh/PoR)  │    │  ASSESSMENT  │    │  & ECOSYSTEM │
└──────────────┘ └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
  • revm / SGX     • Paxos sub-cmte   • Bao spot-checks   • Agent quorums     • Git/Radicle
  • E3 Ciphernodes • Snowman meta     • Cold CAR hosts    • Output grading    • RFC benchmarks
  • Intent solves  • 400G BGP mesh    • Micro-escrows     • Fraud audits      • Core tooling

       Unallocated / Failed Quota in Any Vector ──► [ BURNED AT EPOCH CUT ]
```

---

## 2. Multi-Vector Incentive & Slashing Matrix

| Vector (Max 20%) | Measurement & Verification Primitive | Payout Mechanism | Smart Slashing & Penalty Conditions |
|---|---|---|---|
| **1. Execution & TEE (revm / E3)** | $O(1)$ state-diff proofs, SGXv2 remote attestations, E3 threshold decrypt receipts. | Gas splits + synthetic emission credits per successful intent transition. | **Enclave Equivocation:** Slashing of full validator bond if signing dual roots; zero payout on TEE attestation revocation. |
| **2. Mesh Routing & Epoch Consensus** | Signed BFT epoch markers (`sys.epoch-markers`), BGP packet forwarding telemetry. | Distributed proportionally across active Paxos sub-committees and Snowman sampling nodes. | **Liveness / Drop Faults:** Slashing for silent timeouts during $k$-round Paxos; BGP blackholing leads to route revocation and stake slashing. |
| **3. ZK-PoR Storage & DA** | Random deterministic spot-check proofs (Bao/BLAKE3 outboard slices) in Noir circuits. | Continuous micro-escrow releases from low-entropy address `0x0000000000000000000000000000000000000053`. | **Data Withholding:** Progressive geometric slashing ($2^n \times \text{Base}$) for each failed/missed epoch challenge until complete eviction. |
| **4. Autonomous AI Agent Merit** | Multi-agent zero-knowledge evaluation circuits verifying task delivery metrics. | Distributed to agents and reviewers submitting verified evaluation receipts. | **Hallucination / Collusion:** Consensus-of-Agents outlier detection. Disputed assessments result in collateral slashing for malicious agent keys. |
| **5. Core Work, Code & RFCs** | Signed commits to Radicle/Git trees, merged `INT-*` standards, benchmark deliveries. | Milestone-based DAO escrow payouts ratified by $2f+1$ DIF governance quorums. | **Malicious Submissions:** Revocation of contributor credential; blacklisting from community nullifier tree. |

---

## 3. Deflationary Storage Economics & Kryder's Law Scaling

Physical storage density naturally increases over time (Kryder's Law), making byte storage cheaper every year. The network economics mirror this physical reality:

```
[ User Uploads Data ] ──► Burns Storage Fee in Token (Burns Base Token Supply)
                                    │
                                    ▼
              ┌───────────────────────────────────────────┐
              │          TIERED STORAGE LIFECYCLE         │
              │                                           │
              │  HOT (RAM / NVMe SSD)                     │
              │  • Fast retrieval, sub-microsecond access │
              │  • Priced in high-frequency gas           │
              │                                           │
              │  WARM (Iroh / Local IPLD Nodes)           │
              │  • General CMS, media, recent post blocks │
              │  • 18-day DA window                       │
              │                                           │
              │  COLD (Encrypted CAR Blobs / Tape / S3)   │
              │  • Historical Account-Lattice snapshots   │
              │  • Deflationary rent model (costs ↓/yr)   │
              └─────────────────────┬─────────────────────┘
                                    │
                                    ▼
       [ Periodic Noir Spot-Check ] ──► Mint Micro-Yield to Storage Host
```

### A. Burn-and-Decay Curve
Users prepay storage rent by burning base tokens. The protocol locks an internal credit ($C$) that decays at a predictable rate:

$$C(t) = C_0 \cdot e^{-\lambda t}$$

where $\lambda$ reflects the technological cost reduction of hardware over time according to Kryder's Law.

### B. Cold Storage Invariant
Node operators never pay for unverified hosting. The host only earns yield while submitting valid $O(1)$ Noir Proof-of-Retrievability (PoR) proofs for deterministic pseudo-random challenges seeded by the epoch state root.

---

## 4. Backend-Agnostic Storage Interface (VFS)

The consensus layer does not care where bytes physically reside—whether in a local NVMe array, Ceph cluster, MinIO S3 bucket, Iroh P2P mesh, or tape archival system. It only validates the Merkle Bao Outboard Slice against the committed CID.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ABSTRACT STORAGE DRIVER INTERFACE                      │
│                                                                             │
│  trait LatticeStorageBackend:                                               │
│      fn pin_raw_blob(data: &[u8]) -> CID32                                  │
│      fn fetch_chunk(cid: CID32, chunk_index: u64) -> Bytes                  │
│      fn generate_por_slice(cid: CID32, challenge_seed: [u8; 32]) -> BaoProof│
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
   [ Driver: Iroh P2P ]       [ Driver: Local NVMe ]     [ Driver: S3 / Ceph ]
```

### Canonical WASI Storage Trait (`storage-engine.wit`)

```wit
package bunny:storage-engine@0.1.0;

interface vfs {
    record blob-handle {
        cid: list<u8>,
        total-chunks: u64,
        outboard-root: list<u8>,
    }

    record challenge-request {
        cid: list<u8>,
        epoch-randomness: list<u8>,
        sector-index: u32,
    }

    record challenge-response {
        cid: list<u8>,
        chunk-data: list<u8>,
        bao-merkle-path: list<list<u8>>,
        ultra-honk-proof: list<u8>,
    }

    /// Stores a payload using whichever backend the node operator configures.
    store-blob: func(payload: list<u8>) -> result<blob-handle, string>;

    /// Generates a stateless proof of retrievability for an epoch challenge.
    prove-challenge: func(req: challenge-request) -> result<challenge-response, string>;

    /// Verifies the challenge response statelessly in RAM in <1ms.
    verify-response: func(res: challenge-response, expected-root: list<u8>) -> bool;
}

world storage-node {
    export vfs;
}
```

This guarantees **full modularity**: a node operator can swap a local NVMe drive for an enterprise object store (S3, Ceph, MinIO) without altering transaction schemas, Iggy streams, or consensus verification logic.
