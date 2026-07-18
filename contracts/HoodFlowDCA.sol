// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPriceFeed} from "./interfaces/IPriceFeed.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";

/// @title HoodFlow DCA Engine
/// @notice Non-custodial, allowance-based recurring swaps with bounded execution.
/// @dev Testnet candidate. A professional audit and timelocked multisig are required before mainnet.
contract HoodFlowDCA is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_SLIPPAGE_BPS = 500;
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 100;
    uint48 public constant MIN_INTERVAL = 1 hours;
    uint48 public constant MAX_INTERVAL = 30 days;
    uint48 public constant MAX_START_DELAY = 30 days;
    uint48 public constant MAX_STRATEGY_DURATION = 366 days;
    uint48 public constant SWAP_DEADLINE_WINDOW = 5 minutes;

    enum StrategyStatus {
        Active,
        Paused,
        Cancelled,
        Completed
    }

    struct Strategy {
        address owner;
        address tokenIn;
        address tokenOut;
        uint128 amountPerExecution;
        uint128 totalBudget;
        uint128 remainingBudget;
        uint48 interval;
        uint48 nextExecution;
        uint48 expiresAt;
        uint16 maxSlippageBps;
        StrategyStatus status;
    }

    struct TokenConfig {
        IPriceFeed priceFeed;
        uint48 heartbeat;
        uint8 tokenDecimals;
        uint8 feedDecimals;
        bool allowed;
    }

    error ZeroAddress();
    error InvalidConfiguration();
    error TokenNotAllowed(address token);
    error KeeperNotAuthorized(address caller);
    error GuardianNotAuthorized(address caller);
    error NotStrategyOwner(uint256 strategyId, address caller);
    error StrategyNotExecutable(uint256 strategyId);
    error OracleInvalid(address token);
    error OracleStale(address token, uint256 updatedAt);
    error TransferAmountMismatch(uint256 expected, uint256 received);
    error SlippageExceeded(uint256 minimum, uint256 received);

    event StrategyCreated(
        uint256 indexed strategyId,
        address indexed owner,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountPerExecution,
        uint256 totalBudget,
        uint256 interval,
        uint256 startAt,
        uint256 expiresAt,
        uint256 maxSlippageBps
    );
    event StrategyExecuted(
        uint256 indexed strategyId,
        address indexed keeper,
        uint256 amountIn,
        uint256 amountOut,
        uint256 protocolFee,
        uint256 remainingBudget,
        uint256 nextExecution
    );
    event StrategyStatusChanged(uint256 indexed strategyId, StrategyStatus status);
    event KeeperUpdated(address indexed keeper, bool allowed);
    event TokenConfigUpdated(address indexed token, address indexed feed, uint48 heartbeat, bool allowed);
    event SwapAdapterUpdated(address indexed previousAdapter, address indexed newAdapter);
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    event ProtocolFeeUpdated(address indexed recipient, uint16 feeBps);

    mapping(uint256 strategyId => Strategy) public strategies;
    mapping(address keeper => bool) public keepers;
    mapping(address token => TokenConfig) public tokenConfigs;

    uint256 public strategyCount;
    uint256 public keeperCount;
    uint256 public allowedTokenCount;
    ISwapAdapter public swapAdapter;
    address public guardian;
    address public feeRecipient;
    uint16 public protocolFeeBps;

    modifier onlyStrategyOwner(uint256 strategyId) {
        if (strategies[strategyId].owner != msg.sender) {
            revert NotStrategyOwner(strategyId, msg.sender);
        }
        _;
    }

    modifier onlyKeeper() {
        if (!keepers[msg.sender]) revert KeeperNotAuthorized(msg.sender);
        _;
    }

    modifier onlyGuardianOrOwner() {
        if (msg.sender != guardian && msg.sender != owner()) {
            revert GuardianNotAuthorized(msg.sender);
        }
        _;
    }

    constructor(
        address initialOwner,
        address initialGuardian,
        address initialSwapAdapter,
        address initialFeeRecipient,
        uint16 initialFeeBps
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) || initialGuardian == address(0)
                || initialFeeRecipient == address(0)
        ) revert ZeroAddress();
        if (initialFeeBps > MAX_PROTOCOL_FEE_BPS) revert InvalidConfiguration();
        if (initialSwapAdapter != address(0) && initialSwapAdapter.code.length == 0) {
            revert InvalidConfiguration();
        }

        guardian = initialGuardian;
        swapAdapter = ISwapAdapter(initialSwapAdapter);
        feeRecipient = initialFeeRecipient;
        protocolFeeBps = initialFeeBps;

        // Critical configuration must be completed before the owner explicitly enables execution.
        _pause();
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner whenPaused {
        if (keeper == address(0)) revert ZeroAddress();
        if (keepers[keeper] != allowed) {
            keeperCount = allowed ? keeperCount + 1 : keeperCount - 1;
        }
        keepers[keeper] = allowed;
        emit KeeperUpdated(keeper, allowed);
    }

    function setTokenConfig(address token, address feed, uint48 heartbeat, bool allowed)
        external
        onlyOwner
        whenPaused
    {
        if (token == address(0) || feed == address(0)) revert ZeroAddress();
        if (heartbeat == 0) revert InvalidConfiguration();

        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        uint8 feedDecimals = IPriceFeed(feed).decimals();
        if (tokenDecimals > 18 || feedDecimals > 18) revert InvalidConfiguration();

        if (tokenConfigs[token].allowed != allowed) {
            allowedTokenCount = allowed ? allowedTokenCount + 1 : allowedTokenCount - 1;
        }
        tokenConfigs[token] = TokenConfig({
            priceFeed: IPriceFeed(feed),
            heartbeat: heartbeat,
            tokenDecimals: tokenDecimals,
            feedDecimals: feedDecimals,
            allowed: allowed
        });
        emit TokenConfigUpdated(token, feed, heartbeat, allowed);
    }

    function setSwapAdapter(address newAdapter) external onlyOwner whenPaused {
        if (newAdapter == address(0)) revert ZeroAddress();
        if (newAdapter.code.length == 0) revert InvalidConfiguration();
        address previous = address(swapAdapter);
        swapAdapter = ISwapAdapter(newAdapter);
        emit SwapAdapterUpdated(previous, newAdapter);
    }

    function setGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert ZeroAddress();
        address previous = guardian;
        guardian = newGuardian;
        emit GuardianUpdated(previous, newGuardian);
    }

    function setProtocolFee(address newFeeRecipient, uint16 newFeeBps) external onlyOwner whenPaused {
        if (newFeeRecipient == address(0)) revert ZeroAddress();
        if (newFeeBps > MAX_PROTOCOL_FEE_BPS) revert InvalidConfiguration();
        feeRecipient = newFeeRecipient;
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(newFeeRecipient, newFeeBps);
    }

    function pauseEverything() external onlyGuardianOrOwner {
        _pause();
    }

    function unpauseEverything() external onlyOwner {
        if (address(swapAdapter) == address(0) || keeperCount == 0 || allowedTokenCount < 2) {
            revert InvalidConfiguration();
        }
        _unpause();
    }

    function createStrategy(
        address tokenIn,
        address tokenOut,
        uint128 amountPerExecution,
        uint128 totalBudget,
        uint48 interval,
        uint48 startAt,
        uint48 expiresAt,
        uint16 maxSlippageBps
    ) external whenNotPaused returns (uint256 strategyId) {
        _validateStrategy(
            tokenIn,
            tokenOut,
            amountPerExecution,
            totalBudget,
            interval,
            startAt,
            expiresAt,
            maxSlippageBps
        );

        uint48 effectiveStart = startAt == 0 ? uint48(block.timestamp) : startAt;
        strategyId = ++strategyCount;
        strategies[strategyId] = Strategy({
            owner: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountPerExecution: amountPerExecution,
            totalBudget: totalBudget,
            remainingBudget: totalBudget,
            interval: interval,
            nextExecution: effectiveStart,
            expiresAt: expiresAt,
            maxSlippageBps: maxSlippageBps,
            status: StrategyStatus.Active
        });

        emit StrategyCreated(
            strategyId,
            msg.sender,
            tokenIn,
            tokenOut,
            amountPerExecution,
            totalBudget,
            interval,
            effectiveStart,
            expiresAt,
            maxSlippageBps
        );
    }

    function pauseStrategy(uint256 strategyId) external onlyStrategyOwner(strategyId) {
        Strategy storage strategy = strategies[strategyId];
        if (strategy.status != StrategyStatus.Active) revert StrategyNotExecutable(strategyId);
        strategy.status = StrategyStatus.Paused;
        emit StrategyStatusChanged(strategyId, StrategyStatus.Paused);
    }

    function resumeStrategy(uint256 strategyId) external whenNotPaused onlyStrategyOwner(strategyId) {
        Strategy storage strategy = strategies[strategyId];
        if (
            strategy.status != StrategyStatus.Paused || block.timestamp >= strategy.expiresAt
                || strategy.remainingBudget < strategy.amountPerExecution
        ) revert StrategyNotExecutable(strategyId);

        strategy.status = StrategyStatus.Active;
        if (strategy.nextExecution < block.timestamp) strategy.nextExecution = uint48(block.timestamp);
        emit StrategyStatusChanged(strategyId, StrategyStatus.Active);
    }

    function cancelStrategy(uint256 strategyId) external onlyStrategyOwner(strategyId) {
        Strategy storage strategy = strategies[strategyId];
        if (
            strategy.status == StrategyStatus.Cancelled || strategy.status == StrategyStatus.Completed
        ) revert StrategyNotExecutable(strategyId);
        strategy.status = StrategyStatus.Cancelled;
        emit StrategyStatusChanged(strategyId, StrategyStatus.Cancelled);
    }

    function executeDCA(uint256 strategyId, bytes calldata routeData)
        external
        nonReentrant
        whenNotPaused
        onlyKeeper
        returns (uint256 amountOut)
    {
        Strategy storage strategy = strategies[strategyId];
        if (!_isReady(strategy)) revert StrategyNotExecutable(strategyId);

        uint256 grossAmount = strategy.amountPerExecution;
        uint256 feeAmount = Math.mulDiv(grossAmount, protocolFeeBps, BPS_DENOMINATOR);
        uint256 swapAmount = grossAmount - feeAmount;
        uint256 minAmountOut = quoteMinOut(
            strategy.tokenIn, strategy.tokenOut, swapAmount, strategy.maxSlippageBps
        );

        strategy.remainingBudget -= strategy.amountPerExecution;
        if (strategy.remainingBudget < strategy.amountPerExecution) {
            strategy.status = StrategyStatus.Completed;
        } else {
            strategy.nextExecution = uint48(block.timestamp) + strategy.interval;
        }

        IERC20 tokenIn = IERC20(strategy.tokenIn);
        IERC20 tokenOut = IERC20(strategy.tokenOut);
        uint256 inputBalanceBefore = tokenIn.balanceOf(address(this));
        uint256 outputBalanceBefore = tokenOut.balanceOf(strategy.owner);

        tokenIn.safeTransferFrom(strategy.owner, address(this), grossAmount);
        uint256 receivedInput = tokenIn.balanceOf(address(this)) - inputBalanceBefore;
        if (receivedInput != grossAmount) {
            revert TransferAmountMismatch(grossAmount, receivedInput);
        }

        if (feeAmount != 0) tokenIn.safeTransfer(feeRecipient, feeAmount);
        tokenIn.forceApprove(address(swapAdapter), swapAmount);
        swapAdapter.swapExactInput(
            strategy.tokenIn,
            strategy.tokenOut,
            swapAmount,
            minAmountOut,
            strategy.owner,
            block.timestamp + SWAP_DEADLINE_WINDOW,
            routeData
        );
        tokenIn.forceApprove(address(swapAdapter), 0);

        amountOut = tokenOut.balanceOf(strategy.owner) - outputBalanceBefore;
        if (amountOut < minAmountOut) revert SlippageExceeded(minAmountOut, amountOut);

        emit StrategyExecuted(
            strategyId,
            msg.sender,
            grossAmount,
            amountOut,
            feeAmount,
            strategy.remainingBudget,
            strategy.nextExecution
        );
        if (strategy.status == StrategyStatus.Completed) {
            emit StrategyStatusChanged(strategyId, StrategyStatus.Completed);
        }
    }

    function isStrategyReady(uint256 strategyId) external view returns (bool) {
        return !paused() && _isReady(strategies[strategyId]);
    }

    function quoteMinOut(address tokenIn, address tokenOut, uint256 amountIn, uint16 slippageBps)
        public
        view
        returns (uint256)
    {
        if (slippageBps > MAX_SLIPPAGE_BPS) revert InvalidConfiguration();
        TokenConfig memory inConfig = tokenConfigs[tokenIn];
        TokenConfig memory outConfig = tokenConfigs[tokenOut];
        if (!inConfig.allowed) revert TokenNotAllowed(tokenIn);
        if (!outConfig.allowed) revert TokenNotAllowed(tokenOut);

        uint256 priceIn = _readPrice(tokenIn, inConfig);
        uint256 priceOut = _readPrice(tokenOut, outConfig);
        uint256 inScale = 10 ** uint256(inConfig.tokenDecimals + inConfig.feedDecimals);
        uint256 outScale = 10 ** uint256(outConfig.tokenDecimals + outConfig.feedDecimals);

        uint256 usdValue18 = Math.mulDiv(amountIn, priceIn * 1e18, inScale);
        uint256 expectedOut = Math.mulDiv(usdValue18, outScale, priceOut * 1e18);
        return Math.mulDiv(expectedOut, BPS_DENOMINATOR - slippageBps, BPS_DENOMINATOR);
    }

    function _validateStrategy(
        address tokenIn,
        address tokenOut,
        uint128 amountPerExecution,
        uint128 totalBudget,
        uint48 interval,
        uint48 startAt,
        uint48 expiresAt,
        uint16 maxSlippageBps
    ) internal view {
        if (!tokenConfigs[tokenIn].allowed) revert TokenNotAllowed(tokenIn);
        if (!tokenConfigs[tokenOut].allowed) revert TokenNotAllowed(tokenOut);
        if (tokenIn == tokenOut || amountPerExecution == 0 || totalBudget < amountPerExecution) {
            revert InvalidConfiguration();
        }
        if (totalBudget % amountPerExecution != 0) revert InvalidConfiguration();
        if (interval < MIN_INTERVAL || interval > MAX_INTERVAL) revert InvalidConfiguration();
        if (maxSlippageBps > MAX_SLIPPAGE_BPS) revert InvalidConfiguration();

        uint48 effectiveStart = startAt == 0 ? uint48(block.timestamp) : startAt;
        if (effectiveStart < block.timestamp || effectiveStart > block.timestamp + MAX_START_DELAY) {
            revert InvalidConfiguration();
        }
        if (expiresAt <= effectiveStart || expiresAt > block.timestamp + MAX_STRATEGY_DURATION) {
            revert InvalidConfiguration();
        }
    }

    function _isReady(Strategy storage strategy) internal view returns (bool) {
        return strategy.owner != address(0) && strategy.status == StrategyStatus.Active
            && block.timestamp >= strategy.nextExecution && block.timestamp < strategy.expiresAt
            && strategy.remainingBudget >= strategy.amountPerExecution;
    }

    function _readPrice(address token, TokenConfig memory config) internal view returns (uint256) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            config.priceFeed.latestRoundData();
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp || answeredInRound < roundId) {
            revert OracleInvalid(token);
        }
        if (block.timestamp - updatedAt > config.heartbeat) revert OracleStale(token, updatedAt);
        return uint256(answer);
    }
}
