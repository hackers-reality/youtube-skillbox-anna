import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/skillbox/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/skillbox/index.html", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.jsx", import.meta.url), "utf8");

test("standalone app can boot without Anna OS SDK and fall back to NVIDIA/Skillbox", () => {
  assert.doesNotMatch(app, /^\s*import\s+\{\s*AnnaAppRuntime\s*\}\s+from\s+["']\/static\/anna-apps/m);
  assert.match(app, /await import\(["']\/static\/anna-apps\/_sdk\/latest\/index\.js["']\)/);
  assert.match(app, /fetch\("\/api\/skillbox"/);
  assert.match(app, /fetch\("\/api\/nvidia\/chat"/);
});

test("all workspace tabs, theme control, and first-visit channel setup remain in the Preview", () => {
  for (const id of ["tab-button-chat", "tab-button-audit", "tab-button-studio", "tab-button-retention", "theme-toggle", "onboarding-modal"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} should exist in the full app shell`);
  }
  assert.match(app, /byId\("theme-toggle"\)\?\.addEventListener\("click", cycleTheme\)/);
  assert.match(page, /localStorage\.setItem\("youtube-skillbox:guest", "\[false\]"\)/);
  assert.match(page, /youtube-skillbox:preview-version/);
});
