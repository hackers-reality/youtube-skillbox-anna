"""YouTube Skillbox â€” Executa plugin powering the Anna App.

Exposes the open-source YouTube Skillbox engine (PyPI: youtube-skillbox)
as first-class Anna tools. When run as the frozen PyInstaller binary, we
ship the engine *inside* the binary; when run in dev (`python plugin.py`)
we find it via `youtube_skillbox.cli.find_skills_dir()`.
Either way the engine runs IN-PROCESS with stdout captured into a string,
so the exact same code path works everywhere.
"""

import csv
from concurrent.futures import ThreadPoolExecutor
import html
import io
import json
import re
import sys
import time
import traceback
import threading

# Module-level lock to serialize _run_engine calls (prevents stdout/stderr/argv corruption under concurrency)
_ENGINE_LOCK = threading.Lock()

VERSION = "0.7.1"
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
            "name": "profile",
            "description": "Fetch the public channel identity: name, handle, channel URL, avatar/profile metadata, subscriber count, description and tags.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "handle", "type": "string", "description": "Channel handle (with or without @), channel URL or channel ID.", "required": True},
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
            "name": "channel",
            "description": "List a channel's recent uploads from the videos, Shorts or livestreams tab. Optional duration and full metadata enrichment.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "handle", "type": "string", "description": "YouTube channel handle or URL.", "required": True},
                {"name": "limit", "type": "integer", "description": "Maximum items to return.", "required": False, "default": 15},
                {"name": "tab", "type": "string", "description": "videos, shorts or streams.", "required": False, "default": "videos"},
                {"name": "with_duration", "type": "boolean", "description": "Enrich rows with duration in seconds.", "required": False, "default": False},
                {"name": "full_meta", "type": "boolean", "description": "Enrich rows with full video metadata.", "required": False, "default": False},
            ],
            "timeout": AUDIT_TIMEOUT,
        },
        {
            "name": "posts",
            "description": "Fetch recent public YouTube Community posts from a channel, including text, author, publication label and available likes/attachments.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "handle", "type": "string", "description": "YouTube channel handle or URL.", "required": True},
                {"name": "limit", "type": "integer", "description": "Maximum posts to return.", "required": False, "default": 10},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "shows",
            "description": "List public YouTube Shows (episode collections) from a channel.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "handle", "type": "string", "description": "YouTube channel handle or URL.", "required": True},
                {"name": "limit", "type": "integer", "description": "Maximum shows to return.", "required": False, "default": 20},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "playlist",
            "description": "List public videos in a YouTube playlist.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "playlist", "type": "string", "description": "YouTube playlist URL or ID.", "required": True},
                {"name": "limit", "type": "integer", "description": "Maximum videos to return.", "required": False, "default": 20},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "info",
            "description": "Fetch public metadata for one YouTube video: views, likes, date, duration, tags, categories and description excerpt.",
            "parameters": [CLIENT_ID_PARAM,
                {"name": "video", "type": "string", "description": "YouTube video URL or ID.", "required": True},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "outliers",
            "description": "Videos that dramatically outperform the channel's own subscribed baseline (views/subs ratio) â€” the best source of repeatable ideas.",
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
                {"name": "letters", "type": "string", "description": "Optional suffix expansion alphabet; an empty string disables alphabet expansion.", "required": False, "default": "abcdefghijklmnopqrstuvwxyz"},
                {"name": "patterns", "type": "boolean", "description": "Also query common how/why/best/beginner/comparison/year topic patterns.", "required": False, "default": False},
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
            "description": "Fetch manual or auto captions, preferring the original spoken language plus English. Returns plain transcript text and timestamped caption segments.",
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
    """Locate ytdata â€” frozen binary contains it as a module (PyInstaller
    hidden-import); in dev, wire the installed wheel / repo checkout into sys.path."""
    from pathlib import Path

    # In a source checkout, prefer the adjacent engine so `anna-app dev` actually
    # exercises the code being edited. In a frozen build this path points into
    # PyInstaller's extraction directory and its bundled ytdata.py is valid too.
    local_engine = Path(__file__).resolve().parent / "engine"
    if (local_engine / "ytdata.py").is_file():
        local_path = str(local_engine)
        if local_path in sys.path:
            sys.path.remove(local_path)
        sys.path.insert(0, local_path)
        import ytdata  # noqa: F401

        return local_path

    try:
        import ytdata  # noqa: F401 â€” freeze: already inside the binary; dev: no-op add to sys.path below

        return "<bundled>"
    except ImportError:
        from youtube_skillbox.cli import find_skills_dir

        p = find_skills_dir()
        if p not in sys.path:
            sys.path.insert(0, p)
        return p


def _run_engine(*args, timeout=ENGINE_TIMEOUT):
    """Run the engine in-process and capture its stdout. Thread-safe via _ENGINE_LOCK."""
    with _ENGINE_LOCK:
        try:
            _engine_script()
        except Exception as e:
            return None, "", f"engine not found: {e}"

        old_out = sys.stdout
        old_err = sys.stderr
        buf = io.StringIO()
        err_buf = io.StringIO()
        old_argv = sys.argv
        sys.stdout = buf
        sys.stderr = err_buf
        sys.argv = ["ytdata", *args]

    err = None
    try:
        import ytdata

        ytdata.main()
    except TimeoutError:
        err = f"timeout after {timeout}s â€” YouTube throttled us (HTTP 429?)."
    except SystemExit as exc:
        if exc.code not in (None, 0):
            diagnostic = err_buf.getvalue().strip()
            err = diagnostic or f"engine exited with status {exc.code}"
    except Exception:
        tb = traceback.format_exc(limit=3).strip().splitlines()
        err = f"engine crashed: {tb[-1] if tb else 'unknown error'}"
    finally:
        sys.stdout = old_out
        sys.stderr = old_err
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
        # Anna's transport only delivers top-level JSON *objects* â€” a bare
        # array arrives in the bundle as {}. Always wrap lists.
        if isinstance(js, list):
            js = {"items": js}
        return {"success": True, "data": _strip_nulls(js)}
    return {"success": True, "data": {"raw": raw or "(no output)"}}


def _eng(*args, timeout=ENGINE_TIMEOUT):
    js, raw, err = _run_engine(*args, timeout=timeout)
    return _handle_engine_result(js, raw, err)


def _with_public_avatar(result):
    """Fill older bundled-engine profile responses with the public channel image."""
    if not result.get("success") or not isinstance(result.get("data"), dict):
        return result
    data = result["data"]
    if data.get("avatar_url") or data.get("avatar") or not data.get("channel_url"):
        return result
    try:
        from urllib.request import Request, urlopen
        from urllib.parse import urlparse

        parsed = urlparse(data["channel_url"])
        if parsed.scheme != "https" or parsed.hostname not in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
            return result
        request = Request(
            data["channel_url"],
            headers={"User-Agent": "Mozilla/5.0 (compatible; YouTubeSkillbox/1.0)"},
        )
        with urlopen(request, timeout=12) as response:
            final_host = urlparse(response.geturl()).hostname
            if final_host not in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
                return result
            page = response.read(2_000_000).decode("utf-8", "replace")
        for tag in re.findall(r"<meta\b[^>]*>", page, flags=re.I):
            prop = re.search(r"(?:property|name)=[\"']og:image[\"']", tag, flags=re.I)
            content = re.search(r"content=[\"']([^\"']+)", tag, flags=re.I)
            if prop and content:
                data["avatar_url"] = html.unescape(content.group(1))
                break
    except Exception:
        # Profile identity and verification remain usable when image metadata is blocked.
        pass
    return result


def _with_public_home_avatars(result):
    """Fill missing featured-channel artwork from each channel's public page.

    Home shelf renderers sometimes omit the avatar even when the channel page
    exposes it. Fetch only channel shelf entries, in a small bounded pool, so
    the explorer and chat receive the same image evidence without serial waits.
    """
    if not result.get("success") or not isinstance(result.get("data"), (dict, list)):
        return result
    data = result["data"]
    sections = data if isinstance(data, list) else data.get("items", [])
    if not isinstance(sections, list):
        return result
    targets = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        items = section.get("items", [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict) or item.get("thumbnail") or item.get("avatar_url"):
                continue
            if str(item.get("kind", "")).lower() != "channel" and str(section.get("type", "")).lower() != "featured channels":
                continue
            url = item.get("url")
            if not url and re.fullmatch(r"UC[\w-]{22}", str(item.get("id", ""))):
                url = f"https://www.youtube.com/channel/{item['id']}"
            if isinstance(url, str) and url.startswith("https://www.youtube.com/"):
                targets.append((item, url))
            if len(targets) >= 15:
                break
        if len(targets) >= 15:
            break

    def fetch_avatar(target):
        item, url = target
        profile = _with_public_avatar({"success": True, "data": {"channel_url": url}})
        avatar = profile.get("data", {}).get("avatar_url")
        if avatar:
            item["thumbnail"] = avatar

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch_avatar, targets))
    return result


def _norm_handle(h):
    h = (h or "").strip()
    if not h:
        return h
    if h.startswith("http"):
        return h
    if re.fullmatch(r"UC[\w-]{10,}", h):
        return "https://www.youtube.com/channel/" + h
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
        "label": "heuristic â€” not a ranking prediction",
    }


