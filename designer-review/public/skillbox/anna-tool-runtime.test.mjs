import assert from "node:assert/strict";
import { invokeAnnaTool } from "./anna-tool-runtime.mjs";

const calls = [];
const anna = {
  tools: {
    invoke(request, options) {
      calls.push(["sync", request, options]);
      return Promise.resolve({ success: true, data: {} });
    },
    invokeAsyncAwait(request, options) {
      calls.push(["async", request, options]);
      return Promise.resolve({ success: true, data: {} });
    },
  },
};

await invokeAnnaTool(anna, { tool_id: "tool", method: "ping", args: {}, timeoutMs: 85000 }, { onProgress() {} });
assert.equal(calls[0][0], "sync");
assert.equal(calls[0][2].timeoutMs, 85000);

await invokeAnnaTool(anna, { tool_id: "tool", method: "outliers", args: {}, timeoutMs: 180000 }, { onProgress() {} });
assert.equal(calls[1][0], "async");
assert.equal(calls[1][1].timeoutMs, 180000);
assert.equal(calls[1][2].timeoutMs, 210000);
assert.equal(typeof calls[1][2].onProgress, "function");

assert.throws(
  () => invokeAnnaTool({ tools: {} }, { timeoutMs: 180001 }),
  /invokeAsyncAwait/
);

console.log("Anna tool runtime contract tests passed");
