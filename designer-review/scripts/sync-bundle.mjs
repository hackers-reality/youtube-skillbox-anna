import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const destination = path.join(root, "designer-review/public/skillbox");
await mkdir(path.join(destination, "assets"), { recursive: true });

for (const file of ["anna-tool-ids.js", "anna-tool-runtime.mjs", "chat-routing.mjs", "anna-tool-runtime.test.mjs", "frontend-regression.test.mjs"]) {
  await cp(path.join(root, "bundle", file), path.join(destination, file));
}
await cp(path.join(root, "bundle/assets"), path.join(destination, "assets"), { recursive: true, force: true });

let appJs = await readFile(path.join(root, "bundle", "app.js"), "utf8");

appJs = appJs.replace(
  /\/\* YouTube Skillbox \u2014 Anna App bundle[\s\S]*?\*\/\s*/,
  "/* YouTube Skillbox \u2014 NVIDIA NIM + Skillbox Engine\n * Static SPA. Talks to:\n *   \u2022 Skillbox tools \u2192 fetch(\"/api/skillbox\")\n *   \u2022 NVIDIA NIM   \u2192 fetch(\"/api/nvidia/chat\")\n * Evidence labels: MEASURED = measured numbers, INFERRED = reasoned from measured, HYPOTHESIS = unvalidated.\n */\n\n"
);

appJs = appJs.replace(/let anna = null;\s*let standalone = false;/, "let anna = null;\nlet standalone = true;");

appJs = appJs.replace(
  /async function connect\(\) \{[\s\S]*?^\}\s*(?=\nfunction|\nconst|\nlet|\nvar|\nimport|\/\*|$)/m,
  "async function connect() {\n  standalone = true;\n  anna = null;\n  setStatus(\"Standalone preview \u2014 Skillbox tools via /api/skillbox\", true, true);\n  return false;\n}"
);

appJs = appJs.replace(/import \{ AnnaAppRuntime \} from "\/static\/anna-apps\/_sdk\/latest\/index\.js";\s*/, "");
appJs = appJs.replace(/import \{ invokeAnnaTool \} from "\.\/anna-tool-runtime\.mjs";\s*/, "");
appJs = appJs.replace(/import \{ planChatTools \} from "\.\/chat-routing\.mjs";\s*/, "");

appJs = appJs.replace(
  /async function tool\(method, args, timeoutMs, options = \{\}\) \{[\s\S]*?return payload;\s*\}/m,
  "async function tool(method, args, timeoutMs, options = {}) {\n  const res = await fetch(\"/api/skillbox\", {\n    method: \"POST\",\n    headers: { \"Content-Type\": \"application/json\" },\n    body: JSON.stringify({ method, args: args || {} }),\n  });\n  if (!res.ok) {\n    const err = await res.json().catch(() => ({ error: \"Skillbox tool failed\" }));\n    throw new Error(err.error || \"Skillbox tool failed\");\n  }\n  const payload = await res.json();\n  return payload.result ?? payload;"
);

appJs = appJs.replace(
  /async function llm\(systemPrompt, userMessage, maxTokens = 3200\) \{[\s\S]*?return \(r && r\.content && r\.content\.text\) \|\| String\(r\);\s*\}/m,
  "async function llm(systemPrompt, userMessage, maxTokens = 3200) {\n  const res = await fetch(\"/api/nvidia/chat\", {\n    method: \"POST\",\n    headers: { \"Content-Type\": \"application/json\" },\n    body: JSON.stringify({ systemPrompt, userMessage, maxTokens, temperature: 0.35 }),\n  });\n  if (!res.ok) throw new Error(\"NVIDIA NIM chat failed\");\n  const data = await res.json();\n  return data.content ?? data.text ?? String(data);"
);

