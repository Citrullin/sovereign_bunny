# Zero-Knowledge OpenID Connect (zkOIDC) Architecture

## 0. The Core Question: Do You Still Need a Server?

**Yes. You always need a server that understands the authentication protocol.**

zkOIDC does not eliminate the identity server — it eliminates the *centralized identity
database* that maps real-world identities to on-chain addresses.

**Architectural separation (critical):**
- `bunny-gateway` — pure routing/ingress. Routes traffic to the cluster. It is NOT an
  identity server. Does not verify OIDC tokens. Does not issue JWTs.
- `sovereign-siwe-oidc` — the dedicated identity server. A fork of SpruceID's `siwe-oidc`
  that speaks standard OIDC to any relying party (Nextcloud, Gitea, Authentik) and verifies
  the user's wallet proof as the authentication step.

Flow: User → `sovereign-siwe-oidc` (auth) → `bunny-gateway` (routing) → cluster.

SpruceID's `siwe-oidc` is exactly the right model: a standards-compliant OIDC IdP that
accepts Ethereum wallet signatures instead of passwords. Every service that speaks OIDC works
with it unchanged. We fork it and add a ZK proof verification path alongside the classic SIWE
path — the OIDC surface is identical.

---

## 1. Architecture Comparison

### A. siwe-oidc (SpruceID) — What It Actually Does

```
Service (Relying Party)     siwe-oidc server            User's Browser
       │                          │                           │
       │── OIDC /authorize ───────►                           │
       │                          │── Login nonce ────────────►
       │                          │                     Signs SIWE msg
       │                          │◄── SIWE signature ────────│
       │                          │  ecrecover(sig) == address
       │                          │  No email DB. address IS identity.
       │◄── OIDC ID Token ────────│                           │
       │   (sub = "0x1234...")    │                           │
```

Key: the siwe-oidc server is **stateless per user** — no `email → address` DB. Works with
any EVM wallet today (MetaMask, Rabby, hardware wallets).

### B. sovereign-siwe-oidc zkOIDC — Same Protocol Surface, Extended Backend

```
Service (Relying Party)  sovereign-siwe-oidc          bunny-gateway    Cluster
       │                       │                           │               │
       │── OIDC /authorize ────►                           │               │
       │  (identical OIDC)     │── Challenge ──────────────►               │
       │                       │          Path A: Sign SIWE (any EVM wallet)
       │                       │          Path B: Generate Noir proof (ZK)  
       │                       │          Path C: PQ-over-ZK witness        
       │                       │◄── Envelope (CBOR) ───────│               │
       │                       │  Verifies, issues OIDC JWT                 │
       │◄── OIDC ID Token ─────│                           │               │
       │                       │─────── Authenticated request ─────────────►
```

The relying party (Nextcloud, Gitea) is **unchanged**. `bunny-gateway` only routes;
all identity verification happens inside `sovereign-siwe-oidc`.

---

## 2. The Fork Plan: siwe-oidc → sovereign-siwe-oidc

Fork `github.com/spruceid/siwe-oidc` (Rust), keep the entire OIDC surface identical,
add ZK and PQ-over-ZK verification paths.

**Deployment:** `sovereign-siwe-oidc` runs as a separate process alongside the node.
`bunny-gateway` routes OIDC traffic to it; all identity logic stays inside it.

```
crates/identity_server/src/
├── oidc/
│   ├── provider.rs          # OIDC IdP: /authorize, /token, /userinfo, /.well-known
│   ├── siwe_verifier.rs     # Path A: classic SIWE ecrecover (forked from siwe-oidc)
│   ├── zk_verifier.rs       # Path B: Noir UltraHonk proof verifier (<1ms)
│   └── pq_zk_verifier.rs   # Path C: PQ-over-ZK witness (NOT raw PQ sig; see §3)
├── session/
│   ├── ephemeral_key.rs     # Per-session ephemeral key cache (in-memory, 24h TTL)
│   └── paymaster.rs         # Valid session → native gas sponsorship
└── jwks/
    └── cache.rs             # JWKS: IdP pubkey hashes committed to Lattice State Root
```

