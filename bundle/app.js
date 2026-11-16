/* YouTube Skillbox — Anna App bundle
 * Static SPA. Talks to:
 *   • Host tools  → anna.tools.invoke({ tool_id, method, args })  (skillbox-core executa)
 *   • Host LLM    → anna.llm.complete({ messages, ... })          (free-form analysis)
 *   • Host storage→ anna.storage.set/get/list                     (saved audits)
 * Evidence labels: MEASURED = measured numbers, INFERRED = reasoned from measured, HYPOTHESIS = unvalidated.
 */

import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

const TOOL_ID = (typeof window !== "undefined" && window.__ANNA_TOOL_IDS__ && window.__ANNA_TOOL_IDS__["youtube-skillbox"]) || "bundled:youtube-skillbox";
const AUDITS_KEY = "youtube-skillbox:audits";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const byId = (id) => document.getElementById(id);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const parseArgsLine = (s) => {
  const i = s.indexOf("=");
  return i < 0 ? [s.trim(), ""] : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
};

/* ---------- anna connection ---------- */
let anna = null;
let standalone = false;

async function connect() {
  try {
    anna = await AnnaAppRuntime.connect();
    setStatus("Connected to Anna host", true);
    return true;
  } catch (e) {
    standalone = true;
    setStatus("Standalone preview (no host) — wireframe mode", true, true);
    return false;
  }
}

function setStatus(text, ok, warn = false) {
  const dot = byId("status-dot");
  const label = byId("status-text");
  if (dot) dot.className = "dot" + (ok ? " ok" : warn ? "" : " err");
  if (label) label.textContent = text;
}

/* ---------- helpers: tools / llm / storage ---------- */
async function tool(method, args) {
  if (standalone || !anna) {
    // deterministic demo payloads so the UI is still demonstrable
    return demoPayload(method, args);
  }
  const res = await anna.tools.invoke({ tool_id: TOOL_ID, method, args: args || {} });
  if (!res || res.success !== true) {
    const err = (res && res.error) || "tool failed";
    throw new Error(err);
  }
  return res.data;
}

async function llm(systemPrompt, userMessage, maxTokens = 3200) {
  if (standalone || !anna) {
    await new Promise((r) => setTimeout(r, 650));
    return demoLLM(userMessage);
  }
  const r = await anna.llm.complete({
    messages: [{ role: "user", content: userMessage }],
    systemPrompt,
    maxTokens,
    temperature: 0.35,
  });
  return (r && r.content && r.content.text) || String(r);
}

async function storageList(key) {
  try {
    if (anna && !standalone) {
      const r = await anna.storage.get({ key });
      if (!r) return [];
      const v = typeof r === "string" ? r : r.value ?? r;
      return JSON.parse(v || "[]");
    }
  } catch (_) { /* fall through */ }
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}

async function storageSet(key, value) {
  const serialized = JSON.stringify(value);
  if (anna && !standalone) {
    try {
      await anna.storage.set({ key, value: serialized });
      return;
    } catch (_) { /* fall through */ }
  }
  localStorage.setItem(key, serialized);
}

/* ---------- tabs ---------- */
function wireTabs() {
  $$(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab").forEach((b) => b.classList.toggle("is-active", b === btn));
      $$(".panel").forEach((p) => p.classList.remove("is-active"));
      byId(`tab-${btn.dataset.tab}`)?.classList.add("is-active");
    });
  });
}

/* ---------- audit pipeline ---------- */
const AUDIT_SYSTEM = `
You are the YouTube Skillbox analyst. You receive hard tool data (channel counts, subs, videos, outliers, keywords, scorecards) — never invent numbers.
Write with a creator's directness: specific fixes, no filler, no "great job". Structure:
1) THE ONE-LINE VERDICT (what actually moves this channel)
2) MEASURED snapshot (subs / uploads / cadence / outliers w/ ratios)
3) What's working (evidence, not vibes)
4) The 3 highest-leverage fixes, one line each
5) What NOT to do, one line
6) Keyword angle (if keyword data present) — opportunity vs competition, plain English
Label every claim MEASURED / INFERRED / HYPOTHESIS like "MEASURED:", "INFERRED:", "HYPOTHESIS:". Verdict = the whole channel's unlock, not generic advice.
Max ~1200 words. Markdown.`;

