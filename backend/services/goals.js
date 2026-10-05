// Shared goals for a room: personal goals ("Just me") and together goals ("Both of us").
// Days are the phone's local date as 'YYYY-MM-DD' text, so "today" means the same thing to the
// person who logged it. Progress is a number per person per day; a goal is done when value >= target.
// Tables are created by the backend itself (IF NOT EXISTS), like push_tokens — no manual DB step.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const KINDS = ['steps', 'water', 'pushups', 'workout', 'read', 'custom'];
const TRACKS = ['auto', 'count', 'check'];
const SPANS = ['month', 'ongoing', 'weekdays'];
const MAX_GOALS = 30;

const pad = n => String(n).padStart(2, '0');
const parts = day => day.split('-').map(Number);
const weekday = day => { const [y, m, d] = parts(day); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthEnd = day => { const [y, m] = parts(day); return `${y}-${pad(m)}-${pad(daysIn(y, m))}`; };
const validDay = day => { if (typeof day !== 'string' || !DAY.test(day)) return false; const [y, m, d] = parts(day); return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m); };

function activeOn(goal, day) {
  if (goal.starts_on > day) return false;
  if (goal.ends_on && day > goal.ends_on) return false;
  if (goal.archived_on && day >= goal.archived_on) return false;
  if (goal.span === 'weekdays') { const w = weekday(day); if (w === 0 || w === 6) return false; }
  return true;
}
/** Who does this goal: the owner, or everyone once a together goal is accepted (only the creator before). */
function participates(goal, userId) {
  if (goal.owner_user_id != null) return Number(goal.owner_user_id) === Number(userId);
  if (goal.pending) return Number(goal.created_by) === Number(userId);
  return true;
}

