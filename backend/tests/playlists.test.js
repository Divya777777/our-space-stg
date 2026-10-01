const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaylistService } = require('../services/playlistService');

function fixture(type = 'personal', owner = 1, member = true) {
  const writes = [];
  const playlist = { playlist_id: 10, playlist_type: type, created_by_user_id: owner,
    room_id: type === 'room' ? 7 : null, is_active: true,
    room: type === 'room' ? { is_active: true, members: member ? [{ user_id: 1 }] : [] } : null };
  const song = { song_id: 20, video_id: 'abcdefghijk', title: 'A song', duration_seconds: 0 };
  const db = {
    playlists: {
      findUnique: async () => playlist,
      create: async ({ data }) => { writes.push(data); return { playlist_id: 10, ...data }; },
      findMany: async args => { db.listQuery = args; return []; }
    },
    room_members: { findFirst: async args => { db.membershipQuery = args; return member ? { user_id: 1 } : null; } },
    songs: { upsert: async () => song, findUnique: async () => null },
    playlist_songs: {
      findFirst: async () => null,
      findUnique: async () => ({ playlist_song_id: 30, playlist_id: 10, playlist }),
      findMany: async () => [{ playlist_song_id: 30 }, { playlist_song_id: 31 }],
      create: async ({ data }) => { writes.push(data); return { playlist_song_id: 30, ...data }; },
      delete: async args => writes.push(args),
      updateMany: async args => { writes.push(args); return { count: 1 }; }
    },
    now_playing: {
      deleteMany: async args => writes.push(args),
      create: async ({ data }) => { writes.push(data); return data; }
    },
    $transaction: async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(db); }
  };
  return { db, playlist, writes, service: createPlaylistService(db) };
}

test('personal creation needs no room; legacy room argument is detached', async () => {
  for (const roomId of [undefined, 7]) {
    const f = fixture('personal', 1, false);
    const result = await f.service.createPlaylist(1, { playlistType: 'personal', playlistName: ' Mine ', roomId });
    assert.equal(result.success, true); assert.equal(result.playlist.room_id, null);
    assert.equal(result.playlist.created_by_user_id, 1); assert.equal(f.db.membershipQuery, undefined);
  }
});
test('room creation requires a valid ID and active membership', async () => {
  const f = fixture('room', 1, false);
  assert.equal((await f.service.createPlaylist(1, { playlistName: 'Room', roomId: '7abc' })).status, 400);
  assert.equal((await f.service.createPlaylist(1, { playlistName: 'Room', roomId: '7' })).status, 403);
  assert.equal(f.db.membershipQuery.where.room_id, 7); assert.deepEqual(f.writes, []);
});
test('personal library is owner-filtered and serializes null room IDs', async () => {
  const f = fixture(); await f.service.getPersonalPlaylists(1);
  assert.deepEqual(f.db.listQuery.where, { created_by_user_id: 1, playlist_type: 'personal', is_active: true });
  f.db.playlists.findMany = async () => [{ ...f.playlist, creator: { user_id: 1 }, songs: [] }];
  assert.equal((await f.service.getPersonalPlaylists(1))[0].roomId, null);
});
test('room listing excludes personal playlists and checks membership', async () => {
  const f = fixture('room'); await f.service.getRoomPlaylists(7, 1);
  assert.deepEqual(f.db.listQuery.where, { room_id: 7, playlist_type: 'room', is_active: true });
  await assert.rejects(fixture('room', 1, false).service.getRoomPlaylists(7, 1), { status: 403 });
});
for (const action of ['add', 'remove', 'reorder']) {
  const run = (s, id=1) => action === 'add' ? s.addSongToPlaylist(10, id, { videoId: 'abcdefghijk', title: 'Song' }) :
    action === 'remove' ? s.removeSongFromPlaylist(30, id) : s.reorderPlaylist(10, id, [{ playlistSongId: 30, newPosition: 1 }, { playlistSongId: 31, newPosition: 0 }]);
  test(`${action}: owner can edit personal playlist without membership`, async () => {
    const f = fixture('personal', 1, false); assert.equal((await run(f.service)).success, true); assert.ok(f.writes.length);
  });
  test(`${action}: room member cannot edit another user's personal playlist`, async () => {
    const f = fixture('personal', 2, true); assert.equal((await run(f.service)).status, 403); assert.deepEqual(f.writes, []);
  });
  test(`${action}: room member can collaborate; outsiders and inactive lists cannot`, async () => {
    assert.equal((await run(fixture('room').service)).success, true);
    const outsider = fixture('room', 1, false); assert.equal((await run(outsider.service)).status, 403); assert.deepEqual(outsider.writes, []);
    const inactive = fixture(); inactive.playlist.is_active = false; assert.equal((await run(inactive.service)).status, 403);
  });
}
test('reordering cannot target another playlist, omit songs, duplicate IDs or positions', async () => {
  const orders = [
    [{ playlistSongId: 999, newPosition: 0 }, { playlistSongId: 31, newPosition: 1 }],
    [{ playlistSongId: 30, newPosition: 0 }],
    [{ playlistSongId: 30, newPosition: 0 }, { playlistSongId: 30, newPosition: 1 }],
    [{ playlistSongId: 30, newPosition: 0 }, { playlistSongId: 31, newPosition: 0 }],
    [{ playlistSongId: 30, newPosition: -1 }, { playlistSongId: 31, newPosition: 1 }],
    [{ playlistSongId: '30abc', newPosition: 0 }, { playlistSongId: 31, newPosition: 1 }]
  ];
  for (const order of orders) {
    const f = fixture(); assert.equal((await f.service.reorderPlaylist(10, 1, order)).status, 400); assert.deepEqual(f.writes, []);
  }
});
test('reorder writes are constrained to selected playlist', async () => {
  const f = fixture(); await f.service.reorderPlaylist(10, 1, [{ playlistSongId: '30', newPosition: 1 }, { playlistSongId: '31', newPosition: 0 }]);
  assert.ok(f.writes.every(w => w.where.playlist_id === 10));
});
test('serialization conflicts retry; other database errors surface', async () => {
  const f = fixture(); let calls = 0;
  f.db.$transaction = async fn => { if (++calls < 3) throw { code: 'P2034' }; return fn(f.db); };
  assert.equal((await f.service.createPlaylist(1, { playlistType: 'personal', playlistName: 'Mine' })).success, true);
  assert.equal(calls, 3);
  f.db.$transaction = async () => { throw new Error('offline'); };
  await assert.rejects(f.service.createPlaylist(1, { playlistType: 'personal', playlistName: 'Mine' }), /offline/);
});
test('duplicate song returns conflict without another playlist entry', async () => {
  const f = fixture(); f.db.playlist_songs.findFirst = async () => ({ playlist_song_id: 30 });
  assert.equal((await f.service.addSongToPlaylist(10, 1, { videoId: 'abcdefghijk', title: 'Song' })).status, 409);
  assert.deepEqual(f.writes, []);
});
test('sharing a personal video does not reveal its playlist identity', async () => {
  const f = fixture(); const result = await f.service.updateNowPlaying(7, 1, { videoId: 'abcdefghijk', playlistId: 10 });
  assert.equal(result.success, true); assert.equal(result.nowPlaying.playlist_id, null);
});
test('playback rejects another user\'s personal playlist or another room\'s list before writes', async () => {
  for (const f of [fixture('personal', 2), fixture('room')]) {
    f.playlist.room_id = 99;
    assert.equal((await f.service.updateNowPlaying(7, 1, { videoId: 'abcdefghijk', playlistId: 10 })).status, 403);
    assert.deepEqual(f.writes, []);
  }
});
