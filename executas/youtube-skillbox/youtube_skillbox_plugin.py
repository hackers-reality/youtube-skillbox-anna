"""YouTube Skillbox — Executa plugin powering the Anna App.

Exposes the open-source YouTube Skillbox engine (PyPI: youtube-skillbox)
as first-class Anna tools. When run as the frozen PyInstaller binary, we
ship the engine *inside* the binary; when run in dev (`python plugin.py`)
we find it via `youtube_skillbox.cli.find_skills_dir()`.
Either way the engine runs IN-PROCESS with stdout captured into a string,
so the exact same code path works everywhere.
"""

import csv
import io
import json
import re
import sys
import time
import traceback

VERSION = "0.7.0"
ENGINE_TIMEOUT = 90
AUDIT_TIMEOUT = 150

# Anna's chat-agent gateway demands a Matrix Agent ID (client_id) for
# executa_skills calls but does not always inject it. Declaring the param
# gives the caller a schema slot to pass an online ID; the engine ignores it.
CLIENT_ID_PARAM = {
    "name": "client_id",
    "type": "string",
    "description": "Matrix Agent ID used by the host to route this call. The host injects it; if it did not, pass one of the online_clients IDs from the error payload. The engine ignores this argument.",
    "required": False,
}

MANIFEST = {
    "name": "skillbox-core",
    "display_name": "YouTube Skillbox Engine",
    "version": VERSION,
    "description": (
        "Evidence-backed YouTube research from the open-source Skillbox "
        "engine: channel snapshots, outliers, keyword volume, competition "
        "difficulty, SEO scorecards, content gaps, keyword verdicts and "
        "transcripts. Every result is labelled MEASURED / INFERRED."
    ),
    "tools": [
        {
            "name": "ping",
            "description": "Smoke-test the tool. Returns pong and the engine version.",
            "parameters": [CLIENT_ID_PARAM,],
            "timeout": 10,
        },
        {
            "name": "snapshot",
            "description": "Channel snapshot: every tab count (videos/shorts/shows/playlists/community) plus the About section (subs, description, keywords). Fast.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "handle", "type": "string", "description": "Channel handle (with or without @) or channel URL.", "required": True},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "latest",
            "description": "Most recent uploads (reverse chronological), with durations and view counts.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "handle", "type": "string", "description": "Channel handle or URL.", "required": True},
                {"name": "limit", "type": "integer", "description": "Max videos to return.", "required": False, "default": 10},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "outliers",
            "description": "Videos that dramatically outperform the channel's own subscribed baseline (views/subs ratio) — the best source of repeatable ideas.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "handle", "type": "string", "description": "Channel handle or URL.", "required": True},
                {"name": "min_ratio", "type": "number", "description": "Minimum views/subs multiple.", "required": False, "default": 2.0},
            ],
            "timeout": AUDIT_TIMEOUT,
        },
        {
            "name": "scorecard",
            "description": "SEO checklist for one video: title, keyword-in-title, description, tags, chapters, freshness. Returns 0-100 and per-check results.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "video", "type": "string", "description": "Video URL or 11-char ID.", "required": True},
                {"name": "keyword", "type": "string", "description": "Target keyword for the checks.", "required": False, "default": ""},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "keywords",
            "description": "Keyword ideas + relative demand index from YouTube suggest (weighted by position) and DuckDuckGo. 0-100 opportunity score per idea.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "seed", "type": "string", "description": "Seed topic, e.g. 'youtube seo'.", "required": True},
                {"name": "limit", "type": "integer", "description": "Max ideas to return.", "required": False, "default": 25},
                {"name": "gl", "type": "string", "description": "Region code.", "required": False, "default": "US"},
                {"name": "hl", "type": "string", "description": "Language code.", "required": False, "default": "en"},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "compete",
            "description": "Competition difficulty 0-100 for a keyword from the live SERP. Higher = harder. Views(35) authority(25) titles(20) entrenchment(15) velocity(5).",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "query", "type": "string", "description": "Keyword to score.", "required": True},
                {"name": "gl", "type": "string", "description": "Region code.", "required": False, "default": "US"},
                {"name": "hl", "type": "string", "description": "Language code.", "required": False, "default": "en"},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "verdict",
            "description": "Deterministic GO / MAYBE / SKIP verdict for a keyword opportunity based on opportunity vs competition scores you supply (from keywords + compete).",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "opportunity", "type": "number", "description": "0-100 opportunity (from keywords).", "required": True},
                {"name": "competition", "type": "number", "description": "0-100 competition difficulty (from compete).", "required": True},
            ],
            "timeout": 10,
        },
        {
            "name": "track",
            "description": "Check where a video appears for a keyword in YouTube search and compare with saved position history. Results are locale-specific and only exist after a successful measurement.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "query", "type": "string", "description": "Keyword to track.", "required": True},
                {"name": "video", "type": "string", "description": "Video URL or ID.", "required": True},
                {"name": "gl", "type": "string", "description": "Two-letter region code.", "required": False, "default": "US"},
                {"name": "hl", "type": "string", "description": "Language code.", "required": False, "default": "en"},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "trends",
            "description": "Read historical keyword-demand snapshots saved by previous keyword research runs. Returns no trend until history exists.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "seed", "type": "string", "description": "Keyword seed to inspect.", "required": True},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "search",
            "description": "Search YouTube videos matching a query (locale-pinnable).",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "query", "type": "string", "description": "Search query.", "required": True},
                {"name": "limit", "type": "integer", "description": "Max results.", "required": False, "default": 10},
                {"name": "gl", "type": "string", "description": "Region code.", "required": False, "default": "US"},
                {"name": "hl", "type": "string", "description": "Language code.", "required": False, "default": "en"},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "gap",
            "description": "Keyword gap: ideas similar to a seed where your competitor's channel already holds keywords you don't. Straight from metadata.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "seed", "type": "string", "description": "Seed topic.", "required": True},
                {"name": "competitor", "type": "string", "description": "Competitor channel handle or URL.", "required": True},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "home",
            "description": "Home-tab shelves for a channel: featured video, Shorts, playlists, posts and Featured Channels (with URLs).",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "handle", "type": "string", "description": "Channel handle or URL.", "required": True},
                {"name": "limit", "type": "integer", "description": "Items per shelf.", "required": False, "default": 12},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "transcribe",
            "description": "Spoken text of any video (auto/human captions). Returns plain text. Original language + English when available.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "video", "type": "string", "description": "Video URL or 11-char ID.", "required": True},
                {"name": "language", "type": "string", "description": "Preferred language code(s), e.g. 'en' or 'es,en'.", "required": False, "default": "en"},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "hookscore",
            "description": "Deterministically score generated hook copy using the upstream five-property heuristic. Scores are copy diagnostics, not retention or performance predictions.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "hooks", "type": "array", "items": {"type": "string"}, "description": "Hook lines to score (maximum 30).", "required": True},
            ],
            "timeout": 10,
        },
        {
            "name": "title_lint",
            "description": "Lint title text against the upstream Skillbox title checks: length, mobile truncation, wording, concrete anchors and optional thumbnail duplication. Scores are heuristics, not CTR predictions.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "titles", "type": "array", "items": {"type": "string"}, "description": "Title candidates to lint (maximum 30).", "required": True},
                {"name": "thumbnail_text", "type": "string", "description": "Optional thumbnail copy to check for repeated wording.", "required": False},
            ],
            "timeout": 10,
        },
        {
            "name": "retention",
            "description": "Parse a pasted YouTube Studio retention CSV and calculate hook leak, cliffs and average slide from the actual axis. Does not invent timestamps from percent-only data.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "csv", "type": "string", "description": "Raw CSV text from the YouTube Studio audience-retention export.", "required": True},
                {"name": "duration", "type": "number", "description": "Video duration in seconds; required for seconds-based slide rates from percentage-position exports.", "required": False},
            ],
            "timeout": 10,
        },
    ],
    "credentials": [],
    "host_capabilities": [],
    "runtime": {"type": "python"},
}


