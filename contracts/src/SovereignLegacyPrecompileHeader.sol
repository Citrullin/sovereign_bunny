// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17 <0.9.0;

import "./ISovereignPrecompiles.sol";
import "./SovereignSDK.sol";

/**
 * @title SovereignLegacyPrecompileHeader
 * @notice Backwards compatibility precompile bridge and account-locking header
 *         for deploying legacy Ethereum / Gnosis Zodiac Safe contracts (e.g. Zodiac Roles Modifier,
 *         Aave, Uniswap, Gnosis Safe) directly onto the Sovereign Account-Lattice.
 *
 * @dev In Sovereign Reth:
 * - Zanzibar (Precompile 0x61) is the primary first-class ReBAC permission system in RAM (<12µs).
 * - For legacy backwards compatibility, EVM calls (`CALL`, `DELEGATECALL`, `STATICCALL`)
 *   automatically enforce frontier snapshotting and account locking (`frontier.locked = true`)
 *   preventing reentrancy, state corruption, or dirty cross-account reads without consensus stalls.
 * - This header bridges Zodiac role modifications, allowing any legacy EVM module to
 *   transparently synchronize role definitions with native Zanzibar tuples.
 */
abstract contract SovereignLegacyPrecompileHeader {
    // Canonical Sovereign Low-Entropy Precompile Addresses (EIP-1352)
    address public constant PRECOMPILE_REGISTER_ROUTER  = 0x0000000000000000000000000000000000000001;
    address public constant PRECOMPILE_DID_REGISTRY     = 0x0000000000000000000000000000000000000003;
    address public constant PRECOMPILE_STORAGE_DA       = 0x0000000000000000000000000000000000000053;
    address public constant PRECOMPILE_ZANZIBAR_REBAC   = 0x0000000000000000000000000000000000000061;
    address public constant PRECOMPILE_LATTICE_HEIGHT   = 0x0000000000000000000000000000000000000100;

    // Namespace reserved for Zodiac Roles in Zanzibar
    uint16 internal constant ZODIAC_NAMESPACE = 0x20D1;

    event LegacyZodiacRoleSynced(bytes32 indexed roleKey, address indexed member, uint16 indexed relationId);
    event LegacyAccountLockVerified(address indexed target, bool locked);

    /**
     * @notice Synchronizes a legacy Zodiac role assignment with the native Zanzibar ReBAC engine.
     * @param roleKey Zodiac role key (bytes32)
     * @param member Target module/account address
     * @param relationId Mapped Zanzibar relation (e.g. 1: Owner, 2: Manager, 4: Executor)
     */
    function _syncZodiacRoleToZanzibar(
        bytes32 roleKey,
        address member,
        uint16 relationId
    ) internal {
        // Inscribe tuple into Zanzibar Slot 1 in RAM
        (bool success, ) = PRECOMPILE_ZANZIBAR_REBAC.call(
            abi.encodeWithSignature(
                "inscribeTuple(uint16,bytes32,uint16,address)",
                ZODIAC_NAMESPACE,
                roleKey,
                relationId,
                member
            )
        );
        require(success, "Zanzibar tuple sync failed");
        emit LegacyZodiacRoleSynced(roleKey, member, relationId);
    }

    /**
     * @notice Checks whether an account is authorized via native Zanzibar ReBAC.
     * @param roleKey The Zodiac role identifier
     * @param relationId The required relation index
     * @param member The address querying authorization
     */
    function _checkZanzibarRole(
        bytes32 roleKey,
        uint16 relationId,
        address member
    ) internal view returns (bool) {
        (bool success, bytes memory result) = PRECOMPILE_ZANZIBAR_REBAC.staticcall(
            abi.encodeWithSignature(
                "check(uint16,bytes32,uint16,address)",
                ZODIAC_NAMESPACE,
                roleKey,
                relationId,
                member
            )
        );
        if (success && result.length >= 32) {
            return abi.decode(result, (bool));
        }
        return false;
    }

    /**
     * @notice Queries the current account block-lattice sequence number from Precompile 0x0100.
     */
    function _getAccountLatticeHeight(address target) internal view returns (uint256) {
        (bool success, bytes memory result) = PRECOMPILE_LATTICE_HEIGHT.staticcall(
            abi.encodeWithSignature("getAccountHeight(address)", target)
        );
        if (success && result.length >= 32) {
            return abi.decode(result, (uint256));
        }
        return 0;
    }
}
