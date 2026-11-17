/* YouTube Skillbox — Anna App bundle
 * Static SPA. Talks to:
 *   • Host tools  → anna.tools.invoke({ tool_id, method, args })  (skillbox-core executa)
 *   • Host LLM    → anna.llm.complete({ messages, ... })          (free-form analysis)
 *   • Host storage→ anna.storage.set/get/list                     (saved audits)
 * Evidence labels: MEASURED = measured numbers, INFERRED = reasoned from measured, HYPOTHESIS = unvalidated.
 */

import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";
import { invokeAnnaTool } from "./anna-tool-runtime.mjs";

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
async function tool(method, args, timeoutMs, options = {}) {
  if (standalone || !anna) {
    throw new Error("Anna host is not connected. Open this app inside Anna AI OS to run live Skillbox tools; no sample measurements were substituted.");
  }

  const request = { tool_id: TOOL_ID, method, args: args || {} };
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) request.timeoutMs = timeoutMs;

  const res = await invokeAnnaTool(anna, request, options);

  if (res === undefined || res === null) throw new Error("tool returned no data");
  if (typeof res !== "object") return res;

  // The current SDK normally resolves the plugin payload directly. Accept
  // the explicit RPC envelope as well so older hosts fail transparently.
  if (res.ok === false) {
    const e = res.error;
    throw new Error(typeof e === "string" ? e : (e && (e.message || e.code)) || "Anna host request failed");
  }
  const payload = res.ok === true && "result" in res ? res.result : res;
  if (payload && typeof payload === "object") {
    if (payload.success === false || payload.error) {
      const e = payload.error;
      throw new Error(typeof e === "string" ? e : (e && (e.message || e.code)) || "Skillbox tool failed");
    }
    if (payload.success === true && "data" in payload) return payload.data;
  }
  return payload;
}

async function llm(systemPrompt, userMessage, maxTokens = 3200) {
  if (standalone || !anna) {
    throw new Error("Anna's hosted LLM is unavailable outside the Anna app runtime. No generated result was substituted.");
  }
  const r = await anna.llm.complete({
    messages: [{ role: "user", content: { type: "text", text: userMessage } }],
    systemPrompt,
    maxTokens,
    temperature: 0.35,
  });
  return (r && r.content && r.content.text) || String(r);
}

async function storageList(key) {
  if (anna && !standalone) {
    const response = await anna.storage.get({ key });
    const value = response && response.value;
    if (value == null) return [];
    // Older bundle versions stored JSON as a string; accept both that format
    // and native JSON values written by the current app.
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }
    return Array.isArray(value) ? value : [];
  }
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

