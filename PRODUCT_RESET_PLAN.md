# YouTube Skillbox — Product Reset Plan

**Working branch:** `feat/creator-operating-system`  
**Status:** Discovery baseline; no UI or engine features removed  
**Scope:** Simplify the creator experience while preserving the existing engine and Anna runtime.

## Product outcome

YouTube Skillbox should guide a creator through one repeatable loop:

**Understand → Discover → Create → Improve → Manage**

Ask Anna is the orchestration layer across that loop, not a separate department that duplicates every screen.

The approved product principles in `PRODUCT_PRD.md` remain binding: evidence before confidence; no fabricated analytics; measured, inferred, recommendation and hypothesis claims kept distinct; guest/private-data boundaries; one coherent workspace; privacy by design.

## Proposed primary navigation

| Destination | Creator job | Existing capabilities to consolidate |
|---|---|---|
| Home | Understand what is happening and choose the next useful action | Channel snapshot, recent work, priorities, recent reports, onboarding and connection status |
| Research | Understand the channel and decide what to make | Audit, videos, Shorts, outliers, Channel DNA, keywords, competition, competitor discovery, trends and content gaps |
| Create | Turn an idea into a publishable draft package | Research brief, hooks, script, titles, description, tags, chapters, thumbnail brief, storyboard, transcript cleanup and Shorts repurposing |
| Improve | Diagnose and improve published content | Analytics, retention CSV/ZIP, title/thumbnail/hook review, pacing and experiments |
| Library | Keep work organized and reusable | Saved audits, briefs, scripts, reports, versions, projects, calendar, Kanban, exports and data controls |
| Ask Anna | Orchestrate the relevant workflow using shared context | Existing chat and bounded tool routing; available globally from every destination |

This is a proposed information architecture, not a claim that these destinations already exist in the current implementation.

## Feature disposition

### Core — retain and make discoverable

- Ask Anna and contextual tool orchestration.
- Public channel audit, recent videos, Shorts and outlier analysis.
- Channel DNA and creator-confirmed channel focus.
- Keyword, competition and content-gap research.
- Research brief and complete video-draft creation.
- Titles, hooks, scripts, descriptions, chapters and thumbnail concepts.
- Transcript import/cleanup and Shorts extraction.
- YouTube Analytics connection and returned private metrics, when authorized and eligible.
- Retention CSV/ZIP analysis and evidence-labelled improvement recommendations.
- Saved work, version history, projects and exports.
- Clear authorization, unavailable-data, retention and deletion controls.

### Advanced — retain, but progressively disclose

- Competitor outlier deep-dives and full research-chain controls.
- Metadata inspection, playlist contents and SEO scorecards.
- Rank snapshots and keyword-history views.
- Experiment planning, pre-launch quality gates and manual result reviews.
- Retention cache/history and advanced pacing analysis.
- Calendar and Kanban management.
- Detailed channel shelves, community posts and shows.
- Manual per-tool execution where Ask Anna can orchestrate the normal path.

Advanced means secondary in the default journey, not deprecated or removed.

### Deferred — do not present as complete until accepted

- Production hosted multi-user identity and managed Google OAuth.
- Real authorized Analytics acceptance with configured consent and eligible channels.
- End-to-end real APS save/refresh/reopen acceptance.
- Multi-channel identity switching and authorization acceptance.
- Complete research-to-script grounding and source attribution across every Studio action.
- Full market bridge dispatch, source freshness and provenance for advanced market commands.
- Complete experiment outcome lifecycle and statistical interpretation.
- Real-channel Channel DNA validation and downstream persistence/consumption.

### Remove

No feature is approved for removal during this reset discovery phase. A later removal proposal must demonstrate that the capability is dead, duplicated, unsafe, unsupported, or outside the approved product scope, and must identify dependencies and migration impact first.

## Guided workflows

### Research workflow

1. Select or enter a public channel, or use the connected creator profile.
2. Load the channel snapshot and representative published content.
3. Review Channel DNA with evidence and uncertainty.
4. Explore topics, keywords, competitors and content gaps.
5. Save a selected opportunity as a research brief in Library.

### Create workflow

1. Start from a saved opportunity or a creator-provided idea.
2. Confirm audience, goal, format, constraints and source context.
3. Generate a research/creative brief.
4. Build hooks, outline and script.
5. Generate packaging assets: titles, description, chapters and thumbnail brief.
6. Run quality checks and save a version.
7. Repurpose transcript/script into Shorts when requested.

### Improve workflow

1. Select a published video or upload a real YouTube Studio retention export.
2. Separate measured results from heuristic interpretation.
3. Identify the most actionable issue and show the supporting evidence.
4. Recommend a bounded change or experiment.
5. Record the plan and later enter observed results without implying causation.

### Library workflow

1. Save useful outputs with channel and project context.
2. Reopen, duplicate and revise without overwriting prior versions.
3. Connect drafts to tasks and calendar plans.
4. Export user-owned work and provide explicit retention/deletion controls.

## UX rules for the redesign

