const test = require('node:test');
const assert = require('node:assert/strict');
const { createPush } = require('../services/push');
const token = n => `ExponentPushToken[abc${n}]`;
function fakeDb(rows) {
  const deleted = [];
  return { deleted, push_tokens: {
    upsert: async q => { rows.push({ token: q.create.token, user_id: q.create.user_id }); },
    deleteMany: async q => { deleted.push(q.where); },
    findMany: async q => rows.filter(r => q.where.user_id.in.includes(r.user_id)).map(r => ({ token: r.token })),
  } };
}
test('push sends who/where to member phones, throttles, and forgets dead tokens', async () => {
  const rows = []; const db = fakeDb(rows); const sent = [];
  const fetchImpl = async (_url, init) => { const body = JSON.parse(init.body); sent.push(...body); return { json: async () => ({ data: body.map((m, i) => i === 0 ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }) }) }; };
  const push = createPush({ db, fetchImpl, env: {} });
  await assert.rejects(push.register(1, 'nope', 'android'), e => e.status === 400);
  await push.register(2, token(2), 'android'); await push.register(3, token(3), 'ios');
  assert.equal(await push.send([2, 3], { title: 'Room', body: 'Riya sent a message' }, { throttleKey: 'msg:7', throttleMs: 8000 }), 2);
  assert.equal(await push.send([2, 3], { title: 'Room', body: 'again' }, { throttleKey: 'msg:7', throttleMs: 8000 }), 0);
  assert.equal(sent.length, 2); assert.equal(sent[0].body, 'Riya sent a message');
  assert.deepEqual(db.deleted[0], { token: { in: [token(2)] } });
});
test('missing table (migration not applied) never breaks requests', async () => {
  const err = Object.assign(new Error('The table `public.push_tokens` does not exist'), { code: 'P2021' });
  const db = { push_tokens: { upsert: async () => { throw err; }, findMany: async () => { throw err; }, deleteMany: async () => { throw err; } } };
  const push = createPush({ db, fetchImpl: async () => { throw new Error('should not send'); }, env: {} });
  await push.register(1, token(1), 'android');
  assert.equal(await push.send([1], { title: 't' }), 0);
});
test('the backend creates its push table itself, once', async () => {
  const sql = [];
  const db = { $executeRawUnsafe: async q => { sql.push(q); }, push_tokens: { upsert: async () => {}, findMany: async () => [], deleteMany: async () => {} } };
  const push = createPush({ db, fetchImpl: async () => ({ json: async () => ({}) }), env: {} });
  await push.register(1, token(9), 'android'); await push.send([1], { title: 't' });
  assert.equal(sql.filter(q => /CREATE TABLE IF NOT EXISTS push_tokens/.test(q)).length, 1);
});
