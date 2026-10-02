const test = require('node:test');
const assert = require('node:assert/strict');
const { createYouTubeSearch } = require('../services/youtubeSearch');
const { createMobileRouter } = require('../routes/mobile');
const { response } = require('./helpers');
const item = (videoId, title) => ({ id: { videoId }, snippet: { title, channelTitle: 'Moon &amp; Co', liveBroadcastContent: 'none' } });
function fakeFetch(payload, status = 200) {
  const calls = [];
  const fn = async url => { calls.push(String(url)); return { ok: status < 400, status, json: async () => payload }; };
  return Object.assign(fn, { calls });
}
test('search maps, decodes and caches results; key stays server-side', async () => {
  const f = fakeFetch({ items: [item('abcdefghijk', 'Rain &quot;lofi&quot;'), { id: { channelId: 'x' } }] });
  const yt = createYouTubeSearch({ apiKey: 'k', fetchImpl: f });
  const first = await yt.search('  lofi   rain ');
  assert.deepEqual(first, [{ videoId: 'abcdefghijk', title: 'Rain "lofi"', channel: 'Moon & Co', thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg', live: false }]);
  await yt.search('LOFI rain');
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0], /videoEmbeddable=true/);
});
test('missing key, short queries and quota errors give friendly statuses', async () => {
  await assert.rejects(createYouTubeSearch({ apiKey: '' }).search('hello'), e => e.status === 503);
  await assert.rejects(createYouTubeSearch({ apiKey: 'k', fetchImpl: fakeFetch({}) }).search('a'), e => e.status === 400);
  const quota = createYouTubeSearch({ apiKey: 'k', fetchImpl: fakeFetch({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403) });
  await assert.rejects(quota.search('hello'), e => e.status === 503 && /resting/.test(e.message));
});
test('search route is authenticated and returns results', async () => {
  const auth = () => {};
  const youtube = { configured: () => true, search: async q => [{ videoId: 'abcdefghijk', title: q }] };
  const router = createMobileRouter({ db: {}, auth, youtube });
  const authIndex = router.stack.findIndex(l => l.handle === auth);
  const layerIndex = router.stack.findIndex(l => l.route?.path === '/youtube/search');
  assert.ok(layerIndex > authIndex);
  const res = Object.assign(response(), { set() { return this; } });
  await router.stack[layerIndex].route.stack.at(-1).handle({ user: { user_id: 1 }, query: { q: 'moon' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.data.results[0].title, 'moon');
});
