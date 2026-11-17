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
- Anna long-running invocation boundary is in `bundle/anna-tool-runtime.mjs`; calls over the synchronous limit use `invokeAsyncAwait` with the timeout passed to both request and wait options.
- Python Executa bridge is clean after removing the corrupted `executas/youtube-skillbox/uv.lock`; always use the explicit `--executa dir=E:\youtube-skillbox-anna\executas\youtube-skillbox` dev command.
- Retention engine and tests are working.
- New `profile` Executa method fetches public channel identity and accepts a channel ID (`UC...`) as well as a handle/URL.
- Audit flow now uses the fast `profile` call instead of the slow composite `snapshot` call, which was the main source of recurring partial audits.
- Explorer rendering work replaces raw JSON with upload cards, community-post cards, home-shelf rows, and Show cards.
- Current redesign work adds Ask Anna chat with image/CSV/ZIP attachments, metric-aware analysis for every CSV in a YouTube Studio ZIP, channel workspace/profile verification, theme cycling, session-cache clearing, smooth SVG retention graphs, retention finding-card carousel, and shimmer states.

## Honest Anna capability boundary

The frontend can call `anna.llm.complete`, `anna.tools.invoke`, storage, and the bundled Executa. The outside Anna chat does not automatically discover arbitrary frontend controls; the app must explicitly orchestrate tool calls and pass evidence into the LLM. Public channel verification is intentionally manual: the app generates a random read-only phrase, the creator copies it into the description themselves, then this app re-fetches public data and checks that exact phrase. No YouTube OAuth/write access is needed or requested by this flow.

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

- Last committed feature-branch commit before the current redesign pass: `439398f` (`Polish keyword lab inputs`).
- The canonical `.git` metadata was restored from a fresh clone because the old metadata was corrupt. Do not use the old `.git.corrupt-2026-11-18/` as an active repository.
- Existing unrelated dirty/untracked evidence items may remain: `.git.corrupt-2026-11-18/`, `bundle.damaged-2026-11-17/`, `corruption-evidence-2026-11-17/`, `static/`, `DESIGN.md`, `bundle-server.js`, and pre-existing edits to `.github/workflows/build-executa.yml`, `.gitignore`, `README.md`, and `bundle/anna-tool-ids.js`. Preserve them unless explicitly audited and safely handled.
- Stage only intentional files. Push feature branch only while work is in progress. Main is release-controlled and must remain untouched until all quality gates pass and the user explicitly asks for the final merge/push.

## Next priorities

1. Finish and browser-test the current redesign changes; fix any runtime/syntax/layout issues.
2. Make audit result language explain unavailable measurements clearly without calling healthy partial evidence a failure.
3. Add regression tests for profile dispatch, ZIP retention parsing, visual explorer rendering contracts, theme/session behavior, and chat routing.
4. Compare remaining original Skillbox capabilities against the reference repo and expose useful ones through chat or guided workflows, rather than making creators fill many technical fields.
5. Only then consider release/push decisions. Do not publish or merge prematurely.
