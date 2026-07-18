// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPermit2} from "../interfaces/IPermit2.sol";
import {IUniversalRouter} from "../interfaces/IUniversalRouter.sol";

contract MockUniversalRouter is IUniversalRouter {
    using SafeERC20 for IERC20;

    IPermit2 public immutable permit2;
    uint256 public rateNumerator;
    uint256 public rateDenominator;
    bool public underDeliver;

    constructor(address permit2_, uint256 initialRateNumerator, uint256 initialRateDenominator) {
        permit2 = IPermit2(permit2_);
        setRate(initialRateNumerator, initialRateDenominator);
    }

    function setRate(uint256 numerator, uint256 denominator) public {
        require(numerator != 0 && denominator != 0, "invalid rate");
        rateNumerator = numerator;
        rateDenominator = denominator;
    }

    function setUnderDeliver(bool value) external {
        underDeliver = value;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)
        external
        payable
    {
        require(block.timestamp <= deadline, "expired");
        require(commands.length == 1 && commands[0] == 0x00 && inputs.length == 1, "bad command");

        (address recipient, uint256 amountIn, uint256 minAmountOut, bytes memory path, bool payerIsUser) =
            abi.decode(inputs[0], (address, uint256, uint256, bytes, bool));
        require(payerIsUser && path.length == 43, "bad input");

        address tokenIn;
        address tokenOut;
        assembly ("memory-safe") {
            tokenIn := shr(96, mload(add(path, 32)))
            tokenOut := shr(96, mload(add(path, 55)))
        }

        permit2.transferFrom(msg.sender, address(this), uint160(amountIn), tokenIn);
        uint256 amountOut = Math.mulDiv(amountIn, rateNumerator, rateDenominator);
        if (underDeliver) amountOut = minAmountOut - 1;
        require(amountOut >= minAmountOut || underDeliver, "slippage");
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }
}