**Changes from siwe-oidc upstream:**
1. `zk_verifier.rs` — verifies `ZkOidcAuthEnvelope` (Noir UltraHonk proof).
2. `pq_zk_verifier.rs` — verifies a ZK proof *of* a PQ signature, not the raw PQ bytes.
3. `sub` claim = blinded Poseidon pseudonym (ZK/PQ-ZK paths) or raw address (SIWE path).
4. Paymaster integration — valid session unlocks native gas sponsorship.

**Unchanged from siwe-oidc:**
- `/authorize`, `/token`, `/userinfo`, `/.well-known/openid-configuration`.
- OIDC JWT format issued to relying parties. Any relying party config is unchanged.

---

## 3. PQ Signatures Over the Wire: Compress with ZK, Not Raw Bytes

**The problem with raw PQ signatures on a ledger:**
- ML-DSA signatures are ~2.4 KB.
- SLH-DSA signatures are 7–40 KB.
- Falcon is ~690 B (smallest), but still large at scale.
- Broadcasting raw PQ signatures on every note commitment would destroy throughput.

**The solution: prove the PQ signature in a ZK circuit; transmit only the proof.**

Since we already do blind note passing — the payload is off-chain, only the note
commitment (32 bytes) and a proof go on-ledger — we extend this naturally:

```
[ User node ]
  1. Computes ML-DSA signature locally over the note commitment.
  2. Runs a Noir circuit: proves the ML-DSA signature is valid over the commitment.
     Public inputs:  note_commitment (B256), account_pubkey_hash (B256)
     Private inputs: raw ML-DSA signature (~2.4 KB), ml_dsa_pubkey
     Output:         UltraHonk proof (~200B)
  3. Transmits: note_commitment (32B) + ZK proof (~200B) = ~232B total.
     The 2.4 KB ML-DSA signature never touches the ledger.

[ Ledger / verifier ]
  4. Verifies the ~200B UltraHonk proof against the public inputs.
  5. Absorbs the note, advances the account frontier.
```

This applies uniformly across all PQ profiles:
- `quantum_standard` (ML-DSA) → ML-DSA-in-ZK
- `iot_compact` (Falcon) → Falcon-in-ZK
- `quantum_hardened` (SLH-DSA) → SLH-DSA-in-ZK (most expensive to prove; offline batch)

For the OIDC path (`pq_zk_verifier.rs`), the same applies: instead of submitting a raw
ML-DSA signature to `sovereign-siwe-oidc`, the wallet generates a ZK proof that it holds
a valid PQ signing key. The server verifies the ~200B proof, never receiving the raw 2.4 KB
PQ signature.

New file: `crates/consensus/src/pq_ingress.rs`

```rust
/// Wire-stripped PQ witness: ZK proof of a PQ signature, not the raw signature.
pub struct PqWitnessEnvelope {
    /// Which PQ scheme the private input uses.
    pub scheme: PqScheme,
    /// The UltraHonk proof (~200B) that the PQ signature is valid.
    pub zk_proof: Vec<u8>,
    /// Public inputs: note commitment + account pubkey hash.
    pub note_commitment: B256,
    pub account_pubkey_hash: B256,
    /// Epoch at which this proof was generated (replay window: ±1 epoch).
    pub issuance_epoch: u64,
}

pub enum PqScheme {
    MlDsa44,   // NIST Level II (~2.4 KB raw → ~200B ZK)
    Falcon512, // NIST Level I  (~690B  raw → ~200B ZK)
    SlhDsaS,   // NIST Level I  (~7 KB  raw → ~200B ZK; proof generation is slow)
}
```

**Smart Account compatibility (ERC-4337 / Zodiac):**
The ZK proof satisfies the `validateUserOp` interface in ERC-4337 Smart Accounts because:
- The `userOpHash` is the note commitment (B256).
- `validateUserOp` returns success if the UltraHonk proof verifies.
- The Zodiac Roles Modifier checks the Zanzibar tuple authorizing the action independently.
Classic ECDSA wallets still work on Path A (raw SIWE). PQ wallets use Path C (ZK-of-PQ).
All paths are transparent to ERC-4337 paymasters and Zodiac guards.


