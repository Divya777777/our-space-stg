// HTTP routes for the planner (mounted on the authenticated mobile router).
// Paths use "planner" because "/plan" already means the subscription plan.
const WHEN = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
function attachPlannerRoutes(router, { roomFor, route, pusher, roomTitle, planner }) {
  const code = req => String(req.params.code || '').toUpperCase();
  const others = (room, me) => room.members.filter(m => Number(m.user_id) !== Number(me)).map(m => Number(m.user_id));
  // The server doesn't know each person's time zone, so pushes name the plan and the phone shows the time.
  const tell = (room, to, body) => to.length && pusher?.notify(to, {
    title: roomTitle(room), body, data: { type: 'plan', code: room.room_code }, channelId: 'messages', sound: 'default', priority: 'high',
  });
  const when = (ms, tz) => { try { return new Date(ms).toLocaleString('en-US', { ...WHEN, timeZone: tz || 'UTC' }); } catch { return ''; } };

  router.get('/planner', route(async (req, res) => { res.json({ plans: await planner.forUser(req.user.user_id) }); }));
  router.post('/planner/armed', route(async (req, res) => { res.json({ armed: await planner.arm(req.user.user_id, req.body?.ids) }); }));
  router.get('/rooms/:code/planner', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    res.json({ plans: await planner.forRoom(room, req.user.user_id) });
  }));
  router.post('/rooms/:code/planner', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    const plan = await planner.create(room, req.user.user_id, req.body);
    const at = when(plan.startsAt, req.body?.timeZone);
    tell(room, others(room, req.user.user_id), `${req.user.display_name} planned “${plan.title}”${at ? ` · ${at}` : ''}. You’ll get a reminder 1 hour before.`);
    res.status(201).json({ plan });
  }));
  router.patch('/rooms/:code/planner/:id', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    const { plan, moved } = await planner.update(room, req.user.user_id, req.params.id, req.body);
    if (moved) { const at = when(plan.startsAt, req.body?.timeZone); tell(room, others(room, req.user.user_id), `${req.user.display_name} moved “${plan.title}”${at ? ` to ${at}` : ''}`); }
    res.json({ plan });
  }));
  router.delete('/rooms/:code/planner/:id', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    const plan = await planner.cancel(room, req.user.user_id, req.params.id);
    tell(room, others(room, req.user.user_id), `${req.user.display_name} cancelled “${plan.title}”`);
    res.json({ cancelled: true });
  }));
}
module.exports = { attachPlannerRoutes };
