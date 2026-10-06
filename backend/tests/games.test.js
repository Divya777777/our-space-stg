const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createGames, memoryStore, WORDS } = require('../services/games');
const { attachGameRoutes } = require('../routes/games');
const { response } = require('./helpers');

function setup(count = 2) {
  const names = ['Divya', 'Leo', 'Asha'];
  const room = { room_id: 7, room_code: 'MOON01', room_name: 'Moon', members: names.slice(0, count).map((n, i) => ({ user_id: i + 1, user: { user_id: i + 1, display_name: n } })) };
  const pushes = [];
  let clock = 1_000_000;
  const router = express.Router();
  const route = handler => async (req, res) => { try { await handler(req, res); } catch (error) { res.status(error.status || 500).json({ error: error.message }); } };
  attachGameRoutes(router, { roomFor: async () => room, route, roomTitle: r => r.room_name, pusher: { notify: (to, msg) => pushes.push({ to, body: msg.body }) }, games: createGames({ store: memoryStore(), now: () => clock }) });
  const call = async (path, method, { body = {}, userId = 1, id } = {}) => {
    const res = Object.assign(response(), { set() { return this; } });
    const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
    await layer.route.stack.at(-1).handle({ user: { user_id: userId, display_name: names[userId - 1] }, params: { code: 'MOON01', id }, body, query: {} }, res);
    return res;
  };
  return { call, pushes, tick: ms => { clock += ms; } };
}
const stroke = id => ({ id, c: '#141125', s: 5, p: [[0.1, 0.1], [0.5, 0.5]] });

test('live Scribble: only the drawer sees the word, a right guess scores for both, 3 rounds', async () => {
  const s = setup();
  const start = await s.call('/rooms/:code/scribble', 'post', { body: { action: 'start' } });
  const word = start.data.view.word;
  assert.ok(WORDS.includes(word));
  assert.match(s.pushes[0].body, /started Scribble/);
  const leo = await s.call('/rooms/:code/scribble', 'get', { userId: 2 });
  assert.equal(leo.data.view.word, null); assert.equal(leo.data.view.length, word.length);
  assert.equal((await s.call('/rooms/:code/scribble', 'post', { userId: 2, body: { action: 'stroke', stroke: stroke('a') } })).statusCode, 403);
  await s.call('/rooms/:code/scribble', 'post', { body: { action: 'stroke', stroke: stroke('a') } });
  await s.call('/rooms/:code/scribble', 'post', { body: { action: 'stroke', stroke: { ...stroke('a'), p: [[0, 0], [1, 1], [0.5, 0.2]] } } });
  assert.equal((await s.call('/rooms/:code/scribble', 'get', { userId: 2 })).data.view.strokes[0].p.length, 3);
  await s.call('/rooms/:code/scribble', 'post', { userId: 2, body: { action: 'guess', text: 'definitely not it' } });
  const solved = await s.call('/rooms/:code/scribble', 'post', { userId: 2, body: { action: 'guess', text: word.toUpperCase() + '!' } });
  assert.equal(solved.data.view.phase, 'solved'); assert.equal(solved.data.view.word, word);
  assert.deepEqual(solved.data.view.pts, { 1: 2, 2: 2 });
  await s.call('/rooms/:code/scribble', 'post', { body: { action: 'next' } });
  await s.call('/rooms/:code/scribble', 'post', { body: { action: 'stroke', stroke: stroke('b') } });
  s.tick(61000);
  assert.equal((await s.call('/rooms/:code/scribble', 'get', { userId: 2 })).data.view.phase, 'timeup');
  await s.call('/rooms/:code/scribble', 'post', { body: { action: 'next' } });
  await s.call('/rooms/:code/scribble', 'post', { body: { action: 'stroke', stroke: stroke('c') } });
  await s.call('/rooms/:code/scribble', 'post', { body: { action: 'done' } });
  s.tick(61000);
  const over = await s.call('/rooms/:code/scribble', 'post', { body: { action: 'next' } });
  assert.equal(over.data.view.phase, 'over');
  const hub = await s.call('/rooms/:code/play', 'get');
  assert.deepEqual(hub.data.scores.map(x => x.points), [2, 2]);
});

