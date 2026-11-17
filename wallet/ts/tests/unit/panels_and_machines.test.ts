import { ExplorerStateMachine } from '../../src/app/explorer_machine.js';
import { NfcStateMachine } from '../../src/app/nfc_machine.js';
import { JurisdictionStateMachine } from '../../src/app/jurisdiction_machine.js';
import { NfcPanel } from '../../src/components/nfc_panel.js';
import { JurisdictionPanel } from '../../src/components/jurisdiction_panel.js';
import { FediversePanel } from '../../src/components/fediverse_panel.js';
import { SovereignDebuggerElement } from '../../src/components/sovereign_debugger.js';

console.log("🧩 Running Sovereign Paneling & Machine Subsystems Unit Tests...");

// 1. ExplorerStateMachine test
const expMachine = new ExplorerStateMachine();
let expSnap = expMachine.getSnapshot();
console.assert(expSnap.value === 'idle', `Explorer initial state must be idle, got ${expSnap.value}`);

expMachine.send({
    type: 'LOAD',
    rpcUrl: 'http://localhost:8545',
    address: '0x1111111111111111111111111111111111111111',
});
expSnap = expMachine.getSnapshot();
console.assert(expSnap.value === 'loading_metrics', `Expected loading_metrics, got ${expSnap.value}`);

expMachine.send({
    type: 'METRICS_LOADED',
    stats: {
        totalDids: 12,
        activeAuthorities: 4,
        epochHeight: 100,
        blindNotePoolDepth: 5,
        peerCount: 8,
        totalTransactions: 250,
        chainId: 1337,
        consensusModel: 'Snowman BFT',
    },
    metrics: {
        account: '0x1111111111111111111111111111111111111111',
        accountHeight: 42n,
        consensusEpoch: 100,
        autoReclaimTimeout: 10,
        consensusModel: 'Snowman BFT',
    },
});
expSnap = expMachine.getSnapshot();
console.assert(expSnap.value === 'loading_graph', `Expected loading_graph, got ${expSnap.value}`);
console.assert(expSnap.context.networkStats?.epochHeight === 100, "Network stats populated");
console.assert(expSnap.context.accountMetrics?.accountHeight === 42n, "BigInt account height preserved");

expMachine.send({
    type: 'GRAPH_LOADED',
    graph: { nodes: [], edges: [] },
});
expSnap = expMachine.getSnapshot();
console.assert(expSnap.value === 'ready', `Expected ready, got ${expSnap.value}`);
console.log("   ✅ ExplorerStateMachine lifecycle and BigInt typing verified.");

// 2. NfcStateMachine & <nfc-panel> test
const nfcMachine = new NfcStateMachine();
const nfcComponent = new NfcPanel();
nfcComponent.bindMachine(nfcMachine);

nfcMachine.send({ type: 'START_SCAN' });
console.assert(nfcComponent.state === 'scanning', `Component state synced to scanning, got ${nfcComponent.state}`);

nfcMachine.send({
    type: 'TAG_DETECTED',
    model: 3,
    payload: { noteId: '0xnote123', salt: '0xsalt123', value: 1000n },
    tagType: 'ntag424_dna',
});
console.assert(nfcComponent.state === 'tag_read', `Component state synced to tag_read, got ${nfcComponent.state}`);
console.assert(nfcComponent.model === 3, "Detected Model 3 tag");

nfcMachine.send({ type: 'VERIFY_PROOF', pin: '1234' });
nfcMachine.send({ type: 'PROOF_VERIFIED', nullifier: '0xnullifier999' });
console.assert(nfcComponent.state === 'absorbing', `Component state synced to absorbing, got ${nfcComponent.state}`);
console.assert(nfcComponent.nullifier === '0xnullifier999', "Nullifier populated");

nfcMachine.send({ type: 'ABSORB_SUCCESS' });
console.assert(nfcComponent.state === 'done', `Component state synced to done, got ${nfcComponent.state}`);
console.log("   ✅ NfcStateMachine and <nfc-panel> binding verified.");

// 3. JurisdictionStateMachine & <jurisdiction-panel> test
const jurMachine = new JurisdictionStateMachine();
const jurComponent = new JurisdictionPanel();
jurComponent.bindMachine(jurMachine);

jurMachine.send({ type: 'LOAD', address: '0x1111111111111111111111111111111111111111' });
console.assert(jurComponent.state === 'loading', `Jurisdiction state loading, got ${jurComponent.state}`);

jurMachine.send({
    type: 'LOAD_SUCCESS',
    compliant: true,
    activeBits: 0x01n,
    lotlRoot: '0x0d54d1839541b0c9c2bb55ceffb33022963aa605e6444922959a8ed3e81377cc',
    allowLegacy: false,
    isQuantumSecure: true,
});
console.assert(jurComponent.state === 'ready', `Jurisdiction state ready, got ${jurComponent.state}`);
console.assert(jurComponent.compliant === true, "Compliance bit resolved true");
console.assert(jurComponent.isQuantumSecure === true, "Quantum secure policy active");

jurComponent.toggleAllowLegacy();
console.assert(jurComponent.allowLegacy === true, "ALLOW_LEGACY toggled to true");
console.assert(jurComponent.isQuantumSecure === false, "Quantum security policy lowered on legacy toggle");
console.log("   ✅ JurisdictionStateMachine and <jurisdiction-panel> verified.");

// 4. <fediverse-panel> component instantiation & defaults
const fediComponent = new FediversePanel();
console.assert(fediComponent.rpcUrl === '/rpc', "Default rpcUrl should be /rpc");
console.assert(Array.isArray(fediComponent.notes), "Notes array initialized");
console.log("   ✅ <fediverse-panel> component defaults verified.");

// 5. <sovereign-debugger> component analysis
const dbgComponent = new SovereignDebuggerElement();
dbgComponent.inputPayload = '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001941637469766520444944206e6f74207265676973746572656400000000000000';
await dbgComponent.analyze();
console.assert(dbgComponent.analysisResult !== null, "Debugger analysis completed");
console.assert(dbgComponent.analysisResult?.decodedRevert?.message === 'Active DID not registered', "Revert message correctly parsed");
console.log("   ✅ <sovereign-debugger> element dissection verified.");

expMachine.stop();
nfcMachine.stop();
jurMachine.stop();

console.log("\n🎉 All Sovereign Paneling & Machine Subsystem Unit Tests Passed Successfully!\n");
