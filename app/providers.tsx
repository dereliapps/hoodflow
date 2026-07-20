"use client";

import dynamic from "next/dynamic";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim();

export const PRIVY_CONFIGURED = Boolean(privyAppId);

const PrivyEnabledProvider = dynamic(
  () => import("./privy-provider").then((module) => module.PrivyEnabledProvider),
  { ssr: false },
);

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
