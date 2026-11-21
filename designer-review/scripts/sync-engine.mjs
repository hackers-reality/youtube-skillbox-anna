import { copyFile, mkdir, access, constants } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../../executas/youtube-skillbox/youtube_skillbox_plugin.py");
const targetDir = path.resolve(here, "../api");
const target = path.join(targetDir, "_skillbox_engine.py");

try {
  await access(source, constants.R_OK);
} catch {
  console.error(`[sync-engine] ERROR: Source engine not found at ${source}`);
  console.error(`[sync-engine] Expected path: executas/youtube-skillbox/youtube_skillbox_plugin.py relative to repo root`);
  console.error(`[sync-engine] Run this script from the repository root after a full clone.`);
  process.exit(1);
}

await mkdir(targetDir, { recursive: true });
await copyFile(source, target);
console.log("Synced the shared Skillbox engine adapter for the standalone API.");