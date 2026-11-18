export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MODEL = "meta/llama-3.2-11b-vision-instruct";
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function jsonError(message, status) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  return Response.json({
    configured: Boolean(process.env.NVIDIA_API_KEY),
    model: process.env.NVIDIA_MODEL || DEFAULT_MODEL,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  if (!process.env.NVIDIA_API_KEY) return jsonError("NVIDIA API key is not configured for this Vercel environment yet.", 503);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) return jsonError("This request is too large. Reduce the image size and try again.", 413);

  let input;
  try {
    input = await request.json();
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }

  const systemPrompt = typeof input.systemPrompt === "string" ? input.systemPrompt.trim() : "";
  const userMessage = typeof input.userMessage === "string" ? input.userMessage.trim() : "";
  const images = Array.isArray(input.images) ? input.images : [];
  if (!userMessage || userMessage.length > 16000 || systemPrompt.length > 8000) {
    return jsonError("Add a message under 16,000 characters; the system context limit is 8,000 characters.", 400);
  }
  if (images.length > 8) return jsonError("You can attach up to 8 images per request.", 400);

  let imageBytes = 0;
  const parts = [{ type: "text", text: userMessage }];
  for (const image of images) {
    if (!image || !ALLOWED_IMAGE_TYPES.has(image.mimeType)) return jsonError("An attached image type is not supported.", 400);
    if (typeof image.data === "string") {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) return jsonError("An attached image was not encoded correctly.", 400);
      imageBytes += Math.floor(image.data.length * 3 / 4);
      if (imageBytes > 2.75 * 1024 * 1024) return jsonError("Attached images are too large. Use smaller images and try again.", 413);
      parts.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } });
      continue;
    }
    if (typeof image.url === "string") {
      let url;
      try { url = new URL(image.url); } catch { return jsonError("An attached image URL is invalid.", 400); }
      const safeHost = ["i.ytimg.com", "img.youtube.com", "yt3.ggpht.com", "yt3.googleusercontent.com", "lh3.googleusercontent.com"].includes(url.hostname);
      if (url.protocol !== "https:" || !safeHost) return jsonError("Only public YouTube/Google image URLs can be analyzed.", 400);
      parts.push({ type: "image_url", image_url: { url: url.href } });
      continue;
    }
    return jsonError("An attached image is missing its data.", 400);
  }

  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: images.length ? parts : userMessage });

  let upstream;
  try {
    upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.NVIDIA_MODEL || DEFAULT_MODEL,
        messages,
        max_tokens: Math.max(128, Math.min(Number(input.maxTokens) || 1600, 4096)),
        temperature: Math.max(0, Math.min(Number(input.temperature) || 0.35, 1)),
        stream: false,
      }),
      signal: AbortSignal.timeout(50000),
      cache: "no-store",
    });
  } catch {
    return jsonError("Could not reach NVIDIA right now. Please try again in a moment.", 502);
  }

  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403) return jsonError("NVIDIA rejected the configured API key. Check the Vercel secret and try again.", 502);
    if (upstream.status === 429) return jsonError("NVIDIA is rate-limiting requests right now. Please wait a moment and retry.", 429);
    if (upstream.status === 400) return jsonError("NVIDIA could not process this request. Check that the selected model supports the content you sent.", 422);
    return jsonError("NVIDIA could not complete the request right now.", 502);
  }

  let result;
  try { result = await upstream.json(); } catch { return jsonError("NVIDIA returned an unreadable response.", 502); }
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) return jsonError("NVIDIA returned an empty response.", 502);
  return Response.json({ content }, { headers: { "Cache-Control": "no-store" } });
}
