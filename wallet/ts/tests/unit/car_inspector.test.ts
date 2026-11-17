// Unit Tests for Virtual CAR Inspector & Noir Prover Generator
// Supports Remix Plugin & Wallet Tree Explorer

import assert from 'node:assert';
import { VirtualCarBuffer } from '../../src/car_reconciler.js';
import { CarTreeInspector, CANONICAL_SLOT_DEFINITIONS } from '../../src/car_inspector.js';

async function runTests() {
    console.log('--- Starting car_inspector.test.ts ---');

    // Test 1: Slot Metadata Retrieval
    {
        console.log('Test 1: Slot metadata retrieval');
        const meta0 = CarTreeInspector.getSlotMetadata(0);
        assert.strictEqual(meta0.name, 'W3C_DIF_IDENTITY');
        assert.strictEqual(meta0.category, 'Identity');

        const meta1 = CarTreeInspector.getSlotMetadata(1);
        assert.strictEqual(meta1.name, 'ZANZIBAR_REBAC');

        const meta2 = CarTreeInspector.getSlotMetadata(2);
        assert.strictEqual(meta2.name, 'BLIND_NOTES');

        const meta15 = CarTreeInspector.getSlotMetadata(15);
        assert.strictEqual(meta15.name, 'DYNAMIC_SPARSE_SLOT_15');
        assert.strictEqual(meta15.category, 'DynamicSparse');
        console.log('✓ Slot metadata retrieval passed');
    }

    // Test 2: Tree Inspection & Summary Formatting
    {
        console.log('Test 2: Tree inspection and summary');
        const buffer = new VirtualCarBuffer();

        // Initially slot 1 is zero
        const emptyInspect = CarTreeInspector.inspectSlot(buffer, 1);
        assert.strictEqual(emptyInspect.isDirty, false);
        assert.strictEqual(emptyInspect.decodedSummary, 'Zero / Uninitialized');

        // Populate slot 1
        const testRoot = new Uint8Array(32);
        testRoot[0] = 0xDE;
        testRoot[1] = 0xAD;
        buffer.setSlot(1, testRoot);

        const filledInspect = CarTreeInspector.inspectSlot(buffer, 1);
        assert.strictEqual(filledInspect.isDirty, true);
        assert.ok(filledInspect.rawHex.startsWith('0xdead'));
        assert.ok(filledInspect.decodedSummary.includes('Zanzibar Edge Accumulator: 0xdead'));

        const allSlots = CarTreeInspector.inspectAll(buffer);
        assert.strictEqual(allSlots.length, 64);
        assert.strictEqual(allSlots[1].isDirty, true);
        console.log('✓ Tree inspection and summary passed');
    }

    // Test 3: Global Tree Search
    {
        console.log('Test 3: Global tree search');
        const buffer = new VirtualCarBuffer();
        const testSqlData = new Uint8Array(32);
        testSqlData[0] = 0xCA;
        testSqlData[1] = 0xFE;
        buffer.setSlot(4, testSqlData);

        // Search by category
        const privacyMatches = CarTreeInspector.search(buffer, 'Privacy');
        assert.ok(privacyMatches.some(m => m.slot === 2));

        // Search by name
        const sqlMatches = CarTreeInspector.search(buffer, 'proof_of_sql');
        assert.strictEqual(sqlMatches.length, 1);
        assert.strictEqual(sqlMatches[0].slot, 4);

        // Search by hex content
        const hexMatches = CarTreeInspector.search(buffer, 'cafe');
        assert.strictEqual(hexMatches.length, 1);
        assert.strictEqual(hexMatches[0].slot, 4);
        console.log('✓ Global tree search passed');
    }

    // Test 4: Noir Prover.toml Auto-Generation
    {
        console.log('Test 4: Noir Prover.toml auto-generation');
        const buffer = new VirtualCarBuffer();
        const govRoot = new Uint8Array(32);
        govRoot[0] = 0x88;
        buffer.setSlot(6, govRoot);

        const proverToml = CarTreeInspector.generateNoirProverToml('private_unit_vote', buffer, {
            proposalId: '0x1234',
            voteChoice: 1,
        });

        assert.ok(proverToml.includes('proposal_id = "0x1234"'));
        assert.ok(proverToml.includes('vote_choice = 1'));
        assert.ok(proverToml.includes('smt_siblings = ['));
        assert.ok(proverToml.includes('public_vote_weight = 1'));
        assert.ok(proverToml.includes('0x880000'));
        console.log('✓ Noir Prover.toml auto-generation passed');
    }

    // Test 5: Remix Plugin Webview Bridge Message
    {
        console.log('Test 5: Remix plugin message formatting');
        const buffer = new VirtualCarBuffer();
        const msg = CarTreeInspector.toRemixPluginMessage(buffer, 'treeState');
        assert.strictEqual(msg.source, 'sovereign-remix-plugin');
        assert.strictEqual(msg.action, 'treeState');
        assert.strictEqual(msg.slots.length, 64);
        assert.strictEqual(typeof msg.timestamp, 'number');
        console.log('✓ Remix plugin message formatting passed');
    }

    console.log('--- ALL car_inspector.test.ts TESTS PASSED ---');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
