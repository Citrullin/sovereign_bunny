import assert from 'assert';
import {
    GraphExplorer,
    GraphData,
    GraphNode,
    AuthorityPlugin
} from '../../src/components/graph_explorer.js';

console.log("🛡️ Running Relationship-Native ReBAC Audit & Graph Traversal Tests...\n");

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

// 1. Test GraphExplorer highlightPath() BFS Algorithm with Dynamic ReBAC Auditing
console.log("1. Testing GraphExplorer highlightPath() Graph Traversal...");
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

console.log("\n🎉 All Relationship-Native ReBAC Audit Tests Passed Successfully!");
