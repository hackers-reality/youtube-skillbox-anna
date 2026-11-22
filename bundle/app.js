/* YouTube Skillbox — Anna App bundle
 * Static SPA. Talks to:
 *   • Host tools  → anna.tools.invoke({ tool_id, method, args })  (skillbox-core executa)
 *   • Host LLM    → anna.llm.complete({ messages, ... })          (free-form analysis)
 *   • Host storage→ anna.storage.set/get/list                     (saved audits)
 * Evidence labels: MEASURED = measured numbers, INFERRED = reasoned from measured, HYPOTHESIS = unvalidated.
 */

import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";
import { invokeAnnaTool } from "./anna-tool-runtime.mjs";
import { planChatTools } from "./chat-routing.mjs";

const TOOL_ID = (typeof window !== "undefined" && window.__ANNA_TOOL_IDS__ && window.__ANNA_TOOL_IDS__["youtube-skillbox"]) || "bundled:youtube-skillbox";
const DEV_TOOL_ID = "tool-dev-youtube-skillbox";
const PRIMARY_TOOL_ID = typeof location !== "undefined" && /\/dev\//.test(location.pathname + location.search) ? DEV_TOOL_ID : TOOL_ID;
const AUDITS_KEY = "youtube-skillbox:audits";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const byId = (id) => document.getElementById(id);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const parseArgsLine = (s) => {
  const i = s.indexOf("=");
  return i < 0 ? [s.trim(), ""] : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
};

/* ---------- anna connection ---------- */
let anna = null;
let standalone = false;

async function connect() {
  try {
    anna = await AnnaAppRuntime.connect();
    setStatus("Connected to Anna host", true);
    return true;
  } catch (e) {
    standalone = true;
    setStatus("Standalone preview (no host) — wireframe mode", true, true);
    return false;
  }
}

function setStatus(text, ok, warn = false) {
  const dot = byId("status-dot");
  const label = byId("status-text");
  if (dot) dot.className = "dot" + (ok ? " ok" : warn ? "" : " err");
  if (label) label.textContent = text;
}

/* ---------- helpers: tools / llm / storage ---------- */
async function tool(method, args, timeoutMs, options = {}) {
  if (standalone || !anna) {
    throw new Error("Anna host is not connected. Open this app inside Anna AI OS to run live Skillbox tools; no sample measurements were substituted.");
  }

  const invoke = (toolId) => {
    const request = { tool_id: toolId, method, args: args || {} };
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) request.timeoutMs = timeoutMs;
    return invokeAnnaTool(anna, request, options);
  };
  let res;
  try {
    res = await invoke(PRIMARY_TOOL_ID);
  } catch (firstError) {
    // Anna's push rewrites the generated map to the immutable production ID.
    // The local harness declares the dev ID instead, so retry only for that
    // precise declaration mismatch and never mask a real tool failure.
    const message = String(firstError && (firstError.message || firstError));
    if (PRIMARY_TOOL_ID === DEV_TOOL_ID || !/not a declared (required\/optional|required|optional) executa/i.test(message)) throw firstError;
    res = await invoke(DEV_TOOL_ID);
  }

  if (res === undefined || res === null) throw new Error("tool returned no data");
  if (typeof res !== "object") return res;

  // The current SDK normally resolves the plugin payload directly. Accept
  // the explicit RPC envelope as well so older hosts fail transparently.
  if (res.ok === false) {
    const e = res.error;
    const message = typeof e === "string" ? e : (e && (e.message || e.code)) || "Anna host request failed";
    if (PRIMARY_TOOL_ID !== DEV_TOOL_ID && /not a declared (required\/optional|required|optional) executa/i.test(message)) {
      res = await invoke(DEV_TOOL_ID);
    } else {
      throw new Error(message);
    }
  }
  const payload = res.ok === true && "result" in res ? res.result : res;
  if (payload && typeof payload === "object") {
    if (payload.success === false || payload.error) {
      const e = payload.error;
      throw new Error(typeof e === "string" ? e : (e && (e.message || e.code)) || "Skillbox tool failed");
    }
    if (payload.success === true && "data" in payload) return payload.data;
  }
  return payload;
}

async function llm(systemPrompt, userMessage, maxTokens = 3200) {
  if (standalone || !anna) {
    throw new Error("Anna's hosted LLM is unavailable outside the Anna app runtime. No generated result was substituted.");
  }
  const r = await anna.llm.complete({
    messages: [{ role: "user", content: { type: "text", text: userMessage } }],
    systemPrompt,
    maxTokens,
    temperature: 0.35,
  });
  return (r && r.content && r.content.text) || String(r);
}

async function llmWithImage(systemPrompt, userMessage, imageBlock, maxTokens = 2600) {
  if (standalone || !anna) {
    throw new Error("Anna's hosted vision model is unavailable outside the Anna app runtime.");
  }
  const r = await anna.llm.complete({
    messages: [
      { role: "user", content: { type: "text", text: userMessage } },
      { role: "user", content: imageBlock },
    ],
    systemPrompt,
    maxTokens,
    temperature: 0.25,
  });
  return (r && r.content && r.content.text) || String(r);
}

async function llmWithImages(systemPrompt, userMessage, imageBlocks, maxTokens = 3200) {
  if (standalone || !anna) throw new Error("Anna's hosted vision model is unavailable outside the Anna app runtime.");
  const messages = [{ role: "user", content: { type: "text", text: userMessage } }];
  for (const block of imageBlocks) messages.push({ role: "user", content: block });
  const response = await anna.llm.complete({ messages, systemPrompt, maxTokens, temperature: 0.2 });
  return (response && response.content && response.content.text) || String(response);
}

async function storageList(key) {
  if (anna && !standalone) {
    const response = await anna.storage.get({ key });
    const value = response && response.value;
    if (value == null) return [];
    // Older bundle versions stored JSON as a string; accept both that format
    // and native JSON values written by the current app.
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }
    return Array.isArray(value) ? value : [];
  }
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

async function storageSet(key, value) {
  if (anna && !standalone) {
    await anna.storage.set({ key, value });
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

const PROFILE_KEY = "youtube-skillbox:profile";
const CHAT_KEY = "youtube-skillbox:chat";
const THEME_KEY = "youtube-skillbox:theme";
const GUEST_KEY = "youtube-skillbox:guest";
const RETENTION_KEY = "youtube-skillbox:retention-history";
const THUMBNAIL_KEY = "youtube-skillbox:thumbnail-cache";
const THUMBNAIL_DB = "youtube-skillbox-thumbnail-images";
let thumbnailDbPromise = null;
let profileState = null;
let guestMode = false;
let onboardingStep = "identity";
let chatHistory = [];
let chatAttachment = null;
let retentionHistory = [];
let savedAudits = [];
// Keep the user's explicit motion choice for this app session, including when
// a new CSV/ZIP replaces the retention result DOM.
let retentionMotionChoice = null;
let themeToggleBound = false;

function openThumbnailDb() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("This browser does not support a persistent thumbnail cache."));
  if (!thumbnailDbPromise) thumbnailDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(THUMBNAIL_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("images")) request.result.createObjectStore("images", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the thumbnail cache."));
    request.onblocked = () => reject(new Error("The thumbnail cache is busy in another app window."));
  });
  return thumbnailDbPromise;
}

async function thumbnailImageGet(key) {
  const db = await openThumbnailDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("images", "readonly").objectStore("images").get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Could not read the cached thumbnail."));
  });
}

async function thumbnailImagePut(value) {
  const db = await openThumbnailDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Could not save the thumbnail image."));
    tx.onabort = () => reject(tx.error || new Error("Saving the thumbnail image was cancelled."));
  });
  const trimDb = await openThumbnailDb();
  await new Promise((resolve, reject) => {
    const tx = trimDb.transaction("images", "readwrite");
    const store = tx.objectStore("images");
    const request = store.getAll();
    request.onsuccess = () => request.result
      .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0))
      .slice(60)
      .forEach((record) => store.delete(record.key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Could not trim the thumbnail cache."));
  });
}

async function clearThumbnailImageCache() {
  thumbnailDbPromise = null;
  if (!globalThis.indexedDB) return;
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(THUMBNAIL_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Could not clear cached thumbnail images."));
    request.onblocked = () => reject(new Error("Close another Skillbox window before clearing its thumbnail cache."));
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read the cached image."));
    reader.readAsDataURL(blob);
  });
}

async function loadThumbnailImage(item, handle) {
  const id = String(item.id || item.video_id || "");
  const key = `${String(handle || "").toLowerCase()}:${id}`;
  const url = publicThumbnail(item);
  try {
    let record = await thumbnailImageGet(key);
    if (!record?.blob) {
      const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" });
      if (!response.ok) throw new Error(`Thumbnail request returned ${response.status}.`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/") || blob.size > 6 * 1024 * 1024) throw new Error("The thumbnail response was not a supported image.");
      record = { key, id, handle, title: String(item.title || ""), url, blob, mimeType: blob.type, savedAt: Date.now() };
      await thumbnailImagePut(record);
    }
    const dataUrl = await blobToDataUrl(record.blob);
    return { type: "image", data: dataUrl.replace(/^data:[^;]+;base64,/, ""), mimeType: record.mimeType || record.blob.type || "image/jpeg" };
  } catch (_) {
    return { type: "image", url };
  }
}

async function cachedThumbnailImages(handle, limit = 4) {
  const refs = (await storageList(THUMBNAIL_KEY)).filter((item) => item.handle === handle && item.id && item.thumbnail).slice(0, limit);
  const blocks = await Promise.all(refs.map((item) => loadThumbnailImage(item, handle)));
  return { refs, blocks };
}

function generateVerificationPhrase() {
  const source = globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function"
    ? globalThis.crypto.getRandomValues(new Uint16Array(4))
    : [0, 1, 2, 3].map(() => Math.floor(Math.random() * 65536));
  return `Anna Skillbox ${Array.from(source, (value) => String(value).padStart(5, "0")).join("-")}`;
}

function profileName(profile) { return profile && (profile.name || profile.title || profile.channel_name || profile.author || "Channel"); }
function profileHandle(profile) { return profile && (profile.handle || profile.custom_url || profile.channel || profile.channel_url || ""); }
function profileAvatar(profile) { return profile && (profile.avatar || profile.avatar_url || profile.thumbnail || profile.image); }

function openOnboarding(step = "identity") {
  onboardingStep = step;
  renderOnboarding();
  byId("onboarding-modal")?.classList.remove("hidden");
}

function closeOnboarding() { byId("onboarding-modal")?.classList.add("hidden"); }

function renderOnboarding() {
  const content = byId("onboarding-content");
  const title = byId("onboarding-title");
  const copy = byId("onboarding-copy");
  if (!content) return;
  const profile = profileState?.profile;
  const name = profileName(profile || {});
  const handle = profileHandle(profile || {}) || profileState?.handle || "";
  const avatar = profileAvatar(profile || {});
  if (onboardingStep === "guest") {
    title.textContent = "Guest workspace";
    copy.textContent = "Public research remains available. Personal Anna chat is locked until you verify a channel.";
    content.innerHTML = `<div class="onboarding-actions"><button id="guest-connect" class="btn btn-primary" type="button">Connect a channel</button><button id="guest-logout" class="btn" type="button">Log out & clear saved data</button></div>`;
    byId("guest-connect")?.addEventListener("click", () => openOnboarding("identity"));
    byId("guest-logout")?.addEventListener("click", clearWorkspaceSession);
    return;
  }
  if (onboardingStep === "identity") {
    title.textContent = "Make Skillbox yours.";
    copy.textContent = "Enter your exact YouTube channel handle. We’ll show the public channel name and logo before you continue.";
    content.innerHTML = `<label class="field"><span>YouTube channel handle</span><input id="onboarding-handle" type="text" placeholder="@yourchannel" autocomplete="off" spellcheck="false" /></label><div id="onboarding-error" class="hint onboarding-error" aria-live="polite"></div><div class="onboarding-actions"><button id="onboarding-find" class="btn btn-primary" type="button">Find my channel</button><button id="onboarding-guest" class="btn" type="button">Continue as guest</button></div><p class="hint">Guest mode keeps public research available; personal channel chat stays locked.</p>`;
    byId("onboarding-find")?.addEventListener("click", async () => {
      const value = byId("onboarding-handle").value.trim();
      if (!value || (!value.startsWith("@") && !/youtube\.com\/(?:@|channel\/)/i.test(value))) {
        byId("onboarding-error").textContent = "Enter the exact @handle shown on your YouTube channel.";
        return;
      }
      const button = byId("onboarding-find"); button.disabled = true; button.innerHTML = '<span class="spinner"></span> Finding channel…';
      try { await fetchProfile(value); onboardingStep = "confirm"; renderOnboarding(); }
      catch (error) { byId("onboarding-error").textContent = `Could not find that channel. ${error.message || error}`; button.disabled = false; button.textContent = "Try again"; }
    });
    byId("onboarding-guest")?.addEventListener("click", async () => {
      guestMode = true; await storageSet(GUEST_KEY, [true]); renderProfileState(); closeOnboarding();
    });
    return;
  }
  if (onboardingStep === "confirm") {
    title.textContent = "Is this your channel?";
    copy.textContent = "Check the public logo, name and handle. If anything looks wrong, go back and try another handle.";
    content.innerHTML = `${profile.banner_url ? `<img class="onboarding-banner" src="${escapeHtml(profile.banner_url)}" alt="${escapeHtml(name)} channel banner" />` : ''}<div class="onboarding-identity">${avatar ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(name)} channel logo" />` : `<span>${escapeHtml(name.slice(0,1).toUpperCase())}</span>`}<div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(handle)}</small></div></div><div class="onboarding-actions"><button id="onboarding-yes" class="btn btn-primary" type="button">Yes, that’s my channel</button><button id="onboarding-no" class="btn" type="button">No, try another</button></div>`;
    byId("onboarding-yes")?.addEventListener("click", async () => {
      profileState.originalDescription = String(profile.description || profile.about || "");
      profileState.phrase ||= generateVerificationPhrase();
      profileState.verified = false; profileState.confirmed = true;
      await storageSet(PROFILE_KEY, [profileState]); onboardingStep = "phrase"; renderOnboarding();
    });
    byId("onboarding-no")?.addEventListener("click", async () => { profileState = null; await storageSet(PROFILE_KEY, []); onboardingStep = "identity"; renderOnboarding(); renderProfileState(); });
    return;
  }
  if (onboardingStep === "phrase") {
    title.textContent = "Verify it’s really yours.";
    copy.textContent = "Copy this one-time phrase into your channel description manually. We never edit YouTube or ask for OAuth.";
    content.innerHTML = `<label class="field"><span>Unique verification phrase · read-only</span><div class="copy-field"><input id="onboarding-phrase" readonly value="${escapeHtml(profileState.phrase)}" /><button id="onboarding-copy" class="btn" type="button">Copy</button></div></label><div class="onboarding-actions"><button id="onboarding-verify" class="btn btn-primary" type="button">I added it — verify now</button><button id="onboarding-back" class="btn" type="button">Back</button></div><div id="onboarding-error" class="hint onboarding-error" aria-live="polite"></div>`;
    byId("onboarding-copy")?.addEventListener("click", async () => { await navigator.clipboard.writeText(profileState.phrase); byId("onboarding-copy").textContent = "Copied"; });
    byId("onboarding-back")?.addEventListener("click", () => { onboardingStep = "confirm"; renderOnboarding(); });
    byId("onboarding-verify")?.addEventListener("click", async () => {
      const button = byId("onboarding-verify"); button.disabled = true; button.textContent = "Checking public description…";
      try {
        const refreshed = await tool("profile", { handle: profileState.handle }, 85000);
        const description = String(refreshed.description || refreshed.about || "");
        profileState.profile = refreshed;
        profileState.verified = description.includes(profileState.phrase);
        profileState.verificationError = profileState.verified ? "" : "The exact phrase is not visible yet. Save the updated public description and retry.";
        await storageSet(PROFILE_KEY, [profileState]);
        if (profileState.verified) { guestMode = false; profileState.restorationShown = false; await storageSet(GUEST_KEY, [false]); await storageSet(PROFILE_KEY, [profileState]); onboardingStep = "restore"; renderProfileState(); renderOnboarding(); }
        else { byId("onboarding-error").textContent = profileState.verificationError; button.disabled = false; button.textContent = "Retry verification"; }
      } catch (error) { byId("onboarding-error").textContent = `Verification could not be checked: ${error.message || error}`; button.disabled = false; button.textContent = "Retry verification"; }
    });
    return;
  }
  if (onboardingStep === "restore") {
    title.textContent = "You’re verified.";
    copy.textContent = "Your original description was saved before verification. Restore it in YouTube when you’re ready; nothing was changed automatically.";
    const original = String(profileState.originalDescription ?? "");
    content.innerHTML = `<div class="onboarding-identity">${avatar ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(name)} channel logo" />` : `<span>${escapeHtml(name.slice(0,1).toUpperCase())}</span>`}<div><strong>${escapeHtml(name)}</strong><small>✓ Channel verified · ${escapeHtml(handle)}</small></div></div><label class="field mt"><span>Creator focus & goals · used to personalize Channel DNA</span><textarea id="creator-preferences" rows="3" placeholder="e.g. Space and science documentaries for curious beginners; prioritize long-form explainers; avoid unrelated AI trends.">${escapeHtml(profileState.creatorPreferences || "")}</textarea></label><div class="onboarding-actions"><button id="save-creator-preferences" class="btn btn-primary" type="button">Save creator focus</button></div><p class="hint">Your stated focus is considered alongside published videos. It does not overwrite measured channel evidence.</p><label class="field mt"><span>${original ? "Your previous description · saved exactly" : "Previous description not available"}</span><textarea id="original-description" readonly rows="6">${escapeHtml(original)}</textarea></label><div class="onboarding-actions"><button id="copy-description" class="btn" type="button" ${original ? "" : "disabled"}>Copy old description</button><button id="onboarding-chat" class="btn btn-primary" type="button" ${original ? "" : "disabled"}>Ask Anna to refine</button><button id="onboarding-restored" class="btn" type="button">I restored it</button><button id="workspace-logout" class="btn" type="button">Log out & clear saved data</button></div><p class="hint">${original ? "Nothing is changed on YouTube automatically. Copy it back yourself, or ask Anna to refine it first." : "This channel was connected before the original-description backup existed. No original text can be reconstructed, so the current description was not changed."}</p>`;
    byId("save-creator-preferences")?.addEventListener("click", async () => {
      profileState.creatorPreferences = String(byId("creator-preferences")?.value || "").trim().slice(0, 1200);
      await storageSet(PROFILE_KEY, [profileState]);
      byId("save-creator-preferences").textContent = "Saved";
    });
    byId("copy-description")?.addEventListener("click", async () => { await navigator.clipboard.writeText(original); byId("copy-description").textContent = "Copied"; });
    byId("onboarding-chat")?.addEventListener("click", () => { closeOnboarding(); byId("tab-button-chat")?.click(); byId("chat-input").value = "Help me refine my YouTube channel description. Keep my original meaning and voice. Here is my previous description:\n\n" + original; byId("chat-input").focus(); });
    byId("onboarding-restored")?.addEventListener("click", async () => { profileState.restorationShown = true; await storageSet(PROFILE_KEY, [profileState]); closeOnboarding(); });
    byId("workspace-logout")?.addEventListener("click", clearWorkspaceSession);
  }
}

function renderProfileState() {
  const name = byId("nav-profile-name");
  const handle = byId("nav-profile-handle");
  const avatar = byId("nav-avatar");
  if (!profileState || !profileState.profile) {
    if (name) name.textContent = guestMode ? "Guest workspace" : "Set up your channel";
    if (handle) handle.textContent = guestMode ? "Personal chat locked" : "Choose a channel";
    if (avatar) avatar.textContent = guestMode ? "G" : "?";
    byId("chat-guest-note")?.classList.toggle("hidden", !guestMode);
    setPersonalChatEnabled(false);
    return;
  }
  const profile = profileState.profile;
  const displayName = profileName(profile);
  const displayHandle = profileHandle(profile) || profileState.handle;
  const image = profileAvatar(profile);
  if (name) name.textContent = displayName;
  if (handle) handle.textContent = profileState.verified ? displayHandle + " · verified" : displayHandle;
  if (avatar) avatar.innerHTML = image ? `<img src="${escapeHtml(image)}" alt="" />` : escapeHtml(String(displayName).slice(0, 1).toUpperCase());
  byId("chat-guest-note")?.classList.toggle("hidden", !!profileState.verified);
  setPersonalChatEnabled(!!profileState.verified);
}

function setPersonalChatEnabled(enabled) {
  const input = byId("chat-input");
  const send = byId("chat-send");
  const attach = byId("chat-attach");
  if (input) { input.disabled = !enabled; input.placeholder = enabled ? "Ask Anna about your channel…" : "Verify your channel to unlock personal chat…"; }
  if (send) send.disabled = !enabled;
  if (attach) attach.disabled = !enabled;
  $$("[data-chat-prompt]").forEach((button) => { button.disabled = !enabled; });
}

async function clearWorkspaceSession() {
  profileState = null; guestMode = false; chatHistory = []; retentionHistory = []; savedAudits = [];
  for (const key of [PROFILE_KEY, CHAT_KEY, AUDITS_KEY, RETENTION_KEY, THUMBNAIL_KEY, GUEST_KEY]) {
    try { await storageSet(key, []); } catch (_) {}
    try { localStorage.removeItem(key); } catch (_) {}
  }
  try { await clearThumbnailImageCache(); }
  catch (_) { setStatus("Workspace data cleared · close other Skillbox windows to clear thumbnail files", true, true); }
  renderProfileState();
  renderRetentionHistory();
  byId("chat-thread").innerHTML = '<div class="chat-message assistant"><span class="chat-avatar">A</span><div><strong>Anna</strong><p>Saved workspace data has been cleared.</p></div></div>';
  openOnboarding("identity");
}

async function fetchProfile(handleValue) {
  const handle = String(handleValue || "").trim();
  if (!handle) throw new Error("Enter a channel handle.");
  try {
    const profile = await tool("profile", { handle }, 85000);
    if (!profile || typeof profile !== "object" || !profile.name || !(profile.handle || profile.channel_url)) {
      throw new Error(profile?.error || profile?.raw || "The channel tool returned no usable profile; the saved channel identity was left unchanged.");
    }
    const previous = profileState?.handle === handle ? profileState : null;
    profileState = { ...previous, handle, profile, phrase: previous?.phrase || generateVerificationPhrase(), verified: !!previous?.verified };
    await storageSet(PROFILE_KEY, [profileState]);
    const auditHandle = byId("audit-handle");
    if (auditHandle && (!auditHandle.value.trim() || auditHandle.value.trim() === previous?.handle)) auditHandle.value = handle;
    renderProfileState();
    setStatus("Channel workspace ready", true);
    return profileState;
  } catch (error) {
    throw error;
  }
}