async function runAudit(handle) {
  handle = (handle || "").trim();
  if (!handle) return setAuditResult("<div class='card'><h3>Nothing to audit</h3><p>Enter a channel handle first — @YourChannel.</p></div>", false);

  const progress = byId("audit-progress");
  const bar = byId("audit-bar");
  const stage = byId("audit-stage");
  const btn = byId("audit-run");
  const rawBox = byId("audit-raw");
  const rawPre = byId("audit-raw-pre");
  const result = byId("audit-result");

  progress.classList.remove("hidden");
  result.classList.add("hidden");
  btn.disabled = true;
  rawBox.classList.add("hidden");

  const setStage = (pct, text) => { bar.style.width = pct + "%"; stage.textContent = text; };
  setStage(5, "Fetching channel snapshot…");

  const jobs = [
    { key: "snapshot", label: "snapshot", args: { handle } },
    { key: "latest", label: "latest uploads", args: { handle, limit: 8 } },
    { key: "outliers", label: "outliers", args: { handle, min_ratio: 2.0 } },
  ];

  const evidence = {};
  let okSteps = 0;
  for (const job of jobs) {
    setStage(15 + okSteps * 18, `Running ${job.label}…`);
    try {
      evidence[job.key] = await tool(job.key, job.args);
    } catch (e) {
      evidence[job.key] = { error: String(e.message || e) };
    }
    okSteps += 1;
  }

  setStage(70, "Scoring keyword opportunity…");
  try {
    const seed = (() => {
      const d = evidence.snapshot && evidence.snapshot.profile && evidence.snapshot.profile.description;
      if (d) { const first = String(d).split(/[.\n]/)[0].trim(); if (first) return first.slice(0, 60); }
      return handle;
    })();
    evidence.keywords = await tool("keywords", { seed, limit: 12 });
  } catch (e) {
    evidence.keywords = { error: String(e.message || e) };
  }

  setStage(85, "Writing the verdict with host LLM…");
  const slim = JSON.stringify(evidence, null, 0).slice(0, 15000);
  let verdict = "";
  try {
    verdict = await llm(AUDIT_SYSTEM, `Channel: ${handle}\nEvidence JSON:\n${slim}\n\nWrite the audit.`, 3400);
  } catch (e) {
    verdict = `Host LLM failed: ${e.message || e}\n\nRaw evidence is below and saved.`;
  }

  setStage(100, "Audit complete.");

  // persist
  try {
    const audits = await storageList(AUDITS_KEY);
    audits.unshift({ ts: Date.now(), handle, evidence, verdict });
    await storageSet(AUDITS_KEY, audits.slice(0, 15));
  } catch (_) { /* non-fatal */ }

  rawPre.textContent = JSON.stringify({ evidence, verdict }, null, 2);
  rawBox.classList.remove("hidden");

  result.innerHTML = renderAuditCards(handle, evidence, verdict);
  result.classList.remove("hidden");
  progress.classList.add("hidden");
  btn.disabled = false;
  await renderSavedList();
}

