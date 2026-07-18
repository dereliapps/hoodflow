// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";

contract MockAdapterEngine {
    using SafeERC20 for IERC20;

    function approveToken(address token, address spender, uint256 amount) external {
        IERC20(token).forceApprove(spender, amount);
    }

    function executeSwap(
        address adapter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256 deadline,
        bytes calldata routeData
    ) external returns (uint256) {
        return ISwapAdapter(adapter).swapExactInput(
            tokenIn, tokenOut, amountIn, minAmountOut, recipient, deadline, routeData
        );
    }
}
