import type { ReactNode } from "react";

// Vinext renders the Privy boundary only in the browser. This tiny server alias
// keeps Privy's wallet connector graph out of the Cloudflare Worker bundle.
export function PrivyProvider({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}

export function usePrivy() {
  return {
    ready: false,
    authenticated: false,
    login: () => undefined,
    connectWallet: () => undefined,
    logout: async () => undefined,
  };
}

export function useWallets() {
  return { ready: false, wallets: [] };
}