test('turn-by-turn Scribble with hints, Truth or Dare turns and spicy consent, quiz scoring', async () => {
  const s = setup();
  const start = await s.call('/rooms/:code/scribble', 'post', { body: { action: 'start' } });
  const word = start.data.view.word;
  assert.equal((await s.call('/rooms/:code/scribble/turn', 'post')).statusCode, 400); // nothing drawn yet
  await s.call('/rooms/:code/scribble', 'post', { body: { action: 'stroke', stroke: stroke('a') } });
  assert.equal((await s.call('/rooms/:code/scribble/turn', 'post')).statusCode, 201);
  assert.match(s.pushes.at(-1).body, /drew something for you/);
  const turns = (await s.call('/rooms/:code/scribble/turns', 'get', { userId: 2 })).data.turns;
  assert.equal(turns.length, 1); assert.equal(turns[0].word, '');
  const hinted = await s.call('/rooms/:code/scribble/turns/:id', 'post', { userId: 2, id: turns[0].id, body: { action: 'hint' } });
  assert.equal(hinted.data.turn.word, word[0]);
  await s.call('/rooms/:code/scribble/turns/:id', 'post', { userId: 2, id: turns[0].id, body: { action: 'guess', text: 'zzz' } });
  const got = await s.call('/rooms/:code/scribble/turns/:id', 'post', { userId: 2, id: turns[0].id, body: { action: 'guess', text: word } });
  assert.equal(got.data.solved, true); assert.deepEqual(got.data.turn.tries, ['zzz']);
  assert.match(s.pushes.at(-1).body, /guessed your drawing/);

  const td = (await s.call('/rooms/:code/truth-dare', 'post', { body: { action: 'start' } })).data.view;
  assert.equal(td.turn, '1');
  assert.equal((await s.call('/rooms/:code/truth-dare', 'post', { userId: 2, body: { action: 'pick', kind: 'truth' } })).statusCode, 403);
  const card = (await s.call('/rooms/:code/truth-dare', 'post', { body: { action: 'pick', kind: 'dare' } })).data.view.card;
  assert.equal(card.kind, 'dare');
  await s.call('/rooms/:code/truth-dare', 'post', { body: { action: 'spicy' } });
  assert.equal((await s.call('/rooms/:code/truth-dare', 'get', { userId: 2 })).data.view.spicyOn, false);
  await s.call('/rooms/:code/truth-dare', 'post', { userId: 2, body: { action: 'spicy' } });
  assert.equal((await s.call('/rooms/:code/truth-dare', 'get')).data.view.spicyOn, true);
  const next = (await s.call('/rooms/:code/truth-dare', 'post', { body: { action: 'done' } })).data.view;
  assert.equal(next.turn, '2'); assert.equal(next.card, null);

  const answers = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1];
  assert.equal((await s.call('/rooms/:code/quiz/answers', 'post', { userId: 2, body: { answers: [1] } })).statusCode, 400);
  await s.call('/rooms/:code/quiz/answers', 'post', { userId: 2, body: { answers } });
  const q = (await s.call('/rooms/:code/quiz', 'get')).data;
  assert.equal(q.people[0].ready, true); assert.equal(q.people[0].answers, null);
  const guess = await s.call('/rooms/:code/quiz/guess', 'post', { body: { about: 2, guesses: [0, 1, 2, 3, 0, 0, 0, 0, 0, 0] } });
  assert.equal(guess.data.score, 6);
  const again = await s.call('/rooms/:code/quiz/guess', 'post', { body: { about: 2, guesses: answers } });
  assert.equal(again.data.score, 6); // one go per set of answers
  const hub = (await s.call('/rooms/:code/play', 'get')).data;
  assert.deepEqual(hub.scores.map(x => x.points), [2 + 6, 1]);
});
