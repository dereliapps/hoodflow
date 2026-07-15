/* eslint-disable @typescript-eslint/no-explicit-any -- Hardhat runtime ABI contracts are intentionally dynamic in tests. */
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const EMPTY_ROUTE = "0x";

async function deployFixture() {
  const [owner, guardian, keeper, user, feeRecipient, outsider] =
    await ethers.getSigners();

  const usdc: any = await ethers.deployContract("MockERC20", [
    "USD Coin",
    "USDC",
    6,
  ]);
  const weth: any = await ethers.deployContract("MockERC20", [
    "Wrapped Ether",
    "WETH",
    18,
  ]);
  const usdcFeed: any = await ethers.deployContract("MockPriceFeed", [
    8,
    100_000_000n,
  ]);
  const wethFeed: any = await ethers.deployContract("MockPriceFeed", [
    8,
    200_000_000_000n,
  ]);

  // 1 USDC unit (1e6) -> 0.0005 WETH (5e14), matching a $2,000 ETH price.
  const adapter: any = await ethers.deployContract("MockSwapAdapter", [
    500_000_000n,
    1n,
  ]);
  const hoodFlow: any = await ethers.deployContract("HoodFlowDCA", [
    owner.address,
    guardian.address,
    await adapter.getAddress(),
    feeRecipient.address,
    50,
  ]);

  await usdc.mint(user.address, ethers.parseUnits("10000", 6));
  await weth.mint(await adapter.getAddress(), ethers.parseEther("100"));

  await hoodFlow.setKeeper(keeper.address, true);
  await hoodFlow.setTokenConfig(
    await usdc.getAddress(),
    await usdcFeed.getAddress(),
    HOUR,
    true,
  );
  await hoodFlow.setTokenConfig(
    await weth.getAddress(),
    await wethFeed.getAddress(),
    HOUR,
    true,
  );
  await hoodFlow.unpauseEverything();
  await usdc
    .connect(user)
    .approve(await hoodFlow.getAddress(), ethers.MaxUint256);

  return {
    owner,
    guardian,
    keeper,
    user,
    feeRecipient,
    outsider,
    usdc,
    weth,
    usdcFeed,
    wethFeed,
    adapter,
    hoodFlow,
  };
}

async function createDefaultStrategy(fixture: Awaited<ReturnType<typeof deployFixture>>) {
  const { hoodFlow, user, usdc, weth } = fixture;
  const now = await time.latest();
  return hoodFlow.connect(user).createStrategy(
    await usdc.getAddress(),
    await weth.getAddress(),
    ethers.parseUnits("100", 6),
    ethers.parseUnits("300", 6),
    DAY,
    0,
    now + 30 * DAY,
    100,
  );
}

