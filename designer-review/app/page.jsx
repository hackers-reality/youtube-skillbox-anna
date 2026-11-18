"use client";

import { useEffect, useRef, useState } from "react";

const DEMO_PROFILE = {
  name: "Northstar Science Lab",
  handle: "@northstarscience",
  avatar_url: "/skillbox/assets/skillbox-mark.svg",
  banner_url: "/skillbox/assets/skillbox-lockup-on-dark.svg",
  description: "Curious science, clearly explained. New space and nature stories every week.",
  subscribers: 28400,
  video_count: 126,
  tags: ["science", "space", "education"],
};

const DEMO_CHAT = [
  ["user", "Which part of my channel should I focus on next?"],
  ["assistant", `### SAMPLE DESIGN CONTENT · NOT LIVE AI

**MEASURED**
- Your sample workspace has 126 public uploads.
- Space explainers are a visible part of this demo channel.

**A useful next step**
Compare the first 30 seconds of a recent upload with its audience-retention export. This preview uses fictional sample content and does not fetch YouTube data.`],
];

export default function DesignerReview() {
  const [ready, setReady] = useState(false);
  const frame = useRef(null);

  useEffect(() => { seedPreview(); }, []);

  const seedPreview = () => {
    try {
      localStorage.setItem("youtube-skillbox:profile", JSON.stringify([{
        handle: DEMO_PROFILE.handle,
        phrase: "Preview workspace only",
        profile: DEMO_PROFILE,
        verified: true,
        confirmed: true,
        restorationShown: true,
        originalDescription: DEMO_PROFILE.description,
      }]));
      localStorage.setItem("youtube-skillbox:guest", JSON.stringify([false]));
      localStorage.setItem("youtube-skillbox:chat", JSON.stringify([]));
      localStorage.setItem("youtube-skillbox:theme", "dark");
      setReady(true);
    } catch { setReady(false); }
  };

  const installSampleConversation = () => {
    const doc = frame.current?.contentDocument;
    const thread = doc?.getElementById("chat-thread");
    if (!thread) return false;
    thread.replaceChildren();
    for (const [role, text] of DEMO_CHAT) {
      const row = doc.createElement("div");
      row.className = `chat-message ${role}`;
      const avatar = doc.createElement("span");
      avatar.className = "chat-avatar";
      avatar.textContent = role === "assistant" ? "A" : "Y";
      const body = doc.createElement("div");
      body.className = "chat-message-body";
      const name = doc.createElement("strong");
      name.textContent = role === "assistant" ? "Anna · preview sample" : "You";
      const prose = doc.createElement("div");
      prose.className = "chat-prose";
      if (role === "assistant") {
        const heading = doc.createElement("h3");
        heading.textContent = "SAMPLE DESIGN CONTENT · NOT LIVE AI";
        const measured = doc.createElement("p");
        const label = doc.createElement("strong");
        label.textContent = "MEASURED";
        measured.append(label);
        const list = doc.createElement("ul");
        for (const item of ["Your sample workspace has 126 public uploads.", "Space explainers are a visible part of this demo channel."]) {
          const li = doc.createElement("li");
          li.textContent = item;
          list.append(li);
        }
        const next = doc.createElement("p");
        const nextLabel = doc.createElement("strong");
        nextLabel.textContent = "A useful next step";
        next.append(nextLabel, doc.createElement("br"), doc.createTextNode("Compare the first 30 seconds of a recent upload with its audience-retention export. This preview uses fictional sample content and does not fetch YouTube data."));
        prose.append(heading, measured, list, next);
      } else {
        const paragraph = doc.createElement("p");
        paragraph.textContent = text;
        prose.append(paragraph);
      }
      body.append(name, prose);
      row.append(avatar, body);
      thread.append(row);
    }
    return true;
  };

  const showChatSample = () => {
    const doc = frame.current?.contentDocument;
    doc?.getElementById("tab-button-chat")?.click();
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (installSampleConversation() || attempts > 20) window.clearInterval(timer);
    }, 100);
  };

  return <main className="review-shell">
    <header className="review-bar">
      <div className="review-brand"><span className="brand-mark">S</span><span><strong>Skillbox</strong><small>DESIGN REVIEW</small></span></div>
      <div className="review-note"><span className="status-dot" /> Sample workspace · no Anna login · no live channel data or AI</div>
      <button className="review-action" onClick={showChatSample} disabled={!ready}>View chat sample <span aria-hidden="true">↗</span></button>
    </header>
    <section className="review-frame-wrap" aria-label="YouTube Skillbox design preview">
      {!ready && <div className="review-loading">Preparing a private, fictional sample workspace…</div>}
      {ready && <iframe ref={frame} title="YouTube Skillbox sample design preview" src="/skillbox/index.html?design-review=1" onLoad={() => { window.setTimeout(() => { installSampleConversation(); setReady(true); }, 1200); }} />}
    </section>
    <footer className="review-footer">DESIGN PREVIEW ONLY <span>·</span> Sample names and metrics are fictional <span>·</span> Buttons requiring Anna OS are not connected</footer>
    {!ready && <button className="review-prepare" onClick={seedPreview}>Prepare preview</button>}
  </main>;
}
