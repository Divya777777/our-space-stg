const test = require('node:test');
const assert = require('node:assert/strict');
const { createInviteRouter, invitePage } = require('../routes/invite');
test('invite page links into the app and rejects bad codes', () => {
  const html = invitePage('MOON01');
  assert.match(html, /ourspace:\/\/join\?code=MOON01/);
  assert.match(html, /package=com\.ourspace\.mobile/);
  const route = createInviteRouter().stack.find(l => l.route?.path === '/j/:code').route.stack[0].handle;
  const res = { headers: {}, statusCode: 200, status(c) { this.statusCode = c; return this; }, set() { return this; }, type() { return this; }, send(b) { this.body = b; return this; } };
  route({ params: { code: '<script>' } }, res);
  assert.equal(res.statusCode, 404);
  route({ params: { code: 'moon01' } }, res);
  assert.match(res.body, /MOON01/);
});