def _strip_nulls(obj):
    if isinstance(obj, dict):
        return {k: _strip_nulls(v) for k, v in obj.items() if v is not None or k == "enrichment_summary"}
    if isinstance(obj, list):
        return [_strip_nulls(v) for v in obj]
    return obj


def _normalize_sections(sections):
    for key in ("videos", "shorts", "streams", "playlists", "shows"):
        if isinstance(sections, dict) and sections.get(key) is None:
            sections[key] = "no tab"
    return sections


def _engine_script():
    """Locate ytdata — frozen binary contains it as a module (PyInstaller
    hidden-import); in dev, wire the installed wheel / repo checkout into sys.path."""
    import os

    try:
        import ytdata  # noqa: F401 — freeze: already inside the binary; dev: no-op add to sys.path below

        return "<bundled>"
    except ImportError:
        from youtube_skillbox.cli import find_skills_dir

        p = find_skills_dir()
        if p not in sys.path:
            sys.path.insert(0, p)
        return p


def _run_engine(*args, timeout=ENGINE_TIMEOUT):
    """Run the engine in-process and capture its stdout."""
    try:
        _engine_script()
    except Exception as e:
        return None, "", f"engine not found: {e}"

    old_out = sys.stdout
    buf = io.StringIO()
    old_argv = sys.argv
    sys.stdout = buf
    sys.argv = ["ytdata", *args]

    err = None
    try:
        import ytdata

        ytdata.main()
    except TimeoutError:
        err = f"timeout after {timeout}s — YouTube throttled us (HTTP 429?)."
    except SystemExit:
        pass  # argparse --help and friends — captured stdout is what we want
    except Exception:
        tb = traceback.format_exc(limit=3).strip().splitlines()
        err = f"engine crashed: {tb[-1] if tb else 'unknown error'}"
    finally:
        sys.stdout = old_out
        sys.argv = old_argv

    raw = buf.getvalue().strip()
    try:
        return json.loads(raw), raw, err
    except Exception:
        return None, raw, err


