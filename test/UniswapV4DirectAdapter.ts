/* eslint-disable @typescript-eslint/no-explicit-any -- Hardhat runtime ABI contracts are intentionally dynamic in tests. */
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

function encodeRoute(fee = 500, tickSpacing = 10, hooks = ethers.ZeroAddress) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint24", "int24", "address"],
    [fee, tickSpacing, hooks],
  );
}

async function deployAdapterFixture() {
  const [owner, guardian, keeper, user, feeRecipient, outsider] =
    await ethers.getSigners();

  const usdc: any = await ethers.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
  const weth: any = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);
  const usdcFeed: any = await ethers.deployContract("MockPriceFeed", [8, 100_000_000n]);
  const wethFeed: any = await ethers.deployContract("MockPriceFeed", [8, 200_000_000_000n]);
  const sequencerFeed: any = await ethers.deployContract("MockPriceFeed", [0, 0]);
  const permit2: any = await ethers.deployContract("MockPermit2");
  const router: any = await ethers.deployContract("MockV4UniversalRouter", [
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
  const adapter: any = await ethers.deployContract("UniswapV4DirectAdapter", [
    await hoodFlow.getAddress(),
    await router.getAddress(),
    await permit2.getAddress(),
  ]);

  await hoodFlow.setSwapAdapter(await adapter.getAddress());
  await sequencerFeed.setAnswer(0, (await time.latest()) - 2 * HOUR);
  await hoodFlow.setSequencerConfig(await sequencerFeed.getAddress(), HOUR);
  await hoodFlow.setKeeper(keeper.address, true);
  await hoodFlow.setTokenConfig(
    await usdc.getAddress(),
    await usdcFeed.getAddress(),
    HOUR,
    true,
    false,
  );
  await hoodFlow.setTokenConfig(
    await weth.getAddress(),
    await wethFeed.getAddress(),
    HOUR,
    true,
    true,
  );
  await hoodFlow.unpauseEverything();

  await usdc.mint(user.address, ethers.parseUnits("1000", 6));
  await weth.mint(await router.getAddress(), ethers.parseEther("100"));
  await usdc.connect(user).approve(await hoodFlow.getAddress(), ethers.MaxUint256);

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
    route: encodeRoute(),
  };
}

async function deployBoundaryFixture() {
  const [, , , recipient, , outsider] = await ethers.getSigners();
  const usdc: any = await ethers.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
  const weth: any = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);
  const permit2: any = await ethers.deployContract("MockPermit2");
  const router: any = await ethers.deployContract("MockV4UniversalRouter", [
    await permit2.getAddress(),
    500_000_000n,
    1n,
  ]);
  const engine: any = await ethers.deployContract("MockAdapterEngine");
  const adapter: any = await ethers.deployContract("UniswapV4DirectAdapter", [
    await engine.getAddress(),
    await router.getAddress(),
    await permit2.getAddress(),
  ]);

  await usdc.mint(await engine.getAddress(), ethers.parseUnits("1000", 6));
  await weth.mint(await router.getAddress(), ethers.parseEther("100"));
  await engine.approveToken(await usdc.getAddress(), await adapter.getAddress(), ethers.MaxUint256);

  return { recipient, outsider, usdc, weth, permit2, router, engine, adapter };
}

describe("UniswapV4DirectAdapter", function () {
  it("executes the bounded V4 action plan and clears every temporary allowance", async function () {
    const fixture = await loadFixture(deployAdapterFixture);
    const { hoodFlow, keeper, user, usdc, weth, permit2, router, adapter, route } = fixture;

    await expect(hoodFlow.connect(keeper).executeDCA(1, route))
      .to.emit(adapter, "DirectV4SwapExecuted")
      .withArgs(
        await usdc.getAddress(),
        await weth.getAddress(),
        user.address,
        500,
        10,
        ethers.parseUnits("100", 6),
        ethers.parseEther("0.05"),
      );

    expect(await weth.balanceOf(user.address)).to.equal(ethers.parseEther("0.05"));
    expect(await usdc.balanceOf(await adapter.getAddress())).to.equal(0);
    expect(await weth.balanceOf(await adapter.getAddress())).to.equal(0);
    expect(await usdc.allowance(await adapter.getAddress(), await permit2.getAddress())).to.equal(0);
    const permitAllowance = await permit2.allowances(
      await adapter.getAddress(),
      await usdc.getAddress(),
      await router.getAddress(),
    );
    expect(permitAllowance.amount).to.equal(0);
  });

  it("accepts only the three reviewed hookless fee and tick-spacing combinations", async function () {
    const fixture = await loadFixture(deployAdapterFixture);
    const { hoodFlow, keeper, adapter } = fixture;

    await expect(hoodFlow.connect(keeper).executeDCA(1, encodeRoute(500, 60)))
      .to.be.revertedWithCustomError(adapter, "UnsupportedPool")
      .withArgs(500, 60, ethers.ZeroAddress);
    await expect(hoodFlow.connect(keeper).executeDCA(1, encodeRoute(3_000, 60, adapter.target)))
      .to.be.revertedWithCustomError(adapter, "UnsupportedPool");
  });

  it("rejects malformed route data before any token movement", async function () {
    const fixture = await loadFixture(deployAdapterFixture);
    const { hoodFlow, keeper, user, usdc, adapter } = fixture;
    const before = await usdc.balanceOf(user.address);

    await expect(hoodFlow.connect(keeper).executeDCA(1, "0x1234"))
      .to.be.revertedWithCustomError(adapter, "InvalidRoute");
    expect(await usdc.balanceOf(user.address)).to.equal(before);
  });

  it("rolls back engine state and balances when the router under-delivers", async function () {
    const fixture = await loadFixture(deployAdapterFixture);
    const { hoodFlow, keeper, user, usdc, weth, router, adapter, route } = fixture;
    const before = await usdc.balanceOf(user.address);
    await router.setUnderDeliver(true);

    await expect(hoodFlow.connect(keeper).executeDCA(1, route))
      .to.be.revertedWithCustomError(adapter, "SlippageExceeded");
    expect(await usdc.balanceOf(user.address)).to.equal(before);
    expect(await weth.balanceOf(user.address)).to.equal(0);
    expect((await hoodFlow.strategies(1)).remainingBudget).to.equal(
      ethers.parseUnits("200", 6),
    );
  });

  it("rejects direct callers and deadlines outside the five-minute window", async function () {
    const fixture = await loadFixture(deployBoundaryFixture);
    const { recipient, outsider, usdc, weth, engine, adapter } = fixture;
    const now = await time.latest();

    await expect(
      adapter.connect(outsider).swapExactInput(
        await usdc.getAddress(),
        await weth.getAddress(),
        ethers.parseUnits("100", 6),
        ethers.parseEther("0.049"),
        recipient.address,
        now + 60,
        encodeRoute(),
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
        encodeRoute(),
      ),
    ).to.be.revertedWithCustomError(adapter, "InvalidDeadline");
  });
});
