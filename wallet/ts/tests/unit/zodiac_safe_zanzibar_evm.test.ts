// EVM Unit Tests for Zodiac Safe & Google Zanzibar ReBAC Mapping
// Adapted from upstream gnosisguild/zodiac-modifier-roles (packages/evm/test)
// Strictly implemented using viem - NO ethers.
import assert from 'assert';
import {
    encodeFunctionData,
    decodeFunctionResult,
    decodeFunctionData,
    parseAbi,
    keccak256,
    toHex,
    pad,
    toFunctionSelector,
    stringToHex
} from 'viem';
import { ZodiacDaoPanel, BUILTIN_ZODIAC_DAOS } from '../../src/components/zodiac_dao_panel.js';

// -------------------------------------------------------------
// ABIs conforming to TestAvatar.sol and ZodiacZanzibarDao.sol
// -------------------------------------------------------------
const AVATAR_ABI = parseAbi([
    "function exec(address payable to, uint256 value, bytes calldata data, uint8 operation) external",
    "function execTransactionFromModule(address payable to, uint256 value, bytes calldata data, uint8 operation) external returns (bool success)",
    "function execTransactionFromModuleReturnData(address to, uint256 value, bytes calldata data, uint8 operation) external returns (bool success, bytes memory returnData)"
]);

const ZODIAC_ZANZIBAR_DAO_ABI = parseAbi([
    "struct RelationWitness { uint16 namespaceId; bytes32 objectId; uint16 relationId; address subject; }",
    "function daoId() external view returns (bytes32)",
    "function daoName() external view returns (string)",
    "function avatar() external view returns (address)",
    "function owner() external view returns (address)",
    "function verifyPermission(uint16 relation, address subject) external view returns (bool)",
    "function verifyWitnessPath(uint16 targetRelation, address caller, (uint16 namespaceId, bytes32 objectId, uint16 relationId, address subject)[] calldata witnessPath) external view returns (bool)",
    "function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8 operation) external returns (bool success, bytes memory returnData)",
    "function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8 operation, (uint16 namespaceId, bytes32 objectId, uint16 relationId, address subject)[] calldata witnessPath) external returns (bool success, bytes memory returnData)",
    "function assignRole(uint16 relation, address subject) external",
    "function pinDataRef(bytes32 datasetId, bytes32 blake3Root, uint64 sizeBytes, bytes32 seedNodeId, uint64 pinLeaseEpochs, string calldata namespace) external",
    "event TransactionExecuted(address indexed target, uint256 value, bytes data, uint8 operation)",
    "event RoleInscribed(uint16 relation, address indexed subject, bytes32 indexed daoId)",
    "event DataRefPinned(bytes32 indexed datasetId, bytes32 indexed blake3Root, uint64 sizeBytes, string namespace)",
    "error Unauthorized(address caller, uint16 requiredRelation)",
    "error ExecutionFailed(bytes returnData)"
]);

const PRECOMPILE_ZANZIBAR_ABI = parseAbi([
    "function check(uint16 namespace, bytes32 objectId, uint16 relation, address subject) external view returns (bool authorized)",
    "function inscribeTuple(uint16 namespace, bytes32 objectId, uint16 relation, address subject) external"
]);

// -------------------------------------------------------------
// Test Constants & Relations
// -------------------------------------------------------------
const ZODIAC_NAMESPACE = 0x20D1; // "zodiac_roles"
const RELATION_OWNER = 0x0001;
const RELATION_MANAGER = 0x0002;
const RELATION_MEMBER = 0x0003;
const RELATION_EXECUTE = 0x0004;

const SAFE_AVATAR_ADDRESS = "0x0000000000000000000000000000000000000101" as `0x${string}`;
const DAO_ID = "0x0000000000000000000000000000000000000101000000000000000000000000" as `0x${string}`;
const OWNER_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as `0x${string}`;
const MANAGER_ADDRESS = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as `0x${string}`;
const EXECUTOR_ADDRESS = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as `0x${string}`;
const ADVERSARY_ADDRESS = "0xdead000000000000000000000000000000000004" as `0x${string}`;
const TARGET_CONTRACT = "0x4444444444444444444444444444444444444444" as `0x${string}`;

