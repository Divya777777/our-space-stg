// Play tab: Scribble (live and turn-by-turn), Truth or Dare, "How well do you know me?" and monthly scores.
// Live games (Scribble rounds, Truth or Dare) are short and kept in memory per room, like the Up next queue.
// Turn-by-turn drawings, quiz answers and scores are stored, in tables the backend creates itself.
const ROUND_MS = 60 * 1000;
const ROUNDS = 3;
const WORDS = ['kite', 'moon', 'pizza', 'house', 'star', 'cat', 'tree', 'boat', 'cup', 'sun', 'flower', 'fish', 'car', 'heart', 'cake', 'rain', 'cloud', 'guitar', 'apple', 'book',
  'chair', 'clock', 'dog', 'eye', 'hat', 'key', 'lamp', 'leaf', 'mountain', 'phone', 'rocket', 'shoe', 'snail', 'snowman', 'spider', 'train', 'umbrella', 'whale', 'bicycle', 'bridge',
  'butterfly', 'camera', 'candle', 'castle', 'crown', 'diamond', 'dragon', 'egg', 'envelope', 'feather', 'glasses', 'hamburger', 'ice cream', 'island', 'ladder', 'lighthouse', 'lion',
  'mushroom', 'octopus', 'owl', 'pencil', 'penguin', 'pineapple', 'rainbow', 'robot', 'sandwich', 'scissors', 'sock', 'sunflower', 'tent', 'tooth', 'turtle', 'volcano', 'watermelon', 'window'];
