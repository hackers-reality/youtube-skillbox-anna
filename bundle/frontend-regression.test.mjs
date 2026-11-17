import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./app.js", import.meta.url), "utf8");

// $() returns one DOM node; $$() is required for selector collections.
const lines = source.split(/\r?\n/).map((line) => line.trim());
assert.equal(lines.some((line) => line.startsWith('$(".explorer-actions [data-explore]").forEach')), false);
assert.equal(lines.some((line) => line.startsWith('$$(".explorer-actions [data-explore]").forEach')), true);
assert.equal(lines.some((line) => line.startsWith('const buttons = $$(".explorer-actions [data-explore]")')), true);

console.log("Frontend selector regression tests passed");
