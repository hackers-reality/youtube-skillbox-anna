"""Offline OAuth security tests. TEST_* values are fixtures, not credentials."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit
from oauth_local import GoogleOAuth, OAuthError, REDIRECT_URI, SCOPES, Vault


class MemoryVault:
    def __init__(self): self.value = {}
    def load(self): return copy.deepcopy(self.value)
    def save(self, value): self.value = copy.deepcopy(value)


class OAuthTests(unittest.TestCase):
    def setUp(self):
        approved = Path(r"C:\Users\admin\AppData\Local\Temp\opencode")
        self.temp = tempfile.TemporaryDirectory(dir=approved if approved.exists() else None)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.joinpath(".local").mkdir()
        self.root.joinpath(".local/google-oauth-client.json").write_text(json.dumps({"web": {"client_id": "TEST_CLIENT", "client_secret": "TEST_SECRET", "redirect_uris": [REDIRECT_URI]}}))
        self.calls = []
        self.now = 1000
        self.vault = MemoryVault()
        def request(url, **kwargs):
            self.calls.append((url, kwargs))
            if "/token" in url:
                return {"access_token": "TEST_ACCESS", "refresh_token": "TEST_REFRESH", "expires_in": 3600, "scope": " ".join(SCOPES)}
            if "userinfo" in url:
                return {"sub": "TEST_SUBJECT", "email": "test@example.invalid"}
            if "/channels?" in url:
                return {"items": [{"id": "UCowned", "snippet": {"title": "TEST CHANNEL"}}]}
            if "/reports?" in url:
                return {"columnHeaders": [{"name": "views"}], "rows": [[7]]}
            return {}
        self.manager = GoogleOAuth(self.root, request=request, vault=self.vault, clock=lambda: self.now)

    def begin(self):
        result = self.manager.begin(serve=False)
        query = parse_qs(urlsplit(result["authorization_url"]).query)
        return result, query["state"][0]

    def connect(self):
        result, state = self.begin()
        self.manager.callback({"state": [state], "code": ["TEST_CODE"]})
        return self.manager.status(result["attempt_id"])["connections"][0]["id"]

    def test_pkce_state_and_token_secrecy(self):
        result, state = self.begin()
        url = parse_qs(urlsplit(result["authorization_url"]).query)
        self.assertEqual(url["code_challenge_method"], ["S256"])
        self.assertNotIn("client_secret", url)
        self.manager.callback({"state": [state], "code": ["TEST_CODE"]})
        exchange = self.calls[0][1]["form"]
        self.assertIn("code_verifier", exchange)
        public = json.dumps(self.manager.status(result["attempt_id"]))
        for secret in ["TEST_ACCESS", "TEST_REFRESH", "TEST_SECRET", "code_verifier"]:
            self.assertNotIn(secret, public)
        with self.assertRaises(OAuthError): self.manager.callback({"state": [state], "code": ["TEST_CODE"]})

    def test_invalid_expired_and_denied_state(self):
        with self.assertRaises(OAuthError): self.manager.callback({"state": ["unknown"], "code": ["TEST_CODE"]})
        _, state = self.begin()
        self.now += 601
        with self.assertRaises(OAuthError): self.manager.callback({"state": [state], "code": ["TEST_CODE"]})
        _, state = self.begin()
        with self.assertRaises(OAuthError): self.manager.callback({"state": [state], "error": ["access_denied"]})
        self.assertEqual(self.calls, [])
        self.assertEqual(self.vault.value, {})

    def test_authorization_and_analytics_provenance(self):
        grant = self.connect()
        count = len(self.calls)
        with self.assertRaises(OAuthError): self.manager.report({"grant_id": grant, "channel_id": "UCstranger"})
        self.assertEqual(len(self.calls), count)
        result = self.manager.report({"grant_id": grant, "channel_id": "UCowned", "report": "overview"})
        self.assertEqual(result["rows"], [[7]])
        self.assertEqual(result["_meta"]["label"], "MEASURED")
        self.assertNotIn("TEST_ACCESS", self.calls[-1][0])
        self.assertEqual(self.calls[-1][1]["token"], "TEST_ACCESS")

    def test_refresh_remains_backend_only(self):
        grant = self.connect()
        self.now += 4000
        self.manager.report({"grant_id": grant, "channel_id": "UCowned"})
        self.assertTrue(any(call[1].get("form", {}).get("grant_type") == "refresh_token" for call in self.calls))
        self.assertNotIn("TEST_REFRESH", json.dumps(self.manager.status()))

    def test_failed_revocation_keeps_grant(self):
        grant = self.connect()
        self.manager.request = lambda *_args, **_kwargs: (_ for _ in ()).throw(OAuthError("offline"))
        with self.assertRaises(OAuthError): self.manager.disconnect(grant)
        self.assertIn(grant, self.vault.value)

    def test_disconnect_and_date_validation(self):
        grant = self.connect()
        with self.assertRaises(OAuthError): self.manager.report({"grant_id": grant, "channel_id": "UCowned", "start_date": "2026-10-02", "end_date": "2026-10-01"})
        self.assertTrue(self.manager.disconnect(grant)["profile_unchanged"])
        self.assertEqual(self.vault.value, {})

    def test_unconfigured_client_is_explicit(self):
        self.root.joinpath(".local/google-oauth-client.json").unlink()
        self.assertFalse(self.manager.status()["configured"])
        with self.assertRaises(OAuthError): self.manager.begin(serve=False)

    @unittest.skipUnless(os.name == "nt", "DPAPI is Windows-only")
    def test_dpapi_round_trip_no_plaintext(self):
        vault = Vault(self.root / ".local/test.dpapi")
        vault.save({"fixture": "TEST_ACCESS"})
        self.assertNotIn(b"TEST_ACCESS", vault.path.read_bytes())
        self.assertEqual(vault.load(), {"fixture": "TEST_ACCESS"})


if __name__ == "__main__": unittest.main()