function applyTheme(mode) {
  const value = mode === "light" || mode === "dark" ? mode : "system";
  document.documentElement.dataset.theme = value;
  const button = byId("theme-toggle");
  if (button) { button.textContent = value === "light" ? "☼" : value === "dark" ? "☾" : "◐"; button.title = "Theme: " + value; button.setAttribute("aria-label", "Theme: " + value); }
  return value;
}

function cycleTheme() {
  const current = document.documentElement.dataset.theme || "system";
  const next = current === "system" ? "light" : current === "light" ? "dark" : "system";
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
}

function wireRail() {
  const button = byId("rail-toggle");
  const apply = (collapsed) => {
    document.body.classList.toggle("rail-collapsed", collapsed);
    if (button) { button.textContent = collapsed ? "›" : "‹"; button.title = collapsed ? "Expand navigation" : "Collapse navigation"; button.setAttribute("aria-label", button.title); }
  };
  apply(localStorage.getItem("youtube-skillbox:rail-collapsed") === "true");
  button?.addEventListener("click", () => {
    const collapsed = !document.body.classList.contains("rail-collapsed");
    localStorage.setItem("youtube-skillbox:rail-collapsed", String(collapsed)); apply(collapsed);
  });
}

function chatAdd(role, text, loading = false) {
  const thread = byId("chat-thread");
  if (!thread) return null;
  const node = document.createElement("div");
  node.className = "chat-message " + role + (loading ? " is-loading" : "");
  node.innerHTML = `<span class="chat-avatar">${role === "assistant" ? "A" : "Y"}</span><div><strong>${role === "assistant" ? "Anna" : "You"}</strong><p>${loading ? '<span class="typing-dots"><i></i><i></i><i></i></span>' : renderMd(text)}</p></div>`;
  thread.appendChild(node);
  thread.scrollTop = thread.scrollHeight;
  return node;
}

function renderChatAttachment() {
  const box = byId("chat-attachment");
  if (!box) return;
  if (!chatAttachment) {
    box.className = "chat-attachment hidden";
    box.innerHTML = "";
    return;
  }
  const preview = chatAttachment.dataUrl && chatAttachment.type.startsWith("image/")
    ? `<img src="${escapeHtml(chatAttachment.dataUrl)}" alt="Attached thumbnail preview" />`
    : `<span class="file-glyph">${chatAttachment.type.includes("zip") ? "ZIP" : "CSV"}</span>`;
  box.className = "chat-attachment";
  box.innerHTML = `${preview}<span><strong>${escapeHtml(chatAttachment.name)}</strong><small>${escapeHtml(chatAttachment.description || "Ready for Anna to inspect")}</small></span><button id="chat-attachment-remove" class="btn btn-small" type="button" aria-label="Remove attachment">×</button>`;
  byId("chat-attachment-remove")?.addEventListener("click", () => { chatAttachment = null; renderChatAttachment(); });
}

async function readChatAttachment(file) {
  if (!file) return;
  const type = file.type || (file.name.toLowerCase().endsWith(".zip") ? "application/zip" : "text/csv");
  const attachment = { name: file.name, type, file };
  if (type.startsWith("image/")) {
    attachment.dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("Could not read image"));
      reader.readAsDataURL(file);
    });
    attachment.description = "Thumbnail image · Anna can score the hook, hierarchy, contrast and promise";
  } else if (/\.zip$/i.test(file.name) || type.includes("zip")) {
    attachment.entries = await readZipCsvEntries(file);
    attachment.description = `${attachment.entries.length} CSV exports · each will be classified by metric`;
  } else {
    attachment.text = await file.text();
    attachment.description = "CSV export · ready for metric-aware analysis";
  }
  chatAttachment = attachment;
  renderChatAttachment();
}

async function chatContext(message, attachment = null) {
  let evidence = "";
  if (profileState?.verified) {
    const handle = profileState.handle;
    const requests = planChatTools({ message, handle, profile: profileState.profile, hasRetentionAttachment: !!attachment && !attachment.dataUrl });
    const calls = await Promise.allSettled(requests.map(({ method, args, timeout }) => tool(method, args, timeout)));
    const liveValues = calls.filter((call) => call.status === "fulfilled").map((call) => call.value);
    await rememberThumbnailItems(handle, liveValues.flatMap((value) => channelItems(value).concat((Array.isArray(value) ? value : []).flatMap((section) => section?.items || []))));
    const evidenceMap = Object.fromEntries(requests.map(({ key }, index) => [key, calls[index].status === "fulfilled" ? calls[index].value : { error: String(calls[index].reason) }]));
    const videoIndex = requests.findIndex(({ key }) => key === "channel_videos");
    if (videoIndex >= 0 && calls[videoIndex]?.status === "fulfilled") {
      const recentVideos = channelItems(calls[videoIndex].value);
      const outlierIndex = requests.findIndex(({ key }) => key === "channel_outliers");
      const outlierData = outlierIndex >= 0 && calls[outlierIndex]?.status === "fulfilled" ? calls[outlierIndex].value : {};
      const outlierVideos = Array.isArray(outlierData?.outliers) ? outlierData.outliers : channelItems(outlierData);
      const seen = new Set();
      const dnaVideos = [...recentVideos, ...outlierVideos].filter((item) => {
        const id = String(item?.id || item?.video_id || item?.url || item?.title || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      }).slice(0, 40).map((item) => ({
        id: item.id || item.video_id,
        title: item.title || item.name || "",
        description: item.description || "",
        tags: item.tags || [],
        url: item.url || item.video_url || "",
        views: item.views ?? item.view_count,
        format: item.format || item.kind || "video",
      }));
      evidenceMap.channel_videos = { sample_count: dnaVideos.length, sampled_titles: dnaVideos.slice(0, 30).map((item) => item.title) };
      evidenceMap.channel_outliers = { sample_count: outlierVideos.length, used_as_supporting_evidence: true };

      // Caption availability varies by video. Enrich a small, bounded subset;
      // never interpret missing captions as evidence that a topic is absent.
      const transcriptCandidates = dnaVideos.filter((item) => item.id || item.url).slice(0, 6);
      const transcriptResults = await Promise.allSettled(transcriptCandidates.map((item) =>
        tool("transcribe", { video: item.url || item.id, language: "auto" }, 90000)
      ));
      let transcriptCount = 0;
      transcriptResults.forEach((result, index) => {
        if (result.status !== "fulfilled" || !result.value?.success) return;
        const payload = result.value.data || result.value;
        const transcript = String(payload.transcript || "").slice(0, 12000);
        if (!transcript) return;
        const candidate = transcriptCandidates[index];
        const target = dnaVideos.find((item) => String(item.id || item.url) === String(candidate.id || candidate.url));
        if (target) {
          target.transcript = transcript;
          target.transcript_language = payload.language || payload.original_language || "unknown";
          transcriptCount += 1;
        }
      });
      evidenceMap.transcripts = {
        attempted: transcriptCandidates.length,
        available: transcriptCount,
        note: "Only returned captions are used; unavailable captions are not treated as negative topic evidence.",
      };
      try {
        evidenceMap.channel_dna = await tool("channel_dna", {
          videos_json: JSON.stringify(dnaVideos),
          preferences: profileState?.creatorPreferences || profileState?.preferences || "",
        }, 20000);
      } catch (error) {
        evidenceMap.channel_dna = { error: String(error?.message || error) };
      }
    }
    evidence = JSON.stringify(evidenceMap).slice(0, 16000);
  }
  let attachmentContext = "No attachment was provided.";
  if (attachment) {
    try {
      attachmentContext = await attachmentAnalysisContext(attachment);
    } catch (error) {
      attachmentContext = `Attachment analysis unavailable: ${error.message || error}`;
    }
  }
  const savedContext = savedResearchContext();
  const cachedThumbs = await storageList(THUMBNAIL_KEY);
  return `Current workspace profile: ${profileState ? JSON.stringify(profileState.profile) : "not configured"}\nMeasured context (may contain explicit errors; never replace them): ${evidence || "No live tool call was needed for this question."}\nPreviously saved workspace research (cached Anna history; older than live measurements): ${savedContext}\nPreviously seen public thumbnail references (metadata/URLs, not image files): ${JSON.stringify(cachedThumbs.slice(0, 60))}\nAttachment context:\n${attachmentContext}`;
}

async function rememberThumbnailItems(handle, items) {
  const additions = (items || []).filter((item) => item && (item.id || item.video_id) && publicThumbnail(item)).map((item) => ({
    id: String(item.id || item.video_id), title: String(item.title || item.name || ""), surface: String(item.surface || item.kind || "video"),
    thumbnail: publicThumbnail(item), handle: String(handle || ""), seenAt: new Date().toISOString(),
  }));
  if (!additions.length) return;
  const previous = await storageList(THUMBNAIL_KEY);
  const merged = [...additions, ...previous].filter((item, index, all) => all.findIndex((other) => other.id === item.id && other.handle === item.handle) === index).slice(0, 100);
  await storageSet(THUMBNAIL_KEY, merged);
}

function savedResearchContext() {
  const audits = savedAudits.slice(0, 2).map((audit) => {
    const evidence = audit.evidence || {};
    const profile = evidence.profile || {};
    const rows = (value, key) => Array.isArray(value) ? value : (Array.isArray(value?.[key]) ? value[key] : []);
    return {
      saved_at: audit.ts ? new Date(audit.ts).toISOString() : "time unavailable",
      handle: audit.handle,
      channel: profile.name || profile.handle,
      recent_uploads: rows(evidence.latest, "videos").slice(0, 4).map((item) => ({ title: item.title, views: item.views ?? item.view_count })),
      outliers: rows(evidence.outliers, "outliers").slice(0, 4).map((item) => ({ title: item.title, views: item.views ?? item.view_count, ratio: item.ratio })),
      verdict: String(audit.verdict || "").slice(0, 1000),
    };
  });
  const retention = retentionHistory.slice(0, 3).map((record) => ({
    title: record.title,
    saved_at: record.savedAt,
    charts: record.kind === "bundle"
      ? (record.reports || []).filter((report) => report.findings).slice(0, 12).map((report) => ({
        title: report.series ? `${report.profile.title} · ${report.series.label}` : report.profile.title,
        axis: report.findings.axis,
        rows: report.findings.rows_read,
        hook_leak: report.findings.hook_leak,
        cliffs: (report.findings.cliffs || []).slice(0, 3),
        anna_read: report.shortDescription || "No saved interpretation.",
      }))
      : record.findings ? [{ title: record.title, axis: record.findings.axis, rows: record.findings.rows_read, hook_leak: record.findings.hook_leak, cliffs: (record.findings.cliffs || []).slice(0, 3), anna_read: record.recommendation }] : [],
  }));
  return JSON.stringify({ saved_audits: audits, retention_history: retention }).slice(0, 10000);
}

function channelItems(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["items", "videos", "uploads", "shorts"]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function publicThumbnail(item) {
  const direct = item.thumbnail || item.thumbnail_url || item.thumb || item.image;
  const videoId = String(item.id || item.video_id || "");
  return direct || (/^[\w-]{11}$/.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "");
}

async function scoreChannelThumbnails(onProgress) {
  const handle = profileState.handle;
  const [videosResult, shortsResult, outliersResult] = await Promise.allSettled([
    tool("channel", { handle, limit: 15, tab: "videos" }, 145000),
    tool("channel", { handle, limit: 15, tab: "shorts" }, 145000),
    tool("outliers", { handle, min_ratio: 2 }, 180000),
  ]);
  const videos = videosResult.status === "fulfilled" ? channelItems(videosResult.value) : [];
  const shorts = shortsResult.status === "fulfilled" ? channelItems(shortsResult.value) : [];
  const outperformers = outliersResult.status === "fulfilled" ? (outliersResult.value?.outliers || []) : [];
  const byId = new Map(outperformers.map((item) => [String(item.video_id || item.id), item]));
  const items = [...videos.map((item) => ({ ...item, surface: "Video" })), ...shorts.map((item) => ({ ...item, surface: "Short" }))]
    .filter((item, index, all) => item.id && all.findIndex((other) => other.id === item.id) === index && publicThumbnail(item));
  if (!items.length) throw new Error("No public video thumbnails were returned for this channel.");
  await rememberThumbnailItems(handle, items);
  const scored = [];
  const batchSize = 6;
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    const images = await Promise.all(batch.map((item) => loadThumbnailImage(item, handle)));
    const labels = batch.map((item, index) => {
      const performance = byId.get(String(item.id));
      return `${index + 1}. ${item.surface}: ${item.title || item.id} (id ${item.id}; ${fmtViews(item.views ?? item.view_count)} views${performance ? `; measured outlier ${performance.ratio}x channel subscribers` : ""})`;
    }).join("\n");
    onProgress?.(`Reviewing thumbnails ${Math.min(start + batch.length, items.length)} of ${items.length}…`);
    const result = await llmWithImages(
      "You are evaluating public YouTube thumbnails. Give each supplied item its numbered title from the prompt. Score hook clarity, visual hierarchy, contrast, mobile legibility, and promise-match from 1–10; give an overall heuristic score and one concrete improvement. These are subjective visual heuristics, never CTR or view predictions. If an image is unavailable, mark it unavailable rather than guessing.",
      `Creator channel: ${profileName(profileState.profile)} (${handle}). Score each image in the exact order below. Explain notable visual differences between videos and Shorts.\n${labels}`,
      images,
      2400
    );
    scored.push(result);
  }
  return `THUMBNAIL REVIEW · INFERRED VISUAL HEURISTICS\n${items.length} public thumbnails reviewed (${videos.length} videos, ${shorts.length} Shorts returned; duplicate IDs counted once). The view counts/outlier ratios in the prompt are measured metadata; the visual scores are not performance predictions.\n\n${scored.join("\n\n--- Next group ---\n\n")}`;
}

async function scoreChannelBranding() {
  const profile = profileState?.profile || {};
  const assets = [
    { id: "channel-logo", title: "Channel logo", surface: "Channel identity", thumbnail: profileAvatar(profile) },
    { id: "channel-banner", title: "Channel banner", surface: "Channel identity", thumbnail: profile.banner_url || profile.banner || profile.channel_banner },
  ].filter((asset) => asset.thumbnail);
  if (!assets.length) throw new Error("No public channel logo or banner image is available to review.");
  const images = await Promise.all(assets.map((asset) => loadThumbnailImage(asset, profileState.handle)));
  const prompt = assets.map((asset, index) => `${index + 1}. ${asset.title} (${asset.thumbnail})`).join("\n");
  return llmWithImages(
    "Review the supplied public YouTube channel branding images. For each asset, give a subjective heuristic score out of 10 for mobile readability, visual distinction and fit with the channel content; then give one concrete improvement. Do not claim these scores predict views, CTR, trust or subscriber growth. Clearly label visual judgments INFERRED.",
    `Channel: ${profileName(profile)} · ${profileState.handle}\nPublic branding assets in exact image order:\n${prompt}\nChannel description: ${String(profile.description || "unavailable").slice(0, 500)}`,
    images,
    2200
  );
}

async function recentTranscriptContext(onProgress) {
  const handle = profileState.handle;
  const [videosResult, shortsResult] = await Promise.allSettled([
    tool("channel", { handle, limit: 12, tab: "videos", with_duration: true }, 180000),
    tool("channel", { handle, limit: 12, tab: "shorts", with_duration: true }, 180000),
  ]);
  const videos = videosResult.status === "fulfilled" ? channelItems(videosResult.value) : [];
  const shorts = shortsResult.status === "fulfilled" ? channelItems(shortsResult.value) : [];
  const items = [...videos.map((item) => ({ ...item, surface: "Video" })), ...shorts.map((item) => ({ ...item, surface: "Short" }))]
    .filter((item, index, all) => item.id && all.findIndex((other) => other.id === item.id) === index)
    .sort((a, b) => Number(b.upload_date || 0) - Number(a.upload_date || 0)).slice(0, 6);
  if (!items.length) throw new Error("No recent public videos or Shorts were returned.");
  const transcripts = [];
  for (const [index, item] of items.entries()) {
    onProgress?.(`Fetching ${item.surface.toLowerCase()} transcript ${index + 1} of ${items.length}…`);
    try {
      const result = await tool("transcribe", { video: item.id, language: "auto" }, 180000);
      const cues = Array.isArray(result.segments) ? result.segments : [];
      const opening = cues.filter((cue) => Number(cue.start) <= 35).map((cue) => `[${fmtLen(cue.start)}] ${cue.text}`).join(" ");
      transcripts.push({ title: item.title, surface: item.surface, id: item.id, views: item.views ?? item.view_count, transcript_source: result.generated ? "YouTube auto-captions" : "YouTube human captions", language: result.language, opening: (opening || result.transcript || "").slice(0, 2600), error: null });
    } catch (error) { transcripts.push({ title: item.title, surface: item.surface, id: item.id, views: item.views ?? item.view_count, error: String(error.message || error) }); }
  }
  return { transcripts, videoCount: videos.length, shortCount: shorts.length };
}

function wireChat() {
  const form = byId("chat-form");
  if (!form) return;
  byId("chat-attach")?.addEventListener("click", () => byId("chat-file")?.click());
  byId("chat-file")?.addEventListener("change", async () => {
    try { await readChatAttachment(byId("chat-file").files && byId("chat-file").files[0]); }
    catch (error) { chatAdd("assistant", "I couldn’t read that attachment: " + (error.message || error)); }
  });
  const send = async (message) => {
    const text = String(message || byId("chat-input").value || "").trim();
    const attachment = chatAttachment;
    if (!profileState?.verified) { openOnboarding(profileState ? "phrase" : "identity"); return; }
    if (!text && !attachment) { if (!anna || standalone) chatAdd("assistant", "Open this app inside Anna to use the live guide."); return; }
    if ((!anna || standalone) && attachment && !text) { chatAdd("assistant", "Open this app inside Anna to analyze an attachment."); return; }
    byId("chat-input").value = "";
    const userLabel = text || "Please inspect this attachment.";
    chatAdd("user", attachment ? `${userLabel}\n\nAttached: ${attachment.name}` : userLabel);
    chatAttachment = null;
    renderChatAttachment();
    const loading = chatAdd("assistant", "", true);
    byId("chat-send").disabled = true;
    try {
      const system = "You are Anna inside YouTube Skillbox. Answer like a calm creator strategist. Separate MEASURED facts, INFERRED explanations, HYPOTHESES and RECOMMENDATIONS. Use only evidence present in this request; never invent channel numbers, and if context contains an error say the measurement is unavailable. Public view counts, titles, thumbnails and outlier ratios alone cannot establish audience preference, why a video performed, what the recommendation algorithm did, CTR, or causality. Do not state those as facts; if useful, label them HYPOTHESES and name the missing evidence. Never claim YouTube was edited or content was published. Treat prior interpretations as unverified, not evidence. For a thumbnail image, give a transparent heuristic score out of 10 for hook clarity, hierarchy, contrast, mobile legibility and promise match; call it INFERRED, not a prediction of CTR.";
      let response;
      if (!profileState?.verified) throw new Error("Personal Anna chat unlocks after you verify your channel. Public research tools remain available in guest mode.");
      if (!attachment && /(banner|logo|channel branding|brand identity)/i.test(userLabel) && /(score|rate|review|analy[sz]|feedback|improv|look)/i.test(userLabel)) {
        response = await scoreChannelBranding();
      } else if (!attachment?.dataUrl && /(thumbnail|thumbs?)/i.test(userLabel) && /(score|rate|review|compare|analy[sz]|each|all)/i.test(userLabel)) {
        response = await scoreChannelThumbnails((status) => { loading.querySelector("p").innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span> ${escapeHtml(status)}`; });
      } else if (!attachment && /(transcript|transcribe|hook|opening|first\s*(?:15|30)\s*seconds)/i.test(userLabel)) {
        const batch = await recentTranscriptContext((status) => { loading.querySelector("p").innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span> ${escapeHtml(status)}`; });
        const measured = batch.transcripts.map((item) => `${item.surface}: ${item.title} · ${item.views == null ? "views unavailable" : fmtViews(item.views) + " views"}\n${item.error ? "TRANSCRIPT UNAVAILABLE: " + item.error : `Captions: ${item.transcript_source} (${item.language || "language unavailable"})\nOpening cues: ${item.opening || "No opening caption cues returned."}`}`).join("\n\n");
        response = await llm(system, `Creator question: ${userLabel}\nChannel: ${profileName(profileState.profile)}\nRecent items returned: ${batch.videoCount} videos, ${batch.shortCount} Shorts. I fetched up to six recent transcripts to avoid excessive YouTube requests. Analyze the supplied openings for hook patterns and differences. Caption text is measured transcript evidence; hook-quality judgments are inferred. Do not claim retention is known: owner-only retention requires a Studio CSV supplied by the creator.\n\n${measured}`, 3200);
      } else {
        const context = await chatContext(userLabel, attachment);
        if (attachment?.dataUrl) {
          response = await llmWithImage(system, context + "\n\nCreator question: " + userLabel + "\nScore this attached thumbnail using the requested rubric.", { type: "image", data: attachment.dataUrl.replace(/^data:[^;]+;base64,/, ""), mimeType: attachment.type }, 2800);
        } else if (!attachment && /(thumbnail|thumb|visual|why|view|outlier|underperform|perform)/i.test(userLabel)) {
          const cached = await cachedThumbnailImages(profileState.handle, 4);
          const visualContext = cached.refs.length
            ? `\n\nCached channel thumbnail images supplied in matching order (reused from local image cache where available): ${cached.refs.map((item, index) => `${index + 1}. ${item.surface}: ${item.title || item.id} · ${item.id}`).join("; ")}`
            : "\n\nNo thumbnail images were available in the workspace cache; do not make visual claims.";
          response = cached.blocks.length
            ? await llmWithImages(system, context + visualContext + "\n\nCreator question: " + userLabel, cached.blocks, 3000)
            : await llm(system, context + visualContext + "\n\nCreator question: " + userLabel, 2800);
        } else response = await llm(system, context + "\n\nCreator question: " + userLabel, 2800);
      }
      loading.remove();
      chatAdd("assistant", response);
      chatHistory.push({ role: "user", text: userLabel, attachment: attachment ? attachment.name : undefined }, { role: "assistant", text: response });
      await storageSet(CHAT_KEY, chatHistory.slice(-12));
    } catch (error) {
      loading.remove();
      chatAdd("assistant", "I couldn’t finish that request: " + (error.message || error));
    } finally { byId("chat-send").disabled = false; }
  };
  byId("chat-input")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    form.requestSubmit();
  });
  form.addEventListener("submit", (event) => { event.preventDefault(); send(); });
  $$("[data-chat-prompt]").forEach((button) => button.addEventListener("click", () => send(button.dataset.chatPrompt)));
  $$('[data-open-onboarding]').forEach((button) => button.addEventListener("click", () => openOnboarding("identity")));
  byId("nav-profile")?.addEventListener("click", async () => {
    if (profileState?.profile && (!profileAvatar(profileState.profile) || !(profileState.profile.banner_url || profileState.profile.banner || profileState.profile.channel_banner))) {
      try { await fetchProfile(profileState.handle); } catch (_) { /* Keep the saved identity and retry on the next profile open. */ }
    }
    openOnboarding(profileState?.verified ? "restore" : guestMode ? "guest" : profileState?.confirmed ? "phrase" : profileState ? "confirm" : "identity");
  });
  byId("onboarding-close")?.addEventListener("click", () => { if (!profileState?.verified && !guestMode) return; closeOnboarding(); });
}

