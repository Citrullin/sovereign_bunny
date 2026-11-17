import assert from 'assert';
import { SovereignTelemetryPanelElement } from '../../src/components/sovereign_telemetry_panel.js';
import { GraphExplorer } from '../../src/components/graph_explorer.js';

console.log("📊 Running Terminal Telemetry & EVM Wallet Integration Unit Tests...\n");

// Mock environment
const win = (globalThis as any).window || (globalThis as any);
(globalThis as any).window = win;

// 1. Terminal Data Moat and Topology Isolation
console.log("1. Testing Terminal Data Moat topology generation & dataset separation...");
const telemetryPanel = new SovereignTelemetryPanelElement();
const testAddress = '0x1111111111111111111111111111111111111111';

// Generate Bloomberg Terminal Data Moat Graph
const terminalMoatGraph = telemetryPanel.getTerminalDataMoatGraph(testAddress);
assert.ok(terminalMoatGraph, "Terminal data moat graph must be generated");
assert.ok(Array.isArray(terminalMoatGraph.nodes), "Must have nodes array");
assert.ok(Array.isArray(terminalMoatGraph.edges), "Must have edges array");

// Verify Bloomberg Terminal data nodes: Subsidized (10 bps), Quantized (100 bps), Sovereign Dark (500 bps), 0x53, 0x54, Bloomberg aggregator
const nodeIds = terminalMoatGraph.nodes.map((n: any) => n.id);
assert.ok(nodeIds.includes(testAddress), "Should include principal address node");
assert.ok(nodeIds.includes('moat:tier-subsidized'), "Should include Subsidized feed node");
assert.ok(nodeIds.includes('moat:tier-quantized'), "Should include Quantized feed node");
assert.ok(nodeIds.includes('moat:tier-dark'), "Should include Sovereign Dark feed node");
assert.ok(nodeIds.includes('precompile:0x53'), "Should include precompile 0x53");
assert.ok(nodeIds.includes('precompile:0x54'), "Should include precompile 0x54");
assert.ok(nodeIds.includes('validator:stream-bloomberg'), "Should include Bloomberg Market Moat Aggregator node");

// Verify personal explorer isolation: window.sovereignGraphExplorer is NOT overwritten by terminal-graph-explorer
const personalExplorer = new GraphExplorer();
personalExplorer.id = 'sovereign-graph-explorer';
win.sovereignGraphExplorer = personalExplorer;

const terminalExplorer = new GraphExplorer();
terminalExplorer.id = 'terminal-graph-explorer';
// Ensure setting id does not replace global reference
assert.strictEqual(win.sovereignGraphExplorer, personalExplorer, "Global sovereignGraphExplorer must remain personal explorer");

// Populate terminal graph explorer with terminal data moat
terminalExplorer.setGraphData(terminalMoatGraph);
assert.strictEqual(terminalExplorer.getGraphData().nodes.length, terminalMoatGraph.nodes.length, "Terminal graph explorer must contain Bloomberg data moat");

// Personal explorer retains its independent dataset
const personalData = {
    nodes: [{ id: '0x9999999999999999999999999999999999999999', label: 'Personal Genesis Root', type: 'human_account' as const, address: '0x9999999999999999999999999999999999999999' }],
    edges: []
};
personalExplorer.setGraphData(personalData);
assert.strictEqual(personalExplorer.getGraphData().nodes.length, 1);
assert.strictEqual(personalExplorer.getGraphData().nodes[0].id, '0x9999999999999999999999999999999999999999');
assert.notStrictEqual(personalExplorer.getGraphData(), terminalExplorer.getGraphData(), "Personal and Terminal datasets must remain completely isolated");
console.log("   ✅ Terminal data moat generation and explorer dataset isolation verified.");

// 2. EVM Wallet Connection Dispatch
console.log("\n2. Testing EVM Wallet connection invocation (wallet_requestPermissions / eth_requestAccounts)...");
let requestedMethods: string[] = [];
let requestedParams: any[] = [];