describe("HoodFlowDCA", function () {
  it("boots paused and only accepts critical configuration while paused", async function () {
    const { hoodFlow, owner, keeper } = await loadFixture(deployFixture);
    expect(await hoodFlow.paused()).to.equal(false);

    await expect(hoodFlow.setKeeper(keeper.address, false))
      .to.be.revertedWithCustomError(hoodFlow, "ExpectedPause");

    await hoodFlow.pauseEverything();
    await expect(hoodFlow.setKeeper(keeper.address, false))
      .to.emit(hoodFlow, "KeeperUpdated")
      .withArgs(keeper.address, false);

    await expect(hoodFlow.connect(keeper).unpauseEverything())
      .to.be.revertedWithCustomError(hoodFlow, "OwnableUnauthorizedAccount")
      .withArgs(keeper.address);
    await hoodFlow.setKeeper(keeper.address, true);
    await hoodFlow.connect(owner).unpauseEverything();
  });

  it("creates a bounded non-custodial strategy", async function () {
    const fixture = await loadFixture(deployFixture);
    const { hoodFlow, user } = fixture;
    await expect(createDefaultStrategy(fixture)).to.emit(
      hoodFlow,
      "StrategyCreated",
    );

    const strategy = await hoodFlow.strategies(1);
    expect(strategy.owner).to.equal(user.address);
    expect(strategy.amountPerExecution).to.equal(ethers.parseUnits("100", 6));
    expect(strategy.remainingBudget).to.equal(ethers.parseUnits("300", 6));
    expect(strategy.status).to.equal(0);
    expect(await fixture.usdc.balanceOf(await hoodFlow.getAddress())).to.equal(0);
  });

  it("rejects invalid budgets, intervals, slippage and token pairs", async function () {
    const { hoodFlow, user, usdc, weth } = await loadFixture(deployFixture);
    const now = await time.latest();
    const base = [
      await usdc.getAddress(),
      await weth.getAddress(),
      ethers.parseUnits("100", 6),
      ethers.parseUnits("300", 6),
      DAY,
      0,
      now + 30 * DAY,
      100,
    ] as const;

    await expect(
      hoodFlow
        .connect(user)
        .createStrategy(...base.slice(0, 3), ethers.parseUnits("250", 6), ...base.slice(4)),
    ).to.be.revertedWithCustomError(hoodFlow, "InvalidConfiguration");

    await expect(
      hoodFlow.connect(user).createStrategy(
        base[0],
        base[1],
        base[2],
        base[3],
        30 * 60,
        base[5],
        base[6],
        base[7],
      ),
    ).to.be.revertedWithCustomError(hoodFlow, "InvalidConfiguration");

    await expect(
      hoodFlow.connect(user).createStrategy(
        base[0],
        base[1],
        base[2],
        base[3],
        base[4],
        base[5],
        base[6],
        501,
      ),
    ).to.be.revertedWithCustomError(hoodFlow, "InvalidConfiguration");

    await expect(
      hoodFlow.connect(user).createStrategy(
        base[0],
        base[0],
        base[2],
        base[3],
        base[4],
        base[5],
        base[6],
        base[7],
      ),
    ).to.be.revertedWithCustomError(hoodFlow, "InvalidConfiguration");
  });

  it("quotes output using token and feed decimals", async function () {
    const { hoodFlow, usdc, weth } = await loadFixture(deployFixture);
    const minOut = await hoodFlow.quoteMinOut(
      await usdc.getAddress(),
      await weth.getAddress(),
      ethers.parseUnits("100", 6),
      100,
    );
    expect(minOut).to.equal(ethers.parseEther("0.0495"));
  });

  it("executes one exact tranche, charges the capped fee, and advances schedule", async function () {
    const fixture = await loadFixture(deployFixture);
    const { hoodFlow, keeper, user, feeRecipient, usdc, weth } = fixture;
    await createDefaultStrategy(fixture);

    const userUsdcBefore = await usdc.balanceOf(user.address);
    await expect(hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE))
      .to.emit(hoodFlow, "StrategyExecuted");

    const strategy = await hoodFlow.strategies(1);
    expect(userUsdcBefore - (await usdc.balanceOf(user.address))).to.equal(
      ethers.parseUnits("100", 6),
    );
    expect(await usdc.balanceOf(feeRecipient.address)).to.equal(
      ethers.parseUnits("0.5", 6),
    );
    expect(await weth.balanceOf(user.address)).to.equal(ethers.parseEther("0.04975"));
    expect(strategy.remainingBudget).to.equal(ethers.parseUnits("200", 6));
    expect(strategy.status).to.equal(0);
    expect(await usdc.balanceOf(await hoodFlow.getAddress())).to.equal(0);
    expect(await usdc.allowance(await hoodFlow.getAddress(), await fixture.adapter.getAddress())).to.equal(0);
  });

  it("prevents catch-up bursts and completes at the total spending cap", async function () {
    const fixture = await loadFixture(deployFixture);
    const { hoodFlow, keeper, usdcFeed, wethFeed } = fixture;
    await createDefaultStrategy(fixture);

    await hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE);
    await expect(hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE))
      .to.be.revertedWithCustomError(hoodFlow, "StrategyNotExecutable")
      .withArgs(1);

    await time.increase(DAY);
    let now = await time.latest();
    await usdcFeed.setAnswer(100_000_000n, now);
    await wethFeed.setAnswer(200_000_000_000n, now);
    await hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE);
    await time.increase(DAY);
    now = await time.latest();
    await usdcFeed.setAnswer(100_000_000n, now);
    await wethFeed.setAnswer(200_000_000_000n, now);
    await hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE);

    const strategy = await hoodFlow.strategies(1);
    expect(strategy.remainingBudget).to.equal(0);
    expect(strategy.status).to.equal(3);
    await time.increase(DAY);
    await expect(hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE))
      .to.be.revertedWithCustomError(hoodFlow, "StrategyNotExecutable");
  });

  it("allows only an approved keeper to execute", async function () {
    const fixture = await loadFixture(deployFixture);
    const { hoodFlow, outsider } = fixture;
    await createDefaultStrategy(fixture);

    await expect(hoodFlow.connect(outsider).executeDCA(1, EMPTY_ROUTE))
      .to.be.revertedWithCustomError(hoodFlow, "KeeperNotAuthorized")
      .withArgs(outsider.address);
  });

  it("rejects stale and incomplete oracle rounds without spending user funds", async function () {
    const fixture = await loadFixture(deployFixture);
    const { hoodFlow, keeper, user, usdc, usdcFeed } = fixture;
    await createDefaultStrategy(fixture);
    const balanceBefore = await usdc.balanceOf(user.address);

    await time.increase(HOUR + 1);
    await expect(hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE))
      .to.be.revertedWithCustomError(hoodFlow, "OracleStale");
    expect(await usdc.balanceOf(user.address)).to.equal(balanceBefore);

    const now = await time.latest();
    await usdcFeed.setIncompleteRound(100_000_000n, now);
    await expect(hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE))
      .to.be.revertedWithCustomError(hoodFlow, "OracleInvalid");
    expect(await usdc.balanceOf(user.address)).to.equal(balanceBefore);
  });

  it("reverts the whole execution when the adapter under-delivers", async function () {
    const fixture = await loadFixture(deployFixture);
    const { hoodFlow, keeper, user, usdc, weth, adapter } = fixture;
    await createDefaultStrategy(fixture);
    await adapter.setUnderDeliver(true);
    const inputBefore = await usdc.balanceOf(user.address);

    await expect(hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE))
      .to.be.revertedWithCustomError(hoodFlow, "SlippageExceeded");
    expect(await usdc.balanceOf(user.address)).to.equal(inputBefore);
    expect(await weth.balanceOf(user.address)).to.equal(0);
    expect((await hoodFlow.strategies(1)).remainingBudget).to.equal(
      ethers.parseUnits("300", 6),
    );
  });

  it("lets the strategy owner pause, resume, and permanently cancel", async function () {
    const fixture = await loadFixture(deployFixture);
    const { hoodFlow, user, keeper, outsider } = fixture;
    await createDefaultStrategy(fixture);

    await expect(hoodFlow.connect(outsider).pauseStrategy(1))
      .to.be.revertedWithCustomError(hoodFlow, "NotStrategyOwner");
    await hoodFlow.connect(user).pauseStrategy(1);
    expect((await hoodFlow.strategies(1)).status).to.equal(1);
    await expect(hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE))
      .to.be.revertedWithCustomError(hoodFlow, "StrategyNotExecutable");

    await time.increase(DAY);
    await hoodFlow.connect(user).resumeStrategy(1);
    expect((await hoodFlow.strategies(1)).status).to.equal(0);
    await hoodFlow.connect(user).cancelStrategy(1);
    expect((await hoodFlow.strategies(1)).status).to.equal(2);
    await expect(hoodFlow.connect(user).resumeStrategy(1))
      .to.be.revertedWithCustomError(hoodFlow, "StrategyNotExecutable");
  });

  it("gives the guardian an emergency brake but not restart authority", async function () {
    const fixture = await loadFixture(deployFixture);
    const { hoodFlow, guardian, owner, keeper } = fixture;
    await createDefaultStrategy(fixture);

    await expect(hoodFlow.connect(guardian).pauseEverything())
      .to.emit(hoodFlow, "Paused");
    expect(await hoodFlow.isStrategyReady(1)).to.equal(false);
    await expect(hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE))
      .to.be.revertedWithCustomError(hoodFlow, "EnforcedPause");
    await expect(hoodFlow.connect(guardian).unpauseEverything())
      .to.be.revertedWithCustomError(hoodFlow, "OwnableUnauthorizedAccount");
    await hoodFlow.connect(owner).unpauseEverything();
    expect(await hoodFlow.isStrategyReady(1)).to.equal(true);
  });

  it("refuses execution after strategy expiry", async function () {
    const fixture = await loadFixture(deployFixture);
    const { hoodFlow, user, keeper, usdc, weth } = fixture;
    const now = await time.latest();
    await hoodFlow.connect(user).createStrategy(
      await usdc.getAddress(),
      await weth.getAddress(),
      ethers.parseUnits("100", 6),
      ethers.parseUnits("100", 6),
      HOUR,
      0,
      now + HOUR,
      100,
    );
    await time.increase(HOUR + 1);

    await expect(hoodFlow.connect(keeper).executeDCA(1, EMPTY_ROUTE))
      .to.be.revertedWithCustomError(hoodFlow, "StrategyNotExecutable");
  });
});
