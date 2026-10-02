import assert from 'node:assert';
import { AccountStorageManager, MemoryStorageBackend } from '../../src/storage_manager.js';
import { GraphExplorer } from '../../src/components/graph_explorer.js';
import { ZodiacDaoPanel } from '../../src/components/zodiac_dao_panel.js';
import { deriveNullifier } from '../../src/circuits.js';

console.log("🔒 Running Sovereign Account Isolation & Privacy Boundary Negative Tests...\n");

// -------------------------------------------------------------
// 1. Storage Isolation: Account A vs Account B
// -------------------------------------------------------------
console.log("1. Testing AccountStorageManager cross-account storage isolation...");
const backend = new MemoryStorageBackend();
const sm = new AccountStorageManager(backend);

const addrA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const addrB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

// Write Account A data
sm.saveAccountKeys(addrA, {
    pqPrivateKey: "secret_dilithium_key_A",
    pqPublicKey: "pub_dilithium_key_A",
    didDocument: JSON.stringify({ id: `did:sovereign:1337:${addrA}` })
});
sm.saveBlindNote(addrA, {
    commitment: "0x1111111111111111111111111111111111111111111111111111111111111111",
    assetId: "TBL",
    amount: "10000000000000000000",
    sender: "0x9999999999999999999999999999999999999999",
    recipient: addrA,
    isShielded: true,
    status: 'unspent'
});
sm.saveViewingKeys(addrA, {
    secretKey: "viewing_key_secret_A",
    publicKey: "viewing_key_pub_A"
});
sm.saveActivityPubNote(addrA, {
    id: "note-1-a",
    actor_address: addrA,
    content: "Private confidential post from Alice",
    timestamp: Date.now()
});
sm.saveTransaction(addrA, {
    hash: "0xtx_a_1",
    type: "send",
    timestamp: Date.now(),
    amount: "5"
});

// NEGATIVE ASSERTION: Account B MUST have zero access to Account A's state
const keysB = sm.getAccountKeys(addrB);
assert.strictEqual(keysB.pqPrivateKey, undefined, "NEG-01: Account B must not see Account A's private key");
assert.strictEqual(keysB.pqPublicKey, undefined, "NEG-01: Account B must not see Account A's public key");

const notesB = sm.getBlindNotes(addrB);
assert.strictEqual(notesB.length, 0, "NEG-01: Account B must have 0 blind notes");

const vkB = sm.getViewingKeys(addrB);
assert.strictEqual(vkB.secretKey, undefined, "NEG-01: Account B must not see Account A's viewing key");

const apB = sm.getActivityPubNotes(addrB);
assert.strictEqual(apB.length, 0, "NEG-02: Account B must not see Account A's ActivityPub outbox notes");

const txsB = sm.getTransactionHistory(addrB);
assert.strictEqual(txsB.length, 0, "NEG-03: Account B must not see Account A's transaction history");

// Write Account B data
sm.saveBlindNote(addrB, {
    commitment: "0x2222222222222222222222222222222222222222222222222222222222222222",
    assetId: "TBL",
    amount: "2000000000000000000",
    sender: "0x8888888888888888888888888888888888888888",
    recipient: addrB,
    isShielded: true,
    status: 'unspent'
});

assert.strictEqual(sm.getBlindNotes(addrB).length, 1, "Account B has 1 note");
assert.strictEqual(sm.getBlindNotes(addrA).length, 1, "Account A has 1 note");

// Clearing Account A's notes must NOT affect Account B
sm.clearBlindNotes(addrA);
assert.strictEqual(sm.getBlindNotes(addrA).length, 0, "Account A notes cleared");
assert.strictEqual(sm.getBlindNotes(addrB).length, 1, "Account B note remains untouched");

console.log("   ✅ AccountStorageManager cross-account isolation verified.");

// -------------------------------------------------------------
// 2. Graph Explorer Visibility Privacy Boundary
// -------------------------------------------------------------
console.log("\n2. Testing GraphExplorer Zanzibar ReBAC visibility boundary...");
const explorer = new GraphExplorer();