appJs = appJs.replace(
  /async function llmWithImage\(systemPrompt, userMessage, imageBlock, maxTokens = 2600\) \{[\s\S]*?return \(response && response\.content && response\.content\.text\) \|\| String\(response\);\s*\}/m,
  "async function llmWithImage(systemPrompt, userMessage, imageBlock, maxTokens = 2600) {\n  const res = await fetch(\"/api/nvidia/chat\", {\n    method: \"POST\",\n    headers: { \"Content-Type\": \"application/json\" },\n    body: JSON.stringify({ systemPrompt, userMessage, imageBlock, maxTokens, temperature: 0.25 }),\n  });\n  if (!res.ok) throw new Error(\"NVIDIA NIM vision failed\");\n  const data = await res.json();\n  return data.content ?? data.text ?? String(data);"
);

appJs = appJs.replace(
  /async function llmWithImages\(systemPrompt, userMessage, imageBlocks, maxTokens = 3200\) \{[\s\S]*?^\}\s*(?=\nfunction|\nconst|\nlet|\nvar|\nimport|\/\*|$)/m,
  "async function llmWithImages(systemPrompt, userMessage, imageBlocks, maxTokens = 3200) {\n  const res = await fetch(\"/api/nvidia/chat\", {\n    method: \"POST\",\n    headers: { \"Content-Type\": \"application/json\" },\n    body: JSON.stringify({ systemPrompt, userMessage, imageBlocks, maxTokens, temperature: 0.2 }),\n  });\n  if (!res.ok) throw new Error(\"NVIDIA NIM multi-image failed\");\n  const data = await res.json();\n  return data.content ?? data.text ?? String(data);"
);

appJs = appJs.replace(
  /async function storageList\(key\) \{[\s\S]*?return \[\];\s*\}/m,
  "async function storageList(key) {\n  try { return JSON.parse(localStorage.getItem(key) || \"[]\"); } catch { return []; }"
);

appJs = appJs.replace(
  /async function storageSet\(key, value\) \{[\s\S]*?localStorage\.setItem\(key, JSON\.stringify\(value\)\);\s*\}/m,
  "async function storageSet(key, value) {\n  localStorage.setItem(key, JSON.stringify(value));"
);

appJs = appJs.replace(
  /byId\("onboarding-copy"\)\?\.addEventListener\("click", async \(\) => \{ await navigator\.clipboard\.writeText\(profileState\.phrase\); byId\("onboarding-copy"\)\.textContent = "Copied"; \}\);/, 
  "byId(\"onboarding-copy\")?.addEventListener(\"click\", async () => { const copied = await copyWithFeedback(\"your channel, measured.\", byId(\"onboarding-copy\"), byId(\"chat-guest-note\")); if (!copied) { byId(\"chat-guest-note\").textContent = \"Copy failed \u2014 select and copy manually.\"; byId(\"chat-guest-note\").classList.remove(\"hidden\"); } });"
);

appJs = appJs.replace(
  /(async function copyWithFeedback\(text, button, errorTarget = null\) \{[\s\S]*?return false;\s*\})/m,
  "$1\n\nbyId(\"copy-description\")?.addEventListener(\"click\", async () => { await copyWithFeedback(original, byId(\"copy-description\")); });"
);

appJs = appJs.replace(/import \{ AnnaAppRuntime \} from "\/static\/anna-apps\/_sdk\/latest\/index\.js";\s*/, "");
appJs = appJs.replace(/import \{ invokeAnnaTool \} from "\.\/anna-tool-runtime\.mjs";\s*/, "");
appJs = appJs.replace(/import \{ planChatTools \} from "\.\/chat-routing\.mjs";\s*/, "");

appJs = appJs.replace(
  /async function tool\(method, args, timeoutMs, options = \{\}\) \{[\s\S]*?return payload;\s*\}/m,
  "async function tool(method, args, timeoutMs, options = {}) {\n  const res = await fetch(\"/api/skillbox\", {\n    method: \"POST\",\n    headers: { \"Content-Type\": \"application/json\" },\n    body: JSON.stringify({ method, args: args || {} }),\n  });\n  if (!res.ok) {\n    const err = await res.json().catch(() => ({ error: \"Skillbox tool failed\" }));\n    throw new Error(err.error || \"Skillbox tool failed\");\n  }\n  const payload = await res.json();\n  return payload.result ?? payload;"
);