- Default screens should answer one creator question at a time.
- Each workflow has one clear primary action; related outputs are grouped into a coherent package.
- Keep advanced controls behind a clearly labelled disclosure, not mixed into the primary path.
- Use progressive disclosure instead of deleting useful engine capabilities.
- Make channel context, guest/authorized state and data provenance visible without overwhelming the page.
- Distinguish loading, empty, partial, unavailable and error states.
- Never display missing analytics as zero or demo data as live data.
- Ask Anna should reuse shared context and existing tool contracts; it must not invent unavailable tools.
- Preserve accessibility, keyboard navigation, responsive layouts and reduced-motion behavior.
- Keep privacy, disconnect, export and deletion controls discoverable.

## Baseline observations from the current remote branch

Inspection of `bundle/index.html` on this branch found:

- Six sibling top-level panels: chat, audit, studio, retention, analytics and workspace.
- 33 section headings and 102 button elements in the HTML document (including onboarding/dialog controls).
- Content Studio contains a large set of independent generation and research actions in one destination.
- Retention combines analysis, history/cache, experiment planning, quality gates, pacing and live-result tracking.
- Workspace combines saved work, calendar, Kanban, public research contexts and data management.
- The guided tour explains six existing workflows but does not itself simplify the information architecture.
- `bundle/style.css` sets the base body font to 12.5px, contributing to the dense presentation.

These counts are a structural inventory, not a usability score. Button counts include controls in dialogs and nested workflows.

## Acceptance gates before a UI migration

1. Record the current branch baseline and preserve all local uncommitted/untracked work and APS data.
2. Map every existing control to a destination and identify its current handler/tool contract.
3. Mark every control as working, partial, unavailable or unverified based on tests—not labels or historical commits.
4. Define the shared channel/workspace context and provenance contract used by all destinations.
5. Prototype the new navigation and guided Create flow without deleting existing controls.
6. Migrate one workflow at a time behind regression coverage.
7. Verify desktop/mobile, keyboard navigation, reduced motion, loading/empty/partial/error states and guest/authorized boundaries.
8. Verify real host/tool behavior and real APS persistence separately from isolated browser fixtures.
9. Run frontend, Python, strict Anna manifest, strict HTML and current-branch CI checks.
10. Keep `main`, production deployment and marketplace release untouched until separately authorized.

## Explicit safety boundary

Do not reset, clean, discard, overwrite or stash-delete local work. Do not edit the Designer Review branch. Do not merge or push to `main`, publish, or promote production. Remote GitHub inspection does not establish the state of the user's local working tree; reconcile local and remote state before broad implementation changes.

## Implementation log

### First guided Create slice — in progress

Implemented on `feat/creator-operating-system`:

- Added a three-step Create quickstart: **Plan → Create → Repurpose**.
- The shortcuts call existing Studio task identifiers (`brief`, `full`, and `shorts_extraction`); no duplicate generation runtime was introduced.
- Kept the original Write Pack controls and output/save controls intact.
- Moved secondary creator workflow controls into a collapsed native `details` disclosure. All ten original task buttons remain in the document and continue to match the existing `.studio-actions [data-task]` event binding.
- Added responsive card styling and source-level regression assertions for the quickstart, preserved advanced actions, and disclosure styling.

**Verification boundary:** source-level remote checks confirmed the expected markup, task identifiers, and handler selector are present. The local test suite and real-browser interactions have not been executed from this GitHub-only editing session. This slice is not an acceptance claim for the complete Create workflow.

### Next implementation sequence

1. Complete the control → handler → Executa method → test inventory before changing primary navigation.
2. Define a shared research-brief contract so selected Research evidence can seed Create without copying or inventing metrics.
3. Add a first-class handoff from a saved research opportunity into the Create brief, preserving source URLs and MEASURED / INFERRED / RECOMMENDATION provenance.
4. Consolidate Improve only after mapping the Retention and Analytics panel dependencies and their separate authorization/data contracts.
5. Reconcile the remote branch with the user's local worktree before any broader source refactor; local dirty files and APS data are not visible through GitHub.

### Research-to-Create handoff — initial slice

- Added a post-success action to carry the visible Keyword Lab research summary into Studio Context.
- Preserves existing creator context, prefills empty topic/keyword fields, carries rendered HTTP(S) source links, and opens Create for review.
- This is a rendered-summary bridge only. Typed evidence records, complete source lineage, and end-to-end research-to-script acceptance remain open.
- Added frontend source assertions for the handoff path.

### Research brief save/reopen slice

- Added explicit save-to-Workspace and reopen-in-Create actions for successful Keyword Lab research.
- Added a workspace readiness guard to prevent saving against the empty initial store before load completes.
- Preserves source-link strings and labels the saved content as a rendered research summary; raw tool-payload provenance remains future work.
- Local APS persistence and browser acceptance remain unverified.

### Improve-to-Library save slice — in progress

- Added explicit **Save copy to Library** actions for successful single retention reports, ZIP retention bundles, experiment plans, and recorded experiment results.
- The actions use the existing Creator Workspace `projects` collection and its readiness guard; they do not introduce a second Library database or silently copy private records.
- Retention history and experiment planner/tracker remain authoritative in their existing stores. The Library item is a JSON snapshot with a clear Improve provenance label.
- Experiment result snapshots include the associated experiment plan when it is available.
- The local test suite, APS persistence, and browser interactions have not been run in this remote editing session.
