import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/skillbox/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/skillbox/index.html", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.jsx", import.meta.url), "utf8");

test("standalone designer preview never waits for the Anna OS SDK", () => {
  assert.doesNotMatch(app, /import\(["']\/static\/anna-apps\/_sdk\/latest\/index\.js["']\)/);
  assert.match(app, /standalone = true;\s+anna = null;\s+applyStandaloneBranding\(\);/);
  assert.match(app, /fetch\(["']\/api\/skillbox["']/);
  assert.match(app, /fetch\(["']\/api\/nvidia\/chat["']/);
});

test("all workspace tabs, theme control, and first-visit channel setup remain in the Preview", () => {
  for (const id of ["tab-button-chat", "tab-button-audit", "tab-button-studio", "tab-button-retention", "theme-toggle", "onboarding-modal"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} should exist in the full app shell`);
  }
  assert.match(app, /byId\(["']theme-toggle["']\)\?\.addEventListener\(["']click["'], cycleTheme\)/);
  assert.match(page, /localStorage\.setItem\(["']youtube-skillbox:guest["'], ["']\[false\]["']\)/);
  assert.match(page, /youtube-skillbox:preview-version/);
});


test("static preview shell is standalone before JavaScript starts and cache-busts the app module", () => {
  assert.match(html, /id=["']runtime-pill["']>SKILLBOX PREVIEW</);
  assert.match(html, /id=["']runtime-caption["']>STANDALONE · NO ANNA LOGIN</);
  assert.match(html, /id=["']status-text["']>Standalone preview/);
  assert.match(html, /app\.js\?v=designer-preview-standalone-[^"']+/);
  assert.doesNotMatch(html, /ANNA APP|ANNA GUIDE|HOST LLM|Connecting to Anna host/);
  assert.match(html, /Keep the review shell navigable even if the feature module fails to load/);
  assert.match(html, /buttons\.forEach\(\(button\) => button\.addEventListener\("click"/);
  assert.match(html, /Skillbox feature module failed to load/);
});

test("workspace navigation is wired before any backend initialization", () => {
  const mainStart = app.indexOf("async function main()");
  const navigation = app.indexOf("wireTabs();", mainStart);
  const backend = app.indexOf("await connect();", mainStart);
  assert.ok(mainStart >= 0 && navigation > mainStart && backend > navigation);
});
