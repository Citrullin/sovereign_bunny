// Typed Ethers Precompile Contracts and Bytecode Encoders for Sovereign Account-Lattice
// Aligns with contracts/src/ISovereignPrecompiles.sol (EIP-1352 namespace)

import { ethers } from 'ethers';
import { parseAbi, encodeFunctionData, decodeFunctionResult } from 'viem';
import { PrecompileAddresses, PrecompileName } from './types.js';

export const PRECOMPILES: PrecompileAddresses = {
    ROUTER: "0x0000000000000000000000000000000000000001",
    RECEIVE: "0x0000000000000000000000000000000000000002",
    DID_REGISTRY: "0x0000000000000000000000000000000000000003",
    SAGA_INTENT: "0x0000000000000000000000000000000000000004",
    JURISDICTION: "0x0000000000000000000000000000000000000005",
    BRIDGE_SHADOW: "0x0000000000000000000000000000000000000006",
    ASYNC_INBOX: "0x0000000000000000000000000000000000000007",
    ZK_COMPLIANCE: "0x0000000000000000000000000000000000000008",
    STORAGE_DA: "0x0000000000000000000000000000000000000053",
    SIGNAL_REGISTRY: "0x0000000000000000000000000000000000000054",
    ZANZIBAR_REBAC: "0x0000000000000000000000000000000000000061",
    NOTE_REGISTRY: "0x0000000000000000000000000000000000000065",
    CMS_ACTPUB: "0x00000000000000000000000000000000000000F1",
    LATTICE_HEIGHT: "0x0000000000000000000000000000000000000100"
};

export const SOVEREIGN_ABIS: Record<PrecompileName, string[]> = {
    ROUTER: [
        "function mountSlot(uint8 slotId, string calldata pluginId, bytes32 initialRoot) external",
        "function resolveSlot(address account, uint8 slotId) external view returns (bool mounted, string memory pluginId, bytes32 root)",
        "event SlotMounted(uint8 indexed slotId, string pluginId, bytes32 initialRoot)"
    ],
    RECEIVE: [
        "function sweepTransfer(address recipient) external payable returns (uint64 newHeight)",
        "event ValueReceived(address indexed sender, address indexed recipient, uint256 amount, uint64 newHeight)"
    ],
    DID_REGISTRY: [
        "function registerDid(string calldata keyTier, bytes calldata pqPublicKey, string calldata didDocument) external",
        "function resolveDid(address account) external view returns (string memory didDocument)",
        "function setAllowLegacy(bool allow) external",
        "function getSecurityPolicy(address account) external view returns (bool allowLegacy, bool hasPqDid, bool isQuantumSecure)",
        "event DidRegistered(address indexed account, string didUri, string keyTier)",
        "event SecurityPolicyUpdated(address indexed account, bool allowLegacy)"
    ],
    SAGA_INTENT: [
        "function registerIntent(bytes32 intentId, address targetAccount, uint256 amount, uint64 expireEpoch) external payable",
        "event IntentRegistered(bytes32 indexed intentId, address indexed targetAccount, uint256 amount, uint64 expireEpoch)"
    ],
    JURISDICTION: [
        "function setQuadrantBits(uint8 quadrant, uint64 bits) external",
        "function checkCompliance(address account, uint8 quadrant) external view returns (bool compliant, uint64 activeBits)",
        "event JurisdictionUpdated(address indexed target, uint8 indexed quadrant, uint64 bits)"
    ],
    BRIDGE_SHADOW: [
        "function anchorShadowReceipt(bytes32 l1TxHash, address tokenContract, address recipient, uint256 amount, bytes calldata proof) external",
        "event ShadowReceiptAnchored(bytes32 indexed l1TxHash, address tokenContract, address indexed recipient, uint256 amount)"
    ],
    ASYNC_INBOX: [
        "function dispatchAsync(address target, bytes calldata messagePayload) external returns (bytes32 messageHash)",
        "event AsyncDispatched(address indexed sender, address indexed target, bytes32 messageHash)"
    ],
    ZK_COMPLIANCE: [
        "function submitComplianceTicket(bytes calldata ultraHonkProof, bytes32 publicInputsHash) external returns (bool verified)",
        "event ComplianceProofVerified(address indexed account, bytes32 nullifier)"
    ],
    STORAGE_DA: [
        "function verifyStoragePor(bytes calldata cidBytes, uint32 chunkIdx, bytes calldata baoProof) external view returns (bool valid)",
        "event BlobCommitted(bytes cidBytes, address indexed publisher, uint64 sizeBytes)"
    ],
    SIGNAL_REGISTRY: [
        "function inscribeSignal(address target, bytes32 topicId, bytes calldata mlDsaSignature) external",
        "event SignalInscribed(address indexed target, bytes32 indexed topicId, uint64 timestamp)"
    ],
    ZANZIBAR_REBAC: [
        "function check(uint16 namespace, bytes32 objectId, uint16 relation, address subject) external view returns (bool authorized)",
        "function check(string object, string relation, string subject) external view returns (bool authorized)",
        "function inscribeTuple(uint16 namespace, bytes32 objectId, uint16 relation, address subject) external",
        "event TupleInscribed(uint16 indexed namespace, bytes32 indexed objectId, uint16 relation, address indexed subject)"
    ],
    NOTE_REGISTRY: [
        "function absorbNote(bytes32 nullifier, address targetAccount, uint16 targetSlot, uint64 epoch, bytes calldata proof, uint8 relayerFlag) external",
        "function commitNote(bytes32 commitment, uint256 amount, uint16 targetSlot) external payable",
        "event NoteAbsorbed(bytes32 indexed nullifier, address indexed targetAccount, uint16 targetSlot)",
        "event NoteCommitted(bytes32 indexed commitment, uint256 amount, uint16 targetSlot)"
    ],
    CMS_ACTPUB: [
        "function publishActivity(bytes calldata signedActivityPayload) external payable returns (bytes32 activityHash)",
        "event ActivityPublished(bytes32 indexed activityHash, address indexed actor, bytes mediaCid)"
    ],
    LATTICE_HEIGHT: [
        "function getAccountHeight(address target) external view returns (uint256)"
    ]
};

