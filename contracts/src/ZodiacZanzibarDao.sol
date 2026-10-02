// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISovereignPrecompiles.sol";
import "./SovereignSDK.sol";

/**
 * @title ZodiacZanzibarDao
 * @notice Gnosis Zodiac Safe Module & Avatar with Google Zanzibar ReBAC (Precompile 0x61)
 * and O(1) multi-gigabyte stateless data access via DataRef (Precompile 0x53).
 *
 * Demonstrates:
 * 1. Stateless permission traversal using upfront witness proofs over the Zanzibar relation graph.
 * 2. Stateless multi-gigabyte dataset access via DataRef (32-byte BLAKE3 root + Bao outboard chunk verification)
 *    without committing large files to the EVM state.
 */
/**
 * @title IAvatar
 * @notice Standard Gnosis Safe / Zodiac Avatar interface for module-based execution.
 */
interface IAvatar {
    function execTransactionFromModule(
        address payable to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external returns (bool success);

    function execTransactionFromModuleReturnData(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    ) external returns (bool success, bytes memory returnData);
}

contract ZodiacZanzibarDao {
    address public constant PRECOMPILE_ZANZIBAR = address(0x0000000000000000000000000000000000000061);
    address public constant PRECOMPILE_STORAGE_DA = address(0x0000000000000000000000000000000000000053);

    uint16 public constant ZODIAC_NAMESPACE = 0x20D1; // "zodiac_roles"
    uint16 public constant RELATION_OWNER = 0x0001;
    uint16 public constant RELATION_MANAGER = 0x0002;
    uint16 public constant RELATION_MEMBER = 0x0003;
    uint16 public constant RELATION_EXECUTE = 0x0004;

    /// @notice Upfront witness proof node in a Zanzibar relation graph path
    struct RelationWitness {
        uint16 namespaceId;
        bytes32 objectId;
        uint16 relationId;
        address subject;
    }

    /// @notice O(1) content reference for multi-gigabyte datasets
    struct DataRefRecord {
        bytes32 blake3Root;
        uint64 sizeBytes;
        bytes32 seedNodeId;
        uint64 pinLeaseEpochs;
        string namespace;
    }

    bytes32 public immutable daoId;
    string public daoName;
    address public avatar; // Safe Avatar address
    address public owner;

    // Mapping of dataset identifier to O(1) DataRef record
    mapping(bytes32 => DataRefRecord) public dataRefs;

    event TransactionExecuted(address indexed target, uint256 value, bytes data, uint8 operation);
    event RoleInscribed(uint16 relation, address indexed subject, bytes32 indexed daoId);
    event DataRefPinned(bytes32 indexed datasetId, bytes32 indexed blake3Root, uint64 sizeBytes, string namespace);
    event ChunkVerified(bytes32 indexed datasetId, uint32 chunkIdx, bool valid);

    error Unauthorized(address caller, uint16 requiredRelation);
    error InvalidWitnessProof();
    error ExecutionFailed(bytes returnData);
    error DataRefNotFound(bytes32 datasetId);
    error InvalidStorageProof();

    modifier onlyOwner() {
        if (msg.sender != owner && !verifyPermission(RELATION_OWNER, msg.sender)) {
            revert Unauthorized(msg.sender, RELATION_OWNER);
        }
        _;
    }

    constructor(string memory _daoName, bytes32 _daoId, address _avatar) {
        daoName = _daoName;
        daoId = _daoId;
        avatar = _avatar == address(0) ? address(this) : _avatar;
        owner = msg.sender;

        // Inscribe initial owner and manager relation in native Zanzibar
        _inscribeTuple(RELATION_OWNER, msg.sender);
        _inscribeTuple(RELATION_MANAGER, msg.sender);
        _inscribeTuple(RELATION_MEMBER, msg.sender);
    }

    /**
     * @notice Verifies if a subject holds a specific relation via native Zanzibar ReBAC (Precompile 0x61).
     */
    function verifyPermission(uint16 relation, address subject) public view returns (bool) {
        (bool success, bytes memory result) = PRECOMPILE_ZANZIBAR.staticcall(
            abi.encodeWithSignature("check(uint16,bytes32,uint16,address)", ZODIAC_NAMESPACE, daoId, relation, subject)
        );
        if (success && result.length >= 32) {
            return abi.decode(result, (bool));
        }
        return subject == owner;
    }

    /**
     * @notice Verifies an upfront witness proof traversing the Zanzibar relation graph.
     * @dev Allows an actor to prove authorization across intermediate sets/sub-accounts statelessly.
     * @param targetRelation The final required relation (e.g. RELATION_EXECUTE)
     * @param caller The transaction caller
     * @param witnessPath Array of relation tuples forming the valid path from caller to the target relation
     */
    function verifyWitnessPath(
        uint16 targetRelation,
        address caller,
        RelationWitness[] calldata witnessPath
    ) public view returns (bool) {
        if (witnessPath.length == 0) {
            return verifyPermission(targetRelation, caller);
        }

        // The first node in the path must start from the caller
        if (witnessPath[0].subject != caller) {
            return false;
        }

        // Step through each witness link verifying each step via Zanzibar RAM check
        for (uint256 i = 0; i < witnessPath.length; i++) {
            RelationWitness calldata step = witnessPath[i];
            (bool success, bytes memory result) = PRECOMPILE_ZANZIBAR.staticcall(
                abi.encodeWithSignature(
                    "check(uint16,bytes32,uint16,address)",
                    step.namespaceId,
                    step.objectId,
                    step.relationId,
                    step.subject
                )
            );
            if (!success || result.length < 32 || !abi.decode(result, (bool))) {
                return false;
            }
        }

        // The terminal node must satisfy the target relation on this DAO
        RelationWitness calldata terminal = witnessPath[witnessPath.length - 1];
        return (terminal.namespaceId == ZODIAC_NAMESPACE &&
                terminal.objectId == daoId &&
                terminal.relationId == targetRelation);
    }

    /**
     * @notice Standard Zodiac Safe module execution without upfront witness (direct relation check).
     * @param to Target contract address
     * @param value Native value to forward
     * @param data Calldata payload
     * @param operation 0 = Call, 1 = DelegateCall
     */
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external returns (bool success, bytes memory returnData) {
        if (!verifyPermission(RELATION_EXECUTE, msg.sender) && !verifyPermission(RELATION_OWNER, msg.sender)) {
            revert Unauthorized(msg.sender, RELATION_EXECUTE);
        }
        return _dispatchExecution(to, value, data, operation);
    }

    /**
     * @notice Zodiac Safe module execution with upfront Zanzibar witness proof traversal.
     * @param to Target contract address
     * @param value Native value to forward
     * @param data Calldata payload
     * @param operation 0 = Call, 1 = DelegateCall
     * @param witnessPath Upfront graph traversal proof verifying caller has RELATION_EXECUTE
     */
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        RelationWitness[] calldata witnessPath
    ) external returns (bool success, bytes memory returnData) {
        // Evaluate authorization: either direct check or valid upfront witness path
        if (!verifyWitnessPath(RELATION_EXECUTE, msg.sender, witnessPath) && !verifyPermission(RELATION_OWNER, msg.sender)) {
            revert Unauthorized(msg.sender, RELATION_EXECUTE);
        }
        return _dispatchExecution(to, value, data, operation);
    }

