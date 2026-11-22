# YouTube Skillbox — Creator Operating System PRD

**Status:** Approved product direction; implementation in progress  
**Branch:** `feat/creator-operating-system`  
**Product model:** All-in-one Creator Operating System  
**Audience:** Beginner through professional creators across niches and formats

## 1. Product vision

YouTube Skillbox helps creators understand their channel, understand their audience, decide what to make next, create it, improve it, and manage the work in one evidence-first workspace.

It must be more than a generic chat wrapper around YouTube data. The product combines analytics, creator intelligence, research, content production, optimization, and workspace workflows, with Ask Anna as the conversational orchestration layer.

## 2. Product principles

1. **Evidence before confidence.** Every analytical statement is labelled MEASURED, INFERRED, RECOMMENDATION, or HYPOTHESIS.
2. **Niche relevance beats noisy metadata.** Published videos, transcripts, topic clusters, performance, and creator-confirmed preferences carry more weight than tags or descriptions. A single experimental upload must not redefine a channel.
3. **No fabricated analytics.** Missing, delayed, private, or threshold-suppressed metrics are shown as unavailable, never guessed.
4. **No performance guarantees.** Scores are heuristic prioritization aids, not predicted views, CTR, or causal claims.
5. **Guest mode remains useful and honest.** It can use public data and user-provided files; private analytics require channel authorization. Demo data must be explicitly labelled.
6. **One coherent workspace.** Departments should share channel context, saved work, and navigation rather than become a pile of disconnected tools.
7. **Privacy by design.** Least-privilege scopes, secure token handling, disconnect/revocation, and clear data deletion controls.

## 3. Audience and access model

Support beginners, growing creators, established creators, educators, entertainment channels, gaming channels, science/technology creators, businesses, and professional teams.

### Guest mode
- Explore supported public channel and video data.
- Use manual inputs and uploaded YouTube Studio exports.
- Save local/session work where supported.
- Clearly explain which private analytics are unavailable.

### Skillbox account
- Owns workspace identity, saved projects, preferences, and team access.
- Must remain separate from Google/YouTube authorization.

### Google / YouTube connection
- One Skillbox-managed Google OAuth application; users should not create Google Cloud projects or paste client secrets.
- Explicit Connect Google / Connect YouTube action and clear consent screen.
- Begin with the minimum read-only scopes needed for approved features.
- Store refresh tokens only server-side using encrypted storage; never expose client secrets or tokens to browser code.
- Provide disconnect and token revocation.
- Handle OAuth verification, quota, consent, and policy requirements before public rollout.
- Existing manual public-channel phrase verification remains a separate ownership-verification option; it is not OAuth and does not unlock private analytics.

## 4. Product departments

### A. Channel Intelligence
- Channel overview and historical performance where available.
- Video and Shorts performance comparison.
- Views, watch time, subscribers gained/lost, impressions, CTR, average view duration, and retention when the API makes them available.
- Audience geography, demographics, traffic sources, devices, and returning/new viewers where eligible and returned by YouTube.
- Date-range filters, comparisons, exportable reports, and clear unavailable-data explanations.

### B. Creator Intelligence
- Channel DNA profile: core topics, audience promise, format mix, tone, recurring themes, and creator-confirmed goals.
- Niche and topic-cluster detection using actual published content and transcripts.
- Outlier analysis that distinguishes repeatable patterns from one-off anomalies.
- Evidence-backed content opportunities and recommendation explanations.
- Confidence and evidence provenance on each recommendation.

### C. AI Content Studio
- Idea development and research briefs.
- Multiple hooks and script drafts with structure and pacing guidance.
- Titles, descriptions, tags, chapters, thumbnail concepts, and storyboard prompts.
- Transcript cleanup, summaries, chapter generation, and Shorts extraction.
- Repurposing for other platforms.
- Draft saving, version history, and export.
- Generated content must remain grounded in the channel's DNA and creator brief.

### D. Optimization Lab
- Title and thumbnail review.
- Hook and opening analysis.
- Retention graph and CSV/ZIP analysis.
- Pacing and structure recommendations.
- Experiment planning and result tracking.
- Separate measured results from heuristic scores and hypotheses.

