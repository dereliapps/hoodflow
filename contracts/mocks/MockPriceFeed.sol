// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPriceFeed} from "../interfaces/IPriceFeed.sol";

contract MockPriceFeed is IPriceFeed {
    uint8 public immutable override decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;
    uint80 public answeredInRound;

    constructor(uint8 decimals_, int256 initialAnswer) {
        decimals = decimals_;
        setAnswer(initialAnswer, block.timestamp);
    }

    function setAnswer(int256 newAnswer, uint256 timestamp) public {
        answer = newAnswer;
        updatedAt = timestamp;
        roundId++;
        answeredInRound = roundId;
    }

    function setIncompleteRound(int256 newAnswer, uint256 timestamp) external {
        answer = newAnswer;
        updatedAt = timestamp;
        roundId++;
        answeredInRound = roundId - 1;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}
