import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "./route.js";

const originalKey = process.env.NVIDIA_API_KEY;
const originalModel = process.env.NVIDIA_MODEL;
const originalFetch = globalThis.fetch;

test.after(() => {
  if (originalKey === undefined) delete process.env.NVIDIA_API_KEY;
  else process.env.NVIDIA_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.NVIDIA_MODEL;
  else process.env.NVIDIA_MODEL = originalModel;
  globalThis.fetch = originalFetch;
});

test("status reports configuration without exposing the secret", async () => {
  delete process.env.NVIDIA_API_KEY;
  const response = await GET();
  const body = await response.json();
  assert.equal(body.configured, false);
  assert.equal(JSON.stringify(body).includes("API_KEY"), false);
});

test("chat endpoint clearly reports a missing key", async () => {
  delete process.env.NVIDIA_API_KEY;
  const response = await POST(new Request("https://preview.example/api/nvidia/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userMessage: "Hello" }),
  }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/i);
});

test("chat endpoint forwards text and image inputs using the server-only key", async () => {
  process.env.NVIDIA_API_KEY = "test-secret-not-for-output";
  process.env.NVIDIA_MODEL = "test/vision-model";
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return Response.json({ choices: [{ message: { content: "Live model reply" } }] });
  };
  const response = await POST(new Request("https://preview.example/api/nvidia/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemPrompt: "System guidance", userMessage: "Review this thumbnail", maxTokens: 5000,
      images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
    }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { content: "Live model reply" });
  assert.equal(captured.url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(captured.options.headers.Authorization, "Bearer test-secret-not-for-output");
  assert.equal(captured.body.model, "test/vision-model");
  assert.equal(captured.body.max_tokens, 4096);
  assert.equal(captured.body.messages[1].content[1].type, "image_url");
});

test("chat endpoint rejects oversized requests before calling NVIDIA", async () => {
  process.env.NVIDIA_API_KEY = "test-secret-not-for-output";
  globalThis.fetch = async () => { throw new Error("upstream must not be called"); };
  const response = await POST(new Request("https://preview.example/api/nvidia/chat", {
    method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "5000000" }, body: "{}",
  }));
  assert.equal(response.status, 413);
});