win.ethereum = {
    request: async (args: { method: string; params?: any[] }) => {
        requestedMethods.push(args.method);
        requestedParams.push(args.params);
        if (args.method === 'wallet_requestPermissions') {
            return [{ caveats: [{ name: 'exposedAccounts', value: ['0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'] }] }];
        }
        if (args.method === 'eth_requestAccounts') {
            return ['0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'];
        }
        if (args.method === 'personal_sign') {
            return '0xsignature123';
        }
        if (args.method === 'eth_sendTransaction') {
            return '0x' + '9'.repeat(64);
        }
        return null;
    }
};

telemetryPanel.state.connectedAddress = null;
await telemetryPanel.triggerConnectOrUnlock();

assert.ok(
    requestedMethods.includes('wallet_requestPermissions') || requestedMethods.includes('eth_requestAccounts'),
    "Must invoke interactive EVM wallet permissions or account request"
);
assert.strictEqual(telemetryPanel.state.connectedAddress, '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B');
console.log("   ✅ EVM wallet interactive prompt requested and address connected successfully.");

// 3. Pure Crypto Mode Requires EVM Signature on Tier Switch
console.log("\n3. Testing Pure Crypto Mode EVM signature prompt on tier selection...");
win.walletCryptoWrap = 'pure';
requestedMethods = [];

await telemetryPanel.selectTier('SovereignDark');
assert.ok(requestedMethods.includes('personal_sign'), "Pure mode must request EVM personal_sign signature");
assert.strictEqual(telemetryPanel.state.currentTier, 'SovereignDark');
assert.strictEqual(telemetryPanel.state.feeMultiplierBps, 1000);
assert.strictEqual(telemetryPanel.state.permitsEmission, false);
console.log("   ✅ Pure mode personal_sign signature requested and SovereignDark tier activated.");

// 4. Fallback when permissions rejected
console.log("\n4. Testing rejected EVM signature handling...");
win.ethereum.request = async (args: { method: string }) => {
    if (args.method === 'personal_sign') {
        throw new Error('User rejected the transaction');
    }
    return null;
};

await telemetryPanel.selectTier('Subsidized');
assert.strictEqual(telemetryPanel.state.currentTier, 'SovereignDark', "Tier must not change when EVM signature is rejected");
assert.strictEqual(telemetryPanel.state.statusType, 'error');
assert.ok(telemetryPanel.state.statusMessage?.includes('EVM Signature Rejected'), "Must display rejection message");
console.log("   ✅ EVM signature rejection handled cleanly.");

// 5. Unconnected User Clicking Tier Sign-Up Proactively Requests EVM Wallet & Signs
console.log("\n5. Testing unconnected user tier sign-up triggers EVM wallet prompt & signing...");
const unauthPanel = new SovereignTelemetryPanelElement();
unauthPanel.state.connectedAddress = null;
win.connectedAddress = null;
if (win.currentKeys) win.currentKeys = null;

let unauthRequestedMethods: string[] = [];
win.ethereum = {
    request: async (args: { method: string; params?: any[] }) => {
        unauthRequestedMethods.push(args.method);
        if (args.method === 'wallet_requestPermissions') {
            return [{ caveats: [{ name: 'exposedAccounts', value: ['0x2222222222222222222222222222222222222222'] }] }];
        }
        if (args.method === 'eth_requestAccounts') {
            return ['0x2222222222222222222222222222222222222222'];
        }
        if (args.method === 'personal_sign') {
            return '0xsig_approved';
        }
        if (args.method === 'eth_sendTransaction') {
            return '0x' + '8'.repeat(64);
        }
        return null;
    }
};

await unauthPanel.selectTier('Subsidized');
assert.ok(
    unauthRequestedMethods.includes('wallet_requestPermissions') || unauthRequestedMethods.includes('eth_requestAccounts'),
    "Unconnected user must be prompted for EVM wallet connection first"
);
assert.ok(unauthRequestedMethods.includes('personal_sign'), "User must be prompted for personal_sign approval");
assert.strictEqual(unauthPanel.state.connectedAddress, '0x2222222222222222222222222222222222222222');
assert.strictEqual(unauthPanel.state.currentTier, 'Subsidized');
assert.strictEqual(unauthPanel.state.statusType, 'success');
console.log("   ✅ Unconnected user clicking tier sign-up triggers wallet connection and personal_sign.");

console.log("\n🎉 All Terminal Telemetry & EVM Wallet Unit Tests Passed Successfully!");

