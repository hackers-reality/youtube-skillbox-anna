import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../../executas/youtube-skillbox/youtube_skillbox_plugin.py");
const targetDir = path.resolve(here, "../api");
await mkdir(targetDir, { recursive: true });
await copyFile(source, path.join(targetDir, "_skillbox_engine.py"));
console.log("Synced the shared Skillbox engine adapter for the standalone API.");
