// Permanently deletes an account and everything tied to it (App Store 5.1.1(v), Google Play account deletion).
// Rooms the person hosts are closed for everyone; their messages, playlists, goals, game data, plans and
// push tokens go with them. Security audit lines keep no user link (user_id set to null by the schema).
async function eraseAccount(db, userId) {
  const id = Number(userId);
  const sql = async (query, ...params) => { try { await db.$executeRawUnsafe(query, ...params); } catch { /* table not created yet */ } };
  const memberships = await db.room_members.findMany({ where: { user_id: id }, select: { room: { select: { room_code: true } } } }).catch(() => []);
  const codes = memberships.map(m => m.room?.room_code).filter(Boolean);
  // Rows that point at the person without a foreign key.
  await sql('DELETE FROM goal_cheers WHERE to_user = $1', id);
  await sql('DELETE FROM quiz_guesses WHERE about = $1', id);
  await sql('DELETE FROM user_blocks WHERE blocker = $1 OR blocked = $1', id);
  await sql('UPDATE user_reports SET reporter = NULL WHERE reporter = $1', id);
  await sql('UPDATE now_playing SET controlled_by_user_id = NULL WHERE controlled_by_user_id = $1', id);
  await sql('UPDATE playlist_songs SET added_by_user_id = NULL WHERE added_by_user_id = $1', id);
  // Everything else is removed by the database's ON DELETE CASCADE rules: hosted rooms (and their
  // chat, playlists, goals, games and plans), memberships, messages, sessions, preferences, push tokens.
  await db.rooms.deleteMany({ where: { host_user_id: id } });
  await db.users.delete({ where: { user_id: id } });
  return { rooms: codes };
}
module.exports = { eraseAccount };
