"""Regression tests for deterministic Anna Skillbox tools.

Run with:
    python -m unittest discover -s executas/youtube-skillbox -p "test_*.py" -v
"""
import unittest
import sys
from types import ModuleType

from unittest.mock import patch

from youtube_skillbox_plugin import (
    AUDIT_TIMEOUT,
    MANIFEST,
    _hookscore,
    _parse_retention_csv,
    _engine_script,
    _run_engine,
    _title_lint,
    _with_public_avatar,
    _with_public_home_avatars,
    _vtt_to_segments,
    _vtt_to_text,
    invoke,
)


class CreatorToolTests(unittest.TestCase):
    @patch("youtube_skillbox_plugin._engine_script", return_value="/fake/engine")
    def test_engine_preserves_stderr_when_cli_exits_nonzero(self, _engine_path):
        fake_engine = ModuleType("ytdata")

        def fail_with_diagnostic():
            print("ERROR: suggest returned nothing (rate-limited?)", file=sys.stderr)
            raise SystemExit(1)

        fake_engine.main = fail_with_diagnostic
        with patch.dict("sys.modules", {"ytdata": fake_engine}):
            result, raw, error = _run_engine("keywords", "space facts", "--json")

        self.assertIsNone(result)
        self.assertEqual(raw, "")
        self.assertIn("suggest returned nothing", error)

    def test_source_checkout_prefers_adjacent_engine_module(self):
        from pathlib import Path
        expected = str(Path(__file__).resolve().parent / "engine")
        self.assertEqual(_engine_script(), expected)

    @patch("urllib.request.urlopen")
    def test_legacy_profile_response_fetches_public_avatar_metadata(self, urlopen):
        response = urlopen.return_value.__enter__.return_value
        response.geturl.return_value = "https://www.youtube.com/channel/UCsample"
        response.read.return_value = b'<meta property="og:image" content="https://yt3.googleusercontent.com/avatar=s160">'
        profile = {"success": True, "data": {"channel_url": "https://youtube.com/channel/UCsample"}}
        result = _with_public_avatar(profile)
        self.assertEqual(result["data"]["avatar_url"], "https://yt3.googleusercontent.com/avatar=s160")
        urlopen.assert_called_once()

    @patch("youtube_skillbox_plugin._with_public_avatar")
    def test_home_dispatch_enriches_featured_channel_artwork(self, avatar):
        avatar.side_effect = lambda result: {
            "success": True,
            "data": {"channel_url": result["data"]["channel_url"], "avatar_url": "https://yt3.googleusercontent.com/logo=s160"},
        }
        home = {"success": True, "data": [{"type": "featured channels", "items": [
            {"kind": "channel", "id": "UC1234567890123456789012", "title": "Creator", "url": "https://www.youtube.com/channel/UC1234567890123456789012"},
            {"kind": "video", "id": "abc", "thumbnail": "https://i.ytimg.com/video.jpg"},
        ]}]}
        result = _with_public_home_avatars(home)
        self.assertEqual(result["data"][0]["items"][0]["thumbnail"], "https://yt3.googleusercontent.com/logo=s160")
        self.assertEqual(avatar.call_count, 1)
        self.assertEqual(result["data"][0]["items"][1]["thumbnail"], "https://i.ytimg.com/video.jpg")

    def test_home_art_enrichment_caps_missing_logos_at_fifteen(self):
        channels = [{"kind": "channel", "id": f"UC{'a' * 22}", "url": f"https://www.youtube.com/channel/UC{'a' * 22}"} for _ in range(18)]
        with patch("youtube_skillbox_plugin._with_public_avatar", side_effect=lambda response: response) as avatar:
            _with_public_home_avatars({"success": True, "data": [{"type": "featured channels", "items": channels}]})
        self.assertEqual(avatar.call_count, 15)

    def test_hookscore_returns_five_property_heuristics(self):
        result = _hookscore([
            "Why do viewers leave your video after the first 30 seconds?",
            "Welcome to my amazing channel.",
        ])
        self.assertEqual(result["count"], 2)
        row = result["scored_hooks"][0]
        self.assertIn("SPECIFICITY", row["properties"])
        self.assertIn("ADDRESS", row["properties"])
        self.assertIn("STAKES", row["properties"])
        self.assertIn("CURIOSITY", row["properties"])
        self.assertIn("BREVITY", row["properties"])
        self.assertEqual(row["formula"], "The Question")
        self.assertEqual(row["verdict"], row["score"])
        self.assertEqual(row["matched"], 2)
        self.assertIn(row["band"], {"STRONG", "WORKABLE", "WEAK"})
        self.assertIn("not a retention", row["score_type"])

    def test_title_lint_reports_mobile_and_duplicate_thumbnail_copy(self):
        result = _title_lint(
            ["Why Your YouTube Titles Lose Viewers Before They Click"],
            thumbnail_text="YouTube Titles"
        )
        self.assertEqual(result["count"], 1)
        row = result["titles"][0]
        self.assertGreater(row["characters"], 40)
        issue_codes = {issue["code"] for issue in row["issues"]}
        self.assertIn("mobile", issue_codes)
        self.assertIn("duplicate", issue_codes)
        self.assertIn("not a CTR", row["score_type"])

    def test_percent_axis_stays_percent_and_duration_unlocks_seconds(self):
        csv_text = (
            "Video position (%),Percentage watched\n"
            "0,95\n10,82\n20,61\n30,52\n40,45\n"
        )
        result = _parse_retention_csv(csv_text, 120)
        self.assertTrue(result["measured"])
        self.assertEqual(result["axis"], "percentage of video")
        self.assertEqual(result["hook_leak"]["window"], "first 30% of video")
        self.assertEqual(result["hook_leak"]["loss_points"], 43.0)
        self.assertIsNotNone(result["slide"]["average_loss_points_per_minute"])
        self.assertEqual(result["points"][1]["axis"], "%")

    def test_percent_axis_without_duration_never_invents_seconds(self):
        csv_text = (
            "Video position (%),Percentage watched\n"
            "0,95\n10,82\n20,61\n30,52\n40,45\n"
        )
        result = _parse_retention_csv(csv_text)
        self.assertEqual(result["axis"], "percentage of video")
        self.assertNotIn("time_seconds", result["points"][0])
        self.assertIsNone(result["slide"]["average_loss_points_per_minute"])
        self.assertEqual(result["slide"]["severity"], "not available")

    def test_seconds_axis_uses_first_30_seconds(self):
        csv_text = (
            "seconds,retention_pct\n"
            "0,100\n10,88\n20,70\n30,62\n45,56\n"
        )
        result = _parse_retention_csv(csv_text)
        self.assertEqual(result["axis"], "elapsed seconds")
        self.assertEqual(result["hook_leak"]["window"], "first 30 seconds")
        self.assertEqual(result["hook_leak"]["loss_points"], 38.0)

    def test_absolute_retention_does_not_get_relative_severity(self):
        csv_text = (
            "seconds,retention_pct\n"
            "0,130\n10,120\n20,112\n30,108\n45,105\n"
        )
        result = _parse_retention_csv(csv_text)
        self.assertTrue(result["hook_leak"]["absolute_retention_detected"])
        self.assertIn("not applicable", result["hook_leak"]["severity"])
        self.assertTrue(result["slide"]["absolute_retention_detected"])
        self.assertIn("not applicable", result["slide"]["severity"])

    def test_webvtt_parser_preserves_real_cue_timestamps(self):
        vtt = (
            "WEBVTT\n\n"
            "00:00:01.000 --> 00:00:02.500\n"
            "Hello <i>world</i>!\n\n"
            "00:00:03.000 --> 00:00:04.250\n"
            "Next cue &amp; more.\n"
        )
        segments = _vtt_to_segments(vtt)
        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0]["start"], 1.0)
        self.assertEqual(segments[0]["duration"], 1.5)
        self.assertEqual(segments[0]["end"], 2.5)
        self.assertEqual(segments[1]["start"], 3.0)
        self.assertEqual(_vtt_to_text(vtt), "Hello world! Next cue & more.")

    def test_describe_manifest_exposes_full_channel_research_surface(self):
        names = {item["name"] for item in MANIFEST["tools"]}
        self.assertTrue({
            "snapshot", "profile", "latest", "channel", "posts", "home", "shows",
            "playlist", "info", "outliers", "keywords", "compete", "gap",
            "scorecard", "track", "trends", "transcribe", "hookscore",
            "title_lint", "retention",
        }.issubset(names))
        self.assertNotIn("host_capabilities", MANIFEST)

    @patch("youtube_skillbox_plugin._eng")
    def test_profile_dispatch_fetches_public_identity(self, engine):
        engine.return_value = {"success": True, "data": {"name": "Sample"}}
        result = invoke("profile", {"handle": "UC12345678901234567890"})
        self.assertTrue(result["success"])
        self.assertEqual(engine.call_args.args, ("profile", "https://www.youtube.com/channel/UC12345678901234567890", "--json"))

    @patch("youtube_skillbox_plugin._eng")
    def test_keyword_dispatch_supports_bounded_audit_queries(self, engine):
        engine.return_value = {"success": True, "data": {"keywords": [{"keyword": "space facts"}]}}
        invoke("keywords", {"seed": "space facts", "limit": 12, "letters": "", "patterns": True})
        self.assertEqual(engine.call_args.args, (
            "keywords", "space facts", "--limit", "12", "--gl", "US", "--hl", "en",
            "--letters", "", "--patterns", "--json",
        ))

    @patch("youtube_skillbox_plugin._eng")
    def test_channel_dispatch_supports_shorts_with_duration(self, engine):
        engine.return_value = {"success": True, "data": {"items": []}}
        invoke("channel", {
            "handle": "@sample",
            "limit": 6,
            "tab": "shorts",
            "with_duration": True,
        })
        args, kwargs = engine.call_args
        self.assertEqual(args[:6], ("channel", "@sample", "--limit", "6", "--tab", "shorts"))
        self.assertIn("--with-duration", args)
        self.assertEqual(args[-1], "--json")
        self.assertEqual(kwargs["timeout"], AUDIT_TIMEOUT)

    @patch("youtube_skillbox_plugin._eng")
    def test_posts_dispatch_uses_channel_and_limit(self, engine):
        engine.return_value = {"success": True, "data": {"items": []}}
        invoke("posts", {"handle": "@sample", "limit": 12})
        args, kwargs = engine.call_args
        self.assertEqual(args, ("posts", "@sample", "--limit", "12", "--json"))
        self.assertIn("timeout", kwargs)

    @patch("youtube_skillbox_plugin._eng")
    def test_home_dispatch_can_return_verbose_shelves(self, engine):
        engine.return_value = {"success": True, "data": {}}
        invoke("home", {"handle": "@sample", "limit": 8, "verbose": True})
        args, _ = engine.call_args
        self.assertIn("--verbose", args)
        self.assertEqual(args[-1], "--json")

    @patch("youtube_skillbox_plugin._eng")
    def test_shows_falls_back_to_public_home_playlists(self, engine):
        engine.side_effect = [
            {"success": True, "data": {"items": []}},
            {"success": True, "data": [{"type": "playlists", "title": "Popular playlists", "items": [
                {"id": "PLabc", "title": "Science", "url": "https://youtube.com/playlist?list=PLabc", "thumbnail": "https://i.ytimg.com/test.jpg"}
            ]}]},
        ]
        result = invoke("shows", {"handle": "@sample", "limit": 15})
        self.assertTrue(result["success"])
        self.assertTrue(result["data"]["fallback"])
        self.assertEqual(result["data"]["items"][0]["kind"], "PLAYLIST")
        self.assertEqual(engine.call_count, 2)

    @patch("youtube_skillbox_plugin._eng")
    def test_video_info_and_playlist_dispatch(self, engine):
        engine.return_value = {"success": True, "data": {}}
        invoke("info", {"video": "abc123"})
        self.assertEqual(engine.call_args.args, ("info", "abc123", "--json"))
        invoke("playlist", {"playlist": "PLabc123", "limit": 25})
        self.assertEqual(engine.call_args.args, ("playlist", "PLabc123", "--limit", "25", "--json"))

    def test_malformed_retention_headers_fail_explicitly(self):
        result = _parse_retention_csv("foo,bar\n1,2\n3,4\n")
        self.assertIn("error", result)
        self.assertIn("columns", result)


if __name__ == "__main__":
    unittest.main()
