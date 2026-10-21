import assert from 'assert';
import { requireEvmSignature, EvmSignatureRequiredError, isPureModeActive } from '../../src/wallet_connector.js';
import { SovereignGovernancePanelElement } from '../../src/components/sovereign_governance_panel.js';

console.log("🏛️ Running Governance Dynamic DAOs, EVM Pure Mode & SMT Nullifier Unit Tests...\n");

// Setup mock window & localStorage
const win = (globalThis as any).window || (globalThis as any);
(globalThis as any).window = win;

const storage: Record<string, string> = {};
win.localStorage = {
    getItem: (key: string) => storage[key] || null,
    setItem: (key: string, val: string) => { storage[key] = val; },
    removeItem: (key: string) => { delete storage[key]; },
    clear: () => { for (const k in storage) delete storage[k]; }
};
(globalThis as any).localStorage = win.localStorage;

// 1. Strict EVM Pure Mode Invariant Test
console.log("1. Testing strict EVM Pure Mode requirement and prompt enforcement...");
win.localStorage.setItem('sovereign_crypto_wrap', 'pure');
assert.strictEqual(isPureModeActive(), true, "Pure mode must be detected as active");

// Test missing EVM provider throws EvmSignatureRequiredError
delete win.ethereum;
delete win.rabby;
let thrownError: any = null;
try {
    await requireEvmSignature("test message", "0x1111111111111111111111111111111111111111");
} catch (err) {
    thrownError = err;
}
assert.ok(thrownError instanceof EvmSignatureRequiredError, "Must throw EvmSignatureRequiredError when provider is missing in pure mode");

// Test injected provider personal_sign is called
let signedMessage = '';
let signerAddress = '';
win.ethereum = {
    request: async (args: { method: string; params: any[] }) => {
        if (args.method === 'personal_sign') {
            signedMessage = args.params[0];
            signerAddress = args.params[1];
            return '0xevmsignature123456789';
        }
        throw new Error(`Unexpected method: ${args.method}`);
    }
};

const sig = await requireEvmSignature("DAO_VOTE: SIP-101", "0x1111111111111111111111111111111111111111");
assert.strictEqual(sig, '0xevmsignature123456789', "Must return EVM signature from injected provider");
assert.strictEqual(signedMessage, "DAO_VOTE: SIP-101");
assert.strictEqual(signerAddress, "0x1111111111111111111111111111111111111111");
console.log("   ✅ Strict EVM Pure Mode interactive signing verified.");

// 2. EVM Signature User Rejection Test
console.log("\n2. Testing user rejection of EVM signature (no silent bypasses)...");
win.ethereum = {
    request: async (args: { method: string }) => {
        if (args.method === 'personal_sign') {
            throw new Error("User rejected the signature request in Rabby.");
        }
    }
};

let rejectionError: any = null;
try {
    await requireEvmSignature("DAO_VOTE: Reject Me", "0x1111111111111111111111111111111111111111");
} catch (err) {
    rejectionError = err;
}
assert.ok(rejectionError instanceof EvmSignatureRequiredError, "Rejection must throw EvmSignatureRequiredError in pure mode");
assert.ok(rejectionError.message.includes("User rejected"), "Must preserve rejection context");
console.log("   ✅ User rejection invariant verified: zero silent bypasses.");

// 3. Dynamic On-Chain DAO Discovery Test
console.log("\n3. Testing dynamic DAO discovery from on-chain RPC and genesis (no fixed hardcoded arrays)...");
const panel = new SovereignGovernancePanelElement();
win.connectedAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

// Mock on-chain RPC returning live registry DAOs with ReBAC info
win.callBunnyRpc = async (method: string) => {
    if (method === 'sovereign_getDaoProposals') {
        return {
            result: {
                proposals: [],
                availableDaos: [
                    {
                        address: "0x0000000000000000000000000000000000000101",
                        name: "Tinyblock Global DAO",
                        isMember: true,
                        isOwner: true,
                        kind: "OneHumanOneVote"
                    },
                    {
                        address: "0x0000000000000000000000000000000000000102",
                        name: "Europe Regional DAO",
                        isMember: true,
                        isOwner: false,
                        kind: "OneHumanOneVote"
                    },
                    {
                        address: "0x9999000000000000000000000000000000009999",
                        name: "Custom Deployed Protocol DAO",
                        isMember: false,
                        isOwner: false,
                        kind: "CapitalWeighted"
                    }
                ]
            }
        };
    }
    return null;
};

await panel.fetchProposals();
assert.strictEqual(panel.state.availableDaos.length, 3, "Must discover all 3 DAOs dynamically from on-chain state");
assert.strictEqual(panel.state.availableDaos[0].name, "Tinyblock Global DAO");
assert.strictEqual(panel.state.availableDaos[0].isOwner, true);
assert.strictEqual(panel.state.availableDaos[2].name, "Custom Deployed Protocol DAO");
assert.strictEqual(panel.state.availableDaos[2].isMember, false);
console.log("   ✅ Dynamic on-chain DAO discovery verified.");

// 4. Anti-Fake Proposal Invariant Test
console.log("\n4. Verifying anti-fake proposal invariant (empty feed when no proposals exist)...");
assert.strictEqual(panel.state.proposals.length, 0, "Proposal list must be completely empty when on-chain has no proposals");
console.log("   ✅ Anti-fake invariant verified: zero synthetic fallback proposals injected.");

// 5. SMT Ballot Nullifier & Blind Note Disbursement State Test
console.log("\n5. Testing SMT Ballot Nullifier & Blind Note Disbursement updates on proposal vote...");
const testProposal = {
    proposalId: "0xprop000000000000000000000000000000000000000000000000000000000001",
    daoAddress: "0x0000000000000000000000000000000000000101",
    proposer: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    title: "SIP-105: Disburse Blind Note Grant",
    description: "Grant 500 ETH from DAO Treasury Slot 2",
    target: "0x81f16dc0351d44c84234f4e4514c03ce51e6dab3",
    value: "500000000000000000000",
    startEpoch: 1,
    endEpoch: 10,
    forVotes: "9",
    againstVotes: "0",
    status: 'Active' as const,
};

panel.state.proposals = [testProposal];

// Mock EVM state change transaction execution via connected EVM wallet
win.ethereum = {
    request: async (args: { method: string; params: any[] }) => {
        if (args.method === 'eth_sendTransaction') {
            assert.strictEqual(args.params[0].to, testProposal.daoAddress, "Target must be DAO address");
            assert.ok(args.params[0].data.startsWith('0xda02'), "Must contain vote calldata");
            return '0xnullifier_blake3_smt_leaf_1234567890abcdef';
        }
        if (args.method === 'personal_sign') return '0xvalidsig_vote';
        throw new Error('unknown: ' + args.method);
    }
};

await panel.voteOnProposal(testProposal, true);
assert.strictEqual(panel.state.proposals[0].userHasVoted, true, "User vote must be recorded");
assert.strictEqual(panel.state.proposals[0].userVote?.ballotNullifier, '0xnullifier_blake3_smt_leaf_1234567890abcdef', "Ballot nullifier must match SMT leaf");
assert.strictEqual(panel.state.proposals[0].status, 'Executed', "Proposal status must update to Executed");
console.log("   ✅ Pure EVM state change transaction execution & SMT nullifier recording verified.");

console.log("\n🎉 ALL GOVERNANCE & EVM PURE MODE TESTS PASSED SUCCESSFULLY!\n");
