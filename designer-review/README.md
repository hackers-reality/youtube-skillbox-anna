# Skillbox private design preview

This standalone Next.js site embeds the current Skillbox interface and routes live LLM requests through a server-only NVIDIA API key. It starts as a guest workspace with no fictional channel or canned chat transcript.

## Vercel setup

In the Vercel project `youtube-skillbox-design-review`, add `NVIDIA_API_KEY` as an encrypted/sensitive environment variable for the Preview environment only. Keep the project’s Vercel Authentication protection enabled. Never use a `NEXT_PUBLIC_` name for this key and never put it in source, browser storage, or a committed env file.

The default model is `meta/llama-3.2-11b-vision-instruct`. To choose another NVIDIA API Catalog model, set the non-secret `NVIDIA_MODEL` variable for Preview and redeploy. The endpoint supports text and image input. The client sends prompts to this Next.js route; the route calls NVIDIA and never returns the key.

The chat works in guest mode without channel verification. Until the app runs inside Anna’s host, Anna Executa tools and live YouTube research are unavailable; the LLM only knows the text and attachments provided in the conversation. Do not present its responses as measured channel analytics.

Run `npm test` and `npm run build` before deployment. For a local development call, set `NVIDIA_API_KEY` in an ignored `.env.local` file; do not pull or commit production secrets.
