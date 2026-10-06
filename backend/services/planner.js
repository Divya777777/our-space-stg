// Planner: study dates, movie dates, playdates. Everyone in the room gets a reminder 1 hour before.
// Phones schedule the reminder locally and tell the server ("armed"); the server pushes to anyone
// whose phone didn't, so a member who hasn't opened the app since the plan was made is still reminded.
const KINDS = { study: 'Study date', movie: 'Movie date', play: 'Playdate', other: 'Plan' };
const HOUR = 60 * 60 * 1000;

function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }

function createPlanner({ store, now = () => Date.now() }) {
  const view = (p, userId, names) => ({
    id: String(p.plan_id), code: p.room_code, roomName: p.room_name || 'Our space', kind: KINDS[p.kind] ? p.kind : 'other',
    title: p.title, note: p.note || '', startsAt: new Date(p.starts_at).getTime(),
    by: { id: String(p.created_by), name: names?.get(Number(p.created_by)) || p.by_name || 'Someone' }, mine: Number(p.created_by) === Number(userId),
  });
  function parse(body, { partial = false } = {}) {
    const out = {};
    if (!partial || body.kind !== undefined) out.kind = KINDS[body.kind] ? body.kind : 'other';
    if (!partial || body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : '';
      out.title = title || KINDS[out.kind || 'other'];
    }
    if (!partial || body.note !== undefined) out.note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
    if (!partial || body.startsAt !== undefined) {
      const at = Number(body.startsAt);
      if (!Number.isFinite(at)) fail('Pick a date and time');
      if (at < now() - 5 * 60 * 1000) fail('That time has already passed. Pick a time later than now.');
      if (at > now() + 400 * 24 * HOUR) fail('Plans can be up to a year ahead');
      out.starts_at = new Date(at);
    }
    return out;
  }
  const names = room => new Map(room.members.map(m => [Number(m.user_id), m.user?.display_name || 'Someone']));
  return {
    KINDS,
    async forRoom(room, userId) {
      const rows = await store.roomPlans(room.room_id, new Date(now() - 3 * HOUR));
      return rows.map(p => view({ ...p, room_code: room.room_code, room_name: room.room_name }, userId, names(room)));
    },
    async forUser(userId) {
      return (await store.userPlans(userId, new Date(now() - 3 * HOUR))).map(p => view(p, userId));
    },
    async create(room, userId, body) {
      const data = parse(body || {});
      const p = await store.insert({ room_id: room.room_id, created_by: userId, ...data });
      return view({ ...p, room_code: room.room_code, room_name: room.room_name }, userId, names(room));
    },
    async update(room, userId, planId, body) {
      const p = await store.get(planId);
      if (!p || Number(p.room_id) !== Number(room.room_id) || p.cancelled_at) fail('Plan not found', 404);
      if (Number(p.created_by) !== Number(userId) && Number(room.host_user_id) !== Number(userId)) fail('Only the person who made the plan or the room admin can change it', 403);
      const patch = parse(body || {}, { partial: true });
      const moved = patch.starts_at && new Date(patch.starts_at).getTime() !== new Date(p.starts_at).getTime();
      const next = await store.update(planId, patch);
      if (moved) await store.clearReminders(planId);
      return { plan: view({ ...next, room_code: room.room_code, room_name: room.room_name }, userId, names(room)), moved };
    },
    async cancel(room, userId, planId) {
      const p = await store.get(planId);
      if (!p || Number(p.room_id) !== Number(room.room_id) || p.cancelled_at) fail('Plan not found', 404);
      if (Number(p.created_by) !== Number(userId) && Number(room.host_user_id) !== Number(userId)) fail('Only the person who made the plan or the room admin can cancel it', 403);
      await store.update(planId, { cancelled_at: new Date(now()) });
      return view({ ...p, room_code: room.room_code, room_name: room.room_name }, userId, names(room));
    },
    /** The phone scheduled its own reminder for these plans, so the server won't push one. */
    async arm(userId, ids) {
      const list = (Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0).slice(0, 100);
      if (list.length) await store.arm(userId, list);
      return list.length;
    },
    /** Push "in 1 hour" to members whose phone didn't arm a local reminder. Safe to run on many servers at once. */
    async sweep(pusher) {
      const due = await store.due(new Date(now()), new Date(now() + HOUR + 60 * 1000));
      for (const p of due) {
        const to = await store.claim(p.plan_id, p.room_id);
        if (!to.length) continue;
        const mins = Math.max(1, Math.round((new Date(p.starts_at).getTime() - now()) / 60000));
        pusher?.notify(to, {
          title: p.room_name || 'Our space', body: `${p.title} starts ${mins >= 55 ? 'in 1 hour' : `in ${mins} min`}`,
          data: { type: 'plan', code: p.room_code, planId: String(p.plan_id) }, channelId: 'messages', sound: 'default', priority: 'high',
        });
      }
      return due.length;
    },
    startSweep(pusher, every = 60 * 1000) {
      const run = () => { this.sweep(pusher).catch(() => {}); };
      const timer = setInterval(run, every); timer.unref?.(); setTimeout(run, 5000).unref?.();
      return () => clearInterval(timer);
    },
  };
}

