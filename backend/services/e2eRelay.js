// Relay for end-to-end encrypted chat. Phones encrypt with NaCl before sending; the server cannot read
// the payload. It is additionally sealed with the server's AES-256-GCM key at rest, carried over TLS,
// kept only until members can fetch it (7 days at most), then deleted. Chat history lives on phones.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TYPE = 'e2e';
function createE2ERelay({ db, encryption = require('../utils/encryption'), now = Date.now } = {}) {
  const key = () => encryption.getEncryptionKey();
  return {
    TTL_MS,
    async send(roomId, senderId, payload) {
      const sealed = encryption.encrypt(JSON.stringify(payload), key());
      const row = await db.messages.create({ data: { room_id: roomId, sender_user_id: senderId, content_encrypted: sealed.encrypted, encryption_iv: sealed.iv, auth_tag: sealed.authTag, encryption_algorithm: 'NACL-BOX+AES-256-GCM', message_type: TYPE } });
      return { id: row.message_id, at: new Date(row.sent_at).getTime() };
    },
    async purge(roomId) {
      await db.messages.deleteMany({ where: { room_id: roomId, message_type: TYPE, sent_at: { lt: new Date(now() - TTL_MS) } } });
    },
    async latestId(roomId) {
      const row = await db.messages.findFirst({ where: { room_id: roomId, message_type: TYPE }, orderBy: { message_id: 'desc' }, select: { message_id: true } });
      return row?.message_id || 0;
    },
    async list(roomId, after, limit) {
      const rows = await db.messages.findMany({ where: { room_id: roomId, message_type: TYPE, message_id: { gt: after }, sent_at: { gte: new Date(now() - TTL_MS) } }, orderBy: { message_id: 'asc' }, take: limit + 1, include: { sender: { select: { user_id: true, display_name: true } } } });
      const k = key();
      const messages = rows.slice(0, limit).flatMap(row => {
        try {
          return [{ id: row.message_id, from: String(row.sender_user_id), name: row.sender?.display_name || '', at: new Date(row.sent_at).getTime(), payload: JSON.parse(encryption.decrypt(row.content_encrypted, row.encryption_iv, row.auth_tag, k)) }];
        } catch { return []; }
      });
      return { messages, more: rows.length > limit };
    },
  };
}
module.exports = { createE2ERelay, TTL_MS };