def _parse_vtt_clock(value: str):
    """Convert a WebVTT timestamp to seconds without guessing missing fields."""
    raw = str(value or "").strip().split()[0]
    parts = raw.split(":")
    try:
        if len(parts) == 3:
            hours, minutes, seconds = parts
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
        if len(parts) == 2:
            minutes, seconds = parts
            return int(minutes) * 60 + float(seconds)
    except (TypeError, ValueError):
        return None
    return None


def _vtt_to_segments(vtt: str):
    """Parse WebVTT caption cues into timestamped transcript segments."""
    lines = vtt.lstrip("\ufeff").splitlines()
    segments = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if "-->" not in line:
            index += 1
            continue

        left, right = line.split("-->", 1)
        start = _parse_vtt_clock(left)
        end = _parse_vtt_clock(right)
        index += 1
        cue_lines = []
        while index < len(lines) and lines[index].strip():
            cue_lines.append(lines[index].strip())
            index += 1
        text = " ".join(cue_lines)
        text = re.sub(r"<[^>]+>", "", text)
        text = html.unescape(re.sub(r"\s+", " ", text)).strip()
        if start is None or end is None or end <= start or not text:
            continue
        if segments and segments[-1]["text"] == text and abs(segments[-1]["start"] - start) < 0.05:
            continue
        segments.append({
            "text": text,
            "start": round(start, 3),
            "duration": round(end - start, 3),
            "end": round(end, 3),
        })
    return segments


