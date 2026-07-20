"use client";

import { useEffect, useRef } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";

export type PrivyWalletController = {
  open: () => void;
  logout: () => Promise<void>;
};

type Props = {
  onController: (controller: PrivyWalletController | null) => void;
  onWallet: (provider: unknown) => Promise<void>;
  onError: (message: string) => void;
};

function messageFrom(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Privy could not connect the selected wallet.";
}

export default function PrivyWalletBridge({ onController, onWallet, onError }: Props) {
  const { ready, authenticated, login, connectWallet, logout } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const activatedWallet = useRef("");

  useEffect(() => {
    onController({
      open: () => {
        if (!ready) {
          onError("Privy is still loading. Try again in a moment.");
          return;
        }
        if (authenticated) {
          connectWallet({ walletChainType: "ethereum-only" });
          return;
        }
        login({
          loginMethods: ["email", "google", "twitter", "passkey", "wallet"],
          walletChainType: "ethereum-only",
        });
      },
      logout,
    });
    return () => onController(null);
  }, [authenticated, connectWallet, login, logout, onController, onError, ready]);

  useEffect(() => {
    if (!authenticated) activatedWallet.current = "";
  }, [authenticated]);

  useEffect(() => {
    if (!ready || !authenticated || !walletsReady || wallets.length === 0) return;
    const wallet = wallets[0];
    const walletKey = wallet.address.toLowerCase();
    if (activatedWallet.current === walletKey) return;
    activatedWallet.current = walletKey;

    void (async () => {
      try {
        await wallet.switchChain(4663);
        const provider = await wallet.getEthereumProvider();
        await onWallet(provider);
      } catch (error) {
        activatedWallet.current = "";
        onError(messageFrom(error));
      }
    })();
  }, [authenticated, onError, onWallet, ready, wallets, walletsReady]);

  return null;
}
