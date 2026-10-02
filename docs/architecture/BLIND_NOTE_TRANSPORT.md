# Blind Note Transport, Discovery & Peer-to-Peer Privacy

## 1. Overview & Privacy Threat Model

In Sovereign Reth's Account-Lattice, value and capabilities travel as unspent cryptographic commitments in **superposition**. Before a recipient can absorb a note onto their account thread, they must detect that the note exists **without leaking their identity, network address, or transaction history to the network**.

```
SENDER ───────────────────────────────────────────────► RECIPIENT
         ┌──────────────────────────────────────┐
         │       Dual-Path Transport Layer      │
         └──────────────────┬───────────────────┘
                            │
             ┌──────────────┴──────────────┐
             ▼                             ▼
   [Path A: Blind Courier]       [Path B: Public Gossip / DA]
   • Direct Iroh QUIC stream     • Anonymous Note Commitment
   • Zero intermediary hops      • recipient_hint: Address::ZERO
   • End-to-end encrypted        • 1-Byte View-Tag (99.6% rejection)
   • Optimal for known peers     • Asynchronous / Offline recipient
```

Traditional blockchains broadcast unshielded transaction logs or leak receiver hints in network envelopes, allowing network observers and relayers to build behavioral transaction graphs. Sovereign Reth enforces strict zero-knowledge metadata privacy:
- Intermediary relay nodes observe **only opaque 32-byte commitments**, ephemeral public keys, and a single-byte view-tag.
- Intermediary nodes **cannot** determine the sender, recipient, asset type, or transferred quantity.

---

## 2. Dual-Path Routing (`crates/network/src/iroh/blind_note_transport.rs`)

Sovereign Reth implements dual-path transport to balance immediate peer privacy with asynchronous offline delivery:

### Path A: Direct P2P (Blind Courier)
When the recipient is an active peer or known counterparty:
1. The sender initiates an end-to-end encrypted QUIC stream directly to the recipient's Iroh `NodeId` or WireGuard mesh address.
2. The encrypted `BlindNoteMessage` is delivered directly point-to-point (`route_direct_courier()`).
3. **Privacy Invariant:** No third party or intermediary network node ever sees the packet payload, commitment, or routing metadata.

### Path B: Public Gossip / DA Pool with Anonymous Framing
When the recipient is unknown, offline, or asynchronous:
1. The sender constructs an anonymous `BlindNoteMessage` via `BlindNoteMessage::new_anonymous()`:
   - `recipient_hint` is explicitly zeroed (`Address::ZERO`).
   - `commitment`: $C = \text{Commit}(\text{payload}, \rho, \text{pk}_{\text{recv}})$.
   - `ephemeral_pubkey`: $R = r \cdot G$ (ephemeral Diffie-Hellman public key).
   - `view_tag`: $T \in [0, 255]$.
2. The packet is published to a sharded Iroh gossip topic or Data Availability (DA) layer.
3. Network relayers forward the message without any capability to inspect or attribute the intended recipient.

---

## 3. 1-Byte View-Tag Scanning ($99.61\%$ Fast Rejection)

Trial-decrypting every public gossip packet using asymmetric key operations or AEAD ciphers creates a severe client CPU bottleneck and opens an asymmetric denial-of-service vector against mobile/browser wallets.

Sovereign Reth solves this with **1-Byte View-Tag Filtering**:

### 3.1 Tag Derivation (Sender)
1. Sender samples ephemeral secret $r \xleftarrow{\$} \mathbb{F}_q$ and computes public key $R = r \cdot G$.
2. Sender derives shared secret with recipient viewing key $v_{\text{recv}}$:
   $$S = r \cdot P_{\text{recv}} = v_{\text{recv}} \cdot R$$
3. Sender extracts the first byte of the tag hash:
   $$T = \mathcal{H}_{\text{tag}}(S)[0] \in [0, 255]$$
4. Sender attaches $T$ as `view_tag` in the note header.

### 3.2 Tag Scanning (Recipient)
When scanning incoming notes on a gossip topic (`scan_topic_with_view_tag()`):
1. For each incoming note $(R, T, C)$, the recipient computes:
   $$T' = \mathcal{H}_{\text{tag}}(v_{\text{recv}} \cdot R)[0]$$
2. If $T' \neq T$, the note **cannot belong to the recipient**. The note is immediately discarded with 0 allocation and 0 expensive symmetric trial decryption.
3. If $T' == T$, the recipient proceeds to trial-decrypt the encrypted ciphertext using the full derived symmetric key $K = \mathcal{H}_{\text{enc}}(S)$.

### 3.3 Theoretical & Empirical Efficacy
Because $T$ is uniformly distributed across $2^8 = 256$ buckets:
$$\text{Rejection Probability} = \frac{255}{256} \approx 99.61\%$$
The recipient discards over **99.6%** of network gossip traffic with a single fast scalar multiplication, reducing trial decryption operations by $256\times$.

---

## 4. Privacy Invariants & Negative Verification

The privacy boundary is empirically validated in the integration test suite (`crates/network/tests/blind_note_privacy_tests.rs`):

| Invariant | Test Target | Verification Result |
|---|---|---|
| **Zero Recipient Leak** | `test_multi_node_blind_courier_privacy_invariant` | Intermediary nodes inspect packet; `recipient_hint` is strictly `Address::ZERO`. Intermediary fails trial decryption with random key. |
| **99% Fast Rejection** | `test_view_tag_fast_rejection_efficacy_99_percent` | 1,000 randomized notes scanned across 4 distinct accounts. Rejection rate verified $>99.0\%$ ($255/256$). |
| **Superposition Decay** | `test_superposition_decay_and_sender_reclamation_invariant` | Rejection of pre-decay sender reclamation; successful post-$E_{\text{decay}}$ reclamation; permanent nullifier SMT collision prevention. |
