# YouTube Skillbox / Anna continuation guide

## Mission

Continue the Anna App redesign in `E:\youtube-skillbox-anna` on branch `feat/anna-skillbox-studio-redesign`. This is the canonical working copy. `E:\youtube-skillbox` is reference-only. Do not work from C:, do not recreate a second clone, and do not merge or push `main` until the complete UI, runtime, tests, and CI gates are green.

## Current product direction

YouTube Skillbox is a free, evidence-first creator workspace inside Anna AI OS. Preserve the warm dark/red visual language from `bundle/style.css`, but move toward a ChatGPT-like left rail with rounded cards, a chat-first Ask Anna workflow, creator profile context, shimmer loading states, light/dark/system themes, and visual data views instead of raw JSON.

The app must distinguish:

- MEASURED: returned by the Python Skillbox engine or public YouTube data.
- INFERRED: reasoning from measured evidence or the Anna host LLM.
- HYPOTHESIS / RECOMMENDATION: creative advice that is not a performance guarantee.

Never invent unavailable counts, rankings, retention values, CTR, or causal explanations.

## Implemented in the current worktree

- `$(...).forEach` frontend crash fixed: `$()` is for one node and `$$()` is for collections.
- Anna long-running invocation boundary is in `bundle/anna-tool-runtime.mjs`; calls over the 90-second synchronous limit put `timeoutMs` on the async job request and also set the separate `invokeAsyncAwait` client wait to the requested job budget plus 30 seconds. This avoids a skewed host deadline collapsing the client wait to its 30-second grace. Regression coverage is in `bundle/anna-tool-runtime.test.mjs`; live MrBeast audit confirmed all 4 core measurements completed with no unavailable results.
- Python Executa bridge is clean after removing the corrupted `executas/youtube-skillbox/uv.lock`; always use the explicit `--executa dir=E:\youtube-skillbox-anna\executas\youtube-skillbox` dev command.
- Retention engine and tests are working.
- New `profile` Executa method fetches public channel identity and accepts a channel ID (`UC...`) as well as a handle/URL.
- Audit flow now uses the fast `profile` call instead of the slow composite `snapshot` call, which was the main source of recurring partial audits.
- Explorer rendering work replaces raw JSON with upload cards, community-post cards, home-shelf rows, and Show cards.
- Current redesign work adds Ask Anna chat with image/CSV/ZIP attachments, metric-aware analysis for every CSV in a YouTube Studio ZIP, channel workspace/profile verification, theme cycling, session-cache clearing, smooth SVG retention graphs, retention finding-card carousel, and shimmer states.
- The latest pass restores `avatar_url` from the source engine and public YouTube page metadata; `renderShelves` now renders each home section as a separate horizontal YouTube-style shelf, with loaded landscape video and portrait Shorts thumbnails. The live profile logo was verified in the sidebar and onboarding/profile data was preserved.
- The home bridge now fills missing logos for up to 15 featured-channel shelf items from their public channel pages (bounded parallel fetches); the result is shared by explorer and chat. A live source-bridge call against the saved Unscripted Moments channel returned image URLs for both featured channels. If YouTube omits or blocks public image metadata, the UI still uses its initials fallback.
- Retention ZIP history renders one animated stacked card at a time with previous/next controls and a concise Anna interpretation per curve. Summary display is capped at 35 words; CSV files with different measurement types remain separate cards.
- The retention deck follows `E:\downloads\retention-deck.html`: wide, tall cards, percentage charts with the same fixed 0/25/50/75/100 x-axis, percent grid/ticks, 100% guide, endpoint labels, hover crosshair/readout, and stacked perspective. Next/back use the reference's staged Web Animations lift → clear → depth → settle sequence in both directions (1.2s), with matching CSS-keyframe fallback for embedded browsers that lack the Web Animations API. To match the supplied reference and the user's explicit preference, shuffles now animate by default even when the OS requests reduced motion; the visible in-deck control can switch to instant shuffles for that session. A reduced-motion-specific CSS fallback override is covered by the frontend regression test, because the global OS reset otherwise suppresses CSS-only animations in embedded browsers. Graph points are parsed from each uploaded CSV/ZIP at runtime (not replaced by embedded demo constants), so the view is not tied to the sample channel/video. Audience segments from one CSV are plotted together; comparison remains a separate benchmark card; detailed activity gets its own views-seen and stop-count chart. Empty ad exports remain explicitly identified. The supplied ZIP and reference HTML data were compared: all overall, segment, benchmark, and activity arrays match exactly. Blank CSV cells are excluded from numeric counts.
- The latest motion pass adds the reference-style staggered card entrance on first render, including a single-card deck; the existing next/back shuffle remains available afterward. Transition durations are applied inline with `!important` so the global reduced-motion reset cannot silently suppress the enabled entrance. The live Anna dev host on port 5181 serves `bundle/app.js` and `bundle/style.css` byte-for-byte from this worktree, but the user's already-open tab needs a refresh to load edits because the host was started with `--no-watch`.
- The outgoing retention card no longer has a permanently elevated `z-index`: forward shuffle lifts it completely, then drops it behind the stack at 43% of the motion; reverse shuffle raises the returning card over the stack at 59%. Regression assertions cover both the Web Animations keyframes and CSS-only fallback.
- Retention cards now grow when the Anna-read text plus metric row would overflow; the graph height is held steady during that expansion so the text fits without being pushed back down or clipped. Audit keyword collection now requests only its seed across the two providers, avoiding the engine's 26-letter suffix sweep and 90-second timeout risk; direct/deep keyword research keeps the full expansion unless callers opt into a bounded query.
- Development Python bridge now prioritizes `executas/youtube-skillbox/engine/ytdata.py` beside the plugin, rather than accidentally using an older installed engine. `executa.json` is restored to `active: binary` for release. The current running local harness was started while `active: local` was selected and remains live on port 5181; restart it only if needed, and preserve APS data.
- `fetchProfile` now rejects empty/raw tool responses before writing profile storage. A previous stale-binary response briefly returned an empty result; the checked-out engine was loaded, and the original verified profile/phrase/description were restored from the saved APS state. Do not clear or replace that profile; no YouTube description was edited.
- In-app chat tool routing is split into the pure `bundle/chat-routing.mjs` planner and the app transport. Performance questions request recent uploads/outliers; community, home-shelf, and show questions request only their matching method; topic research requests keywords/search and competition only when asked. Retention CSV/ZIP attachments avoid redundant live upload/outlier calls. Frontend regression tests cover these route selections.
- A standalone Anna Skill draft now lives at `executas/youtube-skillbox-skill/` for regular Anna conversations outside the app. It teaches the evidence-first workflow and calls out the boundary between the declarative Skill and the separate Engine Executa. `anna-app executa publish --cwd E:\youtube-skillbox-anna\executas\youtube-skillbox-skill --dry-run` validates the Skill payload; it has not been published, so it is not yet discoverable by Anna users. The Engine tool must also be separately available to the Anna session for live method calls.

