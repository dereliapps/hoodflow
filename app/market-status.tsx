"use client";

import { useEffect, useMemo, useState } from "react";

function zonedParts(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { weekday: value.weekday, minutes: Number(value.hour) * 60 + Number(value.minute) };
}

function readMarketState(now: Date) {
  const europe = zonedParts("Europe/Berlin", now);
  const newYork = zonedParts("America/New_York", now);
  const day = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 } as const;
  const euDay = day[europe.weekday as keyof typeof day] ?? 0;
  const nyDay = day[newYork.weekday as keyof typeof day] ?? 0;
  const issuerWindow = (euDay === 1 && europe.minutes >= 120) || (euDay >= 2 && euDay <= 5) || (euDay === 6 && europe.minutes < 120);
  const coreSession = nyDay >= 1 && nyDay <= 5 && newYork.minutes >= 570 && newYork.minutes < 960;
  return { issuerWindow, coreSession };
}

export default function MarketStatus({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const status = useMemo(() => readMarketState(now), [now]);
  const risk = !status.issuerWindow ? "weekend" : !status.coreSession ? "extended" : "core";

  return <section className={`market-hours ${compact ? "compact" : ""} ${risk}`} aria-label="Stock Token market status">
    <div className="market-hours-badges">
      <span className={status.issuerWindow ? "open" : "closed"}><i /> Issuer window {status.issuerWindow ? "open" : "closed"}</span>
      <span className={status.coreSession ? "open" : "closed"}><i /> US core session {status.coreSession ? "open" : "closed"}</span>
    </div>
    {!compact && <div><strong>{risk === "weekend" ? "Weekend gap risk is elevated." : risk === "extended" ? "Underlying US markets are outside core hours." : "US core trading is active."}</strong><p>{risk === "core" ? "Oracle context is active, but the DEX quote still determines your execution." : "Oracle rounds may remain unchanged and liquidity can thin. HoodFlow blocks stale references and still requires a fresh executable quote."}</p><a href="https://robinhood.com/eu/en/support/articles/about-stock-tokens/" target="_blank" rel="noreferrer">Review official Stock Token hours ↗</a></div>}
  </section>;
}