def _handle_engine_result(js, raw, err):
    if err:
        return {"success": False, "error": err}
    if js is not None:
        # Anna's transport only delivers top-level JSON *objects* — a bare
        # array arrives in the bundle as {}. Always wrap lists.
        if isinstance(js, list):
            js = {"items": js}
        return {"success": True, "data": _strip_nulls(js)}
    return {"success": True, "data": {"raw": raw or "(no output)"}}


def _eng(*args, timeout=ENGINE_TIMEOUT):
    js, raw, err = _run_engine(*args, timeout=timeout)
    return _handle_engine_result(js, raw, err)


def _norm_handle(h):
    h = (h or "").strip()
    if not h:
        return h
    if h.startswith("http"):
        return h
    if not h.startswith("@"):
        h = "@" + h
    return h


def _norm_video(v):
    return (v or "").strip()


def _engine_version():
    try:
        from importlib.metadata import version

        return version("youtube-skillbox")
    except Exception:
        return "?"


def _verdict(opp, comp):
    if opp >= 70 and comp <= 40:
        call = "GO"
    elif opp >= 50 and comp < 50:
        call = "GO"
    elif opp >= 40 and comp < 65:
        call = "MAYBE"
    else:
        call = "SKIP"
    return {
        "verdict": call,
        "opportunity": opp,
        "competition": comp,
        "label": "heuristic — not a ranking prediction",
    }


def _transcribe(video: str, language: str) -> dict:
    if not video:
        return {"success": False, "error": "video URL or ID required"}
    try:
        import yt_dlp
        from yt_dlp import YoutubeDL
    except ImportError:
        return {"success": False, "error": "yt-dlp not installed in this runtime"}
    url = video if video.startswith("http") else f"https://www.youtube.com/watch?v={video}"
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": [language, "en"] if language != "en" else ["en"],
        "subtitlesformat": "vtt",
    }
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        caps = info.get("requested_subtitles") or {}
        chosen = None
        for lang in [language, "en"] + list(caps):
            if caps.get(lang):
                chosen = lang
                break
        if chosen is None:
            return {"success": False, "error": "no captions available for this video"}
        import urllib.request

        raw = urllib.request.urlopen(caps[chosen].get("url"), timeout=30).read().decode("utf-8", "replace")
        text = _vtt_to_text(raw)
        return {
            "success": True,
            "data": {
                "video_id": info.get("id"),
                "channel": info.get("channel"),
                "title": info.get("title"),
                "language": chosen,
                "generated": chosen not in (info.get("subtitles") or {}),
                "transcript": text.strip(),
            },
        }
    except Exception as e:
        return {"success": False, "error": f"transcribe failed: {e}"}


