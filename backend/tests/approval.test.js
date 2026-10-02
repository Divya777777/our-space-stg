const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');
function fixture({ failMembership = false } = {}) {
  let status = 'pending'; let member = false; let writes = 0;
  const prisma = {
    recent_rooms: { findFirst: async () => ({ visit_id: 1 }), update: async () => ({}) },
    $transaction: async operation => {
      const before = { status, member };
      try {
        return await operation({
          pending_join_requests: {
            findUnique: async () => ({ request_id: 1, room_id: 7, user_id: 2, room: { host_user_id: 1 }, status, expires_at: new Date(Date.now() + 60000) }),
            updateMany: async ({ data }) => { writes++; status = data.status; return { count: 1 }; }
          },
          room_members: { upsert: async () => { if (failMembership) throw new Error('connection lost'); member = true; } }
        });
      } catch (error) { status = before.status; member = before.member; throw error; }
    }
  };
  const service = load('services/roomService.js', { '@prisma/client': { PrismaClient: function () { return prisma; } } });
  return { service, state: () => ({ status, member, writes }) };
}
test('membership failure rolls back approval so user can safely retry', async () => {
  const f = fixture({ failMembership: true });
  await assert.rejects(f.service.handleJoinRequest(1, true, 1), /connection lost/);
  assert.equal(f.state().status, 'pending'); assert.equal(f.state().member, false);
});
test('approval commits membership and a replay does not repeat writes', async () => {
  const f = fixture();
  assert.equal((await f.service.handleJoinRequest(1, true, 1)).success, true);
  assert.equal(f.state().status, 'approved'); assert.equal(f.state().member, true);
  assert.equal((await f.service.handleJoinRequest(1, true, 1)).success, true);
  assert.equal(f.state().writes, 1);
});
test('non-host cannot change request status or membership', async () => {
  const f = fixture();
  assert.equal((await f.service.handleJoinRequest(1, true, 99)).status, 403);
  assert.equal(f.state().writes, 0); assert.equal(f.state().member, false);
});
