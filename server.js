// Kahootrillion — a Kahoot-style classroom game where rare + fast answers sink you deepest.
const express = require('express');
const http = require('http');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname + '/public'));
app.get('/host', (_, res) => res.sendFile(__dirname + '/public/host.html'));

// ---------- helpers ----------
function lanAddress() {
  const all = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) all.push({ name, ip: i.address });
  }
  // skip virtual adapters (WSL, Hyper-V, Docker, VPNs) and prefer typical home/school Wi-Fi ranges
  const real = all.filter(a => !/vEthernet|WSL|Hyper-V|Docker|VirtualBox|VMware|Loopback/i.test(a.name));
  const pick = real.find(a => /^(192\.168|10\.)/.test(a.ip)) || real[0] || all[0];
  return process.env.HOST_IP || (pick ? pick.ip : 'localhost');
}
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
// loose match: ignore spaces and a trailing plural "s"
const key = s => norm(s).replace(/ /g, '').replace(/(es|s)$/, '');

const games = {}; // code -> game

function newCode() {
  let c;
  do c = String(Math.floor(100000 + Math.random() * 900000)); while (games[c]);
  return c;
}

function publicPlayers(g) {
  return Object.entries(g.players).map(([id, p]) => ({ id, name: p.name, depth: p.depth, lastGain: p.lastGain, connected: p.connected }));
}

function broadcastLobby(g) {
  io.to(g.code).emit('lobby', { players: publicPlayers(g) });
}

function startQuestion(g) {
  const q = g.questions[g.qIndex];
  g.phase = 'question';
  g.answers = {};
  g.startTime = Date.now();
  for (const p of Object.values(g.players)) p.lastGain = 0;
  const payload = { index: g.qIndex, total: g.questions.length, text: q.text, time: q.time, endsAt: g.startTime + q.time * 1000 };
  io.to(g.code).emit('question', payload);
  clearTimeout(g.timer);
  g.timer = setTimeout(() => endQuestion(g), q.time * 1000 + 300);
}

function endQuestion(g) {
  if (g.phase !== 'question') return;
  clearTimeout(g.timer);
  g.phase = 'reveal';
  const q = g.questions[g.qIndex];
  const accepted = (q.accepted || []).map(a => ({ label: a.trim(), k: key(a) })).filter(a => a.k);
  const limit = q.time * 1000;

  // Group answers into buckets (canonical answer -> list of player ids)
  const buckets = {};
  for (const [id, a] of Object.entries(g.answers)) {
    const k = key(a.raw);
    if (!k) continue;
    let label = a.raw.trim(), valid = true, bk = k;
    if (accepted.length) {
      const m = accepted.find(x => x.k === k);
      if (m) { label = m.label; bk = m.k; } else valid = false;
    }
    bk = (valid ? 'v:' : 'x:') + bk;
    if (!buckets[bk]) buckets[bk] = { label, valid, ids: [] };
    buckets[bk].ids.push(id);
  }

  // Score: rarity (1 / how many gave same answer) x speed, plus a small base for any valid answer
  const results = {};
  let best = null;
  for (const b of Object.values(buckets)) {
    for (const id of b.ids) {
      const p = g.players[id];
      if (!p) continue;
      let gain = 0, rarity = 0, speed = 0;
      if (b.valid) {
        const elapsed = Math.min(limit, g.answers[id].t - g.startTime);
        rarity = 1 / b.ids.length;
        speed = 1 - 0.5 * (elapsed / limit);
        gain = Math.round(50 + 950 * rarity * speed);
      }
      p.depth += gain;
      p.lastGain = gain;
      results[id] = { gain, answer: b.label, valid: b.valid, sameCount: b.ids.length };
      if (gain && (!best || gain > best.gain)) best = { id, name: p.name, gain, answer: b.label };
    }
  }

  const ranking = publicPlayers(g).sort((a, b) => b.depth - a.depth);
  const buckList = Object.values(buckets)
    .map(b => ({ label: b.label, valid: b.valid, count: b.ids.length }))
    .sort((a, b) => (b.valid - a.valid) || (a.count - b.count));

  io.to(g.host).emit('reveal', {
    index: g.qIndex, total: g.questions.length, text: q.text,
    buckets: buckList, ranking, best, answeredCount: Object.keys(g.answers).length,
    accepted: accepted.map(a => a.label),
  });
  ranking.forEach((r, i) => {
    const res = results[r.id] || { gain: 0, answer: null, valid: false, sameCount: 0 };
    io.to(r.id).emit('result', { ...res, depth: r.depth, rank: i + 1, of: ranking.length, last: g.qIndex >= g.questions.length - 1 });
  });
}

