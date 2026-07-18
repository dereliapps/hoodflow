// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISwapAdapter {
    /// @notice Swaps an exact ERC-20 input amount and sends output directly to recipient.
    /// @dev The adapter pulls amountIn from msg.sender and must enforce minAmountOut.
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256 deadline,
        bytes calldata routeData
    ) external returns (uint256 amountOut);
}
