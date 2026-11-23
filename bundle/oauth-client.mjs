/* No Google credentials enter this module. All grant/token work is in Python. */
export function mountGoogleConnection({ invoke, root = document, onUseChannel = async () => {}, onRefresh = () => {}, onWorkspaceSelection = () => {}, matchesWorkspace = () => false }) {
  const byId = (id) => root.getElementById(id);
  const dialog = byId("google-dialog");
  let connections = [], attemptId = null;
  let linkWorkspace = false;
  function selection() {
    const [id, channelId] = byId("google-channel").value.split(":");
    const connection = connections.find((item) => item.id === id);
    return connection?.channels.find((channel) => channel.id === channelId) || null;
  }
  const message = (text) => { byId("google-status").textContent = text; };
  function render() {
    const select = byId("google-channel");
    const previous = select.value;
    select.replaceChildren(new Option("Select an authorized channel", ""));
    connections.forEach((connection) => connection.channels.forEach((channel) => {
      const option = new Option(`${channel.title} · ${connection.email}`, `${connection.id}:${channel.id}`);
      option.dataset.handle = channel.handle || channel.id;
      select.appendChild(option);
    }));
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    else if (select.options.length === 2) select.selectedIndex = 1;
    byId("google-disconnect").disabled = !select.value;
    byId("google-use-workspace").disabled = !select.value;
    if (select.value) byId("analytics-handle").value = select.selectedOptions[0].dataset.handle;
  }
  async function refresh() {
    const result = await invoke("oauth_status", { attempt_id: attemptId || undefined }, 30000);
    connections = result.connections || [];
    render();
    message(result.configured ? connections.length ? "Google connected read-only. Select an owned channel for Analytics; public research/profile remain separate." : "Local OAuth backend ready. Connect your Google/Brand account to authorize Analytics." : result.message || "Local Google setup is required. See GOOGLE_OAUTH_SETUP.md.");
    onRefresh(result);
    return result;
  }
  async function begin(options = {}) {
    linkWorkspace = !!options.linkWorkspace;
    byId("google-dialog-copy").textContent = linkWorkspace ? "Connect the Google/Brand account that owns your channel. After consent, Check connection will use the matching owned channel as your verified workspace—no description change needed." : "Open consent in a separate browser tab, then Check connection. You can use the authorized channel as your workspace without changing its description.";
    byId("google-dialog-error").textContent = "";
    byId("google-consent-link").hidden = true;
    byId("google-revoke-confirm").hidden = true;
    byId("google-check").hidden = false;
    if (!dialog.open) dialog.showModal();
    try {
      const result = await invoke("oauth_begin", {}, 30000);
      const url = new URL(result.authorization_url);
      if (url.origin !== "https://accounts.google.com") throw new Error("Unexpected authorization endpoint");
      attemptId = result.attempt_id;
      const link = byId("google-consent-link"); link.href = url.href; link.hidden = false;
    } catch (error) { byId("google-dialog-error").textContent = String(error.message || error); }
  }
  byId("google-connect").addEventListener("click", () => void begin());
  byId("google-dialog-close").addEventListener("click", () => dialog.close());
  byId("google-channel").addEventListener("change", render);
  byId("google-refresh").addEventListener("click", () => refresh().catch((error) => message(String(error.message || error))));
  byId("google-check").addEventListener("click", async () => {
    const button = byId("google-check"); button.disabled = true;
    try {
      const result = await refresh();
      if (result.attempt_status === "connected") {
        const candidates = connections.flatMap((connection) => connection.channels);
        const match = candidates.find(matchesWorkspace);
        if (linkWorkspace && (match || candidates.length === 1)) {
          const channel = match || candidates[0];
          await onUseChannel(channel);
          dialog.close();
          return;
        }
        dialog.close();
        onWorkspaceSelection();
        return;
      }
      byId("google-dialog-error").textContent = result.attempt_status === "connected" ? "Connected successfully. Close this dialog and select your authorized channel." : result.attempt_status === "failed" || result.attempt_status === "expired" ? "This connection failed or expired. Close and start a new connection." : "Consent has not completed yet. Finish it in the browser tab, then check again.";
    } catch (error) { byId("google-dialog-error").textContent = String(error.message || error); }
    finally { button.disabled = false; }
  });
  byId("google-use-workspace").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const channel = selection();
    if (!channel) return message("Select a Google-authorized channel first.");
    button.disabled = true;
    try { await onUseChannel(channel); message("Owned channel selected as your verified workspace. No description change was required."); }
    catch (error) { message(String(error.message || error)); }
    finally { button.disabled = false; }
  });
  byId("google-disconnect").addEventListener("click", () => {
    byId("google-dialog-copy").textContent = "Disconnecting revokes this Google account's permission for the OAuth app (potentially all its channels). Public profile, verification phrase, projects and other Google accounts are not deleted.";
    byId("google-dialog-error").textContent = "";
    byId("google-consent-link").hidden = true;
    byId("google-check").hidden = true;
    byId("google-revoke-confirm").hidden = false;
    dialog.showModal();
  });
  async function disconnect() {
    const grant = byId("google-channel").value.split(":")[0];
    if (!grant) throw new Error("Select a Google connection first");
    await invoke("oauth_disconnect", { grant_id: grant }, 60000);
    await refresh();
  }
  byId("google-revoke-confirm").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try { await disconnect(); dialog.close(); }
    catch (error) { byId("google-dialog-error").textContent = String(error.message || error); }
    finally { event.currentTarget.disabled = false; }
  });
  return {
    hasConnections: () => connections.length > 0,
    begin, refresh, disconnect,
    async report(args) {
      const [grant_id, channel_id] = byId("google-channel").value.split(":");
      if (!grant_id || !channel_id) throw new Error("Connect Google and select an authorized channel first. Google credentials stay in the backend.");
      return invoke("oauth_analytics", { ...args, grant_id, channel_id }, 145000);
    }
  };
}
