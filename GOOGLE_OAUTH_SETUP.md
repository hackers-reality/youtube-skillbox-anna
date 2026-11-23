# Google connection — local test setup

This backend is for a controlled local Windows test. It is **not** a production hosted Skillbox identity service. A production app needs its own managed backend, provider verification, privacy policy and multi-user authorization isolation.

## Your console steps

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a YouTube Skillbox project.
2. Enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Under **Google Auth Platform**, configure Branding. Under Audience choose **External**, keep publishing status **Testing**, and add the Google account you will use as a **test user**. Do not post your email/password in chat.
4. Under Data Access, add the requested scopes if the console asks:
   - `openid`, email and profile (account identity)
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/yt-analytics.readonly`
   - Do **not** add upload, force-ssl/manage, monetary or write scopes for this test.
5. Create a client of type **Web application**. Authorized redirect URI, exactly:
   ```text
   http://127.0.0.1:5192/oauth/callback
   ```
6. Download the client JSON. Create `.local` if needed and save it as:
   ```text
   E:\fresh-youtube-skillbox-anna\.local\google-oauth-client.json
   ```
   The JSON must contain the `web` object, client ID/secret and matching redirect URI. `.local/` is ignored by Git. It is outside the shipped browser bundle. **Do not paste the JSON or secret into chat.**

## Connect and verify

1. Start the dependency-correct local harness with `.\dev.ps1`. Do not run a second server on the same port. The source Executa must be restarted after Python edits; a browser refresh only updates frontend files.
2. Refresh the full page at http://localhost:5181/.
3. Open **Analytics → Connect Google**. The backend starts its callback listener on **127.0.0.1:5192 only**.
4. Open Google consent in a separate browser tab. If the Anna sandbox blocks the popup, copy the consent link address and open it in a normal tab. Do not paste the link, callback code or credentials into chat.
5. Choose the Google/Brand account that actually owns your YouTube channel. Approve both read-only YouTube and Analytics permissions.
6. After the callback says the connection completed, return to Skillbox and click **Check connection**.
7. Select an **authorized channel** returned by Google's `channels.list(mine=true)` call. This selector, not a typed public @handle, controls private Analytics.
8. Choose a past date range ending yesterday or earlier and run **Overview**. Test geography/devices/traffic/demographics only when Google returns data; small cohorts and recent data can be omitted.
9. Refresh the harness and use **Refresh connection** to verify encrypted grant persistence. Test another report to exercise refresh when the access token has expired. Google Testing grants can expire after seven days; reconnect when required.
10. To test revocation, use **Disconnect Google account** and confirm. This revokes this client's permission for that Google account (possibly all of its channels). It does not delete your public creator profile, original description, projects or other Google accounts. Do not test revocation until you are ready to reconnect.

## Security boundary

- Client secret, authorization-code exchange, PKCE verifier, access/refresh credentials and refresh/revocation remain in Python.
- One-time OAuth state expires after ten minutes and is consumed before exchange. Google requests use fixed HTTPS hosts and refuse redirects.
- Persistent grants use **Windows DPAPI**, bound to the current OS user, in `.local/google-grants.dpapi`. There is no plaintext Google token file and no tokens in Anna RPC, browser storage or CSV/JSON workspace exports.
- Analytics requests use Authorization headers internally. The browser passes only opaque grant/channel IDs; the server checks channel ownership before using the grant.
- Callback HTTP logging is suppressed, and responses use no-store/no-referrer/CSP headers. Local callback access is restricted by loopback bind and exact Host/path checks.
- A successful Google login does not verify an arbitrary public channel entered elsewhere. Your existing manual verification/description backup is preserved.

## If it fails

- `redirect_uri_mismatch`: check the exact Web client redirect URI; `localhost` and `127.0.0.1` are not interchangeable.
- `access_denied`: check the test-user list and account/Brand channel you selected.
- HTTP 403: check API enablement, granted scopes and channel eligibility. Do not add write/revenue scopes merely to suppress an error.
- No owned channel returned: reconnect with the account/Brand identity that owns the channel.
- Port 5192 busy: identify the old callback service before stopping anything; do not kill unrelated processes.
- Secure vault unavailable: the local persistence adapter is Windows-only. Do not replace it with plaintext token storage.
- Send only the **visible non-secret error** for assistance—never a client secret, Google password, token or callback code.

References: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [YouTube channel reports and supported scopes](https://developers.google.com/youtube/analytics/channel_reports).