async function loadWorkspaceState() {
  try { profileState = (await storageList(PROFILE_KEY))[0] || null; } catch (_) { profileState = null; }
  try { guestMode = (await storageList(GUEST_KEY))[0] === true; } catch (_) { guestMode = false; }
  try { chatHistory = await storageList(CHAT_KEY); } catch (_) { chatHistory = []; }
  try { retentionHistory = (await storageList(RETENTION_KEY)).slice(0, 12); } catch (_) { retentionHistory = []; }
  const auditHandle = byId("audit-handle");
  if (auditHandle && profileState?.handle) auditHandle.value = profileState.handle;
  if (profileState?.verified && (!profileAvatar(profileState.profile) || !(profileState.profile?.banner_url || profileState.profile?.banner || profileState.profile?.channel_banner))) {
    try { await fetchProfile(profileState.handle); } catch (_) { /* Keep saved identity; retry public image lookup on the next profile open. */ }
  }
  renderRetentionHistory();
  renderProfileState();
  const mode = localStorage.getItem(THEME_KEY) || "system";
  applyTheme(mode);
  if (!themeToggleBound) {
    byId("theme-toggle")?.addEventListener("click", cycleTheme);
    themeToggleBound = true;
  }
  if (profileState?.verified && !profileState.restorationShown) openOnboarding("restore");
  else if (guestMode) openOnboarding("guest");
  else if (!profileState?.verified) openOnboarding(profileState?.confirmed ? "phrase" : profileState ? "confirm" : "identity");
}

/* ---------- tabs ---------- */
function wireTabs() {
  const tabButtons = $$(".tab");
  function activateTab(btn, moveFocus = false) {
    tabButtons.forEach((item) => {
      const active = item === btn;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      const panel = byId("tab-" + item.dataset.tab);
      if (panel) panel.classList.toggle("is-active", active);
    });
    if (moveFocus) btn.focus();
    byId("app-main")?.scrollTo({ top: 0, behavior: "smooth" });
  }
  tabButtons.forEach((btn, index) => {
    btn.addEventListener("click", () => activateTab(btn));
    btn.addEventListener("keydown", (event) => {
      let next = null;
      if (event.key === "ArrowRight") next = tabButtons[(index + 1) % tabButtons.length];
      if (event.key === "ArrowLeft") next = tabButtons[(index - 1 + tabButtons.length) % tabButtons.length];
      if (event.key === "Home") next = tabButtons[0];
      if (event.key === "End") next = tabButtons[tabButtons.length - 1];
      if (next) {
        event.preventDefault();
        activateTab(next, true);
      }
    });
  });
}

/* ---------- audit pipeline ---------- */
const AUDIT_SYSTEM = `
You are the YouTube Skillbox analyst. You receive hard tool data (channel counts, subs, videos, outliers, keywords, scorecards) — never invent numbers.
ABSOLUTE RULES (not suggestions):
1. Any \`error\` key, empty/unstructured response, or explicit \`raw\` output without parsed fields means that measurement is unavailable. State the reason; NEVER fill it in.
2. A structured outlier response with a measured baseline and an empty outlier list means "no items crossed the configured threshold" — not unavailable.
3. If all core measurements (profile, videos, Shorts, outliers) fail or are unstructured, say exactly: "ENGINE BLOCKED: insufficient measured data from this host. No verdict will be invented." Nothing more.
4. Clearly state that video and Shorts samples are capped at the first 15 returned public uploads. A capped sample is not the full channel history.
5. Never claim that the YouTube algorithm caused a result, that a topic caused growth, or that a topic is the audience's preference. Public counts do not establish causality. Label any interpretation INFERRED or HYPOTHESIS and state the limitation.
6. MEASURED/INFERRED/HYPOTHESIS tags mandatory, one per claim. Numbers must trace to evidence fields.

Write with a creator's directness: specific fixes, no filler, no "great job". Structure:
1) THE ONE-LINE VERDICT
2) MEASURED snapshot (only real numbers, with video/Shorts sample counts)
3) What's working (evidence)
4) The 3 highest-leverage fixes, one line each
5) What NOT to do, one line
6) Keyword angle if structured keyword data exists, otherwise "MEASURED: unavailable"

Max ~900 words. Markdown.`;