function endGame(g) {
  g.phase = 'end';
  const ranking = publicPlayers(g).sort((a, b) => b.depth - a.depth);
  io.to(g.code).emit('gameover', { ranking });
}

// ---------- sockets ----------
io.on('connection', socket => {
  socket.on('host:create', (questions, cb) => {
    const qs = (Array.isArray(questions) ? questions : [])
      .map(q => ({ text: String(q.text || '').slice(0, 300), accepted: (q.accepted || []).map(String).slice(0, 100), time: Math.max(5, Math.min(120, +q.time || 20)) }))
      .filter(q => q.text.trim());
    if (!qs.length) return cb({ error: 'Add at least one question.' });
    const code = newCode();
    games[code] = { code, host: socket.id, players: {}, questions: qs, qIndex: -1, phase: 'lobby', answers: {} };
    socket.join(code);
    socket.data.hostOf = code;
    cb({ code, joinUrl: `http://${lanAddress()}:${PORT}` });
  });

  socket.on('host:start', () => {
    const g = games[socket.data.hostOf];
    if (!g || g.phase !== 'lobby') return;
    g.qIndex = 0;
    startQuestion(g);
  });

  socket.on('host:skip', () => {
    const g = games[socket.data.hostOf];
    if (g) endQuestion(g);
  });

  socket.on('host:next', () => {
    const g = games[socket.data.hostOf];
    if (!g || g.phase !== 'reveal') return;
    if (g.qIndex >= g.questions.length - 1) return endGame(g);
    g.qIndex++;
    startQuestion(g);
  });

  socket.on('host:kick', id => {
    const g = games[socket.data.hostOf];
    if (!g || !g.players[id]) return;
    delete g.players[id];
    io.to(id).emit('kicked');
    broadcastLobby(g);
  });

  socket.on('player:join', ({ code, name }, cb) => {
    code = String(code || '').trim();
    name = String(name || '').trim().slice(0, 16);
    const g = games[code];
    if (!g) return cb({ error: 'No game with that code.' });
    if (!name) return cb({ error: 'Enter a nickname.' });
    // Allow rejoin with same name if that player disconnected
    const existing = Object.entries(g.players).find(([, p]) => p.name.toLowerCase() === name.toLowerCase());
    if (existing && existing[1].connected) return cb({ error: 'That nickname is taken.' });
    if (!existing && g.phase !== 'lobby') return cb({ error: 'Game already started.' });
    let player = { name, depth: 0, lastGain: 0, connected: true };
    if (existing) { player = { ...existing[1], connected: true }; delete g.players[existing[0]]; }
    g.players[socket.id] = player;
    socket.join(code);
    socket.data.playerOf = code;
    cb({ ok: true, name, depth: player.depth });
    broadcastLobby(g);
    if (g.phase === 'question') {
      const q = g.questions[g.qIndex];
      socket.emit('question', { index: g.qIndex, total: g.questions.length, text: q.text, time: q.time, endsAt: g.startTime + q.time * 1000 });
    }
  });

  socket.on('player:answer', raw => {
    const g = games[socket.data.playerOf];
    if (!g || g.phase !== 'question' || !g.players[socket.id] || g.answers[socket.id]) return;
    raw = String(raw || '').slice(0, 60);
    if (!norm(raw)) return;
    g.answers[socket.id] = { raw, t: Date.now() };
    socket.emit('answered');
    const active = Object.values(g.players).filter(p => p.connected).length;
    io.to(g.host).emit('progress', { answered: Object.keys(g.answers).length, total: active });
    if (Object.keys(g.answers).length >= active) endQuestion(g);
  });

  socket.on('disconnect', () => {
    if (socket.data.hostOf) {
      const g = games[socket.data.hostOf];
      if (g) { clearTimeout(g.timer); io.to(g.code).emit('hostleft'); delete games[g.code]; }
    }
    if (socket.data.playerOf) {
      const g = games[socket.data.playerOf];
      if (g && g.players[socket.id]) {
        if (g.phase === 'lobby') delete g.players[socket.id];
        else g.players[socket.id].connected = false;
        broadcastLobby(g);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  Kahootrillion running!`);
  console.log(`  Teacher screen:  http://localhost:${PORT}/host`);
  console.log(`  Students join:   http://${lanAddress()}:${PORT}\n`);
});
