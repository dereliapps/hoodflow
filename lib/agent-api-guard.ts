import { lt, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { agentQuoteRateLimits } from "@/db/schema";

export class AgentApiBodyTooLargeError extends Error {}
export class AgentApiBodyTimeoutError extends Error {}

const RATE_LIMIT_ROW_TTL_MS = 24 * 60 * 60 * 1_000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

let nextRateLimitCleanupAt = 0;

async function cancelReaderSafely(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // Cancellation is best-effort; preserve the original validation error.
  }
}

async function readBeforeDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new AgentApiBodyTimeoutError("Quote request body timed out.");

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new AgentApiBodyTimeoutError("Quote request body timed out.")),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function readCappedJson(request: Request, maxBytes = 4_096, timeoutMs = 3_000) {
  if (!request.body) throw new SyntaxError("A JSON request body is required.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + Math.max(1, timeoutMs);
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await readBeforeDeadline(reader, deadline);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await cancelReaderSafely(reader);
        throw new AgentApiBodyTooLargeError("Quote request is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    await cancelReaderSafely(reader);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!text.trim()) throw new SyntaxError("A JSON request body is required.");
  return JSON.parse(text) as unknown;
}

function clientIdentity(request: Request) {
  return (request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]
    || "anonymous").trim().slice(0, 96);
}

async function hashIdentity(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hoodflow-agent-quote:${value}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function cleanUpStaleRateLimitRows(
  db: Awaited<ReturnType<typeof getDb>>,
  now: number,
) {
  if (now < nextRateLimitCleanupAt) return;
  nextRateLimitCleanupAt = now + RATE_LIMIT_CLEANUP_INTERVAL_MS;
  try {
    await db.delete(agentQuoteRateLimits).where(
      lt(agentQuoteRateLimits.updatedAt, new Date(now - RATE_LIMIT_ROW_TTL_MS)),
    );
  } catch {
    // Cleanup must never turn an otherwise valid quote request into a failure.
  }
}

export async function takeDurableAgentQuoteLimit(request: Request, limit: number, windowMs: number) {
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1_000);
  const cutoffSeconds = Math.floor((now - windowMs) / 1_000);
  const key = await hashIdentity(clientIdentity(request));
  const db = await getDb();
  const [bucket] = await db.insert(agentQuoteRateLimits).values({
    key,
    windowStartedAt: new Date(now),
    count: 1,
    updatedAt: new Date(now),
  }).onConflictDoUpdate({
    target: agentQuoteRateLimits.key,
    set: {
      windowStartedAt: sql`CASE WHEN ${agentQuoteRateLimits.windowStartedAt} <= ${cutoffSeconds} THEN ${nowSeconds} ELSE ${agentQuoteRateLimits.windowStartedAt} END`,
      count: sql`CASE WHEN ${agentQuoteRateLimits.windowStartedAt} <= ${cutoffSeconds} THEN 1 ELSE ${agentQuoteRateLimits.count} + 1 END`,
      updatedAt: new Date(now),
    },
  }).returning({
    count: agentQuoteRateLimits.count,
    windowStartedAt: agentQuoteRateLimits.windowStartedAt,
  });
  if (!bucket) throw new Error("Rate limit state was not persisted.");
  await cleanUpStaleRateLimitRows(db, now);
  const elapsedMs = Math.max(0, now - bucket.windowStartedAt.getTime());
  return {
    allowed: bucket.count <= limit,
    count: bucket.count,
    retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsedMs) / 1_000)),
  };
}
