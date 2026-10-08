// HTTP routes for the Play tab (mounted on the authenticated mobile router).
function attachGameRoutes(router, { roomFor, route, pusher, roomTitle, games }) {
  const code = req => String(req.params.code || '').toUpperCase();
  const others = (room, me) => room.members.filter(m => !m.left_at && Number(m.user_id) !== Number(me)).map(m => Number(m.user_id));
  const tell = (room, to, body, throttleKey) => pusher?.notify(to, {
    title: roomTitle(room), body, data: { type: 'game', code: room.room_code }, channelId: 'messages', sound: 'default', priority: 'high',
  }, throttleKey ? { throttleKey, throttleMs: 60000 } : {});

  router.get('/rooms/:code/play', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    res.json(await games.hub(room, req.user.user_id));
  }));
  router.get('/rooms/:code/scribble', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    res.json(await games.scribble(room, req.user.user_id, { action: 'peek' }));
  }));
  router.post('/rooms/:code/scribble', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    const result = await games.scribble(room, req.user.user_id, req.body || {});
    if (result.started) tell(room, others(room, req.user.user_id), `${req.user.display_name} started Scribble. Come and guess the drawing!`, `scribble:${room.room_id}`);
    res.json({ view: result.view });
  }));
  router.post('/rooms/:code/scribble/turn', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    const turn = await games.sendTurn(room, req.user.user_id, req.body);
    tell(room, others(room, req.user.user_id), `${req.user.display_name} drew something for you. Guess it whenever you’re free.`);
    res.status(201).json({ id: String(turn.id) });
  }));
  router.get('/rooms/:code/scribble/word', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    res.json({ word: await games.drawWord(room, req.query.skip) });
  }));
  router.get('/rooms/:code/scribble/turns', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    res.json({ turns: await games.turns(room, req.user.user_id) });
  }));
  router.post('/rooms/:code/scribble/turns/:id', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    const result = await games.turnAction(room, req.user.user_id, req.params.id, req.body || {});
    if (result.solved && req.body?.action === 'guess') tell(room, [Number(result.turn.from)], `${req.user.display_name} guessed your drawing: “${result.turn.word}”`);
    res.json(result);
  }));
  router.get('/rooms/:code/truth-dare', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    res.json(await games.truthDare(room, req.user.user_id, {}));
  }));
  router.post('/rooms/:code/truth-dare', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    const result = await games.truthDare(room, req.user.user_id, req.body || {});
    if (result.started) tell(room, others(room, req.user.user_id), `${req.user.display_name} wants to play Truth or Dare.`, `td:${room.room_id}`);
    res.json({ view: result.view });
  }));
  router.get('/rooms/:code/quiz', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    res.json(await games.quiz(room, req.user.user_id));
  }));
  router.post('/rooms/:code/quiz/answers', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    await games.quizAnswer(room, req.user.user_id, req.body?.answers, req.body?.ids);
    tell(room, others(room, req.user.user_id), `${req.user.display_name} answered 10 questions about themself. How well do you know them?`);
    res.json(await games.quiz(room, req.user.user_id));
  }));
  router.post('/rooms/:code/quiz/guess', route(async (req, res) => {
    const room = await roomFor(code(req), req.user.user_id);
    res.json(await games.quizGuess(room, req.user.user_id, req.body?.about, req.body?.guesses));
  }));
}
module.exports = { attachGameRoutes };
