// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPriceFeed} from "./interfaces/IPriceFeed.sol";

/// @title HoodFlow Fixed USD Reference Feed
/// @notice Immutable 1.00 USD reference used only for the canonical USDG settlement token.
/// @dev This deliberately makes the USDG peg assumption explicit and cannot be updated by an admin.
contract FixedUsdFeed is IPriceFeed {
    uint8 public constant decimals = 8;
    int256 public constant ANSWER = 100_000_000;

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, ANSWER, block.timestamp, block.timestamp, 1);
    }
}
