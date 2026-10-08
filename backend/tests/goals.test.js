const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createGoals, memoryStore, activeOn } = require('../services/goals');
const { attachGoalRoutes } = require('../routes/goals');
const { response } = require('./helpers');

function setup() {
  const room = { room_id: 7, room_code: 'MOON01', room_name: 'Moon', members: [1, 2].map(user_id => ({ user_id, user: { user_id, display_name: user_id === 1 ? 'Divya' : 'Leo' } })) };
  const pushes = [];
  const router = express.Router();
  const route = handler => async (req, res) => { try { await handler(req, res); } catch (error) { res.status(error.status || 500).json({ error: error.message }); } };
  const store = memoryStore();
  attachGoalRoutes(router, { roomFor: async () => room, route, roomTitle: r => r.room_name, pusher: { notify: (to, msg) => pushes.push({ to, body: msg.body }) }, goals: createGoals({ store }) });
  const call = async (path, method, { body = {}, query = {}, userId = 1, id } = {}) => {
    const res = Object.assign(response(), { set() { return this; } });
    const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
    await layer.route.stack.at(-1).handle({ user: { user_id: userId, display_name: userId === 1 ? 'Divya' : 'Leo' }, params: { code: 'MOON01', id }, body, query }, res);
    return res;
  };
  return { call, pushes, store };
}
const DAY = '2026-10-05'; // a Monday

test('personal and together goals: invite, join, log progress, cheer, finish notification', async () => {
  const s = setup();
  const water = await s.call('/rooms/:code/goals', 'post', { body: { name: 'Drink 8 glasses of water', kind: 'water', track: 'count', target: 8, unit: 'glasses', inc: 1, owner: 'me', span: 'month', day: DAY } });
  assert.equal(water.statusCode, 201);
  const steps = await s.call('/rooms/:code/goals', 'post', { body: { name: 'Walk 10,000 steps', kind: 'steps', track: 'auto', target: 10000, unit: 'steps', owner: 'both', span: 'ongoing', day: DAY } });
  assert.match(s.pushes[0].body, /wants to do “Walk 10,000 steps” together/);

  let leo = (await s.call('/rooms/:code/goals', 'get', { userId: 2, query: { day: DAY } })).data;
  const invite = leo.goals.find(g => g.name.startsWith('Walk'));
  assert.equal(invite.invited, true); assert.equal(invite.me, null);
  assert.equal(leo.goals.find(g => g.kind === 'water').owner, 'them');
  assert.equal((await s.call('/rooms/:code/goals/:id/progress', 'post', { userId: 2, id: steps.data.id, body: { day: DAY, value: 500 } })).statusCode, 403);
  assert.equal((await s.call('/rooms/:code/goals/:id/join', 'post', { userId: 2, id: steps.data.id })).statusCode, 200);
  assert.match(s.pushes.at(-1).body, /Leo joined/);

  await s.call('/rooms/:code/goals/:id/progress', 'post', { userId: 2, id: steps.data.id, body: { day: DAY, value: 10312 } });
  assert.match(s.pushes.at(-1).body, /Leo finished “Walk 10,000 steps”/);
  await s.call('/rooms/:code/goals/:id/progress', 'post', { userId: 1, id: water.data.id, body: { day: DAY, value: 6 } });
  assert.equal((await s.call('/rooms/:code/goals/:id/progress', 'post', { userId: 2, id: water.data.id, body: { day: DAY, value: 3 } })).statusCode, 403);
  assert.equal((await s.call('/rooms/:code/goals/:id/cheer', 'post', { userId: 2, id: water.data.id, body: { day: DAY } })).statusCode, 200);
  await s.call('/rooms/:code/goals/:id/cheer', 'post', { userId: 2, id: water.data.id, body: { day: DAY } });
  assert.equal(s.pushes.filter(p => /cheering you on/.test(p.body)).length, 1);

  const me = (await s.call('/rooms/:code/goals', 'get', { query: { day: DAY } })).data;
  assert.equal(me.partner.name, 'Leo');
  const walk = me.goals.find(g => g.kind === 'steps');
  assert.deepEqual([walk.owner, walk.pending, walk.me, walk.them], ['both', false, 0, 10312]);
  const w = me.goals.find(g => g.kind === 'water');
  assert.deepEqual([w.owner, w.me, w.them, w.cheeredMe], ['me', 6, null, true]);
});

