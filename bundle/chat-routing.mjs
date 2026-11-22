/** Plan only the measured YouTube calls needed to answer an in-app chat turn. */
export function planChatTools({ message = "", handle = "", profile = {}, hasRetentionAttachment = false } = {}) {
  const lower = String(message).toLowerCase();
  const requests = [];
  const add = (key, method, args, timeout = 85000) => requests.push({ key, method, args, timeout });


  const asksPerformance = /\b(audit|outliers?|underperform(?:ing)?|performance|views?|view count|recent uploads?|why (?:did|does|is|are|isn't|aren't)|compare (?:my )?videos?)\b/.test(lower);
  const asksChannelDna = /\b(channel dna|niche|core topics|content identity|channel focus|what is my channel about)\b/.test(lower);
  const asksIdentity = /\b(channel profile|channel info|channel description|channel branding|logo|banner|audience|niche)\b/.test(lower);
  const asksMeasuredChannel = asksPerformance || /\b(my channel|this channel|our channel)\b/.test(lower);

  // A retention CSV/ZIP is self-contained; don't make redundant long YouTube calls.
  if (handle && asksChannelDna) {
    add("channel_videos", "channel", { handle, limit: 30, tab: "videos" }, 180000);
    add("channel_outliers", "outliers", { handle, min_ratio: 2 }, 180000);
  }
  if (handle && asksPerformance && !hasRetentionAttachment) {
    add("latest", "latest", { handle, limit: 8 }, 180000);
    add("outliers", "outliers", { handle, min_ratio: 2 }, 180000);
  }
  if (handle && (asksIdentity || (asksMeasuredChannel && !asksPerformance))) add("profile", "profile", { handle });
  if (handle && /community|\bposts?\b/.test(lower)) add("community_posts", "posts", { handle, limit: 12 });
  if (handle && /home|shelf|featured/.test(lower)) add("home_shelves", "home", { handle, limit: 8, verbose: true });
  if (/\bshows?\b/.test(lower)) add("shows", "shows", { handle, limit: 12 });

  if (/ideas?|what should i (?:make|post)|topic|keywords?|trending|research|search demand|competit|competition/.test(lower)) {
    const topic = String(message).match(/(?:about|on|around|for|in the niche of)\s+([^?.!]+)/i)?.[1]?.trim();
    const seed = String(topic || profile?.tags?.[0] || message).slice(0, 100);
    add("keyword_opportunities", "keywords", { seed, limit: 10 });
    add("youtube_search", "search", { query: seed, limit: 6 });
    if (/competit|competition/.test(lower)) add("topic_competition", "compete", { query: seed });
  }
  return requests;
}
