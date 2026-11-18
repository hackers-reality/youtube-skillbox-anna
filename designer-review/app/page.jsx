"use client";

import { useEffect, useRef, useState } from "react";

export default function DesignerReview() {
  const [ready, setReady] = useState(false);
  const [llmStatus, setLlmStatus] = useState("Checking NVIDIA connection…");
  const frame = useRef(null);

  useEffect(() => {
    try {
      // Start clean: no fictional creator identity or scripted conversation.
      localStorage.setItem("youtube-skillbox:profile", "[]");
      localStorage.setItem("youtube-skillbox:guest", "[true]");
      localStorage.setItem("youtube-skillbox:chat", "[]");
      localStorage.setItem("youtube-skillbox:theme", "dark");
      setReady(true);
    } catch { setReady(false); }

    fetch("/api/nvidia/chat", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setLlmStatus(data.configured ? "Live NVIDIA LLM connected" : "Add NVIDIA_API_KEY in Vercel to enable live chat"))
      .catch(() => setLlmStatus("NVIDIA connection status unavailable"));
  }, []);

  const showChat = () => frame.current?.contentDocument?.getElementById("tab-button-chat")?.click();

  return <main className="review-shell">
    <header className="review-bar">
      <div className="review-brand"><span className="brand-mark">S</span><span><strong>Skillbox</strong><small>PRIVATE DESIGN REVIEW</small></span></div>
      <div className="review-note"><span className={`status-dot${llmStatus.startsWith("Live") ? "" : " is-pending"}`} /> {llmStatus}</div>
      <button className="review-action" onClick={showChat} disabled={!ready}>Open live chat <span aria-hidden="true">↗</span></button>
    </header>
    <section className="review-frame-wrap" aria-label="YouTube Skillbox private design preview">
      {!ready && <div className="review-loading">Preparing your workspace…</div>}
      {ready && <iframe ref={frame} title="YouTube Skillbox live design preview" src="/skillbox/index.html?design-review=1" onLoad={() => setReady(true)} />}
    </section>
    <footer className="review-footer">PRIVATE VERCEL PREVIEW <span>·</span> NVIDIA AI calls stay server-side <span>·</span> Live YouTube research runs on the Skillbox engine</footer>
  </main>;
}
