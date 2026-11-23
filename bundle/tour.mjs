export const TOUR_STEPS = [
  { tab:"chat", title:"Start with a question", icon:"✦", copy:"Ask Anna what to research, create or improve. Your verified creator profile supplies personal context; guest questions still work without a channel.", action:"Try Ask Anna", prompt:"Help me choose the right Skillbox workflow for my next video." },
  { tab:"audit", title:"Understand a channel", icon:"◎", copy:"Enter a public @handle and run an audit. Browse videos, Shorts and home shelves. MEASURED means returned evidence; missing measurements can be retried without losing the successful ones.", action:"Open Audit" },
  { tab:"studio", title:"Turn an idea into a draft", icon:"✎", copy:"Add a video idea and any research or transcript to Context. Start with Creative brief, then write hooks, titles or a script. Save each useful version to Workspace; nothing is published automatically.", action:"Open Content Studio" },
  { tab:"retention", title:"Find where viewers leave", icon:"↘", copy:"Upload a real YouTube Studio CSV or ZIP. Analyze it, then use next/back to read the curves. Findings come from your export; creative fixes are recommendations, not proven causes.", action:"Open Retention Fix" },
  { tab:"analytics", title:"Connect private evidence", icon:"▥", copy:"Google authorization is separate from public channel verification. Connect the Google/Brand account that owns your channel, choose an authorized channel and a past date range, then run a read-only Analytics report.", action:"Open Google & Analytics" },
  { tab:"workspace", title:"Keep the work moving", icon:"▦", copy:"Saved drafts live here. Link them to calendar plans and Kanban tasks, drag to reschedule or move stages, and export your work. Calendar entries are plans—not automatic YouTube publishing.", action:"Open Workspace" }
];
const KEY = "youtube-skillbox:tour-v1";
export function mountTour(root = document) {
  const byId = (id) => root.getElementById(id);
  const dialog = byId("tour-dialog");
  let index = 0;
  let attempted = false;
  let observer = null;
  const done = () => { try { localStorage.setItem(KEY, "seen"); } catch {} dialog.close(); root.querySelectorAll(".tour-target").forEach((node) => node.classList.remove("tour-target")); };
  const render = () => {
    const step = TOUR_STEPS[index];
    byId("tour-title").textContent = step.title;
    byId("tour-copy").textContent = step.copy;
    byId("tour-icon").textContent = step.icon;
    byId("tour-count").textContent = `${index + 1} / ${TOUR_STEPS.length}`;
    byId("tour-open-section").textContent = step.action;
    byId("tour-back").disabled = index === 0;
    byId("tour-next").textContent = index === TOUR_STEPS.length - 1 ? "Finish tour" : "Next";
    root.querySelectorAll(".tour-target").forEach((node) => node.classList.remove("tour-target"));
    byId("tab-button-" + step.tab).classList.add("tour-target");
    byId("tour-progress").style.width = ((index + 1) / TOUR_STEPS.length * 100) + "%";
    byId("tour-visual").classList.remove("tour-enter");
    void byId("tour-visual").offsetWidth;
    byId("tour-visual").classList.add("tour-enter");
  };
  const open = () => { index = 0; render(); if (!dialog.open) dialog.showModal(); };
  byId("tour-start").addEventListener("click", open);
  byId("tour-close").addEventListener("click", done);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); done(); });
  byId("tour-back").addEventListener("click", () => { index = Math.max(0, index - 1); render(); });
  byId("tour-next").addEventListener("click", () => { if (index === TOUR_STEPS.length - 1) done(); else { index++; render(); } });
  byId("tour-open-section").addEventListener("click", () => {
    const step = TOUR_STEPS[index]; done(); byId("tab-button-" + step.tab).click();
    if (step.prompt) { byId("chat-input").value = step.prompt; byId("chat-input").focus(); }
  });
  return {
    defer() {
      attempted = true;
      observer?.disconnect();
      try { localStorage.setItem(KEY, "offered"); } catch {}
    },
    maybeStart() {
      let seen = false; try { seen = !!localStorage.getItem(KEY); } catch {}
      if (seen || attempted) return;
      attempted = true;
      const onboarding = byId("onboarding-modal");
      const start = () => { if (onboarding.classList.contains("hidden") && !byId("google-dialog").open && !byId("workspace-dialog").open) { observer.disconnect(); open(); } };
      observer = new MutationObserver(start);
      observer.observe(onboarding, { attributes:true, attributeFilter:["class"] });
      start();
    }
  };
}