export const SOVEREIGN_VIEM_ABIS = {
    ROUTER: parseAbi(SOVEREIGN_ABIS.ROUTER),
    RECEIVE: parseAbi(SOVEREIGN_ABIS.RECEIVE),
    DID_REGISTRY: parseAbi(SOVEREIGN_ABIS.DID_REGISTRY),
    SAGA_INTENT: parseAbi(SOVEREIGN_ABIS.SAGA_INTENT),
    JURISDICTION: parseAbi(SOVEREIGN_ABIS.JURISDICTION),
    BRIDGE_SHADOW: parseAbi(SOVEREIGN_ABIS.BRIDGE_SHADOW),
    ASYNC_INBOX: parseAbi(SOVEREIGN_ABIS.ASYNC_INBOX),
    ZK_COMPLIANCE: parseAbi(SOVEREIGN_ABIS.ZK_COMPLIANCE),
    STORAGE_DA: parseAbi(SOVEREIGN_ABIS.STORAGE_DA),
    SIGNAL_REGISTRY: parseAbi(SOVEREIGN_ABIS.SIGNAL_REGISTRY),
    ZANZIBAR_REBAC: parseAbi(SOVEREIGN_ABIS.ZANZIBAR_REBAC),
    NOTE_REGISTRY: parseAbi(SOVEREIGN_ABIS.NOTE_REGISTRY),
    CMS_ACTPUB: parseAbi(SOVEREIGN_ABIS.CMS_ACTPUB),
    LATTICE_HEIGHT: parseAbi(SOVEREIGN_ABIS.LATTICE_HEIGHT)
} as const;

/// Viem Native Calldata Encoder for Sovereign Precompiles
export function encodeViemPrecompileCall(
    name: PrecompileName,
    functionName: string,
    args: readonly unknown[] = []
): `0x${string}` {
    const abi = SOVEREIGN_VIEM_ABIS[name] as any;
    if (!abi) throw new Error(`Unknown precompile: ${name}`);
    const normalizedArgs = args.map(arg => {
        if (arg instanceof Uint8Array) {
            return `0x${Array.from(arg).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
        }
        return arg;
    });
    return encodeFunctionData({
        abi,
        functionName: functionName as any,
        args: normalizedArgs as any
    });
}

/// Viem Native Result Decoder for Sovereign Precompiles
export function decodeViemPrecompileResult(
    name: PrecompileName,
    functionName: string,
    data: `0x${string}`
): any {
    const abi = SOVEREIGN_VIEM_ABIS[name] as any;
    if (!abi) throw new Error(`Unknown precompile: ${name}`);
    return decodeFunctionResult({
        abi,
        functionName: functionName as any,
        data
    });
}

/// Instantiates a typed ethers.Contract for a Sovereign precompile
export function getPrecompileContract<T extends ethers.Contract = ethers.Contract>(
    name: PrecompileName,
    runner?: ethers.ContractRunner | null
): T {
    const address = PRECOMPILES[name];
    const abi = SOVEREIGN_ABIS[name];
    if (!address || !abi) {
        throw new Error(`Unknown precompile name: ${name}`);
    }
    return new ethers.Contract(address, abi, runner) as T;
}

/// Encodes raw calldata bytecode for deployed contracts that can only pass raw bytecode
export function encodeRawPrecompileCall(
    name: PrecompileName,
    functionName: string,
    params: any[]
): string {
    return encodeViemPrecompileCall(name, functionName, params);
}

/// Decodes result bytes from an eth_call against a precompile
export function decodePrecompileResult(
    name: PrecompileName,
    functionName: string,
    data: string
): any {
    return decodeViemPrecompileResult(name, functionName, data as `0x${string}`);
}
