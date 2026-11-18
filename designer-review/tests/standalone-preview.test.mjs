import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/skillbox/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/skillbox/index.html", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.jsx", import.meta.url), "utf8");
const originalApp = await readFile(new URL("../../bundle/app.js", import.meta.url), "utf8");
const skillboxApi = await readFile(new URL("../api/skillbox.py", import.meta.url), "utf8");

const functionNames = (source) => [...source.matchAll(/^(?:async\\s+)?function\\s+([\\w$]+)\\s*\\(/gm)].map((match) => match[1]);

test("designer preview preserves every original Anna Skillbox application function", () => {
  const original = functionNames(originalApp);
  const preview = new Set(functionNames(app));
  const missing = original.filter((name) => !preview.has(name));
  assert.deepEqual(missing, [], `Preview is missing original Skillbox functions: ${missing.join(", ")}`);
});

test("standalone preview replaces only the host boundary with NVIDIA and the same Skillbox tools", () => {
  assert.doesNotMatch(app, /AnnaAppRuntime|anna\\.llm\\.complete|anna\\.tools\\.invoke/);
  assert.match(app, /standalone = true;\\s+anna = null;/);
  assert.match(app, /fetch\\(["']\\/api\\/skillbox["']/);
  assert.match(app, /fetch\\(["']\\/api\\/nvidia\\/chat["']/);
  assert.match(skillboxApi, /ALLOWED_TOOLS/);
  assert.match(skillboxApi, /invoke\\(method, args\\)/);
});

test("full original workspace UI and guest onboarding remain present", () => {
  for (const id of ["tab-button-chat", "tab-button-audit", "tab-button-studio", "tab-button-retention", "theme-toggle", "onboarding-modal", "explorer-run", "lab-run", "ret-run"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} should exist in the full app shell`);
  }
  assert.match(app, /function wireExplorer\\(/);
  assert.match(app, /function wireStudio\\(/);
  assert.match(app, /function wireLab\\(/);
  assert.match(app, /function wireRetention\\(/);
  assert.match(app, /byId\\(["']theme-toggle["']\\)\\?\\.addEventListener\\(["']click["'], cycleTheme\\)/);
  assert.match(page, /localStorage\\.setItem\\(["']youtube-skillbox:guest["'], ["']\\[false\\]["']\\)/);
});

test("original workspace navigation is wired before standalone service initialization", () => {
  const mainStart = app.indexOf("async function main()");
  const navigation = app.indexOf("wireTabs();", mainStart);
  const backend = app.indexOf("await connect();", mainStart);
  assert.ok(mainStart >= 0 && navigation > mainStart && backend > navigation);
});

test("the public preview uses a versioned standalone application bundle", () => {
  assert.match(html, /NVIDIA NIM/);
  assert.match(html, /SKILLBOX ENGINE/);
  assert.match(html, /app\\.js\\?v=skillbox-full-parity-/);
  assert.doesNotMatch(html, /ANNA APP|ANNA GUIDE|HOST LLM|Connecting to Anna host/);
});
