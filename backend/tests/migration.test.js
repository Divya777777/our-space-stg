const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname, '../prisma/manual-migrations/001_personal_playlists.sql'), 'utf8');
const baseline = `
  CREATE TABLE rooms (room_id INTEGER PRIMARY KEY);
  CREATE TABLE playlists (playlist_id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
    created_by_user_id INTEGER NOT NULL, playlist_type TEXT NOT NULL);
  CREATE TABLE playlist_songs (playlist_song_id INTEGER PRIMARY KEY, playlist_id INTEGER REFERENCES playlists(playlist_id) ON DELETE CASCADE, song_id INTEGER);
  INSERT INTO rooms VALUES (7);
  INSERT INTO playlists VALUES (10,7,1,'personal'), (11,7,2,'personal'), (12,7,1,'room');
  INSERT INTO playlist_songs VALUES (20,10,100),(21,11,101),(22,12,102);
`;
test('PostgreSQL migration preserves IDs and songs; personal playlists survive room deletion', async () => {
  const db = new PGlite();
  try {
    await db.exec(baseline); await db.exec(migration);
    assert.deepEqual((await db.query('SELECT playlist_id, room_id FROM playlists ORDER BY playlist_id')).rows,
      [{ playlist_id: 10, room_id: null }, { playlist_id: 11, room_id: null }, { playlist_id: 12, room_id: 7 }]);
    assert.equal((await db.query('SELECT * FROM playlist_songs')).rows.length, 3);
    await db.exec('DELETE FROM rooms WHERE room_id=7');
    assert.deepEqual((await db.query('SELECT playlist_song_id FROM playlist_songs ORDER BY playlist_song_id')).rows,
      [{ playlist_song_id: 20 }, { playlist_song_id: 21 }]);
    await assert.rejects(db.exec("INSERT INTO playlists VALUES (30,NULL,1,'room')"), /playlists_scope_check/);
    await db.exec('INSERT INTO rooms VALUES (8)');
    await assert.rejects(db.exec("INSERT INTO playlists VALUES (30,8,1,'personal')"), /playlists_scope_check/);
  } finally { await db.close(); }
});
test('unexpected legacy scope aborts migration and rolls back changes', async () => {
  const db = new PGlite();
  try {
    await db.exec(baseline); await db.exec("INSERT INTO playlists VALUES (13,7,1,'unknown')");
    await assert.rejects(db.exec(migration), /playlists_scope_check/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT room_id FROM playlists WHERE playlist_id=10')).rows[0].room_id, 7);
    assert.equal((await db.query('SELECT * FROM playlist_songs')).rows.length, 3);
    await assert.rejects(db.exec("INSERT INTO playlists VALUES (30,NULL,1,'personal')"), /null value/);
  } finally { await db.close(); }
});