const DECKS = {
  sweet: {
    truth: ['What’s the first thing you noticed about me?', 'Which day with me would you live again?', 'What small habit of mine do you secretly love?', 'When did you first miss me?', 'What song reminds you of us?', 'What’s a compliment you’ve never said out loud?', 'What do you want us to do together this year?', 'What’s your favourite memory of us?'],
    dare: ['Send me a voice note saying three things you like about me.', 'Do your best impression of me for 10 seconds.', 'Set a photo of us as your lock screen until tomorrow.', 'Plan our next date in 30 seconds — out loud.', 'Sing one line of our song.', 'Write me a two-line poem right now.', 'Tell me a story about us in exactly ten words.', 'Show me the last photo of us on your phone.'],
  },
  fun: {
    truth: ['What’s the most embarrassing song you know every word of?', 'What’s the weirdest thing you’ve searched online this week?', 'Which of my friends would survive longest in a zombie film?', 'What’s your most useless talent?', 'What’s the worst haircut you’ve ever had?', 'What’s a food you secretly hate?', 'What would your superhero name be?', 'What’s the silliest thing you’ve cried at?'],
    dare: ['Talk in an accent until your next turn.', 'Show the last photo in your gallery.', 'Do 10 squats while saying the alphabet.', 'Text a friend “I know what you did” and show the reply.', 'Do your best runway walk.', 'Speak only in questions until your next turn.', 'Balance a spoon on your nose for 10 seconds.', 'Make up a jingle about what you ate today.'],
  },
  spicy: {
    truth: ['Which outfit of mine do you like most?', 'What’s your favourite way I say your name?', 'Describe your ideal night in with me in five words.', 'What was the moment you first felt butterflies?', 'What do you find most attractive about me?'],
    dare: ['Whisper something flirty — no laughing.', 'Give me your best wink on camera.', 'Tell me the moment you knew you liked me, slowly.', 'Describe our perfect date night in one breath.', 'Hold eye contact for 20 seconds without laughing.'],
  },
};
// "How well do you know me?": each person answers these about themself; the others guess.
const QUIZ = [
  { q: 'What would {name} order at midnight?', opts: ['Maggi', 'Pizza', 'Ice cream', 'Nothing — asleep'] },
  { q: '{name}’s dream holiday?', opts: ['Mountains', 'Beach', 'Big city', 'Road trip'] },
  { q: 'What annoys {name} most?', opts: ['Late replies', 'Loud chewing', 'Spoilers', 'Slow walkers'] },
  { q: '{name}’s comfort movie?', opts: ['A rom-com', 'Animated', 'Thriller', 'Old classic'] },
  { q: 'How does {name} spend a free Sunday?', opts: ['Sleeping in', 'Out with friends', 'Binge-watching', 'A hobby project'] },
  { q: '{name}’s go-to drink?', opts: ['Chai', 'Coffee', 'Juice', 'Just water'] },
  { q: 'What would {name} save first in a fire?', opts: ['Phone', 'Photos', 'A pet or plant', 'Laptop'] },
  { q: '{name}’s biggest fear?', opts: ['Spiders', 'Heights', 'Being alone', 'Public speaking'] },
  { q: 'Which superpower would {name} pick?', opts: ['Teleport', 'Read minds', 'Fly', 'Freeze time'] },
  { q: 'What makes {name} feel loved most?', opts: ['Kind words', 'Time together', 'Little gifts', 'Hugs'] },
];
const pick = list => list[Math.floor(Math.random() * list.length)];
const monthOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
const norm = text => String(text || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

function createGames({ store, now = Date.now }) {
  const err = (message, status = 400) => Object.assign(new Error(message), { status });
  const live = new Map(); // room_id -> { scribble, td }
  const slot = roomId => { if (!live.has(roomId)) live.set(roomId, {}); return live.get(roomId); };
  const members = room => room.members.filter(m => !m.left_at).map(m => ({ id: Number(m.user_id), name: m.user?.display_name || 'Member' }));
  const nameOf = (room, id) => members(room).find(m => m.id === Number(id))?.name || 'Someone';
  const partnerOf = (room, me) => members(room).find(m => m.id !== Number(me)) || null;
  async function award(room, userId, points) { if (points > 0) await store.addScore(room.room_id, Number(userId), monthOf(now()), points); }

  // ---------- Scribble, live ----------
  function scribbleView(sc, me) {
    if (!sc) return null;
    if ((sc.phase === 'drawing' || sc.phase === 'guessing') && sc.endsAt && now() >= sc.endsAt) { sc.phase = 'timeup'; sc.version++; }
    const drawer = Number(sc.drawer) === Number(me);
    const reveal = drawer || ['solved', 'timeup', 'over'].includes(sc.phase);
    return {
      version: sc.version, drawer: String(sc.drawer), drawerName: sc.drawerName, round: sc.round, rounds: ROUNDS, phase: sc.phase,
      word: reveal ? sc.word : null, length: sc.word.length, msLeft: sc.endsAt ? Math.max(0, sc.endsAt - now()) : ROUND_MS,
      strokes: sc.strokes, guesses: sc.guesses, pts: sc.pts, solvedBy: sc.solvedBy || null,
    };
  }
  function newWord(previous) { let w; do { w = pick(WORDS); } while (w === previous); return w; }
  async function scribble(room, me, body) {
    const s = slot(room.room_id);
    const sc = s.scribble;
    const action = body?.action;
    const mine = sc && Number(sc.drawer) === Number(me);
    if (action === 'start') {
      s.scribble = { version: (sc?.version || 0) + 1, drawer: Number(me), drawerName: nameOf(room, me), round: 1, phase: 'drawing', word: newWord(), endsAt: null, strokes: [], guesses: [], pts: {} };
      return { view: scribbleView(s.scribble, me), started: true };
    }
    if (action === 'peek') return { view: sc ? scribbleView(sc, me) : null };
    if (!sc) throw err('No game right now', 404);
    scribbleView(sc, me); // apply the timer
    if (action === 'stroke') {
      if (!mine || sc.phase !== 'drawing') throw err('Only the drawer can draw now', 403);
      const st = body.stroke;
      if (!st || typeof st.id !== 'string' || st.id.length > 40 || !Array.isArray(st.p) || st.p.length > 2000) throw err('Invalid stroke');
      const clean = { id: st.id, c: /^#[0-9A-Fa-f]{6}$/.test(st.c) ? st.c : '#141125', s: Math.max(1, Math.min(24, Number(st.s) || 5)), p: st.p.filter(pt => Array.isArray(pt) && pt.length === 2).map(([x, y]) => [Math.max(0, Math.min(1, Number(x) || 0)), Math.max(0, Math.min(1, Number(y) || 0))]) };
      const i = sc.strokes.findIndex(x => x.id === clean.id);
      if (i >= 0) sc.strokes[i] = clean; else { if (sc.strokes.length >= 400) throw err('Canvas is full'); sc.strokes.push(clean); }
      if (!sc.endsAt) sc.endsAt = now() + ROUND_MS; // the 60-second timer starts with the first stroke
    } else if (action === 'undo' || action === 'clear') {
      if (!mine || sc.phase !== 'drawing') throw err('Only the drawer can do that', 403);
      if (action === 'undo') sc.strokes.pop(); else sc.strokes = [];
    } else if (action === 'skip') {
      if (!mine || sc.phase !== 'drawing') throw err('Only the drawer can skip', 403);
      sc.word = newWord(sc.word); sc.strokes = []; sc.guesses = [];
    } else if (action === 'done') {
      if (!mine || sc.phase !== 'drawing' || !sc.strokes.length) throw err('Draw something first');
      sc.phase = 'guessing'; if (!sc.endsAt) sc.endsAt = now() + ROUND_MS;
    } else if (action === 'guess') {
      if (mine) throw err('The drawer can’t guess', 403);
      if (sc.phase !== 'drawing' && sc.phase !== 'guessing') throw err('This round is over');
      const text = String(body.text || '').trim().slice(0, 40);
      if (!text) throw err('Type a guess');
      const ok = norm(text) === norm(sc.word);
      sc.guesses.push({ by: String(me), name: nameOf(room, me), text, ok });
      if (sc.guesses.length > 60) sc.guesses.shift();
      if (ok) {
        sc.phase = 'solved'; sc.solvedBy = String(me);
        sc.pts[me] = (sc.pts[me] || 0) + 2; sc.pts[sc.drawer] = (sc.pts[sc.drawer] || 0) + 2;
        await award(room, me, 2); await award(room, sc.drawer, 2);
      }
    } else if (action === 'next') {
      if (!['solved', 'timeup'].includes(sc.phase)) throw err('Finish this round first');
      if (sc.round >= ROUNDS) sc.phase = 'over';
      else Object.assign(sc, { round: sc.round + 1, phase: 'drawing', word: newWord(sc.word), endsAt: null, strokes: [], guesses: [], solvedBy: null });
    } else if (action === 'end') {
      delete s.scribble; return { view: null };
    } else throw err('Unknown action');
    sc.version++;
    return { view: scribbleView(sc, me) };
  }
  /** "Not on a call? Send it as a turn instead": the drawing waits for the others to guess later. */
  async function sendTurn(room, me) {
    const s = slot(room.room_id);
    const sc = s.scribble;
    if (!sc || Number(sc.drawer) !== Number(me) || !sc.strokes.length) throw err('Draw something first');
    const turn = await store.addTurn({ room_id: room.room_id, from_user: Number(me), word: sc.word, strokes: sc.strokes, at: now() });
    delete s.scribble;
    return turn;
  }
  async function turns(room, me) {
    const list = await store.listTurns(room.room_id);
    return list.filter(t => !t.solved && Number(t.from_user) !== Number(me)).map(t => turnView(room, t, me));
  }
  function turnView(room, t, me) {
    const solved = !!t.solved;
    return { id: String(t.id), from: String(t.from_user), fromName: nameOf(room, t.from_user), at: Number(t.at), strokes: t.strokes, length: t.word.length,
      hints: t.hints || 0, tries: t.tries || [], solved, word: solved ? t.word : t.word.slice(0, t.hints || 0), mine: Number(t.from_user) === Number(me) };
  }
  async function turnAction(room, me, id, body) {
    const t = await store.getTurn(Number(id));
    if (!t || Number(t.room_id) !== Number(room.room_id)) throw err('Drawing not found', 404);
    if (Number(t.from_user) === Number(me)) throw err('That’s your own drawing', 403);
    if (t.solved) return { turn: turnView(room, t, me), solved: true };
    if (body?.action === 'hint') {
      t.hints = Math.min(Math.max(1, t.word.length - 1), (t.hints || 0) + 1);
    } else if (body?.action === 'guess') {
      const text = String(body.text || '').trim().slice(0, 40);
      if (!text) throw err('Type a guess');
      if (norm(text) === norm(t.word)) {
        t.solved = true;
        await award(room, me, Math.max(0, 2 - (t.hints || 0))); await award(room, t.from_user, 2);
      } else t.tries = [...(t.tries || []), text].slice(-20);
    } else throw err('Unknown action');
    await store.updateTurn(t.id, { hints: t.hints || 0, tries: t.tries || [], solved: !!t.solved });
    return { turn: turnView(room, t, me), solved: !!t.solved };
  }

  // ---------- Truth or Dare, live ----------
  function tdView(td) {
    if (!td) return null;
    const spicy = Object.keys(td.spicyYes).length;
    return { version: td.version, decks: td.decks, spicyAsked: Object.keys(td.spicyYes), spicyOn: td.decks.spicy, turn: String(td.turn), turnName: td.turnName, card: td.card, swaps: td.swaps, need: td.need, spicyCount: spicy };
  }
  function drawCard(td, kind) {
    const decks = Object.keys(td.decks).filter(k => td.decks[k]);
    const all = decks.flatMap(d => DECKS[d][kind].map(text => ({ deck: d, kind, text })));
    const fresh = all.filter(c => !td.used.includes(c.text));
    const card = pick(fresh.length ? fresh : all);
    td.used.push(card.text); td.card = card;
  }
  async function truthDare(room, me, body) {
    const s = slot(room.room_id);
    const people = members(room);
    let td = s.td;
    const action = body?.action;
    if (action === 'start' || !td) {
      if (action !== 'start') return { view: null };
      td = s.td = { version: (td?.version || 0) + 1, decks: { sweet: true, fun: true, spicy: false }, spicyYes: {}, turn: Number(me), turnName: nameOf(room, me), card: null, swaps: Object.fromEntries(people.map(p => [p.id, 2])), used: [], need: people.length };
      return { view: tdView(td), started: true };
    }
    if (!action || action === 'peek') return { view: tdView(td) };
    const myTurn = Number(td.turn) === Number(me);
    if (action === 'deck') {
      const k = body.deck;
      if (k !== 'sweet' && k !== 'fun') throw err('Unknown deck');
      td.decks[k] = !td.decks[k];
      if (!td.decks.sweet && !td.decks.fun && !td.decks.spicy) td.decks[k] = true;
    } else if (action === 'spicy') {
      // Spicy unlocks only when everyone here says yes; anyone can turn it off again.
      if (td.decks.spicy) { td.decks.spicy = false; td.spicyYes = {}; }
      else { td.spicyYes[me] = true; if (people.every(p => td.spicyYes[p.id])) td.decks.spicy = true; }
    } else if (action === 'pick') {
      if (!myTurn) throw err('It’s not your turn', 403);
      const kind = body.kind === 'random' ? (Math.random() < 0.5 ? 'truth' : 'dare') : body.kind;
      if (kind !== 'truth' && kind !== 'dare') throw err('Pick truth or dare');
      drawCard(td, kind);
    } else if (action === 'swap') {
      if (!myTurn || !td.card) throw err('Nothing to swap', 403);
      if (!(td.swaps[me] > 0)) throw err('No swaps left');
      td.swaps[me]--; drawCard(td, td.card.kind);
    } else if (action === 'done') {
      if (!myTurn) throw err('It’s not your turn', 403);
      const i = people.findIndex(p => p.id === Number(td.turn));
      const next = people[(i + 1) % people.length] || people[0];
      td.turn = next.id; td.turnName = next.name; td.card = null;
    } else if (action === 'end') { delete s.td; return { view: null }; }
    else throw err('Unknown action');
    td.version++;
    return { view: tdView(td) };
  }

  // ---------- How well do you know me ----------
  async function quiz(room, me) {
    const rows = await store.quizAnswers(room.room_id);
    const guesses = await store.quizGuesses(room.room_id, Number(me));
    const others = members(room).filter(m => m.id !== Number(me));
    const mine = rows.find(r => Number(r.user_id) === Number(me));
    return {
      questions: QUIZ.map(q => ({ q: q.q, opts: q.opts })),
      answered: !!mine, myAnswers: mine ? mine.answers : null,
      people: others.map(o => {
        const row = rows.find(r => Number(r.user_id) === o.id);
        const g = row && guesses.find(x => Number(x.about) === o.id && Number(x.version) === Number(row.version));
        return { id: String(o.id), name: o.name, ready: !!row, guessed: !!g, score: g ? g.score : null, answers: g ? row.answers : null, guesses: g ? g.guesses : null };
      }),
    };
  }
  const validAnswers = list => Array.isArray(list) && list.length === QUIZ.length && list.every((v, i) => Number.isInteger(v) && v >= 0 && v < QUIZ[i].opts.length);
  async function quizAnswer(room, me, answers) {
    if (!validAnswers(answers)) throw err('Answer all 10 questions');
    await store.saveQuizAnswers(room.room_id, Number(me), answers, now());
  }
  async function quizGuess(room, me, about, guesses) {
    if (!validAnswers(guesses)) throw err('Guess all 10 questions');
    const row = (await store.quizAnswers(room.room_id)).find(r => Number(r.user_id) === Number(about));
    if (!row || Number(about) === Number(me)) throw err('They haven’t answered yet', 404);
    const done = (await store.quizGuesses(room.room_id, Number(me))).find(x => Number(x.about) === Number(about) && Number(x.version) === Number(row.version));
    if (done) return { score: done.score, answers: row.answers };
    const score = guesses.filter((g, i) => g === row.answers[i]).length;
    await store.saveQuizGuess(room.room_id, Number(me), Number(about), Number(row.version), guesses, score);
    await award(room, me, score);
    return { score, answers: row.answers };
  }

  // ---------- Hub ----------
  async function hub(room, me) {
    const month = monthOf(now());
    const scores = await store.scores(room.room_id, month);
    const s = slot(room.room_id);
    const sc = s.scribble ? scribbleView(s.scribble, me) : null;
    const pendingTurns = await turns(room, me);
    const q = await quiz(room, me);
    return {
      month, partner: partnerOf(room, me) && { id: String(partnerOf(room, me).id), name: partnerOf(room, me).name },
      scores: members(room).map(m => ({ id: String(m.id), name: m.name, points: Number(scores.find(x => Number(x.user_id) === m.id)?.points || 0) })),
      live: { scribble: sc && sc.phase !== 'over' ? { drawer: sc.drawer, drawerName: sc.drawerName, phase: sc.phase } : null, td: s.td ? { turnName: s.td.turnName } : null },
      turns: pendingTurns.map(t => ({ id: t.id, fromName: t.fromName, at: t.at })),
      quiz: { ready: q.people.filter(p => p.ready && !p.guessed).map(p => ({ id: p.id, name: p.name })), answered: q.answered },
    };
  }
  return { hub, scribble, sendTurn, turns, turnAction, truthDare, quiz, quizAnswer, quizGuess, partnerOf, nameOf };
}

/** Postgres store with plain SQL; tables are created on first use. */
function sqlStore(db) {
  let ready = null;
  const ensure = () => {
    if (!ready) ready = (async () => {
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS game_scores (
        room_id INTEGER NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        month TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (room_id, user_id, month))`);
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS game_turns (
        id SERIAL PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        from_user INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, word TEXT NOT NULL, strokes TEXT NOT NULL,
        hints INTEGER NOT NULL DEFAULT 0, tries TEXT NOT NULL DEFAULT '[]', solved BOOLEAN NOT NULL DEFAULT FALSE, at BIGINT NOT NULL)`);
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS game_turns_room_idx ON game_turns(room_id)');
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS quiz_answers (
        room_id INTEGER NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        answers TEXT NOT NULL, version BIGINT NOT NULL, PRIMARY KEY (room_id, user_id))`);
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS quiz_guesses (
        room_id INTEGER NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        about INTEGER NOT NULL, version BIGINT NOT NULL, guesses TEXT NOT NULL, score INTEGER NOT NULL,
        PRIMARY KEY (room_id, user_id, about, version))`);
    })().catch(error => { ready = null; throw error; });
    return ready;
  };
  const parseTurn = r => r && { ...r, id: Number(r.id), strokes: JSON.parse(r.strokes), tries: JSON.parse(r.tries || '[]'), at: Number(r.at) };
  return {
    async addScore(roomId, userId, month, points) {
      await ensure();
      await db.$executeRawUnsafe(`INSERT INTO game_scores (room_id, user_id, month, points) VALUES ($1, $2, $3, $4)
        ON CONFLICT (room_id, user_id, month) DO UPDATE SET points = game_scores.points + EXCLUDED.points`, Number(roomId), Number(userId), month, Number(points));
    },
    async scores(roomId, month) { await ensure(); return db.$queryRawUnsafe('SELECT user_id, points FROM game_scores WHERE room_id = $1 AND month = $2', Number(roomId), month); },
    async addTurn(t) {
      await ensure();
      return parseTurn((await db.$queryRawUnsafe('INSERT INTO game_turns (room_id, from_user, word, strokes, at) VALUES ($1, $2, $3, $4, $5) RETURNING *', Number(t.room_id), Number(t.from_user), t.word, JSON.stringify(t.strokes), Number(t.at)))[0]);
    },
    async listTurns(roomId) { await ensure(); return (await db.$queryRawUnsafe('SELECT * FROM game_turns WHERE room_id = $1 AND solved = FALSE ORDER BY id DESC LIMIT 20', Number(roomId))).map(parseTurn); },
    async getTurn(id) { await ensure(); return parseTurn((await db.$queryRawUnsafe('SELECT * FROM game_turns WHERE id = $1', Number(id)))[0]); },
    async updateTurn(id, patch) { await ensure(); await db.$executeRawUnsafe('UPDATE game_turns SET hints = $2, tries = $3, solved = $4 WHERE id = $1', Number(id), Number(patch.hints), JSON.stringify(patch.tries), !!patch.solved); },
    async quizAnswers(roomId) { await ensure(); return (await db.$queryRawUnsafe('SELECT user_id, answers, version FROM quiz_answers WHERE room_id = $1', Number(roomId))).map(r => ({ ...r, answers: JSON.parse(r.answers), version: Number(r.version) })); },
    async saveQuizAnswers(roomId, userId, answers, version) {
      await ensure();
      await db.$executeRawUnsafe(`INSERT INTO quiz_answers (room_id, user_id, answers, version) VALUES ($1, $2, $3, $4)
        ON CONFLICT (room_id, user_id) DO UPDATE SET answers = EXCLUDED.answers, version = EXCLUDED.version`, Number(roomId), Number(userId), JSON.stringify(answers), Number(version));
    },
    async quizGuesses(roomId, userId) { await ensure(); return (await db.$queryRawUnsafe('SELECT about, version, guesses, score FROM quiz_guesses WHERE room_id = $1 AND user_id = $2', Number(roomId), Number(userId))).map(r => ({ ...r, guesses: JSON.parse(r.guesses), version: Number(r.version) })); },
    async saveQuizGuess(roomId, userId, about, version, guesses, score) {
      await ensure();
      await db.$executeRawUnsafe('INSERT INTO quiz_guesses (room_id, user_id, about, version, guesses, score) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING', Number(roomId), Number(userId), Number(about), Number(version), JSON.stringify(guesses), Number(score));
    },
    ensure,
  };
}

