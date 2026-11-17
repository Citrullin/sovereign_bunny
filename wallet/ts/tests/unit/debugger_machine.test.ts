import { createDebuggerActor, debuggerMachine } from '../../src/app/debugger_machine.js';
import { SovereignDebuggerElement } from '../../src/components/sovereign_debugger.js';

console.log("🐞 Running Sovereign Debugger & Precompile State Machine Unit Tests...\n");

// 1. Initial State & Context
const actor = createDebuggerActor();
actor.start();
const snap0 = actor.getSnapshot();
console.assert(snap0.value === 'idle', "Initial state must be idle");
console.assert(snap0.context.targetAddress === '0x0000000000000000000000000000000000000003', "Default target should be 0x03");
console.log("   ✅ Initial state & defaults verified.");

// 2. Preset loading
actor.send({ type: 'LOAD_PRESET', preset: 'pq_block' });
const snap1 = actor.getSnapshot();
console.assert(snap1.context.inputPayload.includes('-32001'), "PQ block preset loaded into payload");

actor.send({ type: 'LOAD_PRESET', preset: 'zanzibar', connectedAddress: '0x1111111111111111111111111111111111111111' });
const snap2 = actor.getSnapshot();
console.assert(snap2.context.targetAddress === '0x0000000000000000000000000000000000000061', "Target set to precompile 0x61 for Zanzibar preset");
console.log("   ✅ Quick preset transitions verified.");

// 3. Clear action
actor.send({ type: 'CLEAR' });
const snap3 = actor.getSnapshot();
console.assert(snap3.context.inputPayload === '', "Input cleared");
console.assert(snap3.context.analysisResult === null, "Analysis result cleared");
console.log("   ✅ Clear state transition verified.");

// 4. Zanzibar encoding
actor.send({
    type: 'SET_ZANZIBAR_CONFIG',
    object: 'doc:legal_contract',
    relation: 'viewer',
    subject: '0x2222222222222222222222222222222222222222',
});
actor.send({
    type: 'ZANZIBAR_ENCODED',
    calldata: '0x9586e6790000000000000000000000000000000000000000000000000000000000000060',
});
const snap4 = actor.getSnapshot();
console.assert(snap4.context.zanState.object === 'doc:legal_contract', "Zanzibar object updated");
console.assert(snap4.context.inputPayload.startsWith('0x9586e679'), "Payload updated with selector");
console.assert(snap4.context.targetAddress === '0x0000000000000000000000000000000000000061', "Target set to 0x61");
console.log("   ✅ Zanzibar ReBAC state machine transitions verified.");

// 5. W3C Web of Things (WoT) State
actor.send({
    type: 'SET_WOT_CONFIG',
    title: 'Smart Meter Node',
    properties: 'voltage, current, power',
});
actor.send({
    type: 'WOT_GENERATED',
    cid: 'b3:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    error: null,
});
const snap5 = actor.getSnapshot();
console.assert(snap5.context.wotState.title === 'Smart Meter Node', "WoT title updated");
console.assert(snap5.context.wotState.cid?.startsWith('b3:'), "WoT CID pinned and recorded");
console.log("   ✅ W3C WoT TD state machine transitions verified.");

// 6. Lit Component Direct Methods (No DOM .click() chaining)
const dbgElement = new SovereignDebuggerElement();
dbgElement.bindMachine(actor);
console.assert(dbgElement.targetAddress === '0x0000000000000000000000000000000000000061', "Component synchronized with machine target");

// Test WoT generator method
dbgElement.wotTitle = 'Enclave Temperature Sensor';
dbgElement.wotProperties = 'temperature, status';
const td = dbgElement.generateWotTd();
console.assert(td['@context'] === 'https://www.w3.org/2022/wot/td/v1.1', "Valid W3C WoT TD @context");
console.assert(td.title === 'Enclave Temperature Sensor', "Valid TD title");
console.assert(td.properties.temperature !== undefined, "Temperature property present");
console.assert(td.properties.status !== undefined, "Status property present");
console.log("   ✅ SovereignDebuggerElement.generateWotTd() generated valid W3C TD structure.");

// Test Zanzibar encoder method
dbgElement.zanObject = 'file:audit_report.pdf';
dbgElement.zanRelation = 'owner';
dbgElement.zanSubject = '0x1111111111111111111111111111111111111111';
dbgElement.encodeZanzibar();
console.assert(dbgElement.inputPayload.startsWith('0x9586e679'), "Zanzibar calldata selector present");
console.assert(dbgElement.targetAddress === '0x0000000000000000000000000000000000000061', "Target set to precompile 0x61");
console.log("   ✅ SovereignDebuggerElement.encodeZanzibar() produced valid precompile calldata.");

actor.stop();
console.log("\n🎉 All Sovereign Debugger & Precompile State Machine Unit Tests Passed Successfully!\n");