def _vtt_to_text(vtt: str) -> str:
    import re

    lines = []
    for line in vtt.splitlines():
        line = line.strip()
        if not line or line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
            continue
        if "-->" in line:
            continue
        if re.match(r"^\d{2}:\d{2}|^\d+$", line):
            continue
        line = re.sub(r"<[^>]+>", "", line)
        lines.append(line)
    out = []
    for ln in lines:
        if out and out[-1] == ln:
            continue
        out.append(ln)
    return " ".join(out)



def _hookscore(hooks):
    """Port of the upstream yt-script hookscore heuristic; scores copy, not outcomes."""
    filler = {"basically", "actually", "literally", "just", "really", "very", "so", "kind", "sort",
              "like", "guys", "hey", "welcome", "today", "video", "subscribe", "channel"}
    vague = {"amazing", "incredible", "insane", "crazy", "huge", "massive", "game", "changer",
             "secret", "powerful", "ultimate", "best", "revolutionary", "mind", "blowing", "unbelievable"}
    concrete = re.compile(r"\b(\d[\d,.]*\s?(%|k|m|x|s|m|h)?|\$\d|\d+\s?(second|minute|hour|day|week|month|year)s?)\b", re.I)
    you = re.compile(r"\b(you|your|you're|youre|yourself)\b", re.I)
    stake = re.compile(r"\b(lose|lost|wasting|waste|quit|fail|broke|cost|risk|before|stop|never|die|dying|dead)\b", re.I)
    curiosity = re.compile(r"\b(why|how|what|which|until|before|but|nobody|almost|except|reason|actually)\b", re.I)
    fixes = {
        "SPECIFICITY": "replace an adjective with a verifiable number, name or date",
        "ADDRESS": "speak directly to the viewer in the first six words",
        "STAKES": "make the consequence of ignoring the idea concrete",
        "CURIOSITY": "leave an unanswered question the video can genuinely resolve",
        "BREVITY": "aim for a clean spoken line of roughly 9–24 words",
    }

    def words(text):
        return re.findall(r"[a-z0-9'%$.]+", text.lower())

    rows = []
    for index, raw in enumerate(hooks):
        text = str(raw or "").strip()
        if not text:
            continue
        tokens = words(text)
        nums = len(concrete.findall(text))
        vague_count = sum(1 for token in tokens if token in vague)
        filler_count = sum(1 for token in tokens if token in filler)
        named = sum(1 for token in text.split()[1:] if token[:1].isupper())
        specificity = max(0, min(100, 34 + nums * 22 - vague_count * 16 - filler_count * 5 + min(18, 6 * named)))
        direct_count = len(you.findall(text))
        first_six = 30 if you.search(" ".join(text.split()[:6])) else 0
        address = max(0, min(100, 26 + direct_count * 20 + first_six))
        stake_count = len(stake.findall(text))
        stakes = max(0, min(100, 22 + stake_count * 26 + (14 if concrete.search(text) else 0)))
        curiosity_count = len(curiosity.findall(text))
        question_bonus = 18 if text.rstrip().endswith("?") else 0
        closed_gap = -18 if re.search(r"\b(because|so that|which means)\b", text, re.I) else 0
        curiosity_score = max(0, min(100, 24 + curiosity_count * 17 + question_bonus + closed_gap))
        word_count = len(tokens)
        if word_count == 0:
            brevity = 0
        elif 9 <= word_count <= 24:
            brevity = 100
        elif word_count < 9:
            brevity = max(30, 100 - (9 - word_count) * 11)
        else:
            brevity = max(10, 100 - (word_count - 24) * 7)
        properties = {
            "SPECIFICITY": specificity,
            "ADDRESS": address,
            "STAKES": stakes,
            "CURIOSITY": curiosity_score,
            "BREVITY": brevity,
        }
        values = list(properties.values())
        score = round(0.6 * (sum(values) / len(values)) + 0.4 * min(values))
        band = "STRONG" if score >= 72 else "WORKABLE" if score >= 55 else "WEAK"
        weakest = min(properties, key=properties.get)
        rows.append({
            "index": index,
            "hook": text,
            "properties": properties,
            "score": score,
            "band": band,
            "weakest": weakest,
            "fix": fixes[weakest],
            "score_type": "heuristic copy analysis; not a retention or performance prediction",
        })
    rows.sort(key=lambda row: (-row["score"], row["index"]))
    return {"count": len(rows), "scored_hooks": rows}


