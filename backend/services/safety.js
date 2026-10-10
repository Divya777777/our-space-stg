// Report and block (App Store 1.2, Google Play user-generated content policy).
// Blocking hides the person's chat messages for you, stops their calls and call notifications
// reaching you, and keeps them out of rooms you host. Reports are kept for review at /admin/reports.
const REASONS = ['harassment', 'spam', 'inappropriate', 'hate', 'self-harm', 'other'];

function createSafety({ store, now = Date.now }) {
  const err = (message, status = 400) => Object.assign(new Error(message), { status });
  return {
    REASONS,
    async block(me, other) {
      if (!Number.isSafeInteger(other) || other <= 0 || other === Number(me)) throw err('Choose someone else to block');
      await store.addBlock(Number(me), other);
    },
    async unblock(me, other) { await store.removeBlock(Number(me), Number(other)); },
    async blocked(me) { return store.listBlocks(Number(me)); },
    /** True when either person has blocked the other. */
    async between(a, b) { return store.isBlocked(Number(a), Number(b)); },
    async report(me, body, room) {
      const reported = Number(body?.userId);
      if (!Number.isSafeInteger(reported) || reported <= 0 || reported === Number(me)) throw err('Choose who you are reporting');
      const reason = REASONS.includes(body?.reason) ? body.reason : 'other';
      const details = typeof body?.details === 'string' ? body.details.trim().slice(0, 1000) : '';
      const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 2000) : '';
      const row = await store.addReport({ reporter: Number(me), reported, room_code: room?.room_code || null, reason, details, message, at: new Date(now()) });
      if (body?.block === true) await store.addBlock(Number(me), reported);
      return row;
    },
  };
}

function sqlStore(db) {
  let ready = null;
  const ensure = () => {
    if (!ready) ready = (async () => {
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS user_blocks (
        blocker INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        blocked INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (blocker, blocked))`);
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks(blocked)');
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS user_reports (
        report_id SERIAL PRIMARY KEY,
        reporter INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        reported INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        room_code TEXT, reason TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    })().catch(error => { ready = null; throw error; });
    return ready;
  };
  return {
    ensure,
    async addBlock(a, b) { await ensure(); await db.$executeRawUnsafe('INSERT INTO user_blocks (blocker, blocked) VALUES ($1, $2) ON CONFLICT DO NOTHING', a, b); },
    async removeBlock(a, b) { await ensure(); await db.$executeRawUnsafe('DELETE FROM user_blocks WHERE blocker = $1 AND blocked = $2', a, b); },
    async listBlocks(a) {
      await ensure();
      return (await db.$queryRawUnsafe('SELECT b.blocked, u.display_name FROM user_blocks b LEFT JOIN users u ON u.user_id = b.blocked WHERE b.blocker = $1 ORDER BY b.created_at DESC', a))
        .map(r => ({ id: String(r.blocked), name: r.display_name || 'Someone' }));
    },
    async isBlocked(a, b) { await ensure(); return (await db.$queryRawUnsafe('SELECT 1 FROM user_blocks WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1) LIMIT 1', a, b)).length > 0; },
    async addReport(r) {
      await ensure();
      return (await db.$queryRawUnsafe('INSERT INTO user_reports (reporter, reported, room_code, reason, details, message, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING report_id', r.reporter, r.reported, r.room_code, r.reason, r.details, r.message, r.at))[0];
    },
    async listReports(limit = 200) {
      await ensure();
      return db.$queryRawUnsafe(`SELECT r.*, a.display_name AS reporter_name, a.email AS reporter_email, b.display_name AS reported_name, b.email AS reported_email
        FROM user_reports r LEFT JOIN users a ON a.user_id = r.reporter LEFT JOIN users b ON b.user_id = r.reported ORDER BY r.created_at DESC LIMIT $1`, limit);
    },
    async setReportStatus(id, status) { await ensure(); await db.$executeRawUnsafe('UPDATE user_reports SET status = $2 WHERE report_id = $1', Number(id), status); },
  };
}

function memoryStore() {
  const blocks = new Set(); const reports = [];
  return {
    blocks, reports,
    async addBlock(a, b) { blocks.add(`${a}:${b}`); },
    async removeBlock(a, b) { blocks.delete(`${a}:${b}`); },
    async listBlocks(a) { return [...blocks].filter(k => k.startsWith(`${a}:`)).map(k => ({ id: k.split(':')[1], name: 'Someone' })); },
    async isBlocked(a, b) { return blocks.has(`${a}:${b}`) || blocks.has(`${b}:${a}`); },
    async addReport(r) { const row = { report_id: reports.length + 1, ...r }; reports.push(row); return row; },
    async listReports() { return [...reports].reverse(); },
    async setReportStatus(id, status) { const r = reports.find(x => x.report_id === Number(id)); if (r) r.status = status; },
  };
}
module.exports = { createSafety, sqlStore, memoryStore, REASONS };
