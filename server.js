const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = __dirname;
const ROOMS = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_BODY = 4096;
const ROOM_LIFETIME_MS = 2 * 60 * 60 * 1000;
const ALLOWED_ORIGINS = new Set([
  'https://bullscows.xyz',
  'https://www.bullscows.xyz',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function randomCode(length) {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  }
  return result;
}

function makeSecret() {
  const digits = '0123456789'.split('');
  for (let i = digits.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.slice(0, 4).join('');
}

function cleanName(value) {
  if (typeof value !== 'string') return 'Player';
  const name = value.normalize('NFKC').replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, 20);
  return name || 'Player';
}

function findRoom(code) {
  const room = ROOMS.get(String(code || '').toUpperCase());
  if (!room) throw new HttpError(404, 'Room not found. Check the code and try again.');
  return room;
}

function findPlayer(room, token) {
  if (typeof token !== 'string' || token.length < 20) {
    throw new HttpError(401, 'Your player session is missing. Rejoin the room to continue.');
  }
  const player = room.players.find((candidate) => candidate.token === token);
  if (!player) throw new HttpError(401, 'This player session is no longer in the room.');
  return player;
}

function rankPlayers(room) {
  const players = [...room.players];
  players.sort((a, b) => {
    const stateA = a.forfeited ? 2 : a.solvedAt ? 0 : 1;
    const stateB = b.forfeited ? 2 : b.solvedAt ? 0 : 1;
    if (stateA !== stateB) return stateA - stateB;
    if (stateA === 0) {
      return a.guesses.length - b.guesses.length || a.solvedAt - b.solvedAt;
    }
    return 0;
  });

  let lastKey = '';
  let lastRank = 0;
  return players.map((player, index) => {
    const key = player.forfeited
      ? 'forfeited'
      : player.solvedAt
        ? `solved:${player.guesses.length}:${player.solvedAt - room.startedAt}`
        : 'unsolved';
    if (key !== lastKey) lastRank = index + 1;
    lastKey = key;
    const rank = room.status === 'playing' && !player.solvedAt && !player.forfeited
      ? null
      : lastRank;
    return { player, rank };
  });
}

function publicPlayer(player, rank, room, currentPlayerId) {
  const solveMs = player.solvedAt && room.startedAt ? player.solvedAt - room.startedAt : null;
  return {
    id: player.id,
    name: player.name,
    isYou: player.id === currentPlayerId,
    isHost: player.id === room.hostPlayerId,
    guessCount: player.guesses.length,
    solved: Boolean(player.solvedAt),
    solveSeconds: solveMs === null ? null : Math.floor(solveMs / 1000),
    forfeited: Boolean(player.forfeited),
    rank,
  };
}

function snapshot(room, player) {
  const rankedPlayers = rankPlayers(room);
  return {
    code: room.code,
    status: room.status,
    maxPlayers: room.maxPlayers,
    durationMinutes: room.durationMinutes,
    hostName: room.players.find((candidate) => candidate.id === room.hostPlayerId)?.name || 'Host',
    startedAt: room.startedAt,
    expiresAt: room.expiresAt,
    players: rankedPlayers.map(({ player: candidate, rank }) =>
      publicPlayer(candidate, rank, room, player.id)),
    self: {
      playerId: player.id,
      isHost: player.id === room.hostPlayerId,
      solved: Boolean(player.solvedAt),
      forfeited: Boolean(player.forfeited),
      guesses: player.guesses.slice(-18).reverse().map((guess) => ({
        value: guess.value,
        bulls: guess.bulls,
        cows: guess.cows,
        at: guess.at,
      })),
      guessCount: player.guesses.length,
    },
    ...(room.status === 'finished' ? { secret: room.secret } : {}),
  };
}

function broadcast(room) {
  const data = JSON.stringify({ room: room.code });
  for (const connection of [...room.connections]) {
    try {
      connection.response.write(`event: update\ndata: ${data}\n\n`);
    } catch {
      room.connections.delete(connection);
    }
  }
}

function finishRoom(room) {
  if (room.status !== 'playing') return;
  room.status = 'finished';
  room.finishedAt = Date.now();
  if (room.timer) clearTimeout(room.timer);
  broadcast(room);
  const cleanup = setTimeout(() => {
    if (ROOMS.get(room.code) !== room) return;
    for (const connection of room.connections) connection.response.end();
    ROOMS.delete(room.code);
  }, ROOM_LIFETIME_MS);
  cleanup.unref?.();
}

function startRoom(room) {
  if (room.status !== 'waiting') throw new HttpError(409, 'This room has already started.');
  if (room.players.length < 2) throw new HttpError(409, 'At least two players are needed to start.');
  room.status = 'playing';
  room.secret = makeSecret();
  room.startedAt = Date.now();
  room.expiresAt = room.startedAt + room.durationMinutes * 60 * 1000;
  room.timer = setTimeout(() => finishRoom(room), room.expiresAt - Date.now());
  room.timer.unref?.();
  broadcast(room);
}

function scoreGuess(secret, guess) {
  let bulls = 0;
  let sharedDigits = 0;
  for (let index = 0; index < secret.length; index += 1) {
    if (secret[index] === guess[index]) bulls += 1;
    if (secret.includes(guess[index])) sharedDigits += 1;
  }
  return { bulls, cows: sharedDigits - bulls };
}

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
    response.setHeader('access-control-max-age', '600');
    response.setHeader('vary', 'Origin');
  }
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function getToken(request, body, url) {
  const authorization = request.headers.authorization || '';
  return body?.token || authorization.replace(/^Bearer\s+/i, '') || url.searchParams.get('token');
}

