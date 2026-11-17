import assert from 'assert';
import { StorageStateMachine, initialStorageContext } from '../../src/app/storage_machine.js';

console.log("💾 Running StorageStateMachine Unit Tests...");

// 1. Initial State & Defaults
console.log("1. Testing StorageStateMachine initial state & defaults...");
const machine = new StorageStateMachine();
const snap = machine.getSnapshot();
assert.strictEqual(snap.value, 'idle', 'Initial state should be idle');
assert.strictEqual(snap.context.uploadedCid, null);
assert.strictEqual(snap.context.zkMeritTier, 2);
assert.strictEqual(snap.context.zanNamespace, '1');
console.log("   ✅ Initial state & defaults verified.");

// 2. Iroh Upload Transitions
console.log("2. Testing Iroh DA Upload transitions...");
machine.send({ type: 'UPLOAD_START', fileName: 'test.parquet', fileSize: 1024 });
assert.strictEqual(machine.getSnapshot().context.uploadStatus, 'Uploading to Iroh storage...');

machine.send({ type: 'UPLOAD_SUCCESS', cid: 'b3:abcdef0123456789', fileName: 'test.parquet', fileSize: 1024 });
assert.strictEqual(machine.getSnapshot().context.uploadedCid, 'b3:abcdef0123456789');
console.log("   ✅ Iroh DA Upload transitions verified.");

// 3. SxT Proof of SQL Transitions
console.log("3. Testing Space and Time (SxT) Proof of SQL transitions...");
machine.send({
    type: 'SET_SXT_CONFIG',
    targetDao: '0x1234567890123456789012345678901234567890',
    query: 'SELECT * FROM test_table;'
});
assert.strictEqual(machine.getSnapshot().context.sxtTargetDao, '0x1234567890123456789012345678901234567890');
assert.strictEqual(machine.getSnapshot().context.sxtQuery, 'SELECT * FROM test_table;');

machine.send({ type: 'EXEC_SXT_SUCCESS', result: 'Proof verified: 10 rows matching commitment' });
assert.strictEqual(machine.getSnapshot().context.sxtResult, 'Proof verified: 10 rows matching commitment');
console.log("   ✅ SxT Proof of SQL transitions verified.");

// 4. Zanzibar ReBAC Transitions
console.log("4. Testing Zanzibar ReBAC (0x61) transitions...");
machine.send({
    type: 'SET_ZANZIBAR_CONFIG',
    namespace: '2',
    objectId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    relation: '1',
    subject: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
});
assert.strictEqual(machine.getSnapshot().context.zanNamespace, '2');

machine.send({ type: 'ZANZIBAR_INSCRIBE_SUCCESS', status: 'Inscribed tuple to Slot 1' });
assert.strictEqual(machine.getSnapshot().context.zanStatus, 'Inscribed tuple to Slot 1');
console.log("   ✅ Zanzibar ReBAC transitions verified.");

console.log("🎉 All StorageStateMachine unit tests passed!");
