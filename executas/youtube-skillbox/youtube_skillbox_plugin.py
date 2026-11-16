"""YouTube Skillbox — Executa plugin powering the Anna App.

Exposes the open-source YouTube Skillbox engine (PyPI: youtube-skillbox)
as first-class Anna tools. The engine locates ytdata.py through
`youtube_skillbox.cli.find_skills_dir()`, so we invoke it via
`python -m youtube_skillbox.cli <subcommand> [...args] --json` and parse the
emitted JSON. Where `--json` is unsupported or fails, we fall back to the raw
text so callers always get something honest.

All engine commands talk over the network (yt-dlp / Innertube / suggest
endpoints). Callers must expect timeouts, HTTP 429s and empty payloads; those
surface as `{"success": False, "error": ...}` business failures, never as fake
results.
"""

import json
import subprocess
import sys

VERSION = "0.1.0"
ENGINE_TIMEOUT = 120
AUDIT_TIMEOUT = 180

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


def _run_engine(*args, timeout=ENGINE_TIMEOUT):
    """Run the bundled engine; return (parsed_json_or_None, raw_text, error)."""
    cmd = [sys.executable, "-m", "youtube_skillbox.cli", *args]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        return None, "", f"timeout after {timeout}s — YouTube throttled us (HTTP 429?). Try again shortly."
    out = (proc.stdout or "").strip()
    if proc.returncode != 0:
        err = (proc.stderr or out or "engine exited non-zero").strip()
        tail = err[-400:]
        return None, out, tail
    try:
        return json.loads(out), out, None
    except json.JSONDecodeError:
        # Sections/posts may not emit JSON; hand raw text through.
        return None, out, None


def _payload(**kwargs):
    return {"success": True, "data": kwargs}


