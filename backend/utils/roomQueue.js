// Shared "up next" queue per room. Ephemeral (single instance, in memory) like call signaling:
// it survives normal use but not a backend restart. Manual picks play before playlist continuation.
const MAX_ITEMS = 100;
const VIDEO = /^[\w-]{11}$/;
function createRoomQueues({ now = Date.now } = {}) {
  const rooms = new Map();
  let sequence = 0;
  const list = key => rooms.get(key) || [];
  const save = (key, items) => { if (items.length) rooms.set(key, items.slice(0, MAX_ITEMS)); else rooms.delete(key); };
  const clean = (track, source, addedBy) => {
    if (!track || !VIDEO.test(track.videoId || '')) throw Object.assign(new Error('Invalid video'), { status: 400 });
    const title = typeof track.title === 'string' && track.title.trim() ? track.title.trim().slice(0, 150) : 'YouTube video';
    return { id: `q${now().toString(36)}${(++sequence).toString(36)}`, videoId: track.videoId, title, source, addedBy: addedBy || '' };
  };
  return {
    view: key => list(key).map(({ id, videoId, title, source, addedBy }) => ({ id, videoId, title, source, addedBy })),
    add(key, track, addedBy) {
      const items = list(key);
      if (items.length >= MAX_ITEMS) throw Object.assign(new Error('The queue is full.'), { status: 409 });
      const item = clean(track, 'manual', addedBy);
      const firstContext = items.findIndex(i => i.source === 'playlist');
      const at = firstContext === -1 ? items.length : firstContext;
      save(key, [...items.slice(0, at), item, ...items.slice(at)]);
      return item;
    },
    remove(key, id) { save(key, list(key).filter(i => i.id !== id)); },
    clear(key) { rooms.delete(key); },
    /** Replace playlist continuation (playing from a playlist) or drop it (anything else was chosen). */
    setContext(key, tracks = []) {
      const manual = list(key).filter(i => i.source === 'manual');
      const context = (Array.isArray(tracks) ? tracks : []).slice(0, MAX_ITEMS).filter(t => VIDEO.test(t?.videoId || '')).map(t => clean(t, 'playlist'));
      save(key, [...manual, ...context]);
    },
    /** Take the next item; drop a queued copy of a video that was started by hand. */
    shift(key) { const items = list(key); const [next, ...rest] = items; save(key, rest); return next || null; },
    removeVideo(key, videoId) { const items = list(key); const i = items.findIndex(item => item.videoId === videoId); if (i !== -1) save(key, [...items.slice(0, i), ...items.slice(i + 1)]); },
  };
}
module.exports = { createRoomQueues };