def _vtt_to_text(vtt: str) -> str:
    return " ".join(segment["text"] for segment in _vtt_to_segments(vtt)).strip()


def _detect_original_caption_language(info):
    """Mirror the upstream transcript skill's original-language heuristic."""
    for key in ("subtitles", "automatic_captions"):
        tracks = info.get(key) or {}
        for lang in sorted(tracks):
            if str(lang).endswith("-orig"):
                return str(lang)[:-5]
        for lang in sorted(tracks):
            if lang == "en":
                return "en"
    return None


def _transcribe(video: str, language: str) -> dict:
    if not video:
        return {"success": False, "error": "video URL or ID required"}
    try:
        from yt_dlp import YoutubeDL
    except ImportError:
        return {"success": False, "error": "yt-dlp not installed in this runtime"}

    url = video if video.startswith("http") else f"https://www.youtube.com/watch?v={video}"
    requested_language = str(language or "auto").strip().lower()
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitlesformat": "vtt",
    }
    try:
        # Enumerate available tracks first; do not silently treat English
        # auto-translation as the original spoken language.
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

        manual = info.get("subtitles") or {}
        automatic = info.get("automatic_captions") or {}
        available = list(dict.fromkeys([*manual.keys(), *automatic.keys()]))
        if requested_language in {"", "auto", "original"}:
            original_language = _detect_original_caption_language(info)
            if not original_language:
                return {
                    "success": False,
                    "error": "could not determine the original caption language; choose a language explicitly",
                    "available_languages": available[:40],
                }
            preference = [original_language]
            if original_language != "en":
                preference.append("en")
        else:
            original_language = None
            preference = [requested_language]
            if requested_language != "en":
                preference.append("en")

        opts["subtitleslangs"] = [f"{lang}.*" for lang in preference]
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        caps = info.get("requested_subtitles") or {}

        chosen = None
        for preferred in preference:
            candidates = [
                code for code in caps
                if code == preferred or str(code).startswith(preferred + "-")
            ]
            candidates.sort(key=lambda code: (
                0 if str(code).endswith("-orig") else 1,
                0 if code in manual else 1,
                str(code),
            ))
            if candidates:
                chosen = candidates[0]
                break
        if chosen is None:
            return {
                "success": False,
                "error": "no captions available for the requested original-language/English pair",
                "requested_languages": preference,
                "available_languages": available[:40],
            }

        import urllib.request
        subtitle_url = caps[chosen].get("url")
        if not subtitle_url:
            return {"success": False, "error": "the selected caption track did not include a download URL"}
        raw = urllib.request.urlopen(subtitle_url, timeout=30).read().decode("utf-8", "replace")
        segments = _vtt_to_segments(raw)
        transcript = " ".join(segment["text"] for segment in segments).strip()
        if not transcript:
            return {"success": False, "error": "the selected caption track contained no readable cues"}

        return {
            "success": True,
            "data": {
                "video_id": info.get("id"),
                "channel": info.get("channel"),
                "title": info.get("title"),
                "language": chosen,
                "original_language": original_language,
                "generated": chosen not in manual,
                "duration_seconds": info.get("duration"),
                "segment_count": len(segments),
                "transcript": transcript,
                "segments": segments,
            },
        }
    except Exception as e:
        return {"success": False, "error": f"transcribe failed: {e}"}


