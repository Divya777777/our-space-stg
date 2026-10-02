const test = require('node:test');
const assert = require('node:assert/strict');
const { createReplayCache } = require('../utils/replayCache');
test('concurrent retry shares one successful operation', async () => {
  const replay = createReplayCache(); let count = 0;
  const operation = async () => { count++; await new Promise(resolve => setTimeout(resolve, 5)); return { session: 123 }; };
  const values = await Promise.all([replay('identity', operation), replay('identity', operation)]);
  assert.equal(count, 1); assert.equal(values[0], values[1]);
});
test('failed operations are evicted so retry can recover', async () => {
  const replay = createReplayCache();
  await assert.rejects(replay('identity', () => { throw new Error('offline'); }));
  assert.equal(await replay('identity', () => 'recovered'), 'recovered');
});
test('cache expires and bounds retained credentials', async () => {
  const replay = createReplayCache({ max: 1, ttlMs: 5 });
  await replay('a', () => 1);
  await assert.rejects(replay('b', () => 2), error => error.status === 503);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await replay('b', () => 2), 2);
});
