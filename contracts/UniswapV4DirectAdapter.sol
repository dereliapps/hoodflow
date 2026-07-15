// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPermit2} from "./interfaces/IPermit2.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";
import {IUniversalRouter} from "./interfaces/IUniversalRouter.sol";

/// @title HoodFlow Uniswap V4 Direct Adapter
/// @notice Executes one exact-input, hookless V4 pool hop through the official Universal Router.
/// @dev The adapter constructs every router command itself; keepers can only select a bounded pool.
contract UniswapV4DirectAdapter is ISwapAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes1 private constant V4_SWAP = 0x10;
    bytes1 private constant SWAP_EXACT_IN_SINGLE = 0x06;
    bytes1 private constant SETTLE_ALL = 0x0c;
    bytes1 private constant TAKE_ALL = 0x0f;
    uint256 private constant ROUTE_DATA_LENGTH = 96;
    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;

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

    address public immutable engine;
    IUniversalRouter public immutable universalRouter;
    IPermit2 public immutable permit2;

    error ZeroAddress();
    error InvalidContract(address target);
    error UnauthorizedCaller(address caller);
    error InvalidRoute();
    error UnsupportedPool(uint24 fee, int24 tickSpacing, address hooks);
    error InvalidDeadline(uint256 deadline);
    error AmountTooLarge();
    error TransferAmountMismatch(uint256 expected, uint256 received);
    error ResidualInput(uint256 expectedBalance, uint256 actualBalance);
    error SlippageExceeded(uint256 minimum, uint256 received);

    event DirectV4SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        address indexed recipient,
        uint24 fee,
        int24 tickSpacing,
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
        if (amountIn > type(uint128).max || minAmountOut > type(uint128).max) {
            revert AmountTooLarge();
        }
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) {
            revert InvalidDeadline(deadline);
        }

        (uint24 fee, int24 tickSpacing, address hooks) = _decodeRoute(routeData);
        if (!_isSupportedPool(fee, tickSpacing, hooks)) {
            revert UnsupportedPool(fee, tickSpacing, hooks);
        }

        IERC20 inputToken = IERC20(tokenIn);
        IERC20 outputToken = IERC20(tokenOut);
        uint256 inputBefore = inputToken.balanceOf(address(this));
        uint256 outputBefore = outputToken.balanceOf(address(this));
        uint256 recipientOutputBefore = outputToken.balanceOf(recipient);

        inputToken.safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 receivedInput = inputToken.balanceOf(address(this)) - inputBefore;
        if (receivedInput != amountIn) revert TransferAmountMismatch(amountIn, receivedInput);

        inputToken.forceApprove(address(permit2), amountIn);
        permit2.approve(tokenIn, address(universalRouter), uint160(amountIn), uint48(deadline));

        (address currency0, address currency1, bool zeroForOne) = tokenIn < tokenOut
            ? (tokenIn, tokenOut, true)
            : (tokenOut, tokenIn, false);
        PoolKey memory poolKey = PoolKey(currency0, currency1, fee, tickSpacing, hooks);
        ExactInputSingleParams memory swapParams = ExactInputSingleParams({
            poolKey: poolKey,
            zeroForOne: zeroForOne,
            amountIn: uint128(amountIn),
            amountOutMinimum: uint128(minAmountOut),
            minHopPriceX36: 0,
            hookData: ""
        });

        bytes memory actions = abi.encodePacked(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL);
        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = abi.encode(swapParams);
        actionParams[1] = abi.encode(tokenIn, amountIn);
        actionParams[2] = abi.encode(tokenOut, minAmountOut);

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParams);
        universalRouter.execute(abi.encodePacked(V4_SWAP), inputs, deadline);

        permit2.approve(tokenIn, address(universalRouter), 0, uint48(block.timestamp));
        inputToken.forceApprove(address(permit2), 0);

        uint256 inputAfter = inputToken.balanceOf(address(this));
        if (inputAfter != inputBefore) revert ResidualInput(inputBefore, inputAfter);
        amountOut = outputToken.balanceOf(address(this)) - outputBefore;
        if (amountOut < minAmountOut) revert SlippageExceeded(minAmountOut, amountOut);

        outputToken.safeTransfer(recipient, amountOut);
        uint256 receivedOutput = outputToken.balanceOf(recipient) - recipientOutputBefore;
        // The engine independently measures the same recipient delta; this check catches output-tax tokens here.
        if (receivedOutput < amountOut) revert SlippageExceeded(amountOut, receivedOutput);

        emit DirectV4SwapExecuted(
            tokenIn, tokenOut, recipient, fee, tickSpacing, amountIn, amountOut
        );
    }

    function _decodeRoute(bytes calldata routeData)
        private
        pure
        returns (uint24 fee, int24 tickSpacing, address hooks)
    {
        if (routeData.length != ROUTE_DATA_LENGTH) revert InvalidRoute();
        return abi.decode(routeData, (uint24, int24, address));
    }

    function _isSupportedPool(uint24 fee, int24 tickSpacing, address hooks)
        private
        pure
        returns (bool)
    {
        if (hooks != address(0)) return false;
        return (fee == 500 && tickSpacing == 10) || (fee == 3_000 && tickSpacing == 60)
            || (fee == 10_000 && tickSpacing == 200);
    }
}