/** In-memory store with the same shape, for tests and the demo. */
function memoryStore() {
  const scores = new Map(); const turns = []; const answers = new Map(); const guesses = [];
  return {
    async addScore(roomId, userId, month, points) { const k = `${roomId}:${userId}:${month}`; scores.set(k, (scores.get(k) || 0) + points); },
    async scores(roomId, month) { return [...scores].filter(([k]) => k.startsWith(`${roomId}:`) && k.endsWith(`:${month}`)).map(([k, points]) => ({ user_id: Number(k.split(':')[1]), points })); },
    async addTurn(t) { const row = { ...t, id: turns.length + 1, hints: 0, tries: [], solved: false }; turns.push(row); return { ...row }; },
    async listTurns(roomId) { return turns.filter(t => t.room_id === roomId && !t.solved).map(t => ({ ...t })); },
    async getTurn(id) { const t = turns.find(x => x.id === Number(id)); return t ? { ...t } : null; },
    async updateTurn(id, patch) { Object.assign(turns.find(x => x.id === Number(id)), patch); },
    async quizAnswers(roomId) { return [...answers].filter(([k]) => k.startsWith(`${roomId}:`)).map(([k, v]) => ({ user_id: Number(k.split(':')[1]), ...v })); },
    async saveQuizAnswers(roomId, userId, list, version) { answers.set(`${roomId}:${userId}`, { answers: list, version }); },
    async quizGuesses(roomId, userId) { return guesses.filter(g => g.room_id === roomId && g.user_id === userId); },
    async saveQuizGuess(roomId, userId, about, version, list, score) { if (!guesses.some(g => g.room_id === roomId && g.user_id === userId && g.about === about && g.version === version)) guesses.push({ room_id: roomId, user_id: userId, about, version, guesses: list, score }); },
  };
}

module.exports = { createGames, sqlStore, memoryStore, QUIZ, DECKS, WORDS, ROUND_MS };
