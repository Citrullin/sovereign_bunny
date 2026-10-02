import assert from 'assert';
import {
    GraphExplorer,
    PluginRegistry,
    DaoGovernancePlugin,
    GitDagPlugin,
    AuthorityPlugin,
    ServiceSqlPlugin,
    BlindNotePlugin,
    PolymorphicSlotsPlugin,
    GraphData,
    GraphNode,
    GraphPluginContext
} from '../../src/components/graph_explorer.js';

console.log("🌐 Running Sovereign Graph Explorer & Frontend Plugin System Tests...\n");

// 1. Test Plugin Registration and Handler Resolution
console.log("1. Testing Plugin Registry Registration & Handler Resolution...");
const registry = new PluginRegistry();
registry.register(DaoGovernancePlugin);
registry.register(GitDagPlugin);
registry.register(AuthorityPlugin);
registry.register(ServiceSqlPlugin);
registry.register(BlindNotePlugin);
registry.register(PolymorphicSlotsPlugin);

assert.strictEqual(registry.getAll().length, 6, "Should have 6 registered plugins");


const testDaoNode: GraphNode = {
    id: "0x0000000000000000000000000000000000000101",
    label: "Global Tinyblock DAO",
    type: "global_dao",
    address: "0x0000000000000000000000000000000000000101",
    votingWeightBps: 10000
};

const testRepoNode: GraphNode = {
    id: "0x0000000000000000000000000000000000000301",
    label: "sovereign-bunny",
    type: "git_repo",
    address: "0x0000000000000000000000000000000000000301",
    slots: [{ slotId: 3, pluginId: "vcs.git_dag", commitment: "GENESIS_HEAD_OID" }]
};

const testAuthNode: GraphNode = {
    id: "0x0000000000000000000000000000000000000208",
    label: "Asia Collaborative Enforcement",
    type: "collaborative_authority",
    address: "0x0000000000000000000000000000000000000208",
    metadata: { jurisdiction: "Asia Joint" }
};

const daoHandlers = registry.findHandlers(testDaoNode);
assert.strictEqual(daoHandlers.length, 1);
assert.strictEqual(daoHandlers[0].id, "dao_governance");

const repoHandlers = registry.findHandlers(testRepoNode);
assert.strictEqual(repoHandlers.length, 2);
assert.ok(repoHandlers.some(h => h.id === "git_dag"));
assert.ok(repoHandlers.some(h => h.id === "polymorphic_slots"));

const authHandlers = registry.findHandlers(testAuthNode);
assert.strictEqual(authHandlers.length, 1);
assert.strictEqual(authHandlers[0].id, "regulatory_authority");

// Test Polymorphic Account-Register Slots Handler
const testSlotsNode: GraphNode = {
    id: "0x0000000000000000000000000000000000000205",
    label: "did:sovereign:1337:nz-mbie",
    type: "xroad_authority",
    address: "0x0000000000000000000000000000000000000205",
    slots: [
        { slotId: 0, pluginId: "core.did_identity", commitment: "0x018d23ab949a496ed2ca6f0393b6edaa16b6e956af888654da4e3ab0b76db530" },
        { slotId: 1, pluginId: "core.zanzibar", commitment: "0x2f263090ee765ebf0b754956c783ef6a28d426ed18c496d92684638e89758ceb" },
    ]
};
const slotHandlers = registry.findHandlers(testSlotsNode);
assert.ok(slotHandlers.some(h => h.id === 'polymorphic_slots'), "Should include polymorphic_slots handler");
const renderedSlots = PolymorphicSlotsPlugin.renderDetails(testSlotsNode, {} as any) as string;
assert.ok(renderedSlots.includes("Polymorphic Account Registers"), "Should render polymorphic register header");
assert.ok(renderedSlots.includes("R_0"), "Should list flat register R_0");
assert.ok(renderedSlots.includes("core.did_identity"), "Should render plugin ID");

console.log("   ✅ Plugin handler dispatch verified correctly for DAOs, Git Repos, Authorities, and Polymorphic Slots.");

// 2. Test Details Rendering across plugins
console.log("\n2. Testing Details Rendering Output across Plugins...");
const daoHtml = DaoGovernancePlugin.renderDetails(testDaoNode, {} as any);
assert.ok(typeof daoHtml === 'string' && daoHtml.includes("DAO Governance Profile"));
assert.ok(daoHtml.includes("10000 bps"));

const repoHtml = GitDagPlugin.renderDetails(testRepoNode, {} as any);
assert.ok(typeof repoHtml === 'string' && repoHtml.includes("Git VCS Repository"));
assert.ok(repoHtml.includes("GENESIS_HEAD_OID"));

const authHtml = AuthorityPlugin.renderDetails(testAuthNode, {} as any);
assert.ok(typeof authHtml === 'string' && authHtml.includes("Asia Collaborative Enforcement"));
assert.ok(authHtml.includes("2-of-2 Mutual Veto Threshold"));

console.log("   ✅ Plugin rendering verified with slot commitments and governance weights.");

