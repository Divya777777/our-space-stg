const test = require('node:test');
const assert = require('node:assert/strict');
const { load, response } = require('./helpers');
function authWith(findFirst, verify = () => ({ userId: 1 })) {
  return load('middleware/auth.js', {
    '@prisma/client': { PrismaClient: function () { return { user_sessions: { findFirst } }; } },
    jsonwebtoken: { verify },
    './security': { getClientIp: () => 'test', getUserAgent: () => 'test' },
    '../utils/auditLogger': { logSecurityEvent: async () => {} }
  });
}
test('temporary database failure returns 503 rather than logging the user out', async () => {
  const auth = authWith(async () => { throw new Error('database unreachable'); });
  const res = response();
  await auth.authenticate({ headers: { authorization: 'Bearer access' } }, res, () => assert.fail('must not authenticate'));
  assert.equal(res.statusCode, 503);
  await assert.rejects(auth.refreshAccessToken('refresh'), error => error.status === 503);
});
test('invalid credentials still return 401', async () => {
  const auth = authWith(async () => null, () => { throw new Error('bad signature'); });
  const res = response();
  await auth.authenticate({ headers: { authorization: 'Bearer invalid' } }, res, () => assert.fail('must not authenticate'));
  assert.equal(res.statusCode, 401);
  await assert.rejects(auth.refreshAccessToken('invalid'), error => error.status === 401);
});
