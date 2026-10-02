# Cryptographic Primitives & ZK Proving Cost Analysis

## 1. Executive Summary

Zero-knowledge circuit proof generation speed is bounded by the algebraic properties of the underlying cryptographic primitives. Specifically, arithmetization in zero-knowledge proof systems (such as Noir's UltraHonk and Barretenberg backend over BN254) imposes dramatic performance penalties on bitwise, non-native cryptographic operations (Keccak-256, SHA-256, secp256k1) relative to algebraic native primitives (Poseidon, BabyJubjub).

This analysis documents the constraint budgets, proving latency benchmarks, hardware constraints (including the target Tesla P100 sm_60 baseline), and architectural recommendations for sovereign-reth circuits and crypto profiles.

---

## 2. Constraint Comparison: Native vs Non-Native Primitives

Noir UltraHonk compiles circuit constraints over the scalar field $\mathbb{F}_r$ of BN254 ($r \approx 2^{254}$). Operations that map directly to field addition and multiplication are cheap ($O(1)$ gates). Operations that require 32-bit/64-bit boolean decomposition, bitwise shifts, and non-native modular reductions require range checks and boolean lookup tables.

| Operation | Primitive | Constraint Count (Barretenberg / UltraHonk) | Relative Cost Multiplier | Provability Grade |
| :--- | :--- | :--- | :--- | :--- |
| **Hash (2-to-1)** | **Poseidon (BN254 native)** | **~240 - 320 constraints** | **1x (Baseline)** | **A+ (Optimal)** |
| Hash (2-to-1) | Rescue-Prime | ~450 - 600 constraints | ~1.8x | A |
| Hash (2-to-1) | SHA-256 | ~28,000 - 35,000 constraints | ~100x | D |
| **Hash (2-to-1)** | **Keccak-256 (EVM)** | **~150,000 - 220,000 constraints** | **~500x - 700x** | **F (Prohibitively expensive)** |
| **Signature Verify** | **BabyJubjub (EdDSA)** | **~3,800 - 4,500 constraints** | **1x (Native Curve)** | **A+ (Optimal)** |
| Signature Verify | Ed25519 (Non-native) | ~40,000 - 55,000 constraints | ~10x | C |
| **Signature Verify** | **ECDSA secp256k1 (EVM)** | **~50,000 - 75,000 constraints** | **~15x** | **D (Avoid in circuits)** |
| Signature Verify | Dilithium / ML-DSA | Not currently feasible in single SNARK | >10,000,000 | Infeasible (Use SGX / Hybrid) |

### Why Keccak-256 is Inexpensive in EVM but Catastrophic in SNARKs

- **EVM (Host CPU)**: Keccak-256 uses 64-bit bitwise rotation, XOR, and bitwise AND instructions available as single-cycle hardware opcodes on x86/ARM CPUs.
- **ZK Circuit ($\mathbb{F}_r$)**: Arithmetic circuits have no hardware bitwise opcodes. Each 64-bit word must be unpacked into individual bits using range checks:
  $$\text{Bit-decomposition of } x \in [0, 2^{64}-1] \implies 64 \text{ binary constraints: } b_i (1 - b_i) = 0 \text{ and } x = \sum 2^i b_i$$
  In Keccak's 24 rounds with 5x5 state arrays, this results in hundreds of thousands of non-linear constraints per 136-byte rate block.

---

## 3. Benchmark Targets: Tesla P100 (sm_60) Proving Budget

The network consensus engine targets an epoch cut frequency of $\le 1.2\text{s}$ per epoch. For validators proving block-lattice execution state transitions on hardware such as the Tesla P100 (16GB HBM2, Pascal microarchitecture, compute capability `sm_60`):

| Circuit Subsystem | Primitives Selected | Total Constraint Budget | UltraHonk Prover Time (P100) | Meets 1.2s Target? |
| :--- | :--- | :--- | :--- | :--- |
| **Account State Transition (CAR)** | Poseidon + BabyJubjub | ~18,000 constraints | **~0.12s** | **YES (10x headroom)** |
| **Zanzibar ReBAC SMT Membership** | Poseidon (depth 32 SMT) | ~10,500 constraints | **~0.08s** | **YES** |
| **Blind Note Spend (AbsorbNote)** | Poseidon Merkle Root + Nullifier | ~14,200 constraints | **~0.10s** | **YES** |
| **Legacy EVM Receipt Proof** | Keccak-256 Merkle Patricia Trie | ~480,000 constraints | **~3.40s** | **FAIL (Breaks epoch deadline)** |

---

## 4. Crypto Profile Strategy

The codebase adapts cryptographic profiles via `crates/crypto/src/lib.rs` to clearly isolate EVM backwards-compatibility from zero-knowledge fast paths:

1. **`NOIR_NATIVE` (`BabyJubjub + Poseidon + BN254 + PoseidonMerkle`)**:
   - Explicitly designed for sub-second recursive client proofs and block-lattice stateless execution.
   - Guaranteed `is_noir_circuit_friendly() == true`.

2. **`IOT_COMPACT` (`Ed25519 + Poseidon + BN254 + PoseidonMerkle`)**:
   - Updated from legacy Keccak to Poseidon state trees to prevent low-power edge nodes from being locked out of proving.

3. **`ETHEREUM` (`Secp256k1 + Keccak256 + Secp256k1 + Verkle`)**:
   - Retained strictly for JSON-RPC `eth_*` compatibility and EVM transaction signature recovery.
   - Circuit execution paths do **not** run Keccak proofs directly; instead, EVM state is executed inside SGXv2 or pre-attested enclaves, preserving network consensus without burdening ZK provers.

---

## 5. Security Invariant: SGX Consensus & Toy Mode Boundary

As demonstrated by security findings:
1. **Network Consensus Over Enclave Output**: A single node's SGX attestation must never be trusted unilaterally for state progression; quorum consensus (Snowman/Avalanche BFT) across the validator committee operates over the attested state roots.
2. **Hardware Protection**: `--toy-mode` (which activates mock SGX via `SOVEREIGN_MOCK_SGX=1`) strictly prohibits activation on machines exposing `/dev/attestation` or `/dev/sgx/enclave`, preventing production validators from inadvertently disabling enclave isolation.
