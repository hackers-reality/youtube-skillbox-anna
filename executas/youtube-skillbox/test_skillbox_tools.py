"""Regression tests for deterministic Anna Skillbox tools.

Run with:
    python -m unittest discover -s executas/youtube-skillbox -p "test_*.py" -v
"""
import unittest

from youtube_skillbox_plugin import _hookscore, _parse_retention_csv, _title_lint


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
            "seconds,retention_pct\\n"
            "0,130\\n10,120\\n20,112\\n30,108\\n45,105\\n"
        )
        result = _parse_retention_csv(csv_text)
        self.assertTrue(result["hook_leak"]["absolute_retention_detected"])
        self.assertIn("not applicable", result["hook_leak"]["severity"])
        self.assertTrue(result["slide"]["absolute_retention_detected"])
        self.assertIn("not applicable", result["slide"]["severity"])

    def test_malformed_retention_headers_fail_explicitly(self):
        result = _parse_retention_csv("foo,bar\n1,2\n3,4\n")
        self.assertIn("error", result)
        self.assertIn("columns", result)


if __name__ == "__main__":
    unittest.main()
