// State Object Model (SOM) Unit Tests
// Conforms to Phase 1 & docs/booklet/bunny-stack.tex (State Object Model Specification).

import assert from 'node:assert';
import { ethers } from 'ethers';
import { StateObjectModel, SomAction, SomEvent } from '../../src/state_object_model.js';
import { VirtualCarBuffer, MemoryLocalStoreAdapter } from '../../src/car_reconciler.js';

async function runTests() {
    console.log('--- Starting state_object_model.test.ts ---');

    const aliceDid = 'did:sov:0x1111111111111111111111111111111111111111';
    const bobDid = 'did:sov:0x2222222222222222222222222222222222222222';
    const charlieDid = 'did:sov:0x3333333333333333333333333333333333333333';

    // Test 1: Read-Only Observable Projection & Frozen Slot Buffers
    {
        console.log('Test 1: Read-Only Observable Projection');
        const som = new StateObjectModel('0x1111111111111111111111111111111111111111');
        assert.strictEqual(som.getNonce(), 0n);

        const slot3 = som.getSlot(3);
        assert.strictEqual(slot3.length, 32);
        assert.ok(slot3.every(b => b === 0));

        // Attempting to mutate returned slot buffer throws TypeError
        assert.throws(() => {
            (slot3 as any)[0] = 0xFF;
        }, /Cannot modify read-only slot projection/);

        // Out of bounds check
        assert.throws(() => som.getSlot(64), /Slot index out of bounds/);
        assert.throws(() => som.getSlot(-1), /Slot index out of bounds/);
        console.log('✓ Read-only projection passed');
    }

    // Test 2: In-Memory deReBAC Capability Guard (Slot 1)
    {
        console.log('Test 2: deReBAC Capability Guard (Slot 1)');
        const som = new StateObjectModel('0x1111111111111111111111111111111111111111');

        // Alice (owner) has full access
        assert.strictEqual(som.canMutate(aliceDid, 3), true);

        // Bob has no access yet
        assert.strictEqual(som.canMutate(bobDid, 3), false);

        // Dispatch from Bob without permission must throw security violation in <1ms
        const unauthorizedAction: SomAction = {
            type: 'GIT_SLOT_UPDATE',
            targetSlot: 3,
            callerDid: bobDid,
            payload: { newCommitment: ethers.id('commit-1') }
        };

        await assert.rejects(
            async () => await som.dispatch(unauthorizedAction),
            /\[SOM Security Violation\] Caller .* lacks deReBAC capability "can_mutate" on Slot 3/
        );

        // Grant Bob access to Slot 3 only (Engineering Git slot)
        som.grantDeRebacPermission(bobDid, 'can_mutate', [3]);
        assert.strictEqual(som.canMutate(bobDid, 3), true);
        assert.strictEqual(som.canMutate(bobDid, 4), false); // Still denied for Slot 4 (Finance)
        console.log('✓ deReBAC capability guard passed');
    }

    // Test 3: Path-Based Fine-Grained Reactivity (Signals Pattern)
    {
        console.log('Test 3: Path-Based Fine-Grained Reactivity (Signals)');
        const som = new StateObjectModel('0x1111111111111111111111111111111111111111');

        let slot3Notified = 0;
        let slot2Notified = 0;
        let slot3NewVal: any = null;

        som.observe('slots[3]', (newVal, oldVal, path) => {
            slot3Notified++;
            slot3NewVal = newVal;
        });

        som.observe('slots[2]', () => {
            slot2Notified++;
        });

        const commitHash = ethers.id('git-tree-root-v1');
        await som.dispatch({
            type: 'GIT_COMMIT_ANCHOR',
            targetSlot: 3,
            callerDid: aliceDid,
            payload: { newCommitment: commitHash }
        });

        assert.strictEqual(slot3Notified, 1);
        assert.strictEqual(slot2Notified, 0); // Slot 2 observer must NOT fire!
        assert.strictEqual(ethers.hexlify(slot3NewVal), commitHash);
        assert.strictEqual(som.getSlotHex(3), commitHash);
        assert.strictEqual(som.getNonce(), 1n);
        console.log('✓ Path-based fine-grained reactivity passed');
    }

    // Test 4: Hierarchical Event Bubbling (Leaf -> Account -> Manifold)
    {
        console.log('Test 4: Hierarchical Event Bubbling');
        const som = new StateObjectModel('0x1111111111111111111111111111111111111111');

        const bubbledTargets: string[] = [];
        som.addEventListener('SLOT_MUTATED', (event: SomEvent) => {
            bubbledTargets.push(event.target);
        });

        await som.dispatch({
            type: 'NOTE_SPENT',
            targetSlot: 2,
            callerDid: aliceDid,
            payload: { newCommitment: ethers.id('note-root-42') }
        });

        // Event should have bubbled through slot -> account -> manifold
        assert.deepStrictEqual(bubbledTargets, ['slot', 'account', 'manifold']);
        console.log('✓ Hierarchical event bubbling passed');
    }

    // Test 5: Fiber-Style Transaction Squashing
    {
        console.log('Test 5: Fiber-Style Transaction Squashing');
        const som = new StateObjectModel('0x1111111111111111111111111111111111111111');

        // Rapid dispatch within same event loop tick
        const p1 = som.dispatch({
            type: 'INVENTORY_ADJUST',
            targetSlot: 5,
            callerDid: aliceDid,
            payload: { newCommitment: ethers.id('inv-delta-1') }
        });
        const p2 = som.dispatch({
            type: 'INVENTORY_ADJUST',
            targetSlot: 5,
            callerDid: aliceDid,
            payload: { newCommitment: ethers.id('inv-delta-2') }
        });
        const p3 = som.dispatch({
            type: 'INVENTORY_ADJUST',
            targetSlot: 5,
            callerDid: aliceDid,
            payload: { newCommitment: ethers.id('inv-final-composite') }
        });

        await Promise.all([p1, p2, p3]);

        // Coalesced into a single nonce increment (1n, not 3n)
        assert.strictEqual(som.getNonce(), 1n);
        assert.strictEqual(som.getSlotHex(5), ethers.id('inv-final-composite'));
        console.log('✓ Fiber-style transaction squashing passed');
    }

    // Test 6: Optimistic Updates & Sovereign Pure Rebase
    {
        console.log('Test 6: Sovereign Pure Rebase (Conflict-Free & Conflicted)');
        const som = new StateObjectModel('0x1111111111111111111111111111111111111111');

        // Alice dispatches local action touching Slot 3 (Git commits)
        const localCommitment = ethers.id('alice-local-git-slot3');
        await som.dispatch({
            type: 'GIT_COMMIT',
            targetSlot: 3,
            callerDid: aliceDid,
            payload: { newCommitment: localCommitment }
        });
        assert.strictEqual(som.getNonce(), 1n);

        // Case A: Remote peer (Bob) committed Slot 2 (Blind notes) on the ledger first, advancing nonce to 1n
        const remoteSlots: Uint8Array[] = Array.from({ length: 64 }, () => new Uint8Array(32));
        const remoteNoteCommitment = new Uint8Array(ethers.getBytes(ethers.id('bob-remote-notes-slot2')));
        remoteSlots[2] = remoteNoteCommitment;

        // Rebase Alice's uncommitted queue on top of Bob's remote head
        const cleanRebaseResult = som.rebase({
            slots: remoteSlots,
            nonce: 1n
        });

        assert.strictEqual(cleanRebaseResult.success, true);
        assert.strictEqual(cleanRebaseResult.conflictedSlots.length, 0);
        assert.strictEqual(cleanRebaseResult.newNonce, 2n); // Remote nonce (1) + local action (1) = 2
        // Both Slot 2 (from remote) and Slot 3 (from Alice rebase) must be present
        assert.strictEqual(som.getSlotHex(2), ethers.hexlify(remoteNoteCommitment));
        assert.strictEqual(som.getSlotHex(3), localCommitment);
        console.log('  -> Conflict-free rebase passed');

        // Case B: Remote peer also modified Slot 3 (slot collision conflict)
        const conflictingRemoteSlots: Uint8Array[] = Array.from({ length: 64 }, () => new Uint8Array(32));
        conflictingRemoteSlots[3] = new Uint8Array(ethers.getBytes(ethers.id('remote-conflicting-slot3')));

        const conflictRebaseResult = som.rebase({
            slots: conflictingRemoteSlots,
            nonce: 5n
        });

        assert.strictEqual(conflictRebaseResult.success, false);
        assert.deepStrictEqual(conflictRebaseResult.conflictedSlots, [3]);
        console.log('  -> Conflicted rebase detection passed');
        console.log('✓ Sovereign pure rebase passed');
    }

    console.log('--- All state_object_model.test.ts tests PASSED! ---');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
