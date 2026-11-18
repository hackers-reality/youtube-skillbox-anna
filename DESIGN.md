# YouTube Skillbox — Anna App · DESIGN.md

**Direction:** Premium dark studio. Warm near-black surfaces, layered glass elevation,
1px inner highlights, deep soft shadows. One restrained editorial red (#ff4d4d ≤10% of
canvas). System type, tabular numerals, 8px grid. Zero emoji. Zero lorem. Zero invented
metrics. Every claim labelled MEASURED / INFERRED / HYPOTHESIS.

---

## Token table

| Token | Value | Use |
|---|---|---|
| --bg | #0a0c12 | body / app background |
| --bg-2 | #0e1117 | surface lift |
| --panel | #131720 | cards / input card / raw box |
| --panel-2 | #181d28 | stat tiles / textarea / inputs |
| --panel-3 | #1f2531 | progress bar track / lab chips |
| --elevated | #202736 | input focus background |
| --border | rgba(255,255,255,0.08) | input borders / table rules |
| --border-soft | rgba(255,255,255,0.05) | topbar / tabs / card borders |
| --border-strong | rgba(255,255,255,0.14) | hover borders / dashed empty states |
| --text | #f4f6fb | body copy |
| --text-2 | #b9c0d4 | secondary copy |
| --text-dim | #8a92a8 | labels / captions |
| --text-faint | #5e667c | placeholders / faint meta |
| --red | #ff4d4d | editorial accent (≤10% canvas) |
| --red-deep | #e03d33 | red text / borders |
| --red-soft | rgba(255,77,77,0.10) | red chip bg |
| --red-glow | rgba(255,77,77,0.20) | active-tab underline glow |
| --green-deep | #22c55e | MEASURED chip / stat text |
| --green-soft | rgba(34,197,94,0.10) | MEASURED chip bg |
| --blue-deep | #3b82f6 | INFERRED chip / stat text |
| --blue-soft | rgba(110,168,254,0.10) | INFERRED chip bg |
| --amber-deep | #f59e0b | HYPOTHESIS chip / call chips |
| --amber-soft | rgba(251,191,36,0.10) | HYPOTHESIS chip bg |
| --grad | 135deg #ff5f5f→#e03d33→#c22118 | primary CTA gradient |
| --grad-focus | 0 0 0 3px rgba(255,77,77,0.16) | focus ring |
| --shadow-1 | 0 1px 2px / 0 8px 24px | panel elevation |
| --shadow-2 | 0 1px 2px / 0 20px 52px | modal-depth elevation |
| --shadow-glow | 0 8px 32px rgba(255,77,77,0.22) | primary CTA glow |
| --shadow-inner | inset 0 1px 0 rgba(255,255,255,0.06) | active tab inner highlight |
| --radius-s | 10px | inputs / chips / small cards |
| --radius | 14px | default cards / panels |
| --radius-l | 18px | input card / result cards |
| --radius-pill | 999px | pills / verdict chips |
| --ease | cubic-bezier(.32,.72,.24,1) | all transitions |
| --dur | 180ms | transition duration |
| --font | Inter / SF / Segoe / system-ui | body + display |
| --mono | Cascadia Code / SFMono / JetBrains / Consolas | engine data / debug |

Spacing: 8px grid. Radii: 10/14/18. Motion: 160–240ms `cubic-bezier(.32,.72,.24,1)`; hover-lifts 1–2px; `prefers-reduced-motion` zeroes all animation/transition.

---

## File map

| File | Purpose |
|---|---|
| `bundle/index.html` | Semantic shell; all original ids preserved; repo link added to topbar right pill |
| `bundle/style.css` | Token-based design system; every original class name retained |
| `bundle/app.js` | Rendering-side only; `anna.tools.invoke` / `anna.llm.complete` / `anna.storage.*` untouched |
| `bundle/anna-tool-ids.js` | Auto-generated tool-id map (untouched) |
| `DESIGN.md` | This document |

---

## Id map (original → current)

All ids preserved unchanged (no map needed):

- `audit-handle`, `audit-run`, `audit-progress`, `audit-stage`, `audit-bar`, `audit-raw`, `audit-raw-pre`, `audit-result`
- `saved-count`, `saved-list`
- `studio-topic`, `studio-keyword`, `studio-context`, `studio-pre`, `studio-task-label`, `studio-copy`
- `lab-competitor`, `lab-video`, `lab-result`, `lab-label`, `lab-copy`
- `ret-csv`, `ret-duration`, `ret-analyze`, `ret-output`
- `status-dot`, `status-text`
- Tabs: `tab-audit`, `tab-studio`, `tab-retention` (panels) + `.tab[data-tab=*]`
- SDK entry: `/static/anna-apps/_sdk/latest/index.js` (untouched)

Functional deltas in `app.js` (rendering-only; plumbing untouched):