async function runAudit(handle, retryKeys = null) {
  handle = (handle || "").trim();
  if (!handle) return setAuditResult("<div class='card'><h3>Nothing to audit</h3><p>Enter a channel handle first — @YourChannel.</p></div>", false);

  const progress = byId("audit-progress");
  const bar = byId("audit-bar");
  const stage = byId("audit-stage");
  const btn = byId("audit-run");
  const rawBox = byId("audit-raw");
  const rawPre = byId("audit-raw-pre");
  const result = byId("audit-result");

  let priorEvidence = {};
  if (Array.isArray(retryKeys) && retryKeys.length) {
    try {
      const previous = await storageList(AUDITS_KEY);
      const target = String(handle).replace(/^@/, "").toLowerCase();
      const saved = previous.find((item) => String(item.handle || "").replace(/^@/, "").toLowerCase() === target);
      if (saved && saved.evidence && typeof saved.evidence === "object") priorEvidence = saved.evidence;
      else retryKeys = null;
    } catch (_) { retryKeys = null; }
  }

  progress.classList.remove("hidden");
  result.classList.add("hidden");
  btn.disabled = true;
  rawBox.classList.add("hidden");

  const pctLabel = byId("audit-pct");
  const setStage = (pct, text) => {
    bar.style.width = pct + "%";
    stage.textContent = text;
    if (pctLabel) pctLabel.textContent = pct + "%";
    const progressBar = progress.querySelector('[role="progressbar"]');
    if (progressBar) progressBar.setAttribute("aria-valuenow", String(pct));
  };
  setStage(5, "Fetching channel identity…");

  const allJobs = [
    { key: "profile", label: "channel identity", args: { handle }, timeoutMs: 85000 },
    { key: "videos", method: "channel", label: "first 15 public video uploads", args: { handle, limit: 15, tab: "videos" }, timeoutMs: 180000 },
    { key: "shorts", method: "channel", label: "first 15 public Shorts", args: { handle, limit: 15, tab: "shorts" }, timeoutMs: 180000 },
    { key: "outliers", label: "outliers", args: { handle, min_ratio: 2.0 }, timeoutMs: 180000 },
  ];
  const jobs = Array.isArray(retryKeys) ? allJobs.filter((job) => retryKeys.includes(job.key)) : allJobs;

  const evidence = { ...priorEvidence };
  const errors = {};
  let completed = 0;
  const results = await Promise.all(jobs.map(async (job) => {
    setStage(15, `Running ${job.label}…`);
    try {
      const value = await tool(job.method || job.key, job.args, job.timeoutMs, {
        onProgress: (event) => {
          const phase = event && typeof event.type === "string" ? event.type : "working";
          const detail = event && event.data && typeof event.data === "object"
            ? event.data.message || event.data.stage || event.data.phase : event && event.data;
          setStage(15 + completed * 12, `Running ${job.label} · ${String(detail || phase)}…`);
        }
      });
      return { job, value };
    } catch (error) { return { job, error }; }
    finally { completed += 1; setStage(15 + completed * 12, `Measured ${completed} of ${jobs.length} core signals…`); }
  }));
  for (const result of results) {
    if (result.error) {
      const message = String(result.error.message || result.error);
      evidence[result.job.key] = { error: message };
      errors[result.job.label] = message;
    } else evidence[result.job.key] = result.value;
  }
  // The Videos endpoint may include Shorts in its uploads feed. Keep the
  // audit's two samples genuinely distinct using the canonical public URL.
  const sampleItems = (value) => value && (Array.isArray(value)
    ? value : (value.items || value.videos || value.uploads || []));
  for (const [key, predicate] of [
    ["videos", (item) => !/youtube\.com\/shorts\//i.test(String(item.url || item.webpage_url || ""))],
    ["shorts", (item) => /youtube\.com\/shorts\//i.test(String(item.url || item.webpage_url || ""))],
  ]) {
    const collection = evidence[key];
    const items = sampleItems(collection);
    if (Array.isArray(items) && !collection?.error) {
      const filtered = items.filter(predicate).slice(0, 15);
      evidence[key] = Array.isArray(collection) ? filtered : { ...collection, items: filtered };
    }
  }
  const useful = (key, value) => {
    if (!value || value.error) return false;
    if (key === "profile") return !!(value.name || value.title || value.handle || value.channel_url);
    if (key === "videos" || key === "shorts") return Array.isArray(value)
      || ["items", "videos", "uploads"].some((field) => Array.isArray(value[field]));
    if (key === "outliers") return (Array.isArray(value.outliers) && value.outliers.length > 0)
      || (Array.isArray(value.outliers) && ["subscribers", "baseline", "min_ratio", "threshold", "total_videos"].some((field) => value[field] != null));
    return false;
  };
  const allFailed = ["profile", "videos", "shorts", "outliers"].every((key) => !useful(key, evidence[key]));

  if (allFailed) {
    setStage(100, "Engine blocked from this host.");
    rawPre.textContent = JSON.stringify({ evidence }, null, 2);
    rawBox.classList.remove("hidden");
    result.innerHTML = `<div class="card bigfix">
      <div class="label">ENGINE BLOCKED — nothing measured</div>
      <div class="audit-report" style="margin-top:8px">
        <strong>MEASURED:</strong> 0 of ${jobs.length} tool calls succeeded.<br><br>
        <strong>Errors:</strong><br>${Object.entries(errors).map(([k,v]) => `• <strong>${escapeHtml(k)}</strong> — ${escapeHtml(v.slice(0,300))}`).join("<br>")}<br><br>
        <strong>What to check:</strong> inspect the raw tool responses, confirm the Executa is available to this Anna host, and retry later if the provider rate-limited the request.<br><br>
        <strong>No verdict was generated.</strong> Missing measurements are never replaced with sample numbers.
      </div>
    </div>`;
    result.classList.remove("hidden");
    progress.classList.add("hidden");
    btn.disabled = false;
    return;
  }

  if (!Array.isArray(retryKeys) || retryKeys.includes("keywords")) {
  setStage(70, "Scoring keyword opportunity…");
  try {
    const seed = (() => {
      const p = evidence.profile || evidence.snapshot?.profile || {};
      const outs = evidence.outliers && (evidence.outliers.outliers || evidence.outliers.videos) || [];
      const samples = [
        ...(Array.isArray(outs) ? outs : []),
        ...(Array.isArray(evidence.videos) ? evidence.videos : evidence.videos?.items || []),
        ...(Array.isArray(evidence.shorts) ? evidence.shorts : evidence.shorts?.items || [])
      ];
      const title = samples.find((item) => item && (item.title || item.name))?.title
        || samples.find((item) => item && item.name)?.name;
      const clean = (value) => String(value || "").replace(/#[\p{L}\p{N}_-]+/gu, " ")
        .replace(/[|•·]/g, " ").replace(/\s+/g, " ").trim();
      if (title) {
        const topic = clean(title);
        if (topic) return topic.length > 60 ? topic.slice(0, 60).replace(/\s+\S*$/, "") : topic;
      }
      const tags = Array.isArray(p.tags) ? p.tags.filter(Boolean).join(" ") : String(p.tags || "");
      if (clean(tags)) return clean(tags).slice(0, 60);
      const description = p.description || "";
      if (description) {
        const first = clean(String(description).split(/[.\n]/)[0]);
        if (first && first.split(/\s+/).length >= 4) return first.slice(0, 60);
      }
      return handle;
    })();
    evidence.keyword_seed = seed;
    // Audit keyword sampling stays bounded to the seed on both providers. The
    // standalone deep-research method keeps its full alphabet expansion.
    evidence.keywords = await tool("keywords", { seed, limit: 12, letters: "" }, 85000);
    const keywordData = evidence.keywords;
    const keywordRows = Array.isArray(keywordData) ? keywordData
      : keywordData && ["keywords", "ideas", "items"].some((field) => Array.isArray(keywordData[field]) && keywordData[field].length);
    if (!keywordRows) {
      const raw = keywordData && keywordData.raw ? ` Engine response: ${String(keywordData.raw).slice(0, 180)}` : "";
      evidence.keywords = { error: `Keyword engine returned no structured keyword rows.${raw}` };
    }
  } catch (e) {
    evidence.keywords = { error: String(e.message || e) };
  }
  }

  const videoItems = (value) => value && (Array.isArray(value) ? value : (value.items || value.videos || value.uploads || []));
  const missingCore = ["profile", "videos", "shorts", "outliers"].filter((key) => !useful(key, evidence[key]));
  const missingKeyword = !useful("keywords", evidence.keywords);
  const measuredCount = 5 - missingCore.length - (missingKeyword ? 1 : 0);
  const safeFallback = () => {
    const p = evidence.profile || {};
    const outs = evidence.outliers && (evidence.outliers.outliers || evidence.outliers.videos) || [];
    const top = outs[0];
    const videos = videoItems(evidence.videos) || [];
    const shorts = videoItems(evidence.shorts) || [];
    const unavailable = missingCore.map((key) => `- ${key}: unavailable (${String(evidence[key]?.error || "no structured measurements returned")})`).join("\n");
    return [
      "### Measured audit status",
      `- Channel: ${p.name || handle} (${handle})`,
      `- Subscribers: ${p.subscribers == null ? "unavailable" : Number(p.subscribers).toLocaleString()}`,
      `- Public upload count: ${p.video_count == null ? "unavailable" : Number(p.video_count).toLocaleString()}`,
      `- Video sample: ${videos.length} returned; request capped at first 15.`,
      `- Shorts sample: ${shorts.length} returned; request capped at first 15.`,
      `- Outlier check: ${outs.length} uploads above ${evidence.outliers?.min_ratio ?? "configured"}× views/subscribers in this engine result.`,
      top ? `- Highest measured outlier: ${top.title || top.video_id || "upload"} — ${Number(top.views || 0).toLocaleString()} views, ${top.ratio}×.` : "- Highest measured outlier: none returned.",
      "",
      "### Measurement status",
      unavailable || "- None of the core measurements were marked unavailable.",
      evidence.keywords?.error ? `- Keywords: unavailable (${evidence.keywords.error})` : "- Keywords: structured data returned.",
      "",
      "### Interpretation limit",
      "These public counts and titles describe this sample only. They cannot establish why a video performed as it did, what the audience prefers, or how YouTube recommendations contributed.",
      "",
      missingCore.length
        ? "Retry the unavailable core measurements to complete the audit."
        : evidence.keywords?.error
          ? "The channel, upload samples, and outlier check completed; keyword data is the only unavailable measurement."
          : "Use retention exports, thumbnail comparisons, and traffic-source data before making content or packaging decisions."
    ].join("\n");
  };

  setStage(85, "Building an evidence-only audit…");
  // The host LLM has repeatedly added unsupported causal claims even when
  // explicitly instructed not to. Keep this report deterministic; chat can
  // still discuss these facts while clearly labeling any interpretation.
  const verdict = safeFallback();

  setStage(100, measuredCount === 5
    ? "All five audit measurements returned."
    : `Partial audit · ${measuredCount}/5 measurements returned.`);

  // persist
  try {
    const audits = await storageList(AUDITS_KEY);
    audits.unshift({ ts: Date.now(), handle, evidence, verdict });
    const history = audits.slice(0, 5);
    // runtime_state is capped at 256 KB by Anna; keep margin for metadata
    // and UTF-8 encoding rather than allowing a silent oversize write.
    while (history.length > 1
      && new TextEncoder().encode(JSON.stringify(history)).byteLength > 180 * 1024) {
      history.pop();
    }
    if (new TextEncoder().encode(JSON.stringify(history)).byteLength > 180 * 1024) {
      throw new Error("This audit is too large to fit in the 256 KB Anna window-state store.");
    }
    await storageSet(AUDITS_KEY, history);
  } catch (storageError) {
    setStatus("Audit complete · saved-audit storage unavailable", true, true);
  }

  rawPre.textContent = JSON.stringify({ evidence, verdict }, null, 2);
  rawBox.classList.remove("hidden");

  result.innerHTML = renderAuditCards(handle, evidence, verdict);
  wireAuditRetry(result, handle);
  result.classList.remove("hidden");
  progress.classList.add("hidden");
  btn.disabled = false;
  await renderSavedList();
}

function renderAuditCards(handle, ev, verdict) {
  const sec = (ev.snapshot && ev.snapshot.sections) || {};
  const prof = ev.profile || (ev.snapshot && ev.snapshot.profile) || {};
  const listData = (value) => (value && (Array.isArray(value) ? value : (value.items || value.videos || value.uploads || []))) || [];
  const videoItems = listData(ev.videos);
  const shortItems = listData(ev.shorts);
  const outliers = (ev.outliers && (Array.isArray(ev.outliers) ? ev.outliers : (ev.outliers.outliers || ev.outliers.videos || []))) || [];
  const kw = (ev.keywords && (Array.isArray(ev.keywords) ? ev.keywords : (ev.keywords.keywords || ev.keywords.ideas || []))) || [];

  const subs = prof.subscribers ?? sec.subs ?? "?";
  const videos = sec.videos ?? prof.video_count ?? "?";
  const shorts = sec.shorts ?? "?";
  const hasBreakdown = sec.videos != null || sec.shorts != null;
  const contentCount = hasBreakdown
    ? `${escapeHtml(String(videos))}<span style="color:var(--text-dim);font-size:15px"> / ${escapeHtml(String(shorts))}</span>`
    : escapeHtml(String(videos));
  const contentLabel = hasBreakdown ? "Long-form / Shorts" : "Total public videos";
  const auditSignals = [
    ["profile", "Channel identity"], ["videos", "Video sample"], ["shorts", "Shorts sample"],
    ["outliers", "Outlier check"], ["keywords", "Keyword research"]
  ];
  const signalAvailable = (key, value) => {
    if (!value || value.error) return false;
    if (key === "profile") return !!(value.name || value.title || value.handle || value.channel_url);
    if (key === "videos" || key === "shorts") return Array.isArray(value)
      || ["items", "videos", "uploads"].some((field) => Array.isArray(value[field]));
    if (key === "outliers") return (Array.isArray(value.outliers) && value.outliers.length > 0)
      || (Array.isArray(value.outliers) && ["subscribers", "baseline", "min_ratio", "threshold", "total_videos"].some((field) => value[field] != null));
    if (key === "keywords") return Array.isArray(value)
      || ["keywords", "ideas", "items"].some((field) => Array.isArray(value[field]) && value[field].length > 0);
    return false;
  };
  const measuredSignals = auditSignals.filter(([key]) => signalAvailable(key, ev[key]));
  const missingSignals = auditSignals.filter(([key]) => !signalAvailable(key, ev[key]));
  const coverageNote = missingSignals.length
    ? `<div class="note warn audit-availability"><b>PARTIAL AUDIT · ${measuredSignals.length}/${auditSignals.length} measurements returned</b><span>Unavailable: ${missingSignals.map(([key, label]) => `${escapeHtml(label)}${ev[key]?.error ? ` — ${escapeHtml(String(ev[key].error).slice(0, 150))}` : " — no structured result"}`).join(" · ")}</span>${missingSignals.some(([key]) => key === "keywords") && ev.keyword_seed ? `<span>Keyword topic tested: ${escapeHtml(String(ev.keyword_seed))}</span>` : ""}<span>Retry only the missing checks; successful measurements will be kept.</span><button id="audit-retry-missing" data-retry-keys="${missingSignals.map(([key]) => key).join(",")}" class="btn btn-small" type="button">Retry missing checks</button></div>`
    : `<div class="note audit-coverage"><b>AUDIT COVERAGE · ${measuredSignals.length}/${auditSignals.length} measurements returned</b><span>Identity, video and Shorts samples, outlier check, and keyword research returned structured results. Upload samples remain capped at 15 each.</span></div>`;

  const outRows = outliers.slice(0, 6).map((v) =>
    `<tr><td>${escapeHtml(String(v.title || v.id || "").slice(0, 90))}</td><td>${escapeHtml(String(v.views ?? v.view_count ?? "?"))}</td><td>${escapeHtml(String(v.ratio ?? "—"))}</td></tr>`
  ).join("");

  const kwRows = kw.slice(0, 8).map((k) => {
    const oppRaw = k.opportunity_score ?? k.score;
    const compRaw = k.competition_score ?? k.competition;
    const opp = oppRaw == null || !isFinite(Number(oppRaw)) ? "—" : Number(oppRaw);
    const comp = compRaw == null || !isFinite(Number(compRaw)) ? "—" : Number(compRaw);
    const verdict2 = /^[A-Z]/.test(String(k.verdict || "")) ? String(k.verdict) : "—";
    return `<tr><td>${escapeHtml(String(k.keyword || k.seed || ""))}</td><td>${opp}</td><td>${comp}</td><td>${escapeHtml(verdict2)}</td></tr>`;
  }).join("");

  const uploadCard = (label, items, kind) => {
    const source = ev[kind];
    if (source && source.error) return "";
    const sample = items.slice(0, 15);
    const entries = sample.map((item) => {
      const title = String(item.title || item.name || item.id || "Untitled upload");
      const image = item.thumbnail || item.thumbnail_url || item.thumbnailUrl || item.thumbnails?.[0]?.url;
      const href = item.url || item.video_url || (item.id ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}` : "");
      const media = image ? `<img loading="lazy" src="${escapeHtml(image)}" alt="" />` : `<span class="audit-upload-placeholder">${kind === "shorts" ? "SHORT" : "VIDEO"}</span>`;
      return `<a class="audit-upload" ${href ? `href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"` : ""}>${media}<span>${escapeHtml(title)}</span></a>`;
    }).join("");
    const coverage = source && source.sample_count != null ? source.sample_count : sample.length;
    const status = items.length ? `First ${Math.min(15, Number(coverage) || sample.length)} returned · capped at 15` : "Measured response contained no public uploads";
    return `<div class="card"><h3>${label} <span class="ev ev-measured">MEASURED</span></h3><p class="hint">${escapeHtml(status)}. Not the channel’s full upload history.</p>${entries ? `<div class="audit-upload-grid ${kind === "shorts" ? "is-shorts" : "is-videos"}">${entries}</div>` : ""}</div>`;
  };

  return `${coverageNote}
  <div class="card">
    <h3>MEASURED — Channel snapshot <span class="ev ev-measured">MEASURED</span></h3>
    <div class="grid-2">
      <div class="stat"><div class="n">${escapeHtml(String(subs))}</div><div class="k">Subs</div></div>
      <div class="stat"><div class="n">${contentCount}</div><div class="k">${contentLabel}</div></div>
    </div>
  </div>

  ${uploadCard("Recent videos", videoItems, "videos")}
  ${uploadCard("Recent Shorts", shortItems, "shorts")}

  ${outliers.length ? `<div class="card"><h3>Outliers — measured above threshold <span class="ev ev-measured">MEASURED</span></h3>
    <table class="tbl"><thead><tr><th>Video</th><th>Views</th><th>Views/Subs</th></tr></thead><tbody>${outRows}</tbody></table></div>` : ""}
  ${ev.outliers && !ev.outliers.error && Array.isArray(ev.outliers.outliers) && !outliers.length ? `<div class="card"><h3>Outlier check <span class="ev ev-measured">MEASURED</span></h3><p>No public uploads in the measured set crossed the ${escapeHtml(String(ev.outliers.min_ratio ?? ev.outliers.threshold ?? "configured"))}× views/subscribers threshold. This is not a statement about why they performed that way.</p></div>` : ""}

  ${kwRows ? `<div class="card"><h3>Keyword angles <span class="ev ev-measured">MEASURED</span> · <span class="hint" style="margin:0">verdicts are INFERRED</span></h3>
    <table class="tbl"><thead><tr><th>Idea</th><th>Opportunity</th><th>Competition</th><th>Call</th></tr></thead><tbody>${kwRows}</tbody></table></div>` : ""}

  <div class="card bigfix">
    <div class="label">The Audit — evidence-only measurements</div>
    <div class="audit-report" style="margin-top:8px">${renderMd(verdict)}</div>
  </div>`;
}

function wireAuditRetry(container, handle) {
  const button = $("#audit-retry-missing", container);
  button?.addEventListener("click", () => {
    const keys = String(button.dataset.retryKeys || "").split(",").filter(Boolean);
    if (keys.length) runAudit(handle, keys);
  });
}

function renderMd(s) {
  const esc = escapeHtml(String(s || ""));
  return esc
    .replace(/^#{3}\s?(.*)$/gm, "<h3>$1</h3>")
    .replace(/^#{2}\s?(.*)$/gm, "<h3>$1</h3>")
    .replace(/^#\s?(.*)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br />");
}

// minimal table styles injected once
const styleTag = document.createElement("style");
styleTag.textContent = `
.tbl{width:100%;border-collapse:collapse;font-size:12px}
.tbl th,.tbl td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--border-soft)}
.tbl th{color:var(--text-dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.08em}
.tbl tr:last-child td{border-bottom:none}
.audit-upload-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:14px}
.audit-upload{display:block;min-width:0;color:var(--text);text-decoration:none;font-size:12px;line-height:1.4}
.audit-upload img,.audit-upload-placeholder{display:flex;width:100%;aspect-ratio:16/9;object-fit:cover;align-items:center;justify-content:center;border-radius:9px;background:var(--surface-2);margin-bottom:7px}
.audit-upload.is-shorts img{aspect-ratio:9/16}
.audit-upload-grid.is-shorts{grid-template-columns:repeat(auto-fill,minmax(110px,150px))}
.audit-upload-grid.is-shorts .audit-upload img,.audit-upload-grid.is-shorts .audit-upload-placeholder{aspect-ratio:9/16}
.audit-upload span:last-child{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.audit-upload-placeholder{font-size:10px;letter-spacing:.1em;color:var(--text-dim)}
@media(max-width:620px){.audit-upload-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.audit-upload-grid.is-shorts{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;
document.head.appendChild(styleTag);

async function renderSavedList() {
  const list = byId("saved-list");
  let audits = [];
  try {
    audits = await storageList(AUDITS_KEY);
  } catch (error) {
    list.innerHTML = '<li class="empty">Saved audits could not be loaded from Anna storage: '
      + escapeHtml(String(error.message || error)) + '</li>';
    setStatus("Anna storage unavailable", false, true);
    return;
  }
  savedAudits = audits;
  if (!audits.length) {
    list.innerHTML = '<li class="empty">No saved audits yet — run one above.</li>';
    return;
  }
  list.innerHTML = audits.map((a, i) => `
    <li class="saved-item">
      <div class="d">${new Date(a.ts).toLocaleString()} — ${escapeHtml(a.handle || "?")}</div>
      <button class="btn btn-ghost btn-small" data-open="${i}">Open</button>
    </li>`).join("");
  $$("[data-open]", list).forEach((b) => b.addEventListener("click", () => {
    const a = audits[Number(b.dataset.open)];
    if (a) {
      byId("audit-raw-pre").textContent = JSON.stringify({ evidence: a.evidence, verdict: a.verdict }, null, 2);
      byId("audit-raw").classList.remove("hidden");
      byId("audit-result").innerHTML = renderAuditCards(a.handle, a.evidence, a.verdict);
      wireAuditRetry(byId("audit-result"), a.handle);
      byId("audit-result").classList.remove("hidden");
      setStatus("Loaded saved audit", true);
    }
  }));
}

/* ---------- channel explorer ---------- */
function wireExplorer() {
  $$(".explorer-actions [data-explore]").forEach((button) => {
    button.addEventListener("click", () => runExplorer(button.dataset.explore));
  });
}

async function runExplorer(kind) {
  const handle = byId("audit-handle").value.trim();
  const output = byId("audit-explorer-result");
  const buttons = $$(".explorer-actions [data-explore]");
  if (!handle) {
    output.textContent = "Enter a channel handle above before browsing its public surfaces.";
    return;
  }

  const requests = {
    uploads: {
      label: "First 15 public video uploads",
      method: "channel",
      args: { handle, limit: 15, tab: "videos" },
      timeout: 145000
    },
    shorts: {
      label: "First 15 public Shorts",
      method: "channel",
      args: { handle, limit: 15, tab: "shorts" },
      timeout: 145000
    },
    posts: {
      label: "Community posts",
      method: "posts",
      args: { handle, limit: 15 },
      timeout: 85000
    },
    home: {
      label: "Channel home shelves",
      method: "home",
      args: { handle, limit: 8, verbose: true },
      timeout: 85000
    },
    shows: {
      label: "Channel Shows",
      method: "shows",
      args: { handle, limit: 15 },
      timeout: 85000
    }
  };
  const request = requests[kind];
  if (!request) return;

  buttons.forEach((button) => (button.disabled = true));
  output.innerHTML = '<div class="skeleton-stack"><span class="skeleton skeleton-wide"></span><span class="skeleton"></span><span class="skeleton skeleton-short"></span></div>';
  try {
    const data = await tool(request.method, request.args, request.timeout, {
      onProgress: (event) => {
        const phase = event && typeof event.type === "string" ? event.type : "working";
        const detail = event && event.data && typeof event.data === "object"
          ? event.data.message || event.data.stage || event.data.phase
          : event && event.data;
        output.innerHTML = '<div class="loading-line"><span class="spinner"></span>' + escapeHtml(request.label) + ' · '
          + escapeHtml(String(detail || phase)) + '…</div>';
      }
    });
    if (kind === "home") {
      try {
        const profile = await tool("profile", { handle }, 45000);
        if (profile && profile.success !== false) data.profile = profile.data || profile;
      } catch (_) { /* Public shelves still render if profile metadata is unavailable. */ }
    }
    output.innerHTML = renderExplorer(request.label, kind, handle, data);
  } catch (error) {
    output.innerHTML = '<p class="hint">Channel research failed: '
      + escapeHtml(String(error.message || error)) + '</p>';
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

function listFrom(data, keys = []) {
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data && data[key])) return data[key];
  return [];
}

function explorerThumb(item) {
  const videoId = item && String(item.id || item.video_id || "");
  const src = item && (item.thumbnail || item.thumbnail_url || item.thumb || item.image) || (/^[\w-]{11}$/.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "");
  return src ? `<img class="yt-thumb" loading="lazy" src="${escapeHtml(src)}" alt="Video thumbnail" onerror="this.closest('.yt-thumb-link')?.remove()" />` : '<div class="yt-thumb yt-thumb-empty">▶</div>';
}

function explorerLink(item) {
  const url = item && (item.url || item.video_url || item.channel_url || item.link);
  return url ? `<a class="yt-open" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open on YouTube ↗</a>` : '';
}

function renderVideoCards(items, label, surface = "uploads") {
  if (!items.length) return `<div class="empty-state"><strong>No ${escapeHtml(label.toLowerCase())} returned.</strong><span>YouTube did not expose any public items for this surface.</span></div>`;
  const shorts = surface === "shorts";
  const visibleItems = items.slice(0, 15);
  return `<div class="yt-feed ${shorts ? "is-shorts" : "is-videos"}" aria-label="First ${visibleItems.length} ${shorts ? "public Shorts" : "public video uploads"}">${visibleItems.map((item) => `<article class="yt-video-card">
    <a class="yt-thumb-link" href="${escapeHtml(item.thumbnail || item.thumbnail_url || item.thumb || item.image || (/^[\w-]{11}$/.test(String(item.id || item.video_id || "")) ? `https://i.ytimg.com/vi/${item.id || item.video_id}/hqdefault.jpg` : "#"))}" target="_blank" rel="noopener" aria-label="Open thumbnail image">${explorerThumb(item)}</a><div class="yt-video-body"><div class="yt-card-kicker">${escapeHtml(item.published || item.uploaded || item.date || 'PUBLIC VIDEO')}</div>
    <h3>${escapeHtml(String(item.title || item.name || item.id || 'Untitled video'))}</h3>
    <div class="yt-meta"><span>${fmtViews(item.views ?? item.view_count)} views</span><span>${fmtLen(item.duration ?? item.duration_seconds)}</span><span>${escapeHtml(String(item.channel || ''))}</span></div>${explorerLink(item)}</div></article>`).join('')}</div>`;
}

function renderPosts(items, label) {
  if (!items.length) return `<div class="empty-state"><strong>No community posts returned.</strong><span>This channel may not expose public posts right now.</span></div>`;
  return `<div class="yt-post-feed">${items.slice(0, 15).map((item) => `<article class="yt-post-card"><div class="yt-post-head"><div class="post-avatar">${escapeHtml(String(item.author || 'C').slice(0, 1).toUpperCase())}</div><div><strong>${escapeHtml(item.author || 'Channel')}</strong><span>${escapeHtml(item.published || item.date || 'Public post')}</span></div></div><p>${escapeHtml(item.text || item.body || item.title || '')}</p><div class="yt-post-foot"><span>♡ ${escapeHtml(String(item.likes ?? item.like_count ?? 0))}</span>${explorerLink(item)}</div></article>`).join('')}</div>`;
}

function renderShelves(data) {
  const shelves = data && (data.shelves || data.sections || data.items || data);
  if (!shelves || typeof shelves !== 'object') return '<div class="empty-state"><strong>No home shelves returned.</strong><span>Try again later if YouTube rate-limited the public home page.</span></div>';
  const sections = Array.isArray(shelves) ? shelves : Object.entries(shelves).map(([title, items]) => ({ title, items }));
  const profile = data?.profile || profileState?.profile || {};
  const banner = profile.banner_url || profile.banner || profile.channel_banner;
  const hero = `<div class="yt-channel-hero">${banner ? `<img class="yt-channel-banner" src="${escapeHtml(banner)}" alt="Channel banner" loading="lazy" onerror="this.remove()">` : ''}<div class="yt-channel-identity">${profileAvatar(profile) ? `<img src="${escapeHtml(profileAvatar(profile))}" alt="" loading="lazy">` : '<span class="yt-channel-avatar">▶</span>'}<div><strong>${escapeHtml(String(profile.name || profile.title || profileName(profileState?.profile || {})))}</strong><span>${escapeHtml(String(profile.handle || profileState?.handle || 'Public YouTube channel'))}${profile.subscribers ? ` · ${escapeHtml(String(profile.subscribers))} subscribers` : ''}</span><p>${escapeHtml(String(profile.description || '').slice(0, 260))}</p></div></div></div>`;
  const blocks = sections.filter((section) => Array.isArray(section.items) && section.items.length).map((section) => {
    const items = section.items;
    const name = section.title || section.type || 'Videos';
    const featured = /featured video/i.test(String(name));
    const visibleItems = items.slice(0, 15);
    const count = Number(section.count) || items.length;
    return `<section class="yt-shelf${featured ? ' is-featured-video' : ''}"><div class="shelf-head"><div><h3>${escapeHtml(String(name))}</h3><span class="shelf-kind">${escapeHtml(String(section.type || 'CHANNEL SECTION'))}</span></div><span>First ${visibleItems.length} of ${count} public items</span></div><div class="shelf-row">${visibleItems.map((item) => {
      const kind = String(item.kind || section.type || 'video');
      const videoId = String(item.id || item.video_id || '');
      const cardItem = { ...item, thumbnail: item.thumbnail || (/^[\w-]{11}$/.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '') };
      const visual = kind.toLowerCase() === 'post'
        ? `<div class="shelf-post-preview">${escapeHtml(String(item.title || '').slice(0, 190))}</div>`
        : kind.toLowerCase() === 'channel'
          ? `<div class="shelf-channel-preview">${item.thumbnail ? `<img src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy">` : `<span>${escapeHtml(String(item.title || 'C').slice(0, 1).toUpperCase())}</span>`}<strong>${escapeHtml(String(item.title || 'Channel'))}</strong></div>`
          : `<a class="shelf-thumb-link" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener">${explorerThumb(cardItem)}</a>`;
      const k = kind.toLowerCase();
      return `<article class="shelf-item ${k === 'short' || k === 'shorts' ? 'is-short' : 'is-landscape'} ${k === 'playlist' ? 'is-playlist' : ''} ${k === 'post' ? 'is-post' : ''}">${visual}<span class="shelf-item-kind">${escapeHtml(kind)}</span>${k === 'post' ? '' : `<strong>${escapeHtml(String(item.title || item.name || item.id || 'Untitled'))}</strong>`}${explorerLink(item)}</article>`;
    }).join('')}</div></section>`;
  });
  return (banner || profile.name || profile.avatar_url ? hero : '') + (blocks.length ? blocks.join('') : '<div class="empty-state"><strong>No populated shelves returned.</strong><span>The channel may have a minimal public home layout.</span></div>');
}

function renderShows(data) {
  const items = listFrom(data, ['shows', 'items', 'playlists']);
  if (!items.length) return '<div class="empty-state"><strong>No public Shows or playlists returned.</strong><span>YouTube may not expose public collections for this channel.</span></div>';
  return `<div class="yt-show-grid">${items.slice(0, 15).map((item) => `<article class="yt-show-card">${item.thumbnail ? `<img class="show-thumbnail" src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy">` : '<div class="show-art">▤</div>'}<div><div class="yt-card-kicker">${escapeHtml(String(item.kind || 'SHOW / PLAYLIST'))}</div><h3>${escapeHtml(String(item.title || item.name || item.id || 'Untitled show'))}</h3><p>${escapeHtml(String(item.description || item.count || 'Public episode collection'))}</p>${explorerLink(item)}</div></article>`).join('')}</div>`;
}

function renderExplorer(label, kind, handle, data) {
  const items = listFrom(data, ['items', 'videos', 'uploads', 'shorts']);
  const body = kind === 'posts' ? renderPosts(items, label) : kind === 'home' ? renderShelves(data) : kind === 'shows' ? renderShows(data) : renderVideoCards(items, label, kind);
  return `<div class="explorer-report"><div class="explorer-report-head"><div><div class="lab-sec">${escapeHtml(label)} <span class="ev ev-measured">MEASURED</span></div><p class="hint">${escapeHtml(handle)} · public YouTube surface · results are capped at 15 to keep research responsive</p></div><span class="source-badge">SOURCE LINKED</span></div>${body}</div>`;
}

/* ---------- content studio ---------- */
// Formula classification and hook scoring are owned by the original Skillbox Python engine.
const TASK_PROMPTS = {
  hooks: "Generate exactly 21 distinct opening-hook options for the supplied idea. Return ONLY a valid JSON array of objects with keys hook, formula and rationale. Use the 21 Skillbox formula families where appropriate: The Statistic, Someone Else's Result, The Mistake, Contrarian Flip, The Reveal, The Superlative, The Clock, I Tried It, The Question, Before and After, The Teardown, The Stack, The Warning, The List, The Receipt, The Insider, The Impossible Claim, The Comparison, The Origin, The Deadline, The Direct Address. Each hook must be speakable, confirm the video's actual promise, open a genuine curiosity gap and avoid unsupported numbers, personal claims or fake evidence. Do not reuse examples verbatim. The app scores the copy with the deterministic Skillbox hookscore engine; do not invent scores.",
  script_hooks: "Generate exactly 5 distinct opening-hook candidates for the video idea. Return ONLY a valid JSON array of objects with keys hook, formula and rationale. Use different fits from the 21 Skillbox formula families. Follow the video's actual title promise, create a genuine curiosity gap and show that the payoff exists. Never invent a personal result, source, statistic or experience. The app will score all five with the original Skillbox hookscore engine; do not add scores.",
  script: "Write the full spoken script using the two top-ranked hook candidates supplied in the request. If a current title/click promise was supplied, the first 15 seconds must confirm that exact promise, open a question the viewer cannot close, and prove the payoff exists. If no title was supplied, establish one clear promise in the hook without pretending it is an existing title. The 0:15–0:45 turn explains what the video will do and starts doing it—no channel intro, 'before we get started' or subscribe pitch. Body: one idea per beat and add [ON SCREEN: ...] to every beat. Explicitly deliver the promised payoff. Close with one ask, not three. Estimate runtime at 150 spoken words per minute. Never invent facts, numbers, sources or personal experience; mark unsupported factual claims [SOURCE NEEDED]. If no creator voice sample was supplied, state that voice fit is not calibrated and use a natural, clear spoken voice.",
  titles: "Write exactly 5 distinct YouTube title options. Return ONLY a valid JSON array of strings. Keep each title under 100 characters, front-load the topic, avoid unsupported claims and do not overpromise. The app runs the deterministic Skillbox title linter; do not invent scores or CTR predictions.",
  seo: "Write a search-facing YouTube package using only supplied keyword research. Start with a description whose first two lines state the video promise in the target query's language, then add any supplied link/resource, chapters only when real timecodes exist, and a concise longer description. Provide 8–12 relevant tags (never more than 15); use tags for disambiguation, spelling variants and real topic terms, not unrelated reach bait. If no keyword research was supplied, say the query still needs measuring. Do not invent search volume, sources, results or ranking claims.",
  chapters: "Write YouTube chapters only from the timestamped transcript or timecoded outline supplied. The first entry must be 00:00; provide at least three chapters; every chapter must be at least 10 seconds apart. Give each chapter a clear three-to-five-word promise in natural creator voice, not a transcript topic dump. Never invent or interpolate timestamps. If there are not enough source timestamps for valid chapters, explain what is missing and ask for a timecoded transcript.",
  shorts: "Find up to 3 self-contained Shorts from the timestamped transcript. A candidate should run 20–55 seconds, open on a complete thought, contain a turn (claim then complication or proof), and end on a line rather than trail off. For each candidate provide source start/end timecodes, the original first line, a NEW context-free hook, on-screen text for the first two seconds (different wording from the spoken line), a loop point, vertical-crop framing note, and why it survives without the long video. If source timestamps are absent, do not invent them.",
  edit: "Create an edit decision list from the timestamped transcript. Identify candidate pauses from gaps between adjacent caption cues, filler phrases and repeated/restarted sentences. Cite the exact cue timecodes and source words for every recommendation. Caption gaps are candidate pauses, not proof of silence; label them for footage review. Do not claim to have inspected media or apply edits. If timestamps are missing, do not invent them.",
  comments: "Triage the supplied YouTube comments into four piles: QUESTIONS, CORRECTIONS, PRAISE and BAIT. State the count in each pile before drafting. Answer the actual question first; acknowledge praise briefly and specifically; check corrections against supplied evidence and mark unverified claims for creator review; do not reply to bait. Keep each drafted reply under 30 words, use no emoji unless the creator's supplied voice notes use them, and never promise a future video. Recommend ONE comment to pin and explain why. Drafts only; do not claim anything was posted or hearted.",
  plan: "Plan one realistic week, sized to the creator's real capacity. Before building the calendar, require two inputs: available hours this week and what content is already half-made. If either is missing, ask for it instead of inventing a schedule. When supplied, plan one anchor video, one low-effort post built from existing material, and up to three Shorts cut from the anchor—not seven uploads in seven days. Use the channel's own best day only if measured analytics were supplied; otherwise leave the day flexible. Return a table with day, format, working title, one-sentence promise, existing assets and estimated hours; state total hours and what to drop first if the week goes wrong.",
  thumbnail: "Create three distinct title/thumbnail pairing briefs for the supplied video. For each, specify the subject/expression, framing, foreground/background contrast, no more than three words of thumbnail text, and what the title should communicate that the thumbnail does not. Do not invent thumbnail text as though the creator already supplied it. These are untested creative hypotheses; thumbnail image pixels have not been evaluated and no CTR or performance prediction is allowed.",
  full: "Produce a practical creator pack: a concise script outline with a strong opening, title options, description and tags, chapters only when timestamps are supported by a transcript, and Shorts angles only when source content and timestamps are supplied. Separate measured facts, inference and creative hypotheses. No fake performance scores or CTR predictions."
};




function formatCueTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours
    ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0")
    : String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
}

function parseJsonArray(raw) {
  const text = String(raw || "").trim();
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : null;
  } catch (_) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    try {
      const value = JSON.parse(text.slice(start, end + 1));
      return Array.isArray(value) ? value : null;
    } catch (_) { return null; }
  }
}

function renderHookScores(result, generated) {
  const rows = (result && result.scored_hooks) || [];
  if (!rows.length) return "No hook scores were returned by the Skillbox engine.";
  const sourceByText = new Map((generated || []).map((item) => [
    typeof item === "string" ? item : String(item.hook || ""),
    item
  ]));
  const output = [
    "SKILLBOX HOOK SCORECARD",
    "Heuristic copy analysis only — not a retention, CTR or performance prediction.",
    String(rows.length) + " hooks scored.",
    ""
  ];
  rows.forEach((row, index) => {
    const source = sourceByText.get(row.hook) || {};
    const formula = row.formula ? " · " + row.formula : "";
    const properties = Object.entries(row.properties || {}).map(([key, value]) => key + " " + value).join(" · ");
    output.push(
      String(index + 1).padStart(2, "0") + "  " + row.score + "/100 · " + row.band + formula,
      "   " + row.hook,
      "   " + properties,
      "   Weakest: " + (row.weakest || "—") + " — " + (row.fix || "Review manually."),
      source.rationale ? "   Angle: " + source.rationale : ""
    );
  });
  return output.filter(Boolean).join("\n");
}

function renderTitleLint(result) {
  const rows = (result && result.titles) || [];
  if (!rows.length) return "No title lint results were returned by the Skillbox engine.";
  const output = [
    "SKILLBOX TITLE LINT",
    "Heuristic title-text checks — not CTR, ranking or view predictions.",
    ""
  ];
  rows.forEach((row, index) => {
    output.push(
      String(index + 1).padStart(2, "0") + "  " + row.heuristic_score + "/100 · " + row.characters + " characters",
      "   " + row.title
    );
    (row.issues || []).forEach((item) => output.push("   FIX · " + item.code + ": " + item.detail));
    (row.good || []).forEach((item) => output.push("   PASS · " + item));
    output.push("");
  });
  return output.join("\n");
}

function renderStudioOutput(output, task, raw) {
  const value = String(raw || "").trim();
  if (!value) return;
  output.dataset.copyText = value;
  const inline = (text) => escapeHtml(String(text ?? ""))
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
  const textBody = (text) => "<p>" + inline(text).replace(/\n/g, "<br>") + "</p>";
  const card = (eyebrow, title, body) =>
    '<article class="studio-result-card">' +
    (eyebrow ? '<div class="studio-result-eyebrow">' + inline(eyebrow) + '</div>' : '') +
    (title ? '<h3>' + inline(title) + '</h3>' : '') +
    '<div class="studio-result-body">' + body + '</div></article>';

  let parsed = null;
  try { parsed = JSON.parse(value); } catch (_) {}
  if (Array.isArray(parsed)) {
    const cards = parsed.map((item, index) => {
      if (typeof item === "string") return card("OPTION " + String(index + 1).padStart(2, "0"), "", textBody(item));
      const titleKey = ["hook", "title", "name", "keyword", "heading"].find(key => item && item[key] != null);
      const title = titleKey ? item[titleKey] : "Option " + (index + 1);
      const details = Object.entries(item || {}).filter(([key]) => key !== titleKey).map(([key, val]) =>
        '<div class="studio-result-detail"><span>' + inline(key.replace(/_/g, " ")) + '</span><strong>' +
        inline(Array.isArray(val) ? val.join(", ") : typeof val === "object" ? JSON.stringify(val) : val) +
        '</strong></div>').join("");
      return card("OPTION " + String(index + 1).padStart(2, "0"), title, details || textBody(title));
    }).join("");
    output.innerHTML = '<div class="studio-result-grid">' + cards + '</div>';
    return;
  }
  if (parsed && typeof parsed === "object") {
    const cards = Object.entries(parsed).map(([key, val]) => {
      const body = Array.isArray(val)
        ? '<ul>' + val.map(item => '<li>' + inline(typeof item === "object" ? JSON.stringify(item) : item) + '</li>').join("") + '</ul>'
        : typeof val === "object" && val !== null
          ? Object.entries(val).map(([k, v]) => '<div class="studio-result-detail"><span>' + inline(k.replace(/_/g, " ")) + '</span><strong>' + inline(typeof v === "object" ? JSON.stringify(v) : v) + '</strong></div>').join("")
          : textBody(val);
      return card(key.replace(/[_-]/g, " "), "", body);
    }).join("");
    output.innerHTML = '<div class="studio-result-grid">' + cards + '</div>';
    return;
  }

  if (/SKILLBOX HOOK SCORECARD|SKILLBOX TITLE LINT/.test(value)) {
    const lines = value.split(/\r?\n/), titleMode = value.includes("SKILLBOX TITLE LINT"), cards = [];
    let consumedUntil = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(/^\d+\s+(.+?)(?:\s+·\s+(\d+)\s+characters)?$/);
      if (match && (/\d+\/100/.test(line) || titleMode && /characters/.test(line))) {
        const title = (lines[i + 1] || "").trim(), details = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim() && !/^\d+\s+.+(?:\/100|characters)/.test(lines[j].trim())) details.push(lines[j++].trim());
        cards.push(card(match[1], title, details.map(line => textBody(line)).join("")));
        consumedUntil = j;
        i = j - 1;
      }
    }
    if (cards.length) {
      const remainder = lines.slice(consumedUntil).filter(line => line.trim() && !/^SKILLBOX HOOK SCORECARD|^SKILLBOX TITLE LINT|^Heuristic copy analysis|^Heuristic title-text checks|^\d+ hooks scored/.test(line.trim()));
      if (remainder.length) cards.push(card("FULL SCRIPT DRAFT", "", remainder.map(textBody).join("")));
      output.innerHTML = '<div class="studio-result-grid">' + cards.join("") + '</div>';
      return;
    }
  }

  const sections = [];
  let current = { title: "", lines: [] };
  const flush = () => { if (current.title || current.lines.length) sections.push(current); };
  for (const line of value.split(/\r?\n/)) {
    const heading = line.match(/^\s*(?:#{1,3}\s+|(?:\d+[.)]\s+))(.+?)\s*$/);
    if (heading) { flush(); current = { title: heading[1], lines: [] }; }
    else if (!line.trim()) { flush(); current = { title: "", lines: [] }; }
    else current.lines.push(line);
  }
  flush();
  const cards = sections.map((section, index) => {
    const title = section.title || (sections.length === 1 ? "Draft" : "Section " + (index + 1));
    const isList = section.lines.length && section.lines.every(line => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line));
    const body = isList
      ? '<ul>' + section.lines.map(line => '<li>' + inline(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")) + '</li>').join("") + '</ul>'
      : section.lines.map(textBody).join("");
    return card(section.title ? "CONTENT" : task.replace(/_/g, " "), title, body);
  }).join("");
  output.innerHTML = '<div class="studio-result-grid">' + (cards || card("DRAFT", "", textBody(value))) + '</div>';
}

function wireStudio() {
  $$(".studio-actions [data-task]").forEach((button) => {
    button.addEventListener("click", async () => {
      const topic = byId("studio-topic").value.trim();
      const keyword = byId("studio-keyword").value.trim();
      const workingTitle = byId("studio-title").value.trim();
      const thumbnailText = byId("studio-thumb").value.trim();
      const context = byId("studio-context").value.trim();
      const video = byId("lab-video").value.trim();
      const output = byId("studio-pre");
      const label = byId("studio-task-label");
      const task = button.dataset.task;

      if (task === "transcript" && !video) {
        output.textContent = "Add a video URL or ID in the Keyword Lab video field first.";
        return;
      }
      if (!["transcript", "comments", "plan"].includes(task) && !topic) {
        output.textContent = "Add a video idea first. A rough sentence is enough.";
        return;
      }
      if (["comments", "edit"].includes(task) && !context) {
        output.textContent = task === "comments"
          ? "Paste the comment thread into Context first."
          : "Fetch a transcript or paste one into Context before building an edit decision list.";
        return;
      }
      if (task === "plan" && !topic && !context) {
        output.textContent = "Add a channel direction or recent research in Context before planning.";
        return;
      }

      $$(".studio-actions [data-task]").forEach((item) => (item.disabled = true));
      label.textContent = "WORKING · " + button.textContent.trim();
      output.textContent = task === "transcript" ? "Fetching available captions…" : "Drafting…";
      try {
        if (task === "transcript") {
          const transcriptResult = await tool("transcribe", {
            video,
            language: byId("transcript-language").value || "auto"
          }, 85000);
          if (!transcriptResult || !transcriptResult.transcript) {
            throw new Error("No usable transcript text was returned for this video.");
          }
          const transcriptText = String(transcriptResult.transcript).trim();
          const segments = Array.isArray(transcriptResult.segments) ? transcriptResult.segments : [];
          const timestamped = segments.length
            ? segments.map((segment) => "[" + formatCueTime(segment.start) + "] " + segment.text).join("\n")
            : transcriptText;
          byId("studio-context").value = timestamped;
          output.textContent = "TRANSCRIPT FETCHED · " + (transcriptResult.title || video) + "\n"
            + "Channel: " + (transcriptResult.channel || "Not returned") + "\n"
            + "Language: " + (transcriptResult.language || "Not returned") + "\n"
            + "Caption cues: " + (transcriptResult.segment_count ?? segments.length) + "\n"
            + (segments.length
              ? "Real caption timecodes were preserved in the Context field."
              : "This track returned text without parseable cue timecodes; timestamp-dependent tasks must not invent them.") + "\n\n"
            + timestamped;
          label.textContent = "TRANSCRIPT · READY FOR CREATION";
          return;
        }

        const contextLimit = ["chapters", "shorts", "edit", "script", "full"].includes(task) ? 20000 : 8000;
        const userMessage = "Topic: " + topic + "\n"
          + (profileState ? "Creator channel context: " + JSON.stringify(profileState.profile).slice(0, 6000) + "\n" : "")
          + (keyword ? "Target keyword: " + keyword + "\n" : "")
          + (workingTitle ? "Current title / click promise: " + workingTitle + "\n" : "")
          + (thumbnailText ? "Existing thumbnail text: " + thumbnailText + "\n" : "")
          + (context ? "Context and source notes:\n" + context.slice(0, contextLimit) + "\n" : "")
          + "\nCreate the requested asset now.";

        if (task === "script") {
          const hookResponse = await llm(TASK_PROMPTS.script_hooks, userMessage, 2200);
          const generatedHooks = parseJsonArray(hookResponse);
          const hookRows = (generatedHooks || []).map((item) => typeof item === "string" ? item : item && item.hook)
            .filter((item) => typeof item === "string" && item.trim());
          if (hookRows.length !== 5) {
            output.textContent = "SCRIPT NOT GENERATED · INCOMPLETE HOOK SET\nThe original Skillbox script workflow requires five hook candidates before scoring. Received "
              + hookRows.length + ".\n\nGenerated response:\n" + hookResponse;
            label.textContent = "SCRIPT STOPPED · " + hookRows.length + "/5 HOOKS";
            return;
          }
          const scoredHooks = await tool("hookscore", { hooks: hookRows });
          const topTwo = (scoredHooks.scored_hooks || []).slice(0, 2);
          if (topTwo.length !== 2) {
            throw new Error("Skillbox hookscore did not return two ranked candidates; the script was not drafted.");
          }
          const selected = topTwo.map((row, index) => (
            (index + 1) + ". " + row.hook + " | " + row.verdict + "/100 | " + row.formula
              + " | weakest: " + row.weakest + " — " + row.fix
          )).join("\n");
          const script = await llm(
            TASK_PROMPTS.script,
            userMessage + "\n\nTop two of five hooks, ranked by Skillbox's heuristic copy score (not a performance prediction):\n" + selected,
            4600
          );
          output.textContent = renderHookScores({ count: 2, scored_hooks: topTwo }, generatedHooks)
            + "\n\nFULL SCRIPT DRAFT\nVoice note: use the supplied style notes only; no creator voice sample was inferred.\n\n"
            + script;
          label.textContent = "SCRIPT · TOP 2 OF 5 HOOKS SCORED";
          return;
        }

        const maxTokens = task === "hooks" || task === "full" ? 4600 : 3000;
        const generated = await llm(TASK_PROMPTS[task] || TASK_PROMPTS.full, userMessage, maxTokens);
        if (task === "hooks") {
          const parsed = parseJsonArray(generated);
          const hooks = (parsed || []).map((item) => typeof item === "string" ? item : item && item.hook)
            .filter((item) => typeof item === "string" && item.trim());
          if (hooks.length !== 21) {
            output.textContent = "INCOMPLETE HOOK SET · SCORING NOT RUN\nExpected exactly 21 distinct hook options; received "
              + hooks.length + ". No partial set is presented as the promised 21.\n\nGenerated response:\n" + generated;
            label.textContent = "HOOK SET INCOMPLETE · " + hooks.length + "/21";
            return;
          }
          try {
            const scored = await tool("hookscore", { hooks });
            output.textContent = renderHookScores(scored, parsed);
            label.textContent = "HOOKS · " + (scored.count || hooks.length) + " SCORED";
          } catch (scoreError) {
            output.textContent = "HOOKS GENERATED · SCORING UNAVAILABLE\n" + (scoreError.message || scoreError) + "\n\nGenerated response:\n" + generated;
            label.textContent = "HOOKS GENERATED · SCORING FAILED";
          }
        } else if (task === "titles") {
          const parsed = parseJsonArray(generated);
          const titles = (parsed || []).map((item) => typeof item === "string" ? item : item && item.title)
            .filter((item) => typeof item === "string" && item.trim());
          if (titles.length !== 5) {
            output.textContent = "INCOMPLETE TITLE SET · LINT NOT RUN\nExpected exactly 5 title options; received "
              + titles.length + ". No partial set is presented as the promised five.\n\nGenerated response:\n" + generated;
            label.textContent = "TITLE SET INCOMPLETE · " + titles.length + "/5";
            return;
          }
          try {
            const linted = await tool("title_lint", {
              titles,
              thumbnail_text: thumbnailText || undefined
            });
            output.textContent = renderTitleLint(linted);
            label.textContent = "TITLES · " + (linted.count || titles.length) + " LINTED";
          } catch (lintError) {
            output.textContent = "TITLES GENERATED · LINT UNAVAILABLE\n" + (lintError.message || lintError) + "\n\nGenerated response:\n" + generated;
            label.textContent = "TITLES GENERATED · LINT FAILED";
          }
        } else {
          output.textContent = generated;
          label.textContent = button.textContent.trim();
        }
      } catch (error) {
        output.textContent = "Error: " + (error.message || error);
        label.textContent = "FAILED";
      } finally {
        if (output.textContent.trim()) renderStudioOutput(output, task, output.textContent);
        $(".studio-actions [data-task]").forEach((item) => (item.disabled = false));
      }
    });
  });
  byId("studio-copy").addEventListener("click", () => navigator.clipboard.writeText(byId("studio-pre").dataset.copyText || byId("studio-pre").textContent).catch(() => {}));
}

/* ---------- keyword lab (Feature 1 — live research, no API key) ---------- */
const LAB_SYSTEM = `
You are the YouTube Skillbox research analyst. You receive MEASURED tool output (keyword opportunity scores, competition signals, SERP rows, content-gap lists, SEO checks) — never invent numbers.
Rules:
- Quote measured numbers exactly as given. Reasoning about them = INFERRED. What to do next = RECOMMENDATION.
- If a tool errored or returned empty, say exactly that — no substitute numbers.
- Structure: MEASURED (bullet facts from the evidence) → INFERRED (what it means for this seed) → RECOMMENDATION (one concrete next move, GO/MAYBE/SKIP if a verdict is present).
Plain language, tight, no filler.`;

function labSeed() {
  return byId("lab-seed").value.trim()
    || byId("studio-keyword").value.trim()
    || byId("studio-topic").value.trim();
}

function fmtViews(n) {
  const x = Number(n);
  if (!isFinite(x) || n === null || n === undefined) return "—";
  if (x >= 1e9) return (x / 1e9).toFixed(1) + "B";
  if (x >= 1e6) return (x / 1e6).toFixed(1) + "M";
  if (x >= 1e3) return (x / 1e3).toFixed(1) + "K";
  return String(Math.round(x));
}

function fmtLen(s) {
  if (s === null || s === undefined || s === "") return "—";
  const x = Math.round(Number(s));
  if (!isFinite(x)) return String(s); // already formatted (e.g. "8:02")
  if (x <= 0) return "—";
  const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), sec = x % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

function labTable(head, rows) {
  return `<table class="tbl"><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSearchLab(d) {
  const items = (d && (d.items || (Array.isArray(d) ? d : []))) || [];
  if (!items.length) return `<p class="hint">No results — YouTube returned nothing for that query.</p>`;
  const rows = items.slice(0, 10).map((v) => {
    const url = v.url || `https://www.youtube.com/watch?v=${v.id || ""}`;
    return `<tr><td><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(String(v.title || v.id || "?").slice(0, 80))}</a></td><td>${escapeHtml(String(v.channel || ""))}</td><td>${fmtViews(v.views ?? v.view_count)}</td><td>${fmtLen(v.duration ?? v.duration_string)}</td></tr>`;
  }).join("");
  return `<div class="lab-sec">Live SERP for this seed <span class="ev ev-measured">MEASURED</span></div>` + labTable(["Title", "Channel", "Views", "Len"], rows);
}

function renderIdeasLab(d) {
  const kws = (d && (d.keywords || d.ideas || d.items)) || [];
  if (!kws.length) return `<p class="hint">No keyword ideas returned.</p>`;
  const rows = kws.slice(0, 15).map((k) => {
    const flags = [k.year_trend ? "YEAR TREND" : "", k.question ? "QUESTION" : ""].filter(Boolean);
    const annotation = flags.length ? ` <span class="hint">${escapeHtml(flags.join(" · "))}</span>` : "";
    const score = k.opportunity_score ?? k.score;
    const scoreLabel = score == null || !isFinite(Number(score)) ? "—" : String(Number(score));
    return `<tr><td>${escapeHtml(String(k.keyword || ""))}${annotation}</td><td>${scoreLabel}</td></tr>`;
  }).join("");
  const meta = d.seed ? `<div class="hint" style="margin:0 0 6px">seed “${escapeHtml(d.seed)}” · ${escapeHtml(String(d.unique ?? kws.length))} unique from ${escapeHtml(String(d.queries ?? "?"))} queries · YEAR TREND / QUESTION labels where returned</div>` : "";
  return `<div class="lab-sec">Keyword ideas (suggest + DDG demand) <span class="ev ev-measured">MEASURED</span></div>${meta}` + labTable(["Keyword", "Opportunity"], rows);
}

function renderCompeteLab(d) {
  if (!d || d.score === undefined) return `<p class="hint">No competition data returned.</p>`;
  const sig = (d.signals || []).map((s) => `<tr><td>${escapeHtml(String(s.name || ""))}</td><td>${escapeHtml(String(s.weight ?? ""))}</td><td>${escapeHtml(String(s.value ?? ""))}</td><td>${escapeHtml(String(s.detail || "").slice(0, 90))}</td></tr>`).join("");
  // engine emits advice as a list of lines; render as a list, not a comma-joined string
  const advice = Array.isArray(d.advice)
    ? (d.advice.length ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:12.5px">${d.advice.map((a) => `<li>${escapeHtml(String(a))}</li>`).join("")}</ul>` : "")
    : (d.advice ? `<p style="margin:8px 0 0;font-size:12.5px">${escapeHtml(String(d.advice))}</p>` : "");
  const meta = [d.median_views != null ? `median views ${fmtViews(d.median_views)}` : null,
    d.floor_views != null ? `floor ${fmtViews(d.floor_views)}` : null,
    d.verified != null ? `${escapeHtml(String(d.verified))} verified` : null].filter(Boolean).join(" · ");
  return `
  <div class="lab-sec">Competition for “${escapeHtml(String(d.keyword || ""))}” <span class="ev ev-measured">MEASURED</span></div>
  <div class="stat" style="margin-bottom:8px"><div class="n">${escapeHtml(String(d.score))}<span style="font-size:13px;color:var(--text-dim)">/100 · ${escapeHtml(String(d.band || ""))} · top ${escapeHtml(String(d.scored ?? "?"))} scored</span></div><div class="k">${meta || "difficulty"}</div></div>
  ${sig ? labTable(["Signal", "Weight", "Value", "Detail"], sig) : ""}
  ${advice}`;
}

function renderVerdictLab(d) {
  if (!d || !d.verdict) return `<p class="hint">No verdict returned.</p>`;
  const v = String(d.verdict).toUpperCase();
  const cls = v === "GO" ? "green" : v === "SKIP" ? "red" : "";
  return `
  <div class="lab-sec">GO / MAYBE / SKIP <span class="ev ev-inferred">INFERRED</span> <span class="hint" style="text-transform:none;letter-spacing:0">from measured opportunity + competition</span></div>
  <div class="stat"><div class="n ${cls}">${escapeHtml(v)}</div><div class="k">opportunity ${escapeHtml(String(d.opportunity))}/100 · competition ${escapeHtml(String(d.competition))}/100</div></div>
  <p class="hint" style="margin:8px 0 0">${escapeHtml(String(d.label || ""))}</p>`;
}

function renderGapLab(d) {
  if (!d) return `<p class="hint">No gap data returned.</p>`;
  const them = (d.only_them || []).slice(0, 25);
  const mine = (d.only_me || []).slice(0, 15);
  const both = (d.both || []).slice(0, 15);
  const kwRow = (k) => typeof k === "string"
    ? `<tr><td>${escapeHtml(k)}</td><td>—</td></tr>`
    : `<tr><td>${escapeHtml(String(k.keyword || ""))}</td><td>${k.score == null ? "—" : Number(k.score)}${k.year_trend ? " · YEAR TREND" : ""}${k.question ? " · QUESTION" : ""}</td></tr>`;
  return `
  <div class="lab-sec">Content gap — “${escapeHtml(String(d.seed || ""))}” vs ${escapeHtml(String(d.competitor || ""))} <span class="ev ev-measured">MEASURED</span></div>
  <div class="lab-sec">They cover, you don't (${them.length})</div>
  ${them.length ? them.map((s) => `<span class="lab-chip">${escapeHtml(String(s))}</span>`).join("") : `<p class="hint" style="margin:0">none — you already cover their tags.</p>`}
  <div class="lab-sec">Only you (${mine.length})</div>
  ${mine.length ? labTable(["Keyword", "Score"], mine.map(kwRow).join("")) : `<p class="hint" style="margin:0">none.</p>`}
  <div class="lab-sec">Shared (${both.length})</div>
  ${both.length ? labTable(["Keyword", "Score"], both.map(kwRow).join("")) : `<p class="hint" style="margin:0">none.</p>`}`;
}

function renderScorecardLab(d) {
  if (!d || d.score === undefined) return `<p class="hint">No scorecard returned.</p>`;
  const rows = (d.checks || []).map((c) => `<tr><td>${c.pass ? "PASS" : "FAIL"}</td><td>${escapeHtml(String(c.name || ""))}</td><td>${escapeHtml(String(c.weight ?? ""))}</td><td>${escapeHtml(String(c.detail || "").slice(0, 110))}</td></tr>`).join("");
  return `
  <div class="lab-sec">SEO scorecard — ${escapeHtml(String(d.video_id || ""))}${d.target_keyword ? ` · target “${escapeHtml(String(d.target_keyword))}”` : ""} <span class="ev ev-measured">MEASURED</span></div>
  <div class="stat" style="margin-bottom:8px"><div class="n">${escapeHtml(String(d.score))}<span style="font-size:13px;color:var(--text-dim)">/100</span></div><div class="k">seo score</div></div>
  ${labTable(["", "Check", "W", "Detail"], rows)}`;
}

/* Opportunity for verdict = mean of the top-5 measured keyword scores, clamped to 0-100.
 * The aggregation step is INFERRED; every input is MEASURED by the keywords tool. */
function renderJsonLab(title, data) {
  return '<div class="lab-sec">' + escapeHtml(title)
    + ' <span class="ev ev-measured">MEASURED</span></div><pre class="output-pre">'
    + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
}

function opportunityFrom(kw) {
  const rows = (kw && (kw.keywords || kw.ideas || kw.items)) || [];
  const top = rows.slice(0, 5)
    .map((row) => row && (row.opportunity_score ?? row.score))
    .filter((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)))
    .map(Number);
  if (!top.length) return null;
  return Math.max(0, Math.min(100, Math.round(top.reduce((a, b) => a + b, 0) / top.length)));
}

async function runLab(kind) {
  const out = byId("lab-result");
  const label = byId("lab-label");
  const seed = labSeed();
  const competitor = byId("lab-competitor").value.trim();
  const video = byId("lab-video").value.trim();
  const playlist = byId("lab-playlist").value.trim();
  const resolveLocale = (inputId, fallback) => {
    const input = byId(inputId);
    const raw = input ? input.value.trim() : "";
    const list = byId(inputId + "-options");
    const match = list && Array.from(list.options).find((option) =>
      option.value.toLocaleLowerCase() === raw.toLocaleLowerCase()
    );
    if (match && match.dataset.code) return match.dataset.code;
    // Allow advanced users to enter a region/language code directly.
    if (/^[a-z]{2}(?:-[a-z0-9]+)?$/i.test(raw)) return raw;
    return fallback;
  };
  const gl = resolveLocale("lab-region", "IN");
  const hl = resolveLocale("lab-language", "en");
  const T = kind === "outliers" ? 180000 : 85000;

  const need = (condition, message) => {
    if (condition) return true;
    out.innerHTML = '<p class="hint">' + escapeHtml(message) + '</p>';
    label.textContent = "MISSING INPUT";
    return false;
  };
  if (["search", "ideas", "compete", "verdict", "chain", "trends", "track"].includes(kind)
      && !need(seed, "Enter a research seed or video idea first.")) return;
  if (kind === "gap" && !need(seed && competitor, "Content gap needs a seed and competitor channel (for example, @channel).")) return;
  if (kind === "outliers" && !need(competitor, "Competitor outliers needs a channel handle in the Competitor field.")) return;
  if (["info", "scorecard"].includes(kind) && !need(video, "This task needs a video URL or 11-character video ID.")) return;
  if (kind === "playlist" && !need(playlist, "Playlist contents needs a YouTube playlist URL or ID.")) return;
  if (kind === "track" && !need(video, "Rank tracking needs the video URL or ID to track.")) return;

  $$(".lab-actions [data-lab]").forEach((button) => (button.disabled = true));
  out.innerHTML = '<p class="hint">Running ' + escapeHtml(kind) + ' research…</p>';
  const step = (message) => { label.textContent = message; };

  try {
    let html = "";
    if (kind === "search") {
      step("SEARCHING LIVE YOUTUBE RESULTS…");
      html = renderSearchLab(await tool("search", { query: seed, limit: 10, gl, hl }, T));
    } else if (kind === "ideas") {
      step("EXPANDING KEYWORD IDEAS…");
      html = renderIdeasLab(await tool("keywords", { seed, limit: 20, gl, hl }, T));
    } else if (kind === "compete") {
      step("SCORING COMPETITION…");
      html = renderCompeteLab(await tool("compete", { query: seed, gl, hl }, T));
    } else if (kind === "verdict") {
      step("MEASURING KEYWORD OPPORTUNITY…");
      const keywords = await tool("keywords", { seed, limit: 12, gl, hl }, T);
      const opportunity = opportunityFrom(keywords);
      if (opportunity === null) throw new Error("Keyword research returned no measurable opportunity scores; no verdict can be calculated.");
      step("MEASURING COMPETITION…");
      const competitionData = await tool("compete", { query: seed, gl, hl }, T);
      const competition = Number(competitionData && competitionData.score);
      if (!isFinite(competition)) throw new Error("Competition tool returned no difficulty score.");
      step("COMPUTING THE VERDICT…");
      html = renderVerdictLab(await tool("verdict", { opportunity, competition }, T));
    } else if (kind === "gap") {
      step("COMPARING CHANNEL KEYWORD SETS…");
      html = renderGapLab(await tool("gap", { seed, competitor }, T));
    } else if (kind === "outliers") {
      step("SCANNING COMPETITOR UPLOADS FOR OUTLIERS…");
      html = renderJsonLab("Competitor outliers · " + competitor, await tool("outliers", { handle: competitor, min_ratio: 2.0 }, T, {
        onProgress: (event) => {
          const phase = event && typeof event.type === "string" ? event.type : "working";
          const detail = event && event.data && typeof event.data === "object"
            ? event.data.message || event.data.stage || event.data.phase
            : event && event.data;
          step("SCANNING COMPETITOR UPLOADS · " + String(detail || phase).toUpperCase() + "…");
        }
      }));
    } else if (kind === "info") {
      step("FETCHING VIDEO METADATA…");
      html = renderJsonLab("Video metadata", await tool("info", { video }, T));
    } else if (kind === "playlist") {
      step("FETCHING PLAYLIST CONTENTS…");
      html = renderJsonLab("Playlist contents", await tool("playlist", { playlist, limit: 30 }, T));
    } else if (kind === "scorecard") {
      step("FETCHING VIDEO METADATA…");
      html = renderScorecardLab(await tool("scorecard", { video, keyword: seed }, T));
    } else if (kind === "track") {
      step("CHECKING VIDEO POSITION IN SEARCH…");
      html = renderJsonLab("Keyword rank tracking", await tool("track", { query: seed, video, gl, hl }, T));
    } else if (kind === "trends") {
      step("READING SAVED KEYWORD HISTORY…");
      html = renderJsonLab("Historical keyword trend", await tool("trends", { seed }, T));
    } else if (kind === "chain") {
      html = await runChain({ seed, competitor, video, gl, hl }, step, T);
    }
    out.innerHTML = html;
    label.textContent = kind === "chain" ? "RESEARCH CHAIN COMPLETE" : "DONE · " + kind.toUpperCase();
  } catch (error) {
    out.innerHTML = '<p class="hint">Research failed: ' + escapeHtml(String(error.message || error)) + '</p>';
    label.textContent = "RESEARCH FAILED";
  } finally {
    $$(".lab-actions [data-lab]").forEach((button) => (button.disabled = false));
  }
}

async function runChain({ seed, competitor, video, gl, hl }, step, T) {
  const evidence = {};
  const errors = {};
  const grab = async (key, message, callback) => {
    step(message);
    try { evidence[key] = await callback(); }
    catch (error) { evidence[key] = null; errors[key] = String(error.message || error); }
  };

  await grab("keywords", "1/5 · keyword opportunities…", () => tool("keywords", { seed, limit: 15, gl, hl }, T));
  const opportunity = opportunityFrom(evidence.keywords);
  await grab("compete", "2/5 · competition difficulty…", () => tool("compete", { query: seed, gl, hl }, T));
  const competition = evidence.compete && evidence.compete.score !== undefined && evidence.compete.score !== null
    ? Number(evidence.compete.score) : NaN;

  if (opportunity !== null && isFinite(competition)) {
    await grab("verdict", "3/5 · GO / MAYBE / SKIP…", () => tool("verdict", { opportunity, competition }, T));
  } else {
    errors.verdict = "skipped because measured opportunity or competition data was missing";
  }

  if (competitor) await grab("gap", "4/5 · content gap vs competitor…", () => tool("gap", { seed, competitor }, T));
  else step("4/5 · no competitor supplied — content gap skipped…");
  if (video) await grab("scorecard", "4/5 · SEO scorecard…", () => tool("scorecard", { video, keyword: seed }, T));
  await grab("search", "5/5 · live search results…", () => tool("search", { query: seed, limit: 6, gl, hl }, T));

  const parts = [];
  if (evidence.verdict) parts.push(renderVerdictLab(evidence.verdict));
  if (evidence.keywords) parts.push(renderIdeasLab(evidence.keywords));
  if (evidence.compete) parts.push(renderCompeteLab(evidence.compete));
  if (evidence.gap) parts.push(renderGapLab(evidence.gap));
  if (evidence.scorecard) parts.push(renderScorecardLab(evidence.scorecard));
  if (evidence.search) parts.push(renderSearchLab(evidence.search));

  step("SYNTHESIZING FROM MEASURED EVIDENCE…");
  const evidenceJson = JSON.stringify(evidence, null, 0).slice(0, 14000);
  let interpretation = "";
  try {
    interpretation = await llm(LAB_SYSTEM, "Seed: " + seed + "\nRegion: " + gl + "\nLanguage: " + hl + "\n"
      + (competitor ? "Competitor: " + competitor + "\n" : "")
      + (video ? "Video: " + video + "\n" : "")
      + "Evidence JSON:\n" + evidenceJson + "\n\nWrite the research read.", 2600);
  } catch (error) {
    interpretation = "Host LLM unavailable: " + (error.message || error) + ". Raw measured evidence is shown above.";
  }
  const errorNote = Object.keys(errors).length
    ? '<p class="hint" style="margin-top:8px">NOT MEASURED: '
      + escapeHtml(Object.entries(errors).map(([key, value]) => key + " (" + value + ")").join(" · ")) + '</p>'
    : "";
  return parts.join("") + errorNote + '<div class="card bigfix" style="margin-top:10px">'
    + '<div class="label">RESEARCH READ · HOST LLM OVER MEASURED EVIDENCE</div>'
    + '<div class="audit-report" style="margin-top:8px">' + renderMd(interpretation) + '</div></div>';
}

function wireLab() {
  $$(".lab-actions [data-lab]").forEach((b) => {
    b.addEventListener("click", () => runLab(b.dataset.lab));
  });
  byId("lab-copy").addEventListener("click", () => navigator.clipboard.writeText(byId("lab-result").innerText).catch(() => {}));
}

/* ---------- retention analyzer ---------- */
const RETENTION_SYSTEM = [
  "You are the YouTube Skillbox retention interpreter. The deterministic Skillbox engine has already parsed the CSV and calculated the findings.",
  "Do not recalculate, alter or add measurements. Quote only values present in the supplied JSON.",
  "Explain the hook-leak window and severity only when the engine returned them.",
  "Explain cliffs using their exact before/after positions and percentage-point drops.",
  "If the slide rate is unavailable, say it is unavailable; never manufacture seconds from a percentage-only axis.",
  "A pasted CSV does not preserve the original export filename. Do not claim absolute-versus-relative retention unless the evidence establishes it.",
  "Give at most one concrete recommendation, tied to a measured finding. If no issue was found, say so rather than forcing a fix.",
  "Label findings MEASURED and interpretation INFERRED; label the next action RECOMMENDATION. Plain language, no performance promises."
].join("\n");

let retentionTitle = "Retention export";
let retentionZipEntries = [];
let retentionCardIndex = 0;

async function readZipCsvEntries(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 22) throw new Error("This file is too small to be a ZIP export.");
  const view = new DataView(bytes.buffer);
  const u32 = (at) => view.getUint32(at, true);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at -= 1) {
    if (u32(at) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd < 0) throw new Error("This ZIP export could not be read in the browser.");
  const count = view.getUint16(eocd + 10, true);
  const centralOffset = u32(eocd + 16);
  const decoder = new TextDecoder();
  const entries = [];
  let at = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (u32(at) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressedSize = u32(at + 20);
    const uncompressedSize = u32(at + 24);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = u32(at + 42);
    const name = decoder.decode(bytes.slice(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!/\.csv$/i.test(name) || !compressedSize || compressedSize > 30 * 1024 * 1024) continue;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let raw;
    if (method === 0) raw = compressed;
    else if (method === 8 && typeof DecompressionStream === "function") raw = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else continue;
    if (uncompressedSize && raw.length !== uncompressedSize) continue;
    entries.push({ name, text: decoder.decode(raw) });
  }
  return entries;
}

function parseCsvText(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < String(text || "").length; i += 1) {
    const char = String(text || "")[i];
    const next = String(text || "")[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(cell.trim()); cell = ""; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim()); cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function csvLine(values) {
  return values.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",");
}

function retentionEntryProfile(entry) {
  const rows = parseCsvText(entry.text);
  const headers = rows[0] || [];
  const normalized = headers.map((header) => header.toLowerCase());
  const positionIndex = normalized.findIndex((header) => header.includes("video position"));
  const retentionIndex = normalized.findIndex((header) => header.includes("retention"));
  const title = entry.name.split(/[\\/]/).pop();
  if (positionIndex < 0 || rows.length < 2) return { title, kind: "empty", headers, series: [], summary: "No readable data rows were found in this export." };
  if (retentionIndex >= 0) {
    const categoryIndex = headers.length >= 3 && retentionIndex !== 1 ? 1 : -1;
    const categories = categoryIndex >= 0 ? [...new Set(rows.slice(1).map((row) => row[categoryIndex]).filter(Boolean))] : [null];
    const series = categories.map((category) => {
      const points = rows.slice(1).filter((row) => row[positionIndex] !== "" && row[retentionIndex] !== "" && (!category || row[categoryIndex] === category));
      const csv = [csvLine([headers[positionIndex], headers[retentionIndex]]), ...points.map((row) => csvLine([row[positionIndex], row[retentionIndex]]))].join("\n");
      return { label: category || "Overall audience", csv, rows: points.length };
    }).filter((item) => item.rows >= 2);
    const compareIndex = normalized.findIndex((header, index) => index !== retentionIndex && header.includes("compared"));
    const comparePoints = compareIndex >= 0 ? rows.slice(1).map((row) => ({ time: Number(row[positionIndex]), retention_pct: Number(row[compareIndex]), axis: "%" })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.retention_pct)) : [];
    const compareValues = comparePoints.map((point) => point.retention_pct);
    return { title, kind: series.length > 1 ? "segment-retention" : "retention", headers, series, comparePoints, compareAverage: compareValues.length ? (compareValues.reduce((a, b) => a + b, 0) / compareValues.length).toFixed(1) : null, summary: series.length > 1 ? `Separate retention curves for ${series.map((item) => item.label).join(" and ")}.` : "Overall retention curve." };
  }
  const numeric = headers.map((header, index) => ({ header, index, values: rows.slice(1).filter((row) => row[index] !== "").map((row) => Number(row[index])).filter(Number.isFinite) })).filter((item) => item.index !== positionIndex && item.values.length);
  return { title, kind: numeric.length ? "activity" : "empty", headers, series: [], numeric, summary: numeric.length ? "Supporting activity export; it is not an audience-retention curve." : "This export has no numeric analysis rows." };
}

async function analyzeRetentionEntries(entries, duration) {
  const jobs = [];
  for (const entry of entries) {
    const profile = retentionEntryProfile(entry);
    if (!profile.series.length) {
      jobs.push(Promise.resolve({ entry, profile, findings: null }));
      continue;
    }
    for (const series of profile.series) {
      jobs.push(tool("retention", { csv: series.csv, duration: duration || undefined }, 180000)
        .then((findings) => ({ entry, profile, series, findings: findings && !findings.error ? findings : null, error: findings && findings.error }))
        .catch((error) => ({ entry, profile, series, findings: null, error: String(error.message || error) })));
    }
  }
  return Promise.all(jobs);
}

async function attachmentAnalysisContext(attachment) {
  if (attachment.dataUrl) return "An image is attached. Use the vision model for a heuristic thumbnail score; do not present it as measured CTR.";
  const entries = attachment.entries || [{ name: attachment.name, text: attachment.text || "" }];
  const reports = await analyzeRetentionEntries(entries, "");
  return reports.map((report) => {
    const label = report.series ? `${report.profile.title} · ${report.series.label}` : report.profile.title;
    if (!report.findings) return `${label}: unavailable or supporting activity export (${report.profile.summary}).`;
    return `${label}: ${JSON.stringify({ rows_read: report.findings.rows_read, axis: report.findings.axis, hook_leak: report.findings.hook_leak, cliffs: report.findings.cliffs, slide: report.findings.slide })}`;
  }).join("\n").slice(0, 18000);
}

function retentionGraph(findings) {
  const series = (Array.isArray(findings) ? findings : [findings]).filter(Boolean).map((item) => ({ label: item.label || "Audience retention", points: Array.isArray(item.points) ? item.points : [] })).filter((item) => item.points.length > 1);
  const points = series[0]?.points || [];
  if (points.length < 2) return '<div class="empty-state"><strong>Not enough points for a graph.</strong><span>The engine needs at least two numeric readings.</span></div>';
  const allPoints = series.flatMap((item) => item.points);
  const xs = allPoints.map((point) => Number(point.time));
  const ys = allPoints.map((point) => Number(point.retention_pct));
  const minX = Math.min(...xs), maxX = Math.max(...xs), spanX = Math.max(1, maxX - minX);
  const max = Math.max(...ys.filter(Number.isFinite));
  const niceStep = (value, count) => { const raw = value / count; const magnitude = 10 ** Math.floor(Math.log10(raw || 1)); const fraction = raw / magnitude; return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * magnitude; };
  const step = niceStep(Math.max(100, max), 4), maxY = Math.ceil(Math.max(100, max) / step) * step;
  const isPercentAxis = points[0].axis === "%";
  const W = 900, H = 310, left = 40, right = 58, top = 30, bottom = 30, plotW = W - left - right, plotH = H - top - bottom;
  const y = (value) => top + (1 - value / maxY) * plotH;
  // The reference deck plots percentage exports across a fixed 0–100% video
  // axis, even when the last supplied sample is 99%. Preserve elapsed-time
  // exports on their real time axis instead of relabelling their measurements.
  const x = (point) => left + (isPercentAxis
    ? Math.max(0, Math.min(100, Number(point.time))) / 100 * plotW
    : (Number(point.time) - minX) / spanX * plotW);
  const colors = ["#3987e5", "#d95926", "#199e70"];
  const plotted = series.map((item, index) => {
    const coords = item.points.filter((point) => Number.isFinite(Number(point.retention_pct))).map((point) => [x(point), y(Number(point.retention_pct))]);
    const path = coords.map(([px, py], pointIndex) => `${pointIndex ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
    const area = series.length === 1 ? `<path class="ret-area" d="${path} L ${coords.at(-1)[0].toFixed(2)},${top + plotH} L ${coords[0][0].toFixed(2)},${top + plotH} Z" style="fill:${colors[index % colors.length]}"/>` : "";
    const last = coords.at(-1), value = Number(item.points.at(-1).retention_pct);
    return `${area}<path class="ret-line" d="${path}" style="stroke:${colors[index % colors.length]}"/><circle class="chart-endpoint" cx="${last[0].toFixed(2)}" cy="${last[1].toFixed(2)}" r="4" style="fill:${colors[index % colors.length]}"/><text class="chart-end-label" x="${W - right + 12}" y="${(last[1] + 4).toFixed(2)}" style="fill:${colors[index % colors.length]}">${escapeHtml(value.toFixed(1))}%</text>`;
  }).join("");
  const pointSummary = series.map((item) => `${item.label}: ${item.points.length} measurements from ${item.points[0].time} to ${item.points.at(-1).time}`).join("; ");
  const axis = points[0].axis === '%' ? '% of video' : 'elapsed seconds';
  const grid = [];
  for (let tick = 0; tick <= maxY; tick += step) {
    const py = y(tick);
    const isBaseline = tick === 0, isReference = max > 100 && tick === 100;
    grid.push(`<path class="chart-grid-line${isReference ? " chart-reference-line" : ""}${isBaseline ? " chart-baseline" : ""}" d="M${left} ${py.toFixed(2)}H${W - right}"/><text class="chart-tick${isReference ? " chart-reference-tick" : ""}" x="${left - 8}" y="${(py + 4).toFixed(2)}" text-anchor="end">${escapeHtml(String(tick))}%</text>`);
  }
  const xLabels = [0, 25, 50, 75, 100].map((pct) => {
    const px = left + plotW * pct / 100;
    const label = isPercentAxis ? `${pct}%` : `${Number((minX + spanX * pct / 100).toFixed(1))}s`;
    return `<text class="chart-tick" x="${px.toFixed(2)}" y="${H - 8}" text-anchor="${pct === 0 ? 'start' : pct === 100 ? 'end' : 'middle'}">${escapeHtml(label)}</text>`;
  }).join("");
  const legend = series.length > 1 ? `<div class="chart-legend">${series.map((item,index)=>`<span><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(item.label)}</span>`).join("")}</div>` : "";
  const yTitle = isPercentAxis ? "Absolute audience retention · by position in video" : "Audience retention · by elapsed time";
  const dataAttribute = escapeHtml(JSON.stringify(series.map((item) => ({ label: item.label, points: item.points }))));
  const hoverDots = series.map((_, index) => `<circle class="chart-hover-dot" data-series-index="${index}" r="4" cx="0" cy="0" style="fill:${colors[index % colors.length]}"/>`).join("");
  return `<div class="ret-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Audience retention curve" data-chart-series="${dataAttribute}" data-chart-axis="${isPercentAxis ? "percent" : "time"}" data-chart-max-y="${maxY}"><desc>${escapeHtml(pointSummary)}</desc><text class="chart-title" x="0" y="12">${escapeHtml(yTitle)}</text>${grid.join("")}${plotted}${xLabels}<path class="chart-axis-line" d="M${left} ${top}V${top + plotH}H${W - right}"/><rect class="chart-hit-area" x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/><g class="chart-hover-layer" aria-hidden="true"><path class="chart-hover-line" d="M0 ${top}V${top + plotH}"/>${hoverDots}</g></svg><div class="ret-chart-tip" role="status" aria-live="polite" hidden></div><div class="chart-caption">${escapeHtml(axis)} · ${points.length} measured positions per series · no invented points</div>${legend}</div>`;
}

function wireRetentionChartHover(card) {
  const svg = card.querySelector(".ret-chart svg[data-chart-series]");
  const tip = card.querySelector(".ret-chart-tip");
  if (!svg || !tip) return;
  let series;
  try { series = JSON.parse(svg.dataset.chartSeries || "[]"); } catch { return; }
  if (!series.length) return;
  const hoverLine = svg.querySelector(".chart-hover-line");
  const dots = [...svg.querySelectorAll(".chart-hover-dot")];
  const minX = Math.min(...series.flatMap((item) => item.points.map((point) => Number(point.time))));
  const maxX = Math.max(...series.flatMap((item) => item.points.map((point) => Number(point.time))));
  const spanX = Math.max(1, maxX - minX), left = 40, right = 58, width = 900 - left - right;
  const xFor = (point) => left + (svg.dataset.chartAxis === "percent"
    ? Math.max(0, Math.min(100, Number(point.time))) / 100 * width
    : (Number(point.time) - minX) / spanX * width);
  const hide = () => { tip.hidden = true; hoverLine?.setAttribute("visibility", "hidden"); dots.forEach((dot) => dot.setAttribute("visibility", "hidden")); };
  svg.addEventListener("pointermove", (event) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const pointer = svg.createSVGPoint(); pointer.x = event.clientX; pointer.y = event.clientY;
    const local = pointer.matrixTransform(matrix.inverse());
    const targetX = Math.max(left, Math.min(900 - right, local.x));
    const measuredX = svg.dataset.chartAxis === "percent"
      ? (targetX - left) / width * 100
      : minX + (targetX - left) / width * spanX;
    const values = series.map((item) => item.points.reduce((best, point) =>
      Math.abs(Number(point.time) - measuredX) < Math.abs(Number(best.time) - measuredX) ? point : best, item.points[0]));
    const first = values[0], x = xFor(first);
    hoverLine?.setAttribute("d", `M${x.toFixed(2)} 30V280`); hoverLine?.setAttribute("visibility", "visible");
    values.forEach((point, index) => {
      if (!dots[index]) return;
      dots[index].setAttribute("cx", xFor(point).toFixed(2));
      dots[index].setAttribute("cy", (30 + (1 - Number(point.retention_pct) / Number(svg.dataset.chartMaxY || 100)) * 250).toFixed(2));
      dots[index].setAttribute("visibility", "visible");
    });
    const parentRect = svg.parentElement.getBoundingClientRect();
    tip.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = `${svg.dataset.chartAxis === "percent" ? `Position ${Math.round(measuredX)}%` : `${Number(measuredX.toFixed(1))} seconds`}`;
    tip.append(heading);
    values.forEach((point, index) => {
      const row = document.createElement("span"), marker = document.createElement("i"), label = document.createElement("span");
      marker.style.background = ["#3987e5", "#d95926", "#199e70"][index % 3];
      label.textContent = `${series[index].label}: ${Number(point.retention_pct).toFixed(2)}%`;
      row.className = "ret-chart-tip-row"; row.append(marker, label); tip.append(row);
    });
    tip.hidden = false;
    const leftPct = ((event.clientX - parentRect.left) / parentRect.width) * 100;
    tip.style.left = `${Math.max(3, Math.min(82, leftPct))}%`;
    tip.style.top = `${Math.max(4, Math.min(parentRect.height - 70, event.clientY - parentRect.top - 54))}px`;
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
}

function wireRetentionActivityHover(card) {
  const svg = card.querySelector(".ret-activity-chart svg[data-activity-points]");
  const tip = card.querySelector(".ret-activity-chart .ret-chart-tip");
  if (!svg || !tip) return;
  let points;
  try { points = JSON.parse(svg.dataset.activityPoints || "[]"); } catch { return; }
  if (!points.length) return;
  const hoverLine = svg.querySelector(".activity-hover-line");
  const seenDot = svg.querySelector(".activity-hover-seen");
  const width = 900, height = 260, left = 54, right = 24, top = 24, gap = 34, bottom = 24;
  const panelHeight = (height - top - bottom - gap) / 2;
  const stopTop = top + panelHeight + gap;
  const seenMax = Number(svg.dataset.seenMax) || 1;
  const xFor = (point) => left + Math.max(0, Math.min(100, Number(point.x))) / 100 * (width - left - right);
  const hide = () => {
    tip.hidden = true;
    hoverLine?.setAttribute("visibility", "hidden");
    seenDot?.setAttribute("visibility", "hidden");
  };
  svg.addEventListener("pointermove", (event) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const pointer = svg.createSVGPoint(); pointer.x = event.clientX; pointer.y = event.clientY;
    const local = pointer.matrixTransform(matrix.inverse());
    const targetPct = (Math.max(left, Math.min(width - right, local.x)) - left) / (width - left - right) * 100;
    const point = points.reduce((best, item) => Math.abs(item.x - targetPct) < Math.abs(best.x - targetPct) ? item : best, points[0]);
    const x = xFor(point), y = top + (1 - point.seen / seenMax) * panelHeight;
    hoverLine?.setAttribute("x1", x.toFixed(2)); hoverLine?.setAttribute("x2", x.toFixed(2)); hoverLine?.setAttribute("visibility", "visible");
    seenDot?.setAttribute("cx", x.toFixed(2)); seenDot?.setAttribute("cy", y.toFixed(2)); seenDot?.setAttribute("visibility", "visible");
    const parentRect = svg.parentElement.getBoundingClientRect();
    tip.replaceChildren();
    const heading = document.createElement("strong"); heading.textContent = `Video position ${Number(point.x).toFixed(1)}%`; tip.append(heading);
    for (const [label, value, color] of [["Times seen", point.seen, "#3987e5"], ["Stopped watching", point.stopped, "#d95926"]]) {
      const row = document.createElement("span"), marker = document.createElement("i"), text = document.createElement("span");
      marker.style.background = color; text.textContent = `${label}: ${Number(value).toLocaleString("en-US")}`;
      row.className = "ret-chart-tip-row"; row.append(marker, text); tip.append(row);
    }
    tip.hidden = false;
    const leftPct = ((event.clientX - parentRect.left) / parentRect.width) * 100;
    tip.style.left = `${Math.max(3, Math.min(75, leftPct))}%`;
    tip.style.top = `${Math.max(4, Math.min(parentRect.height - 70, event.clientY - parentRect.top - 54))}px`;
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
}

function retentionCard(title, label, body, index) {
  return `<article class="ret-card ${index === 0 ? 'is-active' : ''}" data-ret-card="${index}"><div class="ret-card-kicker">${escapeHtml(label)}</div><h3>${escapeHtml(title)}</h3><p>${body}</p></article>`;
}

function conciseRetentionRead(value) {
  const words = String(value || "Short interpretation unavailable; the measured chart remains available above.").trim().match(/\S+/g) || [];
  return words.length > 35 ? `${words.slice(0, 35).join(" ")}…` : words.join(" ");
}

function retentionActivityGraph(entry) {
  if (!entry?.text) return "";
  const rows = parseCsvText(entry.text);
  const headers = (rows[0] || []).map((value) => value.toLowerCase());
  const position = headers.findIndex((value) => value.includes("video position"));
  const seen = headers.findIndex((value) => value.includes("times each moment was seen"));
  const stopped = headers.findIndex((value) => value.includes("stopped watching"));
  if (position < 0 || seen < 0 || stopped < 0) return "";
  const data = rows.slice(1).map((row) => ({x:Number(row[position]),seen:Number(row[seen]),stopped:Number(row[stopped])})).filter((row) => Number.isFinite(row.x));
  const width = 900, height = 260, left = 54, right = 24, top = 24, gap = 34, bottom = 24;
  const panelHeight = (height - top - bottom - gap) / 2, plotWidth = width - left - right;
  const x = (value) => left + (value / 100) * plotWidth;
  const seenValues = data.map((row) => row.seen).filter(Number.isFinite), stopValues = data.map((row) => row.stopped).filter(Number.isFinite);
  const seenMax = Math.max(1, ...seenValues), stopMax = Math.max(1, ...stopValues);
  const ySeen = (value) => top + (1 - value / seenMax) * panelHeight;
  const stopTop = top + panelHeight + gap;
  const yStop = (value) => stopTop + (1 - value / stopMax) * panelHeight;
  const line = data.filter((row) => Number.isFinite(row.seen)).map((row,index) => `${index ? "L" : "M"}${x(row.x).toFixed(2)},${ySeen(row.seen).toFixed(2)}`).join(" ");
  const barWidth = Math.max(1, plotWidth / 100 * .66);
  const bars = data.filter((row) => Number.isFinite(row.stopped)).map((row) => `<rect x="${(x(row.x)-barWidth/2).toFixed(2)}" y="${yStop(row.stopped).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${(stopTop+panelHeight-yStop(row.stopped)).toFixed(2)}" rx="1"/>`).join("");
  const labels = [0,25,50,75,100].map((value) => `<text class="chart-tick" x="${x(value).toFixed(2)}" y="${height-5}" text-anchor="${value===0?'start':value===100?'end':'middle'}">${value}%</text>`).join("");
  const maxSeenLabel = Math.round(seenMax).toLocaleString("en-US"), maxStopLabel = Math.round(stopMax).toLocaleString("en-US");
  const activityPoints = escapeHtml(JSON.stringify(data.map((row) => ({ x: row.x, seen: Number.isFinite(row.seen) ? row.seen : 0, stopped: Number.isFinite(row.stopped) ? row.stopped : 0 }))));
  return `<div class="ret-activity-chart"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Detailed activity: views seen and stopped watching by video position" data-activity-points="${activityPoints}" data-seen-max="${seenMax}"><path class="chart-grid-line" d="M${left} ${top}H${width-right}M${left} ${top+panelHeight}H${width-right}M${left} ${stopTop}H${width-right}M${left} ${stopTop+panelHeight}H${width-right}"/><text class="chart-tick" x="${left}" y="14">Times each moment was seen · max ${maxSeenLabel}</text><path class="ret-line" d="${line}"/><text class="chart-tick" x="${left}" y="${stopTop-9}">Stopped watching · max ${maxStopLabel}</text><g class="activity-stop-bars">${bars}</g>${labels}<g class="activity-hover-layer" aria-hidden="true"><line class="activity-hover-line" x1="0" x2="0" y1="${top}" y2="${stopTop+panelHeight}" visibility="hidden"/><circle class="activity-hover-seen" r="4" visibility="hidden"/></g></svg><div class="ret-chart-tip" role="status" aria-live="polite" hidden></div><div class="chart-legend"><span><i class="legend-seen"></i>Times seen</span><span><i class="legend-stopped"></i>Stopped watching</span></div></div>`;
}

function renderRetentionReport(findings, recommendation, title) {
  const hook = findings.hook_leak || {};
  const slide = findings.slide || {};
  const cliffs = Array.isArray(findings.cliffs) ? findings.cliffs : [];
  const cliffBody = cliffs.length ? cliffs.map((cliff) => `${escapeHtml(String(cliff.from))}${cliff.axis === '%' ? '%' : 's'} → ${escapeHtml(String(cliff.to))}${cliff.axis === '%' ? '%' : 's'}: <strong>${escapeHtml(String(cliff.drop_points))} points</strong>`).join('<br />') : 'No adjacent cliff crossed the engine threshold.';
  retentionCardIndex = 0;
  return `<div class="ret-report"><div class="ret-report-hero"><div><div class="eyebrow">MEASURED · RETENTION CURVE</div><h2>${escapeHtml(title || 'Retention export')}</h2><p>${escapeHtml(String(findings.rows_read || 0))} readings · ${escapeHtml(String(findings.axis || 'axis unavailable'))}</p></div><span class="ev ev-measured">ENGINE VERIFIED</span></div>${retentionGraph(findings)}<div class="ret-card-stage"><div class="ret-card-nav"><div><span class="eyebrow">FINDING CARDS</span><span class="hint">Swipe the evidence one card at a time</span></div><button id="ret-next" class="circle-btn" type="button" aria-label="Next retention finding">›</button></div><div class="ret-card-deck">${retentionCard('The opening loses ' + (hook.loss_points ?? '—') + ' points', 'HOOK LEAK · MEASURED', `From ${escapeHtml(String(hook.start_retention_pct ?? '—'))}% to ${escapeHtml(String(hook.minimum_early_retention_pct ?? '—'))}% in the ${escapeHtml(String(hook.window || 'early window'))}. Severity: <strong>${escapeHtml(String(hook.severity || 'unavailable'))}</strong>.`, 0)}${retentionCard('Where the cliffs are', 'CLIFFS · MEASURED', cliffBody, 1)}${retentionCard('How fast the curve slides', 'SLIDE · MEASURED', slide.average_loss_points_per_minute == null ? 'Per-minute slide is unavailable until the export has elapsed seconds or a video duration is supplied.' : `Average loss: <strong>${escapeHtml(String(slide.average_loss_points_per_minute))} points/minute</strong>.`, 2)}${retentionCard('One next move', 'RECOMMENDATION · INFERRED', renderMd(recommendation || 'Review the largest measured drop before changing the whole format.'), 3)}</div><div class="ret-dots"><span class="ret-dot is-active"></span><span class="ret-dot"></span><span class="ret-dot"></span><span class="ret-dot"></span></div></div></div>`;
}

function renderRetentionBundle(reports, title) {
  const grouped = new Map();
  reports.forEach((report) => {
    const key = report.entry?.name || report.profile.title;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(report);
  });
  const cards = [];
  grouped.forEach((items, entryName) => {
    const titleByFile = {"all.csv":"All viewers","subscribers and non-subscribers.csv":"Subscribed vs. not subscribed","new and returning viewers.csv":"New vs. returning viewers","new, casual and regular viewers.csv":"New vs. casual viewers","organic and paid traffic.csv":"Organic vs. paid traffic","organic.csv":"Organic traffic and benchmark","detailed activity.csv":"Detailed activity","skippable video ad.csv":"Skippable video ad","video discovery ad.csv":"Video discovery ad"};
    const label = titleByFile[String(entryName).split(/[\\/]/).pop().toLowerCase()] || items[0].profile.title;
    const chartItems = items.filter((report) => report.findings?.points?.length > 1);
    const chartSeries = chartItems.map((report) => ({label: report.series?.label || "Overall audience", points: report.findings.points}));
    const parsedEntry = items[0].entry ? retentionEntryProfile(items[0].entry) : items[0].profile;
    const compare = items[0].profile.comparePoints || parsedEntry.comparePoints || [];
    const totalRows = chartItems.reduce((sum, report) => sum + Number(report.findings.rows_read || report.series?.rows || 0), 0);
    const summary = chartItems.map((report) => `${report.series?.label || "Audience"}: ${conciseRetentionRead(report.shortDescription)}`).join(" · ");
    const metrics = chartItems.flatMap((report) => {
      const findings = report.findings;
      return [
        `<span><strong>${escapeHtml(String(findings.hook_leak?.loss_points ?? "—"))}</strong> ${escapeHtml(report.series?.label || "audience")} hook loss</span>`,
        `<span><strong>${escapeHtml(String(findings.cliffs?.length ?? 0))}</strong> cliffs</span>`,
      ];
    });
    const detail = parsedEntry.numeric || items.find((report) => report.profile.numeric)?.profile.numeric;
    const activityStats = detail ? `<div class="metric-pills">${detail.map((metric) => `<span><strong>${escapeHtml(metric.values.length)}</strong> ${escapeHtml(metric.header)} readings</span>`).join("")}</div>` : "";
    if (chartSeries.length) {
      cards.push(`<article class="ret-bundle-card"><div class="ret-bundle-dim" aria-hidden="true"></div><div class="ret-report-hero"><div><div class="eyebrow">${chartSeries.length > 1 ? "AUDIENCE SEGMENTS · MEASURED" : "RETENTION CURVE · MEASURED"}</div><h3>${escapeHtml(label)}</h3><p>${escapeHtml(String(totalRows))} readings · ${escapeHtml(String(chartItems[0].findings.axis || "axis unavailable"))}</p></div><span class="ev ev-measured">ENGINE VERIFIED</span></div>${retentionGraph(chartSeries)}<p class="ret-llm-summary"><span class="eyebrow">ANNA'S READ</span>${escapeHtml(conciseRetentionRead(summary))}</p><div class="metric-pills">${metrics.join("")}</div></article>`);
    } else {
      const details = items.map((report) => report.error || report.profile.summary).filter(Boolean).join(" ");
      cards.push(`<article class="ret-bundle-card ret-bundle-support"><div class="ret-bundle-dim" aria-hidden="true"></div><div class="ret-report-hero"><div><div class="eyebrow">${detail ? "MOMENT-BY-MOMENT ACTIVITY · MEASURED" : "SUPPORTING EXPORT · NO RETENTION READINGS"}</div><h3>${escapeHtml(label)}</h3><p>${escapeHtml(entryName)}</p></div><span class="ev ev-measured">${detail ? "CSV READ" : "NO DATA"}</span></div>${detail ? retentionActivityGraph(items[0].entry) : `<div class="support-note"><p>${escapeHtml(details || "This CSV contains no numeric rows to chart.")}</p></div>`}${activityStats}</article>`);
    }
    if (compare.length > 1) {
      const compareChart = compare.map((point) => ({time:point.time,retention_pct:point.retention_pct,axis:point.axis}));
      cards.push(`<article class="ret-bundle-card"><div class="ret-bundle-dim" aria-hidden="true"></div><div class="ret-report-hero"><div><div class="eyebrow">BENCHMARK · MEASURED</div><h3>Compared to other videos</h3><p>${compare.length} benchmark readings from ${escapeHtml(label)}</p></div><span class="ev ev-measured">CSV MEASURED</span></div>${retentionGraph({label:"Compared to other videos",points:compareChart})}<p class="ret-llm-summary"><span class="eyebrow">SOURCE</span>Comparison curve from the separate benchmark column in this CSV; it is not mixed into the audience-retention curve.</p></article>`);
    }
  });
  const first15 = cards.slice(0, 15);
  const cardMarkup = first15.join("");
  return `<div class="ret-bundle"><div class="ret-report-hero"><div><div class="eyebrow">ZIP BUNDLE · METRIC-AWARE ANALYSIS</div><h2>${escapeHtml(title || "Retention bundle")}</h2><p>${escapeHtml(String(reports.length))} CSV/segment engine analyses · ${first15.length} visual evidence cards</p></div><span class="ev ev-inferred">NO JSON OUTPUT</span></div><p class="bundle-note">Each CSV stays its own measured view; segments within a CSV share one multi-series graph. Empty ad exports remain explicitly visible.</p><div class="ret-bundle-controls"><button id="bundle-prev" class="circle-btn" type="button" aria-label="Move to previous analysis card">‹</button><span id="bundle-position">1 / ${first15.length}</span><button id="bundle-next" class="circle-btn" type="button" aria-label="Move to next analysis card">›</button></div><p class="ret-motion-note" id="ret-motion-note" hidden><span id="ret-motion-text" role="status" aria-live="polite"></span><button class="ret-motion-toggle" id="ret-motion-toggle" type="button"></button></p><div class="ret-bundle-deck" data-count="${first15.length}">${cardMarkup}</div></div>`;
}

function wireRetentionBundleDeck() {
  const deck = byId("ret-output")?.querySelector(".ret-bundle-deck");
  const next = byId("bundle-next");
  const previous = byId("bundle-prev");
  if (!deck || !next) return;
  const cards = [...deck.children];
  if (!cards.length) return;
  cards.forEach((card) => { wireRetentionChartHover(card); wireRetentionActivityHover(card); });
  const dims = cards.map((card) => card.querySelector(".ret-bundle-dim"));
  const depth = 28, perspective = 1800, maxSlot = 3;
  let rise = 20, order = cards.map((_, index) => index), busy = false, queue = [];
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  let systemPrefersReducedMotion = motionPreference.matches;
  // Match the supplied retention-deck reference: animate by default, while
  // keeping an explicit reduced-motion control available for accessibility.
  let reducedMotion = retentionMotionChoice ?? false;
  let motionOverride = retentionMotionChoice !== null || !systemPrefersReducedMotion;
  const motionNote = byId("ret-motion-note"), motionText = byId("ret-motion-text"), motionToggle = byId("ret-motion-toggle");
  const updateMotionControl = () => {
    if (!motionNote || !motionToggle) return;
    motionNote.hidden = false;
    motionText.textContent = reducedMotion
      ? "Card shuffles are instant for this session."
      : (systemPrefersReducedMotion
        ? "Animations are playing; your system normally reduces motion."
        : "Card shuffle animations are enabled for this session.");
    motionToggle.textContent = reducedMotion ? "Play animations" : "Use reduced motion";
    motionToggle.setAttribute("aria-pressed", String(!reducedMotion));
  };
  motionToggle?.addEventListener("click", () => {
    motionOverride = true;
    reducedMotion = !reducedMotion;
    retentionMotionChoice = reducedMotion;
    document.documentElement.classList.toggle("motion-preview", !reducedMotion && systemPrefersReducedMotion);
    updateMotionControl();
  });
  document.documentElement.classList.toggle("motion-preview", !reducedMotion && systemPrefersReducedMotion);
  motionPreference.addEventListener?.("change", (event) => {
    systemPrefersReducedMotion = event.matches;
    if (!motionOverride) {
      reducedMotion = false;
      retentionMotionChoice = null;
    }
    document.documentElement.classList.toggle("motion-preview", !reducedMotion && systemPrefersReducedMotion);
    updateMotionControl();
  });
  const slot = (position) => Math.min(position, maxSlot);
  const rest = (position) => `scale(${1 + position * depth / perspective}) translate3d(0px,${position * rise}px,${-position * depth}px) rotateX(0deg) rotateZ(0deg) scale(${1 - .04 * position})`;
  const pose = (value) => `scale(1) translate3d(0px,${value.y}px,${value.z}px) rotateX(${value.rx}deg) rotateZ(${value.rz}deg) scale(${value.s})`;
  const dimOf = (position) => position * .14;
  const layout = () => { rise = 12 + .02 * deck.clientHeight; };
  const fitReadSections = () => {
    const currentHeight = deck.clientHeight;
    let extraHeight = 0;
    cards.forEach((card) => {
      const read = card.querySelector(".ret-llm-summary");
      if (!read) return;
      const overflow = card.scrollHeight - card.clientHeight;
      if (overflow <= 1) return;
      const chart = card.querySelector(".ret-chart");
      if (chart && !chart.dataset.readFitLocked) {
        chart.style.flex = "none";
        chart.style.height = `${chart.getBoundingClientRect().height}px`;
        chart.dataset.readFitLocked = "true";
      }
      extraHeight = Math.max(extraHeight, overflow + 20);
    });
    if (extraHeight > 0) deck.style.height = `${currentHeight + Math.ceil(extraHeight)}px`;
  };
  const apply = () => cards.forEach((card) => {
    const position = order.indexOf(cards.indexOf(card)), depthSlot = slot(position);
    card.style.transform = rest(depthSlot);
    card.style.opacity = position > maxSlot ? "0" : "1";
    card.style.filter = "none";
    if (dims[cards.indexOf(card)]) dims[cards.indexOf(card)].style.opacity = String(dimOf(depthSlot));
    card.style.zIndex = String(cards.length - position);
    card.classList.toggle("is-front", position === 0);
    card.style.pointerEvents = position <= maxSlot ? "auto" : "none";
    card.setAttribute("aria-hidden", String(position !== 0));
    card.setAttribute("tabindex", position === 0 ? "0" : "-1");
  });
  const updatePosition = () => {
    const position = byId("bundle-position");
    if (position) position.textContent = `${order[0] + 1} / ${cards.length}`;
  };
  const flight = (direction, duration, done) => {
    const forward = direction > 0;
    const mover = cards[forward ? order[0] : order[cards.length - 1]];
    const newOrder = forward ? [...order.slice(1), order[0]] : [order[cards.length - 1], ...order.slice(0, -1)];
    const backSlot = slot(cards.length - 1), endSlot = forward ? backSlot : 0;
    const height = deck.clientHeight, up = -(height + 110), behindZ = -backSlot * depth - 10;
    const p1 = {y:-height*.3,z:60,rx:3,rz:-3,s:1}, p2 = {y:up,z:60,rx:4,rz:-8,s:1};
    const p3 = {y:up,z:behindZ,rx:0,rz:-5,s:1}, p4 = {y:-height*.25,z:behindZ,rx:0,rz:-1.5,s:1};
    const easing = "cubic-bezier(.4,0,.25,1)";
    const moverDim = dims[cards.indexOf(mover)];
    const topLayer = cards.length + 1, backLayer = 0;
    const frames = forward
      ? [{transform:rest(0),zIndex:topLayer,offset:0,easing},{transform:pose(p1),zIndex:topLayer,offset:.2,easing},{transform:pose(p2),zIndex:topLayer,offset:.42,easing},{transform:pose(p2),zIndex:backLayer,offset:.43,easing},{transform:pose(p3),zIndex:backLayer,offset:.56,easing},{transform:pose(p4),zIndex:backLayer,offset:.8,easing},{transform:rest(backSlot),zIndex:backLayer,offset:1}]
      : [{transform:rest(backSlot),zIndex:backLayer,offset:0,easing},{transform:pose(p4),zIndex:backLayer,offset:.2,easing},{transform:pose(p3),zIndex:backLayer,offset:.44,easing},{transform:pose(p2),zIndex:backLayer,offset:.58,easing},{transform:pose(p2),zIndex:topLayer,offset:.59,easing},{transform:pose(p1),zIndex:topLayer,offset:.8,easing},{transform:rest(0),zIndex:topLayer,offset:1}];
    const dimFrames = forward
      ? [{opacity:0,offset:0},{opacity:0,offset:.56},{opacity:dimOf(backSlot),offset:1}]
      : [{opacity:dimOf(backSlot),offset:0},{opacity:dimOf(backSlot),offset:.44},{opacity:0,offset:.7},{opacity:0,offset:1}];
    cards.forEach((card) => {
      if (card === mover) return;
      const newSlot = slot(newOrder.indexOf(cards.indexOf(card)));
      const delay = forward ? duration * .32 : duration * .02;
      const transitionDuration = forward ? duration * .62 : duration * .55;
      card.style.setProperty("transition", `transform ${transitionDuration}ms ${easing} ${delay}ms, opacity ${transitionDuration}ms linear ${delay}ms, filter ${transitionDuration}ms ease ${delay}ms`, "important");
      card.style.transform = rest(newSlot);
      card.style.opacity = newOrder.indexOf(cards.indexOf(card)) > maxSlot ? "0" : "1";
      if (dims[cards.indexOf(card)]) {
        dims[cards.indexOf(card)].style.setProperty("transition-duration", `${transitionDuration}ms`, "important");
        dims[cards.indexOf(card)].style.setProperty("transition-delay", `${delay}ms`, "important");
        dims[cards.indexOf(card)].style.opacity = String(dimOf(newSlot));
      }
    });
    mover.style.opacity = "1"; mover.style.pointerEvents = "none";
    mover.style.zIndex = String(forward ? topLayer : backLayer);
    order = newOrder;
    const finishFlight = () => {
      mover.classList.add("deck-no-transition");
      if (moverDim) moverDim.style.setProperty("transition", "none", "important");
      mover.style.transform = rest(endSlot);
      if (moverDim) moverDim.style.opacity = String(dimOf(endSlot));
      void mover.offsetWidth;
      mover.classList.remove("deck-no-transition");
      mover.classList.remove("is-shuffling-out");
      mover.style.removeProperty("z-index");
      cards.forEach((card) => card.classList.remove("is-shuffling-in"));
      deck.classList.remove("is-shuffling-next", "is-shuffling-prev", "motion-css-fallback");
      mover.style.removeProperty("--deck-y");
      mover.style.removeProperty("--deck-z");
      mover.style.removeProperty("--deck-scale");
      mover.style.removeProperty("--deck-opacity");
      if (moverDim) moverDim.style.removeProperty("transition");
      cards.forEach((card, index) => { card.style.removeProperty("transition"); if (dims[index]) { dims[index].style.removeProperty("transition-duration"); dims[index].style.removeProperty("transition-delay"); } });
      apply(); updatePosition();
    };
    if (typeof mover.animate !== "function") {
      const nextCard = cards[newOrder[0]];
      const moverOpacity = Number.parseFloat(getComputedStyle(mover).opacity) || 1;
      mover.style.setProperty("--deck-y", `${endSlot * rise}px`);
      mover.style.setProperty("--deck-z", `${-endSlot * depth}px`);
      mover.style.setProperty("--deck-scale", String(1 - .04 * endSlot));
      mover.style.setProperty("--deck-opacity", String(endSlot > maxSlot ? 0 : moverOpacity));
      deck.classList.add("motion-css-fallback", forward ? "is-shuffling-next" : "is-shuffling-prev");
      mover.classList.add("is-shuffling-out");
      if (nextCard !== mover) nextCard?.classList.add("is-shuffling-in");
      if (moverDim) {
        moverDim.style.setProperty("transition", `opacity ${duration}ms ease-in-out`, "important");
        moverDim.style.opacity = String(dimOf(endSlot));
      }
      let finished = false;
      const onAnimationEnd = (event) => {
        if (event.target !== mover || finished) return;
        finished = true;
        mover.removeEventListener("animationend", onAnimationEnd);
        clearTimeout(fallbackTimer);
        finishFlight(); done();
      };
      mover.addEventListener("animationend", onAnimationEnd);
      const fallbackTimer = setTimeout(() => {
        if (finished) return;
        finished = true;
        mover.removeEventListener("animationend", onAnimationEnd);
        finishFlight(); done();
      }, duration + 80);
      return;
    }
    const animation = mover.animate(frames, {duration, fill:"forwards"});
    const dimAnimation = moverDim?.animate(dimFrames, {duration, fill:"forwards", easing:"ease-in-out"});
    animation.finished.then(() => {
      animation.cancel();
      dimAnimation?.cancel();
      finishFlight(); done();
    }).catch(() => { finishFlight(); done(); });
  };
  const run = (direction) => {
    busy = true;
    const finish = () => { busy = false; if (queue.length) run(queue.shift()); };
    if (reducedMotion) {
      order = direction > 0 ? [...order.slice(1), order[0]] : [order[order.length - 1], ...order.slice(0, -1)];
      apply(); updatePosition(); finish(); return;
    }
    flight(direction, 1200, finish);
  };
  const shuffle = (direction) => {
    const amount = direction === "next" ? 1 : -1;
    if (busy) { if (queue.length < 3) queue.push(amount); return; }
    if (cards.length > 1) run(amount);
  };
  const goTo = (index) => {
    const position = order.indexOf(index);
    if (position <= 0) return;
    const direction = position <= cards.length / 2 ? 1 : -1;
    const steps = direction > 0 ? position : cards.length - position;
    if (busy) { queue = Array(steps).fill(direction); return; }
    queue = Array(Math.max(0, steps - 1)).fill(direction);
    run(direction);
  };
  const playDeckIntro = () => {
    if (reducedMotion || !cards.length) return;
    const duration = 800, stagger = 90;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
    busy = true;
    cards.forEach((card) => {
      const position = order.indexOf(cards.indexOf(card)), depthSlot = slot(position);
      const delay = (maxSlot - depthSlot) * stagger;
      card.style.setProperty("transition", `transform ${duration}ms cubic-bezier(.32,.72,.24,1) ${delay}ms, opacity ${duration}ms linear ${delay}ms`, "important");
      card.style.transform = "translate3d(0,46px,0)";
      card.style.opacity = "0";
      void card.offsetWidth;
      raf(() => {
        card.style.transform = rest(depthSlot);
        card.style.opacity = position > maxSlot ? "0" : "1";
      });
    });
    setTimeout(() => {
      cards.forEach((card) => card.style.removeProperty("transition"));
      apply(); updatePosition(); busy = false;
      if (queue.length) run(queue.shift());
    }, duration + maxSlot * stagger + 40);
  };
  cards.forEach((card, index) => card.addEventListener("click", () => {
    if (order[0] !== index && order.indexOf(index) <= maxSlot) goTo(index);
  }));
  next.addEventListener("click", () => shuffle("next"));
  previous?.addEventListener("click", () => shuffle("prev"));
  deck.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); shuffle("next"); }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); shuffle("prev"); }
  });
  new ResizeObserver(() => { fitReadSections(); layout(); if (!busy) apply(); }).observe(deck);
  fitReadSections(); layout(); apply(); updatePosition(); updateMotionControl(); playDeckIntro();
}

async function describeRetentionReports(reports) {
  const evidence = reports.map((report, index) => {
    const f = report.findings;
    if (!f) return { index, title: report.profile.title, support: report.profile.summary, chart: false };
    return { index, title: report.profile.title, segment: report.series?.label || "overall", rows: f.rows_read, axis: f.axis, opening: f.hook_leak ? { loss_points: f.hook_leak.loss_points, start_pct: f.hook_leak.start_retention_pct, end_pct: f.hook_leak.minimum_early_retention_pct, window: f.hook_leak.window } : null, largest_cliffs: (f.cliffs || []).slice(0, 3).map((c) => ({ from: c.from, to: c.to, drop_points: c.drop_points })) };
  });
  try {
    const response = await llm("Write one concise, distinct, plain-language interpretation (max 35 words) per supplied retention chart. Use only supplied measurements. Distinguish audience segments and do not infer causes or advice. Return ONLY a JSON array with one string per input item in matching order.", JSON.stringify(evidence), 1200);
    const parsed = JSON.parse(response.match(/\[[\s\S]*\]/)?.[0] || "null");
    if (!Array.isArray(parsed)) throw new Error("Anna returned no chart descriptions.");
    reports.forEach((report, index) => { if (report.findings) report.shortDescription = conciseRetentionRead(parsed[index]); });
  } catch (error) {
    reports.forEach((report) => { if (report.findings) report.shortDescription = `Anna's chart description is unavailable (${String(error.message || error).slice(0, 120)}).`; });
  }
  return reports;
}

async function saveRetentionRecord(record) {
  const entry = { ...record, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: new Date().toISOString() };
  retentionHistory = [entry, ...retentionHistory.filter((item) => item.title !== entry.title || item.kind !== entry.kind)].slice(0, 12);
  await storageSet(RETENTION_KEY, retentionHistory);
  renderRetentionHistory();
}

function renderRetentionHistory() {
  const count = retentionHistory.length;
  for (const id of ["ret-history-count", "ret-cache-count"]) if (byId(id)) byId(id).textContent = String(count);
  const items = count ? retentionHistory.map((entry, index) => `<article class="ret-history-item"><div><strong>${escapeHtml(entry.title)}</strong><span>${entry.kind === "bundle" ? "ZIP · " + (entry.reports?.length || 0) + " CSV analyses" : "CSV · single analysis"} · ${escapeHtml(new Date(entry.savedAt).toLocaleDateString())}</span></div><button class="btn btn-small" data-open-retention="${index}" type="button">Open</button></article>`).join("") : '<div class="empty-state"><strong>No saved analyses yet.</strong><span>Analyze a CSV or ZIP and it will appear here.</span></div>';
  for (const id of ["ret-history-list", "ret-cache-list"]) if (byId(id)) byId(id).innerHTML = items;
}

async function openRetentionRecord(index) {
  const record = retentionHistory[index];
  if (!record) return;
  retentionTitle = record.title;
  const output = byId("ret-output");
  output.classList.remove("hidden");
  if (record.kind === "bundle" && record.reports?.some((report) => report.findings && !report.shortDescription)) {
    output.innerHTML = '<div class="skeleton-stack"><span class="skeleton skeleton-wide"></span><span class="skeleton"></span></div>';
    await describeRetentionReports(record.reports);
    try { await storageSet(RETENTION_KEY, retentionHistory); } catch (_) { /* Keep the descriptions in this open session if cache storage is unavailable. */ }
  }
  output.innerHTML = record.kind === "bundle" ? renderRetentionBundle(record.reports, record.title) : renderRetentionReport(record.findings, record.recommendation, record.title);
  if (record.kind === "bundle") wireRetentionBundleDeck(); else wireRetentionCarousel();
  setRetentionView("analyze");
}

function setRetentionView(view) {
  $$("[data-ret-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.retView === view));
  $$(".retention-subview").forEach((panel) => panel.classList.toggle("is-active", panel.id === `ret-view-${view}`));
}

function wireRetentionHistory() {
  $$("[data-ret-view]").forEach((button) => button.addEventListener("click", () => setRetentionView(button.dataset.retView)));
  ["ret-history-list", "ret-cache-list"].forEach((id) => byId(id)?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-retention]");
    if (button) openRetentionRecord(Number(button.dataset.openRetention));
  }));
}

