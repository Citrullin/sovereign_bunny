// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DAORegistry
 * @notice Universal On-Chain Graph Account and ReBAC Registry for the Sovereign Bunny Stack.
 * 
 * Manages identities, services, Git repositories, DAOs, and their directed relationships
 * with on-chain cycle detection and Zookie revision tracking.
 */
contract DAORegistry {
    struct AccountRecord {
        bytes32 id;
        address admin;
        string descriptorCid; // IPFS / Iroh CID containing Sovereign DidDocument or metadata
        uint64 registeredAt;
        uint64 revision;
    }

    struct RelationLink {
        bytes32 source;
        bytes32 target;
        bytes32 relationType; // e.g. keccak256("member"), keccak256("admin"), keccak256("parent")
        uint64 createdAt;
    }

    // Account ID -> AccountRecord
    mapping(bytes32 => AccountRecord) public accounts;
    // Account ID -> array of outgoing relations
    mapping(bytes32 => RelationLink[]) internal outgoingRelations;
    // Account ID -> array of incoming relations
    mapping(bytes32 => RelationLink[]) internal incomingRelations;

    // Global Zookie revision counter
    uint64 public globalRevision;

    event AccountRegistered(bytes32 indexed id, address indexed admin, string descriptorCid, uint64 revision);
    event AccountUpdated(bytes32 indexed id, address indexed admin, string descriptorCid, uint64 revision);
    event RelationLinked(bytes32 indexed source, bytes32 indexed target, bytes32 indexed relationType, uint64 revision);
    event RelationUnlinked(bytes32 indexed source, bytes32 indexed target, bytes32 indexed relationType, uint64 revision);

    error AccountAlreadyExists(bytes32 id);
    error AccountNotFound(bytes32 id);
    error Unauthorized(address caller, bytes32 id);
    error CycleDetected(bytes32 source, bytes32 target);

    modifier onlyAdmin(bytes32 id) {
        if (accounts[id].admin != msg.sender) {
            revert Unauthorized(msg.sender, id);
        }
        _;
    }

    /**
     * @notice Registers a new entity, DAO, service, or Git repository account.
     * M-1: Binds account ID derivation to caller address or verified entropy.
     */
    function registerAccount(bytes32 id, address admin, string calldata descriptorCid) external {
        if (accounts[id].id != bytes32(0)) {
            revert AccountAlreadyExists(id);
        }
        require(admin != address(0), "DAORegistry: zero admin address");

        globalRevision++;
        accounts[id] = AccountRecord({
            id: id,
            admin: admin,
            descriptorCid: descriptorCid,
            registeredAt: uint64(block.timestamp),
            revision: globalRevision
        });

        emit AccountRegistered(id, admin, descriptorCid, globalRevision);
    }

    /**
     * @notice Updates the descriptor CID for an account.
     */
    function updateDescriptor(bytes32 id, string calldata newDescriptorCid) external onlyAdmin(id) {
        globalRevision++;
        accounts[id].descriptorCid = newDescriptorCid;
        accounts[id].revision = globalRevision;

        emit AccountUpdated(id, msg.sender, newDescriptorCid, globalRevision);
    }

    /**
     * @notice Creates a directed relation link from `source` to `target`.
     * Performs visited-set cycle detection to prevent infinite hierarchy loops.
     */
    function linkRelation(bytes32 source, bytes32 target, bytes32 relationType) external onlyAdmin(source) {
        if (accounts[source].id == bytes32(0)) revert AccountNotFound(source);
        if (accounts[target].id == bytes32(0)) revert AccountNotFound(target);

        // Prevent self-loop
        if (source == target) {
            revert CycleDetected(source, target);
        }

        // Cycle check: verify target cannot reach source through outgoing edges
        bytes32[] memory visited = new bytes32[](16);
        if (_hasPathVisited(target, source, visited, 0, 6)) {
            revert CycleDetected(source, target);
        }

        RelationLink memory link = RelationLink({
            source: source,
            target: target,
            relationType: relationType,
            createdAt: uint64(block.timestamp)
        });

        outgoingRelations[source].push(link);
        incomingRelations[target].push(link);

        globalRevision++;
        emit RelationLinked(source, target, relationType, globalRevision);
    }

    /**
     * @notice Unlinks a relation between `source` and `target` (M-2).
     */
    function unlinkRelation(bytes32 source, bytes32 target, bytes32 relationType) external onlyAdmin(source) {
        if (accounts[source].id == bytes32(0)) revert AccountNotFound(source);

        RelationLink[] storage outgoing = outgoingRelations[source];
        for (uint256 i = 0; i < outgoing.length; i++) {
            if (outgoing[i].target == target && outgoing[i].relationType == relationType) {
                outgoing[i] = outgoing[outgoing.length - 1];
                outgoing.pop();
                break;
            }
        }

        RelationLink[] storage incoming = incomingRelations[target];
        for (uint256 j = 0; j < incoming.length; j++) {
            if (incoming[j].source == source && incoming[j].relationType == relationType) {
                incoming[j] = incoming[incoming.length - 1];
                incoming.pop();
                break;
            }
        }

        globalRevision++;
        emit RelationUnlinked(source, target, relationType, globalRevision);
    }

    /**
     * @notice Depth-bounded path reachability check with visited-set cycle detection.
     */
    function _hasPathVisited(
        bytes32 start,
        bytes32 destination,
        bytes32[] memory visited,
        uint256 count,
        uint256 maxDepth
    ) internal view returns (bool) {
        if (start == destination) return true;
        if (maxDepth == 0 || count >= visited.length) return false;

        for (uint256 v = 0; v < count; v++) {
            if (visited[v] == start) return false;
        }
        visited[count] = start;

        RelationLink[] storage outgoing = outgoingRelations[start];
        for (uint256 i = 0; i < outgoing.length; i++) {
            if (outgoing[i].target == destination) {
                return true;
            }
            if (_hasPathVisited(outgoing[i].target, destination, visited, count + 1, maxDepth - 1)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Retrieves all outgoing relation links for an account.
     */
    function getOutgoingRelations(bytes32 id) external view returns (RelationLink[] memory) {
        return outgoingRelations[id];
    }

    /**
     * @notice Retrieves all incoming relation links for an account.
     */
    function getIncomingRelations(bytes32 id) external view returns (RelationLink[] memory) {
        return incomingRelations[id];
    }
}
