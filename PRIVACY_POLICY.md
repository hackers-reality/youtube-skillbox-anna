# YouTube Skillbox Privacy Policy

**Last updated: 23 November 2026**

This policy describes the current YouTube Skillbox creator workspace running inside Anna, including its local Windows development OAuth backend. It does not claim that the local backend is a production-hosted identity service or that the app has completed Google verification.

## 1. Who operates the app

YouTube Skillbox is maintained through the [YouTube Skillbox repository](https://github.com/hackers-reality/youtube-skillbox-anna). Anna, Google/YouTube and the AI providers selected by Anna are separate services with their own policies and terms.

For non-confidential technical questions, contact the maintainers through the repository's issues. **Do not post passwords, OAuth credentials, private Analytics exports or other sensitive information in a public issue.** Before a public production release, the maintainer must provide a dedicated private privacy-contact address and publish this policy at an appropriate public URL. The Google login email is not automatically a public support address.

## 2. Information processed

Depending on the features you choose, the app processes:

- **Public YouTube information:** channel names/handles/IDs, descriptions, subscriber and upload counts when available, titles, public views, thumbnails/avatars/banners, posts, shelves, playlists, captions and other returned public metadata.
- **Creator workspace information:** selected channel profiles, verification status, optional creator focus/goals, saved audits and drafts, chat history, project versions, tasks, calendar plans and app preferences.
- **Files/content you supply:** prompts, notes, transcripts, images, YouTube Studio CSV files and CSV files extracted from ZIP uploads. Such files can contain private information; only supply material you intend the selected workflow to process.
- **Google-authorized information:** account identity and email, Google-returned owned YouTube channels, and the read-only Analytics reports you request for an authorized channel.
- **Technical information:** request/error status and development diagnostics. The local Anna harness can display tool arguments/results, including channel identity and Analytics data, in its developer RPC log. Do not publish that log without reviewing/redacting it.

The app does not ask for your Google password. Google handles sign-in and consent.

## 3. Google access and channel verification

Google authorization is optional for public research and creator tools. It is required for private Analytics.

The current local flow requests account identity (`openid`, email and profile), `youtube.readonly` and `yt-analytics.readonly`. It does not request upload, channel-management, description-editing or monetary-report scopes for this flow. The app does not automatically publish videos, post comments or edit YouTube descriptions.

The backend retrieves channels returned by Google for the consenting account. Private reports are restricted to channels authorized by that stored connection. A typed public handle alone cannot authorize private Analytics or establish Google ownership.

You may choose a Google-owned channel as your verified workspace profile without changing its description. Manual description-phrase verification remains an alternative. If used, the app saves the existing description for reference; you make any YouTube edits yourself. Per-channel backups and preferences are preserved when switching workspace profiles.

## 4. How information is used

Information is used to provide the workflows you select: public channel research, evidence-labelled analysis, content drafting, transcript/retention analysis, private Analytics, saved projects and planning.

Measured data, inferences and creative recommendations are kept conceptually separate. The app does not treat unavailable data as measured zero or claim that a creative recommendation guarantees performance.

The current application does not implement advertising tracking or sale of creator data. Practices of separate platforms/providers are governed by their own policies.

## 5. Anna and AI processing

The app uses Anna's host tool, storage and AI interfaces. Your messages, selected profile/evidence context and attachments can be sent to Anna and the model providers Anna uses to fulfill an AI request.

The local Python Executa performs deterministic parsing/research and authorized Google requests. Anna also brokers its requests/results, so private report data can be processed by the Anna host even when a report is not sent to an AI model for interpretation. Selecting an AI workflow may send the relevant supplied content or findings to an AI provider.

The app cannot independently promise the retention periods, training practices or deletion behavior of Anna, Google or third-party AI providers. Review the applicable service policies before submitting sensitive content. Do not assume an upload or prompt is anonymous.

## 6. Storage and security

- App workspace data uses Anna APS storage when supported/configured. Standalone preview/fallback state and device preferences can use browser local storage.
- Public thumbnail images/metadata can be cached in browser IndexedDB/local app storage for reuse.
- In the current local Windows OAuth backend, the client configuration remains in the developer's ignored `.local/` directory, outside the browser bundle. Persistent Google grants use Windows DPAPI encryption bound to the current OS user.
- Google access/refresh credentials, the client secret and the PKCE verifier are not intentionally returned to the iframe, put in browser workspace storage, included in workspace exports or logged through Anna RPC. Authorization-code exchange, refresh and revocation occur in Python.
- Google API requests use HTTPS and fixed endpoints. The local callback uses HTTP bound to `127.0.0.1` only, with one-use expiring state and PKCE. Callback URL logging is suppressed.

These controls reduce risk but do not guarantee absolute security. A compromised device, browser, operator account or external provider can affect privacy. The local backend is a single-OS-user development implementation; a production multi-user service requires additional isolation, operations and published service details.

## 7. Retention

Workspace information is retained until you remove it through available controls or the relevant platform's retention processes apply. The workspace's default saved-version retention setting is 365 days, but **expiry does not automatically delete data**: you explicitly review and confirm deletion of expired versions.

Google grants remain locally stored until revoked/removed. Access credentials can expire and be refreshed by the backend; Google Testing grants may require reconnection after expiry. Public profile verification and historical workspace context are separate from a currently valid private API grant.

Development files, diagnostic logs and platform backups may have separate retention behavior. This app does not promise that deleting a visible item immediately deletes every platform backup or provider record.

## 8. Your controls

You can use the available controls to:

- Work as a guest, choose a workspace channel, edit creator preferences or remove individual saved items.
- Export workspace records as JSON/CSV and project text. These exports are not a complete account backup and exclude Google credential fields.
- Review and confirm expired-version deletion.
- Delete the creator-workspace collections with typed confirmation. This control is intentionally scoped: it does not automatically delete the protected channel profile/description backup, Google account grants, chat or audit history.
- Use the separate logout/clear-saved-data control for the app data it explicitly lists. Do not confuse workspace deletion, app logout and Google revocation.
- Disconnect a Google account connection and confirm revocation. Google's revocation can affect all channels authorized for that account/client; it does not itself delete your projects or public creator profile.
- Remove the app's access through your Google account's third-party connection controls. Merely deleting a local credential file does **not** revoke permission at Google.
- Clear browser caches/site data, understanding that this does not necessarily remove APS or Google-held information.

For information held by Anna/Google/model providers, use those providers' privacy/account controls and contact channels.

## 9. Cookies and external sites

The app does not implement advertising cookies. Browser storage described above supports app behavior. Anna, Google and external sites may use their own authentication, security or other cookies when you use or open their services; this policy does not replace theirs.

## 10. Children and information about other people

This creator tool is not directed to children under 13. Applicable account-age and consent requirements are governed by the services involved. The current app does not implement an independent age-verification system.

Only upload information you have the right to use. Public availability does not remove your obligations regarding other people's privacy, rights or YouTube's terms.

## 11. Changes

This policy will be updated when data flows, providers, storage, authorization or deployment materially change. The revision date will change. A production-hosted service must update the operator/contact, deployment and provider details before launch rather than relying on this local-development description.
