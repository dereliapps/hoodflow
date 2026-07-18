// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPermit2} from "./interfaces/IPermit2.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";
import {IUniversalRouter} from "./interfaces/IUniversalRouter.sol";

/// @title HoodFlow Uniswap V3 Direct Adapter
/// @notice Executes one exact-input V3 pool hop through the official Universal Router.
/// @dev Immutable engine/router bindings remove post-deployment routing authority.
contract UniswapV3DirectAdapter is ISwapAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes1 private constant V3_SWAP_EXACT_IN = 0x00;
    uint256 private constant DIRECT_PATH_LENGTH = 43;
    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;

    address public immutable engine;
    IUniversalRouter public immutable universalRouter;
    IPermit2 public immutable permit2;

    error ZeroAddress();
    error InvalidContract(address target);
    error UnauthorizedCaller(address caller);
    error InvalidRoute();
    error UnsupportedFee(uint24 fee);
    error InvalidDeadline(uint256 deadline);
    error AmountTooLarge();
    error TransferAmountMismatch(uint256 expected, uint256 received);
    error ResidualInput(uint256 expectedBalance, uint256 actualBalance);
    error SlippageExceeded(uint256 minimum, uint256 received);

    event DirectSwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        address indexed recipient,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor(address engine_, address universalRouter_, address permit2_) {
        if (engine_ == address(0) || universalRouter_ == address(0) || permit2_ == address(0)) {
            revert ZeroAddress();
        }
        if (engine_.code.length == 0) revert InvalidContract(engine_);
        if (universalRouter_.code.length == 0) revert InvalidContract(universalRouter_);
        if (permit2_.code.length == 0) revert InvalidContract(permit2_);

        engine = engine_;
        universalRouter = IUniversalRouter(universalRouter_);
        permit2 = IPermit2(permit2_);
    }

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256 deadline,
        bytes calldata routeData
    ) external nonReentrant returns (uint256 amountOut) {
        if (msg.sender != engine) revert UnauthorizedCaller(msg.sender);
        if (tokenIn == address(0) || tokenOut == address(0) || recipient == address(0)) {
            revert ZeroAddress();
        }
        if (tokenIn == tokenOut || amountIn == 0 || minAmountOut == 0) revert InvalidRoute();
        if (amountIn > type(uint160).max) revert AmountTooLarge();
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) {
            revert InvalidDeadline(deadline);
        }

        (address pathTokenIn, uint24 fee, address pathTokenOut) = _decodeDirectPath(routeData);
        if (pathTokenIn != tokenIn || pathTokenOut != tokenOut) revert InvalidRoute();
        if (fee != 100 && fee != 500 && fee != 3_000 && fee != 10_000) {
            revert UnsupportedFee(fee);
        }

        IERC20 inputToken = IERC20(tokenIn);
        IERC20 outputToken = IERC20(tokenOut);
        uint256 inputBefore = inputToken.balanceOf(address(this));
        uint256 outputBefore = outputToken.balanceOf(recipient);

        inputToken.safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 receivedInput = inputToken.balanceOf(address(this)) - inputBefore;
        if (receivedInput != amountIn) revert TransferAmountMismatch(amountIn, receivedInput);

        inputToken.forceApprove(address(permit2), amountIn);
        permit2.approve(tokenIn, address(universalRouter), uint160(amountIn), uint48(deadline));

        bytes memory commands = abi.encodePacked(V3_SWAP_EXACT_IN);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(recipient, amountIn, minAmountOut, routeData, true);
        universalRouter.execute(commands, inputs, deadline);

        permit2.approve(tokenIn, address(universalRouter), 0, uint48(block.timestamp));
        inputToken.forceApprove(address(permit2), 0);

        uint256 inputAfter = inputToken.balanceOf(address(this));
        if (inputAfter != inputBefore) revert ResidualInput(inputBefore, inputAfter);
        amountOut = outputToken.balanceOf(recipient) - outputBefore;
        if (amountOut < minAmountOut) revert SlippageExceeded(minAmountOut, amountOut);

        emit DirectSwapExecuted(tokenIn, tokenOut, recipient, fee, amountIn, amountOut);
    }

    function _decodeDirectPath(bytes calldata path)
        private
        pure
        returns (address tokenIn, uint24 fee, address tokenOut)
    {
        if (path.length != DIRECT_PATH_LENGTH) revert InvalidRoute();
        assembly ("memory-safe") {
            tokenIn := shr(96, calldataload(path.offset))
            fee := shr(232, calldataload(add(path.offset, 20)))
            tokenOut := shr(96, calldataload(add(path.offset, 23)))
        }
    }
}