def _title_lint(titles, thumbnail_text=None):
    """Port of the upstream yt-package title checker. Scores are text heuristics."""
    vague = {"amazing", "incredible", "insane", "crazy", "huge", "massive", "ultimate", "best",
             "powerful", "secret", "revolutionary", "mindblowing", "epic", "perfect", "complete", "everything"}
    stop = {"the", "a", "an", "of", "for", "to", "in", "on", "and", "or", "is", "are", "with", "your", "you", "my",
            "i", "this", "that", "it", "how", "what", "why"}

    def words(text):
        return re.findall(r"[a-z0-9']+", text.lower())

    results = []
    for index, raw in enumerate(titles):
        title = str(raw or "").strip()
        if not title:
            continue
        length = len(title)
        issues, good = [], []
        if length > 100:
            issues.append(("length", f"{length} characters — exceeds the 100-character hard limit"))
        elif length > 60:
            issues.append(("length", f"{length} characters — likely truncation around 60 characters on desktop"))
        else:
            good.append(f"{length} characters, within the approximate 60-character desktop display length")
        if length > 40:
            visible_head = title[:40].rsplit(" ", 1)[0]
            issues.append(("mobile", f'mobile may show only "{visible_head}…" — check that the subject survives'))
        caps = [word for word in title.split() if len(word) > 2 and word.isupper()]
        if len(caps) > 2:
            issues.append(("shouting", f"{len(caps)} all-caps words — more than two can read as spam"))
        elif caps:
            good.append(f"{len(caps)} all-caps word for emphasis")
        vague_words = [word for word in words(title) if word in vague]
        if vague_words:
            issues.append(("vague", f"{', '.join(sorted(set(vague_words)))} — replace with a number, name or date"))
        numbers = re.findall(r"\d[\d,.]*%?", title)
        if numbers:
            good.append(f"contains a concrete figure ({', '.join(numbers[:3])})")
        else:
            issues.append(("no-number", "no number, date or named subject — consider adding a concrete anchor"))
        if title.endswith("?"):
            good.append("uses an open question")
        front = [word for word in words(title)[:3] if word not in stop]
        if not front:
            issues.append(("front-load", "the first three words are filler — move the subject forward"))
        if thumbnail_text:
            title_words = set(words(title)) - stop
            thumbnail_words = set(words(str(thumbnail_text))) - stop
            shared = title_words & thumbnail_words
            if shared:
                issues.append(("duplicate", f"thumbnail repeats title wording: {', '.join(sorted(shared))}"))
            else:
                good.append("thumbnail text and title use different wording")
            thumb_count = len(words(str(thumbnail_text)))
            if thumb_count > 4:
                issues.append(("thumb-length", f"{thumb_count} words on the thumbnail — keep it to four or fewer"))
        score = max(0, min(100, 100 - 14 * len(issues) + 4 * len(good)))
        results.append({
            "index": index,
            "title": title,
            "characters": length,
            "heuristic_score": score,
            "issues": [{"code": code, "detail": detail} for code, detail in issues],
            "good": good,
            "thumbnail_text": thumbnail_text or None,
            "score_type": "heuristic title-text lint; not a CTR, ranking or view prediction",
        })
    results.sort(key=lambda row: (-row["heuristic_score"], row["index"]))
    return {"count": len(results), "titles": results}


