"use client";

import { PrivyProvider } from "@privy-io/react-auth";

const robinhoodChain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Robinhood Explorer", url: "https://explorer.mainnet.chain.robinhood.com" },
  },
} as const;

type Props = Readonly<{
  appId: string;
  clientId?: string;
  children: React.ReactNode;
}>;

export function PrivyEnabledProvider({ appId, clientId, children }: Props) {
  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId}
      config={{
        loginMethods: ["email", "google", "twitter", "passkey", "wallet"],
        appearance: {
          theme: "#020b10",
          accentColor: "#36df86",
          logo: "/favicon.svg",
          landingHeader: "Log in or sign up",
          loginMessage: "Connect to HoodFlow and trade on Robinhood Chain.",
          showWalletLoginFirst: false,
          walletChainType: "ethereum-only",
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        supportedChains: [robinhoodChain],
        defaultChain: robinhoodChain,
      }}
    >
      {children}
    </PrivyProvider>
  );
}
