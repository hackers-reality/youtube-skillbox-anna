"""YouTube Skillbox — Executa plugin powering the Anna App.

Exposes the open-source YouTube Skillbox engine (PyPI: youtube-skillbox)
as first-class Anna tools. When run as the frozen PyInstaller binary, we
ship the engine *inside* the binary; when run in dev (`python plugin.py`)
we find it via `youtube_skillbox.cli.find_skills_dir()`.
Either way the engine runs IN-PROCESS with stdout captured into a string,
so the exact same code path works everywhere.
"""

import io
import json
import sys
import time
import traceback

VERSION = "0.5.0"
ENGINE_TIMEOUT = 90
AUDIT_TIMEOUT = 150

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
            "parameters": [],
            "timeout": 10,
        },
        {
            "name": "snapshot",
            "description": "Channel snapshot: every tab count (videos/shorts/shows/playlists/community) plus the About section (subs, description, keywords). Fast.",
            "parameters": [
                {"name": "handle", "type": "string", "description": "Channel handle (with or without @) or channel URL.", "required": True},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "latest",
            "description": "Most recent uploads (reverse chronological), with durations and view counts.",
            "parameters": [
                {"name": "handle", "type": "string", "description": "Channel handle or URL.", "required": True},
                {"name": "limit", "type": "integer", "description": "Max videos to return.", "required": False, "default": 10},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "outliers",
            "description": "Videos that dramatically outperform the channel's own subscribed baseline (views/subs ratio) — the best source of repeatable ideas.",
            "parameters": [
                {"name": "handle", "type": "string", "description": "Channel handle or URL.", "required": True},
                {"name": "min_ratio", "type": "number", "description": "Minimum views/subs multiple.", "required": False, "default": 2.0},
            ],
            "timeout": AUDIT_TIMEOUT,
        },
        {
            "name": "scorecard",
            "description": "SEO checklist for one video: title, keyword-in-title, description, tags, chapters, freshness. Returns 0-100 and per-check results.",
            "parameters": [
                {"name": "video", "type": "string", "description": "Video URL or 11-char ID.", "required": True},
                {"name": "keyword", "type": "string", "description": "Target keyword for the checks.", "required": False, "default": ""},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "keywords",
            "description": "Keyword ideas + relative demand index from YouTube suggest (weighted by position) and DuckDuckGo. 0-100 opportunity score per idea.",
            "parameters": [
                {"name": "seed", "type": "string", "description": "Seed topic, e.g. 'youtube seo'.", "required": True},
                {"name": "limit", "type": "integer", "description": "Max ideas to return.", "required": False, "default": 25},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "compete",
            "description": "Competition difficulty 0-100 for a keyword from the live SERP. Higher = harder. Views(35) authority(25) titles(20) entrenchment(15) velocity(5).",
            "parameters": [
                {"name": "query", "type": "string", "description": "Keyword to score.", "required": True},
                {"name": "gl", "type": "string", "description": "Region code.", "required": False, "default": "US"},
                {"name": "hl", "type": "string", "description": "Language code.", "required": False, "default": "en"},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "verdict",
            "description": "Deterministic GO / MAYBE / SKIP verdict for a keyword opportunity based on opportunity vs competition scores you supply (from keywords + compete).",
            "parameters": [
                {"name": "opportunity", "type": "number", "description": "0-100 opportunity (from keywords).", "required": True},
                {"name": "competition", "type": "number", "description": "0-100 competition difficulty (from compete).", "required": True},
            ],
            "timeout": 10,
        },
        {
            "name": "search",
            "description": "Search YouTube videos matching a query (locale-pinnable).",
            "parameters": [
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
            "parameters": [
                {"name": "seed", "type": "string", "description": "Seed topic.", "required": True},
                {"name": "competitor", "type": "string", "description": "Competitor channel handle or URL.", "required": True},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "home",
            "description": "Home-tab shelves for a channel: featured video, Shorts, playlists, posts and Featured Channels (with URLs).",
            "parameters": [
                {"name": "handle", "type": "string", "description": "Channel handle or URL.", "required": True},
                {"name": "limit", "type": "integer", "description": "Items per shelf.", "required": False, "default": 12},
            ],
            "timeout": ENGINE_TIMEOUT,
        },
        {
            "name": "transcribe",
            "description": "Spoken text of any video (auto/human captions). Returns plain text. Original language + English when available.",
            "parameters": [
                {"name": "video", "type": "string", "description": "Video URL or 11-char ID.", "required": True},
                {"name": "language", "type": "string", "description": "Preferred language code(s), e.g. 'en' or 'es,en'.", "required": False, "default": "en"},
            ],
            "timeout": ENGINE_TIMEOUT,
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
            return _eng("keywords", str(a.get("seed", "")).strip(), "--limit", str(int(a.get("limit", 25))), "--json", timeout=ENGINE_TIMEOUT)
        if method == "compete":
            return _eng("compete", str(a.get("query", "")).strip(), "--top", "10", "--gl", str(a.get("gl", "US")), "--hl", str(a.get("hl", "en")), "--json", timeout=ENGINE_TIMEOUT)
        if method == "verdict":
            return {"success": True, "data": _verdict(float(a.get("opportunity", 0)), float(a.get("competition", 0)))}
        if method == "search":
            return _eng("search", str(a.get("query", "")).strip(), "--limit", str(int(a.get("limit", 10))), "--gl", str(a.get("gl", "US")), "--hl", str(a.get("hl", "en")), "--json", timeout=ENGINE_TIMEOUT)
        if method == "gap":
            return _eng("gap", str(a.get("seed", "")).strip(), "--competitor", _norm_handle(a.get("competitor")), "--json", timeout=ENGINE_TIMEOUT)
        if method == "home":
            return _eng("home", _norm_handle(a.get("handle")), "--limit", str(int(a.get("limit", 12))), "--json", timeout=ENGINE_TIMEOUT)
        if method == "transcribe":
            return _transcribe(str(a.get("video", "")).strip(), str(a.get("language", "en")).strip() or "en")
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