def _parse_retention_csv(csv_text, duration_seconds=None):
    """Parse pasted Studio retention data without inventing a time axis."""
    if not isinstance(csv_text, str) or not csv_text.strip():
        return {"error": "Paste a non-empty YouTube Studio retention CSV."}
    text = csv_text.lstrip("\ufeff").strip()
    sample = "\n".join(text.splitlines()[:8])
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        return {"error": "CSV header row is missing."}

    def normalize(value):
        raw = str(value or "").strip().lower().replace("%", "pct")
        return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", raw)).strip("_")

    headers = {normalize(name): name for name in reader.fieldnames}
    time_col = None
    retention_col = None
    for key, original in headers.items():
        if "video_position" in key or ("elapsed" in key and "time" in key) or ("time" in key and "position" in key):
            time_col = original
        elif key in {"seconds", "second", "time_seconds", "elapsed_seconds", "timestamp"}:
            time_col = original
        if "audience" in key and "retention" in key:
            retention_col = original
    if not time_col:
        for key, original in headers.items():
            if "video" in key and "position" in key and ("pct" in key or "percent" in key):
                time_col = original
                break
    if not retention_col:
        for key, original in headers.items():
            if ("retention" in key and ("pct" in key or "percent" in key)) or key in {
                "retention", "retention_pct", "percentage_watched", "percent_watched"
            }:
                retention_col = original
                break
    if not time_col or not retention_col:
        return {
            "error": "Could not identify the time/position and audience-retention columns.",
            "columns": [str(name) for name in reader.fieldnames],
            "expected": "Video position (%) + Percentage watched, or Elapsed time + Audience retention",
        }

    duration = None
    try:
        if duration_seconds not in (None, ""):
            duration = float(duration_seconds)
            if duration <= 0:
                return {"error": "Video duration must be a positive number of seconds."}
    except (TypeError, ValueError):
        return {"error": "Video duration must be a positive number of seconds."}

    def parse_time(value):
        raw = str(value or "").strip()
        if ":" not in raw:
            return float(raw)
        parts = [float(part) for part in raw.split(":")]
        seconds = 0.0
        for part in parts:
            seconds = seconds * 60 + part
        return seconds

    position_is_pct = "pct" in normalize(time_col) or "percent" in normalize(time_col)
    points = []
    for row in reader:
        try:
            raw_time = row.get(time_col)
            raw_retention = str(row.get(retention_col) or "").replace("%", "").replace(",", "").strip()
            retention_value = float(raw_retention)
            if not (-1000 <= retention_value <= 1000):
                continue
            if ":" in str(raw_time):
                seconds = parse_time(raw_time)
                pct = (seconds / duration * 100.0) if duration else None
                axis_value = seconds
                original_is_pct = False
            elif position_is_pct:
                pct = float(str(raw_time).replace("%", "").strip())
                seconds = (pct / 100.0 * duration) if duration else None
                axis_value = pct
                original_is_pct = True
            else:
                seconds = float(str(raw_time).strip())
                pct = (seconds / duration * 100.0) if duration else None
                axis_value = seconds
                original_is_pct = False
            points.append({
                "time_seconds": round(seconds, 3) if seconds is not None else None,
                "time_pct": round(pct, 3) if pct is not None else None,
                "retention_pct": retention_value,
                "axis_value": axis_value,
                "original_time_is_pct": original_is_pct,
            })
        except (TypeError, ValueError):
            continue

    if len(points) < 2:
        return {"error": "At least two numeric retention readings are required.", "rows_read": len(points)}
    points.sort(key=lambda point: point["axis_value"])
    time_is_pct = points[0]["original_time_is_pct"]
    early_limit = 30.0
    early = [point for point in points if point["axis_value"] <= early_limit]
    if early:
        start_retention = points[0]["retention_pct"]
        min_early = min(point["retention_pct"] for point in early)
        leak = round(start_retention - min_early, 1)
        hook_leak = {
            "loss_points": leak,
            "start_retention_pct": start_retention,
            "minimum_early_retention_pct": min_early,
            "window": "first 30% of video" if time_is_pct else "first 30 seconds",
            "axis": "%" if time_is_pct else "seconds",
            "severity": "healthy" if leak < 25 else "moderate" if leak < 40 else "severe",
        }
    else:
        hook_leak = {
            "loss_points": None,
            "window": "first 30% of video" if time_is_pct else "first 30 seconds",
            "axis": "%" if time_is_pct else "seconds",
            "severity": "unknown",
            "note": "No readings inside the early-retention window.",
        }

    cliffs = []
    for previous, current in zip(points, points[1:]):
        drop = round(previous["retention_pct"] - current["retention_pct"], 1)
        if drop >= 5.0:
            cliffs.append({
                "from": previous["axis_value"],
                "to": current["axis_value"],
                "axis": "%" if time_is_pct else "seconds",
                "drop_points": drop,
                "retention_before_pct": previous["retention_pct"],
                "retention_after_pct": current["retention_pct"],
            })

    slopes = []
    for previous, current in zip(points, points[1:]):
        t0, t1 = previous["time_seconds"], current["time_seconds"]
        if t0 is not None and t1 is not None and t1 > t0:
            slopes.append((previous["retention_pct"] - current["retention_pct"]) / ((t1 - t0) / 60.0))
    if slopes:
        average_slide = round(sum(slopes) / len(slopes), 2)
        slide = {
            "average_loss_points_per_minute": average_slide,
            "severity": "healthy" if average_slide < 1 else "moderate" if average_slide < 3 else "severe",
        }
    else:
        slide = {
            "average_loss_points_per_minute": None,
            "severity": "not available",
            "note": "A percentage-only axis needs video duration before a per-minute slide rate can be calculated.",
        }

    return {
        "measured": True,
        "rows_read": len(points),
        "axis": "percentage of video" if time_is_pct else "elapsed seconds",
        "duration_seconds": duration,
        "hook_leak": hook_leak,
        "cliffs": cliffs,
        "slide": slide,
        "points": [
            {"time": point["axis_value"], "axis": "%" if time_is_pct else "seconds", "retention_pct": point["retention_pct"]}
            for point in points
        ],
        "thresholds": {
            "hook_leak": "first 30 seconds or first 30% of video; loss >=25 points is moderate",
            "cliff": "adjacent drop >=5 percentage points",
            "slide": "average loss per minute; requires elapsed seconds",
        },
        "limitations": [
            "A pasted CSV does not preserve the original export filename, so absolute-versus-relative export semantics cannot always be confirmed.",
            "These findings describe the supplied retention curve; they do not establish why viewers left.",
        ],
    }


