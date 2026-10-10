// Report / block routes (mounted on the authenticated mobile router).
function attachSafetyRoutes(router, { route, roomFor, safety }) {
  const id = v => Number(v);
  router.get('/blocks', route(async (req, res) => { res.json({ blocked: await safety.blocked(req.user.user_id) }); }));
  router.post('/blocks', route(async (req, res) => { await safety.block(req.user.user_id, id(req.body?.userId)); res.status(201).json({ blocked: await safety.blocked(req.user.user_id) }); }));
  router.delete('/blocks/:userId', route(async (req, res) => { await safety.unblock(req.user.user_id, id(req.params.userId)); res.json({ blocked: await safety.blocked(req.user.user_id) }); }));
  router.post('/reports', route(async (req, res) => {
    const code = typeof req.body?.roomCode === 'string' ? req.body.roomCode.toUpperCase() : '';
    const room = /^[A-Z0-9]{6,10}$/.test(code) ? await roomFor(code, req.user.user_id).catch(() => null) : null;
    const row = await safety.report(req.user.user_id, req.body, room);
    res.status(201).json({ id: String(row.report_id), blocked: await safety.blocked(req.user.user_id) });
  }));
}
module.exports = { attachSafetyRoutes };