### E. Market Research
- Public competitor and peer-channel discovery.
- Topic and keyword research, search intent, and competition context.
- Emerging topic monitoring and content gap analysis.
- Cite sources and dates; distinguish public observations from private channel analytics.

### F. Creator Workspace
- Saved audits, research, scripts, transcripts, and reports.
- Multi-channel workspaces where authorized.
- Projects, content calendar, drafts, task tracking, and export.
- Clear ownership, privacy, and deletion controls.

## 5. Ask Anna orchestration

Ask Anna is the unified interface across departments. For each request it should:
1. Identify intent and required channel/workspace context.
2. Retrieve only the relevant evidence and tools.
3. Check authorization and data availability.
4. Execute bounded tool calls and handle partial results.
5. Present evidence with MEASURED / INFERRED / RECOMMENDATION / HYPOTHESIS labels.
6. Explain why a recommendation is relevant and cite the videos, topics, metrics, or sources behind it.
7. Offer to save useful outputs into the Creator Workspace.

The assistant must not imply that a frontend control or a tool is available in general Anna chat unless it is actually registered and distributed there.

## 6. Channel DNA and recommendation contract

Recommended evidence priority:
1. Creator-confirmed niche, goals, and preferences.
2. A representative set of recent and historically important published videos.
3. Transcripts, titles, descriptions, and semantic topic clusters.
4. Repeated audience/performance patterns and format performance.
5. Channel description and tags as supporting context only.
6. Isolated experimental uploads as low-weight evidence unless repeated or explicitly endorsed.

Each idea should show:
- Why it fits the channel.
- Which videos/topics support the fit.
- Audience evidence, if available.
- Trend/source evidence and its date, if used.
- Confidence and important uncertainty.
- Production feasibility and suggested format.
- A clear label when it is a hypothesis rather than measured demand.

Regression case: a space/science channel must not be redirected toward generic AI content solely because AI appears in channel tags and one experimental AI/farmer upload.

## 7. Data, integrations, and architecture

Use modular boundaries within the existing codebase first; do not split into microservices prematurely.

Logical modules:
- Identity and workspace
- OAuth and YouTube connection
- Public YouTube data
- YouTube Analytics data
- Channel profile and DNA
- Transcript and content intelligence
- Research and source retrieval
- Recommendation engine
- Content generation and optimization
- Creator workspace and exports

Use the YouTube Data API for supported public/channel/video resources and the YouTube Analytics API for authorized owner analytics. Respect API quotas, reporting dimensions/metrics, eligibility rules, privacy thresholds, and policy requirements. Geography and demographic data are conditional, not guaranteed for every channel or date range.

## 8. Security, privacy, and compliance

- Keep OAuth client secrets and refresh tokens server-side only.
- Request minimum scopes and explain why each is needed.
- Encrypt credentials at rest and restrict access.
- Support disconnect and revocation; delete stored tokens on disconnect.
- Provide user-facing data retention and deletion behavior.
- Do not log tokens, secrets, private analytics payloads, or sensitive uploads.
- Respect Google API Services User Data Policy and YouTube API Services Terms.
- Do not claim Google verification or production OAuth readiness until actually approved.

## 9. Success criteria

- A creator can connect or use guest mode without configuring their own Google Cloud project.
- Channel DNA identifies the dominant niche from representative content and resists isolated metadata noise.
- Recommendations explain their fit with evidence and uncertainty.
- Analytics clearly distinguish available, unavailable, and threshold-suppressed metrics.
- A creator can move from an insight to a saved research brief and script without losing channel context.
- Existing Anna runtime, channel onboarding, APS data, and current Skillbox workflows remain intact.

## 10. Explicit non-goals for the first release

- Guaranteed view, subscriber, or revenue predictions.
- Automated publishing or channel-description edits without explicit user action and separately approved scopes.
- Fabricating audience demographics when YouTube does not return them.
- Building a distributed microservice platform before the product requires it.
- Replacing the existing Anna app runtime or deleting the manual public verification path.
