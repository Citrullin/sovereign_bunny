// Sovereign Reference Client & Reconciler Unit Tests
// Conforms to Phase 2 & docs/booklet/bunny-stack.tex (Reference Client Specification).

import assert from 'node:assert';
import {
    MemoryLocalStoreAdapter,
    IrohSyncAdapter,
    VirtualCarBuffer,
    SovereignActorClient,
    CommitPhase,
} from '../../src/car_reconciler.js';

async function runTests() {
    console.log('--- Starting car_reconciler.test.ts ---');

    // Test 1: MemoryLocalStoreAdapter basic operations
    {
        console.log('Test 1: MemoryLocalStoreAdapter');
        const storage = new MemoryLocalStoreAdapter();
        const initialSlot = await storage.readSlot(0);
        assert.strictEqual(initialSlot.length, 32);
        assert.ok(initialSlot.every(b => b === 0));

        const dirtyMap = new Map<number, Uint8Array>();
        const testData = new Uint8Array(32);
        testData[0] = 0xAA;
        dirtyMap.set(1, testData);

        await storage.commitAtomicBatch(1n, dirtyMap);
        assert.strictEqual(await storage.getLatestNonce(), 1n);

        const readSlot1 = await storage.readSlot(1);
        assert.strictEqual(readSlot1[0], 0xAA);

        const staged = await storage.getStagedBatch();
        assert.ok(staged !== null);
        assert.strictEqual(staged!.nonce, 1n);
        assert.strictEqual(staged!.dirty.get(1)![0], 0xAA);

        await storage.clearStagedBatch(1n);
        assert.strictEqual(await storage.getStagedBatch(), null);
        console.log('✓ MemoryLocalStoreAdapter passed');
    }

    // Test 2: IrohSyncAdapter BNY\x01 framing validation
    {
        console.log('Test 2: IrohSyncAdapter framing');
        const sync = new IrohSyncAdapter();

        // Invalid frame
        const invalidFrame = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
        await assert.rejects(
            async () => sync.dispatchFrame(invalidFrame, 'urgent'),
            /missing BNY\\x01 SSZ header/
        );

        // Valid frame header: BNY\x01
        const validFrame = new Uint8Array(32);
        validFrame[0] = 0x42;
        validFrame[1] = 0x4E;
        validFrame[2] = 0x59;
        validFrame[3] = 0x01;

        const receipt = await sync.dispatchFrame(validFrame, 'urgent');
        assert.strictEqual(receipt.status, 'anchored');
        assert.strictEqual(receipt.epoch, 2n);
        assert.ok(receipt.txHash.startsWith('0x'));
        console.log('✓ IrohSyncAdapter passed');
    }

    // Test 3: VirtualCarBuffer SSZ packing
    {
        console.log('Test 3: VirtualCarBuffer SSZ packing');
        const vcar = new VirtualCarBuffer();
        const val1 = new Uint8Array(32);
        val1[0] = 0x11;
        vcar.setSlot(1, val1);

        const val4 = new Uint8Array(32);
        val4[0] = 0x44;
        vcar.setSlot(4, val4);

        assert.strictEqual(vcar.dirtyMask, (1n << 1n) | (1n << 4n));

        const frame = vcar.packFrame(5n);
        // Header (13 bytes) + Slot 1 (1 byte idx + 32 bytes) + Slot 4 (1 byte idx + 32 bytes) = 13 + 33 + 33 = 79 bytes
        assert.strictEqual(frame.length, 13 + 33 + 33);
        assert.strictEqual(frame[0], 0x42);
        assert.strictEqual(frame[1], 0x4E);
        assert.strictEqual(frame[2], 0x59);
        assert.strictEqual(frame[3], 0x01);

        const view = new DataView(frame.buffer, frame.byteOffset + 4, 8);
        assert.strictEqual(view.getBigUint64(0, false), 5n);
        assert.strictEqual(frame[12], 2); // 2 dirty slots
        console.log('✓ VirtualCarBuffer passed');
    }

    // Test 4: SovereignActorClient single-writer owned reconcile lifecycle
    {
        console.log('Test 4: SovereignActorClient reconcile lifecycle');
        const storage = new MemoryLocalStoreAdapter();
        const sync = new IrohSyncAdapter();
        const client = new SovereignActorClient({ storage, sync });

        const phases: string[] = [];
        const result = await client.reconcile(
            draft => {
                const data = new Uint8Array(32);
                data[0] = 0x99;
                draft.setSlot(1, data);
            },
            phase => {
                phases.push(phase.phase);
            }
        );

        assert.deepStrictEqual(phases, ['Staged', 'Sealed', 'Anchored']);
        assert.strictEqual(result.phase, 'Anchored');
        if (result.phase === 'Anchored') {
            assert.strictEqual(result.nonce, 1n);
            assert.strictEqual(result.epoch, 2n);
        }
        assert.strictEqual(client.getNonce(), 1n);
        assert.strictEqual(client.getSlot(1)[0], 0x99);

        // Staged batch should be cleared after anchor
        assert.strictEqual(await storage.getStagedBatch(), null);
        console.log('✓ SovereignActorClient reconcile lifecycle passed');
    }

    // Test 5: Reconcile rollback on transport failure
    {
        console.log('Test 5: Reconcile rollback on failure');
        const storage = new MemoryLocalStoreAdapter();
        // Failing transport
        const failingSync = {
            async dispatchFrame(): Promise<any> {
                throw new Error('Network partition: Snow sampling timeout');
            }
        };

        const client = new SovereignActorClient({ storage, sync: failingSync });
        await client.init();

        const phases: string[] = [];
        const result = await client.reconcile(
            draft => {
                const data = new Uint8Array(32);
                data[0] = 0xFE;
                draft.setSlot(2, data);
            },
            phase => {
                phases.push(phase.phase);
            }
        );

        assert.strictEqual(result.phase, 'Rejected');
        if (result.phase === 'Rejected') {
            assert.strictEqual(result.rolledBackFrom, 0n);
            assert.strictEqual(result.nonce, 1n);
            assert.ok(result.reason.includes('Network partition'));
        }
        // State should be rolled back to 0
        assert.strictEqual(client.getSlot(2)[0], 0);
        assert.strictEqual(client.getNonce(), 0n);
        console.log('✓ Reconcile rollback on failure passed');
    }

    // Test 6: Crash recovery across sessions
    {
        console.log('Test 6: Crash recovery across sessions');
        const storage = new MemoryLocalStoreAdapter();
        const sync = new IrohSyncAdapter();

        // Simulate crash: staged batch written to storage but tab closed before sealing
        const unfinishedDirty = new Map<number, Uint8Array>();
        const data = new Uint8Array(32);
        data[0] = 0x77;
        unfinishedDirty.set(3, data);
        await storage.commitAtomicBatch(1n, unfinishedDirty);

        // New client session starts up (e.g. tab reloaded)
        const recoveredClient = new SovereignActorClient({ storage, sync });
        await recoveredClient.init();

        // Recovered client should have auto-sealed and anchored the staged batch
        assert.strictEqual(recoveredClient.getNonce(), 1n);
        assert.strictEqual(recoveredClient.getSlot(3)[0], 0x77);
        assert.strictEqual(await storage.getStagedBatch(), null);
        console.log('✓ Crash recovery across sessions passed');
    }

    // Test 7: proposeIntent returns reactive stream for cross-actor sagas
    {
        console.log('Test 7: proposeIntent cross-actor saga stream');
        const client = new SovereignActorClient();
        const intent = {
            intentId: 'intent-001',
            initiator: 'did:rad:local:alice',
            counterparties: ['did:rad:local:bob'],
            targetSlots: [1, 4],
            payload: new Uint8Array([0x01]),
            deadlineEpoch: 100n,
        };

        const stream = client.proposeIntent(intent);
        const reader = stream.getReader();
        const states: string[] = [];

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            states.push(value.state);
        }

        assert.deepStrictEqual(states, ['Pending', 'Locked', 'Settled']);
        console.log('✓ proposeIntent cross-actor saga stream passed');
    }

    console.log('--- ALL car_reconciler.test.ts TESTS PASSED ---');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