## Honest Anna capability boundary

The frontend can call `anna.llm.complete`, `anna.tools.invoke`, storage, and the bundled Executa. The outside Anna chat does not automatically discover arbitrary frontend controls; the app must explicitly orchestrate tool calls and pass evidence into the LLM. Public channel verification is intentionally manual: the app generates a random read-only phrase, the creator copies it into the description themselves, then this app re-fetches public data and checks that exact phrase. No YouTube OAuth/write access is needed or requested by this flow.

- The in-app chat has explicit, app-owned tool routing: thumbnail review calls channel/outlier tools, fetches thumbnail images into browser storage, and sends image blocks to the Anna host model. This does not make those tools automatically available to Anna's general chat outside the app; the separate Skill draft and Executa still need the proper release/distribution path.
- Chat composer behavior: Enter submits; Shift+Enter inserts a newline. The attach control uses an inline 24×24 SVG plus with its rotation origin at the viewBox center. The focused composer should show one border, not a second outline/shadow ring.
- Retention `Detailed activity` has its own data-backed pointer tooltip (position, times seen, stopped watching), separate from the audience-retention SVG hover implementation.
- Channel Explorer video/Shorts previews are capped at 15 and do not request per-video duration enrichment; duration is unnecessary for thumbnail cards and was a slow path. Their async invocation window is 145 seconds, within the Executa's 150-second tool limit.
- The Anna Developer Console currently lists the real `YouTube Skillbox` app and its `tool-dev-youtube-skillbox` Executa separately. Keep both during local development: the app invokes that tool. `anna-repo` looks like an unrelated/old app entry, but do not delete it without user confirmation at the time of deletion.

## Local development

Run from the canonical repo:

```powershell
Set-Location E:\youtube-skillbox-anna
anna-app dev --port 5181 --storage aps --llm-app-slug youtube-skillbox-anna --no-watch --executa dir=E:\youtube-skillbox-anna\executas\youtube-skillbox
```

