# Sovereign Bunny Web3 & Post-Quantum Browser Wallet

The **Sovereign Bunny Wallet** is a high-performance, offline-first, client-side Web3 application and SDK for the Sovereign Reth Account-Lattice. It is compiled into a single self-contained application (`wallet/app/index.html`) with zero external CDN dependencies, embedding all cryptographic routines, state machines, and web components directly.

---

## 1. Architectural Highlights

### 1.1 Reactive Lit Components
The interface is built with reactive Lit custom elements that communicate via standard DOM events and direct XState actor bindings:
- `<sovereign-note-inbox>`: Scans network gossip for blind notes, executes fast 1-byte view-tag filtering ($T = \mathcal{H}_{\text{tag}}(S)[0]$), handles ephemeral viewing key decryption, triggers note absorption, and enables sender reclamation for expired notes past `decayEpoch`.
- `<sovereign-note-composer>`: Constructs shielded or public note commitments, generates ephemeral keypairs ($R = r \cdot G$), calculates relayer fee hints, and computes Blake3 / Poseidon commitments.
- `<graph-explorer>`: Canvas-rendered interactive Account-Lattice and Zanzibar ReBAC visualizer. Dynamically filters nodes and edges based on the connected account's Zanzibar permissions and viewing keys.
- `<zodiac-dao-panel>`: Manages Gnosis Zodiac Safe modules, proposal queues, ReBAC role evaluations, and decentralized pin requests.
- `<authority-panel>`: Inspects X-Road regulatory anchors, X.509 certificate chains, and jurisdictional court order overrides.
- `<public-explorer>`: Real-time network telemetry, validator committee status, and epoch snapshot tracker.

### 1.2 Deterministic XState v5 State Machines
Application state is strictly governed by hierarchical, finite state machines:
- `NoteInboxMachine`: Governs scanning, viewing key unlock, trial decryption, note absorption, and decay reclamation.
- `NoteComposerMachine`: Governs recipient resolution, asset validation, key agreement, and note publication.
- `WalletMachine`: Governs account locking/unlocking, profile switching, and key derivation.
- `NetworkMachine`: Governs RPC polling, epoch progression, and WebSocket/gRPC failover.
- `AuthorityPanelStateMachine` & `ZodiacMachine`: Governs governance workflows and compliance verification.

### 1.3 Strict Account Isolation (`AccountStorageManager`)
To eliminate cross-account data leakage, browser storage is strictly partitioned:
- All data is scoped under `accounts/<lowercase_address>/`.
- Dedicated sub-namespaces: `notes`, `viewing_keys`, `activitypub`, `txs`.
- **Zero-Leakage Account Switching**: Calling `resetActiveAccountUIContext()` purges all in-memory note tables, viewing keys, and transaction history, forcing immediate DOM re-renders so unauthenticated data is never displayed.

---

## 2. Cryptographic & Privacy Lifecycle

### 2.1 Blind Note Superposition & Absorption
1. **Creation**: The sender constructs a note commitment $C = \text{Commit}(\text{payload}, \rho, \text{pk}_{\text{recv}})$ with a 1-byte view-tag $T$.
2. **Delivery**: Transmitted either directly via point-to-point Iroh QUIC (Blind Courier) or anonymously to the public gossip pool.
3. **1-Byte View-Tag Scanning**: The receiver checks $T = \mathcal{H}_{\text{tag}}(v_{\text{recv}} \cdot R)[0]$, rejecting $\approx 99.61\%$ of non-matching network notes with a single scalar multiplication before attempting symmetric AEAD decryption.
4. **Superposition Collapse**: The recipient derives the client-side spend nullifier $\text{Nullifier} = \mathcal{H}(\text{sk}_{\text{spend}}, \rho)$, increments CAR Slot 2, and commits the nullifier to the consensus SMT.

### 2.2 Stale Note Reclamation
If a note is not absorbed before its designated `decayEpoch`:
- The sender derives the orthogonal reclamation nullifier:
  $$\text{Nullifier}_{\text{reclaim}} = \mathcal{H}(\text{sk}_{\text{sender}}, \rho, E_{\text{decay}})$$
- Clicking **⏳ Reclaim** in `<sovereign-note-inbox>` dispatches the reclaim action, permanently preventing double-absorption and refunding the sender's balance.

---

## 3. Developer Workflows & Commands

All development commands are executed from the `wallet/` directory:

```bash
# 1. Type-check and compile TypeScript SDK
npm run build:ts

# 2. Run all 18 unit & negative test suites
npm run test:unit

# 3. Build single-file production bundle (inlines into app/index.html)
npm run build
```

### 3.1 Unit & Negative Test Suites (`wallet/ts/tests/unit/`)
The test runner covers:
- `account_isolation_negative.test.ts`: Verifies cross-account localStorage partitioning and Zanzibar ReBAC graph isolation.
- `blind_note_negative.test.ts`: Verifies decryption failure with invalid viewing keys, double-spend nullifier rejection, and expired note invariants.
- `graph_explorer.test.ts`, `xroad_authority.test.ts`, `zodiac_machine.test.ts`, `note_lifecycle.test.ts`, etc.

---

## 4. Running Locally

> [!IMPORTANT]
> **EVM Wallet Security Constraint**: Browser extensions (Rabby, MetaMask) require an origin like `http://localhost:8080`. Loading `index.html` directly via `file://` results in an origin of `null`, causing wallet connection rejections.

```bash
# Serve the app directory locally
python3 -m http.server 8080 --directory app/
# Then open http://localhost:8080 in your browser
```
