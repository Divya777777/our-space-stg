const express = require('express');
const { ChangeFeed } = require('../utils/changeFeed');
const { PrismaClient } = require('@prisma/client');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const rooms = require('../services/roomService');
const lists = require('../services/playlistService');
const messages = require('../services/messageService');
const { positiveId } = require('../utils/ids');

function createMobileRouter({ db = new PrismaClient(), roomService = rooms, playlistService = lists, messageService = messages, auth = authenticate } = {}) {
  const router = express.Router();
  const feed = new ChangeFeed();
  const changed = code => feed.notify('room:' + code);
  const playlistsChanged = code => { if (code) { feed.notify('lists:' + code); changed(code); } };
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  const check = result => { if (!result.success) fail(result.error, result.status || 400); return result; };
  const string = (value, max = 200) => typeof value === 'string' && value.trim().length && value.trim().length <= max ? value.trim() : fail('Invalid text');
  const id = value => positiveId(value) || fail('Invalid ID');
  const route = handler => async (req, res) => { try { await handler(req, res); } catch (error) {
    if (!error.status) console.error('Mobile API:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to complete request' });
  } };
  router.get('/capabilities', (req, res) => res.json({ service: 'our-space-mobile-api', version: 1 }));
  router.use(auth);
  router.use(rateLimit({ windowMs: 60000, max: 240, keyGenerator: req => String(req.user.user_id), standardHeaders: true, legacyHeaders: false }));
  async function roomFor(code, userId) {
    if (!/^[A-Z0-9]{6,10}$/.test(code)) fail('Invalid room code');
    const room = await db.rooms.findUnique({ where: { room_code: code }, include: { members: { include: { user: true } } } });
    if (!room?.is_active) fail('Room not found', 404);
    if (!room.members.some(m => m.user_id === userId)) fail('Waiting for admin approval', 403);
    return room;
  }
  const person = user => ({ id: String(user.user_id), name: user.display_name });
  async function roomView(room, userId) {
    const updateCursor = feed.version('room:' + room.room_code);
    const playlistVersion = feed.version('lists:' + room.room_code);
    const [history, playing, pending] = await Promise.all([
      messageService.getRoomMessages(room.room_id, 100), playlistService.getNowPlaying(room.room_id),
      room.host_user_id === userId ? roomService.getPendingRequests(room.room_id, userId) : []
    ]);
    return { updateCursor, playlistVersion, code: room.room_code, name: room.room_name || 'Our space', hostId: String(room.host_user_id),
      members: room.members.map(m => person(m.user)), requests: pending.map(r => person(r.user)),
      messages: history.filter(m => m.sender).map(m => ({ id: m.messageId, userId: m.sender.userId, name: m.sender.displayName, text: m.content, at: new Date(m.sentAt).getTime() })),
      playback: playing ? { videoId: playing.videoId, playing: playing.isPlaying, position: playing.currentTimeSeconds || 0,
        updatedAt: new Date(playing.startedAt).getTime(), revision: Number(playing.nowPlayingId), updatedBy: '' } : null };
  }
  async function activate(room, userId) {
    // Leaving a session does not revoke approved membership.
    await db.room_members.updateMany({ where: { room_id: room.room_id, user_id: userId }, data: { left_at: null, is_online: true } });
  }
  function playlistView(p, code = null) {
    return { id: String(p.playlist_id), name: p.playlist_name, scope: p.playlist_type, ownerId: String(p.created_by_user_id),
      roomCode: p.playlist_type === 'room' ? code || p.room?.room_code : null,
      tracks: p.songs.map(item => ({ videoId: item.song.video_id, title: item.song.title })) };
  }
  async function playlistFor(value, userId) {
    const p = await db.playlists.findUnique({ where: { playlist_id: id(value) }, include: { room: { include: { members: true } }, songs: { include: { song: true }, orderBy: { position: 'asc' } } } });
    if (!p?.is_active || (p.playlist_type === 'personal' ? p.created_by_user_id !== userId : !p.room?.is_active || !p.room.members.some(m => m.user_id === userId))) fail('Playlist unavailable', 403);
    return p;
  }
  router.get('/rooms', route(async (req, res) => {
    const data = await db.rooms.findMany({ where: { is_active: true, members: { some: { user_id: req.user.user_id } } }, include: { members: { include: { user: true } } }, orderBy: { created_at: 'desc' } });
    res.json(await Promise.all(data.map(room => roomView(room, req.user.user_id))));
  }));
  router.post('/rooms', route(async (req, res) => {
    const room = await roomService.createRoom(req.user.user_id, { roomName: string(req.body.name), requiresApproval: true });
    res.status(201).json(await roomView(await roomFor(room.room_code, req.user.user_id), req.user.user_id));
  }));
  router.post('/rooms/:code/join', route(async (req, res) => {
    const result = check(await roomService.joinRoom(req.user.user_id, req.params.code)); changed(req.params.code); res.json({ approved: !!result.joined });
  }));
  router.get('/rooms/:code', route(async (req, res) => {
    let room = await roomFor(req.params.code, req.user.user_id);
    if (req.query.wait === '1') {
      await feed.wait('room:' + room.room_code, req.query.cursor, res, 10000);
      if (res.destroyed) return;
      room = await roomFor(req.params.code, req.user.user_id);
    }
    res.json(await roomView(room, req.user.user_id));
  }));
  router.post('/rooms/:code/approve', route(async (req, res) => {
    const room = await roomFor(req.params.code, req.user.user_id);
    if (room.host_user_id !== req.user.user_id) fail('Only the admin can approve requests', 403);
    if (typeof req.body.approved !== 'boolean') fail('Approval must be a boolean');
    const pending = await db.pending_join_requests.findFirst({ where: { room_id: room.room_id, user_id: id(req.body.userId), status: 'pending', expires_at: { gt: new Date() } } });
    if (!pending) fail('Request expired or already handled', 404);
    check(await roomService.handleJoinRequest(pending.request_id, req.body.approved, req.user.user_id));
    changed(room.room_code);
    res.json(await roomView(await roomFor(req.params.code, req.user.user_id), req.user.user_id));
  }));
  router.post('/rooms/:code/messages', route(async (req, res) => {
    const room = await roomFor(req.params.code, req.user.user_id);
    await messageService.sendMessage(room.room_id, req.user.user_id, { content: string(req.body.text, 2000) });
    changed(room.room_code);
    res.json(await roomView(room, req.user.user_id));
  }));
  router.post('/rooms/:code/playback', route(async (req, res) => {
    const room = await roomFor(req.params.code, req.user.user_id);
    if (!/^[\w-]{11}$/.test(req.body.videoId || '') || typeof req.body.playing !== 'boolean' || !Number.isFinite(req.body.position) || req.body.position < 0) fail('Invalid playback');
    await activate(room, req.user.user_id);
    check(await playlistService.updateNowPlaying(room.room_id, req.user.user_id, { videoId: req.body.videoId, isPlaying: req.body.playing, currentTimeSeconds: req.body.position }));
    changed(room.room_code);
    res.json(await roomView(room, req.user.user_id));
  }));
  router.get('/playlists', route(async (req, res) => {
    const data = await db.playlists.findMany({ where: { is_active: true, OR: [
      { playlist_type: 'personal', created_by_user_id: req.user.user_id },
      { playlist_type: 'room', room: { is_active: true, members: { some: { user_id: req.user.user_id } } } }
    ] }, include: { room: true, songs: { include: { song: true }, orderBy: { position: 'asc' } } }, orderBy: { created_at: 'asc' } });
    res.json(data.map(p => playlistView(p)));
  }));
  router.post('/playlists', route(async (req, res) => {
    if (!['personal','room'].includes(req.body.scope)) fail('Invalid playlist scope');
    let room = null;
    if (req.body.scope === 'room') { room = await roomFor(req.body.roomCode || '', req.user.user_id); await activate(room, req.user.user_id); }
    const result = check(await playlistService.createPlaylist(req.user.user_id, { playlistName: string(req.body.name), playlistType: req.body.scope, roomId: room?.room_id }));
    playlistsChanged(room?.room_code);
    res.status(201).json(playlistView(await playlistFor(result.playlist.playlist_id, req.user.user_id), room?.room_code));
  }));
  router.post('/playlists/:id/tracks', route(async (req, res) => {
    const p = await playlistFor(req.params.id, req.user.user_id);
    if (p.room) await activate(p.room, req.user.user_id);
    if (!/^[\w-]{11}$/.test(req.body.videoId || '')) fail('Invalid YouTube video');
    check(await playlistService.addSongToPlaylist(p.playlist_id, req.user.user_id, { videoId: req.body.videoId, title: string(req.body.title, 500) }));
    playlistsChanged(p.room?.room_code);
    res.json(playlistView(await playlistFor(p.playlist_id, req.user.user_id)));
  }));
  router.delete('/playlists/:id/tracks/:videoId', route(async (req, res) => {
    const p = await playlistFor(req.params.id, req.user.user_id);
    if (p.room) await activate(p.room, req.user.user_id);
    const item = p.songs.find(item => item.song.video_id === req.params.videoId);
    if (item) check(await playlistService.removeSongFromPlaylist(item.playlist_song_id, req.user.user_id));
    playlistsChanged(p.room?.room_code);
    res.json(playlistView(await playlistFor(p.playlist_id, req.user.user_id)));
  }));
  // Ephemeral signaling only; persistent account/room data remains in Postgres.
  // Deploy one instance until signaling is moved to a shared realtime broker.
  const presence = new Map(); let signals = []; let sequence = Date.now();
  function prune() {
    const cutoff = Date.now() - 60000;
    signals = signals.filter(s => s.at > cutoff);
    for (const [key, p] of presence) if (p.at < cutoff) presence.delete(key);
  }
  router.get('/rooms/:code/call', route(async (req, res) => {
    let room = await roomFor(req.params.code, req.user.user_id); prune();
    const after = Number(req.query.after || 0); if (!Number.isSafeInteger(after) || after < 0) fail('Invalid signal cursor');
    const channel = 'call:' + room.room_id;
    const key = `${room.room_id}:${req.user.user_id}`;
    const isNew = !presence.has(key);
    presence.set(key, { at: Date.now(), room: room.room_id, ...person(req.user) });
    if (isNew) feed.notify(channel);
    const hasSignals = () => signals.some(s => s.room === room.room_id && s.to === req.user.user_id && s.id > after);
    if (req.query.wait === '1' && !hasSignals()) {
      await feed.wait(channel, req.query.cursor, res);
      if (res.destroyed) return;
      room = await roomFor(req.params.code, req.user.user_id);
    }
    prune();
    presence.set(key, { at: Date.now(), room: room.room_id, ...person(req.user) });
    const peers = [...presence.values()].filter(p => p.room === room.room_id && p.id !== String(req.user.user_id) && room.members.some(m => String(m.user_id) === p.id)).map(({ id, name }) => ({ id, name }));
    res.json({ realtime: true, cursor: feed.version(channel), peers, signals: signals.filter(s => s.room === room.room_id && s.to === req.user.user_id && s.id > after && room.members.some(m => String(m.user_id) === s.from)).map(({ room: _, to, at, ...s }) => s) });
  }));
  router.post('/rooms/:code/call/signal', route(async (req, res) => {
    const room = await roomFor(req.params.code, req.user.user_id); prune();
    const to = id(req.body.to);
    if (to === req.user.user_id || !room.members.some(m => m.user_id === to)) fail('Recipient is not in this room', 403);
    if (!['invite','accept','reject','offer','answer','candidate','end'].includes(req.body.type) || !req.body.payload || typeof req.body.payload !== 'object' || Array.isArray(req.body.payload) || JSON.stringify(req.body.payload).length > 65536) fail('Invalid call signal');
    if (signals.length >= 10000) fail('Call service busy; retry shortly', 503);
    signals.push({ id: ++sequence, at: Date.now(), room: room.room_id, to, from: String(req.user.user_id), name: req.user.display_name, type: req.body.type, payload: req.body.payload });
    feed.notify('call:' + room.room_id);
    res.json({ success: true });
  }));
  return router;
}
module.exports = { createMobileRouter };
