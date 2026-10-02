// Server-side YouTube Data API search. The API key stays on the server (YOUTUBE_API_KEY).
// search.list costs 100 quota units per call, so results are cached and requests are rate limited per user.
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#039;': "'", '&lt;': '<', '&gt;': '>' };
const decode = text => String(text || '').replace(/&(amp|quot|#39|#039|lt|gt);/g, match => ENTITIES[match] || match);

function createYouTubeSearch({ apiKey = process.env.YOUTUBE_API_KEY, fetchImpl = globalThis.fetch, ttlMs = 6 * 60 * 60 * 1000, maxEntries = 500, now = Date.now } = {}) {
  const cache = new Map();
  const inflight = new Map();
  function remember(key, value) {
    cache.delete(key); cache.set(key, { at: now(), value });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }
  async function search(rawQuery, { region } = {}) {
    const query = String(rawQuery || '').replace(/\s+/g, ' ').trim();
    if (query.length < 2 || query.length > 120) throw Object.assign(new Error('Type at least two characters to search.'), { status: 400 });
    if (!apiKey) throw Object.assign(new Error('YouTube search is not set up on the server yet.'), { status: 503 });
    const regionCode = /^[A-Z]{2}$/.test(region || '') ? region : undefined;
    const key = `${regionCode || ''}:${query.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) { cache.delete(key); cache.set(key, hit); return hit.value; }
    if (inflight.has(key)) return inflight.get(key);
    const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', safeSearch: 'moderate', maxResults: '15', q: query, key: apiKey });
    if (regionCode) params.set('regionCode', regionCode);
    const run = (async () => {
      let response;
      try { response = await fetchImpl('https://www.googleapis.com/youtube/v3/search?' + params, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }); }
      catch { throw Object.assign(new Error('YouTube did not respond. Try again in a moment.'), { status: 502 }); }
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const reason = data?.error?.errors?.[0]?.reason;
        if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw Object.assign(new Error('Search is resting for today. Paste a link or pick a saved video instead.'), { status: 503 });
        console.error('YouTube search failed:', response.status, reason || '');
        throw Object.assign(new Error('YouTube search is unavailable right now.'), { status: 502 });
      }
      const results = (data?.items || []).filter(item => /^[\w-]{11}$/.test(item?.id?.videoId || '')).map(item => ({
        videoId: item.id.videoId,
        title: decode(item.snippet?.title).slice(0, 150) || 'YouTube video',
        channel: decode(item.snippet?.channelTitle).slice(0, 100),
        thumbnail: `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,
        live: item.snippet?.liveBroadcastContent === 'live',
      }));
      remember(key, results);
      return results;
    })().finally(() => inflight.delete(key));
    inflight.set(key, run);
    return run;
  }
  return { search, configured: () => Boolean(apiKey) };
}
module.exports = { createYouTubeSearch, decode };
