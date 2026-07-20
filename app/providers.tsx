"use client";

import { PrivyEnabledProvider } from "./privy-provider";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim();

export const PRIVY_CONFIGURED = Boolean(privyAppId);

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!privyAppId) return children;

  return (
    <PrivyEnabledProvider
      appId={privyAppId}
      clientId={privyClientId || undefined}
    >
      {children}
    </PrivyEnabledProvider>
  );
}
