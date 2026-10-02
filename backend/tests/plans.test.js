const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileRouter } = require('../routes/mobile');
const { response } = require('./helpers');
function setup({ rooms = 0, personal = 0, roomLists = 0, env = {}, host = 1 } = {}) {
  const room = { room_id: 7, room_code: 'MOON01', room_name: 'Moon', host_user_id: host, is_active: true, members: [1, 2].map(user_id => ({ user_id, user: { user_id, display_name: 'P' } })) };
  const writes = [];
  const playlist = { playlist_id: 10, playlist_name: 'Ours', playlist_type: 'room', created_by_user_id: 2, room_id: 7, room, is_active: true, songs: [] };
  const db = {
    rooms: { findUnique: async () => room, count: async () => rooms, update: async q => { writes.push(['room', q]); return {}; } },
    room_members: { updateMany: async () => ({}), deleteMany: async q => { writes.push(['leave', q]); return {}; } },
    playlists: { findUnique: async () => playlist, count: async q => q.where.playlist_type === 'personal' ? personal : roomLists, update: async q => { writes.push(['playlist', q]); return {}; } },
  };
  const router = createMobileRouter({ db, auth: () => {}, env, roomService: { getPendingRequests: async () => [], createRoom: async () => room }, messageService: { getRoomMessages: async () => [] },
    playlistService: { getNowPlaying: async () => null, createPlaylist: async () => ({ success: true, playlist }) } });
  const call = async (path, method, { body = {}, params = { code: 'MOON01' }, userId = 1 } = {}) => { const res = response(); await router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle({ user: { user_id: userId, display_name: 'P' }, params, body, query: {} }, res); return res; };
  return { call, writes };
}
test('free limits return 402 plus_required; Plus users are not limited', async () => {
  let res = await setup({ rooms: 7 }).call('/rooms', 'post', { body: { name: 'Eighth' } });
  assert.equal(res.statusCode, 402); assert.equal(res.data.code, 'plus_required'); assert.equal(res.data.limit, 'rooms');
  res = await setup({ personal: 2 }).call('/playlists', 'post', { body: { name: 'Third', scope: 'personal' } });
  assert.equal(res.statusCode, 402); assert.equal(res.data.limit, 'personalPlaylists');
  res = await setup({ roomLists: 1 }).call('/playlists', 'post', { body: { name: 'Second', scope: 'room', roomCode: 'MOON01' } });
  assert.equal(res.statusCode, 402); assert.equal(res.data.limit, 'roomPlaylistsPerRoom');
  res = await setup({ rooms: 7, env: { PLUS_USER_IDS: '1' } }).call('/rooms', 'post', { body: { name: 'Eighth' } });
  assert.equal(res.statusCode, 201);
  res = await setup({ rooms: 3, personal: 1 }).call('/plan', 'get');
  assert.deepEqual(res.data, { plan: 'free', limits: { rooms: 7, personalPlaylists: 2, roomPlaylistsPerRoom: 1 }, usage: { rooms: 3, personalPlaylists: 1 } });
});
test('admin deletes a room; a member leaves it; playlist delete needs creator or admin', async () => {
  let s = setup(); let res = await s.call('/rooms/:code', 'delete');
  assert.equal(res.data.deleted, true); assert.equal(s.writes[0][1].data.is_active, false);
  s = setup(); res = await s.call('/rooms/:code', 'delete', { userId: 2 });
  assert.equal(res.data.left, true); assert.equal(s.writes[0][0], 'leave');
  s = setup({ host: 2 }); res = await s.call('/playlists/:id', 'delete', { params: { id: '10' }, userId: 1 });
  assert.equal(res.statusCode, 403);
  s = setup(); res = await s.call('/playlists/:id', 'delete', { params: { id: '10' }, userId: 1 });
  assert.equal(res.data.success, true); assert.equal(s.writes[0][1].data.is_active, false);
});