    function _dispatchExecution(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) internal returns (bool success, bytes memory returnData) {
        if (avatar != address(this) && avatar != address(0)) {
            (success, returnData) = IAvatar(avatar).execTransactionFromModuleReturnData(to, value, data, operation);
        } else {
            if (operation == 0) {
                (success, returnData) = to.call{value: value}(data);
            } else if (operation == 1) {
                (success, returnData) = to.delegatecall(data);
            } else {
                revert("Unsupported operation");
            }
        }

        if (!success) {
            revert ExecutionFailed(returnData);
        }

        emit TransactionExecuted(to, value, data, operation);
    }

    /**
     * @notice Inscribes a new relation for a subject in the Zanzibar relation table.
     */
    function assignRole(uint16 relation, address subject) external onlyOwner {
        _inscribeTuple(relation, subject);
        emit RoleInscribed(relation, subject, daoId);
    }

    /**
     * @notice Pins a multi-gigabyte dataset reference (O(1) state representation).
     * @dev Commits only the 32-byte BLAKE3 root, size, and lease parameters to the ledger.
     * Bulk data resides in Iroh storage pools.
     */
    function pinDataRef(
        bytes32 datasetId,
        bytes32 blake3Root,
        uint64 sizeBytes,
        bytes32 seedNodeId,
        uint64 pinLeaseEpochs,
        string calldata namespace
    ) external onlyOwner {
        dataRefs[datasetId] = DataRefRecord({
            blake3Root: blake3Root,
            sizeBytes: sizeBytes,
            seedNodeId: seedNodeId,
            pinLeaseEpochs: pinLeaseEpochs,
            namespace: namespace
        });

        emit DataRefPinned(datasetId, blake3Root, sizeBytes, namespace);
    }

    /**
     * @notice Statelessly verifies a chunk of a multi-gigabyte dataset using Bao outboard proofs.
     * @param datasetId The dataset identifier
     * @param chunkIdx Index of the chunk being accessed
     * @param baoProof The compact Bao Merkle slice proof for that chunk
     */
    function verifyDataChunk(
        bytes32 datasetId,
        uint32 chunkIdx,
        bytes calldata baoProof
    ) external returns (bool valid) {
        DataRefRecord memory record = dataRefs[datasetId];
        if (record.blake3Root == bytes32(0)) {
            revert DataRefNotFound(datasetId);
        }

        // Call Precompile 0x53 to verify the Bao slice proof against the committed BLAKE3 root
        (bool success, bytes memory result) = PRECOMPILE_STORAGE_DA.staticcall(
            abi.encodeWithSignature(
                "verifyStoragePor(bytes,uint32,bytes)",
                abi.encodePacked(record.blake3Root),
                chunkIdx,
                baoProof
            )
        );

        if (!success || result.length < 32 || !abi.decode(result, (bool))) {
            revert InvalidStorageProof();
        }

        valid = true;
        emit ChunkVerified(datasetId, chunkIdx, true);
    }

    function _inscribeTuple(uint16 relation, address subject) internal {
        (bool success, ) = PRECOMPILE_ZANZIBAR.call(
            abi.encodeWithSignature(
                "inscribeTuple(uint16,bytes32,uint16,address)",
                ZODIAC_NAMESPACE,
                daoId,
                relation,
                subject
            )
        );
        require(success, "Zanzibar tuple inscription failed");
    }
}
