// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";

contract MockSwapAdapter is ISwapAdapter {
    using SafeERC20 for IERC20;

    uint256 public rateNumerator;
    uint256 public rateDenominator;
    bool public underDeliver;

    constructor(uint256 initialRateNumerator, uint256 initialRateDenominator) {
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

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256 deadline,
        bytes calldata
    ) external returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "expired");
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        amountOut = Math.mulDiv(amountIn, rateNumerator, rateDenominator);
        if (underDeliver) amountOut = minAmountOut == 0 ? 0 : minAmountOut - 1;
        require(amountOut >= minAmountOut || underDeliver, "slippage");
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }
}