async function storageSet(key, value) {
  if (anna && !standalone) {
    await anna.storage.set({ key, value });
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------- tabs ---------- */
function wireTabs() {
  const tabButtons = $$(".tab");
  function activateTab(btn, moveFocus = false) {
    tabButtons.forEach((item) => {
      const active = item === btn;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      const panel = byId("tab-" + item.dataset.tab);
      if (panel) panel.classList.toggle("is-active", active);
    });
    if (moveFocus) btn.focus();
    byId("app-main")?.scrollTo({ top: 0, behavior: "smooth" });
  }
  tabButtons.forEach((btn, index) => {
    btn.addEventListener("click", () => activateTab(btn));
    btn.addEventListener("keydown", (event) => {
      let next = null;
      if (event.key === "ArrowRight") next = tabButtons[(index + 1) % tabButtons.length];
      if (event.key === "ArrowLeft") next = tabButtons[(index - 1 + tabButtons.length) % tabButtons.length];
      if (event.key === "Home") next = tabButtons[0];
      if (event.key === "End") next = tabButtons[tabButtons.length - 1];
      if (next) {
        event.preventDefault();
        activateTab(next, true);
      }
    });
  });
}

/* ---------- audit pipeline ---------- */
const AUDIT_SYSTEM = `
You are the YouTube Skillbox analyst. You receive hard tool data (channel counts, subs, videos, outliers, keywords, scorecards) — never invent numbers.
ABSOLUTE RULES (not suggestions):
1. Any \`error\` key or empty array in evidence = that data does NOT exist. State it verbatim as "MEASURED: unavailable — <reason>"; NEVER fill it in.
2. If ALL core fields (subs, videos, outliers) are missing/empty, your ENTIRE verdict is exactly this sentence: "ENGINE BLOCKED: insufficient measured data from this host. No verdict will be invented." Nothing more.
3. If partial data exists, build verdict ONLY from it, label it clearly, and open with "PARTIAL AUDIT".
4. MEASURED/INFERRED/HYPOTHESIS tags mandatory, one per claim. Numbers must trace to evidence fields.

Write with a creator's directness: specific fixes, no filler, no "great job". Structure:
1) THE ONE-LINE VERDICT
2) MEASURED snapshot (only real numbers)
3) What's working (evidence)
4) The 3 highest-leverage fixes, one line each
5) What NOT to do, one line
6) Keyword angle if present, else "MEASURED: unavailable"

Max ~900 words. Markdown.`;

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

  const pctLabel = byId("audit-pct");
  const setStage = (pct, text) => {
    bar.style.width = pct + "%";
    stage.textContent = text;
    if (pctLabel) pctLabel.textContent = pct + "%";
    const progressBar = progress.querySelector('[role="progressbar"]');
    if (progressBar) progressBar.setAttribute("aria-valuenow", String(pct));
  };
  setStage(5, "Fetching channel snapshot…");

  const jobs = [
    { key: "snapshot", label: "snapshot", args: { handle }, timeoutMs: 85000 },
    { key: "latest", label: "latest uploads", args: { handle, limit: 8 }, timeoutMs: 85000 },
    { key: "outliers", label: "outliers", args: { handle, min_ratio: 2.0 }, timeoutMs: 180000 },
  ];

  const evidence = {};
  let okSteps = 0;
  let anyOk = false;
  const errors = {};
  for (const job of jobs) {
    setStage(15 + okSteps * 18, `Running ${job.label}…`);
    try {
      evidence[job.key] = await tool(job.key, job.args, job.timeoutMs, {
        onProgress: (event) => {
          const phase = event && typeof event.type === "string" ? event.type : "working";
          const detail = event && event.data && typeof event.data === "object"
            ? event.data.message || event.data.stage || event.data.phase
            : event && event.data;
          setStage(15 + okSteps * 18, `Running ${job.label} · ${String(detail || phase)}…`);
        }
      });
      anyOk = true;
    } catch (e) {
      const msg = String(e.message || e);
      evidence[job.key] = { error: msg };
      errors[job.label] = msg;
    }
    okSteps += 1;
  }

  const allFailed = jobs.every((j) => evidence[j.key] && evidence[j.key].error);

  if (allFailed) {
    setStage(100, "Engine blocked from this host.");
    rawPre.textContent = JSON.stringify({ evidence }, null, 2);
    rawBox.classList.remove("hidden");
    result.innerHTML = `<div class="card bigfix">
      <div class="label">ENGINE BLOCKED — nothing measured</div>
      <div class="audit-report" style="margin-top:8px">
        <strong>MEASURED:</strong> 0 of ${jobs.length} tool calls succeeded.<br><br>
        <strong>Errors:</strong><br>${Object.entries(errors).map(([k,v]) => `• <strong>${escapeHtml(k)}</strong> — ${escapeHtml(v.slice(0,300))}`).join("<br>")}<br><br>
        <strong>What to check:</strong> inspect the raw tool responses, confirm the Executa is available to this Anna host, and retry later if the provider rate-limited the request.<br><br>
        <strong>No verdict was generated.</strong> Missing measurements are never replaced with sample numbers.
      </div>
    </div>`;
    result.classList.remove("hidden");
    progress.classList.add("hidden");
    btn.disabled = false;
    return;
  }

  setStage(70, "Scoring keyword opportunity…");
  try {
    const seed = (() => {
      const d = evidence.snapshot && evidence.snapshot.profile && evidence.snapshot.profile.description;
      if (d) { const first = String(d).split(/[.\n]/)[0].trim(); if (first) return first.slice(0, 60); }
      return handle;
    })();
    evidence.keywords = await tool("keywords", { seed, limit: 12 }, 85000);
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
    const history = audits.slice(0, 5);
    // runtime_state is capped at 256 KB by Anna; keep margin for metadata
    // and UTF-8 encoding rather than allowing a silent oversize write.
    while (history.length > 1
      && new TextEncoder().encode(JSON.stringify(history)).byteLength > 180 * 1024) {
      history.pop();
    }
    if (new TextEncoder().encode(JSON.stringify(history)).byteLength > 180 * 1024) {
      throw new Error("This audit is too large to fit in the 256 KB Anna window-state store.");
    }
    await storageSet(AUDITS_KEY, history);
  } catch (storageError) {
    setStatus("Audit complete · saved-audit storage unavailable", true, true);
  }

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
  const latest = (ev.latest && (Array.isArray(ev.latest) ? ev.latest : (ev.latest.videos || ev.latest.items || []))) || [];
  const outliers = (ev.outliers && (Array.isArray(ev.outliers) ? ev.outliers : (ev.outliers.outliers || ev.outliers.videos || []))) || [];
  const kw = (ev.keywords && (Array.isArray(ev.keywords) ? ev.keywords : (ev.keywords.keywords || ev.keywords.ideas || []))) || [];

  const subs = prof.subscribers ?? sec.subs ?? "?";
  const videos = sec.videos ?? "?";
  const shorts = sec.shorts ?? "?";

  const outRows = outliers.slice(0, 6).map((v) =>
    `<tr><td>${escapeHtml(String(v.title || v.id || "").slice(0, 90))}</td><td>${escapeHtml(String(v.views ?? v.view_count ?? "?"))}</td><td>${escapeHtml(String(v.ratio ?? "—"))}</td></tr>`
  ).join("");

  const kwRows = kw.slice(0, 8).map((k) => {
    const oppRaw = k.opportunity_score ?? k.score;
    const compRaw = k.competition_score ?? k.competition;
    const opp = oppRaw == null || !isFinite(Number(oppRaw)) ? "—" : Number(oppRaw);
    const comp = compRaw == null || !isFinite(Number(compRaw)) ? "—" : Number(compRaw);
    const verdict2 = /^[A-Z]/.test(String(k.verdict || "")) ? String(k.verdict) : "—";
    return `<tr><td>${escapeHtml(String(k.keyword || k.seed || ""))}</td><td>${opp}</td><td>${comp}</td><td>${escapeHtml(verdict2)}</td></tr>`;
  }).join("");

  return `
  <div class="card">
    <h3>MEASURED — Channel snapshot <span class="ev ev-measured">MEASURED</span></h3>
    <div class="grid-2">
      <div class="stat"><div class="n">${escapeHtml(String(subs))}</div><div class="k">Subs</div></div>
      <div class="stat"><div class="n">${escapeHtml(String(videos))}<span style="color:var(--text-dim);font-size:15px"> / ${escapeHtml(String(shorts))}</span></div><div class="k">Long-form / Shorts</div></div>
    </div>
  </div>

  ${outliers.length ? `<div class="card"><h3>Outliers — what's breaking <span class="ev ev-measured">MEASURED</span></h3>
    <table class="tbl"><thead><tr><th>Video</th><th>Views</th><th>Views/Subs</th></tr></thead><tbody>${outRows}</tbody></table></div>` : ""}

  ${kwRows ? `<div class="card"><h3>Keyword angles <span class="ev ev-measured">MEASURED</span> · <span class="hint" style="margin:0">verdicts are INFERRED</span></h3>
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
  let audits = [];
  try {
    audits = await storageList(AUDITS_KEY);
  } catch (error) {
    list.innerHTML = '<li class="empty">Saved audits could not be loaded from Anna storage: '
      + escapeHtml(String(error.message || error)) + '</li>';
    setStatus("Anna storage unavailable", false, true);
    return;
  }
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

/* ---------- channel explorer ---------- */
function wireExplorer() {
  $$(".explorer-actions [data-explore]").forEach((button) => {
    button.addEventListener("click", () => runExplorer(button.dataset.explore));
  });
}

async function runExplorer(kind) {
  const handle = byId("audit-handle").value.trim();
  const output = byId("audit-explorer-result");
  const buttons = $$(".explorer-actions [data-explore]");
  if (!handle) {
    output.textContent = "Enter a channel handle above before browsing its public surfaces.";
    return;
  }

  const requests = {
    uploads: {
      label: "Recent channel uploads",
      method: "channel",
      args: { handle, limit: 20, tab: "videos", with_duration: true },
      timeout: 180000
    },
    shorts: {
      label: "Recent Shorts",
      method: "channel",
      args: { handle, limit: 20, tab: "shorts", with_duration: true },
      timeout: 180000
    },
    posts: {
      label: "Community posts",
      method: "posts",
      args: { handle, limit: 15 },
      timeout: 85000
    },
    home: {
      label: "Channel home shelves",
      method: "home",
      args: { handle, limit: 8, verbose: true },
      timeout: 85000
    },
    shows: {
      label: "Channel Shows",
      method: "shows",
      args: { handle, limit: 15 },
      timeout: 85000
    }
  };
  const request = requests[kind];
  if (!request) return;

  buttons.forEach((button) => (button.disabled = true));
  output.innerHTML = '<p class="hint">Fetching ' + escapeHtml(request.label.toLowerCase()) + '…</p>';
  try {
    const data = await tool(request.method, request.args, request.timeout, {
      onProgress: (event) => {
        const phase = event && typeof event.type === "string" ? event.type : "working";
        const detail = event && event.data && typeof event.data === "object"
          ? event.data.message || event.data.stage || event.data.phase
          : event && event.data;
        output.innerHTML = '<p class="hint">' + escapeHtml(request.label) + ' · '
          + escapeHtml(String(detail || phase)) + '…</p>';
      }
    });
    output.innerHTML = renderJsonLab(request.label + " · " + handle, data);
  } catch (error) {
    output.innerHTML = '<p class="hint">Channel research failed: '
      + escapeHtml(String(error.message || error)) + '</p>';
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

/* ---------- content studio ---------- */
// Formula classification and hook scoring are owned by the original Skillbox Python engine.
const TASK_PROMPTS = {
  hooks: "Generate exactly 21 distinct opening-hook options for the supplied idea. Return ONLY a valid JSON array of objects with keys hook, formula and rationale. Use the 21 Skillbox formula families where appropriate: The Statistic, Someone Else's Result, The Mistake, Contrarian Flip, The Reveal, The Superlative, The Clock, I Tried It, The Question, Before and After, The Teardown, The Stack, The Warning, The List, The Receipt, The Insider, The Impossible Claim, The Comparison, The Origin, The Deadline, The Direct Address. Each hook must be speakable, confirm the video's actual promise, open a genuine curiosity gap and avoid unsupported numbers, personal claims or fake evidence. Do not reuse examples verbatim. The app scores the copy with the deterministic Skillbox hookscore engine; do not invent scores.",
  script_hooks: "Generate exactly 5 distinct opening-hook candidates for the video idea. Return ONLY a valid JSON array of objects with keys hook, formula and rationale. Use different fits from the 21 Skillbox formula families. Follow the video's actual title promise, create a genuine curiosity gap and show that the payoff exists. Never invent a personal result, source, statistic or experience. The app will score all five with the original Skillbox hookscore engine; do not add scores.",
  script: "Write the full spoken script using the two top-ranked hook candidates supplied in the request. If a current title/click promise was supplied, the first 15 seconds must confirm that exact promise, open a question the viewer cannot close, and prove the payoff exists. If no title was supplied, establish one clear promise in the hook without pretending it is an existing title. The 0:15–0:45 turn explains what the video will do and starts doing it—no channel intro, 'before we get started' or subscribe pitch. Body: one idea per beat and add [ON SCREEN: ...] to every beat. Explicitly deliver the promised payoff. Close with one ask, not three. Estimate runtime at 150 spoken words per minute. Never invent facts, numbers, sources or personal experience; mark unsupported factual claims [SOURCE NEEDED]. If no creator voice sample was supplied, state that voice fit is not calibrated and use a natural, clear spoken voice.",
  titles: "Write exactly 5 distinct YouTube title options. Return ONLY a valid JSON array of strings. Keep each title under 100 characters, front-load the topic, avoid unsupported claims and do not overpromise. The app runs the deterministic Skillbox title linter; do not invent scores or CTR predictions.",
  seo: "Write a search-facing YouTube package using only supplied keyword research. Start with a description whose first two lines state the video promise in the target query's language, then add any supplied link/resource, chapters only when real timecodes exist, and a concise longer description. Provide 8–12 relevant tags (never more than 15); use tags for disambiguation, spelling variants and real topic terms, not unrelated reach bait. If no keyword research was supplied, say the query still needs measuring. Do not invent search volume, sources, results or ranking claims.",
  chapters: "Write YouTube chapters only from the timestamped transcript or timecoded outline supplied. The first entry must be 00:00; provide at least three chapters; every chapter must be at least 10 seconds apart. Give each chapter a clear three-to-five-word promise in natural creator voice, not a transcript topic dump. Never invent or interpolate timestamps. If there are not enough source timestamps for valid chapters, explain what is missing and ask for a timecoded transcript.",
  shorts: "Find up to 3 self-contained Shorts from the timestamped transcript. A candidate should run 20–55 seconds, open on a complete thought, contain a turn (claim then complication or proof), and end on a line rather than trail off. For each candidate provide source start/end timecodes, the original first line, a NEW context-free hook, on-screen text for the first two seconds (different wording from the spoken line), a loop point, vertical-crop framing note, and why it survives without the long video. If source timestamps are absent, do not invent them.",
  edit: "Create an edit decision list from the timestamped transcript. Identify candidate pauses from gaps between adjacent caption cues, filler phrases and repeated/restarted sentences. Cite the exact cue timecodes and source words for every recommendation. Caption gaps are candidate pauses, not proof of silence; label them for footage review. Do not claim to have inspected media or apply edits. If timestamps are missing, do not invent them.",
  comments: "Triage the supplied YouTube comments into four piles: QUESTIONS, CORRECTIONS, PRAISE and BAIT. State the count in each pile before drafting. Answer the actual question first; acknowledge praise briefly and specifically; check corrections against supplied evidence and mark unverified claims for creator review; do not reply to bait. Keep each drafted reply under 30 words, use no emoji unless the creator's supplied voice notes use them, and never promise a future video. Recommend ONE comment to pin and explain why. Drafts only; do not claim anything was posted or hearted.",
  plan: "Plan one realistic week, sized to the creator's real capacity. Before building the calendar, require two inputs: available hours this week and what content is already half-made. If either is missing, ask for it instead of inventing a schedule. When supplied, plan one anchor video, one low-effort post built from existing material, and up to three Shorts cut from the anchor—not seven uploads in seven days. Use the channel's own best day only if measured analytics were supplied; otherwise leave the day flexible. Return a table with day, format, working title, one-sentence promise, existing assets and estimated hours; state total hours and what to drop first if the week goes wrong.",
  thumbnail: "Create three distinct title/thumbnail pairing briefs for the supplied video. For each, specify the subject/expression, framing, foreground/background contrast, no more than three words of thumbnail text, and what the title should communicate that the thumbnail does not. Do not invent thumbnail text as though the creator already supplied it. These are untested creative hypotheses; thumbnail image pixels have not been evaluated and no CTR or performance prediction is allowed.",
  full: "Produce a practical creator pack: a concise script outline with a strong opening, title options, description and tags, chapters only when timestamps are supported by a transcript, and Shorts angles only when source content and timestamps are supplied. Separate measured facts, inference and creative hypotheses. No fake performance scores or CTR predictions."
};




function formatCueTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours
    ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0")
    : String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
}

function parseJsonArray(raw) {
  const text = String(raw || "").trim();
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : null;
  } catch (_) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    try {
      const value = JSON.parse(text.slice(start, end + 1));
      return Array.isArray(value) ? value : null;
    } catch (_) { return null; }
  }
}

function renderHookScores(result, generated) {
  const rows = (result && result.scored_hooks) || [];
  if (!rows.length) return "No hook scores were returned by the Skillbox engine.";
  const sourceByText = new Map((generated || []).map((item) => [
    typeof item === "string" ? item : String(item.hook || ""),
    item
  ]));
  const output = [
    "SKILLBOX HOOK SCORECARD",
    "Heuristic copy analysis only — not a retention, CTR or performance prediction.",
    String(rows.length) + " hooks scored.",
    ""
  ];
  rows.forEach((row, index) => {
    const source = sourceByText.get(row.hook) || {};
    const formula = row.formula ? " · " + row.formula : "";
    const properties = Object.entries(row.properties || {}).map(([key, value]) => key + " " + value).join(" · ");
    output.push(
      String(index + 1).padStart(2, "0") + "  " + row.score + "/100 · " + row.band + formula,
      "   " + row.hook,
      "   " + properties,
      "   Weakest: " + (row.weakest || "—") + " — " + (row.fix || "Review manually."),
      source.rationale ? "   Angle: " + source.rationale : ""
    );
  });
  return output.filter(Boolean).join("\n");
}

function renderTitleLint(result) {
  const rows = (result && result.titles) || [];
  if (!rows.length) return "No title lint results were returned by the Skillbox engine.";
  const output = [
    "SKILLBOX TITLE LINT",
    "Heuristic title-text checks — not CTR, ranking or view predictions.",
    ""
  ];
  rows.forEach((row, index) => {
    output.push(
      String(index + 1).padStart(2, "0") + "  " + row.heuristic_score + "/100 · " + row.characters + " characters",
      "   " + row.title
    );
    (row.issues || []).forEach((item) => output.push("   FIX · " + item.code + ": " + item.detail));
    (row.good || []).forEach((item) => output.push("   PASS · " + item));
    output.push("");
  });
  return output.join("\n");
}

function wireStudio() {
  $$(".studio-actions [data-task]").forEach((button) => {
    button.addEventListener("click", async () => {
      const topic = byId("studio-topic").value.trim();
      const keyword = byId("studio-keyword").value.trim();
      const workingTitle = byId("studio-title").value.trim();
      const thumbnailText = byId("studio-thumb").value.trim();
      const context = byId("studio-context").value.trim();
      const video = byId("lab-video").value.trim();
      const output = byId("studio-pre");
      const label = byId("studio-task-label");
      const task = button.dataset.task;

      if (task === "transcript" && !video) {
        output.textContent = "Add a video URL or ID in the Keyword Lab video field first.";
        return;
      }
      if (!["transcript", "comments", "plan"].includes(task) && !topic) {
        output.textContent = "Add a video idea first. A rough sentence is enough.";
        return;
      }
      if (["comments", "edit"].includes(task) && !context) {
        output.textContent = task === "comments"
          ? "Paste the comment thread into Context first."
          : "Fetch a transcript or paste one into Context before building an edit decision list.";
        return;
      }
      if (task === "plan" && !topic && !context) {
        output.textContent = "Add a channel direction or recent research in Context before planning.";
        return;
      }

      $$(".studio-actions [data-task]").forEach((item) => (item.disabled = true));
      label.textContent = "WORKING · " + button.textContent.trim();
      output.textContent = task === "transcript" ? "Fetching available captions…" : "Drafting…";
      try {
        if (task === "transcript") {
          const transcriptResult = await tool("transcribe", {
            video,
            language: byId("transcript-language").value || "auto"
          }, 85000);
          if (!transcriptResult || !transcriptResult.transcript) {
            throw new Error("No usable transcript text was returned for this video.");
          }
          const transcriptText = String(transcriptResult.transcript).trim();
          const segments = Array.isArray(transcriptResult.segments) ? transcriptResult.segments : [];
          const timestamped = segments.length
            ? segments.map((segment) => "[" + formatCueTime(segment.start) + "] " + segment.text).join("\n")
            : transcriptText;
          byId("studio-context").value = timestamped;
          output.textContent = "TRANSCRIPT FETCHED · " + (transcriptResult.title || video) + "\n"
            + "Channel: " + (transcriptResult.channel || "Not returned") + "\n"
            + "Language: " + (transcriptResult.language || "Not returned") + "\n"
            + "Caption cues: " + (transcriptResult.segment_count ?? segments.length) + "\n"
            + (segments.length
              ? "Real caption timecodes were preserved in the Context field."
              : "This track returned text without parseable cue timecodes; timestamp-dependent tasks must not invent them.") + "\n\n"
            + timestamped;
          label.textContent = "TRANSCRIPT · READY FOR CREATION";
          return;
        }

        const contextLimit = ["chapters", "shorts", "edit", "script", "full"].includes(task) ? 20000 : 8000;
        const userMessage = "Topic: " + topic + "\n"
          + (keyword ? "Target keyword: " + keyword + "\n" : "")
          + (workingTitle ? "Current title / click promise: " + workingTitle + "\n" : "")
          + (thumbnailText ? "Existing thumbnail text: " + thumbnailText + "\n" : "")
          + (context ? "Context and source notes:\n" + context.slice(0, contextLimit) + "\n" : "")
          + "\nCreate the requested asset now.";

        if (task === "script") {
          const hookResponse = await llm(TASK_PROMPTS.script_hooks, userMessage, 2200);
          const generatedHooks = parseJsonArray(hookResponse);
          const hookRows = (generatedHooks || []).map((item) => typeof item === "string" ? item : item && item.hook)
            .filter((item) => typeof item === "string" && item.trim());
          if (hookRows.length !== 5) {
            output.textContent = "SCRIPT NOT GENERATED · INCOMPLETE HOOK SET\nThe original Skillbox script workflow requires five hook candidates before scoring. Received "
              + hookRows.length + ".\n\nGenerated response:\n" + hookResponse;
            label.textContent = "SCRIPT STOPPED · " + hookRows.length + "/5 HOOKS";
            return;
          }
          const scoredHooks = await tool("hookscore", { hooks: hookRows });
          const topTwo = (scoredHooks.scored_hooks || []).slice(0, 2);
          if (topTwo.length !== 2) {
            throw new Error("Skillbox hookscore did not return two ranked candidates; the script was not drafted.");
          }
          const selected = topTwo.map((row, index) => (
            (index + 1) + ". " + row.hook + " | " + row.verdict + "/100 | " + row.formula
              + " | weakest: " + row.weakest + " — " + row.fix
          )).join("\n");
          const script = await llm(
            TASK_PROMPTS.script,
            userMessage + "\n\nTop two of five hooks, ranked by Skillbox's heuristic copy score (not a performance prediction):\n" + selected,
            4600
          );
          output.textContent = renderHookScores({ count: 2, scored_hooks: topTwo }, generatedHooks)
            + "\n\nFULL SCRIPT DRAFT\nVoice note: use the supplied style notes only; no creator voice sample was inferred.\n\n"
            + script;
          label.textContent = "SCRIPT · TOP 2 OF 5 HOOKS SCORED";
          return;
        }

        const maxTokens = task === "hooks" || task === "full" ? 4600 : 3000;
        const generated = await llm(TASK_PROMPTS[task] || TASK_PROMPTS.full, userMessage, maxTokens);
        if (task === "hooks") {
          const parsed = parseJsonArray(generated);
          const hooks = (parsed || []).map((item) => typeof item === "string" ? item : item && item.hook)
            .filter((item) => typeof item === "string" && item.trim());
          if (hooks.length !== 21) {
            output.textContent = "INCOMPLETE HOOK SET · SCORING NOT RUN\nExpected exactly 21 distinct hook options; received "
              + hooks.length + ". No partial set is presented as the promised 21.\n\nGenerated response:\n" + generated;
            label.textContent = "HOOK SET INCOMPLETE · " + hooks.length + "/21";
            return;
          }
          try {
            const scored = await tool("hookscore", { hooks });
            output.textContent = renderHookScores(scored, parsed);
            label.textContent = "HOOKS · " + (scored.count || hooks.length) + " SCORED";
          } catch (scoreError) {
            output.textContent = "HOOKS GENERATED · SCORING UNAVAILABLE\n" + (scoreError.message || scoreError) + "\n\nGenerated response:\n" + generated;
            label.textContent = "HOOKS GENERATED · SCORING FAILED";
          }
        } else if (task === "titles") {
          const parsed = parseJsonArray(generated);
          const titles = (parsed || []).map((item) => typeof item === "string" ? item : item && item.title)
            .filter((item) => typeof item === "string" && item.trim());
          if (titles.length !== 5) {
            output.textContent = "INCOMPLETE TITLE SET · LINT NOT RUN\nExpected exactly 5 title options; received "
              + titles.length + ". No partial set is presented as the promised five.\n\nGenerated response:\n" + generated;
            label.textContent = "TITLE SET INCOMPLETE · " + titles.length + "/5";
            return;
          }
          try {
            const linted = await tool("title_lint", {
              titles,
              thumbnail_text: thumbnailText || undefined
            });
            output.textContent = renderTitleLint(linted);
            label.textContent = "TITLES · " + (linted.count || titles.length) + " LINTED";
          } catch (lintError) {
            output.textContent = "TITLES GENERATED · LINT UNAVAILABLE\n" + (lintError.message || lintError) + "\n\nGenerated response:\n" + generated;
            label.textContent = "TITLES GENERATED · LINT FAILED";
          }
        } else {
          output.textContent = generated;
          label.textContent = button.textContent.trim();
        }
      } catch (error) {
        output.textContent = "Error: " + (error.message || error);
        label.textContent = "FAILED";
      } finally {
        $$(".studio-actions [data-task]").forEach((item) => (item.disabled = false));
      }
    });
  });
  byId("studio-copy").addEventListener("click", () => navigator.clipboard.writeText(byId("studio-pre").textContent).catch(() => {}));
}

/* ---------- keyword lab (Feature 1 — live research, no API key) ---------- */
const LAB_SYSTEM = `
You are the YouTube Skillbox research analyst. You receive MEASURED tool output (keyword opportunity scores, competition signals, SERP rows, content-gap lists, SEO checks) — never invent numbers.
Rules:
- Quote measured numbers exactly as given. Reasoning about them = INFERRED. What to do next = RECOMMENDATION.
- If a tool errored or returned empty, say exactly that — no substitute numbers.
- Structure: MEASURED (bullet facts from the evidence) → INFERRED (what it means for this seed) → RECOMMENDATION (one concrete next move, GO/MAYBE/SKIP if a verdict is present).
Plain language, tight, no filler.`;

function labSeed() {
  return byId("lab-seed").value.trim()
    || byId("studio-keyword").value.trim()
    || byId("studio-topic").value.trim();
}

function fmtViews(n) {
  const x = Number(n);
  if (!isFinite(x) || n === null || n === undefined) return "—";
  if (x >= 1e9) return (x / 1e9).toFixed(1) + "B";
  if (x >= 1e6) return (x / 1e6).toFixed(1) + "M";
  if (x >= 1e3) return (x / 1e3).toFixed(1) + "K";
  return String(Math.round(x));
}

function fmtLen(s) {
  if (s === null || s === undefined || s === "") return "—";
  const x = Math.round(Number(s));
  if (!isFinite(x)) return String(s); // already formatted (e.g. "8:02")
  if (x <= 0) return "—";
  const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), sec = x % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

function labTable(head, rows) {
  return `<table class="tbl"><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSearchLab(d) {
  const items = (d && (d.items || (Array.isArray(d) ? d : []))) || [];
  if (!items.length) return `<p class="hint">No results — YouTube returned nothing for that query.</p>`;
  const rows = items.slice(0, 10).map((v) => {
    const url = v.url || `https://www.youtube.com/watch?v=${v.id || ""}`;
    return `<tr><td><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(String(v.title || v.id || "?").slice(0, 80))}</a></td><td>${escapeHtml(String(v.channel || ""))}</td><td>${fmtViews(v.views ?? v.view_count)}</td><td>${fmtLen(v.duration ?? v.duration_string)}</td></tr>`;
  }).join("");
  return `<div class="lab-sec">Live SERP for this seed <span class="ev ev-measured">MEASURED</span></div>` + labTable(["Title", "Channel", "Views", "Len"], rows);
}

