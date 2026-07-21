import vinext from "vinext";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import { fileURLToPath } from "node:url";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

const usePolling = process.env.VITE_USE_POLLING === "true";
const privyServerStub = fileURLToPath(new URL("./app/privy-server-stub.tsx", import.meta.url));
const privyServerAlias = {
  name: "hoodflow:privy-server-stub",
  enforce: "pre",
  applyToEnvironment(environment) {
    return environment.name === "rsc" || environment.name === "ssr";
  },
  resolveId(source) {
    return source === "@privy-io/react-auth" ? privyServerStub : null;
  },
} satisfies Plugin;

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async (): Promise<UserConfig> => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: usePolling
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      privyServerAlias,
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