const sampleTopology = {
    nodes: [
        {
            id: "0x0000000000000000000000000000000000000201",
            label: "Public Sovereign Authority",
            type: "xroad_authority",
            address: "0x0000000000000000000000000000000000000201"
        },
        {
            id: "0xa11ce00000000000000000000000000000000001",
            label: "DAO Admin Root",
            type: "dao_admin",
            address: "0xa11ce00000000000000000000000000000000001"
        },
        {
            id: "0xdao0000000000000000000000000000000000001",
            label: "Internal European DAO Node",
            type: "dao_entity",
            address: "0xdao0000000000000000000000000000000000001"
        },
        {
            id: "0xshielded00000000000000000000000000000001",
            label: "Shielded Account Entity",
            type: "shielded_account",
            address: "0xshielded00000000000000000000000000000001"
        },
        {
            id: "0x0000000000000000000000000000000000000101",
            label: "Genesis Global DAO",
            type: "global_dao",
            address: "0x0000000000000000000000000000000000000101"
        },
        {
            id: addrB,
            label: "User B Account",
            type: "human_account",
            address: addrB
        }
    ],
    edges: [
        {
            source: "0xa11ce00000000000000000000000000000000001",
            target: "0xdao0000000000000000000000000000000000001",
            relation: "admin"
        },
        {
            source: "0xdao0000000000000000000000000000000000001",
            target: "0xshielded00000000000000000000000000000001",
            relation: "member"
        }
    ]
};

explorer.setGraphData(sampleTopology as any);

// Test 2A: Unprivileged User B (No admin relation, no viewing key)
explorer.setViewingContext(addrB, null);
const userBNodes = (explorer as any)._getFilteredNodes();

// NEGATIVE ASSERTION: User B MUST NOT see Internal European DAO Node or Shielded Account
const userBNodeIds = userBNodes.map((n: any) => n.id.toLowerCase());
assert.ok(userBNodeIds.includes("0x0000000000000000000000000000000000000201"), "Public authority must be visible to User B");
assert.ok(userBNodeIds.includes(addrB.toLowerCase()), "User B must see their own account node");
assert.strictEqual(
    userBNodeIds.includes("0xdao0000000000000000000000000000000000001"),
    false,
    "NEG-04: User B MUST NOT see private DAO entity without relation"
);
assert.strictEqual(
    userBNodeIds.includes("0xshielded00000000000000000000000000000001"),
    false,
    "NEG-04: User B MUST NOT see shielded account entity without viewing key"
);
assert.strictEqual(
    userBNodeIds.includes("0xa11ce00000000000000000000000000000000001"),
    false,
    "NEG-04: User B MUST NOT see DAO admin without an edge"
);
assert.strictEqual(
    userBNodeIds.includes("0x0000000000000000000000000000000000000101"),
    false,
    "NEG-04: User B MUST NOT see Genesis Global DAO despite low-entropy 0x000... address prefix without relation"
);

// Toolbar count leak prevention check:
const userBAuthorized = (explorer as any)._getAuthorizedNodes();
assert.strictEqual(userBAuthorized.length, 2, "User B only has 2 authorized nodes in sample topology");
const userBHtml = explorer.render();
const renderedHtmlStr = typeof userBHtml === 'string'
    ? userBHtml
    : ((userBHtml as any)?.values?.[0] || (userBHtml as any)?.strings?.join('') || '');
assert.ok(renderedHtmlStr.includes("All (2)"), "Toolbar reflects exactly authorized count (All (2)), not global count");
assert.ok(!renderedHtmlStr.includes("DAOs ("), "Toolbar does not leak DAOs category when user has 0 DAO access");
assert.ok(!renderedHtmlStr.includes("Admin ("), "Toolbar does not leak Admin category when user has 0 admin access");

// Test 2B: Root Admin Account (has admin relation on DAO entity)
const adminAddr = "0xa11ce00000000000000000000000000000000001";
explorer.setViewingContext(adminAddr, null);
const adminNodes = (explorer as any)._getFilteredNodes();
const adminNodeIds = adminNodes.map((n: any) => n.id.toLowerCase());

assert.ok(adminNodeIds.includes(adminAddr.toLowerCase()), "Admin sees own node");
assert.ok(adminNodeIds.includes("0xdao0000000000000000000000000000000000001"), "Admin sees DAO node via admin relation");
assert.ok(adminNodeIds.includes("0xshielded00000000000000000000000000000001"), "Admin sees member node");

// Test 2C: User with valid viewing key sees the full authorized topology
explorer.setViewingContext(addrB, "0xviewing_key_authorized_12345");
const viewingKeyNodes = (explorer as any)._getFilteredNodes();
assert.strictEqual(viewingKeyNodes.length, sampleTopology.nodes.length, "Viewing key holder sees all authorized nodes");

