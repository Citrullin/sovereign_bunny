# Account Leases & Native Lock Blocks

## 1. Overview & Architectural Philosophy

In a stateless account-lattice ledger, there is no global mutex or lock manager. Transactions modify single-writer account chains asynchronously.

To execute multi-account atomic operations (such as flash loans, conditional asset swaps, or coordinated state transitions across accounts) without reintroducing a global block clock or reentrancy vulnerabilities, sovereign-reth introduces **Account Leases** (`LatticePayload::Lease`).

An Account Lease is a first-class state transition written directly to an account's own single-writer chain that temporarily commits an intermediate state root and locks the account until released or reclaimed.

---

## 2. Ingress & Lifecycle Rules

A lease undergoes three distinct phases:

1. **Acquisition (`LatticePayload::Lease`)**:
   - The account owner signs a lease block specifying an `intermediate_root` and `duration_epochs`.
   - The account frontier is marked `locked = true`, and `locked_at = current_epoch`.
   - While leased, standard `Send` transfers are disabled to prevent double-spending or conflicting state mutations.

2. **Settlement / Unlock (`LatticePayload::Unlock`)**:
   - When the multi-step transaction or bundle resolves successfully, the coordinator or owner submits an `Unlock` block providing `unlock_commitment`.
   - The lock is released (`locked = false`), and the account frontier tip advances to the post-state.

3. **Expiry & Rollback Reclamation (`LatticePayload::Reclaim`)**:
   - If the bundle fails, is abandoned, or exceeds the specified epoch horizon (`current_epoch >= expiry_epoch`), the account owner submits a `Reclaim` block.
   - The intermediate state is rolled back in the account register, `locked = false`, and account sovereignty is restored.

---

## 3. Deadlock Freedom & Security Guarantees

- **Ascending Address Ordering**: Multi-account atomic bundles must acquire account leases strictly in canonical ascending address order (`account_a < account_b`).
- **Epoch Horizon Eviction**: Leases cannot be held indefinitely. Any lease not explicitly unlocked is unconditionally eligible for owner rollback after `duration_epochs`.
- **Zero Wall-Clock Dependency**: Expiry and lock countdowns are evaluated strictly via `Epoch(u64)`, eliminating wall-clock drift or NTP manipulation attacks.