function wireRetentionCarousel() {
  const next = byId('ret-next');
  if (!next) return;
  next.addEventListener('click', () => {
    const cards = $$('.ret-card');
    const dots = $$('.ret-dot');
    if (!cards.length) return;
    cards[retentionCardIndex].classList.remove('is-active');
    dots[retentionCardIndex]?.classList.remove('is-active');
    retentionCardIndex = (retentionCardIndex + 1) % cards.length;
    cards[retentionCardIndex].classList.add('is-active');
    dots[retentionCardIndex]?.classList.add('is-active');
  });
}

function wireRetention() {
  const file = byId('ret-file');
  const entrySelect = byId('ret-file-entry');
  const dropzone = byId('ret-dropzone');
  dropzone.addEventListener('click', (event) => {
    if (event.target === file || event.target.closest('button,a')) return;
    file.click();
  });
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); file.click(); }
  });
  const loadFile = async (selected) => {
    if (!selected) return;
    try {
      retentionTitle = selected.name.replace(/\.(zip|csv)$/i, '').replace(/[_-]+/g, ' ');
      if (/\.zip$/i.test(selected.name)) {
        retentionZipEntries = await readZipCsvEntries(selected);
        if (!retentionZipEntries.length) throw new Error('No readable CSV files were found inside this ZIP.');
        entrySelect.innerHTML = retentionZipEntries.map((entry, index) => `<option value="${index}">${escapeHtml(entry.name)}</option>`).join('');
        byId('ret-file-entry-wrap').classList.remove('hidden');
        byId('ret-csv').value = retentionZipEntries[0].text;
      } else {
        retentionZipEntries = [];
        byId('ret-file-entry-wrap').classList.add('hidden');
        byId('ret-csv').value = await selected.text();
      }
      dropzone.classList.add('has-file');
      dropzone.querySelector('strong').textContent = selected.name;
    } catch (error) {
      byId('ret-output').classList.remove('hidden');
      byId('ret-output').innerHTML = `<div class="note err"><b>Could not read export</b><span>${escapeHtml(String(error.message || error))}</span></div>`;
    }
  };
  file.addEventListener('change', () => loadFile(file.files && file.files[0]));
  entrySelect.addEventListener('change', () => {
    const entry = retentionZipEntries[Number(entrySelect.value)];
    if (entry) byId('ret-csv').value = entry.text;
  });
  ['dragenter', 'dragover'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove('is-dragging'); }));
  dropzone.addEventListener('drop', (event) => loadFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]));
  byId("ret-analyze").addEventListener("click", async () => {
    const csvText = byId("ret-csv").value.trim();
    const duration = byId("ret-duration").value.trim();
    const output = byId("ret-output");
    const button = byId("ret-analyze");
    if (!csvText) {
      output.classList.remove("hidden");
      output.textContent = "Paste a YouTube Studio audience-retention CSV first.";
      return;
    }
    button.disabled = true;
    output.classList.remove("hidden");
    output.innerHTML = '<div class="skeleton-stack"><span class="skeleton skeleton-wide"></span><span class="skeleton"></span><span class="skeleton skeleton-short"></span></div>';
    try {
      const findings = await tool("retention", { csv: csvText, duration: duration || undefined });
      if (!findings || findings.error) {
        const detail = findings && findings.error ? findings.error : "The retention engine returned no findings.";
        const columns = findings && findings.columns ? "\nColumns found: " + findings.columns.join(", ") : "";
        throw new Error(detail + columns);
      }
      const measured = JSON.stringify(findings, null, 2);
      let recommendation = "No AI recommendation generated. The measured findings are shown above.";
      try {
        recommendation = await llm(
          RETENTION_SYSTEM,
          "Measured retention analysis (do not recalculate):\n" + measured + "\n\nExplain the findings and give no more than one evidence-linked recommendation.",
          1800
        );
      } catch (llmError) {
        recommendation = "Host LLM unavailable: " + (llmError.message || llmError)
          + ". Use the measured findings above; no recommendation was fabricated.";
      }
      output.innerHTML = renderRetentionReport(findings, recommendation, retentionTitle);
      await saveRetentionRecord({ kind: "single", title: retentionTitle, findings, recommendation });
      wireRetentionCarousel();
    } catch (error) {
      output.innerHTML = '<div class="note err"><b>Retention analysis failed</b><span>' + escapeHtml(String(error.message || error)) + '</span></div>';
    } finally {
      button.disabled = false;
    }
  });
  byId("ret-analyze-all")?.addEventListener("click", async () => {
    const output = byId("ret-output");
    const duration = byId("ret-duration").value.trim();
    if (!retentionZipEntries.length) {
      output.classList.remove("hidden");
      output.innerHTML = '<div class="note warn"><b>Upload a ZIP first</b><span>This action analyzes every CSV in the selected YouTube Studio export.</span></div>';
      return;
    }
    const button = byId("ret-analyze-all");
    button.disabled = true;
    output.classList.remove("hidden");
    output.innerHTML = '<div class="skeleton-stack"><span class="skeleton skeleton-wide"></span><span class="skeleton"></span><span class="skeleton skeleton-short"></span></div>';
    try {
      const reports = await analyzeRetentionEntries(retentionZipEntries, duration);
      await describeRetentionReports(reports);
      output.innerHTML = renderRetentionBundle(reports, retentionTitle);
      await saveRetentionRecord({ kind: "bundle", title: retentionTitle, reports });
      wireRetentionBundleDeck();
    } catch (error) {
      output.innerHTML = `<div class="note err"><b>Bundle analysis failed</b><span>${escapeHtml(String(error.message || error))}</span></div>`;
    } finally {
      button.disabled = false;
    }
  });
}

