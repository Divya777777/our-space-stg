const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const { createAppleVerifier } = require('../utils/appleAuth');
const { createSafety, memoryStore } = require('../services/safety');
const { attachSafetyRoutes } = require('../routes/safety');
const { eraseAccount } = require('../services/accountDeletion');
const { createLegalRouter } = require('../routes/legal');
const { response } = require('./helpers');

test('Sign in with Apple: accepts a token signed by Apple for our app, rejects anything else', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  let fetches = 0;
  const verify = createAppleVerifier({ audiences: ['com.ourspace.mobile'], fetchImpl: async () => { fetches++; return { ok: true, json: async () => ({ keys: [jwk] }) }; } });
  const sign = (claims, opts = {}) => jwt.sign({ sub: 'apple-123', email: 'a@privaterelay.appleid.com', email_verified: 'true', ...claims }, privateKey, { algorithm: 'RS256', keyid: 'k1', issuer: 'https://appleid.apple.com', audience: 'com.ourspace.mobile', expiresIn: 600, ...opts });
  const payload = await verify(sign({}));
  assert.equal(payload.sub, 'apple-123');
  await verify(sign({}));
  assert.equal(fetches, 1, 'keys are cached');
  await assert.rejects(verify(sign({}, { audience: 'com.someone.else' })), /could not be verified/);
  await assert.rejects(verify(sign({}, { issuer: 'https://evil.example' })), /could not be verified/);
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(verify(jwt.sign({ sub: 'x' }, other, { algorithm: 'RS256', keyid: 'k1', issuer: 'https://appleid.apple.com', audience: 'com.ourspace.mobile' })), /could not be verified/);
  await assert.rejects(verify('not-a-token'), /could not be verified/);
});

test('report and block: routes, validation, block effects', async () => {
  const store = memoryStore();
  const safety = createSafety({ store });
  const router = express.Router();
  const route = handler => async (req, res) => { try { await handler(req, res); } catch (error) { res.status(error.status || 500).json({ error: error.message }); } };
  attachSafetyRoutes(router, { route, roomFor: async code => ({ room_code: code }), safety });
  const call = async (path, method, { body = {}, params = {}, userId = 1 } = {}) => {
    const res = Object.assign(response(), { set() { return this; } });
    const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
    await layer.route.stack.at(-1).handle({ user: { user_id: userId }, params, body, query: {} }, res);
    return res;
  };
  assert.equal((await call('/blocks', 'post', { body: { userId: 1 } })).statusCode, 400, 'cannot block yourself');
  assert.equal((await call('/blocks', 'post', { body: { userId: 2 } })).statusCode, 201);
  assert.equal(await safety.between(2, 1), true, 'block works both ways for calls and joins');
  assert.deepEqual((await call('/blocks', 'get')).data.blocked.map(b => b.id), ['2']);
  await call('/blocks/:userId', 'delete', { params: { userId: '2' } });
  assert.equal(await safety.between(1, 2), false);
  const r = await call('/reports', 'post', { userId: 1, body: { userId: 3, reason: 'harassment', details: 'rude', message: 'bad words', roomCode: 'MOON01', block: true } });
  assert.equal(r.statusCode, 201);
  assert.equal(store.reports[0].room_code, 'MOON01'); assert.equal(store.reports[0].message, 'bad words');
  assert.equal(await safety.between(1, 3), true, 'report can also block');
  assert.equal((await call('/reports', 'post', { body: { userId: 1 } })).statusCode, 400);
  assert.equal((await call('/reports', 'post', { body: { userId: 4, reason: 'weird' } })).statusCode, 201);
  assert.equal(store.reports[1].reason, 'other');
});

test('account deletion removes hosted rooms, the user and loose references', async () => {
  const calls = [];
  const db = {
    $executeRawUnsafe: async (q, ...p) => { calls.push(['sql', q.split(' ').slice(0, 3).join(' '), p[0]]); return 0; },
    room_members: { findMany: async () => [{ room: { room_code: 'MOON01' } }, { room: { room_code: 'SUN002' } }] },
    rooms: { deleteMany: async q => { calls.push(['rooms', q.where.host_user_id]); return { count: 1 }; } },
    users: { delete: async q => { calls.push(['user', q.where.user_id]); return {}; } },
  };
  const out = await eraseAccount(db, '7');
  assert.deepEqual(out.rooms, ['MOON01', 'SUN002']);
  assert.deepEqual(calls.slice(-2), [['rooms', 7], ['user', 7]]);
  assert.ok(calls.some(c => c[0] === 'sql' && c[1] === 'DELETE FROM user_blocks'));
});

test('public pages: privacy, terms, support and deletion request', async () => {
  const saved = [];
  const db = { $executeRawUnsafe: async (q, ...p) => { if (q.startsWith('INSERT')) saved.push(p); return 1; }, $queryRawUnsafe: async () => [] };
  const app = express(); app.use(createLegalRouter({ env: { APP_OWNER: 'Divya', SUPPORT_EMAIL: 'help@example.com', ADMIN_TOKEN: 'x'.repeat(32) }, db }));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const privacy = await (await fetch(base + '/privacy')).text();
    for (const must of ['end-to-end encrypted', 'YouTube API Services', 'https://www.youtube.com/t/terms', 'policies/privacy', 'security.google.com/settings/security/permissions', 'Health Connect', 'never use it for advertising', '/delete-account', 'help@example.com', 'Divya']) assert.ok(privacy.includes(must), must);
    const terms = await (await fetch(base + '/terms')).text();
    assert.ok(terms.includes('no tolerance for objectionable content or abusive users'));
    const del = await fetch(base + '/delete-account/request', { method: 'POST', body: new URLSearchParams({ email: 'me@example.com', note: 'bye' }), redirect: 'manual' });
    assert.equal(del.status, 303); assert.equal(saved[0][0], 'deletion'); assert.equal(saved[0][1], 'me@example.com');
    const bad = await fetch(base + '/support/request', { method: 'POST', body: new URLSearchParams({ email: 'nope', message: 'x' }), redirect: 'manual' });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(base + '/admin?token=wrong')).status, 404, 'admin hidden without the token');
    assert.equal((await fetch(base + '/admin?token=' + 'x'.repeat(32))).status, 200);
  } finally { server.close(); }
});
