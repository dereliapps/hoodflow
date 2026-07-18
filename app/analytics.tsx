"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics-client";

export function Analytics() {
  useEffect(() => {
    track("page_view", {
      campaign: new URLSearchParams(window.location.search).get("utm_campaign"),
      source: new URLSearchParams(window.location.search).get("utm_source"),
    });
  }, []);
  return null;
}
