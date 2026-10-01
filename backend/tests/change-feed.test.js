const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ChangeFeed } = require('../utils/changeFeed');

test('a change immediately releases a waiting client, without waiting for heartbeat', async () => {
  const feed = new ChangeFeed(); const response = new EventEmitter();
  let resolved = false;
  const waiting = feed.wait('room:1', feed.version('room:1'), response, 15000).then(() => { resolved = true; });
  await Promise.resolve(); assert.equal(resolved, false);
  feed.notify('room:1'); await waiting;
  assert.equal(resolved, true); assert.equal(feed.waiters.size, 0); assert.equal(response.listenerCount('close'), 0);
});
test('a change before subscription is not missed and rooms remain isolated', async () => {
  const feed = new ChangeFeed(); const response = new EventEmitter();
  const old = feed.version('room:1'); feed.notify('room:1');
  await feed.wait('room:1', old, response); assert.equal(feed.waiters.size, 0);
  let done = false;
  const pending = feed.wait('room:2', feed.version('room:2'), response).then(() => { done = true; });
  feed.notify('room:1'); await Promise.resolve(); assert.equal(done, false);
  response.emit('close'); await pending; assert.equal(feed.waiters.size, 0);
});
test('heartbeat and server shutdown release resources', async () => {
  const feed = new ChangeFeed(); const response = new EventEmitter();
  await feed.wait('room:1', feed.version('room:1'), response, 5); assert.equal(feed.waiters.size, 0);
  const pending = feed.wait('room:1', feed.version('room:1'), response);
  feed.close(); await pending; assert.equal(feed.waiters.size, 0);
});