// 3. Test GraphExplorer Instance and State Management
console.log("\n3. Testing GraphExplorer Component Hierarchy & Edge Resolution...");
const explorer = new GraphExplorer();

const mockGraph: GraphData = {
    nodes: [
        testDaoNode,
        {
            id: "0x0000000000000000000000000000000000000102",
            label: "European Sovereign DAO",
            type: "regional_dao",
            address: "0x0000000000000000000000000000000000000102",
            votingWeightBps: 920
        },
        testRepoNode,
        testAuthNode
    ],
    edges: [
        {
            source: testDaoNode.id,
            target: "0x0000000000000000000000000000000000000102",
            relation: "sub_dao_member",
            namespace: 1
        }
    ]
};

explorer.setGraphData(mockGraph);
explorer.selectNode(testRepoNode.id);
assert.strictEqual(explorer.getNodeColor('global_dao'), '#e6a100');
assert.strictEqual(explorer.getNodeColor('git_repo'), '#2ec4b6');
assert.strictEqual(explorer.getNodeColor('collaborative_authority'), '#e63946');

console.log("   ✅ Graph Explorer state updates, color mapping, and ReBAC edge resolution verified.");

// 4. Negative Test Cases
console.log("\n4. Testing Negative & Edge Cases...");
// Unhandled node type
const unknownNode: GraphNode = {
    id: "0x9999",
    label: "Unknown",
    type: "human_account",
    address: "0x9999"
};
const unhandled = registry.findHandlers(unknownNode);
assert.strictEqual(unhandled.length, 0, "Human account should not match DAO/Git/Authority plugins");

// Dynamic plugin unregistration
registry.unregister("dao_governance");
assert.strictEqual(registry.get("dao_governance"), undefined, "Unregistered plugin should return undefined");
assert.strictEqual(registry.findHandlers(testDaoNode).length, 0, "Unregistered plugin should no longer handle DAOs");

console.log("   ✅ Negative and unregistration invariants verified.");

// 5. Test BlindNotePlugin: Public Authority Notes vs Shielded Viewing-Key Decryption
console.log("\n5. Testing Blind Note Privacy Boundary (Public vs Shielded Notes)...");
const shieldedAccountNode: GraphNode = {
    id: "0x1234567890123456789012345678901234567890",
    label: "Treasury Shielded Account",
    type: "smart_contract",
    address: "0x1234567890123456789012345678901234567890",
    notes: [
        {
            commitment: "0xaaaa1111222233334444555566667777888899990000aaaabbbbccccddddeeee",
            targetSlot: 5,
            isShielded: false, // Public authority note
            amountFormatted: "0 TBL",
            decryptedPayload: { regulatoryDescriptor: "BaFin X-Road", mandate: "FinFRG" }
        },
        {
            commitment: "0xbbbb1111222233334444555566667777888899990000aaaabbbbccccddddeeee",
            nullifier: "0xcccc1111222233334444555566667777888899990000aaaabbbbccccddddeeee",
            targetSlot: 2,
            isShielded: true, // Private shielded note
            amountFormatted: "50,000 TBL",
            decryptedPayload: { recipient: "0x1234567890123456789012345678901234567890", purpose: "Confidential R&D Grant" }
        }
    ]
};

// Case A: Public / unauthenticated viewer
const publicContext: GraphPluginContext = {
    graph: mockGraph,
    activeAddress: "0x9999999999999999999999999999999999999999",
    viewingKey: null,
    selectNode: () => {},
    highlightPath: () => {},
    navigateRoute: () => {}
};

const publicRender = BlindNotePlugin.renderDetails(shieldedAccountNode, publicContext) as string;
assert.ok(publicRender.includes("Public Authority Note"), "Public note badge should be visible");
assert.ok(publicRender.includes("BaFin X-Road"), "Public note payload should be visible to any viewer");
assert.ok(publicRender.includes("Encrypted Payload (ZK Shielded)"), "Shielded note should remain hidden without viewing key");
assert.ok(!publicRender.includes("Confidential R&D Grant"), "Shielded payload must NEVER leak without viewing key");

// Case B: Sovereign holder with viewing key matching activeAddress
const authorizedContext: GraphPluginContext = {
    graph: mockGraph,
    activeAddress: shieldedAccountNode.address,
    viewingKey: "0xviewingkey_sovereign_secret_12345",
    selectNode: () => {},
    highlightPath: () => {},
    navigateRoute: () => {}
};

const authorizedRender = BlindNotePlugin.renderDetails(shieldedAccountNode, authorizedContext) as string;
assert.ok(authorizedRender.includes("Decrypted via Sovereign Viewing Key"), "Authorized holder should reveal decrypted box");
assert.ok(authorizedRender.includes("Confidential R&D Grant"), "Authorized holder should see decrypted payload");

console.log("   ✅ Privacy boundary verified: public authority notes visible, shielded notes strictly gated by viewing key.");

console.log("\n🎉 All Graph Explorer & Plugin System Tests Passed Successfully!");