/* ---------- boot ---------- */
async function main() {
  wireTabs();
  wireRail();
  wireChat();
  wireExplorer();
  wireStudio();
  wireLab();
  wireRetention();
  wireRetentionHistory();
  // Render local workspace state and onboarding immediately. The Anna host
  // handshake can take time (or remain pending); it must never block the UI.
  const hostConnection = connect();
  await loadWorkspaceState();
  const ok = await hostConnection;
  // Once the host is available, hydrate the authoritative APS-backed state.
  if (ok) await loadWorkspaceState();
  byId("audit-run").addEventListener("click", () => runAudit(byId("audit-handle").value));
  byId("audit-handle").addEventListener("keydown", (e) => { if (e.key === "Enter") runAudit(byId("audit-handle").value); });
  $$(".chip[data-handle]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const input = byId("audit-handle");
      input.value = chip.dataset.handle;
      input.focus();
    });
  });
  await renderSavedList();
  if (anna && anna.window) {
    try { await anna.window.set_title({ title: "YouTube Skillbox" }); } catch (_) {}
    // AnnaAppRuntime.connect() already emits window.ready after the handshake.
  }
  if (!ok) setStatus("Standalone preview — open via `anna-app dev` for the real host.", false, true);
}

main().catch((e) => setStatus(`Fatal: ${e.message || e}`, false));
