/* eslint-disable @typescript-eslint/no-explicit-any -- Hardhat runtime ABI contracts are intentionally dynamic in tests. */
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

async function deployAdapterFixture() {
  const [owner, guardian, keeper, user, feeRecipient, outsider] =
    await ethers.getSigners();

  const usdc: any = await ethers.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
  const weth: any = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);
  const usdcFeed: any = await ethers.deployContract("MockPriceFeed", [8, 100_000_000n]);
  const wethFeed: any = await ethers.deployContract("MockPriceFeed", [8, 200_000_000_000n]);
  const permit2: any = await ethers.deployContract("MockPermit2");
  const router: any = await ethers.deployContract("MockUniversalRouter", [
    await permit2.getAddress(),
    500_000_000n,
    1n,
  ]);

  const hoodFlow: any = await ethers.deployContract("HoodFlowDCA", [
    owner.address,
    guardian.address,
    ethers.ZeroAddress,
    feeRecipient.address,
    0,
  ]);
  const adapter: any = await ethers.deployContract("UniswapV3DirectAdapter", [
    await hoodFlow.getAddress(),
    await router.getAddress(),
    await permit2.getAddress(),
  ]);

  await hoodFlow.setSwapAdapter(await adapter.getAddress());
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

  await usdc.mint(user.address, ethers.parseUnits("1000", 6));
  await weth.mint(await router.getAddress(), ethers.parseEther("100"));
  await usdc.connect(user).approve(await hoodFlow.getAddress(), ethers.MaxUint256);

  const route = ethers.solidityPacked(
    ["address", "uint24", "address"],
    [await usdc.getAddress(), 500, await weth.getAddress()],
  );

  const now = await time.latest();
  await hoodFlow.connect(user).createStrategy(
    await usdc.getAddress(),
    await weth.getAddress(),
    ethers.parseUnits("100", 6),
    ethers.parseUnits("200", 6),
    DAY,
    0,
    now + 30 * DAY,
    100,
  );

  return {
    owner,
    guardian,
    keeper,
    user,
    feeRecipient,
    outsider,
    usdc,
    weth,
    permit2,
    router,
    hoodFlow,
    adapter,
    route,
  };
}

async function deployBoundaryFixture() {
  const [, , , recipient, , outsider] = await ethers.getSigners();
  const usdc: any = await ethers.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
  const weth: any = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);
  const permit2: any = await ethers.deployContract("MockPermit2");
  const router: any = await ethers.deployContract("MockUniversalRouter", [
    await permit2.getAddress(),
    500_000_000n,
    1n,
  ]);
  const engine: any = await ethers.deployContract("MockAdapterEngine");
  const adapter: any = await ethers.deployContract("UniswapV3DirectAdapter", [
    await engine.getAddress(),
    await router.getAddress(),
    await permit2.getAddress(),
  ]);

  await usdc.mint(await engine.getAddress(), ethers.parseUnits("1000", 6));
  await weth.mint(await router.getAddress(), ethers.parseEther("100"));
  await engine.approveToken(await usdc.getAddress(), await adapter.getAddress(), ethers.MaxUint256);

  const route = ethers.solidityPacked(
    ["address", "uint24", "address"],
    [await usdc.getAddress(), 500, await weth.getAddress()],
  );

  return { recipient, outsider, usdc, weth, permit2, router, engine, adapter, route };
}

