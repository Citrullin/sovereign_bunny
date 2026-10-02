// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ZodiacZanzibarDao.sol";

/**
 * @title TestAvatar
 * @notice Standard Gnosis Safe Avatar test double adapted from Zodiac Modifier Roles fixture.
 * Implements execTransactionFromModule and execTransactionFromModuleReturnData.
 */
contract TestAvatar is IAvatar {
    receive() external payable {}

    function exec(
        address payable to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external {
        bool success;
        bytes memory response;
        if (operation == 1) (success, ) = to.delegatecall(data);
        else (success, response) = to.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(response, 0x20), mload(response))
            }
        }
    }

    function execTransactionFromModule(
        address payable to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external override returns (bool success) {
        if (operation == 1) (success, ) = to.delegatecall(data);
        else (success, ) = to.call{value: value}(data);
    }

    function execTransactionFromModuleReturnData(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    ) external override returns (bool success, bytes memory returnData) {
        if (operation == 1) (success, returnData) = to.delegatecall(data);
        else (success, returnData) = to.call{value: value}(data);
    }
}
