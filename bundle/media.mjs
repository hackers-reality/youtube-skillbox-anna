/* Real YouTube artwork only. Missing assets get an explicit text fallback. */
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const safeImage = (value) => {
  try { const url = new URL(value); return url.protocol === "https:" && /(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com|youtube\.com)$/.test(url.hostname) ? url.href : ""; } catch { return ""; }
};
export function mediaCandidates(item = {}, kind = "video") {
  const nested = Array.isArray(item.thumbnails) ? item.thumbnails.map((t) => t?.url) : Object.values(item.thumbnails || {}).map((t) => t?.url);
  const direct = [item.thumbnail, item.thumbnail_url, item.thumbnailUrl, item.thumb, item.image, item.avatar_url, item.avatar, ...nested].filter((value) => typeof value === "string");
  const id = String(item.id || item.video_id || "");
  const video = kind !== "channel" && /^[\w-]{11}$/.test(id);
  // Home Shorts often expose frame0.jpg (a black opening frame), not the
  // creator's thumbnail. Prefer the real YouTube thumbnail for that case.
  const preferThumbnail = video && direct.some((url) => /\/frame0\.jpg(?:\?|$)/.test(url));
  const fallback = video ? [`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, `https://i.ytimg.com/vi/${id}/mqdefault.jpg`] : [];
  const sized = kind === "channel" ? direct.map((url) => url.replace(/=s\d+(-c[^?]*)?$/, "=s160$1")) : [];
  return [...new Set([...(preferThumbnail ? fallback : []), ...sized, ...direct, ...fallback].map(safeImage).filter(Boolean))];
}
export function mediaImage(item, { kind = "video", className = "yt-thumb", alt = "YouTube thumbnail" } = {}) {
  const candidates = mediaCandidates(item, kind);
  const title = item.title || item.name || "Channel";
  const fallback = kind === "channel" ? String(title).trim().slice(0, 1).toUpperCase() : "Preview unavailable";
  return `<span class="media-frame ${kind === "channel" ? "is-avatar" : ""}">${candidates.length ? `<img class="${escape(className)}" data-media="${kind}" data-media-state="loading" data-media-id="${escape(item.id || item.video_id || '')}" data-media-candidates="${escape(JSON.stringify(candidates))}" src="${escape(candidates[0])}" alt="${escape(alt)}" loading="lazy" referrerpolicy="no-referrer" />` : ""}<span class="media-fallback" ${candidates.length ? "hidden" : ""} aria-label="${escape(kind === 'channel' ? title + ' avatar unavailable' : alt + ' unavailable')}">${escape(fallback)}</span></span>`;
}
export function wireMedia(root = document, resolveAvatar = null) {
  const refreshed = new Map();
  let refreshCount = 0;
  const fail = async (image) => {
    if (!image.matches?.("img[data-media]")) return;
    let candidates; try { candidates = JSON.parse(image.dataset.mediaCandidates); } catch { candidates = []; }
    const next = Number(image.dataset.mediaNext || 1);
    if (next < candidates.length) { image.dataset.mediaNext = String(next + 1); image.src = candidates[next]; return; }
    const channelId = image.dataset.mediaId;
    if (image.dataset.media === "channel" && /^UC[\w-]{22}$/.test(channelId) && resolveAvatar && !image.dataset.mediaRefreshed && refreshCount < 12) {
      image.dataset.mediaRefreshed = "true";
      if (!refreshed.has(channelId)) { refreshCount++; refreshed.set(channelId, Promise.resolve(resolveAvatar(channelId)).catch(() => null)); }
      const profile = await refreshed.get(channelId);
      const urls = mediaCandidates({ ...profile, id: channelId }, "channel").filter((url) => !candidates.includes(url));
      if (urls.length && image.isConnected) { image.dataset.mediaCandidates = JSON.stringify(urls); image.dataset.mediaNext = "1"; image.src = urls[0]; return; }
    }
    image.hidden = true;
    image.dataset.mediaState = "unavailable";
    const fallback = image.parentElement.querySelector(".media-fallback");
    if (fallback) fallback.hidden = false;
  };
  root.addEventListener("error", (event) => { void fail(event.target); }, true);
  root.addEventListener("load", (event) => {
    const image = event.target;
    if (!image.matches?.("img[data-media]")) return;
    if (/\/(hq|mq)default\.jpg/.test(image.src) && image.naturalWidth <= 120) { void fail(image); return; }
    image.hidden = false;
    image.dataset.mediaState = "loaded";
    const fallback = image.parentElement.querySelector(".media-fallback"); if (fallback) fallback.hidden = true;
  }, true);
}
