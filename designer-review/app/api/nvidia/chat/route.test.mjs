import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "./route.js";

const originalKey = process.env.NVIDIA_API_KEY;
const originalModel = process.env.NVIDIA_MODEL;
const originalTextModel = process.env.NVIDIA_TEXT_MODEL;
const originalVisionModel = process.env.NVIDIA_VISION_MODEL;
const originalFetch = globalThis.fetch;

test.after(() => {
  for (const [key, value] of [
    ["NVIDIA_API_KEY", originalKey],
    ["NVIDIA_MODEL", originalModel],
    ["NVIDIA_TEXT_MODEL", originalTextModel],
    ["NVIDIA_VISION_MODEL", originalVisionModel],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
});

async function post(body) {
  return POST(new Request("https://preview.example/api/nvidia/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("status reports current text and vision models without exposing the secret", async () => {
  delete process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_TEXT_MODEL;
  delete process.env.NVIDIA_VISION_MODEL;
  process.env.NVIDIA_MODEL = "old/ignored-model";
  const response = await GET();
  const body = await response.json();
  assert.equal(body.configured, false);
  assert.equal(body.models.text, "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.equal(body.models.vision, "nvidia/nemotron-3.5-super-vl-120b-a12b");
  assert.equal(body.model, body.models.text);
  assert.equal(JSON.stringify(body).includes("API_KEY"), false);
  assert.equal(JSON.stringify(body).includes("old/ignored-model"), false);
});

test("chat endpoint clearly reports a missing key", async () => {
  delete process.env.NVIDIA_API_KEY;
  const response = await post({ userMessage: "Hello" });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/i);
});

test("text requests use Nemotron 3.5 Lightning and disable thinking to prevent empty final content", async () => {
  process.env.NVIDIA_API_KEY = "test-secret-not-for-output";
  delete process.env.NVIDIA_TEXT_MODEL;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return Response.json({ choices: [{ message: { content: "Live model reply" }, finish_reason: "stop" }] });
  };
  const response = await post({
    systemPrompt: "System guidance",
    userMessage: "Hello Anna",
    maxTokens: 5000,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    content: "Live model reply",
    model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  });
  assert.equal(captured.url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(captured.options.headers.Authorization, "Bearer test-secret-not-for-output");
  assert.equal(captured.body.model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.equal(captured.body.max_tokens, 5000);
  assert.deepEqual(captured.body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(captured.body.stream, false);
});

test("image requests use Nemotron 3.5 Super VL and preserve the image payload", async () => {
  process.env.NVIDIA_API_KEY = "test-secret-not-for-output";
  delete process.env.NVIDIA_VISION_MODEL;
  let captured;
  globalThis.fetch = async (_url, options) => {
    captured = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: [{ type: "text", text: "Thumbnail looks clear." }] } }] });
  };
  const response = await post({
    userMessage: "Review this thumbnail",
    images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content, "Thumbnail looks clear.");
  assert.equal(captured.model, "nvidia/nemotron-3.5-super-vl-120b-a12b");
  assert.deepEqual(captured.chat_template_kwargs, { enable_thinking: false });
  assert.equal(captured.messages[0].content[1].type, "image_url");
});

test("custom text and vision models can be configured independently", async () => {
  process.env.NVIDIA_API_KEY = "test-secret";
  process.env.NVIDIA_TEXT_MODEL = "custom/text-model";
  process.env.NVIDIA_VISION_MODEL = "custom/vision-model";
  const status = await GET();
  assert.deepEqual((await status.json()).models, {
    text: "custom/text-model",
    vision: "custom/vision-model",
  });
});

test("empty model content returns an actionable error instead of a blank chat bubble", async () => {
  process.env.NVIDIA_API_KEY = "test-secret";
  globalThis.fetch = async () => Response.json({
    choices: [{ message: { content: "", reasoning: "not surfaced" }, finish_reason: "length" }],
  });
  const response = await post({ userMessage: "Hello" });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /returned no user-facing text/);
  assert.match(body.error, /finish reason: length/);
  assert.doesNotMatch(JSON.stringify(body), /not surfaced/);
});

test("upstream authentication errors are actionable and never leak the key", async () => {
  process.env.NVIDIA_API_KEY = "super-secret-token";
  globalThis.fetch = async () => Response.json({ error: { message: "unauthorized" } }, { status: 401 });
  const response = await post({ userMessage: "Hello" });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /NVIDIA_API_KEY/);
  assert.doesNotMatch(JSON.stringify(body), /super-secret-token/);
});

test("chat endpoint rejects oversized requests before calling NVIDIA", async () => {
  process.env.NVIDIA_API_KEY = "test-secret-not-for-output";
  globalThis.fetch = async () => { throw new Error("upstream must not be called"); };
  const response = await POST(new Request("https://preview.example/api/nvidia/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "5000000" },
    body: "{}",
  }));
  assert.equal(response.status, 413);
});

test("legacy single-image and multi-image client payloads are normalized for NVIDIA vision", async () => {
  process.env.NVIDIA_API_KEY = "test-secret-not-for-output";
  delete process.env.NVIDIA_VISION_MODEL;
  let captured;
  globalThis.fetch = async (_url, options) => {
    captured = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: "Image reviewed." } }] });
  };
  const single = await post({ userMessage: "Review this thumbnail", imageBlock: { type: "image", mimeType: "image/png", data: "aGVsbG8=" } });
  assert.equal(single.status, 200);
  assert.equal(captured.messages[0].content[1].type, "image_url");
  const multiple = await post({ userMessage: "Compare these thumbnails", imageBlocks: [{ mimeType: "image/jpeg", data: "aGVsbG8=" }] });
  assert.equal(multiple.status, 200);
  assert.equal(captured.messages[0].content[1].type, "image_url");
});
