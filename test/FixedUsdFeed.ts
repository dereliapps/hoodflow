import { expect } from "chai";
import { network } from "hardhat";

describe("FixedUsdFeed", function () {
  it("returns an immutable current 1.00 USD reference", async function () {
    const { ethers } = await network.connect();
    const feed = await ethers.deployContract("FixedUsdFeed");
    const block = await ethers.provider.getBlock("latest");
    const round = await feed.latestRoundData();

    expect(await feed.decimals()).to.equal(8);
    expect(await feed.ANSWER()).to.equal(100_000_000n);
    expect(round.roundId).to.equal(1n);
    expect(round.answer).to.equal(100_000_000n);
    expect(round.startedAt).to.equal(BigInt(block!.timestamp));
    expect(round.updatedAt).to.equal(BigInt(block!.timestamp));
    expect(round.answeredInRound).to.equal(1n);
  });
});