function renderIdeasLab(d) {
  const kws = (d && (d.keywords || d.ideas || d.items)) || [];
  if (!kws.length) return `<p class="hint">No keyword ideas returned.</p>`;
  const rows = kws.slice(0, 15).map((k) => {
    const flags = [k.year_trend ? "YEAR TREND" : "", k.question ? "QUESTION" : ""].filter(Boolean);
    const annotation = flags.length ? ` <span class="hint">${escapeHtml(flags.join(" · "))}</span>` : "";
    const score = k.opportunity_score ?? k.score;
    const scoreLabel = score == null || !isFinite(Number(score)) ? "—" : String(Number(score));
    return `<tr><td>${escapeHtml(String(k.keyword || ""))}${annotation}</td><td>${scoreLabel}</td></tr>`;
  }).join("");
  const meta = d.seed ? `<div class="hint" style="margin:0 0 6px">seed “${escapeHtml(d.seed)}” · ${escapeHtml(String(d.unique ?? kws.length))} unique from ${escapeHtml(String(d.queries ?? "?"))} queries · YEAR TREND / QUESTION labels where returned</div>` : "";
  return `<div class="lab-sec">Keyword ideas (suggest + DDG demand) <span class="ev ev-measured">MEASURED</span></div>${meta}` + labTable(["Keyword", "Opportunity"], rows);
}

