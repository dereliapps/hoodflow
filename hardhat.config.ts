import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import { configVariable, defineConfig } from "hardhat/config";

const robinhoodMainnetRpcUrl =
  process.env.ROBINHOOD_MAINNET_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const robinhoodForkBlockNumber = Number(
  process.env.ROBINHOOD_FORK_BLOCK_NUMBER ?? "10453077",
);
if (!Number.isSafeInteger(robinhoodForkBlockNumber) || robinhoodForkBlockNumber <= 0) {
  throw new Error("ROBINHOOD_FORK_BLOCK_NUMBER must be a positive integer");
}

export default defineConfig({
  chainDescriptors: {
    4663: {
      name: "Robinhood Chain",
      chainType: "l1",
      hardforkHistory: {
        shanghai: { blockNumber: 0 },
      },
    },
  },
  plugins: [
    hardhatEthers,
    hardhatEthersChaiMatchers,
    hardhatMocha,
    hardhatNetworkHelpers,
  ],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 500,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
    },
    robinhoodMainnetFork: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      forking: {
        url: robinhoodMainnetRpcUrl,
        blockNumber: robinhoodForkBlockNumber,
      },
    },
    robinhoodTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 46630,
      url: configVariable("ROBINHOOD_TESTNET_RPC_URL"),
      accounts: [configVariable("ROBINHOOD_TESTNET_PRIVATE_KEY")],
    },
    robinhoodMainnet: {
      type: "http",
      chainType: "l1",
      chainId: 4663,
      url: configVariable("ROBINHOOD_MAINNET_RPC_URL"),
      accounts: [configVariable("HOODFLOW_DEPLOYER_PRIVATE_KEY")],
    },
  },
  test: {
    mocha: {
      timeout: 40_000,
    },
  },
});