function createGoals({ store }) {
  const err = (message, status = 400) => Object.assign(new Error(message), { status });
  const memberIds = room => room.members.filter(m => !m.left_at).map(m => Number(m.user_id));
  /** The other person shown next to you (rooms are usually two people). */
  function partnerOf(room, me) {
    const other = room.members.find(m => !m.left_at && Number(m.user_id) !== Number(me));
    return other ? { id: Number(other.user_id), name: other.user?.display_name || 'Partner' } : null;
  }
  function visible(goal, room, me) {
    if (goal.owner_user_id == null) return memberIds(room).includes(Number(goal.created_by));
    const partner = partnerOf(room, me);
    return Number(goal.owner_user_id) === Number(me) || (partner && Number(goal.owner_user_id) === partner.id);
  }
  async function goalIn(room, goalId) {
    const goal = await store.getGoal(Number(goalId));
    if (!goal || Number(goal.room_id) !== Number(room.room_id) || goal.archived_on) throw err('Goal not found', 404);
    return goal;
  }
  const ownerFor = (goal, me, partner) => goal.owner_user_id == null ? 'both' : Number(goal.owner_user_id) === Number(me) ? 'me' : 'them';

  async function today(room, me, day) {
    if (!validDay(day)) throw err('Invalid day');
    const partner = partnerOf(room, me);
    const all = (await store.listGoals(room.room_id)).filter(g => activeOn(g, day) && visible(g, room, me));
    const ids = all.map(g => g.goal_id);
    const progress = ids.length ? await store.progress(ids, day, day) : [];
    const cheers = ids.length ? await store.cheers(ids, day) : [];
    const value = (g, u) => { const row = progress.find(p => p.goal_id === g.goal_id && Number(p.user_id) === Number(u)); return row ? Number(row.value) : 0; };
    return {
      day, partner: partner && { id: String(partner.id), name: partner.name },
      goals: all.map(g => {
        const owner = ownerFor(g, me, partner);
        const mineToDo = participates(g, me);
        return {
          id: String(g.goal_id), name: g.name, kind: g.kind, track: g.track, target: Number(g.target), unit: g.unit || '', inc: Number(g.inc) || 1,
          span: g.span, remind: !!g.remind, owner,
          pending: !!g.pending && Number(g.created_by) === Number(me),
          invited: !!g.pending && Number(g.created_by) !== Number(me),
          me: mineToDo ? value(g, me) : null,
          them: partner && participates(g, partner.id) ? value(g, partner.id) : null,
          cheered: !!partner && cheers.some(c => c.goal_id === g.goal_id && Number(c.from_user) === Number(me)),
          cheeredMe: !!partner && cheers.some(c => c.goal_id === g.goal_id && Number(c.to_user) === Number(me)),
          mine: Number(g.created_by) === Number(me),
        };
      }),
    };
  }

  async function create(room, me, body) {
    const day = body.day;
    if (!validDay(day)) throw err('Invalid day');
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';
    if (!name) throw err('Give your goal a name');
    const kind = KINDS.includes(body.kind) ? body.kind : 'custom';
    const track = TRACKS.includes(body.track) ? body.track : 'check';
    if (track === 'auto' && kind !== 'steps') throw err('Only steps are counted automatically');
    const target = track === 'check' ? 1 : Math.round(Number(body.target));
    if (!Number.isFinite(target) || target < 1 || target > 1000000) throw err('Pick a daily target');
    const inc = Math.max(1, Math.min(100000, Math.round(Number(body.inc) || 1)));
    const span = SPANS.includes(body.span) ? body.span : 'ongoing';
    const together = body.owner === 'both';
    if (together && !partnerOf(room, me)) throw err('Invite someone to this room first, then set a goal together');
    const existing = (await store.listGoals(room.room_id)).filter(g => !g.archived_on);
    if (existing.length >= MAX_GOALS) throw err('This room has a lot of goals already. Remove one first.');
    const goal = await store.insertGoal({
      room_id: room.room_id, created_by: Number(me), owner_user_id: together ? null : Number(me), name, kind, track, target,
      unit: typeof body.unit === 'string' ? body.unit.trim().slice(0, 20) : '', inc, span, remind: body.remind !== false,
      pending: together, starts_on: day, ends_on: span === 'month' ? monthEnd(day) : null, archived_on: null,
    });
    return goal;
  }

  async function join(room, me, goalId) {
    const goal = await goalIn(room, goalId);
    if (goal.owner_user_id != null || !goal.pending) throw err('Nothing to join');
    if (Number(goal.created_by) === Number(me)) throw err('Waiting for the other person to join');
    await store.updateGoal(goal.goal_id, { pending: false });
    return goal;
  }

  async function progress(room, me, goalId, day, value) {
    if (!validDay(day)) throw err('Invalid day');
    const goal = await goalIn(room, goalId);
    if (!participates(goal, me)) throw err('This goal is not yours to log', 403);
    if (!activeOn(goal, day)) throw err('This goal is not on for that day');
    let v = Math.round(Number(value));
    if (!Number.isFinite(v) || v < 0) throw err('Invalid value');
    v = goal.track === 'check' ? Math.min(1, v) : Math.min(v, Math.max(Number(goal.target) * 10, 1000000));
    const before = (await store.progress([goal.goal_id], day, day)).find(p => Number(p.user_id) === Number(me));
    await store.setProgress(goal.goal_id, Number(me), day, v);
    const was = before ? Number(before.value) : 0;
    return { goal, value: v, finished: was < Number(goal.target) && v >= Number(goal.target) };
  }

  async function cheer(room, me, goalId, day) {
    if (!validDay(day)) throw err('Invalid day');
    const goal = await goalIn(room, goalId);
    const partner = partnerOf(room, me);
    if (!partner || !participates(goal, partner.id)) throw err('Nobody to cheer on this goal');
    const added = await store.addCheer(goal.goal_id, Number(me), partner.id, day);
    return { goal, to: partner.id, added };
  }

  async function remove(room, me, goalId, day) {
    if (!validDay(day)) throw err('Invalid day');
    const goal = await goalIn(room, goalId);
    const mine = Number(goal.created_by) === Number(me) || Number(goal.owner_user_id) === Number(me);
    if (!mine) throw err('Only the person who made this goal can remove it', 403);
    // Kept for the monthly record of earlier days; it simply stops from today.
    await store.updateGoal(goal.goal_id, { archived_on: day });
  }

  async function month(room, me, monthKey, todayDay) {
    if (typeof monthKey !== 'string' || !MONTH.test(monthKey) || !validDay(todayDay)) throw err('Invalid month');
    const [y, m] = parts(monthKey + '-01');
    if (m < 1 || m > 12) throw err('Invalid month');
    const total = daysIn(y, m);
    const first = `${monthKey}-01`, last = `${monthKey}-${pad(total)}`;
    const upto = todayDay < first ? 0 : todayDay > last ? total : parts(todayDay)[2];
    const partner = partnerOf(room, me);
    const goals = (await store.listGoals(room.room_id)).filter(g => visible(g, room, me));
    const ids = goals.map(g => g.goal_id);
    const progress = ids.length && upto ? await store.progress(ids, first, `${monthKey}-${pad(upto)}`) : [];
    const valueOf = new Map(progress.map(p => [`${p.goal_id}:${Number(p.user_id)}:${p.day}`, Number(p.value)]));
    const people = [['me', Number(me)], ...(partner ? [['them', partner.id]] : [])];
    const tally = new Map();
    const days = [];
    for (let d = 1; d <= total; d++) {
      const day = `${monthKey}-${pad(d)}`;
      if (d > upto) { days.push({ d, future: true }); continue; }
      const entry = { d, rows: [] };
      for (const [w, uid] of people) {
        const list = goals.filter(g => activeOn(g, day) && participates(g, uid));
        let ok = 0;
        for (const g of list) {
          const done = (valueOf.get(`${g.goal_id}:${uid}:${day}`) || 0) >= Number(g.target);
          if (done) ok++;
          entry.rows.push({ goalId: String(g.goal_id), name: g.name, w, ok: done });
          const key = `${g.goal_id}:${w}`;
          const t = tally.get(key) || { name: g.name, w, n: 0, ok: 0 };
          t.n++; if (done) t.ok++; tally.set(key, t);
        }
        entry[w] = list.length ? Math.round((ok / list.length) * 100) : null;
      }
      days.push(entry);
    }
    return {
      month: monthKey, partner: partner && { id: String(partner.id), name: partner.name },
      days, rates: [...tally.values()].map(t => ({ name: t.name, w: t.w, pct: Math.round((t.ok / t.n) * 100) })),
    };
  }

  return { today, create, join, progress, cheer, remove, month, partnerOf };
}

