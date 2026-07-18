// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPermit2} from "../interfaces/IPermit2.sol";
import {IUniversalRouter} from "../interfaces/IUniversalRouter.sol";

contract MockV4UniversalRouter is IUniversalRouter {
    using SafeERC20 for IERC20;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

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
        require(commands.length == 1 && commands[0] == 0x10 && inputs.length == 1, "bad command");

        (bytes memory actions, bytes[] memory params) = abi.decode(inputs[0], (bytes, bytes[]));
        require(
            actions.length == 3 && actions[0] == 0x06 && actions[1] == 0x0c
                && actions[2] == 0x0f && params.length == 3,
            "bad actions"
        );
        ExactInputSingleParams memory swapParams =
            abi.decode(params[0], (ExactInputSingleParams));
        (address tokenIn, uint256 maxAmountIn) = abi.decode(params[1], (address, uint256));
        (address tokenOut, uint256 minAmountOut) = abi.decode(params[2], (address, uint256));

        require(maxAmountIn == swapParams.amountIn, "bad settle");
        require(minAmountOut == swapParams.amountOutMinimum, "bad take");
        require(swapParams.poolKey.hooks == address(0) && swapParams.hookData.length == 0, "bad hook");
        require(
            (swapParams.zeroForOne && tokenIn == swapParams.poolKey.currency0
                && tokenOut == swapParams.poolKey.currency1)
                || (!swapParams.zeroForOne && tokenIn == swapParams.poolKey.currency1
                    && tokenOut == swapParams.poolKey.currency0),
            "bad direction"
        );

        permit2.transferFrom(msg.sender, address(this), swapParams.amountIn, tokenIn);
        uint256 amountOut =
            Math.mulDiv(swapParams.amountIn, rateNumerator, rateDenominator);
        if (underDeliver) amountOut = minAmountOut - 1;
        require(amountOut >= minAmountOut || underDeliver, "slippage");
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }
}
