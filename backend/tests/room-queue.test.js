const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomQueues } = require('../utils/roomQueue');
const v = n => String(n).padStart(11, 'a');
test('manual picks go before playlist continuation and shift in order', () => {
  const q = createRoomQueues();
  q.setContext(1, [{ videoId: v(1), title: 'P1' }, { videoId: v(2), title: 'P2' }]);
  q.add(1, { videoId: v(3), title: 'Mine' }, '7');
  assert.deepEqual(q.view(1).map(i => i.title), ['Mine', 'P1', 'P2']);
  assert.equal(q.shift(1).title, 'Mine');
  q.setContext(1, []);
  assert.deepEqual(q.view(1), []);
});
test('invalid videos are rejected and remove works', () => {
  const q = createRoomQueues();
  assert.throws(() => q.add(1, { videoId: 'bad' }), e => e.status === 400);
  const item = q.add(1, { videoId: v(4) });
  q.add(1, { videoId: v(5) });
  q.remove(1, item.id); q.removeVideo(1, v(5));
  assert.equal(q.view(1).length, 0);
  assert.equal(q.shift(1), null);
});
const { createMobileRouter } = require('../routes/mobile');
const { response } = require('./helpers');
test('queue route advances once per finished video and playlist context follows playback', async () => {
  const room = { room_id: 7, room_code: 'MOON01', room_name: 'Moon', host_user_id: 1, is_active: true, members: [1, 2].map(user_id => ({ user_id, user: { user_id, display_name: 'P' } })) };
  let playing = { videoId: v(1), isPlaying: true, currentTimeSeconds: 0, startedAt: '2026-10-01T00:00:00Z', nowPlayingId: '1' };
  const updates = [];
  const router = createMobileRouter({ db: { rooms: { findUnique: async () => room }, room_members: { updateMany: async () => ({}) } }, auth: () => {},
    roomService: { getPendingRequests: async () => [] }, messageService: { getRoomMessages: async () => [] },
    playlistService: { getNowPlaying: async () => playing, updateNowPlaying: async (_r, _u, d) => { updates.push(d.videoId); playing = { ...playing, videoId: d.videoId }; return { success: true }; } } });
  const call = async (path, body, userId = 1) => { const res = response(); await router.stack.find(l => l.route?.path === path).route.stack.at(-1).handle({ user: { user_id: userId, display_name: 'P' }, params: { code: 'MOON01' }, body, query: {} }, res); return res; };
  await call('/rooms/:code/playback', { videoId: v(2), playing: true, position: 0, queueContext: [{ videoId: v(3), title: 'Three' }, { videoId: v(4), title: 'Four' }] });
  let res = await call('/rooms/:code/queue', { action: 'add', videoId: v(5), title: 'Five' });
  assert.deepEqual(res.data.queue.map(i => i.title), ['Five', 'Three', 'Four']);
  await call('/rooms/:code/queue', { action: 'next', from: v(2) });
  res = await call('/rooms/:code/queue', { action: 'next', from: v(2) }, 2);
  assert.deepEqual(updates, [v(2), v(5)]);
  assert.deepEqual(res.data.queue.map(i => i.title), ['Three', 'Four']);
  await call('/rooms/:code/playback', { videoId: v(9), playing: true, position: 0 });
  res = await call('/rooms/:code/queue', { action: 'clear' });
  assert.equal(res.data.queue.length, 0);
});