function createRoom(body) {
  const maxPlayers = Number(body.maxPlayers);
  const durationMinutes = Number(body.durationMinutes);
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 8) {
    throw new HttpError(400, 'Choose a room size from 2 to 8 players.');
  }
  if (![2, 3, 5, 10].includes(durationMinutes)) {
    throw new HttpError(400, 'Choose a 2, 3, 5, or 10 minute timer.');
  }

  let code = randomCode(6);
  while (ROOMS.has(code)) code = randomCode(6);

  const player = {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(24).toString('base64url'),
    name: cleanName(body.name),
    joinedAt: Date.now(),
    guesses: [],
    solvedAt: null,
    forfeited: false,
    lastGuessAt: 0,
  };
  const room = {
    code,
    status: 'waiting',
    maxPlayers,
    durationMinutes,
    hostPlayerId: player.id,
    players: [player],
    connections: new Set(),
    createdAt: Date.now(),
    startedAt: null,
    expiresAt: null,
    secret: null,
    timer: null,
  };
  ROOMS.set(code, room);
  return { room: snapshot(room, player), playerToken: player.token };
}

function joinRoom(room, body) {
  if (room.status !== 'waiting') throw new HttpError(409, 'This room is no longer accepting players.');
  if (room.players.length >= room.maxPlayers) throw new HttpError(409, 'This room is full.');
  const player = {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(24).toString('base64url'),
    name: cleanName(body.name),
    joinedAt: Date.now(),
    guesses: [],
    solvedAt: null,
    forfeited: false,
    lastGuessAt: 0,
  };
  room.players.push(player);
  if (room.players.length >= room.maxPlayers) startRoom(room);
  else broadcast(room);
  return { room: snapshot(room, player), playerToken: player.token };
}

function serveStatic(urlPath, response) {
  const files = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/config.js': ['config.js', 'text/javascript; charset=utf-8'],
  };
  const file = files[urlPath];
  if (!file) return false;
  const filePath = path.join(PUBLIC_DIR, file[0]);
  try {
    const content = fs.readFileSync(filePath);
    response.writeHead(200, {
      'content-type': file[1],
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.bullscows.xyz; base-uri 'self'; frame-ancestors 'none'",
    });
    response.end(content);
    return true;
  } catch {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('The game files could not be loaded.');
    return true;
  }
}

