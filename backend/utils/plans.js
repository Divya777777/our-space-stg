// Free vs Plus limits. Until store billing is connected, Plus is granted by PLUS_USER_IDS (comma-separated user ids).
const FREE_LIMITS = Object.freeze({ rooms: 7, personalPlaylists: 2, roomPlaylistsPerRoom: 1 });
function isPlus(userId, env = process.env) {
  return String(env.PLUS_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean).includes(String(userId));
}
function limitsFor(userId, env) { return isPlus(userId, env) ? null : FREE_LIMITS; }
const MESSAGES = {
  rooms: 'You’ve created 7 rooms, the most on the free plan. Get Plus for unlimited rooms.',
  personalPlaylists: 'You have 2 personal playlists, the most on the free plan. Get Plus for unlimited playlists.',
  roomPlaylistsPerRoom: 'This room already has its shared playlist. Get Plus to add more.',
};
function plusRequired(kind) {
  return Object.assign(new Error(MESSAGES[kind]), { status: 402, code: 'plus_required', limit: kind });
}
module.exports = { FREE_LIMITS, isPlus, limitsFor, plusRequired };