function renderCompeteLab(d) {
  if (!d || d.score === undefined) return `<p class="hint">No competition data returned.</p>`;
  const sig = (d.signals || []).map((s) => `<tr><td>${escapeHtml(String(s.name || ""))}</td><td>${escapeHtml(String(s.weight ?? ""))}</td><td>${escapeHtml(String(s.value ?? ""))}</td><td>${escapeHtml(String(s.detail || "").slice(0, 90))}</td></tr>`).join("");
  // engine emits advice as a list of lines; render as a list, not a comma-joined string
  const advice = Array.isArray(d.advice)
    ? (d.advice.length ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:12.5px">${d.advice.map((a) => `<li>${escapeHtml(String(a))}</li>`).join("")}</ul>` : "")
    : (d.advice ? `<p style="margin:8px 0 0;font-size:12.5px">${escapeHtml(String(d.advice))}</p>` : "");
  const meta = [d.median_views != null ? `median views ${fmtViews(d.median_views)}` : null,
    d.floor_views != null ? `floor ${fmtViews(d.floor_views)}` : null,
    d.verified != null ? `${escapeHtml(String(d.verified))} verified` : null].filter(Boolean).join(" · ");
  return `
  <div class="lab-sec">Competition for “${escapeHtml(String(d.keyword || ""))}” <span class="ev ev-measured">MEASURED</span></div>
  <div class="stat" style="margin-bottom:8px"><div class="n">${escapeHtml(String(d.score))}<span style="font-size:13px;color:var(--text-dim)">/100 · ${escapeHtml(String(d.band || ""))} · top ${escapeHtml(String(d.scored ?? "?"))} scored</span></div><div class="k">${meta || "difficulty"}</div></div>
  ${sig ? labTable(["Signal", "Weight", "Value", "Detail"], sig) : ""}
  ${advice}`;
}

function renderVerdictLab(d) {
  if (!d || !d.verdict) return `<p class="hint">No verdict returned.</p>`;
  const v = String(d.verdict).toUpperCase();
  const cls = v === "GO" ? "green" : v === "SKIP" ? "red" : "";
  return `
  <div class="lab-sec">GO / MAYBE / SKIP <span class="ev ev-inferred">INFERRED</span> <span class="hint" style="text-transform:none;letter-spacing:0">from measured opportunity + competition</span></div>
  <div class="stat"><div class="n ${cls}">${escapeHtml(v)}</div><div class="k">opportunity ${escapeHtml(String(d.opportunity))}/100 · competition ${escapeHtml(String(d.competition))}/100</div></div>
  <p class="hint" style="margin:8px 0 0">${escapeHtml(String(d.label || ""))}</p>`;
}

function renderGapLab(d) {
  if (!d) return `<p class="hint">No gap data returned.</p>`;
  const them = (d.only_them || []).slice(0, 25);
  const mine = (d.only_me || []).slice(0, 15);
  const both = (d.both || []).slice(0, 15);
  const kwRow = (k) => typeof k === "string"
    ? `<tr><td>${escapeHtml(k)}</td><td>—</td></tr>`
    : `<tr><td>${escapeHtml(String(k.keyword || ""))}</td><td>${k.score == null ? "—" : Number(k.score)}${k.year_trend ? " · YEAR TREND" : ""}${k.question ? " · QUESTION" : ""}</td></tr>`;
  return `
  <div class="lab-sec">Content gap — “${escapeHtml(String(d.seed || ""))}” vs ${escapeHtml(String(d.competitor || ""))} <span class="ev ev-measured">MEASURED</span></div>
  <div class="lab-sec">They cover, you don't (${them.length})</div>
  ${them.length ? them.map((s) => `<span class="lab-chip">${escapeHtml(String(s))}</span>`).join("") : `<p class="hint" style="margin:0">none — you already cover their tags.</p>`}
  <div class="lab-sec">Only you (${mine.length})</div>
  ${mine.length ? labTable(["Keyword", "Score"], mine.map(kwRow).join("")) : `<p class="hint" style="margin:0">none.</p>`}
  <div class="lab-sec">Shared (${both.length})</div>
  ${both.length ? labTable(["Keyword", "Score"], both.map(kwRow).join("")) : `<p class="hint" style="margin:0">none.</p>`}`;
}

function renderScorecardLab(d) {
  if (!d || d.score === undefined) return `<p class="hint">No scorecard returned.</p>`;
  const rows = (d.checks || []).map((c) => `<tr><td>${c.pass ? "PASS" : "FAIL"}</td><td>${escapeHtml(String(c.name || ""))}</td><td>${escapeHtml(String(c.weight ?? ""))}</td><td>${escapeHtml(String(c.detail || "").slice(0, 110))}</td></tr>`).join("");
  return `
  <div class="lab-sec">SEO scorecard — ${escapeHtml(String(d.video_id || ""))}${d.target_keyword ? ` · target “${escapeHtml(String(d.target_keyword))}”` : ""} <span class="ev ev-measured">MEASURED</span></div>
  <div class="stat" style="margin-bottom:8px"><div class="n">${escapeHtml(String(d.score))}<span style="font-size:13px;color:var(--text-dim)">/100</span></div><div class="k">seo score</div></div>
  ${labTable(["", "Check", "W", "Detail"], rows)}`;
}

/* Opportunity for verdict = mean of the top-5 measured keyword scores, clamped to 0-100.
 * The aggregation step is INFERRED; every input is MEASURED by the keywords tool. */
function renderJsonLab(title, data) {
  return '<div class="lab-sec">' + escapeHtml(title)
    + ' <span class="ev ev-measured">MEASURED</span></div><pre class="output-pre">'
    + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
}

function opportunityFrom(kw) {
  const rows = (kw && (kw.keywords || kw.ideas || kw.items)) || [];
  const top = rows.slice(0, 5)
    .map((row) => row && (row.opportunity_score ?? row.score))
    .filter((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)))
    .map(Number);
  if (!top.length) return null;
  return Math.max(0, Math.min(100, Math.round(top.reduce((a, b) => a + b, 0) / top.length)));
}

