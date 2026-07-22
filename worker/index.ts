/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = Array.from(new Set([
        ...DEFAULT_DEVICE_SIZES,
        ...DEFAULT_IMAGE_SIZES,
        40,
        50,
        84,
      ]));
      response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    } else {
      response = await handler.fetch(request, env, ctx);
    }

    const headers = new Headers(response.headers);
    headers.set("content-security-policy", "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
    headers.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
    headers.set("strict-transport-security", "max-age=31536000");
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-frame-options", "DENY");

    const immutableAsset = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:css|js|woff2?)$/i.test(url.pathname);
    if (immutableAsset) {
      headers.set("cache-control", "public, max-age=31536000, immutable");
    } else if (/^\/assets\/.*\.webp$/i.test(url.pathname)) {
      headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
      headers.set("content-type", "image/webp");
    } else if (/^\/logos\/.*\.png$/i.test(url.pathname)) {
      headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export default worker;
