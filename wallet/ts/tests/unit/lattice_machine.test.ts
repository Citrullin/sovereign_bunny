import {
    createLatticeMachineActor,
    LatticeContext,
    LocalLatticeState,
} from '../../src/lattice_machine.js';

console.log("🔒 Running Sovereign Lattice Machine (Git Commit vs Git Push & Account Leases) Tests...\n");

// -------------------------------------------------------------
// 1. Initial State & Context
// -------------------------------------------------------------
console.log("1. Testing initial state and idle transitions...");
const actor = createLatticeMachineActor({
    account: '0x1234567890123456789012345678901234567890',
    currentEpoch: 10n,
    onChainTip: '0x0000000000000000000000000000000000000000000000000000000000000000',
});
actor.start();

let snap = actor.getSnapshot();
console.assert(snap.value === 'idle', "Initial state is idle");
console.assert(!snap.context.localState.isLocked, "Account is not locked initially");
console.assert(snap.context.localState.sequence === 0n, "Sequence starts at 0");

// -------------------------------------------------------------
// 2. Staging and Local Commit (Git Commit)
// -------------------------------------------------------------
console.log("2. Testing staging operations and local commit (Git Commit)...");
actor.send({
    type: 'STAGE_OPERATION',
    operation: { kind: 'transfer', to: '0xaaaa', amount: 100n },
});
snap = actor.getSnapshot();
console.assert(snap.value === 'staging', "Staging operation moves to staging");
console.assert(snap.context.stagedOperations.length === 1, "Staged 1 operation");

const newIntermediateRoot = '0x1111111111111111111111111111111111111111111111111111111111111111';
actor.send({
    type: 'COMMIT_LOCAL',
    newRoot: newIntermediateRoot,
});
snap = actor.getSnapshot();
console.assert(snap.value === 'speculative', "Local commit transitions to speculative");
console.assert(snap.context.localState.headCommitment === newIntermediateRoot, "Head commitment updated");
console.assert(snap.context.localState.sequence === 1n, "Sequence incremented to 1");
console.assert(snap.context.stagedOperations.length === 0, "Staged ops cleared after commit");

// -------------------------------------------------------------
// 3. Account Lease (Native Lock Block) & Expiry Reclaim
// -------------------------------------------------------------
console.log("3. Testing account lease lock and epoch expiry countdown...");
const lockIntermediateRoot = '0x2222222222222222222222222222222222222222222222222222222222222222';
actor.send({
    type: 'LEASE_LOCK',
    intermediateRoot: lockIntermediateRoot,
    durationEpochs: 5n, // expires at epoch 15 (10 + 5)
});
snap = actor.getSnapshot();
console.assert(snap.value === 'leased', "LEASE_LOCK transitions to leased state");
console.assert(snap.context.localState.isLocked, "Local state reports isLocked=true");
console.assert(snap.context.localState.lockExpiryEpoch === 15n, "Expiry epoch is 15");

// Sending stage operation while leased should be ignored / remain in leased
actor.send({
    type: 'STAGE_OPERATION',
    operation: { kind: 'transfer', to: '0xbbbb', amount: 50n },
});
snap = actor.getSnapshot();
console.assert(snap.value === 'leased', "Operations cannot be staged while leased");

// Advance epoch to 12 (< 15) -> still leased
actor.send({ type: 'ADVANCE_EPOCH', epoch: 12n });
snap = actor.getSnapshot();
console.assert(snap.value === 'leased', "Remains leased at epoch 12 (< 15)");

// Advance epoch to 15 (>= 15) -> transitions to expired
actor.send({ type: 'ADVANCE_EPOCH', epoch: 15n });
snap = actor.getSnapshot();
console.assert(snap.value === 'expired', "Transitions to expired at epoch 15");

// Reclaim rollback restores sovereignty
actor.send({ type: 'REVERT_ROLLBACK' });
snap = actor.getSnapshot();
console.assert(snap.value === 'idle', "Rollback returns to idle state");
console.assert(!snap.context.localState.isLocked, "Lock is released");
console.assert(snap.context.localState.lockExpiryEpoch === 0n, "Lock expiry reset");

// -------------------------------------------------------------
// 4. Successful Unlock (Settle)
// -------------------------------------------------------------
console.log("4. Testing successful lease unlock / settlement...");
actor.send({
    type: 'LEASE_LOCK',
    intermediateRoot: '0x3333333333333333333333333333333333333333333333333333333333333333',
    durationEpochs: 10n,
});
snap = actor.getSnapshot();
console.assert(snap.value === 'leased', "Re-entered leased state");

const settledTip = '0x4444444444444444444444444444444444444444444444444444444444444444';
actor.send({ type: 'UNLOCK', newTip: settledTip });
snap = actor.getSnapshot();
console.assert(snap.value === 'idle', "Unlock returns to idle");
console.assert(!snap.context.localState.isLocked, "Lock released on unlock");
console.assert(snap.context.localState.headCommitment === settledTip, "Head commitment updated to settled tip");
console.assert(snap.context.onChainTip === settledTip, "On-chain tip updated");

console.log("✅ All Sovereign Lattice Machine unit tests passed!\n");