function renderAuditCards(handle, ev, verdict) {
  const sec = (ev.snapshot && ev.snapshot.sections) || {};
  const prof = (ev.snapshot && ev.snapshot.profile) || {};
  const latest = (ev.latest && (Array.isArray(ev.latest) ? ev.latest : ev.latest.videos)) || [];
  const outliers = (ev.outliers && (Array.isArray(ev.outliers) ? ev.outliers : ev.outliers.videos)) || [];
  const kw = (ev.keywords && (Array.isArray(ev.keywords) ? ev.keywords : ev.keywords.ideas)) || [];

  const subs = prof.subscribers ?? sec.subs ?? "?";
  const videos = sec.videos ?? "?";
  const shorts = sec.shorts ?? "?";

  const outRows = outliers.slice(0, 6).map((v) =>
    `<tr><td>${escapeHtml(String(v.title || v.id || "").slice(0, 90))}</td><td>${escapeHtml(String(v.views ?? v.view_count ?? "?"))}</td><td>${escapeHtml(String(v.ratio ?? "—"))}</td></tr>`
  ).join("");

  const kwRows = kw.slice(0, 8).map((k) => {
    const opp = Number(k.opportunity_score ?? k.score ?? 0);
    const comp = Number(k.competition_score ?? k.competition ?? 0);
    const verdict2 = /^[A-Z]/.test(String(k.verdict || "")) ? String(k.verdict) : "MAYBE";
    return `<tr><td>${escapeHtml(String(k.keyword || k.seed || ""))}</td><td>${opp}</td><td>${comp}</td><td>${escapeHtml(verdict2)}</td></tr>`;
  }).join("");

  return `
  <div class="card">
    <h3>📊 MEASURED — Channel snapshot <span class="ev ev-measured">MEASURED</span></h3>
    <div class="grid-2">
      <div class="stat"><div class="n">${escapeHtml(String(subs))}</div><div class="k">Subs</div></div>
      <div class="stat"><div class="n">${escapeHtml(String(videos))}<span style="color:var(--text-dim);font-size:15px"> / ${escapeHtml(String(shorts))}</span></div><div class="k">Long-form / Shorts</div></div>
    </div>
  </div>

  ${outliers.length ? `<div class="card"><h3>🚀 Outliers — what's breaking <span class="ev ev-measured">MEASURED</span></h3>
    <table class="tbl"><thead><tr><th>Video</th><th>Views</th><th>Views/Subs</th></tr></thead><tbody>${outRows}</tbody></table></div>` : ""}

  ${kwRows ? `<div class="card"><h3>🔑 Keyword angles <span class="ev ev-measured">MEASURED</span> · <span class="hint" style="margin:0">verdicts are INFERRED</span></h3>
    <table class="tbl"><thead><tr><th>Idea</th><th>Opportunity</th><th>Competition</th><th>Call</th></tr></thead><tbody>${kwRows}</tbody></table></div>` : ""}

  <div class="card bigfix">
    <div class="label">The Audit — host LLM, evidence-backed</div>
    <div class="audit-report" style="margin-top:8px">${renderMd(verdict)}</div>
  </div>`;
}

