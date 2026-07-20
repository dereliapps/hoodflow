import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const workspace = resolve(process.cwd());
const target = resolve(workspace, "dist");

if (dirname(target) !== workspace) {
  throw new Error(`Refusing to clean build output outside the workspace: ${target}`);
}

await rm(target, { recursive: true, force: true });
