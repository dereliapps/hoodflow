"use client";

import { PrivyProvider } from "@privy-io/react-auth";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim();

export const PRIVY_CONFIGURED = Boolean(privyAppId);

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

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!privyAppId) return children;

  return (
    <PrivyProvider
      appId={privyAppId}
      clientId={privyClientId || undefined}
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
