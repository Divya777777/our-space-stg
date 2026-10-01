const test = require('node:test');
const assert = require('node:assert/strict');
const { positiveId, validateIdParams } = require('../utils/ids');
const { validatePlaylistCreation, validateAddSong } = require('../middleware/validation');
const { load, response } = require('./helpers');

async function validate(rules, body, params={}) {
  const req = { body, params, query: {}, headers: {} }; const res = response();
  for (const rule of rules) {
    if (rule.run) await rule.run(req);
    else rule(req, res, () => {});
  }
  return { req, res };
}
test('ID validation rejects malformed, unsafe, zero and negative integers', () => {
  for (const value of ['7abc', '0', '-1', '1.2', '1e2', '2147483648', {}, null, undefined]) assert.equal(positiveId(value), null);
  assert.equal(positiveId('7'), 7);
  const res = response(); validateIdParams({ params: { roomId: '7abc' } }, res, () => assert.fail('Invalid ID accepted'));
  assert.equal(res.statusCode, 400);
});
test('personal playlist API accepts missing room while room playlist API requires one', async () => {
  const personal = await validate(validatePlaylistCreation, { playlistType: 'personal', playlistName: 'Mine' });
  assert.equal(personal.res.statusCode, 200); assert.equal(personal.req.body.roomId, null);
  assert.equal((await validate(validatePlaylistCreation, { playlistName: 'Room' })).res.statusCode, 400);
  const room = await validate(validatePlaylistCreation, { playlistName: 'Room', roomId: '7' });
  assert.equal(room.req.body.roomId, 7); assert.equal(room.res.statusCode, 200);
  assert.equal((await validate(validatePlaylistCreation, { playlistName: 'Room', roomId: '7bad' })).res.statusCode, 400);
});
test('track saves accept unknown duration and convert known duration to an integer', async () => {
  const body = { videoId: 'abcdefghijk', title: 'Song' };
  assert.equal((await validate(validateAddSong, body, { playlistId: '10' })).res.statusCode, 200);
  const known = await validate(validateAddSong, { ...body, durationSeconds: '123' }, { playlistId: '10' });
  assert.equal(known.req.body.durationSeconds, 123);
});
test('personal creation response serializes roomId null; personal library uses authenticated user', async () => {
  let owner;
  const authenticate = () => {};
  const router = load('routes/playlists.js', {
    '../middleware/auth': { authenticate, isRoomMember: () => {} },
    '../services/playlistService': {
      createPlaylist: async () => ({ success: true, playlist: { playlist_id: 10, room_id: null, playlist_name: 'Mine', playlist_type: 'personal' } }),
      getPersonalPlaylists: async userId => { owner = userId; return []; }
    }
  });
  const create = router.stack.find(l => l.route?.path === '/' && l.route.methods.post).route;
  const res = response(); await create.stack.at(-1).handle({ user: { user_id: 1 }, body: {} }, res);
  assert.equal(res.statusCode, 201); assert.equal(res.data.playlist.roomId, null);
  const personal = router.stack.find(l => l.route?.path === '/personal').route;
  assert.equal(personal.stack[0].handle, authenticate);
  await personal.stack.at(-1).handle({ user: { user_id: 1 }, query: { userId: 999 } }, response()); assert.equal(owner, 1);
});
test('logout requires authentication and revokes its authenticated session', async () => {
  let revoked;
  const authenticate = () => {};
  const router = load('routes/auth.js', {
    '../services/userService': { logout: async id => { revoked = id; } },
    '../middleware/auth': { authenticate, refreshAccessToken: async () => {} },
    '../middleware/security': { authLimiter: (q,s,n) => n(), getClientIp: () => 'local', getUserAgent: () => 'test' },
    '../utils/auditLogger': { logAuth: async () => {}, logFailedLogin: async () => {} }
  });
  const route = router.stack.find(l => l.route?.path === '/logout').route;
  assert.equal(route.stack[0].handle, authenticate);
  const res = response(); await route.stack.at(-1).handle({ sessionId: 42, user: { user_id: 1 } }, res);
  assert.equal(revoked, 42); assert.equal(res.data.success, true);
});
test('host middleware normalizes a route ID and rejects invalid IDs before querying', async () => {
  let queried;
  const fake = { rooms: { findUnique: async ({ where }) => { queried = where.room_id; return { host_user_id: 1 }; } } };
  const middleware = load('middleware/auth.js', {
    '@prisma/client': { PrismaClient: function () { return fake; } },
    '../utils/auditLogger': { logSecurityEvent: async () => {} },
    './security': { getClientIp: () => 'local', getUserAgent: () => 'test' }
  });
  let next = false;
  await middleware.isRoomHost({ params: { roomId: '7' }, body: {}, user: { user_id: 1 } }, response(), () => { next = true; });
  assert.equal(queried, 7); assert.equal(next, true);
  queried = null; const res = response();
  await middleware.isRoomHost({ params: { roomId: '7bad' }, body: {}, user: { user_id: 1 } }, res, () => assert.fail());
  assert.equal(res.statusCode, 400); assert.equal(queried, null);
});

test('website playlist response retains personal lists while explicit room scope excludes them', async () => {
  const router = load('routes/playlists.js', {
    '../middleware/auth': { authenticate: () => {}, isRoomMember: () => {} },
    '../services/playlistService': { getRoomPlaylists: async () => [{ playlistId:'1',playlistType:'room' }], getPersonalPlaylists: async () => [{ playlistId:'2',playlistType:'personal',roomId:null }] }
  });
  const handler=router.stack.find(l=>l.route?.path==='/room/:roomId').route.stack.at(-1).handle;
  const combined=response();await handler({params:{roomId:'7'},user:{user_id:1},query:{}},combined);
  assert.equal(combined.data.playlists.length,2);assert.equal(combined.data.playlists[1].roomId,null);
  const room=response();await handler({params:{roomId:'7'},user:{user_id:1},query:{scope:'room'}},room);assert.equal(room.data.playlists.length,1);
});

test('tokens for different sessions are unique and retain their expiry', () => {
  const old=process.env.JWT_SECRET; process.env.JWT_SECRET='only-for-local-test';
  try {
    const middleware=load('middleware/auth.js', {
      '@prisma/client':{PrismaClient:function(){return {};}},
      '../utils/auditLogger':{}, './security':{}
    });
    const a=middleware.generateAccessToken({userId:1});const b=middleware.generateAccessToken({userId:1});
    assert.notEqual(a,b);assert.equal(middleware.verifyToken(a).userId,1);
  } finally { if(old===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=old; }
});
