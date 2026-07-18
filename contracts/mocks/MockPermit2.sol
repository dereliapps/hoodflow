// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPermit2} from "../interfaces/IPermit2.sol";

contract MockPermit2 is IPermit2 {
    using SafeERC20 for IERC20;

    struct Allowance {
        uint160 amount;
        uint48 expiration;
    }

    mapping(address owner => mapping(address token => mapping(address spender => Allowance)))
        public allowances;

    function approve(address token, address spender, uint160 amount, uint48 expiration) external {
        allowances[msg.sender][token][spender] = Allowance(amount, expiration);
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        Allowance storage permitted = allowances[from][token][msg.sender];
        require(permitted.expiration >= block.timestamp, "permit expired");
        require(permitted.amount >= amount, "permit exceeded");
        permitted.amount -= amount;
        IERC20(token).safeTransferFrom(from, to, amount);
    }
}