async function runLab(kind) {
  const out = byId("lab-result");
  const label = byId("lab-label");
  const seed = labSeed();
  const competitor = byId("lab-competitor").value.trim();
  const video = byId("lab-video").value.trim();
  const playlist = byId("lab-playlist").value.trim();
  const gl = byId("lab-region").value || "IN";
  const hl = byId("lab-language").value || "en";
  const T = kind === "outliers" ? 180000 : 85000;

  const need = (condition, message) => {
    if (condition) return true;
    out.innerHTML = '<p class="hint">' + escapeHtml(message) + '</p>';
    label.textContent = "MISSING INPUT";
    return false;
  };
  if (["search", "ideas", "compete", "verdict", "chain", "trends", "track"].includes(kind)
      && !need(seed, "Enter a research seed or video idea first.")) return;
  if (kind === "gap" && !need(seed && competitor, "Content gap needs a seed and competitor channel (for example, @channel).")) return;
  if (kind === "outliers" && !need(competitor, "Competitor outliers needs a channel handle in the Competitor field.")) return;
  if (["info", "scorecard"].includes(kind) && !need(video, "This task needs a video URL or 11-character video ID.")) return;
  if (kind === "playlist" && !need(playlist, "Playlist contents needs a YouTube playlist URL or ID.")) return;
  if (kind === "track" && !need(video, "Rank tracking needs the video URL or ID to track.")) return;

  $$(".lab-actions [data-lab]").forEach((button) => (button.disabled = true));
  out.innerHTML = '<p class="hint">Running ' + escapeHtml(kind) + ' research…</p>';
  const step = (message) => { label.textContent = message; };

  try {
    let html = "";
    if (kind === "search") {
      step("SEARCHING LIVE YOUTUBE RESULTS…");
      html = renderSearchLab(await tool("search", { query: seed, limit: 10, gl, hl }, T));
    } else if (kind === "ideas") {
      step("EXPANDING KEYWORD IDEAS…");
      html = renderIdeasLab(await tool("keywords", { seed, limit: 20, gl, hl }, T));
    } else if (kind === "compete") {
      step("SCORING COMPETITION…");
      html = renderCompeteLab(await tool("compete", { query: seed, gl, hl }, T));
    } else if (kind === "verdict") {
      step("MEASURING KEYWORD OPPORTUNITY…");
      const keywords = await tool("keywords", { seed, limit: 12, gl, hl }, T);
      const opportunity = opportunityFrom(keywords);
      if (opportunity === null) throw new Error("Keyword research returned no measurable opportunity scores; no verdict can be calculated.");
      step("MEASURING COMPETITION…");
      const competitionData = await tool("compete", { query: seed, gl, hl }, T);
      const competition = Number(competitionData && competitionData.score);
      if (!isFinite(competition)) throw new Error("Competition tool returned no difficulty score.");
      step("COMPUTING THE VERDICT…");
      html = renderVerdictLab(await tool("verdict", { opportunity, competition }, T));
    } else if (kind === "gap") {
      step("COMPARING CHANNEL KEYWORD SETS…");
      html = renderGapLab(await tool("gap", { seed, competitor }, T));
    } else if (kind === "outliers") {
      step("SCANNING COMPETITOR UPLOADS FOR OUTLIERS…");
      html = renderJsonLab("Competitor outliers · " + competitor, await tool("outliers", { handle: competitor, min_ratio: 2.0 }, T, {
        onProgress: (event) => {
          const phase = event && typeof event.type === "string" ? event.type : "working";
          const detail = event && event.data && typeof event.data === "object"
            ? event.data.message || event.data.stage || event.data.phase
            : event && event.data;
          step("SCANNING COMPETITOR UPLOADS · " + String(detail || phase).toUpperCase() + "…");
        }
      }));
    } else if (kind === "info") {
      step("FETCHING VIDEO METADATA…");
      html = renderJsonLab("Video metadata", await tool("info", { video }, T));
    } else if (kind === "playlist") {
      step("FETCHING PLAYLIST CONTENTS…");
      html = renderJsonLab("Playlist contents", await tool("playlist", { playlist, limit: 30 }, T));
    } else if (kind === "scorecard") {
      step("FETCHING VIDEO METADATA…");
      html = renderScorecardLab(await tool("scorecard", { video, keyword: seed }, T));
    } else if (kind === "track") {
      step("CHECKING VIDEO POSITION IN SEARCH…");
      html = renderJsonLab("Keyword rank tracking", await tool("track", { query: seed, video, gl, hl }, T));
    } else if (kind === "trends") {
      step("READING SAVED KEYWORD HISTORY…");
      html = renderJsonLab("Historical keyword trend", await tool("trends", { seed }, T));
    } else if (kind === "chain") {
      html = await runChain({ seed, competitor, video, gl, hl }, step, T);
    }
    out.innerHTML = html;
    label.textContent = kind === "chain" ? "RESEARCH CHAIN COMPLETE" : "DONE · " + kind.toUpperCase();
  } catch (error) {
    out.innerHTML = '<p class="hint">Research failed: ' + escapeHtml(String(error.message || error)) + '</p>';
    label.textContent = "RESEARCH FAILED";
  } finally {
    $$(".lab-actions [data-lab]").forEach((button) => (button.disabled = false));
  }
}

