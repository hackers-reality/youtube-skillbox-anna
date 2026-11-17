import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./app.js", import.meta.url), "utf8");

// $() returns one DOM node; $$() is required for selector collections.
const lines = source.split(/\r?\n/).map((line) => line.trim());
assert.equal(lines.some((line) => line.startsWith('$(".explorer-actions [data-explore]").forEach')), false);
assert.equal(lines.some((line) => line.startsWith('$$(".explorer-actions [data-explore]").forEach')), true);
assert.equal(lines.some((line) => line.startsWith('const buttons = $$(".explorer-actions [data-explore]")')), true);

const index = await readFile(new URL("./index.html", import.meta.url), "utf8");
assert.equal((index.match(/id="lab-playlist"/g) || []).length, 1);
assert.match(index, /id="tab-chat"/);
assert.match(index, /id="profile-fetch"/);
assert.match(index, /id="ret-file"/);
assert.match(index, /id="ret-file-entry"/);
assert.match(index, /id="ret-output" class="retention-report/);
assert.match(source, /function renderExplorer\(/);
assert.match(source, /function renderRetentionReport\(/);
assert.match(source, /function retentionGraph\(/);
assert.match(source, /const smoothPath/);
assert.doesNotMatch(source, /<polyline class="ret-line"/);
assert.match(source, /class="ret-area"/);
assert.match(source, /function applyTheme\(/);

console.log("Frontend selector regression tests passed");
