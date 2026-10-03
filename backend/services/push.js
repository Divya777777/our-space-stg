// Expo push notifications. Sends only who/where (chat content is end-to-end encrypted and unknown to the server).
// Delivery is best-effort and never blocks or fails an API request.
const ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[\w-]+\]$/;
function createPush({ db, fetchImpl = globalThis.fetch, env = process.env, now = Date.now } = {}) {
  let tableMissingLogged = false;
  // The backend creates its own table the first time push is used (idempotent, touches nothing else),
  // so no manual database step is needed.
  let ready = null;
  const ensureTable = () => {
    if (!db.$executeRawUnsafe) return Promise.resolve();
    if (!ready) ready = (async () => {
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS push_tokens (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        platform TEXT NOT NULL DEFAULT 'android',
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON push_tokens(user_id)');
    })().catch(error => { ready = null; console.warn('Could not prepare push_tokens:', error.message); });
    return ready;
  };
  const recent = new Map();
  const missing = error => {
    // Table not created yet (migration 002 not applied): stay quiet and keep the API working.
    if (error?.code === 'P2021' || /push_tokens/.test(error?.message || '')) { if (!tableMissingLogged) { console.warn('Push disabled until migration 002_push_tokens.sql is applied'); tableMissingLogged = true; } return true; }
    return false;
  };
  async function register(userId, token, platform) {
    if (!TOKEN.test(token || '')) throw Object.assign(new Error('Invalid push token'), { status: 400 });
    const clean = ['android', 'ios'].includes(platform) ? platform : 'android';
    await ensureTable();
    try { await db.push_tokens.upsert({ where: { token }, create: { token, user_id: userId, platform: clean }, update: { user_id: userId, platform: clean, updated_at: new Date() } }); }
    catch (error) { if (!missing(error)) throw error; }
  }
  async function unregister(userId, token) {
    await ensureTable();
    try { await db.push_tokens.deleteMany({ where: { token, user_id: userId } }); } catch (error) { if (!missing(error)) throw error; }
  }
  /** Same kind of note to the same person about the same room at most every `throttleMs`. */
  async function send(userIds, message, { throttleKey, throttleMs = 0 } = {}) {
    const ids = [...new Set(userIds.map(Number))].filter(Number.isSafeInteger);
    if (!ids.length || !fetchImpl) return 0;
    const targets = throttleKey ? ids.filter(id => { const key = `${throttleKey}:${id}`; const last = recent.get(key); if (last && now() - last < throttleMs) return false; recent.set(key, now()); return true; }) : ids;
    if (recent.size > 5000) for (const [key, at] of recent) if (now() - at > 600000) recent.delete(key);
    if (!targets.length) return 0;
    await ensureTable();
    let rows;
    try { rows = await db.push_tokens.findMany({ where: { user_id: { in: targets } }, select: { token: true } }); }
    catch (error) { if (missing(error)) return 0; throw error; }
    if (!rows.length) return 0;
    const messages = rows.map(r => ({ to: r.token, ...message }));
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}) };
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const response = await fetchImpl(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(chunk), signal: AbortSignal.timeout(8000) });
        const result = await response.json().catch(() => null);
        // Forget phones that uninstalled the app or turned off notifications for good.
        const dead = (result?.data || []).map((ticket, j) => ticket?.details?.error === 'DeviceNotRegistered' ? chunk[j].to : null).filter(Boolean);
        if (dead.length) await db.push_tokens.deleteMany({ where: { token: { in: dead } } }).catch(() => {});
      } catch (error) { console.warn('Push send failed:', error.message); }
    }
    return messages.length;
  }
  /** Fire and forget from request handlers. */
  const notify = (...args) => { send(...args).catch(error => console.warn('Push error:', error.message)); };
  // Prepare the table at startup so the first notification is not delayed.
  void ensureTable();
  return { register, unregister, send, notify };
}
module.exports = { createPush };