def _hookscore(hooks):
    """Port of skills/yt-script/hookscore.py. A copy heuristic, not a performance prediction."""
    filler = {"basically", "actually", "literally", "just", "really", "very", "so", "kind", "sort",
              "like", "guys", "hey", "welcome", "today", "video", "subscribe", "channel"}
    vague = {"amazing", "incredible", "insane", "crazy", "huge", "massive", "game", "changer",
             "secret", "powerful", "ultimate", "best", "revolutionary", "mind", "blowing", "unbelievable"}
    concrete = re.compile(r"\b(\d[\d,.]*\s?(%|k|m|x|s|m|h)?|\$\d|\d+\s?(second|minute|hour|day|week|month|year)s?)\b", re.I)
    you = re.compile(r"\b(you|your|you're|youre|yourself)\b", re.I)
    stake = re.compile(r"\b(lose|lost|wasting|waste|quit|fail|broke|cost|risk|before|stop|never|die|dying|dead)\b", re.I)
    curiosity = re.compile(r"\b(why|how|what|which|until|before|but|nobody|almost|except|reason|actually)\b", re.I)
    fixes = {
        "SPECIFICITY": "swap one adjective for a number, a name or a date",
        "ADDRESS": "say 'you' in the first six words",
        "STAKES": "name what it costs them to keep doing it the current way",
        "CURIOSITY": "cut the half of the sentence that answers itself",
        "BREVITY": "9 to 24 words. Read it out loud and stop where you run out of breath",
    }
    formulas = [
        ("The Statistic", [r"\b\d+(\.\d+)?\s?%", r"\b\d+ (out of|in) \d+\b", r"\b\d{2,}(,\d{3})+\b"]),
        ("Someone Else's Result", [r"\bthis (channel|guy|creator|account)\b", r"\bwent from .* to\b", r"\bin (a|one|two|three|\d+) (week|month|year)s?\b"]),
        ("The Mistake", [r"\byou('re| are) (probably |still )?(doing|making)\b", r"\bthe (mistake|reason) (everyone|most people|nobody)\b", r"\bstop (doing )?\b"]),
        ("Contrarian Flip", [r"\beveryone (says|thinks|tells you)\b", r"\bis (actually )?wrong\b", r"\bnobody (tells|talks about)\b"]),
        ("The Reveal", [r"\bI('m| am) going to show you\b", r"\bhere('s| is) (the|exactly)\b", r"\bon screen\b"]),
        ("The Superlative", [r"\bthe (best|worst|fastest|easiest|only)\b", r"\bnumber one\b"]),
        ("The Clock", [r"\bin (the next )?\d+ (seconds|minutes|hours)\b", r"\bby the end of this video\b", r"\bunder \d+\b"]),
        ("I Tried It", [r"\bI (tried|spent|tested|let|gave)\b", r"\bfor \d+ (days|weeks|months)\b", r"\bso you don'?t have to\b"]),
        ("The Question", [r"^(why|how|what|when|should|can|do|does|is)\b", r"\?\s*$"]),
        ("Before and After", [r"\bbefore\b.*\bafter\b", r"\bthis was\b.*\bthis is\b", r"\bused to\b"]),
        ("The Teardown", [r"\b(broke|break|breaking) (it )?down\b", r"\bteardown\b", r"\banalys(ed|ed|is|e)\b", r"\bI pulled\b"]),
        ("The Stack", [r"\b\w+ (plus|\+) \w+\b", r"\bcombine\b", r"\btogether\b"]),
        ("The Warning", [r"\bdo not\b", r"\bdon'?t (upload|post|publish|start)\b", r"\bbefore you\b", r"\bstop\b"]),
        ("The List", [r"^\d+ \w+", r"\b(here are|these are) \d+\b"]),
        ("The Receipt", [r"\bthis is (the|my)\b", r"\bscreenshot\b", r"\bproof\b", r"\breceipts?\b"]),
        ("The Insider", [r"\b(nobody|almost nobody|most people) (knows?|opens?|uses?)\b", r"\bhidden\b", r"\bburied\b"]),
        ("The Impossible Claim", [r"\bwithout\b", r"\bnever\b", r"\bin one\b", r"\bzero\b"]),
        ("The Comparison", [r"\bvs\.?\b", r"\bversus\b", r"\bwhich (one )?(is|wins)\b", r"\bsame .* (three|two) ways\b"]),
        ("The Origin", [r"\bevery (video|post) .* starts\b", r"\bit all (starts|started)\b", r"\bthe (real )?reason\b"]),
        ("The Deadline", [r"\b(this|next) (week|month|year)\b", r"\bis changing\b", r"\bno longer\b", r"\bas of\b"]),
        ("The Direct Address", [r"^if you\b", r"\bfor (anyone|everyone|people) who\b", r"\byou specifically\b"]),
    ]

    def words(text):
        return re.findall(r"[a-z0-9'%$.]+", text.lower())

    rows = []
    for index, raw in enumerate(hooks):
        text = str(raw or "").strip()
        if not text:
            continue
        tokens = words(text)
        numbers = len(concrete.findall(text))
        vague_count = sum(1 for word in tokens if word in vague)
        filler_count = sum(1 for word in tokens if word in filler)
        named = sum(1 for word in text.split()[1:] if word[:1].isupper())
        specificity = max(0, min(100, 34 + numbers * 22 - vague_count * 16 - filler_count * 5
                                 + min(18, 6 * named)))
        direct_count = len(you.findall(text))
        first_six = 30 if you.search(" ".join(text.split()[:6])) else 0
        address = max(0, min(100, 26 + direct_count * 20 + first_six))
        stake_count = len(stake.findall(text))
        stakes = max(0, min(100, 22 + stake_count * 26 + (14 if concrete.search(text) else 0)))
        curiosity_count = len(curiosity.findall(text))
        question_bonus = 18 if text.strip().endswith("?") else 0
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
        verdict = round(0.6 * (sum(values) / len(values)) + 0.4 * min(values))

        formula_name, formula_hits = None, 0
        for name, patterns in formulas:
            hits = sum(1 for pattern in patterns if re.search(pattern, text, re.I | re.S))
            if hits > formula_hits:
                formula_name, formula_hits = name, hits

        band = "STRONG" if verdict >= 72 else "WORKABLE" if verdict >= 55 else "WEAK"
        weakest = min(properties, key=properties.get)
        rows.append({
            "index": index,
            "hook": text,
            "properties": properties,
            "verdict": verdict,
            "score": verdict,
            "band": band,
            "formula": formula_name or "Unclassified",
            "matched": formula_hits,
            "weakest": weakest,
            "fix": fixes[weakest],
            "score_type": "heuristic hook-copy diagnostic; not a retention or performance prediction. The upstream validation found weak separation between a creator's own hits and misses.",
        })
    rows.sort(key=lambda row: -row["verdict"])
    return {"count": len(rows), "scored_hooks": rows}


