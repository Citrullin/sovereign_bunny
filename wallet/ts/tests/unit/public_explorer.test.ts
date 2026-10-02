import assert from 'assert';
import { PublicExplorer } from '../../src/components/public_explorer.js';

console.log("🌐 Running Public Explorer Unit Tests...\n");

// 1. Instantiation and default state
console.log("1. Testing PublicExplorer initialization and defaults...");
const explorer = new PublicExplorer();
const stats = explorer.getNetworkStats();

assert.strictEqual(typeof stats.totalDids, 'number', "totalDids must be a number");
assert.strictEqual(stats.activeAuthorities, 7, "Default activeAuthorities must be 7");
assert.strictEqual(stats.epochHeight, 42, "Default epochHeight must be 42");
assert.strictEqual(stats.blindNotePoolDepth, 0, "Default blindNotePoolDepth must be 0");
assert.strictEqual(stats.peerCount, 5, "Default peerCount must be 5");
assert.strictEqual(stats.consensusModel, 'Snowman BFT + Account Lattice');
console.log("   ✅ PublicExplorer default stats verified.");

// 2. Set stats dynamically
console.log("\n2. Testing dynamic state update...");
explorer.setNetworkStats({
    totalDids: 150,
    activeAuthorities: 10,
    epochHeight: 105,
    blindNotePoolDepth: 42,
    peerCount: 12,
    totalTransactions: 1200,
});

const updatedStats = explorer.getNetworkStats();
assert.strictEqual(updatedStats.totalDids, 150);
assert.strictEqual(updatedStats.activeAuthorities, 10);
assert.strictEqual(updatedStats.epochHeight, 105);
assert.strictEqual(updatedStats.blindNotePoolDepth, 42);
assert.strictEqual(updatedStats.peerCount, 12);
assert.strictEqual(updatedStats.totalTransactions, 1200);
console.log("   ✅ Dynamic network telemetry update verified.");

// 3. Render output validation
console.log("\n3. Testing rendering output...");
const rendered = explorer.render();
assert.ok(rendered !== null, "Render output must not be null");

console.log("   ✅ Rendering output verified.");

console.log("\n🎉 All Public Explorer Unit Tests Passed Successfully!");
