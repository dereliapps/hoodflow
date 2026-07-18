export type HoodFlowEvent =
  | "page_view"
  | "asset_opened"
  | "wallet_connect_started"
  | "wallet_connected"
  | "quote_requested"
  | "quote_received"
  | "transaction_started"
  | "transaction_confirmed"
  | "transaction_failed"
  | "community_token_imported"
  | "referral_registered"
  | "referral_shared"
  | "referral_qualified";

const SESSION_KEY = "hoodflow_session_v1";

function sessionId() {
  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(SESSION_KEY, created);
  return created;
}

export function track(event: HoodFlowEvent, properties: Record<string, string | number | boolean | null> = {}) {
  if (typeof window === "undefined" || navigator.doNotTrack === "1") return;
  const body = JSON.stringify({
    event,
    path: `${window.location.pathname}${window.location.search}`,
    sessionId: sessionId(),
    referrer: document.referrer ? new URL(document.referrer).hostname : "direct",
    properties,
  });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/analytics", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
}