/** Postgres store with plain SQL (works whatever Prisma client is deployed). */
function sqlStore(db) {
  let ready = null;
  const ensure = () => {
    if (!ready) ready = (async () => {
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS room_goals (
        goal_id SERIAL PRIMARY KEY,
        room_id INTEGER NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        created_by INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        owner_user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
        name TEXT NOT NULL, kind TEXT NOT NULL, track TEXT NOT NULL,
        target INTEGER NOT NULL, unit TEXT NOT NULL DEFAULT '', inc INTEGER NOT NULL DEFAULT 1,
        span TEXT NOT NULL, remind BOOLEAN NOT NULL DEFAULT TRUE, pending BOOLEAN NOT NULL DEFAULT FALSE,
        starts_on TEXT NOT NULL, ends_on TEXT, archived_on TEXT,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS room_goals_room_id_idx ON room_goals(room_id)');
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS goal_progress (
        goal_id INTEGER NOT NULL REFERENCES room_goals(goal_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        day TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (goal_id, user_id, day))`);
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS goal_cheers (
        goal_id INTEGER NOT NULL REFERENCES room_goals(goal_id) ON DELETE CASCADE,
        from_user INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        to_user INTEGER NOT NULL, day TEXT NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (goal_id, from_user, day))`);
    })().catch(error => { ready = null; throw error; });
    return ready;
  };
  const list = (n, from = 1) => Array.from({ length: n }, (_, i) => '$' + (i + from)).join(', ');
  const cols = 'goal_id, room_id, created_by, owner_user_id, name, kind, track, target, unit, inc, span, remind, pending, starts_on, ends_on, archived_on';
  return {
    async listGoals(roomId) { await ensure(); return db.$queryRawUnsafe(`SELECT ${cols} FROM room_goals WHERE room_id = $1 ORDER BY goal_id`, Number(roomId)); },
    async getGoal(goalId) { await ensure(); return (await db.$queryRawUnsafe(`SELECT ${cols} FROM room_goals WHERE goal_id = $1`, Number(goalId)))[0] || null; },
    async insertGoal(g) {
      await ensure();
      return (await db.$queryRawUnsafe(`INSERT INTO room_goals (room_id, created_by, owner_user_id, name, kind, track, target, unit, inc, span, remind, pending, starts_on, ends_on, archived_on)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING ${cols}`,
      g.room_id, g.created_by, g.owner_user_id, g.name, g.kind, g.track, g.target, g.unit, g.inc, g.span, g.remind, g.pending, g.starts_on, g.ends_on, g.archived_on))[0];
    },
    async updateGoal(goalId, patch) {
      await ensure();
      const keys = Object.keys(patch).filter(k => ['pending', 'archived_on'].includes(k));
      if (!keys.length) return;
      await db.$executeRawUnsafe(`UPDATE room_goals SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE goal_id = $1`, Number(goalId), ...keys.map(k => patch[k]));
    },
    async progress(goalIds, from, to) {
      await ensure();
      return db.$queryRawUnsafe(`SELECT goal_id, user_id, day, value FROM goal_progress WHERE goal_id IN (${list(goalIds.length, 3)}) AND day >= $1 AND day <= $2`, from, to, ...goalIds.map(Number));
    },
    async setProgress(goalId, userId, day, value) {
      await ensure();
      await db.$executeRawUnsafe(`INSERT INTO goal_progress (goal_id, user_id, day, value, updated_at) VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (goal_id, user_id, day) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, Number(goalId), Number(userId), day, Number(value));
    },
    async cheers(goalIds, day) {
      await ensure();
      return db.$queryRawUnsafe(`SELECT goal_id, from_user, to_user FROM goal_cheers WHERE day = $1 AND goal_id IN (${list(goalIds.length, 2)})`, day, ...goalIds.map(Number));
    },
    async addCheer(goalId, from, to, day) {
      await ensure();
      return (await db.$executeRawUnsafe('INSERT INTO goal_cheers (goal_id, from_user, to_user, day) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', Number(goalId), Number(from), Number(to), day)) > 0;
    },
    ensure,
  };
}

/** In-memory store with the same shape, for tests. */
function memoryStore() {
  const goals = []; const progress = new Map(); const cheers = new Map();
  return {
    goals,
    async listGoals(roomId) { return goals.filter(g => g.room_id === Number(roomId)).map(g => ({ ...g })); },
    async getGoal(goalId) { const g = goals.find(x => x.goal_id === Number(goalId)); return g ? { ...g } : null; },
    async insertGoal(g) { const row = { ...g, goal_id: goals.length + 1 }; goals.push(row); return { ...row }; },
    async updateGoal(goalId, patch) { Object.assign(goals.find(x => x.goal_id === Number(goalId)), patch); },
    async progress(goalIds, from, to) { return [...progress.values()].filter(p => goalIds.includes(p.goal_id) && p.day >= from && p.day <= to); },
    async setProgress(goalId, userId, day, value) { progress.set(`${goalId}:${userId}:${day}`, { goal_id: goalId, user_id: userId, day, value }); },
    async cheers(goalIds, day) { return [...cheers.values()].filter(c => goalIds.includes(c.goal_id) && c.day === day); },
    async addCheer(goalId, from, to, day) { const key = `${goalId}:${from}:${day}`; if (cheers.has(key)) return false; cheers.set(key, { goal_id: goalId, from_user: from, to_user: to, day }); return true; },
  };
}

module.exports = { createGoals, sqlStore, memoryStore, activeOn, participates, monthEnd, validDay };
