# Creator OS feature inventory — Studio contract

**Branch:** `feat/creator-operating-system`  
**Scope:** Existing Content Studio task controls, their current dispatch path, required inputs, and engine dependencies.  
**Purpose:** Prevent navigation and UX consolidation from disconnecting existing actions.

## Dispatch contract

- The current UI binds click handlers to `$(".studio-actions [data-task]")` via the collection helper `$$`.
- The delegated-by-selector binding is applied to each matching button at initialization; buttons inserted later would need explicit binding or event delegation at a stable ancestor.
- The task handler gathers the idea, keyword, title, thumbnail text, context, and video URL, then routes selected tasks to dedicated branches.
- Most creative tasks call the Anna host LLM using `TASK_PROMPTS`. They are generated drafts, not measured research.
- Current Studio engine calls inside this handler are `transcribe`, `hookscore`, and `title_lint`.
- The task buttons are not publication actions. The handler writes results into the Studio output and the existing save control can save a version to Workspace.

## Current task inventory

| Task ID | UI action | Dispatch / dependency | Input and guard |
|---|---|---|---|
| `brief` | Build creative brief | Dedicated LLM branch, `TASK_PROMPTS.brief` | Topic optional only because brief is exempt from generic topic guard; context/research can seed it |
| `full` | Generate full pack | LLM, `TASK_PROMPTS.full` | Requires a topic |
| `shorts_extraction` | Extract Shorts | Dedicated LLM branch | Requires context; prompt requires timestamped transcript and forbids invented timecodes |
| `hooks` | 21 hook options | LLM then Executa `hookscore` | Requires topic; exactly 21 valid candidates before scoring |
| `titles` | 5 title options | LLM then Executa `title_lint` | Requires topic; exactly five valid titles before lint |
| `seo` | Description + tags | LLM, `TASK_PROMPTS.seo` | Requires topic; prompt expects supplied keyword research and refuses invented search metrics |
| `chapters` | Chapters | LLM, `TASK_PROMPTS.chapters` | Requires topic; timestamp evidence must be supplied in context |
| `shorts` | Shorts extraction (legacy pack action) | LLM, `TASK_PROMPTS.shorts` | Requires topic; timestamp evidence must be supplied in context |
| `transcript` | Fetch transcript | Executa `transcribe` | Requires video URL/ID; writes returned transcript into Context; preserves cue timecodes only when returned |
| `script` | Full video script | LLM hooks → Executa `hookscore` → LLM script | Requires topic; five hook candidates and two ranked candidates are hard gates |
| `edit` | Edit decision list | LLM, `TASK_PROMPTS.edit` | Requires topic and context; prompt cites cue timecodes and labels caption gaps as candidate pauses |
| `thumbnail` | Thumbnail briefs | LLM, `TASK_PROMPTS.thumbnail` | Requires topic; outputs creative hypotheses, not measured CTR predictions |
| `comments` | Comment replies | LLM, `TASK_PROMPTS.comments` | Requires context containing comment thread; draft-only |
| `storyboard` | Storyboard | Dedicated LLM branch | Requires topic; missing visual details should be marked as gaps |
| `transcript_cleanup` | Transcript cleanup | Dedicated LLM branch | Requires context; preserves supplied timestamps and does not invent them |
| `quality_check` | Quality check | Dedicated LLM branch | Requires context containing an existing draft |
| `version_note` | Version note | Dedicated LLM branch | Requires context containing current draft |
| `plan` | Weekly content plan | LLM, `TASK_PROMPTS.plan` | Requires topic or context; prompt itself requires available hours and in-progress assets before scheduling |

## Existing engine contract

The current Studio click handler invokes only these engine methods directly:

- `transcribe`: transcript text and, when available, timestamped segments.
- `hookscore`: deterministic copy heuristic used to rank supplied hook candidates. It is not a performance prediction.
- `title_lint`: deterministic title/thumbnail-text linting. It is not a CTR prediction.

The broader engine manifest also contains research, channel, retention, Analytics, OAuth, and market methods. Their presence in the manifest does not mean every Studio task calls them. Research methods must be explicitly wired into a future evidence-to-brief handoff before the product claims that a generated brief is grounded in live research.

## UX disposition

- **Default path:** Plan → Create → Repurpose quickstart.
- **Core controls retained:** Write Pack actions and existing output/save controls.
- **Advanced disclosure:** script, edit, thumbnail, comments, storyboard, transcript cleanup, Shorts extraction, quality check, version note, and weekly plan remain available in the collapsed Advanced section.
- **No deletion:** all original task identifiers remain in the markup.
- **No false evidence:** LLM-generated creative suggestions remain distinct from measured engine output.

## Regression requirements

1. Every visible `data-task` control must be inside a `.studio-actions` container while the current selector-based binding remains in use.
2. Every task ID in the HTML must have a corresponding `TASK_PROMPTS` entry or an explicitly documented dedicated branch.
3. `transcript`, `hookscore`, and `title_lint` remain explicit engine dependencies; their failures must not be represented as successful outputs.
4. The `script` path must stop when five hook candidates or two ranked candidates are missing.
5. Timestamp-dependent outputs must not fabricate timecodes.
6. The Advanced section may be collapsed by default, but its controls must remain in the DOM and reachable by keyboard.
7. Saving a generated output remains an explicit user action; no task may publish or send content.

## Known verification boundary

This inventory was derived from the current remote `bundle/index.html`, `bundle/app.js`, and `executas/youtube-skillbox/manifest.json`. It is a source inspection, not a local runtime test. The user's local worktree and APS storage are not visible through the GitHub connector; the project test suite and real-browser acceptance still need execution in the local/preview environment.


## Research-to-Create handoff

A successful Keyword Lab run now appends a **Use research in Create** action to the rendered result. The action:

- Captures the visible research summary, the selected research kind, seed, region and language.
- Collects rendered HTTP(S) anchor links and carries their labels and URLs into the context; non-HTTP protocols are ignored.
- Adds the research summary to the existing Studio Context rather than silently deleting creator notes, with a bounded context size.
- Prefills the topic and target keyword only when those fields are empty.
- Opens Content Studio and focuses the Context field so the creator can review the handoff before generating a brief.

**Important limitation:** this is a rendered-summary handoff, not a structured evidence object. It preserves visible source links when the renderer exposes them, but it does not claim full raw tool payload lineage or source completeness. A later contract should pass typed evidence records with provenance and source IDs rather than relying on rendered text.
