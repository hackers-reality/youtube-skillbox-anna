// Identity decisions are separate from credentials. Call only with channels
// returned by the backend's Google-owned-channel list, never a typed handle.
export function profileChannelId(state) {
  const profile = state?.profile || state || {};
  for (const value of [profile.channel_id, profile.id, state?.channelId]) {
    if (/^UC[\w-]{22}$/.test(String(value || ""))) return value;
  }
  const match = String(profile.channel_url || "").match(/\/channel\/(UC[\w-]{22})(?:[/?#]|$)/);
  return match?.[1] || "";
}
export function matchesOwnedChannel(state, channel) {
  const existing = profileChannelId(state);
  if (existing) return existing === channel.id;
  const handle = String(state?.handle || state?.profile?.handle || "").trim().toLowerCase();
  return !!handle && !!channel.handle && handle === channel.handle.toLowerCase();
}
export function googleWorkspaceProfile(previous, channel, publicProfile = {}, now = new Date().toISOString()) {
  if (!/^UC[\w-]{22}$/.test(String(channel.id || ""))) throw new Error("Google did not return a valid owned channel identity.");
  const publicId = profileChannelId(publicProfile);
  if (publicId && publicId !== channel.id) throw new Error("Public metadata does not match the Google-owned channel.");
  const same = matchesOwnedChannel(previous, channel);
  return {
    ...(same ? previous : {}),
    handle: channel.handle || publicProfile.handle || `https://www.youtube.com/channel/${channel.id}`,
    profile: { ...(same ? previous?.profile : {}), ...publicProfile, name: publicProfile.name || channel.title, handle: channel.handle || publicProfile.handle || "", channel_url: `https://www.youtube.com/channel/${channel.id}`, avatar_url: publicProfile.avatar_url || channel.avatar_url || (same ? previous?.profile?.avatar_url : undefined) },
    channelId: channel.id,
    confirmed: true,
    verified: true,
    verificationMethod: "google-oauth",
    verificationError: "",
    verifiedAt: now,
    restorationShown: true
  };
}
export function initialOnboardingStep(profile, guest, hasGoogleConnections = false) {
  if (profile?.verified) return profile.verificationMethod !== "google-oauth" && !profile.restorationShown ? "restore" : null;
  if (guest || hasGoogleConnections) return null;
  return profile?.confirmed ? "phrase" : profile ? "confirm" : "identity";
}