function sqlStore(db) {
  let ready = null;
  const ensure = () => {
    if (!ready) ready = (async () => {
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS room_plans (
        plan_id SERIAL PRIMARY KEY,
        room_id INTEGER NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        created_by INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        kind TEXT NOT NULL, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        starts_at TIMESTAMPTZ NOT NULL, cancelled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS room_plans_room_starts_idx ON room_plans(room_id, starts_at)');
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS room_plans_starts_idx ON room_plans(starts_at) WHERE cancelled_at IS NULL');
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS plan_reminders (
        plan_id INTEGER NOT NULL REFERENCES room_plans(plan_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        via TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (plan_id, user_id))`);
    })().catch(error => { ready = null; throw error; });
    return ready;
  };
  const cols = 'p.plan_id, p.room_id, p.created_by, p.kind, p.title, p.note, p.starts_at, p.cancelled_at';
  return {
    ensure,
    async roomPlans(roomId, since) {
      await ensure();
      return db.$queryRawUnsafe(`SELECT ${cols} FROM room_plans p WHERE p.room_id = $1 AND p.cancelled_at IS NULL AND p.starts_at >= $2 ORDER BY p.starts_at LIMIT 30`, Number(roomId), since);
    },
    async userPlans(userId, since) {
      await ensure();
      return db.$queryRawUnsafe(`SELECT ${cols}, r.room_code, r.room_name, u.display_name AS by_name FROM room_plans p
        JOIN rooms r ON r.room_id = p.room_id AND r.is_active
        JOIN room_members m ON m.room_id = p.room_id AND m.user_id = $1
        LEFT JOIN users u ON u.user_id = p.created_by
        WHERE p.cancelled_at IS NULL AND p.starts_at >= $2 ORDER BY p.starts_at LIMIT 30`, Number(userId), since);
    },
    async get(planId) {
      await ensure();
      return (await db.$queryRawUnsafe(`SELECT ${cols} FROM room_plans p WHERE p.plan_id = $1`, Number(planId)))[0] || null;
    },
    async insert(p) {
      await ensure();
      return (await db.$queryRawUnsafe(`INSERT INTO room_plans AS p (room_id, created_by, kind, title, note, starts_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${cols}`,
        Number(p.room_id), Number(p.created_by), p.kind, p.title, p.note, p.starts_at))[0];
    },
    async update(planId, patch) {
      await ensure();
      const keys = Object.keys(patch).filter(k => ['kind', 'title', 'note', 'starts_at', 'cancelled_at'].includes(k));
      if (keys.length) await db.$executeRawUnsafe(`UPDATE room_plans SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE plan_id = $1`, Number(planId), ...keys.map(k => patch[k]));
      return this.get(planId);
    },
    async clearReminders(planId) { await ensure(); await db.$executeRawUnsafe('DELETE FROM plan_reminders WHERE plan_id = $1', Number(planId)); },
    async arm(userId, ids) {
      await ensure();
      await db.$executeRawUnsafe(`INSERT INTO plan_reminders (plan_id, user_id, via)
        SELECT p.plan_id, $1, 'device' FROM room_plans p JOIN room_members m ON m.room_id = p.room_id AND m.user_id = $1
        WHERE p.plan_id = ANY($2::int[]) AND p.cancelled_at IS NULL ON CONFLICT DO NOTHING`, Number(userId), ids);
    },
    async due(from, to) {
      await ensure();
      return db.$queryRawUnsafe(`SELECT ${cols}, r.room_code, r.room_name FROM room_plans p JOIN rooms r ON r.room_id = p.room_id AND r.is_active
        WHERE p.cancelled_at IS NULL AND p.starts_at > $1 AND p.starts_at <= $2 ORDER BY p.starts_at LIMIT 200`, from, to);
    },
    /** Atomically takes the reminder for every member nobody has reminded yet; returns who to push. */
    async claim(planId, roomId) {
      await ensure();
      const rows = await db.$queryRawUnsafe(`INSERT INTO plan_reminders (plan_id, user_id, via)
        SELECT $1, m.user_id, 'push' FROM room_members m WHERE m.room_id = $2 ON CONFLICT DO NOTHING RETURNING user_id`, Number(planId), Number(roomId));
      return rows.map(r => Number(r.user_id));
    },
  };
}

function memoryStore({ members = new Map(), rooms = new Map() } = {}) {
  const plans = []; const reminders = new Set(); let seq = 0;
  const alive = p => !p.cancelled_at;
  return {
    plans, reminders,
    async roomPlans(roomId, since) { return plans.filter(p => p.room_id === roomId && alive(p) && p.starts_at >= since).sort((a, b) => a.starts_at - b.starts_at); },
    async userPlans(userId, since) {
      return plans.filter(p => alive(p) && p.starts_at >= since && (members.get(p.room_id) || []).includes(userId)).sort((a, b) => a.starts_at - b.starts_at)
        .map(p => ({ ...p, room_code: rooms.get(p.room_id)?.room_code, room_name: rooms.get(p.room_id)?.room_name }));
    },
    async get(id) { return plans.find(p => p.plan_id === Number(id)) || null; },
    async insert(p) { const row = { ...p, plan_id: ++seq, cancelled_at: null }; plans.push(row); return { ...row }; },
    async update(id, patch) { const p = plans.find(x => x.plan_id === Number(id)); Object.assign(p, patch); return { ...p }; },
    async clearReminders(id) { for (const k of [...reminders]) if (k.startsWith(`${id}:`)) reminders.delete(k); },
    async arm(userId, ids) { for (const id of ids) { const p = plans.find(x => x.plan_id === id); if (p && (members.get(p.room_id) || []).includes(userId)) reminders.add(`${id}:${userId}`); } },
    async due(from, to) { return plans.filter(p => alive(p) && p.starts_at > from && p.starts_at <= to).map(p => ({ ...p, room_code: rooms.get(p.room_id)?.room_code, room_name: rooms.get(p.room_id)?.room_name })); },
    async claim(planId, roomId) { const out = []; for (const u of members.get(roomId) || []) { const k = `${planId}:${u}`; if (!reminders.has(k)) { reminders.add(k); out.push(u); } } return out; },
  };
}

module.exports = { createPlanner, sqlStore, memoryStore, KINDS };
