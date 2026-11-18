import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const destination = path.join(root, "designer-review/public/skillbox");
await mkdir(path.join(destination, "assets"), { recursive: true });
for (const file of ["index.html", "style.css", "app.js", "anna-tool-ids.js", "anna-tool-runtime.mjs", "chat-routing.mjs"]) {
  await cp(path.join(root, "bundle", file), path.join(destination, file));
}
await cp(path.join(root, "bundle/assets"), path.join(destination, "assets"), { recursive: true, force: true });
console.log("Synced the current Skillbox UI into the standalone review site.");
