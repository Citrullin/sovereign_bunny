import assert from 'assert';
import { AuthorityPanelStateMachine } from '../../src/components/authority_machine.js';
import {
    GraphExplorer,
    GraphData,
    GraphNode,
    AuthorityPlugin
} from '../../src/components/graph_explorer.js';

console.log("🛡️ Running X-Road Authority, Court Order & View Key Traversal Tests...\n");

// 1. Test AuthorityPanelStateMachine Initial State & Loading
console.log("1. Testing AuthorityPanelStateMachine Lifecycle...");
const machine = new AuthorityPanelStateMachine();
let snap = machine.getSnapshot();
assert.strictEqual(snap.value, 'idle', "Initial state must be idle");

const testCertChain = [
    { role: 'NationalRoot', certHash: '0x4444444444444444444444444444444444444444444444444444444444444444', label: 'BSI Germany Root CA' },
    { role: 'Ministry', certHash: '0x3333333333333333333333333333333333333333333333333333333333333333', label: 'Federal Ministry of Finance' },
    { role: 'Supervisor', certHash: '0x2222222222222222222222222222222222222222222222222222222222222222', label: 'BaFin Division VII' },
    { role: 'Investigator', certHash: '0x1111111111111111111111111111111111111111111111111111111111111111', label: 'UNIT_7 Special Inquiry' },
];

const testCourtOrder = {
    documentHash: '0x7777777777777777777777777777777777777777777777777777777777777777',
    targetAccount: '0x3000000000000000000000000000000000000003',
    mandate: 'Section 44b KWG Compliance Audit',
    issuedEpoch: 100,
};

machine.send({
    type: 'LOAD_AUTHORITY',
    authorityId: 'bafin_unit7',
    authorityAddress: '0x1000000000000000000000000000000000000001',
    jurisdiction: 'EU / Germany',
    courtOrder: testCourtOrder,
    certChain: testCertChain,
});

snap = machine.getSnapshot();
assert.strictEqual(snap.value, 'inspecting', "State should transition to inspecting after LOAD_AUTHORITY");
assert.strictEqual(snap.context.certChain.length, 4, "Context should hold 4 cert chain steps");
assert.strictEqual(snap.context.targetAccount, testCourtOrder.targetAccount, "Target account must match court order");
console.log("   ✅ Authority loading, cert chain, and court order context verified.");

// 2. Test Path Traversal Transition in Machine
console.log("\n2. Testing Path Traversal event...");
machine.send({
    type: 'TRAVERSE_AUDIT_PATH',
    sourceId: 'bafin_unit7',
    targetId: testCourtOrder.targetAccount,
    path: ['bafin_unit7', 'dao_safe', testCourtOrder.targetAccount],
});
snap = machine.getSnapshot();
assert.strictEqual(snap.value, 'path_highlighted', "State should transition to path_highlighted");
assert.strictEqual(snap.context.highlightedPath.length, 3, "Highlighted path length should be 3");
console.log("   ✅ Path traversal event verified.");

// 3. Test DAO Confirmation & Viewing Key Reveal
console.log("\n3. Testing DAO Approval and Ephemeral Viewing Key Reveal...");
machine.send({
    type: 'SUBMIT_DAO_CONFIRMATION',
    daoAddress: '0x4000000000000000000000000000000000000004',
    approved: true,
});
snap = machine.getSnapshot();
assert.strictEqual(snap.value, 'dao_approved', "State should transition to dao_approved on approval");

// Reveal viewing key to authority gossip topic
const ephemeralViewingKey = '0xviewing_key_ephemeral_unit7_audit_100';
const sampleDecryptedNotes = [
    {
        commitment: '0x8888888888888888888888888888888888888888888888888888888888888888',
        targetSlot: 2,
        amount: '50 TBL',
        decryptedPayload: { securities_settlement: 'ISIN_DE000BAY0017', trade_date: '2026-09-26' },
    },
];

machine.send({
    type: 'REVEAL_VIEWING_KEY',
    viewingKey: ephemeralViewingKey,
    notes: sampleDecryptedNotes,
});
snap = machine.getSnapshot();
assert.strictEqual(snap.value, 'viewing_revealed', "State should transition to viewing_revealed");
assert.strictEqual(snap.context.viewingKey, ephemeralViewingKey, "Viewing key must be stored in context");
assert.strictEqual(snap.context.revealedNotes.length, 1, "Decrypted notes should be available");
console.log("   ✅ DAO approval and viewing key reveal lifecycle verified.");

// 4. Test GraphExplorer highlightPath() BFS Algorithm
console.log("\n4. Testing GraphExplorer highlightPath() Graph Traversal...");
const explorer = new GraphExplorer();

const authNode: GraphNode = {
    id: 'bafin_unit7',
    label: 'BaFin UNIT_7 Market Supervision',
    type: 'xroad_authority',
    address: '0x1000000000000000000000000000000000000001',
    metadata: {
        jurisdiction: 'EU / Germany',
        cert_chain: testCertChain,
        court_order: testCourtOrder,
    },
    slots: [{ slotId: 5, pluginId: 'governance.xroad', commitment: '0x5555555555555555555555555555555555555555555555555555555555555555' }],
};

const daoNode: GraphNode = {
    id: 'dao_safe',
    label: 'Europe Sovereign Safe DAO',
    type: 'global_dao',
    address: '0x4000000000000000000000000000000000000004',
    votingWeightBps: 10000,
};

const targetAccountNode: GraphNode = {
    id: testCourtOrder.targetAccount,
    label: 'Audited Treasury Account',
    type: 'smart_contract',
    address: testCourtOrder.targetAccount,
    notes: [
        {
            commitment: '0x8888888888888888888888888888888888888888888888888888888888888888',
            targetSlot: 2,
            isShielded: true,
            amountFormatted: '50 TBL',
            decryptedPayload: { securities_settlement: 'ISIN_DE000BAY0017' },
        },
    ],
};

const fullAuditGraph: GraphData = {
    nodes: [authNode, daoNode, targetAccountNode],
    edges: [
        { source: 'bafin_unit7', target: 'dao_safe', relation: 'court_order_warrant' },
        { source: 'dao_safe', target: testCourtOrder.targetAccount, relation: 'auditor_review' },
    ],
};

explorer.setGraphData(fullAuditGraph);
explorer.selectNode('bafin_unit7');

// Trigger highlightPath from BaFin to Target Account
const resolvedPath = explorer.highlightPath('bafin_unit7', testCourtOrder.targetAccount);
assert.deepStrictEqual(resolvedPath, ['bafin_unit7', 'dao_safe', testCourtOrder.targetAccount]);
assert.deepStrictEqual(explorer.getHighlightedPath(), resolvedPath);

// Verify AuthorityPlugin rendering includes Cert Chain and Court Order
const renderedHtml = AuthorityPlugin.renderDetails(authNode, {
    graph: fullAuditGraph,
    selectNode: () => {},
    highlightPath: () => {},
    navigateRoute: () => {},
}) as string;

assert.ok(renderedHtml.includes('BSI Germany Root CA'), "Cert chain root must be rendered");
assert.ok(renderedHtml.includes('UNIT_7 Special Inquiry'), "Investigator step must be rendered");
assert.ok(renderedHtml.includes('Section 44b KWG Compliance Audit'), "Court order mandate must be rendered");
assert.ok(renderedHtml.includes('Traverse Audit Graph to Target'), "Traverse button must be rendered");

console.log("   ✅ Graph traversal BFS algorithm & AuthorityPlugin rendering verified.");

console.log("\n🎉 All X-Road Authority & XState Machine Tests Passed Successfully!");
