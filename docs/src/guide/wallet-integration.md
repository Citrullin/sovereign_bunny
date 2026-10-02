# Wallet Integration & Client SDK

The Sovereign Bunny Wallet is a client-side SDK and reactive web application that runs in the browser, handling all signing, DID registration, blind note cryptography, and lattice block construction client-side. No private key material ever leaves the browser.

---

## 1. Building the Wallet

From the `wallet/` directory:

```sh
cd wallet/
npm run build:ts   # Compile TypeScript SDK
npm run test:unit  # Run all 18 unit and negative test suites
npm run build      # Bundle single-file index.html and assets into wallet/app/
```

The output in `wallet/app/` is a self-contained static site with zero external CDN dependencies.

---

## 2. Integration Modes

### Mode 1: Legacy (MetaMask / Rabby Compatible)
Transactions are submitted as standard `eth_sendRawTransaction` JSON-RPC calls. When quantum wrapping is enabled, the inner post-quantum signed payload is encapsulated in an EIP-8141 multi-frame envelope signed by the user's classical secp256k1 key—existing hardware wallets (Ledger, Trezor) sign the outer envelope without protocol changes.

### Mode 2: Native (CAIP-25 / gRPC)
`StatelessTransitionFrame` messages with native PQ signatures and UltraHonk SNARK witnesses are transmitted directly via gRPC over HTTP/3, achieving ~70% lower packet overhead than JSON-RPC.

---

## 3. Account Identity & DID Registration

1. The wallet generates a secp256k1 keypair and optional ML-DSA-65 / Falcon post-quantum keypairs.
2. Constructs a W3C DID document with URI `did:sovereign:[chain_id]:[address]`.
3. Encodes the registration as a `ContractCall` lattice block targeting the DID registry precompile (`0x0000000000000000000000000000000000000003`).
4. Signs with the classical key (or PQ key if quantum mode active) and submits to consensus.
5. Once the DID block is committed, the account is registered with CAR Slot 0 initialized.

---

## 4. Blind Notes, Superposition & Ephemeral Viewing Keys

Sovereign Reth replaces direct address transfers with privacy-preserving **Blind Notes**:

### 4.1 Creating a Note Commitment
```typescript
import { deriveViewTag, createNoteCommitment } from '@sovereign/wallet-sdk';

// 1. Generate ephemeral secret and derive 1-byte view tag
const ephemeralPriv = randomScalar();
const ephemeralPub = derivePublicKey(ephemeralPriv);
const sharedSecret = computeSharedSecret(ephemeralPriv, recipientViewKey);
const viewTag = deriveViewTag(sharedSecret);

// 2. Commit note with decay epoch
const commitment = createNoteCommitment({
    payloadDigest,
    rho: randomBlindingFactor(),
    recipientPubkey: recipientAddress,
    viewTag,
    decayEpoch: currentEpoch + 50n
});
```

### 4.2 Scanning with 1-Byte View-Tags
Rather than trial-decrypting every gossip packet, the client scans the topic with its viewing key:
```typescript
// Discards ~99.61% of unrelated network packets with 1 cheap scalar check
const matches = deriveViewTag(computeSharedSecret(viewingKey, note.ephemeralPubkey)) === note.viewTag;
if (matches) {
    // Proceed to trial AEAD decryption
    const decrypted = decryptPayload(note.ciphertext, sharedSecret);
}
```

### 4.3 Collapsing Superposition (Absorb Note)
The recipient spends the note by deriving the unspent nullifier and appending an `AbsorbNote` block:
```typescript
import { deriveNullifier } from '@sovereign/wallet-sdk';

const nullifier = deriveNullifier(spendKey, note.rho);
await client.absorbNote({
    nullifier,
    commitment: note.commitment,
    targetSlot: 2 // Increment Native Payment CAR register
});
```

### 4.4 Stale Note Reclamation
If a note remains unspent when `currentEpoch >= note.decayEpoch`, the sender derives the orthogonal reclamation nullifier and reclaims the funds:
```typescript
import { deriveReclamationNullifier } from '@sovereign/wallet-sdk';

const reclaimNullifier = deriveReclamationNullifier(senderSpendKey, note.rho, note.decayEpoch);
await client.reclaimNote({
    nullifier: reclaimNullifier,
    commitment: note.commitment
});
```

---

## 5. Lit Web Components & UI Embeds

The SDK provides plug-and-play reactive web components:

```html
<!-- Note Inbox with view-tag scanning and decay reclamation -->
<sovereign-note-inbox
    rpc-url="http://localhost:8545"
    address="0x..."
    viewing-key="0x..."
></sovereign-note-inbox>

<!-- Note Composer for public and shielded transfers -->
<sovereign-note-composer
    rpc-url="http://localhost:8545"
    sender="0x..."
></sovereign-note-composer>

<!-- Interactive Account-Lattice and Zanzibar ReBAC Visualizer -->
<graph-explorer
    rpc-url="http://localhost:8545"
    active-account="0x..."
></graph-explorer>
```

---

## 6. Storage Scoping & Cross-Account Isolation

All client state is strictly isolated via `AccountStorageManager`:
- Namespaced key format: `accounts/<address>/[notes | viewing_keys | activitypub | txs]`.
- Calling `resetActiveAccountUIContext()` purges all active memory buffers and forces immediate DOM re-renders, preventing data leakage across account switches.
