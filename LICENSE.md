# Sovereign Software Licensing Architecture

## 1. Principles & Vision

The Sovereign project is engineered as an open, resilient, post-quantum decentralized infrastructure. Our licensing strategy balances two core mandates:

1. **The Core Logic Must Always Remain Free and Open Source (Copyleft Invariant)**:
   The consensus engine, stateless execution kernel, zero-knowledge circuits, hardware attestation pipeline, and validator node software must forever remain open source. No proprietary vendor or centralized organization may enclose or monopolize the core ledger.

2. **Commercial Business Viability & Frictionless Enterprise Integration (LGPLv2.1 Linking)**:
   Commercial enterprises, corporate DAOs, and proprietary applications must be able to link against Sovereign client SDKs, cryptographic libraries, and network interfaces to run commercial business operations without being forced to open source their proprietary business logic, proprietary ERP software, or private intellectual property.

---

## 2. Tiered Licensing Architecture

To fulfill both mandates, the Sovereign codebase adopts a tiered open-source licensing structure:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SOVEREIGN SOFTWARE LICENSING MODEL                   │
├────────────────────────────────────────────────────────────────────────┤
│ TIER I: Core Protocol & Node Daemon (GNU GPL v3.0 only)                │
│  - crates/node (sovereign-bunny, did-tool)                             │
│  - crates/consensus (Snow consensus, Account-Lattice, MVSK kernel)    │
│  - crates/attestation (Intel SGX DCAP quote verification)              │
│  - crates/identity & identity_server (W3C DID, SIWE, Zanzibar ReBAC)   │
│  - circuits/ (Noir ZK circuits: eIDAS, PID nullifiers, voting)         │
│  - contracts/ (Solidity system precompiles, Paymaster contracts)       │
│                                                                        │
│ Invariant: Core ledger logic is strictly copylefted under GPLv3. Any   │
│ modification or derivative fork of the core validator MUST be open.   │
├────────────────────────────────────────────────────────────────────────┤
│ TIER II: Client SDKs, Cryptography & Interfaces (GNU LGPL v2.1 only)   │
│  - crates/crypto (Post-quantum envelopes, ML-DSA, ML-KEM, Secp256k1)   │
│  - crates/network (P2P wire protocol, WireGuard transport adapters)    │
│  - crates/sovereign-ssz (Fast SSZ serialization primitives)            │
│  - crates/koral-verify (Supply chain attestation & SBOM verification)  │
│  - wallet/ (@sovereign/wallet-sdk TypeScript & WASM bindings)          │
│                                                                        │
│ Invariant: Strictly LGPLv2.1 (no subsequent versions apply).           │
│ Proprietary & commercial business software can dynamically link        │
│ against these libraries without copyleft contagion. Any modifications  │
│ directly made to these libraries must remain open source under LGPL2.1.│
├────────────────────────────────────────────────────────────────────────┤
│ TIER III: Whitebooklet, Specifications & Documentation (CC-BY-SA 4.0)  │
│  - docs/booklet/ (Sovereign Whitebooklet LaTeX source & PDF output)    │
│  - docs/architecture/ (Technical doctrine & protocol specifications)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Commercial Guidelines for Enterprises and Integrators

### Running Commercial Operations
You are fully permitted to:
- Operate commercial validators, nodes, and gateways running Sovereign software.
- Build proprietary software (e.g., enterprise ERPs, private financial dashboards, confidential analytics) that links against the Sovereign client libraries (`@sovereign/wallet-sdk`, `crates/crypto`, `crates/network`) under LGPL v2.1.
- Offer commercial services, APIs, and custodial or non-custodial tooling built upon the Sovereign network.

### Obligations
- If you modify the core node or consensus software (`GPL-3.0`), you must distribute those modifications under the GPL-3.0 when conveying the binary to others.
- If you modify any LGPL-licensed library (`LGPL-2.1`), you must make the source code of those library modifications available under the LGPL-2.1.
- Your proprietary applications that simply call, link, or interact through LGPL interfaces do NOT need to open-source their private application logic.

---

## 4. License Files

- **GNU General Public License v3.0**: See [COPYING](COPYING).
- **GNU Lesser General Public License v2.1**: See [COPYING.LESSER](COPYING.LESSER).
