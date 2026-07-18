// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IStockToken {
    function oraclePaused() external view returns (bool);
}
