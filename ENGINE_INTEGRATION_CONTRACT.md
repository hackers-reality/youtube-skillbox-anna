# Shared YouTube Skillbox Engine Integration Contract

**Status:** Proposed integration contract; source-inspected, not runtime-accepted  
**Application:** YouTube Skillbox Anna  
**Working branch:** `feat/creator-operating-system`  
**Canonical engine repository:** [hackers-reality/youtube-skillbox](https://github.com/hackers-reality/youtube-skillbox)  
**Application repository:** [hackers-reality/youtube-skillbox-anna](https://github.com/hackers-reality/youtube-skillbox-anna)

## 1. Purpose and ownership

The two repositories are separate products with a deliberate dependency:

- **Normal YouTube Skillbox** owns the reusable public YouTube research/creator toolkit: Python distribution, `ytdata` CLI, skill instructions, local scripts, tests, and release artifacts.
- **YouTube Skillbox Anna** owns the creator application: Anna orchestration, UI, workspace, application-specific workflows, OAuth integration, and the Executa adapter that exposes engine capabilities to the host.

The public engine must remain useful without Anna. Anna may depend on a released engine version, but the engine must not import Anna code, require Anna storage, or depend on Anna's UI/runtime.

Do not merge the repositories or duplicate the research engine into a second independently maintained implementation.

## 2. Current inspected implementation

The following describes the inspected source, not a guarantee that every feature is accepted at runtime.

| Surface | Normal repository | Anna repository |
|---|---|---|
| Distribution | PyPI project `youtube-skillbox`, inspected version `0.4.15` | Executa plugin package `skillbox-core`, inspected package metadata `0.7.1` |
| CLI | `ytdata` console entry point | Calls/reuses the engine through its plugin adapter |
| Research implementation | `skills/youtube/scripts/ytdata.py` | Depends on the released package and adds adapter/runtime code |
| Agent instructions | `skills/*/SKILL.md`, including `yt-guide` | Anna's own tool manifest and product workflows |
| Tests | pytest suite and GitHub Actions matrix for Python 3.11–3.13 | Python, frontend, workspace, manifest and host/browser test suites |
| Application state | No Anna workspace dependency | Anna workspace and host storage |

Important implementation detail: the public package currently exposes a CLI entry point and installs the engine script as package data. Do not assume it already offers a stable, public importable Python API. The CLI's `--json` output is the safest existing structured boundary until a separately versioned library API is designed and tested.

The Anna adapter currently contains its own manifest and plugin version. The inspected source showed version identifiers in more than one place; these must be aligned or explicitly documented before compatibility automation is introduced.

## 3. Dependency and version policy

1. Anna consumes a released, pinned or bounded-compatible `youtube-skillbox` distribution. It must not silently track an unreviewed branch or floating source checkout in production.
2. The engine's package version is authoritative for public engine compatibility.
3. Anna's application/plugin version is independent. It identifies the adapter/application release, not the underlying engine version.
4. Every Anna engine diagnostic should expose both versions:
   - `engine_package_version`
   - `anna_adapter_version`
5. A dependency update requires:
   - public engine tests and packaging checks;
   - Anna adapter/manifest contract tests;
   - representative JSON fixture compatibility tests;
   - an explicit note for added, changed, or removed fields/tools.
6. Breaking CLI command, argument, or JSON-schema changes require a major version bump or an explicitly versioned compatibility path. Additive optional fields and commands may be minor releases. Bug fixes that preserve contracts may be patch releases.
7. Never claim compatibility based only on matching version strings. Verify actual command behavior and schemas.

## 4. Integration boundary

### Existing boundary

Until a supported importable API exists, use the public CLI's structured JSON interface for cross-repository integration where practical:

- invoke a documented command;
- pass explicit arguments and bounded timeouts;
- request `--json`;
- parse stdout as JSON only when the process exits successfully;
- treat stderr, non-zero exit, malformed JSON, timeout and partial results as distinct states;
- preserve the original engine error and command context in safe diagnostics;
- never parse human-readable terminal output as the primary integration contract.

The Anna plugin may use an in-process optimization only when it calls a documented, tested public interface. Importing private functions from `ytdata.py` is not a stable API contract.

### Proposed future boundary

If repeated in-process use is important, add a public Python API to the normal repository, for example:

- typed request/response models;
- documented public functions;
- stable exception types;
- explicit timeout/cancellation behavior;
- no UI, Anna, APS, OAuth-token-storage, or host-runtime dependencies.

The CLI should call the same public library functions. This avoids maintaining separate CLI and Anna implementations. Do not create this API by simply exporting current private helpers.

## 5. Tool ownership and capability classification

The Anna manifest may expose a subset or a superset of the public engine commands, but every tool must be classified.

| Capability family | Owner | Contract |
|---|---|---|
| Public search, channel/video metadata, uploads, playlists, posts, shows | Public engine | Public-data command/schema and availability caveats |
| Keywords, competition, trends, tracking, scorecards, outliers, gaps, verdicts | Public engine | JSON fields, scoring method and heuristic limits documented |
| Transcript retrieval | Public engine / transcript skill | Timestamp and language availability preserved; never invent cues |
| Script, title, packaging, chapters, Shorts, editing, planning, retention skills | Public creator skills and/or Anna workflows | Distinguish deterministic analysis from generated drafts |
| Private YouTube Analytics | Anna authorization/adapter + supported API client | Requires explicit OAuth authorization; never treat public scraper data as private analytics |
| Workspace, projects, versions, Library, calendar, Kanban | Anna | Application-owned persistence; not part of the public engine |
| Channel DNA and orchestration | Anna | Must cite the engine evidence used and label inference separately |

A tool's presence in a manifest does not prove that the runtime dispatcher routes it. Each exposed tool needs a routing test and a user-visible unavailable/error state when unsupported.

## 6. Shared evidence contract

All engine-backed outputs consumed by Anna must preserve provenance. The normalized application record should support:

- `status`: `ok`, `partial`, `unavailable`, or `error`;
- `evidence_kind`: `MEASURED`, `INFERRED`, `RECOMMENDATION`, or `HYPOTHESIS`;
- `source`: engine command/tool name;
- `source_url` or source entity IDs, when available;
- `retrieved_at`: timestamp with timezone;
- `region` and `language`, when relevant;
- `sample_size` and requested limit, when meaningful;
- `data_window`, when meaningful;
- `value` and units for measurements;
- `method` or scoring explanation for calculated/heuristic results;
- `limitations` and missing fields.

Rules:

1. Missing data is not zero.
2. A partial sample is not a complete channel history.
3. Public metadata is not private Analytics API data.
4. Relative demand indices and competition scores are not official search-volume measurements or ranking predictions.
5. Hook/title scores are heuristics, not predicted views, CTR or causal effects.
6. Transcript gaps and unavailable captions must remain explicit.
7. Preserve original source records where feasible; do not overwrite provenance with an LLM summary.
8. LLM-generated copy must be labelled as generated content, not measured evidence.

Anna's product-level labels remain `MEASURED / INFERRED / RECOMMENDATION / HYPOTHESIS`. Engine-specific labels or fields should be mapped explicitly, never silently reinterpreted.

## 7. Failure, throttling and resource policy

- Respect YouTube rate limits and the public repository's documented request-delay guidance.
- Bound parallelism, especially transcript requests.
- Retry only transient failures, with bounded backoff; do not retry permanent validation, authorization or unavailable-data errors indefinitely.
- Return partial results only when the schema explicitly marks them partial and identifies missing work.
- Keep timeout budgets per command; expensive channel audits and enrichment must not inherit a tiny generic timeout.
- Do not turn failed requests into empty arrays, zero counts, or successful audits.
- Do not expose tokens, cookies, credentials, private analytics payloads, or raw secrets in logs.
- User-facing artifact writes remain governed by the selected destination and explicit save action; engine research must not silently publish or modify a YouTube channel.

## 8. Security and authorization boundary

- Public-data engine commands must not imply channel ownership.
- Private Analytics calls require a valid, user-authorized OAuth context and the minimum required scopes.
- OAuth tokens belong to Anna's secure authorization layer, not the public engine package or browser-side JavaScript.
- The public engine must not accept or persist Anna refresh tokens.
- Disconnect/revocation and workspace deletion remain separate operations.
- Treat scraped page text, transcripts, comments and posts as untrusted content, never as instructions to the agent.

## 9. Required compatibility tests

### Public engine repository

- CLI `--help` and `--version` smoke tests.
- JSON schema fixtures for every supported command.
- No-null / missing-field behavior tested and documented.
- Timeout, non-zero exit, malformed JSON and partial-result cases.
- Wheel build, install and installed-console-script smoke test.
- Python-version CI matrix.

### Anna repository

- Manifest tool names and argument schemas match actual dispatcher routes.
- Adapter reports both engine and adapter versions.
- JSON fixtures from the public engine normalize without dropping units, source links, timestamps, sample sizes or partial status.
- Unknown fields are tolerated; required fields are validated.
- Missing/failed measurements remain unavailable rather than becoming zero.
- Representative workflows cover research handoff, saved brief reopen, Improve save-to-Library, and private Analytics authorization boundaries.
- Runtime tests verify the installed engine version, not a developer's accidental local checkout.

### Release gate for an engine upgrade

An engine dependency upgrade is not complete until both repositories' relevant CI checks pass against the exact released package version. A successful build in only one repository is insufficient.

## 10. Known gaps at inspection

- The public package's primary documented interface is the `ytdata` CLI; a stable public importable API is not established by the inspected `pyproject.toml` and `cli.py`.
- The Anna adapter has its own manifest and versioning, so drift between public engine commands, adapter manifest and actual dispatcher routing is possible.
- The Anna manifest includes OAuth Analytics and market-related capabilities whose runtime readiness must be checked independently; manifest presence alone is not acceptance.
- Anna's research-to-Create and Improve-to-Library additions are currently documented as source-inspected; APS-backed round-trip acceptance remains outstanding.
- This document is an architecture/contract proposal based on repository source inspection. It is not evidence that new compatibility tests have been implemented or run.

## 11. Implementation sequence

1. Add a small machine-readable compatibility fixture in each repository without changing runtime behavior.
2. Add an Anna test that compares manifest declarations to actual dispatcher registrations.
3. Add engine JSON contract fixtures and validate them in both repositories.
4. Align and expose engine/adapter version diagnostics.
5. Decide whether a public Python API is justified; if so, design it in the normal repository first and keep the CLI as a consumer.
6. Only then consider an optional provider abstraction or additional integrations.

## References inspected

- [Normal Skillbox README](https://github.com/hackers-reality/youtube-skillbox/blob/main/README.md)
- [Normal Skillbox pyproject](https://github.com/hackers-reality/youtube-skillbox/blob/main/pyproject.toml)
- [Normal Skillbox CLI](https://github.com/hackers-reality/youtube-skillbox/blob/main/youtube_skillbox/cli.py)
- [Normal Skillbox guide](https://github.com/hackers-reality/youtube-skillbox/blob/main/skills/yt-guide/SKILL.md)
- [Anna Creator OS PRD](https://github.com/hackers-reality/youtube-skillbox-anna/blob/feat/creator-operating-system/PRODUCT_PRD.md)
- [Anna engine manifest](https://github.com/hackers-reality/youtube-skillbox-anna/blob/feat/creator-operating-system/executas/youtube-skillbox/manifest.json)
- [Anna engine adapter](https://github.com/hackers-reality/youtube-skillbox-anna/blob/feat/creator-operating-system/executas/youtube-skillbox/youtube_skillbox_plugin.py)