test('monthly record: daily scores, rates, weekdays-only and removed goals', async () => {
  const s = setup();
  const a = (await s.call('/rooms/:code/goals', 'post', { body: { name: 'Read', kind: 'read', track: 'check', owner: 'me', span: 'weekdays', day: '2026-10-01' } })).data.id;
  const b = (await s.call('/rooms/:code/goals', 'post', { body: { name: 'Push-ups', kind: 'pushups', track: 'count', target: 30, inc: 10, owner: 'me', span: 'ongoing', day: '2026-10-01' } })).data.id;
  for (const day of ['2026-10-01', '2026-10-02']) await s.call('/rooms/:code/goals/:id/progress', 'post', { id: a, body: { day, value: 1 } });
  await s.call('/rooms/:code/goals/:id/progress', 'post', { id: b, body: { day: '2026-10-01', value: 30 } });
  assert.equal((await s.call('/rooms/:code/goals/:id/progress', 'post', { id: a, body: { day: '2026-10-03', value: 1 } })).statusCode, 400); // Saturday
  assert.equal((await s.call('/rooms/:code/goals/:id', 'delete', { userId: 2, id: b, query: { day: '2026-10-04' } })).statusCode, 403);
  await s.call('/rooms/:code/goals/:id', 'delete', { id: b, query: { day: '2026-10-04' } });
  const m = (await s.call('/rooms/:code/goals-month', 'get', { query: { month: '2026-10', today: DAY } })).data;
  assert.equal(m.days.length, 31);
  assert.deepEqual(m.days.slice(0, 5).map(d => d.me), [100, 50, 0, null, 0]);
  assert.equal(m.days[0].them, null); assert.equal(m.days[5].future, true);
  assert.deepEqual(m.rates.map(r => [r.name, r.pct]), [['Read', 67], ['Push-ups', 33]]);
  const today = (await s.call('/rooms/:code/goals', 'get', { query: { day: DAY } })).data;
  assert.deepEqual(today.goals.map(g => g.name), ['Read']);
});

test('validation and spans', async () => {
  const s = setup();
  assert.equal((await s.call('/rooms/:code/goals', 'post', { body: { name: ' ', day: DAY } })).statusCode, 400);
  assert.equal((await s.call('/rooms/:code/goals', 'post', { body: { name: 'x', track: 'auto', kind: 'water', day: DAY } })).statusCode, 400);
  assert.equal((await s.call('/rooms/:code/goals', 'get', { query: { day: '2026-02-30' } })).statusCode, 400);
  assert.equal(activeOn({ starts_on: '2026-10-05', ends_on: '2026-10-31', span: 'month' }, '2026-11-01'), false);
  assert.equal(activeOn({ starts_on: '2026-10-05', span: 'ongoing' }, '2027-01-01'), true);
});

test('one goal per kind for each person; custom goals can repeat', async () => {
  const s = setup();
  const post = (body, userId = 1) => s.call('/rooms/:code/goals', 'post', { userId, body: { track: 'count', target: 8, inc: 1, span: 'ongoing', day: DAY, ...body } });
  assert.equal((await post({ name: 'Water', kind: 'water', owner: 'me' })).statusCode, 201);
  const again = await post({ name: 'More water', kind: 'water', owner: 'me' });
  assert.equal(again.statusCode, 400);
  assert.match(again.data.error, /already have a water goal/);
  assert.equal((await post({ name: 'Water', kind: 'water', owner: 'me' }, 2)).statusCode, 201, 'the other person can have their own');
  const both = await post({ name: 'Water together', kind: 'water', owner: 'both' });
  assert.equal(both.statusCode, 400);
  assert.equal((await post({ name: 'Stretch', kind: 'custom', track: 'check', owner: 'me' })).statusCode, 201);
  assert.equal((await post({ name: 'Stretch again', kind: 'custom', track: 'check', owner: 'me' })).statusCode, 201);
});
