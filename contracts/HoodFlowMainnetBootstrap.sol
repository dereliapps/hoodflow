// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FixedUsdFeed} from "./FixedUsdFeed.sol";
import {HoodFlowDCA} from "./HoodFlowDCA.sol";
import {UniswapV4DirectAdapter} from "./UniswapV4DirectAdapter.sol";

/// @title HoodFlow Mainnet Bootstrap
/// @notice Deploys and configures the reviewed HoodFlow DCA release in one wallet transaction.
/// @dev Canonical Robinhood and Chainlink addresses are immutable in this bytecode.
contract HoodFlowMainnetBootstrap {
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address private constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint128 private constant MAX_TRANCHE = 25_000_000;
    uint128 private constant MAX_STRATEGY_BUDGET = 500_000_000;
    uint16 private constant PROTOCOL_FEE_BPS = 10;

    HoodFlowDCA public immutable engine;
    UniswapV4DirectAdapter public immutable adapter;
    FixedUsdFeed public immutable fixedUsdFeed;

    error InvalidRoleConfiguration();

    constructor(address finalOwner, address guardian, address feeRecipient, address keeper) {
        if (
            msg.sender != finalOwner || finalOwner == address(0) || guardian == address(0)
                || feeRecipient == address(0) || keeper == address(0)
                || finalOwner == guardian || finalOwner == feeRecipient || finalOwner == keeper
                || guardian == feeRecipient || guardian == keeper || feeRecipient == keeper
        ) revert InvalidRoleConfiguration();

        FixedUsdFeed usdFeed = new FixedUsdFeed();
        HoodFlowDCA dca = new HoodFlowDCA(
            address(this),
            guardian,
            address(0),
            feeRecipient,
            PROTOCOL_FEE_BPS,
            USDG,
            MAX_TRANCHE,
            MAX_STRATEGY_BUDGET
        );
        UniswapV4DirectAdapter v4Adapter =
            new UniswapV4DirectAdapter(address(dca), UNIVERSAL_ROUTER, PERMIT2);

        dca.setSwapAdapter(address(v4Adapter));
        dca.setSequencerConfig(address(0), 0);
        dca.setKeeper(keeper, true);
        dca.setTokenConfig(USDG, address(usdFeed), 7 days, true, false);

        _enable(dca, 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0);
        _enable(dca, 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72);
        _enable(dca, 0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C);
        _enable(dca, 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0xF6f373a037c30F0e5010d854385cA89185AE638b);
        _enable(dca, 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 0x3f390C5C24628Ac7C489515402235FeAD71D1913);
        _enable(dca, 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 0x7C38C00C30BEe9378381E7B6135d7283356D71b1);
        _enable(dca, 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 0x425EEFdCf05ed6526C3cE61Af99429A228a6d596);
        _enable(dca, 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15);
        _enable(dca, 0xB90A19fF0Af67f7779afF50A882A9CfF42446400, 0xfb133Fa4B7b385802B693a293606682Df47109A3);
        _enable(dca, 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb);
        _enable(dca, 0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0x4A1166a659A55625345e9515b32adECea5547C38);
        _enable(dca, 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0x80901d846d5D7B030F26B480776EE3b29374C2ae);
        _enable(dca, 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 0x319724394D3A0e3669269846abE664Cd621f9f6A);

        dca.transferOwnership(finalOwner);
        engine = dca;
        adapter = v4Adapter;
        fixedUsdFeed = usdFeed;
    }

    function _enable(HoodFlowDCA dca, address token, address feed) private {
        dca.setTokenConfig(token, feed, 1 days, true, true);
    }
}
