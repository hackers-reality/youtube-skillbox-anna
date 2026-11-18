---
name: youtube-skillbox-research
description: Research a YouTube channel, explain public upload performance and outliers, find keyword and competitor opportunities, inspect thumbnails or transcripts, or interpret a creator's retention CSV/ZIP with evidence instead of guesses.
metadata: {"matrix":{"emoji":"▶️","execution_mode":"prompt","category_name":"creator-tools"}}
---

# YouTube Skillbox Research

Use the YouTube Skillbox Engine Executa for measured YouTube research when it is available to this Anna session. The app UI is not required for ordinary tool-backed research. The engine is separate from the `#youtube-skillbox-anna` app; the app adds visual audit, thumbnail review, channel verification, and retention-file views.

## Evidence rules

- Label returned public/tool data **MEASURED**. Label explanations **INFERRED**. Label ideas and unverified causes **HYPOTHESIS** or **RECOMMENDATION**.
- Never infer CTR, private audience retention, impressions, watch time, or YouTube's causal recommendation decisions from public view counts.
- A view/subscriber outlier ratio is a descriptive public ratio, not proof of why a video succeeded.
- If a tool errors, times out, or returns no rows, report that measurement as unavailable. Do not substitute guessed values or call an incomplete audit complete.
- Ask for the creator's YouTube Studio CSV/ZIP when owner-only retention is needed. Analyze every distinct CSV metric separately; retain percentage axes as percentages unless elapsed time or a valid duration is supplied.
- Use public data only. Never request a password, API key, OAuth token, or YouTube account access. Channel verification is a separate manual flow inside the app.

## Choose the smallest useful research path

Use the Engine's methods by intent:

| User goal | Engine methods |
|---|---|
| Identify a channel | `profile(handle)`; accepts a handle, channel URL, or channel ID |
| Recent uploads or Shorts | `channel(handle, limit, tab)` or `latest(handle, limit)` |
| Full public-surface audit | `profile`, `channel` for videos and Shorts, `outliers`, then `posts`, `home`, or `shows` only when those surfaces matter |
| Investigate outliers | `outliers(handle, min_ratio)`; compare against the channel's own public baseline |
| Explore a topic | `keywords(seed, limit, gl, hl)` and `search(query, limit, gl, hl)` |
| Check search competition | `compete(query, gl, hl)`; use `verdict(opportunity, competition)` only with measured scores from the matching research |
| Compare a competitor | `gap(seed, competitor)` only when a competitor handle/channel is known or the user confirms a discovered candidate; do not silently label an arbitrary search result as their competitor |
| Inspect public channel layout | `home(handle, limit)`, `shows(handle, limit)`, `posts(handle, limit)` |
| Fetch captions | `transcribe(video, language)`; report missing captions as unavailable |
| Video metadata / SEO | `info(video)` and `scorecard(video, keyword)` |
| Creator-provided retention data | `retention(csv, duration)` for each applicable CSV; the Anna App visualizes multi-file ZIP exports and history |

Use conservative limits and avoid duplicate requests. For a simple question, do not run a full channel audit. For "audit my channel" or "why are views uneven?", gather profile, a bounded recent-upload sample, and outliers; add transcript or keyword evidence only if it answers the question. Explain which measurements were returned and which were unavailable.

## Thumbnail and content analysis

The engine returns public metadata and thumbnail URLs, not a measured thumbnail-performance score. To score visual clarity, contrast, hierarchy, legibility, or promise match, the image itself must be available to a vision-capable model. Use the Anna App's image-aware workflow when available; otherwise ask the user to attach the thumbnail. Label visual judgments **INFERRED** and never present them as CTR predictions.

Use transcripts as source evidence for hook, chapter, edit, and Shorts suggestions. Cite actual cue timecodes; never invent timestamps or claim footage was inspected. Retention drops can only be correlated with spoken content when the creator provides both retention data and a timestamped transcript.

## If the Engine is unavailable

Do not pretend to have executed research. Ask the user to open or mention the YouTube Skillbox Anna App, or continue with clearly labeled general advice that does not claim channel measurements. The standalone Skill teaches the workflow; the separately installed Engine Executa supplies the live methods.