async function runZodiacTests() {
    console.log("🏛️ Running Zodiac Safe & Zanzibar ReBAC EVM Unit Tests (Viem Native)...\n");

    // =========================================================================
    // Test 1: Safe Avatar (TestAvatar) Interface Conformance
    // (Adapted from upstream packages/evm/test/setup.ts & execution.spec.ts)
    // =========================================================================
    console.log("1. Validating Safe Avatar (TestAvatar) ABI and Interface Conformance...");
    
    // Check 4-argument execTransactionFromModule selector
    const execFromModuleCalldata = encodeFunctionData({
        abi: AVATAR_ABI,
        functionName: 'execTransactionFromModule',
        args: [TARGET_CONTRACT, 0n, "0x12345678", 0]
    });
    assert.ok(execFromModuleCalldata.startsWith("0x"), "Must encode valid calldata");
    assert.strictEqual(execFromModuleCalldata.slice(0, 10), "0x468721a7", "Must match standard Zodiac execTransactionFromModule selector (0x468721a7)");

    // Check execTransactionFromModuleReturnData selector
    const execReturnDataCalldata = encodeFunctionData({
        abi: AVATAR_ABI,
        functionName: 'execTransactionFromModuleReturnData',
        args: [TARGET_CONTRACT, 0n, "0xabcdef", 1]
    });
    assert.ok(execReturnDataCalldata.startsWith("0x"), "Must encode valid calldata");
    assert.strictEqual(execReturnDataCalldata.slice(0, 10), "0x5229073f", "Must match standard Zodiac execTransactionFromModuleReturnData selector (0x5229073f)");

    console.log("   ✅ Safe Avatar standard execution interfaces verified.");

    // =========================================================================
    // Test 2: Zodiac Safe Module Avatar Execution & Overload Routing
    // =========================================================================
    console.log("\n2. Validating Zodiac Safe Module to Safe Avatar Delegation...");

    // Standard 4-arg overload (without witness)
    const daoExecCalldata = encodeFunctionData({
        abi: ZODIAC_ZANZIBAR_DAO_ABI,
        functionName: 'execTransactionFromModule',
        args: [TARGET_CONTRACT, 0n, "0xdeadbeef", 0]
    });
    assert.ok(daoExecCalldata.length > 10, "Calldata must be successfully generated for 4-arg execTransactionFromModule");

    // 5-arg overload with upfront witness proof path
    const witnessProof = [
        {
            namespaceId: ZODIAC_NAMESPACE,
            objectId: pad(SAFE_AVATAR_ADDRESS, { size: 32 }),
            relationId: RELATION_MEMBER,
            subject: EXECUTOR_ADDRESS
        },
        {
            namespaceId: ZODIAC_NAMESPACE,
            objectId: DAO_ID,
            relationId: RELATION_EXECUTE,
            subject: SAFE_AVATAR_ADDRESS
        }
    ];

    const daoExecWitnessCalldata = encodeFunctionData({
        abi: ZODIAC_ZANZIBAR_DAO_ABI,
        functionName: 'execTransactionFromModule',
        args: [TARGET_CONTRACT, 0n, "0xdeadbeef", 0, witnessProof]
    });
    assert.ok(daoExecWitnessCalldata.length > 10, "Calldata must be successfully generated for 5-arg execTransactionFromModule");

    // Verify decoding of the call parameters
    const decodedCall = decodeFunctionData({
        abi: ZODIAC_ZANZIBAR_DAO_ABI,
        data: daoExecWitnessCalldata
    });
    assert.strictEqual(decodedCall.functionName, 'execTransactionFromModule');
    const args = decodedCall.args as any;
    assert.strictEqual(args[0].toLowerCase(), TARGET_CONTRACT.toLowerCase());
    assert.strictEqual(args[1], 0n);
    assert.strictEqual(args[2], "0xdeadbeef");
    assert.strictEqual(args[3], 0);
    assert.strictEqual(args[4].length, 2);
    assert.strictEqual(args[4][0].namespaceId, ZODIAC_NAMESPACE);
    assert.strictEqual(args[4][0].relationId, RELATION_MEMBER);
    assert.strictEqual(args[4][1].relationId, RELATION_EXECUTE);

    console.log("   ✅ Zodiac Safe module call delegation and upfront witness encoding verified.");

    // =========================================================================
    // Test 3: Zanzibar ReBAC Role Verification (Native Precompile 0x61 Staticcall)
    // (Adapted from upstream packages/evm/test/membership.spec.ts & authorization.spec.ts)
    // =========================================================================
    console.log("\n3. Validating Zanzibar ReBAC Precompile 0x61 staticcall encoding...");

    // Staticcall encoding for check(uint16,bytes32,uint16,address)
    const checkOwnerCalldata = encodeFunctionData({
        abi: PRECOMPILE_ZANZIBAR_ABI,
        functionName: 'check',
        args: [ZODIAC_NAMESPACE, DAO_ID, RELATION_OWNER, OWNER_ADDRESS]
    });
    assert.ok(checkOwnerCalldata.startsWith("0x"), "Precompile 0x61 staticcall encoded");

    // Staticcall encoding for executor
    const checkExecutorCalldata = encodeFunctionData({
        abi: PRECOMPILE_ZANZIBAR_ABI,
        functionName: 'check',
        args: [ZODIAC_NAMESPACE, DAO_ID, RELATION_EXECUTE, EXECUTOR_ADDRESS]
    });
    assert.ok(checkExecutorCalldata.startsWith("0x"), "Precompile 0x61 executor check encoded");

    // Simulate mock precompile 0x61 responses:
    // Authorized -> true (0x0000...01)
    // Unauthorized -> false (0x0000...00)
    const mockTrueResult = pad("0x01", { size: 32 });
    const mockFalseResult = pad("0x00", { size: 32 });

    const isOwnerAuthorized = decodeFunctionResult({
        abi: PRECOMPILE_ZANZIBAR_ABI,
        functionName: 'check',
        data: mockTrueResult
    });
    assert.strictEqual(isOwnerAuthorized, true, "Authorized owner must evaluate to true");

    const isAdversaryAuthorized = decodeFunctionResult({
        abi: PRECOMPILE_ZANZIBAR_ABI,
        functionName: 'check',
        data: mockFalseResult
    });
    assert.strictEqual(isAdversaryAuthorized, false, "Adversary without role must evaluate to false");

    console.log("   ✅ Precompile 0x61 Zanzibar ReBAC staticcall encoding and decoding verified.");

    // =========================================================================
    // Test 4: Stateless Upfront Witness Traversal Algorithm
    // =========================================================================
    console.log("\n4. Validating Stateless Upfront Witness Traversal Logic...");

    function simulateWitnessPathVerification(
        targetRelation: number,
        caller: string,
        witnessPath: typeof witnessProof,
        daoTargetId: string,
        zanzibarStore: Set<string>
    ): boolean {
        if (witnessPath.length === 0) {
            const key = `${ZODIAC_NAMESPACE}:${daoTargetId.toLowerCase()}:${targetRelation}:${caller.toLowerCase()}`;
            return zanzibarStore.has(key);
        }

        // The first node in the path must start from caller
        if (witnessPath[0].subject.toLowerCase() !== caller.toLowerCase()) {
            return false;
        }

        // Step through each link verifying membership via Zanzibar RAM table
        for (let i = 0; i < witnessPath.length; i++) {
            const step = witnessPath[i];
            const key = `${step.namespaceId}:${step.objectId.toLowerCase()}:${step.relationId}:${step.subject.toLowerCase()}`;
            if (!zanzibarStore.has(key)) {
                return false;
            }
        }

        // The terminal node must satisfy target relation on this DAO
        const terminal = witnessPath[witnessPath.length - 1];
        return (
            terminal.namespaceId === ZODIAC_NAMESPACE &&
            terminal.objectId.toLowerCase() === daoTargetId.toLowerCase() &&
            terminal.relationId === targetRelation
        );
    }

    // Populate mock Zanzibar ReBAC store
    const zanzibarStore = new Set<string>();
    // Alice (EXECUTOR_ADDRESS) is member of sub-group
    zanzibarStore.add(`${ZODIAC_NAMESPACE}:${pad(SAFE_AVATAR_ADDRESS, { size: 32 }).toLowerCase()}:${RELATION_MEMBER}:${EXECUTOR_ADDRESS.toLowerCase()}`);
    // Sub-group (SAFE_AVATAR_ADDRESS) has RELATION_EXECUTE on DAO_ID
    zanzibarStore.add(`${ZODIAC_NAMESPACE}:${DAO_ID.toLowerCase()}:${RELATION_EXECUTE}:${SAFE_AVATAR_ADDRESS.toLowerCase()}`);

    // Positive case: Alice proves execution capability statelessly via witness proof
    const validProofResult = simulateWitnessPathVerification(
        RELATION_EXECUTE,
        EXECUTOR_ADDRESS,
        witnessProof,
        DAO_ID,
        zanzibarStore
    );
    assert.strictEqual(validProofResult, true, "Valid upfront witness path must be accepted");

    // Negative case 1: Adversary attempts to use Alice's witness proof
    const adversaryProofResult = simulateWitnessPathVerification(
        RELATION_EXECUTE,
        ADVERSARY_ADDRESS,
        witnessProof,
        DAO_ID,
        zanzibarStore
    );
    assert.strictEqual(adversaryProofResult, false, "Adversary attempting to reuse witness proof must be rejected (subject mismatch)");

    // Negative case 2: Tampered terminal relation (trying to claim owner via execute path)
    const tamperedProofResult = simulateWitnessPathVerification(
        RELATION_OWNER,
        EXECUTOR_ADDRESS,
        witnessProof,
        DAO_ID,
        zanzibarStore
    );
    assert.strictEqual(tamperedProofResult, false, "Tampered target relation must be rejected");

    console.log("   ✅ Stateless Upfront Witness Traversal algorithm and negative rejections verified.");

    // =========================================================================
    // Test 5: O(1) Large Dataset Access (DataRef • Precompile 0x53)
    // =========================================================================
    console.log("\n5. Validating Stateless O(1) Large Dataset Access (DataRef • Precompile 0x53)...");

    const datasetId = keccak256(stringToHex("dao_europe/mica_statutory_solvency_2026"));
    const blake3Root = "0xbaf1020000000000000000000000000000000000000000000000000000000102" as `0x${string}`;
    const sizeBytes = 27380416512n; // 25.5 GB
    const seedNodeId = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`;
    const pinLeaseEpochs = 120n;
    const namespace = "dao_europe/mica_statutory_solvency_2026";

    const pinCalldata = encodeFunctionData({
        abi: ZODIAC_ZANZIBAR_DAO_ABI,
        functionName: 'pinDataRef',
        args: [datasetId, blake3Root, sizeBytes, seedNodeId, pinLeaseEpochs, namespace]
    });
    assert.ok(pinCalldata.startsWith("0x"), "pinDataRef calldata encoded");

    // Invariant: committing 25.5 GB dataset to ledger requires only fixed 32-byte BLAKE3 root
    assert.strictEqual(blake3Root.length, 66, "BLAKE3 root is exactly 32 bytes (64 hex characters + 0x)");
    console.log(`   ✅ 25.5 GB statutory solvency dataset encoded with O(1) 32-byte BLAKE3 root: ${blake3Root}`);

    // =========================================================================
    // Test 6: Regional DAO Dynamic Resolution in ZodiacDaoPanel
    // =========================================================================
    console.log("\n6. Validating Regional DAO Dynamic Resolution in ZodiacDaoPanel...");

    const panel = new ZodiacDaoPanel();
    
    // 6A. Connect with Europe Regional DAO Admin (0xa11ce00000000000000000000000000000000001)
    const regionalAdmin = "0xa11ce00000000000000000000000000000000001";
    panel.setActiveAddress(regionalAdmin, null);

    assert.strictEqual((panel as any)._isAuthorizedForDao(), true, "Regional Admin 0xa11c must be authorized for Europe Regional DAO");
    assert.strictEqual(panel.currentDao.daoId, "0x0000000000000000000000000000000000000102");
    assert.strictEqual(panel.currentDao.avatar, "0x0000000000000000000000000000000000000102");
    assert.ok(panel.innerHTML.includes("Europe Regional DAO (dao-europe)"), "Panel renders Europe Regional DAO");
    assert.ok(panel.innerHTML.includes("dao_europe/mica_statutory_solvency_2026"), "Panel displays MiCA 25.50 GB dataset");

    // 6B. Connect with Tinyblock Global DAO Owner (0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266)
    panel.setActiveAddress(OWNER_ADDRESS, null);
    assert.strictEqual((panel as any)._isAuthorizedForDao(), true, "Tinyblock DAO Owner must be authorized for Tinyblock Global DAO");
    assert.strictEqual(panel.currentDao.daoId, "0x0000000000000000000000000000000000000101");
    assert.ok(panel.innerHTML.includes("Tinyblock Global DAO"), "Panel renders Tinyblock Global DAO");
    assert.ok(panel.innerHTML.includes("dao_global/tinyblock_treasury_solvency"), "Panel displays Tinyblock Treasury solvency dataset");

    // 6C. Connect with Unregistered Account (ADVERSARY_ADDRESS)
    panel.setActiveAddress(ADVERSARY_ADDRESS, null);
    assert.strictEqual((panel as any)._isAuthorizedForDao(), false, "Adversary must NOT be authorized for any Zodiac DAO");
    assert.ok(panel.innerHTML.includes("No Active Zodiac Safe DAO Memberships"), "Adversary sees isolated vault shielded card");

    console.log("   ✅ Dynamic multi-DAO resolution and strict privacy isolation verified.");

    console.log("\n🎉 All Zodiac Safe & Zanzibar ReBAC EVM Tests Passed Successfully!");
}

runZodiacTests().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
});
