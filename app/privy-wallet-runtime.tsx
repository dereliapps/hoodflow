"use client";

import { PRIVY_APP_ID, PRIVY_CLIENT_ID, PRIVY_CONFIGURED } from "./privy-config";
import { PrivyEnabledProvider } from "./privy-provider";
import PrivyWalletBridge, { type PrivyWalletController } from "./privy-wallet-bridge";

type Props = {
  onController: (controller: PrivyWalletController | null) => void;
  onWallet: (provider: unknown) => Promise<void>;
  onError: (message: string) => void;
};

export default function PrivyWalletRuntime({ onController, onWallet, onError }: Props) {
  if (!PRIVY_CONFIGURED) return null;

  return (
    <PrivyEnabledProvider appId={PRIVY_APP_ID} clientId={PRIVY_CLIENT_ID}>
      <PrivyWalletBridge
        onController={onController}
        onWallet={onWallet}
        onError={onError}
      />
    </PrivyEnabledProvider>
  );
}
