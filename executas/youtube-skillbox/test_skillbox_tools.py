"""Regression tests for deterministic Anna Skillbox tools.

Run with:
    python -m unittest discover -s executas/youtube-skillbox -p "test_*.py" -v
"""
import unittest

from unittest.mock import patch

from youtube_skillbox_plugin import (
    AUDIT_TIMEOUT,
    MANIFEST,
    _hookscore,
    _parse_retention_csv,
    _title_lint,
    _vtt_to_segments,
    _vtt_to_text,
    invoke,
)


class CreatorToolTests(unittest.TestCase):
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
            "snapshot", "latest", "channel", "posts", "home", "shows",
            "playlist", "info", "outliers", "keywords", "compete", "gap",
            "scorecard", "track", "trends", "transcribe", "hookscore",
            "title_lint", "retention",
        }.issubset(names))
        self.assertNotIn("host_capabilities", MANIFEST)

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