async function runChain({ seed, competitor, video, gl, hl }, step, T) {
  const evidence = {};
  const errors = {};
  const grab = async (key, message, callback) => {
    step(message);
    try { evidence[key] = await callback(); }
    catch (error) { evidence[key] = null; errors[key] = String(error.message || error); }
  };

  await grab("keywords", "1/5 · keyword opportunities…", () => tool("keywords", { seed, limit: 15, gl, hl }, T));
  const opportunity = opportunityFrom(evidence.keywords);
  await grab("compete", "2/5 · competition difficulty…", () => tool("compete", { query: seed, gl, hl }, T));
  const competition = evidence.compete && evidence.compete.score !== undefined && evidence.compete.score !== null
    ? Number(evidence.compete.score) : NaN;

  if (opportunity !== null && isFinite(competition)) {
    await grab("verdict", "3/5 · GO / MAYBE / SKIP…", () => tool("verdict", { opportunity, competition }, T));
  } else {
    errors.verdict = "skipped because measured opportunity or competition data was missing";
  }

  if (competitor) await grab("gap", "4/5 · content gap vs competitor…", () => tool("gap", { seed, competitor }, T));
  else step("4/5 · no competitor supplied — content gap skipped…");
  if (video) await grab("scorecard", "4/5 · SEO scorecard…", () => tool("scorecard", { video, keyword: seed }, T));
  await grab("search", "5/5 · live search results…", () => tool("search", { query: seed, limit: 6, gl, hl }, T));

  const parts = [];
  if (evidence.verdict) parts.push(renderVerdictLab(evidence.verdict));
  if (evidence.keywords) parts.push(renderIdeasLab(evidence.keywords));
  if (evidence.compete) parts.push(renderCompeteLab(evidence.compete));
  if (evidence.gap) parts.push(renderGapLab(evidence.gap));
  if (evidence.scorecard) parts.push(renderScorecardLab(evidence.scorecard));
  if (evidence.search) parts.push(renderSearchLab(evidence.search));

  step("SYNTHESIZING FROM MEASURED EVIDENCE…");
  const evidenceJson = JSON.stringify(evidence, null, 0).slice(0, 14000);
  let interpretation = "";
  try {
    interpretation = await llm(LAB_SYSTEM, "Seed: " + seed + "\nRegion: " + gl + "\nLanguage: " + hl + "\n"
      + (competitor ? "Competitor: " + competitor + "\n" : "")
      + (video ? "Video: " + video + "\n" : "")
      + "Evidence JSON:\n" + evidenceJson + "\n\nWrite the research read.", 2600);
  } catch (error) {
    interpretation = "Host LLM unavailable: " + (error.message || error) + ". Raw measured evidence is shown above.";
  }
  const errorNote = Object.keys(errors).length
    ? '<p class="hint" style="margin-top:8px">NOT MEASURED: '
      + escapeHtml(Object.entries(errors).map(([key, value]) => key + " (" + value + ")").join(" · ")) + '</p>'
    : "";
  return parts.join("") + errorNote + '<div class="card bigfix" style="margin-top:10px">'
    + '<div class="label">RESEARCH READ · HOST LLM OVER MEASURED EVIDENCE</div>'
    + '<div class="audit-report" style="margin-top:8px">' + renderMd(interpretation) + '</div></div>';
}

