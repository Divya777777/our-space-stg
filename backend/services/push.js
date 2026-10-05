// Expo push notifications. Sends only who/where (chat content is end-to-end encrypted and unknown to the server).
// Delivery is best-effort and never blocks or fails an API request.
const ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';
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
  // Plain SQL, so it works even when the deployed Prisma client was generated before push_tokens existed.
  const raw = typeof db.$executeRawUnsafe === 'function' && typeof db.$queryRawUnsafe === 'function';
  const store = {
    save: (token, userId, platform) => raw
      ? db.$executeRawUnsafe('INSERT INTO push_tokens (token, user_id, platform, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = NOW()', token, Number(userId), platform)
      : db.push_tokens.upsert({ where: { token }, create: { token, user_id: userId, platform }, update: { user_id: userId, platform, updated_at: new Date() } }),
    remove: (token, userId) => raw
      ? db.$executeRawUnsafe('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', token, Number(userId))
      : db.push_tokens.deleteMany({ where: { token, user_id: userId } }),
    tokensFor: async ids => raw
      ? db.$queryRawUnsafe(`SELECT token FROM push_tokens WHERE user_id IN (${ids.map((_, i) => '$' + (i + 1)).join(', ')})`, ...ids)
      : db.push_tokens.findMany({ where: { user_id: { in: ids } }, select: { token: true } }),
    forget: tokens => raw
      ? db.$executeRawUnsafe(`DELETE FROM push_tokens WHERE token IN (${tokens.map((_, i) => '$' + (i + 1)).join(', ')})`, ...tokens)
      : db.push_tokens.deleteMany({ where: { token: { in: tokens } } }),
  };
  // Last delivery result per person, so the app can show why a notification did not arrive.
  const status = new Map();
  const missing = error => {
    // Table not created yet (migration 002 not applied): stay quiet and keep the API working.
    if (error?.code === 'P2021' || /push_tokens/.test(error?.message || '')) { if (!tableMissingLogged) { console.warn('Push disabled until migration 002_push_tokens.sql is applied'); tableMissingLogged = true; } return true; }
    return false;
  };
  async function register(userId, token, platform) {
    if (!TOKEN.test(token || '')) throw Object.assign(new Error('Invalid push token'), { status: 400 });
    const clean = ['android', 'ios'].includes(platform) ? platform : 'android';
    await ensureTable();
    try { await store.save(token, userId, clean); } catch (error) { if (!missing(error)) throw error; }
  }
  async function unregister(userId, token) {
    await ensureTable();
    try { await store.remove(token, userId); } catch (error) { if (!missing(error)) throw error; }
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
    try { rows = await store.tokensFor(targets); }
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
        const tickets = result?.data || [];
        const dead = tickets.map((ticket, j) => ticket?.details?.error === 'DeviceNotRegistered' ? chunk[j].to : null).filter(Boolean);
        if (dead.length) await store.forget(dead).catch(() => {});
        const errors = tickets.filter(t => t?.status === 'error').map(t => t.details?.error || t.message);
        if (errors.length || !response.ok) console.warn('Push rejected:', response.status, errors.join('; ') || JSON.stringify(result?.errors || result));
        remember(targets, { at: now(), sent: chunk.length, httpStatus: response.status, errors: errors.length ? errors : (result?.errors || []).map(e => e.message), ticketIds: tickets.filter(t => t?.id).map(t => t.id) });
      } catch (error) { console.warn('Push send failed:', error.message); remember(targets, { at: now(), sent: 0, errors: [error.message] }); }
    }
    return messages.length;
  }
  function remember(userIds, result) { for (const id of userIds) status.set(Number(id), result); if (status.size > 5000) status.clear(); }
  /** Asks Expo what happened after sending (this is where Firebase/FCM problems show up). */
  async function receipts(ids) {
    if (!ids?.length) return [];
    const response = await fetchImpl(RECEIPTS, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}) }, body: JSON.stringify({ ids }), signal: AbortSignal.timeout(8000) });
    const result = await response.json().catch(() => null);
    return Object.values(result?.data || {}).map(r => r.status === 'ok' ? 'delivered to Google' : `${r.details?.error || 'error'}: ${r.message || ''}`.trim());
  }
  async function countFor(userId) {
    await ensureTable();
    try { return (await store.tokensFor([Number(userId)])).length; } catch (error) { if (missing(error)) return 0; throw error; }
  }
  /** Sends a test notification to this person's phones after `delayMs` (so they can leave the app first). */
  function test(userId, delayMs = 8000) {
    const id = Number(userId);
    status.set(id, { at: now(), pending: true });
    setTimeout(async () => {
      try {
        await send([id], { title: 'Our Space', body: 'Notifications are working. You will get calls and messages here.', data: { type: 'test' }, channelId: 'messages', sound: 'default', priority: 'high' });
        const last = status.get(id);
        if (last?.ticketIds?.length) {
          await new Promise(resolve => setTimeout(resolve, 6000));
          const delivery = await receipts(last.ticketIds).catch(e => [`could not read receipts: ${e.message}`]);
          status.set(id, { ...last, delivery });
        }
      } catch (error) { status.set(id, { at: now(), errors: [error.message] }); }
    }, delayMs);
  }
  async function report(userId) { return { phones: await countFor(userId), last: status.get(Number(userId)) || null }; }
  /** Fire and forget from request handlers. */
  const notify = (...args) => { send(...args).catch(error => console.warn('Push error:', error.message)); };
  // Prepare the table at startup so the first notification is not delayed.
  void ensureTable();
  return { register, unregister, send, notify, test, report };
}
module.exports = { createPush };
