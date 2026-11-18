import unittest
from unittest.mock import patch

from api.skillbox import dispatch_tool


class SkillboxApiTests(unittest.TestCase):
    def test_routes_real_engine_result_in_expected_envelope(self):
        measured = {"success": True, "data": {"handle": "@example"}}
        with patch("api.skillbox.invoke", return_value=measured) as invoke:
            status, payload = dispatch_tool("profile", {"handle": "@example"})
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"result": measured})
        invoke.assert_called_once_with("profile", {"handle": "@example"})

    def test_rejects_unknown_tool_without_running_engine(self):
        with patch("api.skillbox.invoke") as invoke:
            status, payload = dispatch_tool("shell", {"command": "no"})
        self.assertEqual(status, 400)
        self.assertIn("Unknown", payload["error"])
        invoke.assert_not_called()

    def test_rejects_non_object_arguments(self):
        status, payload = dispatch_tool("profile", ["@example"])
        self.assertEqual(status, 400)
        self.assertIn("object", payload["error"])

    def test_sanitizes_unexpected_engine_errors(self):
        with patch("api.skillbox.invoke", side_effect=RuntimeError("private detail")):
            status, payload = dispatch_tool("profile", {"handle": "@example"})
        self.assertEqual(status, 500)
        self.assertNotIn("private detail", payload["error"])


if __name__ == "__main__":
    unittest.main()