### Setup (operator, one-time)
Configure Nextcloud's OIDC plugin to point at `bunny-gateway` — identical to configuring
`siwe-oidc`:
```
OIDC Discovery URL: https://gateway.sovereign.local/.well-known/openid-configuration
Client ID:          nextcloud
Client Secret:      (standard OIDC client credentials)
```

### Path A — Classic SIWE (any EVM wallet, works today)

```
1. User clicks "Login with Ethereum" in Nextcloud
2. Nextcloud → redirect → bunny-gateway /authorize?client_id=nextcloud&nonce=abc123
3. bunny-gateway shows SIWE challenge:
   "Sign in to nextcloud.sovereign.local | Nonce: abc123"
4. User signs with MetaMask / Rabby / any EVM wallet
5. bunny-gateway:
   a. ecrecover(sig) → 0x1234...
   b. Checks DID Slot 0 for 0x1234... (account exists on lattice)
   c. Issues OIDC JWT: { sub: "0x1234...", iss: "gateway.sovereign.local" }
6. Nextcloud logs in user as "0x1234..." ✓
```

No ZK, no new tooling, identical to siwe-oidc. **Works on day one.**

### Path B — ZK Privacy Mode (opt-in, app-specific pseudonyms)

```
1. Same: Nextcloud → redirect → bunny-gateway
2. User clicks "Privacy Mode" toggle on the login page
3. Browser wallet generates ephemeral Ed25519 session key locally
4. User signs into Google (OAuth2) → browser receives JWT locally
5. Browser WASM (Barretenberg) runs zk_oidc.nr:
   Private:  jwt_payload, jwt_sig, user_sub, salt   ← never leave device
   Public:   idp_pubkey, app_id="nextcloud", derived_account_id, ephemeral_key
   Output:   UltraHonk proof (~200ms WASM, <1ms gateway verify)
   Account:  Poseidon(sub, "nextcloud", salt) ← different for every app
6. Browser sends ZkOidcAuthEnvelope (CBOR) to bunny-gateway
7. bunny-gateway:
   a. Verifies Noir proof (<1ms, stateless, no DB)
   b. Checks idp_pubkey is in JWKS cache committed to Lattice State Root
   c. Issues OIDC JWT: { sub: "0xd3ad...", iss: "gateway.sovereign.local" }
8. Nextcloud logs in user as "0xd3ad..." ✓
   Same pseudonym every time for nextcloud.
   Completely different from their GitHub pseudonym.
   Google cannot see this login happened.
   bunny-gateway cannot link this session to any other app.
```

**From Nextcloud's perspective: identical to Path A.**

### Path C — PQ Signatures (quantum_standard profile accounts)

Same as Path A but signing uses ML-DSA instead of ECDSA. `pq_verifier.rs` handles it.
The OIDC JWT issued is identical. Nextcloud doesn't know or care.

## 4. End-to-End Use Case: Logging into Nextcloud

| Property | Traditional OIDC Server | siwe-oidc | bunny-gateway (ZK path) |
|---|---|---|---|
| Stores `email → address` DB | ✅ Yes | ❌ No | ❌ No |
| Sees real user identity | ✅ Yes | ✅ Eth address | ❌ No |
| Can censor users | ✅ Yes | ✅ Yes | ⚠️ Yes (but proofs verifiable offline) |
| Can link cross-app identity | ✅ Yes | ✅ Same address | ❌ No (app-specific pseudonyms) |
| PII at rest | ✅ Database | ❌ None | ❌ None |

The gateway can refuse to issue a JWT — that's unavoidable with OIDC. But it learns nothing
about who the user is (ZK path) and cannot correlate logins across apps. A self-hosted
`bunny-gateway` eliminates the censorship risk entirely.

---

## 5. Ingress Layer: Ephemeral Session Management

The Noir proof generation takes ~200ms in WASM. To avoid this on every action:

1. **On Login (once per session / 24h)**: Browser generates ephemeral Ed25519 key, runs the
   Noir circuit, registers the session with `bunny-gateway` via `ZkOidcAuthEnvelope`.
   Gateway stores `{ ephemeral_pubkey, derived_account_id, expiry }` in RAM — no DB.

2. **On Every Subsequent Action (microseconds)**: Requests are signed with the ephemeral key.
   Gateway verifies the fast signature against the RAM session cache and routes directly to Iggy.

3. **Paymaster**: A valid session unlocks gas sponsorship for `derived_account_id`.
   The paymaster signs intents without knowing who the user is.

---

## 6. JWKS Synchronization

Instead of trusting external DNS at proof verification time, `bunny-gateway` periodically
fetches and validates the JWKS for supported IdPs (`accounts.google.com`, `appleid.apple.com`).
Valid key hashes are committed to the Lattice State Root under system address
`0x0000000000000000000000000000000000000003`. Any node verifies proofs statelessly.

---

## 7. Technical Reference

### ZkOidcAuthEnvelope (CBOR-encoded)

```rust
pub struct ZkOidcAuthEnvelope {
    /// Which verification path to use
    pub auth_path: AuthPath,
    /// UltraHonk proof bytes (~200B compressed) — only for ZK path
    pub proof: Option<Vec<u8>>,
    /// Public inputs for the Noir verifier — only for ZK path
    pub public_inputs: Option<ZkOidcPublicInputs>,
}

pub enum AuthPath {
    /// Path A: classic SIWE — any EVM wallet, same as siwe-oidc
    ClassicSiwe { signature: [u8; 65], address: Address },
    /// Path B: ZK proof — privacy-enhanced, app-specific pseudonym
    ZkOidc,
    /// Path C: PQ signature — quantum_standard profile accounts
    PostQuantum { scheme: PqScheme, signature: Vec<u8> },
}

pub struct ZkOidcPublicInputs {
    pub idp_pubkey_modulus: [u8; 256],
    pub app_id_hash:        B256,
    pub ephemeral_pubkey:   B256,
    pub session_expiry:     u64,
    pub derived_account_id: B256,
}
```

### The Noir Circuit (`zk_oidc.nr`)

```noir
use dep::std;
use dep::rsa::verify_sha256_pkcs1v15;

fn main(
    // Private inputs — never leave the device
    jwt_header_and_payload: [u8; 1024],
    jwt_signature:          [u8; 256],  // RSA-2048 from Google/Apple
    user_sub:               Field,      // Google subject ID
    user_salt:              Field,      // User's secret local salt

    // Public inputs — sent to bunny-gateway
    idp_pubkey_modulus: pub [u8; 256],
    idp_pubkey_redc:    pub [u8; 256],
    app_id_hash:        pub Field,      // keccak256("nextcloud") etc.
    ephemeral_pubkey:   pub Field,      // Session key for this login
    session_expiry:     pub u64,
    derived_account_id: pub Field,      // = Poseidon(sub, app_id_hash, salt)
) {
    let is_valid = verify_sha256_pkcs1v15(
        idp_pubkey_modulus, idp_pubkey_redc, jwt_signature, jwt_header_and_payload
    );
    assert(is_valid == true);

    let expected = std::hash::poseidon([user_sub, app_id_hash, user_salt]);
    assert(derived_account_id == expected);

    let binding = std::hash::poseidon([derived_account_id, ephemeral_pubkey, session_expiry as Field]);
    assert(binding != 0);
}
```

### Wallet UX XState Machine

The wallet login component uses `authPathMachine`:

```
idle
 └─► challenge_received
      ├─► [Path A] signing → session_active
      ├─► [Path B] oauth_redirect → proof_generating → session_active
      └─► [Path C] pq_signing → session_active

session_active
 └─► [expired] → idle
```

From the user's perspective, Path A feels identical to SIWE today. Path B adds a
"Privacy Mode" toggle and a brief one-time proof generation step (~200ms). Path C is
invisible to the user — the wallet handles PQ signing automatically based on their
`quantum_standard` profile.
