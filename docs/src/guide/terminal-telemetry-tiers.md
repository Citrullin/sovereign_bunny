# Terminal Telemetry Tiers & Proof of State Lineage

## 1. Executive Summary

Financial terminals, market makers, and institutional observers require high-throughput data streams with verifiable authenticity. Conventional Web3 systems either force all data on-chain (paying exorbitant gas fees and thrashing global state) or rely on trusted off-chain aggregators vulnerable to spoofing, front-running, and Garbage-In, Value-Out (GIVO) attacks.

**Sovereign-Reth** resolves this via **Terminal Data Tiers** and client-side **Proof of State Lineage** (`circuits/state_lineage_telemetry.nr` and `crates/consensus/src/lattice/telemetry.rs`).

---

## 2. Telemetry Tiers

Every account participating in market routing or terminal data feeds selects an emission tier:

| Tier | Network Emission | Fee Multiplier | Cryptographic Guarantees |
| :--- | :--- | :--- | :--- |
| **1. Subsidized** | Verified sanitized delta stream (no DID, IP, or head commitment) | `10 bps` (0.1x) | Verified on-chain state lineage proof with zero metadata leakage. Subsidized by protocol public-goods allocation. |
| **2. Quantized** | Bucketed values + differential privacy noise + batch delay | `100 bps` (1.0x baseline) | Zero-knowledge bucket-membership proof; optimal balance between anonymity and analytical utility. |
| **3. Sovereign Dark** | **Zero emission** (strictly receive-only) | `500 bps` (5.0x max fee) | Complete privacy. No telemetry packets are emitted to the mesh or RPC under any circumstances. |

---

## 3. Proof of State Lineage (Anti-GIVO)

To prevent actors from injecting fabricated trades, fake volume, or synthetic liquidity into terminal feeds, emitted telemetry must carry a zero-knowledge Proof of State Lineage:

$$\mathcal{R}_{\text{settled}} \longrightarrow \text{tip\_hash} \longrightarrow \text{state\_root} \longrightarrow \text{leaf\_query}$$

The circuit enforces:
1. **State Inclusion**: Proves the reported volume and transaction leaf exist in a verified historical state root finalized at an epoch checkpoint.
2. **Deterministic Epoch Nullifier**:
   $$\text{Nullifier} = \text{Blake3}(\text{"sovereign:telemetry\_nullifier:v1:"}, \text{account}, \text{epoch}, \text{tip\_hash})$$
   Aggregators and peer nodes reject repeated nullifiers within an epoch, making synthetic volume duplication cryptographically impossible.
3. **Strict Tier Enforcement**: Sovereign Dark accounts are constrained at the circuit level (`assert(telemetry_tier != 2)`), guaranteeing zero inadvertent data leaks.