appJs = appJs.replace(
  /async function llm\(systemPrompt, userMessage, maxTokens = 3200\) \{[\s\S]*?return \(r && r\.content && r\.content\.text\) \|\| String\(r\);\s*\}/m,
  "async function llm(systemPrompt, userMessage, maxTokens = 3200) {\n  const res = await fetch(\"/api/nvidia/chat\", {\n    method: \"POST\",\n    headers: { \"Content-Type\": \"application/json\" },\n    body: JSON.stringify({ systemPrompt, userMessage, maxTokens, temperature: 0.35 }),\n  });\n  if (!res.ok) throw new Error(\"NVIDIA NIM chat failed\");\n  const data = await res.json();\n  return data.content ?? data.text ?? String(data);"
);

appJs = appJs.replace(
  /async function llmWithImage\(systemPrompt, userMessage, imageBlock, maxTokens = 2600\) \{[\s\S]*?return \(response && response\.content && response\.content\.text\) \|\| String\(response\);\s*\}/m,
  "async function llmWithImage(systemPrompt, userMessage, imageBlock, maxTokens = 2600) {\n  const res = await fetch(\"/api/nvidia/chat\", {\n    method: \"POST\",\n    headers: { \"Content-Type\": \"application/json\" },\n    body: JSON.stringify({ systemPrompt, userMessage, imageBlock, maxTokens, temperature: 0.25 }),\n  });\n  if (!res.ok) throw new Error(\"NVIDIA NIM vision failed\");\n  const data = await res.json();\n  return data.content ?? data.text ?? String(data);"
);

appJs = appJs.replace(
  /async function storageList\(key\) \{[\s\S]*?return \[\];\s*\}/m,
  "async function storageList(key) {\n  try { return JSON.parse(localStorage.getItem(key) || \"[]\"); } catch { return []; }"
);

appJs = appJs.replace(
  /async function storageSet\(key, value\) \{[\s\S]*?localStorage\.setItem\(key, JSON\.stringify\(value\)\);\s*\}/m,
  "async function storageSet(key, value) {\n  localStorage.setItem(key, JSON.stringify(value));"
);

appJs = appJs.replace(
  /byId\("onboarding-copy"\)\?\.addEventListener\("click", async \(\) => \{ await navigator\.clipboard\.writeText\(profileState\.phrase\); byId\("onboarding-copy"\)\.textContent = "Copied"; \}\);/, 
  "byId(\"onboarding-copy\")?.addEventListener(\"click\", async () => { const copied = await copyWithFeedback(\"your channel, measured.\", byId(\"onboarding-copy\"), byId(\"chat-guest-note\")); if (!copied) { byId(\"chat-guest-note\").textContent = \"Copy failed \u2014 select and copy manually.\"; byId(\"chat-guest-note\").classList.remove(\"hidden\"); } });"
);

appJs = appJs.replace(
  /(async function copyWithFeedback\(text, button, errorTarget = null\) \{[\s\S]*?return false;\s*\})/m,
  "$1\n\nbyId(\"copy-description\")?.addEventListener(\"click\", async () => { await copyWithFeedback(original, byId(\"copy-description\")); });"
);

appJs = appJs.replace(/import \{ AnnaAppRuntime \} from "\/static\/anna-apps\/_sdk\/latest\/index\.js";\s*/, "");
appJs = appJs.replace(/import \{ invokeAnnaTool \} from "\.\/anna-tool-runtime\.mjs";\s*/, "");
appJs = appJs.replace(/import \{ planChatTools \} from "\.\/chat-routing\.mjs";\s*/, "");

