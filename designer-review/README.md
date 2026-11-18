# Skillbox private Preview app

This is the full standalone Skillbox web app, not a static UI mock. Audit, Content Studio, and Retention Fix are backed by the same YouTube Skillbox Python/Executa engine as the Anna app. Chat and image analysis use NVIDIA through a server-only API route. Anna OS is not required by this Preview.

The first visit opens channel setup. Channel discovery uses the public channel handle; verification is the app-generated phrase copied into the channel description manually, as in the Anna app. Guest mode remains available. Workspace state is held in this browser and can be cleared with the app's logout/cache controls.

## Vercel setup

In the Vercel project `youtube-skillbox-design-review`, add `NVIDIA_API_KEY` as an encrypted/sensitive environment variable for the Preview environment only. Keep the project’s Vercel Authentication protection enabled. Never use a `NEXT_PUBLIC_` name for this key and never put it in source, browser storage, or a committed env file.

Set `NVIDIA_MODEL` for Preview to select a NVIDIA NIM-compatible model. The endpoint supports text and image input. The client sends prompts to this Next.js route; the route calls NVIDIA and never returns the key.

The Skillbox tools run as a Python Vercel Function. `postinstall` copies the existing repository adapter into the function bundle, and `requirements.txt` installs the public `youtube-skillbox` engine dependency. The app labels measurements and model interpretations separately; NVIDIA does not invent measured results.

Run `npm test` and `npm run build` before deployment. For local NVIDIA calls, set `NVIDIA_API_KEY` in an ignored `.env.local` file; do not pull or commit secrets. Vercel Authentication must stay enabled, and only Preview deployments should be used for design review.