Preview: `http://localhost:5181/`

The real Anna login is already available on this machine. Keep the dev server alive for browser verification, but stop stale duplicate servers before restarting.

## Required validation before any handoff

```powershell
node bundle/frontend-regression.test.mjs
node --check bundle/app.js
node bundle/anna-tool-runtime.test.mjs
python -m unittest discover -s executas/youtube-skillbox -p 'test_*.py' -v
anna-app validate --strict
```

Also check the latest GitHub Actions run for the feature branch. Browser verification should exercise: tab navigation, one real public audit/profile call, each Explorer surface, chat with profile context, retention CSV, retention ZIP, light/dark/system theme, and the retention card next button.

## Git / safety state

- Feature implementation commit: `dc61c6b6fd7ecb199f09411ec24b7e05d8306002` on `feat/anna-skillbox-studio-redesign`; pushed to origin. Anna publish generated a canonical bundled-tool mapping to `tool-hackers-reality-youtube-skillbox-qftcp7g2`; the local harness still correctly routes to its dev tool. `git fsck --full --no-reflogs` passed on 2026-11-18; do not use the preserved `.git.corrupt-2026-11-18/` as active metadata.
- Existing unrelated dirty/untracked evidence items may remain: `.git.corrupt-2026-11-18/`, `bundle.damaged-2026-11-17/`, `corruption-evidence-2026-11-17/`, and `static/`. These are preserved; do not stage them. The app, docs, helper, and bundle assets were intentionally committed in `dc61c6b`.
- Stage only intentional files. Push feature branch only while work is in progress. Main is release-controlled and must remain untouched until all quality gates pass and the user explicitly asks for the final merge/push.

## Next priorities

1. Continue full browser testing of the current redesign after the retention deck port. Re-opened the supplied ZIP in a fresh live session: it produced 12 separate CSV/segment analyses and 10 visual evidence cards, including distinct segment curves and activity. Verified next/back by reading the changing card order and observing the live 3-D transform mid-shuffle. The motion control is now always visible; verify the explicit instant-shuffle option under an OS reduce-motion setting. Existing browser preview is open at localhost:5181 and running from the source engine. A live read-only home-tool call now confirms both featured-channel images return for the saved channel; still verify rendered shelf cards in the app.
2. Make audit result language explain unavailable measurements clearly without calling healthy partial evidence a failure.
3. Continue regression coverage for profile dispatch/avatar fallback, ZIP retention parsing, visual explorer rendering contracts, theme/session behavior, and chat routing. Current checks include 21 Python plugin tests, frontend regression, strict Anna validation, and live profile/home-shelf/retention-history checks.
4. Compare remaining original Skillbox capabilities against the reference repo and expose useful ones through chat or guided workflows, rather than making creators fill many technical fields.
5. Executa v0.7.1 was built for Windows/macOS/Linux and uploaded to the `executa-v0.7.1` GitHub release. GitHub validation run 44304007351 passed for the feature commit. Anna registered tool `tool-hackers-reality-youtube-skillbox-qftcp7g2` v0.7.1 and cut private app version 0.7.2 (version_id 2601). App status is still DRAFT; do not run `apps release` unless the user explicitly wants public marketplace distribution. The Anna developer webpage redirected to Sign In, and this CLI has no install command; browser login/install must be completed by the user or after they sign in. `anna-app apps publish --bump patch` inferred stale 0.1.1 and its cut failed safely; the staged working draft was then cut successfully as v0.7.2. Do not repeat publish blindly. A machine-side UV assertion can follow CLI output; verify remote state with `anna-app apps versions/status` rather than trusting the process exit code alone.
6. The chat attach plus is specified to rotate exactly 180 degrees counter-clockwise around its own center on hover/focus. Retention deck styling uses a taller responsive card so Anna's Read remains visible; `fitReadSections()` can expand it further. Regression assertions protect both details.
7. The supplied Skillbox identity is implemented: light/dark lockups and mark/1024px PNG are preserved in `assets/` and copied into `bundle/assets/`; the app header follows explicit and OS-default theme, and `manifest.json` points the Anna view icon at the shipped SVG mark. Existing `assets/screenshot-*.png` are from the old interface (timestamps Nov 16–17) and must not be presented as screenshots of the current redesign. Refresh marketplace screenshots from the actual app once reliable browser capture is available; a live capture attempt timed out twice on 2026-11-18, and no replacements were fabricated.
