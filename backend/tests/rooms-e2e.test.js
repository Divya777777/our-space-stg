const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileRouter } = require('../routes/mobile');
const { createE2ERelay } = require('../services/e2eRelay');
const { createRoomQueues } = require('../utils/roomQueue');
const { response } = require('./helpers');
const b64 = n => Buffer.alloc(n, 7).toString('base64');
function setup() {
  const room = { room_id: 7, room_code: 'MOON01', room_name: 'Moon', host_user_id: 1, is_active: true, members: [1, 2].map(user_id => ({ user_id, user: { user_id, display_name: 'P' + user_id, encryption_key_salt: b64(32) } })) };
  const rows = []; const writes = [];
  const db = {
    rooms: { findUnique: async () => room, update: async q => { writes.push(['room', q.data]); room.room_name = q.data.room_name; return room; } },
    room_members: { updateMany: async () => ({}) },
    playlists: { updateMany: async q => { writes.push(['lists', q]); return {}; } },
    users: { update: async q => { writes.push(['key', q.data]); return {}; } },
    messages: {
      create: async q => { const row = { ...q.data, message_id: rows.length + 1, sent_at: new Date() }; rows.push(row); return row; },
      deleteMany: async () => ({}),
      findFirst: async () => rows.at(-1) || null,
      findMany: async q => rows.filter(r => r.message_id > q.where.message_id.gt).slice(0, q.take).map(r => ({ ...r, sender: { user_id: r.sender_user_id, display_name: 'P' } })),
    },
  };
  const encryption = { getEncryptionKey: () => 'k', encrypt: text => ({ encrypted: Buffer.from(text).toString('hex'), iv: 'iv', authTag: 'tag' }), decrypt: hex => Buffer.from(hex, 'hex').toString() };
  const router = createMobileRouter({ db, auth: () => {}, relay: createE2ERelay({ db, encryption }), queues: createRoomQueues(), roomService: { getPendingRequests: async () => [] }, messageService: { getRoomMessages: async () => [] }, playlistService: { getNowPlaying: async () => null } });
  const call = async (path, method, { body = {}, query = {}, userId = 1 } = {}) => { const res = Object.assign(response(), { set() { return this; } }); await router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle({ user: { user_id: userId, display_name: 'P' }, params: { code: 'MOON01' }, body, query }, res); return res; };
  return { call, writes, rows };
}
test('admin renames room and its default playlist; members cannot', async () => {
  const s = setup();
  assert.equal((await s.call('/rooms/:code', 'patch', { body: { name: 'Stars' }, userId: 2 })).statusCode, 403);
  const res = await s.call('/rooms/:code', 'patch', { body: { name: 'Stars' } });
  assert.equal(res.data.name, 'Stars');
  assert.deepEqual(s.writes.find(w => w[0] === 'lists')[1].where.playlist_name.in, ['Room Playlist', 'Moon']);
});
test('E2E relay stores only ciphertext for members, lists after a cursor, members carry public keys', async () => {
  const s = setup();
  assert.equal((await s.call('/keys', 'put', { body: { publicKey: 'nope' } })).statusCode, 400);
  assert.equal((await s.call('/keys', 'put', { body: { publicKey: b64(32) } })).statusCode, 200);
  const envelope = { n: b64(24), b: b64(48) };
  assert.equal((await s.call('/rooms/:code/e2e', 'post', { body: { nonce: b64(24), box: b64(60), keys: { 99: envelope } } })).statusCode, 400);
  const sent = await s.call('/rooms/:code/e2e', 'post', { body: { nonce: b64(24), box: b64(60), keys: { 1: envelope, 2: envelope } } });
  assert.equal(sent.statusCode, 201);
  assert.doesNotMatch(s.rows[0].content_encrypted, /box/);
  const list = await s.call('/rooms/:code/e2e', 'get', { userId: 2, query: { after: '0' } });
  assert.equal(list.data.messages.length, 1); assert.equal(list.data.messages[0].payload.keys[2].n, envelope.n);
  assert.equal((await s.call('/rooms/:code/e2e', 'get', { query: { after: '1' } })).data.messages.length, 0);
  const room = await s.call('/rooms/:code', 'get');
  assert.equal(room.data.e2eCursor, 1); assert.ok(room.data.members[0].key);
});
test('queue items can be moved', async () => {
  const s = setup();
  for (const n of [1, 2, 3]) await s.call('/rooms/:code/queue', 'post', { body: { action: 'add', videoId: String(n).padStart(11, 'a'), title: 'T' + n } });
  let res = await s.call('/rooms/:code', 'get');
  const last = res.data.queue[2].id;
  res = await s.call('/rooms/:code/queue', 'post', { body: { action: 'move', id: last, to: 0 } });
  assert.deepEqual(res.data.queue.map(i => i.title), ['T3', 'T1', 'T2']);
});
test('playlist order is saved from the full list of video IDs', async () => {
  const songs = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map((v, i) => ({ playlist_song_id: i + 1, song: { video_id: v, title: v } }));
  const playlist = { playlist_id: 10, playlist_name: 'Mine', playlist_type: 'personal', created_by_user_id: 1, room: null, is_active: true, songs };
  let saved = null;
  const router = createMobileRouter({ db: { playlists: { findUnique: async () => playlist } }, auth: () => {}, playlistService: { reorderPlaylist: async (_p, _u, order) => { saved = order; return { success: true }; } } });
  const call = async body => { const res = response(); await router.stack.find(l => l.route?.path === '/playlists/:id/order').route.stack.at(-1).handle({ user: { user_id: 1 }, params: { id: '10' }, body, query: {} }, res); return res; };
  assert.equal((await call({ videoIds: ['aaaaaaaaaaa'] })).statusCode, 400);
  assert.equal((await call({ videoIds: ['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb'] })).statusCode, 200);
  assert.deepEqual(saved, [{ playlistSongId: 3, newPosition: 0 }, { playlistSongId: 1, newPosition: 1 }, { playlistSongId: 2, newPosition: 2 }]);
});
test('shared volume and profile name', async () => {
  const s = setup();
  assert.equal((await s.call('/rooms/:code/volume', 'post', { body: { volume: 140 } })).statusCode, 400);
  assert.equal((await s.call('/rooms/:code/volume', 'post', { body: { volume: 35 } })).data.volume, 35);
  assert.equal((await s.call('/rooms/:code', 'get', { userId: 2 })).data.volume, 35);
  const router = createMobileRouter({ db: { users: { findUnique: async () => ({ display_name: 'Divya', last_login_at: null }), update: async q => ({ q }) } }, auth: () => {} });
  const call = async (method, body) => { const res = response(); await router.stack.find(l => l.route?.path === '/me' && l.route.methods[method]).route.stack.at(-1).handle({ user: { user_id: 1, display_name: 'Divya' }, params: {}, body, query: {} }, res); return res; };
  assert.deepEqual((await call('get')).data, { id: '1', name: 'Divya', firstLogin: true });
  assert.equal((await call('patch', { name: '  ' })).statusCode, 400);
  assert.equal((await call('patch', { name: 'Moonbeam' })).data.name, 'Moonbeam');
});
test('large files arrive as 1 MB pieces: pages stay light and pieces are not announced', async () => {
  const s = setup();
  const envelope = { n: b64(24), b: b64(48) };
  const piece = b64(1000000);
  for (let i = 0; i < 6; i++) assert.equal((await s.call('/rooms/:code/e2e', 'post', { body: { nonce: b64(24), box: piece, keys: { 1: envelope, 2: envelope }, hint: 'part' } })).statusCode, 201);
  await s.call('/rooms/:code/e2e', 'post', { body: { nonce: b64(24), box: b64(60), keys: { 1: envelope, 2: envelope }, hint: 'file' } });
  const first = await s.call('/rooms/:code/e2e', 'get', { userId: 2, query: { after: '0', limit: '20' } });
  assert.ok(first.data.messages.length >= 1 && first.data.messages.length < 7);
  assert.equal(first.data.more, true);
  let after = first.data.messages.at(-1).id; let total = first.data.messages.length;
  while (true) { const page = await s.call('/rooms/:code/e2e', 'get', { userId: 2, query: { after: String(after), limit: '20' } }); total += page.data.messages.length; if (!page.data.more) break; after = page.data.messages.at(-1).id; }
  assert.equal(total, 7);
});
