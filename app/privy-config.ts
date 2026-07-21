// Privy app IDs are public client identifiers. The production fallback keeps
// static builds functional when hosting injects environment variables after
// the client bundle has already been compiled.
const PRODUCTION_PRIVY_APP_ID = "cmrtj0bum003d0clco8cggaht";

export const PRIVY_APP_ID =
  process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || PRODUCTION_PRIVY_APP_ID;

export const PRIVY_CLIENT_ID =
  process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || undefined;

export const PRIVY_CONFIGURED = Boolean(PRIVY_APP_ID);