appJs = appJs.replace(/AnnaAppRuntime/g, "");
appJs = appJs.replace(/anna\.llm\.complete/g, "");
appJs = appJs.replace(/anna\.tools\.invoke/g, "");
appJs = appJs.replace(/anna\.storage\./g, "");
appJs = appJs.replace(/Anna host/g, "NVIDIA NIM host");
appJs = appJs.replace(/Anna AI OS/g, "NVIDIA NIM + Skillbox Engine");
appJs = appJs.replace(/Anna App/g, "NVIDIA NIM + Skillbox Engine");
appJs = appJs.replace(/Anna/g, "NVIDIA NIM");

// FINAL SAFEGUARD: Ensure llmWithImages exists
if (!appJs.includes("async function llmWithImages")) {
  const insertBefore = appJs.lastIndexOf("async function main");
  if (insertBefore > 0) {
    const llmWithImagesFn = `
async function llmWithImages(systemPrompt, userMessage, imageBlocks, maxTokens = 3200) {
  const res = await fetch("/api/nvidia/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt, userMessage, imageBlocks, maxTokens, temperature: 0.2 }),
  });
  if (!res.ok) throw new Error("NVIDIA NIM multi-image failed");
  const data = await res.json();
  return data.content ?? data.text ?? String(data);
}
`;
    appJs = appJs.slice(0, insertBefore) + llmWithImagesFn + "\n" + appJs.slice(insertBefore);
  }
}

await writeFile(path.join(destination, "app.js"), appJs);

let html = await readFile(path.join(root, "bundle", "index.html"), "utf8");
html = html.replace(/<title>YouTube Skillbox<\/title>/, "<title>YouTube Skillbox \u2014 NVIDIA NIM + Skillbox Engine</title>");
html = html.replace(/Evidence-backed YouTube audits, keyword research and content fixes \u2014 inside Anna\./, "Evidence-backed YouTube audits, keyword research and creator workflows \u2014 NVIDIA NIM + Skillbox Engine");
html = html.replace(/ANNA APP/g, "NVIDIA NIM + SKILLBOX ENGINE");
html = html.replace(/HOST LLM|Connecting to Anna host/g, "NVIDIA NIM + SKILLBOX ENGINE");
html = html.replace(/ANNA APP/g, "NVIDIA NIM + SKILLBOX ENGINE");
html = html.replace(/ANNA GUIDE \/ 00/g, "NVIDIA NIM / 00");
html = html.replace(/HOST LLM \u00B7 TOOL-AWARE/g, "NVIDIA NIM + SKILLBOX ENGINE \u00B7 TOOL-AWARE");
html = html.replace(/Ask Anna about your channel/g, "Ask Skillbox about your channel");
html = html.replace(/Ask Anna/g, "Ask Skillbox");
html = html.replace(/Anna\u0027s hosted/g, "NVIDIA NIM");
html = html.replace(/Anna AI OS/g, "NVIDIA NIM + Skillbox Engine");
html = html.replace(/Anna host/g, "NVIDIA NIM host");
html = html.replace(/Anna App/g, "NVIDIA NIM + Skillbox Engine");
html = html.replace(/Anna App/g, "NVIDIA NIM + Skillbox Engine");
html = html.replace(/<script src="app\.js" type="module"><\/script>/, "<script src=\"app.js?v=skillbox-full-parity-" + Date.now() + "\" type=\"module\"><\/script>");

await writeFile(path.join(destination, "index.html"), html);
await cp(path.join(root, "bundle", "style.css"), path.join(destination, "style.css"));
for (const file of ["anna-tool-ids.js", "anna-tool-runtime.mjs", "chat-routing.mjs", "anna-tool-runtime.test.mjs", "frontend-regression.test.mjs"]) {
  await cp(path.join(root, "bundle", file), path.join(destination, file));
}
await cp(path.join(root, "bundle/assets"), path.join(destination, "assets"), { recursive: true, force: true });

console.log("Synced and transformed the Skillbox UI for standalone review site.");