describe("UniswapV3DirectAdapter", function () {
  it("wires an immutable adapter after engine deployment and unlocks only when ready", async function () {
    const { hoodFlow, adapter, keeper } = await loadFixture(deployAdapterFixture);
    expect(await hoodFlow.paused()).to.equal(false);
    expect(await hoodFlow.keeperCount()).to.equal(1);
    expect(await hoodFlow.allowedTokenCount()).to.equal(2);
    expect(await hoodFlow.swapAdapter()).to.equal(await adapter.getAddress());
    expect(await hoodFlow.keepers(keeper.address)).to.equal(true);
  });

  it("executes a direct pool route end-to-end and clears every temporary allowance", async function () {
    const fixture = await loadFixture(deployAdapterFixture);
    const { hoodFlow, keeper, user, usdc, weth, permit2, router, adapter, route } = fixture;

    await expect(hoodFlow.connect(keeper).executeDCA(1, route))
      .to.emit(adapter, "DirectSwapExecuted")
      .withArgs(
        await usdc.getAddress(),
        await weth.getAddress(),
        user.address,
        500,
        ethers.parseUnits("100", 6),
        ethers.parseEther("0.05"),
      );

    expect(await weth.balanceOf(user.address)).to.equal(ethers.parseEther("0.05"));
    expect(await usdc.balanceOf(await adapter.getAddress())).to.equal(0);
    expect(await usdc.allowance(await adapter.getAddress(), await permit2.getAddress())).to.equal(0);
    const permitAllowance = await permit2.allowances(
      await adapter.getAddress(),
      await usdc.getAddress(),
      await router.getAddress(),
    );
    expect(permitAllowance.amount).to.equal(0);
  });

  it("rejects routes whose endpoints differ from the strategy assets", async function () {
    const fixture = await loadFixture(deployAdapterFixture);
    const { hoodFlow, keeper, usdc, route, adapter } = fixture;
    const wrongRoute = ethers.solidityPacked(
      ["address", "uint24", "address"],
      [await usdc.getAddress(), 500, await usdc.getAddress()],
    );

    await expect(hoodFlow.connect(keeper).executeDCA(1, wrongRoute))
      .to.be.revertedWithCustomError(adapter, "InvalidRoute");
    expect((await hoodFlow.strategies(1)).remainingBudget).to.equal(
      ethers.parseUnits("200", 6),
    );
    expect(route.length).to.equal(88);
  });

  it("accepts only canonical V3 fee tiers", async function () {
    const fixture = await loadFixture(deployAdapterFixture);
    const { hoodFlow, keeper, usdc, weth, adapter } = fixture;
    const unsupportedRoute = ethers.solidityPacked(
      ["address", "uint24", "address"],
      [await usdc.getAddress(), 250, await weth.getAddress()],
    );

    await expect(hoodFlow.connect(keeper).executeDCA(1, unsupportedRoute))
      .to.be.revertedWithCustomError(adapter, "UnsupportedFee")
      .withArgs(250);
  });

  it("rolls back engine state and user balances when the router under-delivers", async function () {
    const fixture = await loadFixture(deployAdapterFixture);
    const { hoodFlow, keeper, user, usdc, weth, router, adapter, route } = fixture;
    const inputBefore = await usdc.balanceOf(user.address);
    await router.setUnderDeliver(true);

    await expect(hoodFlow.connect(keeper).executeDCA(1, route))
      .to.be.revertedWithCustomError(adapter, "SlippageExceeded");
    expect(await usdc.balanceOf(user.address)).to.equal(inputBefore);
    expect(await weth.balanceOf(user.address)).to.equal(0);
    expect((await hoodFlow.strategies(1)).remainingBudget).to.equal(
      ethers.parseUnits("200", 6),
    );
  });

  it("rejects direct callers and deadlines outside the five-minute execution window", async function () {
    const fixture = await loadFixture(deployBoundaryFixture);
    const { recipient, outsider, usdc, weth, engine, adapter, route } = fixture;
    const now = await time.latest();

    await expect(
      adapter.connect(outsider).swapExactInput(
        await usdc.getAddress(),
        await weth.getAddress(),
        ethers.parseUnits("100", 6),
        ethers.parseEther("0.049"),
        recipient.address,
        now + 60,
        route,
      ),
    ).to.be.revertedWithCustomError(adapter, "UnauthorizedCaller");

    await expect(
      engine.executeSwap(
        await adapter.getAddress(),
        await usdc.getAddress(),
        await weth.getAddress(),
        ethers.parseUnits("100", 6),
        ethers.parseEther("0.049"),
        recipient.address,
        now + 600,
        route,
      ),
    ).to.be.revertedWithCustomError(adapter, "InvalidDeadline");
  });
});