def _strip_nulls(obj):
    """Deep-strip null/absent keys the engine emits as schema defaults — the
    engine always serializes its full schema, so key-presence tells the
    truth about which fields it actually measured. Kept: `enrichment_summary`
    (non-null; shows the batch enricher budget)."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if v is None and k != "enrichment_summary":
                continue
            out[k] = _strip_nulls(v)
        return out
    if isinstance(obj, list):
        return [_strip_nulls(v) for v in obj]
    return obj


def _normalize_sections(sections):
    """Engine emits null for a tab the channel genuinely doesn't have.
    Surface that honestly as 'no tab' rather than a blank/absent key."""
    for key in ("videos", "shorts", "streams", "playlists", "shows"):
        if sections.get(key) is None:
            sections[key] = "no tab"
    return sections


def _handle_engine_result(args, timeout=ENGINE_TIMEOUT):
    js, raw, err = _run_engine(*args, timeout=timeout)
    if err:
        return {"success": False, "error": err}
    if js is None:
        return {"success": True, "data": {"raw": raw or "(no output)"}}
    return {"success": True, "data": _strip_nulls(js)}


def _exec(tool: str, arguments: dict) -> dict:
    a = arguments or {}
    if tool == "ping":
        return {"success": True, "data": {"pong": True, "engine": f"youtube-skillbox {_engine_version()}"}}
    if tool == "snapshot":
        handle = _norm_handle(a.get("handle"))
        sections = _handle_engine_result(["sections", handle, "--json"], timeout=ENGINE_TIMEOUT)
        profile = _handle_engine_result(["profile", handle, "--json"], timeout=ENGINE_TIMEOUT)
        if sections.get("success") and profile.get("success"):
            sec = sections["data"]
            if isinstance(sec, dict):
                sec = _normalize_sections(sec)
            return {"success": True, "data": {"sections": sec, "profile": profile["data"]}}
        # One failing half is worse than a useful error — report both payloads/errors honestly.
        return {
            "success": False,
            "error": f"sections: {_err(sections)} | profile: {_err(profile)}",
        }
    if tool == "latest":
        return _handle_engine_result(
            ["latest", _norm_handle(a.get("handle")), "--limit", str(int(a.get("limit", 10))), "--json"],
            timeout=ENGINE_TIMEOUT,
        )
    if tool == "outliers":
        return _handle_engine_result(
            ["outliers", _norm_handle(a.get("handle")), "--min-ratio", str(float(a.get("min_ratio", 2.0))), "--json"],
            timeout=AUDIT_TIMEOUT,
        )
    if tool == "scorecard":
        video = _norm_video(a.get("video"))
        args = ["scorecard", video]
        kw = (a.get("keyword") or "").strip()
        if kw:
            args += ["--keyword", kw]
        args.append("--json")
        return _handle_engine_result(args, timeout=ENGINE_TIMEOUT)
    if tool == "keywords":
        return _handle_engine_result(
            ["keywords", str(a.get("seed", "")).strip(), "--limit", str(int(a.get("limit", 25))), "--json"],
            timeout=ENGINE_TIMEOUT,
        )
    if tool == "compete":
        return _handle_engine_result(
            [
                "compete",
                str(a.get("query", "")).strip(),
                "--top", "10",
                "--gl", str(a.get("gl", "US")),
                "--hl", str(a.get("hl", "en")),
                "--json",
            ],
            timeout=ENGINE_TIMEOUT,
        )
    if tool == "verdict":
        opp = float(a.get("opportunity", 0))
        comp = float(a.get("competition", 0))

        if opp >= 70 and comp <= 40:
            call = "GO"
        elif opp >= 50 and comp < 50:
            call = "GO"
        elif opp >= 40 and comp < 65:
            call = "MAYBE"
        else:
            call = "SKIP"
        return {
            "success": True,
            "data": {
                "verdict": call,
                "opportunity": opp,
                "competition": comp,
                "label": "heuristic — not a ranking prediction",
            },
        }
    if tool == "search":
        return _handle_engine_result(
            [
                "search",
                str(a.get("query", "")).strip(),
                "--limit", str(int(a.get("limit", 10))),
                "--gl", str(a.get("gl", "US")),
                "--hl", str(a.get("hl", "en")),
                "--json",
            ],
            timeout=ENGINE_TIMEOUT,
        )
    if tool == "gap":
        return _handle_engine_result(
            ["gap", str(a.get("seed", "")).strip(), "--competitor", _norm_handle(a.get("competitor")), "--json"],
            timeout=ENGINE_TIMEOUT,
        )
    if tool == "home":
        return _handle_engine_result(
            ["home", _norm_handle(a.get("handle")), "--limit", str(int(a.get("limit", 12))), "--json"],
            timeout=ENGINE_TIMEOUT,
        )
    if tool == "transcribe":
        return _transcribe(str(a.get("video", "")).strip(), str(a.get("language", "en")).strip() or "en")
    return {"success": False, "error": f"unknown method: {tool}"}


def _err(res: dict):
    if res.get("success"):
        return "ok"
    return str(res.get("error", "unknown error"))[:200]


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
    v = (v or "").strip()
    if v.startswith("http"):
        return v
    return v  # engine accepts bare 11-char IDs


def _engine_version():
    try:
        from importlib.metadata import version
        return version("youtube-skillbox")
    except Exception:
        return "?"


def _transcribe(video: str, language: str) -> dict:
    """Captions via yt-dlp Python API, same approach as the transcript skill."""
    if not video:
        return {"success": False, "error": "video URL or ID required"}
    try:
        import yt_dlp
    except ImportError:
        return {"success": False, "error": "yt-dlp not installed"}
    url = video if video.startswith("http") else f"https://www.youtube.com/watch?v={video}"
    try:
        from yt_dlp.extractor import getcaptionsasjson_msgs  # noqa: F401  (availability check only)
    except Exception:
        pass

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
        import tempfile
        import re

        with tempfile.TemporaryDirectory() as tmp:
            opts["outtmpl"] = f"{tmp}/%(id)s"
            from yt_dlp import YoutubeDL

            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
            caps = info.get("requested_subtitles") or {}
            text = None
            chosen = None
            # Prefer manual captions
            for lang in [language, "en"] + list(caps):
                track = caps.get(lang)
                if track:
                    chosen = lang
                    break
            if chosen is None:
                return {"success": False, "error": "no captions available for this video"}
            url_list = caps[chosen].get("url")
            if url_list:
                try:
                    import urllib.request

                    raw = urllib.request.urlopen(url_list, timeout=30).read().decode("utf-8", "replace")
                    text = _vtt_to_text(raw)
                except Exception as e:
                    return {"success": False, "error": f"failed to fetch captions: {e}"}
            if not text:
                return {"success": False, "error": "caption track empty"}
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
    """Flatten WebVTT cues into one readable string."""
    import re

    lines = []
    for line in vtt.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
            continue
        if re.match(r"^\d{2}:\d{2}|^\d+$", line):
            continue  # cue identifiers / timestamps
        if "-->" in line:
            continue
        # strip tags
        line = re.sub(r"<[^>]+>", "", line)
        lines.append(line)
    # de-duplicate consecutive identical lines (rolling captions)
    out = []
    for ln in lines:
        if out and out[-1] == ln:
            continue
        out.append(ln)
    return " ".join(out)


def invoke(method: str, args: dict) -> dict:
    return _exec(method, args or {})


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
