export const runtime = "nodejs";
export const maxDuration = 60;

// Use a fast text model for ordinary chat and the vision-language model only
// when images are attached. NVIDIA's reasoning-capable Nemotron models can
// spend the entire token budget in reasoning and return an empty content field;
// disable thinking here because Anna needs the user-facing final answer.
const DEFAULT_TEXT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const DEFAULT_VISION_MODEL = "nvidia/nemotron-3.5-super-vl-120b-a12b";
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function selectedModels() {
  return {
    text: process.env.NVIDIA_TEXT_MODEL || DEFAULT_TEXT_MODEL,
    vision: process.env.NVIDIA_VISION_MODEL || DEFAULT_VISION_MODEL,
  };
}

function extractTextContent(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && (part.type === "text" || typeof part.text === "string"))
      .map((part) => typeof part.text === "string" ? part.text : "")
      .join("\n")
      .trim();
  }
  return "";
}

export async function GET() {
  const models = selectedModels();
  return Response.json({
    configured: Boolean(process.env.NVIDIA_API_KEY),
    models,
    // Keep a simple model field for older status consumers.
    model: models.text,
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
  const imageCandidates = Array.isArray(input.images)
    ? input.images
    : Array.isArray(input.imageBlocks)
      ? input.imageBlocks
      : input.imageBlock && typeof input.imageBlock === "object"
        ? [input.imageBlock]
        : [];
  const images = imageCandidates.map((image) => ({
    ...image,
    data: image?.data ?? (typeof image?.dataUrl === "string" ? image.dataUrl.replace(/^data:[^;]+;base64,/, "") : undefined),
  }));
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

  const models = selectedModels();
  const model = images.length ? models.vision : models.text;
  let upstream;
  try {
    upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: Math.max(512, Math.min(Number(input.maxTokens) || 4096, 8192)),
        temperature: Math.max(0, Math.min(Number(input.temperature) || 0.35, 1)),
        // Prevent reasoning tokens consuming the entire output budget and
        // leaving choices[0].message.content empty.
        chat_template_kwargs: { enable_thinking: false },
        stream: false,
      }),
      signal: AbortSignal.timeout(50000),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return jsonError(timedOut
      ? "NVIDIA took too long to respond. Please retry with a shorter prompt or smaller images."
      : "Could not reach NVIDIA right now. Please try again in a moment.", 502);
  }

  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403) return jsonError("NVIDIA rejected the configured API key. Check the NVIDIA_API_KEY secret in this Vercel environment.", 502);
    if (upstream.status === 429) return jsonError("NVIDIA is rate-limiting requests right now. Please wait a moment and retry.", 429);
    if (upstream.status === 400) {
      let detail = "";
      try {
        const body = await upstream.json();
        detail = typeof body?.error?.message === "string" ? body.error.message.slice(0, 240) : "";
      } catch {}
      return jsonError(detail
        ? `NVIDIA rejected the ${images.length ? "vision" : "text"} request for model ${model}: ${detail}`
        : `NVIDIA rejected the request for model ${model}. Check the model and input format.`, 422);
    }
    return jsonError(`NVIDIA returned HTTP ${upstream.status}. Please retry shortly.`, 502);
  }

  let result;
  try { result = await upstream.json(); }
  catch { return jsonError("NVIDIA returned an unreadable response instead of a JSON chat completion.", 502); }

  const choice = result?.choices?.[0];
  const content = extractTextContent(choice?.message?.content ?? choice?.delta?.content);
  if (!content) {
    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
    return jsonError(
      `NVIDIA (${model}) returned no user-facing text (finish reason: ${finishReason}). Thinking is disabled; retry the request or check the selected model's availability.`,
      502,
    );
  }
  return Response.json({ content, model }, { headers: { "Cache-Control": "no-store" } });
}
