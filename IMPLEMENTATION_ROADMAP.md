# Creator Operating System — Implementation Roadmap

**Working branch:** `feat/creator-operating-system`  
**Release policy:** feature branches and preview deployments only until explicitly approved.

## Current progress — 2026-11-22

### Phase 0 / 1
- The Anna and Vercel runtimes remain separate: this branch uses the Anna host LLM and Executa tool bridge; the standalone NVIDIA NIM app remains on `feat/designer-review-nextjs`.
- The existing app, tool routing, engine adapter, and test workflow were mapped before implementation.
- Added this branch to the existing Anna validation workflow so pushes to Creator OS run the same strict checks as the original Anna feature branch.

### Phase 2 — Channel DNA initial vertical slice
- Added a deterministic `channel_dna` Executa tool and registered it in both the Python runtime manifest and the declarative Executa manifest.
- Ask Anna now routes channel-niche / Channel DNA questions to a sample of up to 30 recent public videos plus public outliers, then passes a bounded evidence summary and the classifier result to the Anna LLM.
- Topic scoring weights titles, transcripts, and descriptions; tags have zero classification weight and cannot independently establish a niche.
- Explicit Channel DNA requests enrich up to six representative videos with available original-language captions before classification; missing captions remain unavailable evidence, not negative signals.
- One-video topic clusters are reported as experimental topics instead of being promoted to the dominant niche.
- Added regression fixtures for space/science, gaming, cooking, education, entertainment, technology, music, and business, including the space/science channel with one isolated AI/farmer experiment.
- Added a persistent creator-focus field to the verified channel profile; this user-provided context is passed to Channel DNA without replacing measured content evidence.
- GitHub Actions validation passed on the Creator OS branch after the initial Channel DNA integration (Python, frontend, strict Anna manifest validation, and JSON/HTML checks).

**Still open before the Phase 2 exit gate:** transcript enrichment is not yet wired into the sample pipeline; creator-confirmed niche/preferences need a first-class UI control; the lexical classifier needs validation against real representative channels and may return insufficient evidence for ambiguous samples. This is an initial vertical slice, not a completed Creator Intelligence department.

## Phase 0 — Stabilization and baseline
- [ ] Preserve the current Anna app, verified channel profile, phrase, and APS data.
- [ ] Re-run existing frontend, runtime, Python, strict manifest, and CI checks.
- [ ] Verify onboarding, Anna host connection, one live profile/audit call, Explorer, chat, retention CSV/ZIP, themes, and navigation in a real browser.
- [ ] Record baseline screenshots and known failures without fabricating evidence.
- [ ] Keep `main`, Anna marketplace release, and production deployment untouched.

**Exit gate:** Existing app remains functional and baseline checks are recorded.

## Phase 1 — Product foundation
- [ ] Map current UI, data contracts, storage, tool routing, and engine capabilities against the PRD.
- [ ] Define shared channel/workspace context and evidence provenance types.
- [ ] Define consistent loading, empty, partial, unavailable, and error states.
- [ ] Establish feature flags and safe guest-mode boundaries.
- [ ] Add regression fixtures for multiple channel archetypes.

**Exit gate:** Architecture and data contracts are documented; existing workflows remain green.

## Phase 2 — Channel DNA and creator intelligence
- [ ] Build representative content sampling and topic clustering.
- [ ] Add creator-confirmed niche/goals/preferences.
- [ ] Weight published content and transcripts above tags/descriptions.
- [ ] Detect outliers without allowing one-off uploads to redefine the channel.
- [ ] Generate evidence-backed ideas with confidence, fit explanation, and source links.
- [ ] Add regression tests for space/science, gaming, cooking, education, entertainment, technology, music, and business archetypes.

**Exit gate:** Recommendations remain relevant across archetypes and explain their evidence.

## Phase 3 — Identity and Google OAuth foundation
- [ ] Separate Skillbox identity from YouTube channel authorization.
- [ ] Design a central Skillbox-managed Google OAuth client and backend callback/token exchange.
- [ ] Define least-privilege scopes and consent copy.
- [ ] Implement secure server-side token storage, refresh, expiry, disconnect, and revocation.
- [ ] Add account/channel connection state and clear error recovery.
- [ ] Document Google verification, quota, privacy-policy, and production-readiness requirements.

**Exit gate:** OAuth works in a controlled test environment with secrets server-side and no fabricated approval status.

## Phase 4 — Channel Intelligence
- [ ] Add authorized Analytics API data adapter and date-range model.
- [ ] Add dashboard for metrics supported by the API and channel eligibility.
- [ ] Add audience geography, demographics, traffic sources, and device breakdowns only when returned.
- [ ] Add video/Shorts comparisons, historical trends, and exports.
- [ ] Label metric availability and privacy thresholds clearly.

**Exit gate:** All displayed metrics are traceable to API responses or clearly labelled estimates/inferences.

## Phase 5 — AI Content Studio expansion
- [ ] Build research-to-brief-to-script workflow.
- [ ] Add hooks, script structures, titles, descriptions, chapters, storyboard, and thumbnail briefs.
- [ ] Add transcript import/cleanup/summarization and Shorts extraction.
- [ ] Add version history, save, export, and channel-DNA grounding.
- [ ] Add quality checks and source attribution for researched scripts.

**Exit gate:** Creator can produce and save a complete draft grounded in their channel context.

## Phase 6 — Optimization Lab
- [ ] Consolidate retention CSV/ZIP analysis and visual findings.
- [ ] Add title/thumbnail/hook review and pacing guidance.
- [ ] Add experiment planning and result tracking.
- [ ] Keep heuristic scores separate from measured CTR, retention, and outcomes.

**Exit gate:** Optimization claims are evidence-labelled and reproducible.

## Phase 7 — Market Research
- [ ] Add public competitor discovery and comparison.
- [ ] Add topic/keyword demand and competition context.
- [ ] Add source-backed trend and content-gap reports.
- [ ] Add source dates and freshness indicators.

**Exit gate:** Research outputs are traceable to public sources and are clearly separated from private channel data.

## Phase 8 — Creator Workspace
- [ ] Add saved projects, audits, briefs, scripts, and reports.
- [ ] Add content calendar and task workflow.
- [ ] Add multi-channel context with authorization boundaries.
- [ ] Add exports, retention controls, and deletion workflows.

**Exit gate:** A creator can manage the end-to-end workflow in one coherent workspace.

## Cross-phase release gates
- No secrets or OAuth tokens in frontend code, logs, or Git.
- No overwrite or clearing of APS/channel profile data.
- No fake demo data presented as live analytics.
- No unsupported API metrics or guaranteed performance claims.
- Required unit, integration, frontend regression, strict app validation, and CI checks pass.
- Browser verification is recorded for user-critical flows.
- Preview deployment is verified before any production release.
- Do not merge to `main`, cut/release the Anna app, or promote Vercel production without explicit user authorization.

## Current execution order
1. Complete Phase 0 audit against the current branch and record evidence.
2. Map current engine capabilities and UI contracts.
3. Implement Channel DNA as the first differentiated capability.
4. Build OAuth foundation before private Analytics API dashboards.
5. Expand the remaining departments in the order above.