def _title_lint(titles, thumbnail_text=None):
    """Port of skills/yt-package/title.py; thumbnail image pixels are never evaluated."""
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
            issues.append(("length", f"{length} characters - YouTube's hard limit is 100"))
        elif length > 60:
            issues.append(("length", f"{length} characters - desktop search cuts near 60"))
        else:
            good.append(f"{length} characters, inside the 60-character desktop cut")
        if length > 40:
            visible_head = title[:40].rsplit(" ", 1)[0]
            issues.append(("mobile", f'a mobile feed shows about "{visible_head}..." - check the subject survives'))
        caps = [word for word in title.split() if len(word) > 2 and word.isupper()]
        if len(caps) > 2:
            issues.append(("shouting", f"{len(caps)} all-caps words - two is the ceiling before it reads as spam"))
        elif caps:
            good.append(f"{len(caps)} all-caps word for emphasis")
        vague_words = [word for word in words(title) if word in vague]
        if vague_words:
            issues.append(("vague", f"{', '.join(sorted(set(vague_words)))} - swap for a number, a name or a date"))
        numbers = re.findall(r"\d[\d,.]*%?", title)
        if numbers:
            good.append(f"carries a concrete figure ({', '.join(numbers[:3])})")
        else:
            issues.append(("no-number", "no number, date or name - the most reliable single fix"))
        if title.endswith("?"):
            good.append("open question in the title")
        front = [word for word in words(title)[:3] if word not in stop]
        if not front:
            issues.append(("front-load", "the first three words are all filler - move the subject forward"))
        if thumbnail_text:
            title_words = set(words(title)) - stop
            thumbnail_words = set(words(str(thumbnail_text))) - stop
            shared = title_words & thumbnail_words
            if shared:
                issues.append(("duplicate", f"thumbnail repeats the title on {', '.join(sorted(shared))} - the thumbnail should say what the title does not"))
            else:
                good.append("thumbnail and title carry different words")
            thumbnail_word_count = len(words(str(thumbnail_text)))
            if thumbnail_word_count > 4:
                issues.append(("thumb-length", f"{thumbnail_word_count} words on the thumbnail - three is the ceiling at feed size"))

        score = max(0, min(100, 100 - 14 * len(issues) + 4 * len(good)))
        issue_rows = [{"code": code, "detail": detail} for code, detail in issues]
        results.append({
            "index": index,
            "title": title,
            "chars": length,
            "characters": length,
            "score": score,
            "heuristic_score": score,
            "issues": issue_rows,
            "good": good,
            "thumbnail_text": thumbnail_text or None,
            "thumbnail_image_evaluated": False,
            "score_type": "heuristic title/thumbnail-text lint, not a CTR or ranking prediction",
        })
    results.sort(key=lambda row: -row["score"])
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
    absolute_retention = any(point["retention_pct"] > 100 for point in points)
    early_limit = 30.0
    early = [point for point in points if point["axis_value"] <= early_limit]
    if early:
        start_retention = points[0]["retention_pct"]
        min_early = min(point["retention_pct"] for point in early)
        leak = round(start_retention - min_early, 1)
        severity = (
            "not applicable (absolute retention can exceed 100% through loops/replays)"
            if absolute_retention
            else "healthy" if leak < 25 else "moderate" if leak < 40 else "severe"
        )
        hook_leak = {
            "loss_points": leak,
            "start_retention_pct": start_retention,
            "minimum_early_retention_pct": min_early,
            "window": "first 30% of video" if time_is_pct else "first 30 seconds",
            "axis": "%" if time_is_pct else "seconds",
            "severity": severity,
            "absolute_retention_detected": absolute_retention,
        }
    else:
        hook_leak = {
            "loss_points": None,
            "window": "first 30% of video" if time_is_pct else "first 30 seconds",
            "axis": "%" if time_is_pct else "seconds",
            "severity": "unknown",
            "note": "No readings inside the early-retention window.",
            "absolute_retention_detected": absolute_retention,
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
        slide_severity = (
            "not applicable (absolute retention can exceed 100% through loops/replays)"
            if absolute_retention
            else "healthy" if average_slide < 1 else "moderate" if average_slide < 3 else "severe"
        )
        slide = {
            "average_loss_points_per_minute": average_slide,
            "severity": slide_severity,
            "absolute_retention_detected": absolute_retention,
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
                profile = _with_public_avatar(profile)
                sec = sections["data"]
                if isinstance(sec, dict):
                    sec = _normalize_sections(sec)
                return {"success": True, "data": {"sections": sec, "profile": profile["data"]}}
            return {
                "success": False,
                "error": f"sections: {_err_str(sections)} | profile: {_err_str(profile)}",
            }
        if method == "profile":
            return _with_public_avatar(_eng("profile", _norm_handle(a.get("handle")), "--json", timeout=ENGINE_TIMEOUT))
        if method == "latest":
            return _eng("latest", _norm_handle(a.get("handle")), "--limit", str(int(a.get("limit", 10))), "--json", timeout=ENGINE_TIMEOUT)
        if method == "channel":
            tab = str(a.get("tab", "videos")).strip().lower()
            if tab not in {"videos", "shorts", "streams"}:
                return {"success": False, "error": "tab must be videos, shorts or streams"}
            argv = ["channel", _norm_handle(a.get("handle")), "--limit", str(int(a.get("limit", 15))),
                    "--tab", tab]
            if a.get("with_duration"):
                argv.append("--with-duration")
            if a.get("full_meta"):
                argv.append("--full-meta")
            argv.append("--json")
            return _eng(*argv, timeout=AUDIT_TIMEOUT)
        if method == "posts":
            return _eng("posts", _norm_handle(a.get("handle")), "--limit", str(int(a.get("limit", 10))),
                        "--json", timeout=ENGINE_TIMEOUT)
        if method == "shows":
            handle = _norm_handle(a.get("handle"))
            limit = max(1, min(15, int(a.get("limit", 15))))
            shows = _eng("shows", handle, "--limit", str(limit), "--json", timeout=ENGINE_TIMEOUT)
            show_items = shows.get("data", {}).get("items", []) if shows.get("success") else []
            if show_items:
                return shows
            # YouTube's Shows tab is absent on many channels; their public
            # playlist shelves are the closest equivalent collection surface.
            home = _eng("home", handle, "--limit", "15", "--verbose", "--json", timeout=ENGINE_TIMEOUT)
            home_data = home.get("data") if home.get("success") else []
            # `_eng` wraps an engine's bare JSON array in `{items: [...]}` for
            # Anna's transport. Accept both that production shape and a direct
            # array so this fallback works against the real bridge and tests.
            shelves = home_data.get("items", []) if isinstance(home_data, dict) else home_data
            playlists = []
            for shelf in shelves if isinstance(shelves, list) else []:
                for item in shelf.get("items", []) if isinstance(shelf, dict) and str(shelf.get("type", "")).lower() == "playlists" else []:
                    playlists.append({**item, "kind": "PLAYLIST", "count": shelf.get("title")})
                    if len(playlists) >= limit:
                        break
                if len(playlists) >= limit:
                    break
            return {"success": True, "data": {"items": playlists, "source": "channel playlists" if playlists else "shows", "fallback": bool(playlists)}}
        if method == "playlist":
            return _eng("playlist", _norm_video(a.get("playlist")), "--limit", str(int(a.get("limit", 20))),
                        "--json", timeout=ENGINE_TIMEOUT)
        if method == "info":
            return _eng("info", _norm_video(a.get("video")), "--json", timeout=ENGINE_TIMEOUT)
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
            args = ["keywords", str(a.get("seed", "")).strip(), "--limit", str(int(a.get("limit", 25))),
                    "--gl", str(a.get("gl", "US")), "--hl", str(a.get("hl", "en"))]
            if "letters" in a:
                args.extend(["--letters", str(a.get("letters", ""))])
            if a.get("patterns"):
                args.append("--patterns")
            args.append("--json")
            return _eng(*args, timeout=ENGINE_TIMEOUT)
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
            argv = ["home", _norm_handle(a.get("handle")), "--limit", str(int(a.get("limit", 12)))]
            if a.get("verbose"):
                argv.append("--verbose")
            argv.append("--json")
            return _with_public_home_avatars(_eng(*argv, timeout=ENGINE_TIMEOUT))
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






