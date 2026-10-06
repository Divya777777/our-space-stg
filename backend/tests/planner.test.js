const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPlanner, memoryStore } = require('../services/planner');
const { attachPlannerRoutes } = require('../routes/planner');
const { response } = require('./helpers');

const HOUR = 3600 * 1000;
function setup() {
  const names = ['Divya', 'Leo', 'Asha'];
  const room = { room_id: 7, room_code: 'MOON01', room_name: 'Moon', host_user_id: 1, members: names.map((n, i) => ({ user_id: i + 1, user: { user_id: i + 1, display_name: n } })) };
  const store = memoryStore({ members: new Map([[7, [1, 2, 3]]]), rooms: new Map([[7, room]]) });
  const pushes = [];
  let clock = Date.UTC(2026, 9, 6, 10, 0);
  const pusher = { notify: (to, msg) => pushes.push({ to, body: msg.body, data: msg.data }) };
  const planner = createPlanner({ store, now: () => clock });
  const router = express.Router();
  const route = handler => async (req, res) => { try { await handler(req, res); } catch (error) { res.status(error.status || 500).json({ error: error.message }); } };
  attachPlannerRoutes(router, { roomFor: async () => room, route, roomTitle: r => r.room_name, pusher, planner });
  const call = async (path, method, { body = {}, userId = 1, id } = {}) => {
    const res = Object.assign(response(), { set() { return this; } });
    const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
    await layer.route.stack.at(-1).handle({ user: { user_id: userId, display_name: names[userId - 1] }, params: { code: 'MOON01', id }, body, query: {} }, res);
    return res;
  };
  return { call, pushes, planner, pusher, store, tick: ms => { clock += ms; }, now: () => clock };
}

test('a plan tells the others, shows on room and home lists, and only the maker or admin can change it', async () => {
  const s = setup();
  const made = await s.call('/rooms/:code/planner', 'post', { body: { kind: 'movie', title: '', startsAt: s.now() + 5 * HOUR, timeZone: 'Asia/Kolkata' } });
  assert.equal(made.statusCode, 201);
  assert.equal(made.data.plan.title, 'Movie date');
  assert.deepEqual(s.pushes[0].to, [2, 3]);
  assert.match(s.pushes[0].body, /Divya planned “Movie date” · .*8:30 PM/);
  const room = await s.call('/rooms/:code/planner', 'get', { userId: 2 });
  assert.equal(room.data.plans.length, 1);
  assert.equal(room.data.plans[0].mine, false);
  const home = await s.call('/planner', 'get', { userId: 3 });
  assert.equal(home.data.plans[0].roomName, 'Moon');
  const id = made.data.plan.id;
  const denied = await s.call('/rooms/:code/planner/:id', 'patch', { userId: 2, id, body: { title: 'x' } });
  assert.equal(denied.statusCode, 403);
  const past = await s.call('/rooms/:code/planner', 'post', { body: { kind: 'study', startsAt: s.now() - HOUR } });
  assert.equal(past.statusCode, 400);
  const gone = await s.call('/rooms/:code/planner/:id', 'delete', { userId: 1, id });
  assert.equal(gone.data.cancelled, true);
  assert.match(s.pushes.at(-1).body, /cancelled/);
  assert.equal((await s.call('/planner', 'get', { userId: 2 })).data.plans.length, 0);
});

test('reminder 1 hour before: pushed once, skipped for phones that armed a local reminder, re-armed after a move', async () => {
  const s = setup();
  const made = await s.call('/rooms/:code/planner', 'post', { body: { kind: 'study', startsAt: s.now() + 3 * HOUR } });
  const id = made.data.plan.id; s.pushes.length = 0;
  await s.call('/planner/armed', 'post', { userId: 2, body: { ids: [id] } });
  await s.planner.sweep(s.pusher);
  assert.equal(s.pushes.length, 0, 'too early');
  s.tick(2 * HOUR);
  await s.planner.sweep(s.pusher);
  assert.deepEqual(s.pushes.map(p => p.to), [[1, 3]]);
  assert.match(s.pushes[0].body, /Study date starts in 1 hour/);
  await s.planner.sweep(s.pusher);
  assert.equal(s.pushes.length, 1, 'never twice');
  const moved = await s.call('/rooms/:code/planner/:id', 'patch', { id, body: { startsAt: s.now() + 2 * HOUR } });
  assert.equal(moved.statusCode, 200);
  s.pushes.length = 0; s.tick(HOUR);
  await s.planner.sweep(s.pusher);
  assert.deepEqual(s.pushes[0].to, [1, 2, 3]);
});