def invoke(method: str, args: dict) -> dict:
    a = args or {}
    try:
        if method == "ping":
            return {
                "success": True,
                "data": {"pong": True, "engine": f"youtube-skillbox {_engine_version()}"},
            }
        if method == "snapshot":
            handle = _norm_handle(a.get("handle"))
            sections = _eng("sections", handle, "--json", timeout=ENGINE_TIMEOUT)
            profile = _eng("profile", handle, "--json", timeout=ENGINE_TIMEOUT)
            if sections.get("success") and profile.get("success"):
                sec = sections["data"]
                if isinstance(sec, dict):
                    sec = _normalize_sections(sec)
                return {"success": True, "data": {"sections": sec, "profile": profile["data"]}}
            return {
                "success": False,
                "error": f"sections: {_err_str(sections)} | profile: {_err_str(profile)}",
            }
        if method == "latest":
            return _eng("latest", _norm_handle(a.get("handle")), "--limit", str(int(a.get("limit", 10))), "--json", timeout=ENGINE_TIMEOUT)
        if method == "outliers":
            return _eng("outliers", _norm_handle(a.get("handle")), "--min-ratio", str(float(a.get("min_ratio", 2.0))), "--json", timeout=AUDIT_TIMEOUT)
        if method == "scorecard":
            args2 = ["scorecard", _norm_video(a.get("video"))]
            kw = (a.get("keyword") or "").strip()
            if kw:
                args2 += ["--keyword", kw]
            args2.append("--json")
            return _eng(*args2, timeout=ENGINE_TIMEOUT)
        if method == "keywords":
            return _eng("keywords", str(a.get("seed", "")).strip(), "--limit", str(int(a.get("limit", 25))),
                        "--gl", str(a.get("gl", "US")), "--hl", str(a.get("hl", "en")),
                        "--json", timeout=ENGINE_TIMEOUT)
        if method == "compete":
            return _eng("compete", str(a.get("query", "")).strip(), "--top", "10", "--gl", str(a.get("gl", "US")), "--hl", str(a.get("hl", "en")), "--json", timeout=ENGINE_TIMEOUT)
        if method == "verdict":
            return {"success": True, "data": _verdict(float(a.get("opportunity", 0)), float(a.get("competition", 0)))}
        if method == "search":
            return _eng("search", str(a.get("query", "")).strip(), "--limit", str(int(a.get("limit", 10))), "--gl", str(a.get("gl", "US")), "--hl", str(a.get("hl", "en")), "--json", timeout=ENGINE_TIMEOUT)
        if method == "track":
            return _eng("track", str(a.get("query", "")).strip(), "--video", _norm_video(a.get("video")),
                        "--gl", str(a.get("gl", "US")), "--hl", str(a.get("hl", "en")),
                        "--json", timeout=ENGINE_TIMEOUT)
        if method == "trends":
            return _eng("trends", str(a.get("seed", "")).strip(), "--json", timeout=ENGINE_TIMEOUT)
        if method == "gap":
            return _eng("gap", str(a.get("seed", "")).strip(), "--competitor", _norm_handle(a.get("competitor")), "--json", timeout=ENGINE_TIMEOUT)
        if method == "home":
            return _eng("home", _norm_handle(a.get("handle")), "--limit", str(int(a.get("limit", 12))), "--json", timeout=ENGINE_TIMEOUT)
        if method == "transcribe":
            return _transcribe(str(a.get("video", "")).strip(), str(a.get("language", "en")).strip() or "en")
        if method == "hookscore":
            hooks = a.get("hooks")
            if not isinstance(hooks, list) or not hooks:
                return {"success": False, "error": "hooks must be a non-empty array of strings"}
            return {"success": True, "data": _hookscore(hooks[:30])}
        if method == "title_lint":
            titles = a.get("titles")
            if isinstance(titles, str):
                titles = [titles]
            if not isinstance(titles, list) or not titles:
                return {"success": False, "error": "titles must be a non-empty array of strings"}
            return {"success": True, "data": _title_lint(titles[:30], a.get("thumbnail_text"))}
        if method == "retention":
            return {"success": True, "data": _parse_retention_csv(a.get("csv", ""), a.get("duration"))}
        return {"success": False, "error": f"unknown method: {method}"}
    except Exception as e:
        return {"success": False, "error": f"{method} crashed: {e}"}


def _err_str(res):
    if res.get("success"):
        return "ok"
    return str(res.get("error", "unknown error"))[:200]


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            sys.stdout.write(
                json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": f"parse error: {e}"}})
                + "\n"
            )
            continue
        try:
            method = req.get("method")
            if method == "describe":
                result = MANIFEST
            elif method == "health":
                result = {"status": "ready"}
            elif method == "invoke":
                params = req.get("params") or {}
                result = invoke(params.get("tool"), params.get("arguments") or {})
            else:
                raise ValueError(f"unknown rpc: {method}")
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": req.get("id"), "result": result}) + "\n")
        except Exception as e:  # noqa: BLE001
            sys.stdout.write(
                json.dumps(
                    {"jsonrpc": "2.0", "id": req.get("id"), "error": {"code": -32601, "message": str(e)}}
                )
                + "\n"
            )
        sys.stdout.flush()


if __name__ == "__main__":
    main()