function renderMd(s) {
  const esc = escapeHtml(String(s || ""));
  return esc
    .replace(/^#{3}\s?(.*)$/gm, "<h3>$1</h3>")
    .replace(/^#{2}\s?(.*)$/gm, "<h3>$1</h3>")
    .replace(/^#\s?(.*)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br />");
}

// minimal table styles injected once
const styleTag = document.createElement("style");
styleTag.textContent = `
.tbl{width:100%;border-collapse:collapse;font-size:12px}
.tbl th,.tbl td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--border-soft)}
.tbl th{color:var(--text-dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.08em}
.tbl tr:last-child td{border-bottom:none}
`;
document.head.appendChild(styleTag);

async function renderSavedList() {
  const list = byId("saved-list");
  const audits = await storageList(AUDITS_KEY);
  if (!audits.length) {
    list.innerHTML = '<li class="empty">No saved audits yet — run one above.</li>';
    return;
  }
  list.innerHTML = audits.map((a, i) => `
    <li class="saved-item">
      <div class="d">${new Date(a.ts).toLocaleString()} — ${escapeHtml(a.handle || "?")}</div>
      <button class="btn btn-ghost btn-small" data-open="${i}">Open</button>
    </li>`).join("");
  $$("[data-open]", list).forEach((b) => b.addEventListener("click", () => {
    const a = audits[Number(b.dataset.open)];
    if (a) {
      byId("audit-raw-pre").textContent = JSON.stringify({ evidence: a.evidence, verdict: a.verdict }, null, 2);
      byId("audit-raw").classList.remove("hidden");
      byId("audit-result").innerHTML = renderAuditCards(a.handle, a.evidence, a.verdict);
      byId("audit-result").classList.remove("hidden");
      setStatus("Loaded saved audit", true);
    }
  }));
}

/* ---------- demo payloads (standalone preview only) ---------- */
function demoPayload(method, args) {
  const H = args.handle || "@demo";
  switch (method) {
    case "snapshot": return { sections: { videos: 2, shorts: 16, shows: "no tab", playlists: 4, community: 3 }, profile: { subscribers: 131, description: "Demo channel (standalone preview — install the app for live data)." } };
    case "latest": return { videos: [{ title: "Why Earth spins", duration: "24", views: 8437 }] };
    case "outliers": return { videos: [{ title: "Why Earth spins", views: 8437, ratio: 64.4 }] };
    case "keywords": return { ideas: [{ keyword: `${H.replace("@","")} seo`, opportunity_score: 61, competition_score: 35, verdict: "MAYBE" }] };
    default: return {};
  }
}
function demoLLM() { return "STANDALONE PREVIEW\n\nMEASURED: ~131 subs · snapshot returned demo data.\n\nHYPOTHESIS: Install the app on Anna to get real numbers — the demo proves the UI, not your channel.\n\nOne fix: publish one tight niche per week for 6 weeks and measure the watch-time retention of each drop."; }

/* ---------- content studio ---------- */
const HOOK_FORMULAS = `21 proven hook formulas (use a small, deliberately-scoped subset, pick by fit, score honestly 0–100):
1. Opposing beliefs — "Everyone says X. Here's why they're wrong."
2. Odd one out — "If you can spot the difference…"
3. Personal stakes — "I lost $40k doing this."
4. Future flash — show the end result, rewind.
5. Numbers list — "7 things nobody tells you about…"
6. Quiet confession — "I'm not proud of this, but…"
7. Myth bust — "YouTube's most repeated lie…"
8. Time-box — "In 10 minutes I'll show you…"
9. Curiosity gap — "Nobody talks about the part after…"
10. Direct callout — "If you're a creator with <1k subs, this is for you."
11. Before/after — "This is my channel 90 days apart."
12. Villain — "The algorithm cheated me and here's the receipt."
13. Stakes escalation — "If you don't fix this, here's what happens next."
14. Contrarian "unpopular opinion" — "Stop doing X. It's killing your retention."
15. Visual prediction — "Watch what happens when I upload this."
16. Credibility hybrid — "3 years of posting, here's what actually worked."
17. Pattern interrupt — open mid-scene, no context.
18. Social proof — "The #6 video did 40× views. Here's the hook."
19. Regret frame — "I wasted 2 years on this. Don't."
20. Mechanism tease — "The one dial that decides if a video lives or dies."
21. Direct question — "What would you do with 100 subs and zero views?"`;

const TASK_PROMPTS = {
  hooks: `Task: generate 6 hook options for this idea using the hook formulas below. Score each hook honestly (0–100) against first-15-seconds survival: clarity ≥ curiosity gap > emotional stake > specificity. No inflated scores; if an option is meh, mark RED and say why.
${HOOK_FORMULAS}`,
  titles: `Task: write 5 title options. Constraints: ≤ 60 characters, keyword near the front, promise > clever, no clickbait the video can't cash. Then score each against clarity/promise/keyword-fit, mark any truncation risk on mobile (>43 chars). For each, show a thumbnail-text counterpart (2–4 words).`,
  seo: `Task: write the description (first 2 lines must re-state the promise with the keyword), 8–12 tags ordered by specificity, then a 6-point SEO sweep where you list what's missing with the exact fix. No fluff.`,
  chapters: `Task: from the transcript provided (or the idea), propose chapters. First entry must be 0:00, ≥3 chapters, ≥10 s each, titles ≤ 40 chars that work as search results. If the transcript isn't given, say what you need and produce the chapter skeleton with placeholders.`,
  shorts: `Task: find 3 self-contained Shorts inside this video (or idea). For each: the hook (≤ 2 lines), what to cut, the retention beat, and the payoff line at the end. Explain why each works as a standalone.`,
  full: `Task: produce the full pack. (1) the strongest of 6 hook options (scored), (2) one final title + thumbnail text, (3) description (first 2 lines + keyword) + 8 tags, (4) chapters skeleton, (5) one Short concept. Keep it tight.`,
};

function wireStudio() {
  const btn = byId("studio-task-pre-btn"); // reserved, unused
  $$(".studio-actions [data-task]").forEach((b) => {
    b.addEventListener("click", async () => {
      const topic = byId("studio-topic").value.trim();
      const kw = byId("studio-keyword").value.trim();
      const context = byId("studio-context").value.trim();
      const out = byId("studio-pre");
      const label = byId("studio-task-label");
      if (!topic) { out.textContent = "Give me a topic/idea first — even a rough one."; return; }
      $$(".studio-actions [data-task]").forEach((x) => (x.disabled = true));
      label.textContent = `Working — ${b.textContent.trim()}…`;
      out.textContent = "…";
      try {
        const userMsg = `Topic: ${topic}\n${kw ? `Keyword: ${kw}\n` : ""}${context ? `Context/notes:\n${context.slice(0, 3500)}\n` : ""}\nProduce it now.`;
        const text = await llm(TASK_PROMPTS[b.dataset.task] || TASK_PROMPTS.full, userMsg, 3600);
        out.textContent = text;
        label.textContent = b.textContent.trim();
      } catch (e) {
        out.textContent = `Error: ${e.message || e}`;
        label.textContent = "Failed";
      } finally {
        $$(".studio-actions [data-task]").forEach((x) => (x.disabled = false));
      }
    });
  });
  byId("studio-copy").addEventListener("click", () => navigator.clipboard.writeText(byId("studio-pre").textContent).catch(() => {}));
}

/* ---------- retention analyzer ---------- */
const RETENTION_SYSTEM = `
You read YouTube Studio audience-retention exports and report honestly. Rules:
- HOOK LEAK: retention at the end of the first 30 s as a fraction of peak. Below 25% is a leak; call it explicitly.
- CLIFFS: sudden >10 percentage-point drops between adjacent points. Name the timecode.
- SLIDE: sustained decline over 3+ consecutive points.
- Position units: % if no duration given; seconds when duration given. Never mix.
Label everything MEASURED / INFERRED / RECOMMENDATION. If the CSV is malformed or empty, say exactly that. Plain language. No fake numbers — if you can't measure it, say "INSUFFICIENT DATA".`;

function wireRetention() {
  byId("ret-analyze").addEventListener("click", async () => {
    const csv = byId("ret-csv").value.trim();
    const dur = byId("ret-duration").value.trim();
    const out = byId("ret-output");
    const btn = byId("ret-analyze");
    if (!csv) { out.classList.remove("hidden"); out.textContent = "Paste a retention CSV first — YouTube Studio → Analytics → Reach → audience retention → export (.csv)."; return; }
    btn.disabled = true;
    out.classList.remove("hidden");
    out.textContent = "Reading the curve…";
    try {
      const msg = `Duration: ${dur ? dur + "s" : "not provided — percentage positions"}\nRetention CSV (first 4000 chars):\n${csv.slice(0, 4000)}`;
      out.textContent = await llm(RETENTION_SYSTEM, msg, 3000);
    } catch (e) {
      out.textContent = `Error: ${e.message || e}`;
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- boot ---------- */
async function main() {
  wireTabs();
  wireStudio();
  wireRetention();
  const ok = await connect();
  byId("audit-run").addEventListener("click", () => runAudit(byId("audit-handle").value));
  byId("audit-handle").addEventListener("keydown", (e) => { if (e.key === "Enter") runAudit(byId("audit-handle").value); });
  $$(".chip[data-handle]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const input = byId("audit-handle");
      input.value = chip.dataset.handle;
      input.focus();
    });
  });
  await renderSavedList();
  if (anna && anna.window) {
    try { await anna.window.set_title({ title: "YouTube Skillbox" }); } catch (_) {}
    try { await anna.window.ready({}); } catch (_) {}
  }
  if (!ok) setStatus("Standalone preview — open via `anna-app dev` for the real host.", false, true);
}

main().catch((e) => setStatus(`Fatal: ${e.message || e}`, false));