async function handle(request, response) {
  setCorsHeaders(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const route = url.pathname.split('/').filter(Boolean);
  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json(response, 200, { ok: true, activeRooms: ROOMS.size });
  }

  if (request.method === 'POST' && url.pathname === '/api/rooms') {
    const body = await readBody(request);
    return json(response, 201, createRoom(body));
  }

  if (route[0] === 'api' && route[1] === 'rooms' && route[2]) {
    const room = findRoom(route[2]);
    if (request.method === 'POST' && route.length === 4 && route[3] === 'join') {
      return json(response, 200, joinRoom(room, await readBody(request)));
    }

    if (request.method === 'GET' && route.length === 3) {
      const token = getToken(request, {}, url);
      const player = findPlayer(room, token);
      return json(response, 200, { room: snapshot(room, player) });
    }

    if (request.method === 'GET' && route.length === 4 && route[3] === 'events') {
      const token = getToken(request, {}, url);
      const player = findPlayer(room, token);
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      response.write(`data: ${JSON.stringify({ room: snapshot(room, player) })}\n\n`);
      const connection = { response, playerId: player.id };
      room.connections.add(connection);
      const heartbeat = setInterval(() => {
        try { response.write(': keep-alive\n\n'); } catch { room.connections.delete(connection); }
      }, 20000);
      response.on('close', () => {
        clearInterval(heartbeat);
        room.connections.delete(connection);
      });
      return;
    }

    if (request.method === 'POST' && route.length === 4 && route[3] === 'start') {
      const body = await readBody(request);
      const player = findPlayer(room, getToken(request, body, url));
      if (player.id !== room.hostPlayerId) throw new HttpError(403, 'Only the room host can start the match.');
      startRoom(room);
      return json(response, 200, { room: snapshot(room, player) });
    }

    if (request.method === 'POST' && route.length === 4 && route[3] === 'guess') {
      const body = await readBody(request);
      const player = findPlayer(room, getToken(request, body, url));
      if (room.status !== 'playing') throw new HttpError(409, 'This match is not accepting guesses.');
      if (player.forfeited) throw new HttpError(409, 'You have left this match.');
      if (player.solvedAt) throw new HttpError(409, 'You already cracked the code.');
      const guess = typeof body.guess === 'string' ? body.guess : '';
      if (!/^\d{4}$/.test(guess) || new Set(guess).size !== 4) {
        throw new HttpError(400, 'Enter four different digits.');
      }
      const now = Date.now();
      if (now < room.expiresAt) {
        if (now - player.lastGuessAt < 650) throw new HttpError(429, 'Take a moment before your next guess.');
        player.lastGuessAt = now;
        const { bulls, cows } = scoreGuess(room.secret, guess);
        player.guesses.push({ value: guess, bulls, cows, at: now });
        if (bulls === 4) player.solvedAt = now;
      }
      if (room.players.filter((candidate) => !candidate.forfeited).every((candidate) => candidate.solvedAt)) {
        finishRoom(room);
      } else {
        broadcast(room);
      }
      return json(response, 200, { room: snapshot(room, player) });
    }

    if (request.method === 'POST' && route.length === 4 && route[3] === 'leave') {
      const body = await readBody(request);
      const player = findPlayer(room, getToken(request, body, url));
      if (room.status === 'waiting') {
        room.players = room.players.filter((candidate) => candidate.id !== player.id);
        if (room.hostPlayerId === player.id) room.hostPlayerId = room.players[0]?.id || null;
        if (room.players.length === 0) ROOMS.delete(room.code);
        else broadcast(room);
      } else if (room.status === 'playing') {
        player.forfeited = true;
        if (room.hostPlayerId === player.id) {
          room.hostPlayerId = room.players.find((candidate) => !candidate.forfeited)?.id || null;
        }
        if (room.players.filter((candidate) => !candidate.forfeited).every((candidate) => candidate.solvedAt)) {
          finishRoom(room);
        } else {
          broadcast(room);
        }
      }
      return json(response, 200, { ok: true });
    }
  }

  if (request.method === 'GET' && serveStatic(url.pathname, response)) return;
  throw new HttpError(404, 'That page was not found.');
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (!(error instanceof HttpError)) console.error(error);
    json(response, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
  });
});

const waitingRoomCleanup = setInterval(() => {
  const expiredBefore = Date.now() - ROOM_LIFETIME_MS;
  for (const room of ROOMS.values()) {
    if (room.status === 'waiting' && room.createdAt < expiredBefore) {
      for (const connection of room.connections) connection.response.end();
      ROOMS.delete(room.code);
    }
  }
}, 30 * 60 * 1000);
waitingRoomCleanup.unref?.();

server.listen(PORT, HOST, () => {
  console.log(`Bulls & Cows is listening on http://${HOST}:${PORT}`);
});