function wireLab() {
  $$(".lab-actions [data-lab]").forEach((b) => {
    b.addEventListener("click", () => runLab(b.dataset.lab));
  });
  byId("lab-copy").addEventListener("click", () => navigator.clipboard.writeText(byId("lab-result").innerText).catch(() => {}));
}

/* ---------- retention analyzer ---------- */
const RETENTION_SYSTEM = [
  "You are the YouTube Skillbox retention interpreter. The deterministic Skillbox engine has already parsed the CSV and calculated the findings.",
  "Do not recalculate, alter or add measurements. Quote only values present in the supplied JSON.",
  "Explain the hook-leak window and severity only when the engine returned them.",
  "Explain cliffs using their exact before/after positions and percentage-point drops.",
  "If the slide rate is unavailable, say it is unavailable; never manufacture seconds from a percentage-only axis.",
  "A pasted CSV does not preserve the original export filename. Do not claim absolute-versus-relative retention unless the evidence establishes it.",
  "Give at most one concrete recommendation, tied to a measured finding. If no issue was found, say so rather than forcing a fix.",
  "Label findings MEASURED and interpretation INFERRED; label the next action RECOMMENDATION. Plain language, no performance promises."
].join("\n");
function wireRetention() {
  byId("ret-analyze").addEventListener("click", async () => {
    const csvText = byId("ret-csv").value.trim();
    const duration = byId("ret-duration").value.trim();
    const output = byId("ret-output");
    const button = byId("ret-analyze");
    if (!csvText) {
      output.classList.remove("hidden");
      output.textContent = "Paste a YouTube Studio audience-retention CSV first.";
      return;
    }
    button.disabled = true;
    output.classList.remove("hidden");
    output.textContent = "Parsing the CSV with the Skillbox retention engine…";
    try {
      const findings = await tool("retention", { csv: csvText, duration: duration || undefined });
      if (!findings || findings.error) {
        const detail = findings && findings.error ? findings.error : "The retention engine returned no findings.";
        const columns = findings && findings.columns ? "\nColumns found: " + findings.columns.join(", ") : "";
        throw new Error(detail + columns);
      }
      const measured = JSON.stringify(findings, null, 2);
      let recommendation = "No AI recommendation generated. The measured findings are shown above.";
      try {
        recommendation = await llm(
          RETENTION_SYSTEM,
          "Measured retention analysis (do not recalculate):\n" + measured + "\n\nExplain the findings and give no more than one evidence-linked recommendation.",
          1800
        );
      } catch (llmError) {
        recommendation = "Host LLM unavailable: " + (llmError.message || llmError)
          + ". Use the measured findings above; no recommendation was fabricated.";
      }
      output.textContent = "MEASURED FINDINGS · SKILLBOX ENGINE\n" + measured
        + "\n\nINFERRED READ + RECOMMENDATION · ANNA HOST LLM\n" + recommendation;
    } catch (error) {
      output.textContent = "RETENTION ANALYSIS FAILED\n" + (error.message || error);
    } finally {
      button.disabled = false;
    }
  });
}

/* ---------- boot ---------- */
async function main() {
  wireTabs();
  wireExplorer();
  wireStudio();
  wireLab();
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
    // AnnaAppRuntime.connect() already emits window.ready after the handshake.
  }
  if (!ok) setStatus("Standalone preview — open via `anna-app dev` for the real host.", false, true);
}

main().catch((e) => setStatus(`Fatal: ${e.message || e}`, false));
