// HTTP routes for shared goals (mounted on the authenticated mobile router).
function attachGoalRoutes(router, { roomFor, route, pusher, roomTitle, goals }) {
  const code = req => String(req.params.code || '').toUpperCase();
  const tell = (room, to, body, extra = {}) => pusher?.notify([to], {
    title: roomTitle(room), body, data: { type: 'goal', code: room.room_code }, channelId: 'messages', sound: 'default', priority: 'high',
  }, extra);

  router.get('/rooms/:code/goals', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    res.json(await goals.today(room, req.user.user_id, String(req.query.day || '')));
  }));
  router.get('/rooms/:code/goals-month', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    res.json(await goals.month(room, req.user.user_id, String(req.query.month || ''), String(req.query.today || '')));
  }));
  router.post('/rooms/:code/goals', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    const goal = await goals.create(room, req.user.user_id, req.body || {});
    if (goal.pending) {
      const partner = goals.partnerOf(room, req.user.user_id);
      if (partner) tell(room, partner.id, `${req.user.display_name} wants to do “${goal.name}” together. Tap to join.`);
    }
    res.status(201).json({ id: String(goal.goal_id) });
  }));
  router.post('/rooms/:code/goals/:id/join', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    const goal = await goals.join(room, req.user.user_id, req.params.id);
    tell(room, goal.created_by, `${req.user.display_name} joined “${goal.name}”. You’re doing it together now.`);
    res.json({ success: true });
  }));
  router.post('/rooms/:code/goals/:id/progress', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    const result = await goals.progress(room, req.user.user_id, req.params.id, String(req.body?.day || ''), req.body?.value);
    if (result.finished) {
      const partner = goals.partnerOf(room, req.user.user_id);
      if (partner) tell(room, partner.id, `${req.user.display_name} finished “${result.goal.name}” today.`, { throttleKey: `goal:${result.goal.goal_id}:${req.body.day}`, throttleMs: 6 * 3600 * 1000 });
    }
    res.json({ value: result.value, finished: result.finished });
  }));
  router.post('/rooms/:code/goals/:id/cheer', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    const result = await goals.cheer(room, req.user.user_id, req.params.id, String(req.body?.day || ''));
    if (result.added) tell(room, result.to, `${req.user.display_name} is cheering you on: “${result.goal.name}”`);
    res.json({ success: true });
  }));
  router.delete('/rooms/:code/goals/:id', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    await goals.remove(room, req.user.user_id, req.params.id, String(req.query.day || req.body?.day || ''));
    res.json({ success: true });
  }));
}
module.exports = { attachGoalRoutes };