console.log("   ✅ GraphExplorer Zanzibar ReBAC visibility boundary verified.");

// -------------------------------------------------------------
// 3. Zodiac Safe DAO Panel Privacy Isolation
// -------------------------------------------------------------
console.log("\n3. Testing ZodiacDaoPanel cross-wallet membership privacy isolation...");
const daoPanel = new ZodiacDaoPanel();

// Case 3A: Disconnected / unauthorized user (User B)
daoPanel.setActiveAddress(addrB, null);
assert.strictEqual((daoPanel as any)._isAuthorizedForDao(), false, "NEG-05: User B is not authorized for Zodiac DAO");
assert.ok(daoPanel.innerHTML.includes("No Active Zodiac Safe DAO Memberships"), "NEG-05: Unauthorized user sees isolated vault placeholder");
assert.ok(!daoPanel.innerHTML.includes("dao_global/tinyblock_treasury_solvency"), "NEG-05: Unauthorized user must not see treasury datasets");

// Case 3B: Authorized DAO Owner (Node 0)
const daoOwner = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
daoPanel.setActiveAddress(daoOwner, null);
assert.strictEqual((daoPanel as any)._isAuthorizedForDao(), true, "Owner is authorized for Zodiac DAO");
assert.ok(daoPanel.innerHTML.includes("Zodiac Safe DAO • Stateless Zanzibar ReBAC"), "Authorized owner sees full Zodiac DAO details");
assert.ok(daoPanel.innerHTML.includes("Tinyblock Global DAO"), "Authorized owner sees Tinyblock Global DAO");
assert.ok(daoPanel.innerHTML.includes("dao_global/tinyblock_treasury_solvency"), "Authorized owner sees Tinyblock treasury dataset");

// Case 3C: User B with viewing key
daoPanel.setActiveAddress(addrB, "0xviewing_key_override_secret");
assert.strictEqual((daoPanel as any)._isAuthorizedForDao(), true, "Viewing key holder is authorized for Zodiac DAO");
assert.ok(daoPanel.innerHTML.includes("Zodiac Safe DAO • Stateless Zanzibar ReBAC"), "Viewing key holder sees full Zodiac DAO details");
assert.ok(daoPanel.innerHTML.includes("dao_global/tinyblock_treasury_solvency"), "Viewing key holder sees treasury dataset");

// Case 3D: Dynamic Regional DAO Admin (0xa11ce00000000000000000000000000000000001)
const regionalAdmin = "0xa11ce00000000000000000000000000000000001";
daoPanel.setActiveAddress(regionalAdmin, null);
assert.strictEqual((daoPanel as any)._isAuthorizedForDao(), true, "Regional Admin 0xa11c is authorized for Europe Regional DAO");
assert.ok(daoPanel.innerHTML.includes("Europe Regional DAO (dao-europe)"), "Regional Admin dynamically views dao-europe details");
assert.ok(daoPanel.innerHTML.includes("dao_europe/mica_statutory_solvency_2026"), "Regional Admin sees Europe MiCA statutory solvency dataset");
assert.ok(daoPanel.innerHTML.includes("0x0000000000000000000000000000000000000201"), "Regional Admin sees BaFin supervisory role");

console.log("   ✅ ZodiacDaoPanel cross-wallet membership privacy isolation verified.");

// -------------------------------------------------------------
// 4. Cryptographic Blind Note Nullifier Verification
// -------------------------------------------------------------
console.log("\n4. Testing Real SHA-256 Blind Note Nullifier derivation...");
const spendKey = new Uint8Array(32).fill(0xaa);
const salt = new Uint8Array(32).fill(0x55);
const nullifier = deriveNullifier(spendKey, salt);
assert.strictEqual(typeof nullifier, 'string', "Nullifier is string");
assert.strictEqual(nullifier.length, 66, "Nullifier is 32-byte hex (0x + 64 chars)");
assert.ok(nullifier.startsWith("0x"), "Nullifier starts with 0x prefix");
const nullifier2 = deriveNullifier(spendKey, salt);
assert.strictEqual(nullifier, nullifier2, "Deterministic nullifier output");
const differentNullifier = deriveNullifier(new Uint8Array(32).fill(0xbb), salt);
assert.notStrictEqual(nullifier, differentNullifier, "Collision-resistant nullifier output");
console.log("   ✅ Real SHA-256 Blind Note Nullifier derivation verified.");

console.log("\n🎉 All Account Isolation & Privacy Boundary Negative Tests Passed Successfully!\n");
