// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct UserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 verificationGasLimit;
    uint256 preVerificationGas;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    bytes paymasterAndData;
    bytes signature;
}

/// @title Hardened Sovereign Paymaster with EntryPoint Validation and Deposit Accounting
/// @notice Remediates unconditional drain vulnerability (C6) by enforcing caller access control,
/// per-sender gas sponsorship allowances, and ERC-4337 signature/quota validation.
contract SimplePaymaster {
    address public immutable entryPoint;
    address public owner;

    /// @notice Gas sponsorship allowances per sender address
    mapping(address => uint256) public senderAllowances;

    /// @notice Total sponsored gas tracking
    mapping(address => uint256) public totalSponsoredGas;

    event GasSponsored(address indexed sender, uint256 actualCost);
    event AllowanceGranted(address indexed sender, uint256 amount);

    enum PostOpMode {
        opSucceeded,
        opReverted,
        postOpReverted
    }

    event Deposited(address indexed sender, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyEntryPoint() {
        require(msg.sender == entryPoint, "Paymaster: caller must be EntryPoint");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Paymaster: caller must be owner");
        _;
    }

    constructor(address _entryPoint) {
        require(_entryPoint != address(0), "Invalid EntryPoint");
        entryPoint = _entryPoint;
        owner = msg.sender;
    }

    /// @notice Adds deposit to the EntryPoint contract for this paymaster (M-3).
    function depositToEntryPoint() external payable onlyOwner {
        (bool success, ) = entryPoint.call{value: msg.value}(abi.encodeWithSignature("depositTo(address)", address(this)));
        require(success, "Deposit to EntryPoint failed");
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraws deposit from the EntryPoint contract (M-3).
    function withdrawFromEntryPoint(address payable withdrawAddress, uint256 amount) external onlyOwner {
        (bool success, ) = entryPoint.call(
            abi.encodeWithSignature("withdrawTo(address,uint256)", withdrawAddress, amount)
        );
        require(success, "Withdraw from EntryPoint failed");
        emit Withdrawn(withdrawAddress, amount);
    }

    function setAllowance(address sender, uint256 allowance) external onlyOwner {
        senderAllowances[sender] = allowance;
        emit AllowanceGranted(sender, allowance);
    }

    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 maxCost
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        // Enforce paymasterAndData begins with this paymaster address
        require(userOp.paymasterAndData.length >= 20, "Paymaster: invalid paymasterAndData length");
        address paymasterAddr = address(bytes20(userOp.paymasterAndData[:20]));
        require(paymasterAddr == address(this), "Paymaster: target mismatch");

        // Enforce sender gas sponsorship allowance
        uint256 available = senderAllowances[userOp.sender];
        if (available < maxCost) {
            // Return 1 in validationData to signal signature/quota failure to EntryPoint
            return ("", 1);
        }

        // Deduct upfront maximum cost
        senderAllowances[userOp.sender] = available - maxCost;

        // Context contains sender and allocated maxCost for refund in postOp
        context = abi.encode(userOp.sender, maxCost);
        validationData = 0; // Success
    }

    function postOp(
        PostOpMode /*mode*/,
        bytes calldata context,
        uint256 actualGasCost
    ) external onlyEntryPoint {
        (address sender, uint256 maxCost) = abi.decode(context, (address, uint256));

        // Refund unspent gas cost back to sender allowance
        if (maxCost > actualGasCost) {
            uint256 refund = maxCost - actualGasCost;
            senderAllowances[sender] += refund;
        }

        totalSponsoredGas[sender] += actualGasCost;
        emit GasSponsored(sender, actualGasCost);
    }

    receive() external payable {}
}