1. `demoPayload()` — replaced invented demo metrics with the real `@Moments_Unscriptedorignal` sample data set (131 subs, 2 long-form + 16 Shorts, outliers 8400/64.12×, 1000/7.63×, 996/7.6×; keyword `space facts for kids` opp 100/comp 25 → GO; scorecard 56/100 with failing checks `title_length`, `title_kw`, `tags_kw`). No emoji, no lorem, no invented numbers.
2. `demoLLM()` — rewritten to reference real measured numbers.
3. `setStatus(text, kind)` — signature changed from `(text, ok, warn)` to `(text, kind)` where `kind ∈ {connected, connecting, standalone, error}` so the statusbar dot shows Connected (green) / Connecting (amber) / Standalone (amber) / Error (red). All call sites updated.
4. `runAudit()` — added scorecard fetch for the top outlier video (`anna.tools.invoke("scorecard", ...)`), stage label updated; all existing tool calls (`snapshot`, `latest`, `outliers`, `keywords`) and plumbing unchanged.
5. `renderAuditCards()` — outliers table now shows rank (#), linked title, views, ratio bar (width mapped to real ratio), source tab; keyword table adds styled GO/MAYBE/SKIP call chips; new prominent SEO scorecard card (big-type score /100, failing-check rows highlighted, target keyword). All MEASURED / INFERRED / HYPOTHESIS chips retained and semantically correct.
6. Removed unused `latest` variable (dead code only).

---

## Component / state inventory

1. **Top bar** — brand mark (inline SVG), wordmark, "ANNA LIVE" pill, repo·MIT pill, 1px divider. Statusbar (footer) dot: Connected / Connecting / Standalone; repo + MIT note.
2. **Tab system** — Audit / Content Studio / Retention Fix; icons + text; sticky; active state with red underline glow; keyboard focusable (native `<button role="tab">`); visible focus ring.
3. **Audit hero** — handle field with @ addon + Run CTA; quick-fill chips (@Moments_Unscriptedorignal, @MrBeast, @MKBHD); hint line about 429 throttling.
4. **Progress state** — stage label (mono), real % bar mapping to stages (snapshot → latest → outliers → keywords → scorecard → LLM verdict), spinner badge "WORKING".
5. **Raw-debug expander** — styled `<details>` labelled "debug", monospace engine output.
6. **Result cards** — snapshot stat tiles (subs; long/short split with tabular numerals), outliers table (rank + ratio bars), keyword angles (opp/comp/call), verdict block (big-type /100 + failing checks), saved audits grid + empty state.
7. **Content Studio** — grouped clusters (Write pack / Keyword Lab), one primary CTA each (Full pack / Full research chain); side-by-side outputs on wide, stacked on narrow; copy buttons; state-aware (disabled while working, hint when missing input).
8. **Retention Fix** — CSV textarea left, "three failure modes" spec right (hook leak <25% @30s · cliff >10pt · slide 3+), duration hint, analyze CTA.
9. **Statusbar** — host dot (Connected/Connecting/Standalone), repo/MIT note, no-license banner (MIT).

---

## What's deliberately NOT in the UI

- No CTR predictions, no "rank #1" claims, no fake testimonials, no invented view counts (truth serum).
- No emoji anywhere.
- No lorem ipsum anywhere.
- No decorative motion (no animated orbs, no floating elements); the only motion is the progress bar (real stages) and the working spinner.
- No thumbnail generation/evaluation (engine does not supply thumbnails).
- No search-console / Studio CTR & impressions (not exportable via tools).
- No retention analysis for videos other than the top outlier (single video scope).
- No mobile-specific bundle; single responsive entry (manifest does not declare mobile form factor).

---

## Accessibility

- Visible focus rings (`:focus-visible` 2px red, offset 2px).
- AA contrast: text #f4f6fb on #0a0c12 (~16:1); secondary #b9c0d4 (~11:1); captions #8a92a8 on panel (~5.4:1).
- Keyboard navigable: native buttons/inputs/links; `<details>` summary focusable.
- `prefers-reduced-motion: reduce` zeroes all animation/transition durations.
- `<button role="tab" aria-selected>` + `aria-label` on tablist; inputs have associated labels / aria-label.

---

## Sample data used (the one set — no invention)

Channel `@Moments_Unscriptedorignal` ("Unscripted Moments"): 131 subs, 18 uploads (2 long-form + 16 Shorts).

Top outlier: "Why Earth’s Spin is Crucial For Our Survival…" — 8,400 views, 64.12× subs ratio.
Next: "The Billion-Year Time Capsule on the Moon…" — 1,000 views, 7.63×.
Third: "Why Alaska's Flight Paths Are So Weird" — 996 views, 7.6×.

Keyword `space facts for kids`: opportunity 100 / competition 25 → GO.

Scorecard on outlier video `9NDb3RH9N7M`: 56/100. Failing checks: `title_length` (>60 chars), `title_kw` (target keyword missing), `tags_kw` (keyword not in tags).

---

## Acceptance notes

- Loads at `http://localhost:5180/` via harness iframe at `/anna-apps/youtube-skillbox-anna/dev/index.html`.
- 60-second demo path legible at 720×480, zero horizontal scroll (`overflow-x: hidden` on body; max-width 1200px centered main; responsive overrides at 1024/900px).
- Contrast ≥ AA; focus rings visible; reduced-motion honored.
