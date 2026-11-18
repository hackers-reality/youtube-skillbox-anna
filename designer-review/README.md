# Skillbox designer review

This is a standalone Next.js shell around the app's current static UI bundle. It is intended for UI/UX review only and seeds a fictional `Northstar Science Lab` workspace in browser-local storage.

- No creator account data is included.
- The Anna host SDK is replaced with a shim that always reports the host unavailable.
- YouTube engine calls, Anna chat/vision, publishing, and creator verification are not available here.
- The sample chat bubble is labeled as sample design content, not as a live Anna response.
- The preview route is marked `noindex` and should remain a Vercel Preview deployment, not Production.

Run `npm install`, then `npm run dev`. Before refreshing the embedded bundle from the monorepo, run `npm run sync`; the Vercel project builds only the checked-in `designer-review` directory and never needs access to files outside it.
