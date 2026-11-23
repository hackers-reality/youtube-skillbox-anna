/* Creator workspace. Public channel context never grants YouTube authorization. */
export const WORKSPACE_KEYS = Object.freeze({
  projects: "youtube-skillbox:workspace-projects",
  tasks: "youtube-skillbox:workspace-tasks",
  channels: "youtube-skillbox:workspace-channels",
  calendar: "youtube-skillbox:workspace-calendar",
  settings: "youtube-skillbox:workspace-settings"
});
export const TASK_STAGES = ["backlog", "research", "production", "review", "ready", "published"];
const DEFAULT_SETTINGS = { retentionDays: 365 };
const html = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const id = () => globalThis.crypto.randomUUID();

export function csvCell(value) {
  let text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  // Spreadsheet formula injection protection (including leading whitespace).
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function exportRows(state) {
  const rows = [];
  for (const kind of ["projects", "tasks", "channels", "calendar"]) {
    for (const item of state[kind]) {
      // Whitelist fields; do not export credentials or legacy OAuth payloads.
      rows.push({ kind, id: item.id, title: item.title || item.name || item.handle,
        channel: item.channel || item.handle || "", type: item.type || "",
        status: item.status || "", date: item.date || item.savedAt || "",
        projectId: item.projectId || "", content: item.content || "" });
    }
  }
  return rows;
}

export function workspaceCSV(state) {
  const headers = ["kind", "id", "title", "channel", "type", "status", "date", "projectId", "content"];
  return [headers.map(csvCell).join(","), ...exportRows(state).map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\r\n");
}

export function createWorkspaceStore({ get, set }) {
  let state = { projects: [], tasks: [], channels: [], calendar: [], settings: { ...DEFAULT_SETTINGS } };
  let writes = Promise.resolve();
  const persist = (kind, value) => {
    const operation = writes.then(async () => {
      const next = typeof value === "function" ? value(state[kind]) : value;
      await set(WORKSPACE_KEYS[kind], kind === "settings" ? [next] : next);
      state[kind] = next;
    });
    writes = operation.catch(() => {});
    return operation;
  };
  return {
    get state() { return state; },
    async load() {
      await writes;
      const values = await Promise.all(Object.values(WORKSPACE_KEYS).map(get));
      const next = {};
      Object.keys(WORKSPACE_KEYS).forEach((key, index) => { next[key] = Array.isArray(values[index]) ? values[index] : []; });
      next.settings = { retentionDays: Number(next.settings[0]?.retentionDays) || DEFAULT_SETTINGS.retentionDays };
      state = next;
      return state;
    },
    async add(kind, item) {
      if (!WORKSPACE_KEYS[kind] || kind === "settings") throw new Error("Unknown workspace collection");
      const entry = { ...item, id: id(), savedAt: new Date().toISOString() };
      await persist(kind, (items) => [...items, entry]);
      return entry;
    },
    async update(kind, entryId, changes) {
      await persist(kind, (items) => items.map((item) => item.id === entryId ? { ...item, ...changes, id: item.id } : item));
    },
    async remove(kind, entryId) { await persist(kind, (items) => items.filter((item) => item.id !== entryId)); },
    async settings(retentionDays) {
      if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("Choose 1–3650 days");
      await persist("settings", { retentionDays });
    },
    expired(now = Date.now()) {
      const cutoff = now - state.settings.retentionDays * 86400000;
      return state.projects.filter((item) => Date.parse(item.savedAt) < cutoff);
    },
    async deleteExpired() {
      const expired = new Set(this.expired().map((item) => item.id));
      await persist("projects", (items) => items.filter((item) => !expired.has(item.id)));
    },
    async clear() {
      // Deliberately exclude verified profile, chat, audit history and authorization.
      for (const key of ["projects", "tasks", "channels", "calendar"]) await persist(key, []);
      await persist("settings", { ...DEFAULT_SETTINGS });
    }
  };
}

export function mountWorkspace({ root = document, get, set, channel, selectChannel, studioOutput, auditOutput, analyticsOutput, openProject }) {
  const store = createWorkspaceStore({ get, set });
  const byId = (key) => root.getElementById(key);
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let loaded = false;
  const status = (message) => { byId("workspace-status").textContent = message; };
  const guard = (operation) => async (event) => {
    if (event?.type === "drop") event.preventDefault();
    if (!loaded) return status("Workspace is still loading; no data was changed.");
    const button = event?.currentTarget;
    if (button?.tagName === "BUTTON") button.disabled = true;
    try { await operation(event); render(); }
    catch (error) { status("Workspace action failed: " + String(error.message || error)); }
    finally { if (button?.tagName === "BUTTON") button.disabled = false; }
  };
  const dialog = byId("workspace-dialog");
  function editor(title, fields, onSave, dangerous = false) {
    byId("workspace-dialog-title").textContent = title;
    byId("workspace-dialog-fields").innerHTML = fields;
    byId("workspace-dialog-error").textContent = "";
    const save = byId("workspace-dialog-save");
    save.textContent = dangerous ? "Delete" : "Save";
    save.classList.toggle("btn-danger", dangerous);
    byId("workspace-dialog-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      save.disabled = true;
      try { await onSave(form); dialog.close(); render(); }
      catch (error) { byId("workspace-dialog-error").textContent = String(error.message || error); }
      finally { save.disabled = false; }
    };
    dialog.showModal();
  }
  byId("workspace-dialog-cancel").addEventListener("click", () => dialog.close());
  const input = (label, name, value = "", type = "text", required = false) => `<label class="field"><span>${html(label)}</span><input name="${name}" type="${type}" value="${html(value)}" ${required ? "required" : ""} /></label>`;
  const projectOptions = (selected = "") => `<option value="">No linked project</option>` + store.state.projects.map((p) => `<option value="${html(p.id)}" ${p.id === selected ? "selected" : ""}>${html(p.title)}</option>`).join("");
  const linkField = (selected) => `<label class="field"><span>Linked project</span><select name="projectId">${projectOptions(selected)}</select></label>`;
  function taskEditor(task = {}) {
    editor(task.id ? "Edit task" : "Add task", input("Task title", "title", task.title, "text", true) + linkField(task.projectId) + `<label class="field"><span>Stage</span><select name="status">${TASK_STAGES.map((stage) => `<option ${stage === task.status ? "selected" : ""}>${stage}</option>`).join("")}</select></label>`, async (data) => {
      const entry = { title: data.get("title").trim(), status: data.get("status"), projectId: data.get("projectId"), channel: task.channel || channel() || "" };
      if (!entry.title) throw new Error("Enter a task title");
      if (task.id) await store.update("tasks", task.id, entry); else await store.add("tasks", entry);
      status("Task saved.");
    });
  }
  function eventEditor(item = {}) {
    editor(item.id ? "Reschedule content" : "Plan content", input("Content title", "title", item.title, "text", true) + input("Planned date", "date", item.date, "date", true) + linkField(item.projectId), async (data) => {
      const entry = { title: data.get("title").trim(), date: data.get("date"), projectId: data.get("projectId"), channel: item.channel || channel() || "" };
      if (!entry.title || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) throw new Error("Enter a title and date");
      if (item.id) await store.update("calendar", item.id, entry); else await store.add("calendar", entry);
      status("Content plan saved. Nothing was published on YouTube.");
    });
  }
  function confirmDelete(kind, item) {
    editor("Delete " + item.title, '<p>This removes this item only. Linked tasks and plans are kept.</p>' + input("Type DELETE to confirm", "confirmation", "", "text", true), async (data) => {
      if (data.get("confirmation") !== "DELETE") throw new Error("Type DELETE exactly");
      await store.remove(kind, item.id); status("Item deleted.");
    }, true);
  }
  function render() {
    const state = store.state;
    byId("workspace-projects").innerHTML = state.projects.length ? state.projects.map((p) => `<article class="workspace-item"><strong>${html(p.title || "Untitled")}</strong><span class="ev ev-hypothesis">${html(p.type || "draft")}</span><p class="hint">${html(p.channel || "Guest")} · ${html(p.savedAt)}</p><div class="workspace-actions"><button class="btn btn-small" data-project-open="${html(p.id)}">Open</button><button class="btn btn-small" data-project-copy="${html(p.id)}">Duplicate</button><button class="btn btn-small" data-project-export="${html(p.id)}">Export</button><button class="btn btn-small btn-danger" data-project-delete="${html(p.id)}">Delete</button></div></article>`).join("") : '<div class="empty-state"><strong>No saved projects yet.</strong><span>Save an output from Content Studio, Audit or Analytics.</span></div>';
    for (const stage of TASK_STAGES) {
      const column = root.querySelector(`.kanban-column[data-status="${stage}"]`);
      const tasks = state.tasks.filter((task) => task.status === stage);
      column.querySelector(".task-count").textContent = String(tasks.length);
      column.querySelector(".kanban-tasks").innerHTML = tasks.map((t) => `<article class="workspace-task" role="listitem" draggable="true" data-task-id="${html(t.id)}"><strong>${html(t.title)}</strong><p class="hint">${html(state.projects.find((p) => p.id === t.projectId)?.title || "No linked project")}</p><button class="btn btn-small" data-task-edit="${html(t.id)}">Edit / move</button><button class="btn btn-small btn-danger" data-task-delete="${html(t.id)}">Delete</button></article>`).join("");
    }
    byId("cal-title").textContent = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    let cells = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div role="columnheader">${day}</div>`).join("");
    cells += "<div aria-hidden=\"true\"></div>".repeat(month.getDay());
    for (let day = 1; day <= days; day++) {
      const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cells += `<div class="calendar-day" data-calendar-date="${date}"><button class="calendar-add" data-calendar-add="${date}" aria-label="Plan content for ${date}">${day}</button>${state.calendar.filter((item) => item.date === date).map((item) => `<div class="calendar-entry" draggable="true" data-event-id="${html(item.id)}"><button data-event-edit="${html(item.id)}">${html(item.title)}</button><button data-event-delete="${html(item.id)}" aria-label="Delete ${html(item.title)}">×</button></div>`).join("")}</div>`;
    }
    byId("cal-grid").innerHTML = cells;
    byId("channel-workspace-list").innerHTML = state.channels.length ? state.channels.map((c) => `<article class="workspace-item"><strong>${html(c.handle)}</strong><p class="hint">Public research context only · no private Analytics authorization</p><button class="btn btn-small" data-channel-select="${html(c.id)}">Use for public research</button><button class="btn btn-small btn-danger" data-channel-delete="${html(c.id)}">Remove</button></article>`).join("") : '<div class="empty-state"><strong>No public channel contexts saved.</strong><span>Add a handle for research. This does not verify ownership or grant OAuth access.</span></div>';
  }
  function download(content, filename, mime = "text/plain;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = root.createElement("a"); a.href = url; a.download = filename; root.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveOutput(type, output) {
    if (!output?.content?.trim()) return status("Generate an output before saving it.");
    await store.add("projects", { ...output, type, channel: channel() || "", title: output.title || type + " draft" });
    status("Saved a new immutable version to Workspace.");
  }
  byId("studio-save").addEventListener("click", guard(() => saveOutput("draft", studioOutput())));
  byId("audit-save-project").addEventListener("click", guard(() => saveOutput("audit", auditOutput())));
  byId("analytics-save-project").addEventListener("click", guard(() => saveOutput("report", analyticsOutput())));
  byId("workspace-add-channel").addEventListener("click", guard(() => editor("Add public research context", input("Exact YouTube @handle", "handle", "", "text", true), async (data) => {
    const handle = data.get("handle").trim();
    if (!/^@[\p{L}\p{N}_.-]+$/u.test(handle)) throw new Error("Enter an exact @handle");
    if (store.state.channels.some((c) => c.handle.toLowerCase() === handle.toLowerCase())) throw new Error("This context is already saved");
    await store.add("channels", { handle }); status("Public context saved. Authorization was not changed.");
  })));
  byId("export-workspace").addEventListener("click", guard(() => {
    download(JSON.stringify({ schemaVersion: 1, records: exportRows(store.state), settings: store.state.settings, exportedAt: new Date().toISOString() }, null, 2), "workspace.json", "application/json");
    status("Workspace exported; account credentials and the verified profile are excluded.");
  }));
  byId("export-workspace-csv").addEventListener("click", guard(() => { download(workspaceCSV(store.state), "workspace.csv", "text/csv;charset=utf-8"); status("Workspace CSV exported."); }));
  byId("retention-settings").addEventListener("click", guard(() => editor("Workspace retention", '<p>Retention is manual: review the policy, then explicitly delete expired saved project versions. No automatic data deletion.</p>' + input("Keep saved versions for days (1–3650)", "days", store.state.settings.retentionDays, "number", true), async (data) => { await store.settings(Number(data.get("days"))); status("Retention policy saved; no data deleted."); })));
  byId("workspace-delete-expired").addEventListener("click", guard(() => editor("Delete expired project versions", `<p>${store.expired().length} saved versions are older than ${store.state.settings.retentionDays} days. Tasks, calendar, profile and credentials are kept.</p>` + input("Type DELETE to confirm", "confirmation", "", "text", true), async (data) => { if (data.get("confirmation") !== "DELETE") throw new Error("Type DELETE exactly"); await store.deleteExpired(); status("Expired versions deleted."); }, true)));
  byId("delete-workspace").addEventListener("click", guard(() => editor("Delete Creator Workspace", '<p>Deletes saved project versions, tasks, calendar plans, public research contexts and retention settings only. Verified profile, original description, audit history, chat and account authorization are kept.</p>' + input("Type DELETE to confirm", "confirmation", "", "text", true), async (data) => { if (data.get("confirmation") !== "DELETE") throw new Error("Type DELETE exactly"); await store.clear(); status("Creator Workspace deleted; verified profile and authorization preserved."); }, true)));
  byId("cal-prev").addEventListener("click", () => { month.setMonth(month.getMonth() - 1); render(); });
  byId("cal-next").addEventListener("click", () => { month.setMonth(month.getMonth() + 1); render(); });
  root.querySelectorAll(".add-task-btn").forEach((button) => button.addEventListener("click", guard(() => taskEditor({ status: button.dataset.status }))));
  byId("tab-workspace").addEventListener("click", guard(async (event) => {
    const b = event.target.closest("button"); if (!b) return;
    const find = (kind, key) => store.state[kind].find((item) => item.id === b.dataset[key]);
    const project = find("projects", "projectOpen");
    if (project) {
      editor("Saved version: " + project.title, '<pre class="workspace-preview"></pre>', async () => {});
      byId("workspace-dialog-fields").querySelector("pre").textContent = project.content || "";
      openProject(project);
    }
    const copy = find("projects", "projectCopy");
    if (copy) { await store.add("projects", { ...copy, title: (copy.title || "Untitled") + " (copy)" }); status("Project duplicated."); }
    const exported = find("projects", "projectExport");
    if (exported) download(exported.content || "", "project.txt");
    for (const [kind, key] of [["projects", "projectDelete"], ["tasks", "taskDelete"], ["calendar", "eventDelete"], ["channels", "channelDelete"]]) {
      const item = find(kind, key); if (item) confirmDelete(kind, { ...item, title: item.title || item.handle });
    }
    const task = find("tasks", "taskEdit"); if (task) taskEditor(task);
    const item = find("calendar", "eventEdit"); if (item) eventEditor(item);
    if (b.dataset.calendarAdd) eventEditor({ date: b.dataset.calendarAdd });
    const context = find("channels", "channelSelect"); if (context) { selectChannel(context.handle); status("Public research context selected: " + context.handle + ". Personal profile and authorization unchanged."); }
  }));
  byId("tab-workspace").addEventListener("dragstart", (event) => {
    const item = event.target.closest("[data-task-id],[data-event-id]");
    if (item) event.dataTransfer.setData("text/plain", JSON.stringify(item.dataset));
  });
  byId("tab-workspace").addEventListener("dragover", (event) => { if (event.target.closest(".kanban-column,.calendar-day")) event.preventDefault(); });
  byId("tab-workspace").addEventListener("drop", guard(async (event) => {
    let data; try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch (_) { return; }
    const stage = event.target.closest(".kanban-column")?.dataset.status;
    const date = event.target.closest(".calendar-day")?.dataset.calendarDate;
    if (data.taskId && TASK_STAGES.includes(stage)) await store.update("tasks", data.taskId, { status: stage });
    if (data.eventId && date) await store.update("calendar", data.eventId, { date });
    status("Workspace item moved. Nothing was published on YouTube.");
  }));
  return {
    store,
    async reload() {
      loaded = false;
      try { await store.load(); loaded = true; render(); status("Workspace loaded. Calendar dates are plans, not automatic publishing."); }
      catch (error) { status("Could not load workspace; editing disabled to protect saved data. " + String(error.message || error)); }
    }
  };
}
