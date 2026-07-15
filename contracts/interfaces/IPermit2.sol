// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;

    function transferFrom(address from, address to, uint160 amount, address token) external;
}
