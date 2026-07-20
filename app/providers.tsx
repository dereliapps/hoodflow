"use client";

import { PrivyEnabledProvider } from "./privy-provider";

// Privy app IDs are public client identifiers. Keeping the production ID as a
// fallback makes static client builds work even when hosting injects env vars
// after the JavaScript bundle has already been compiled.
const PRODUCTION_PRIVY_APP_ID = "cmrtj0bum003d0clco8cggaht";
const privyAppId =
  process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || PRODUCTION_PRIVY_APP_ID;
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
