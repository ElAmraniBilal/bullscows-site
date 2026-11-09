const screen = document.querySelector('#screen');
const toast = document.querySelector('#toast');
const API_BASE = String(window.BULLS_COWS_API_BASE || '').replace(/\/+$/, '');

let currentRoom = null;
let currentToken = null;
let eventStream = null;
let eventStreamKey = '';
let clockInterval = null;
let toastTimeout = null;
let currentView = 'home';

const savedName = () => {
  try { return localStorage.getItem('bulls-cows-name') || ''; } catch { return ''; }
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function avatarClass(name) {
  let hash = 0;
  for (const character of String(name)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return ['green', 'coral', 'dark'][hash % 3];
}

function initials(name) {
  const parts = String(name || 'Player').trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0] || '').join('').toUpperCase();
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2800);
}

function fmtTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (currentToken) headers.authorization = `Bearer ${currentToken}`;
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify({ ...options.body, token: currentToken }) : undefined,
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}

function stopStream() {
  if (eventStream) eventStream.close();
  eventStream = null;
  eventStreamKey = '';
  clearInterval(clockInterval);
  clockInterval = null;
}

function connectStream() {
  if (!currentRoom || !currentToken) return;
  const key = `${currentRoom.code}:${currentToken}`;
  if (eventStreamKey === key && eventStream) return;
  if (eventStream) eventStream.close();
  eventStreamKey = key;
  eventStream = new EventSource(`${API_BASE}/api/rooms/${encodeURIComponent(currentRoom.code)}/events?token=${encodeURIComponent(currentToken)}`);
  const onRoomEvent = async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.room && typeof payload.room === 'object') {
        applyRoom(payload.room);
      } else {
        const result = await api(`/api/rooms/${encodeURIComponent(currentRoom.code)}`);
        applyRoom(result.room);
      }
    } catch (error) {
      if (error.message) showToast(error.message, true);
    }
  };
  eventStream.onmessage = onRoomEvent;
  eventStream.addEventListener('update', onRoomEvent);
}

function applyRoom(room) {
  const input = document.querySelector('#guess-input');
  const draft = input?.value || '';
  currentRoom = room;
  if (room.status === 'waiting') renderLobby();
  else if (room.status === 'playing') renderMatch(draft);
  else renderResults();
  connectStream();
  if (room.status === 'playing') startClock();
  else {
    clearInterval(clockInterval);
    clockInterval = null;
  }
}

function setName(value) {
  try { localStorage.setItem('bulls-cows-name', value.trim().slice(0, 20)); } catch { /* Private browsing may disable storage. */ }
}

function setRoomUrl(code) {
  const url = new URL(window.location.href);
  url.pathname = '/';
  url.search = `?room=${encodeURIComponent(code)}`;
  url.hash = '';
  history.replaceState({}, '', url);
}

function homeUrl() {
  history.replaceState({}, '', '/');
}

function roomShareUrl() {
  return `${window.location.origin}/?room=${encodeURIComponent(currentRoom.code)}`;
}

function renderHome() {
  currentView = 'home';
  const queryCode = new URLSearchParams(window.location.search).get('room') || '';
  screen.innerHTML = `
    <div class="home">
      <section class="hero-grid" aria-labelledby="hero-title">
        <div class="hero-copy">
          <div class="eyebrow"><span class="eyebrow-mark">✳</span> A LIVE NUMBER DUEL</div>
          <h1 class="hero-title" id="hero-title">Think quick.<br>Crack it <em>first.</em></h1>
          <p class="hero-description">One secret number. One ticking clock. Challenge your friends and race to solve it in the fewest guesses.</p>
          <div class="hero-actions">
            <button class="button button-ink" type="button" data-action="create">Create a challenge <span aria-hidden="true">↗</span></button>
            <a class="button button-quiet" href="#how-to-play">How it works <span aria-hidden="true">↓</span></a>
          </div>
          <div class="hero-footnote"><span>✦</span> No account. Just a code and a little friendly pressure.</div>
        </div>
        <div class="preview-wrap" aria-label="Preview of a live match">
          <div class="preview-orbit"></div>
          <div class="stamp"><span>✳</span> FRIENDS ARE WAITING</div>
          <div class="preview-card">
            <div class="preview-head">
              <div class="preview-label"><span class="brand-mark" style="width:25px;height:25px;border-radius:8px"><svg viewBox="0 0 40 40" fill="none"><path d="M12 8v11a8 8 0 0 0 16 0V8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M9 8h6M25 8h6M20 27v5m-6 0h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span> ROOM <b>Q7M2KX</b></div>
              <span class="preview-live"><i></i> LIVE</span>
              <span class="preview-clock">02:18</span>
            </div>
            <div class="preview-body">
              <div>
                <div class="preview-board-title">YOUR GUESSES</div>
                <div class="guess-row"><span class="guess-tile">1</span><span class="guess-tile">2</span><span class="guess-tile">3</span><span class="guess-tile">4</span><span class="guess-score"><b class="score-bull">1B</b> · 2C</span></div>
                <div class="guess-row"><span class="guess-tile">6</span><span class="guess-tile">8</span><span class="guess-tile">0</span><span class="guess-tile">2</span><span class="guess-score"><b class="score-bull">2B</b> · 1C</span></div>
                <div class="guess-row"><span class="guess-tile hit">6</span><span class="guess-tile hit">9</span><span class="guess-tile hit">0</span><span class="guess-tile hit">2</span><span class="guess-score"><b class="score-bull">4B</b> · 0C</span></div>
              </div>
              <div>
                <div class="preview-rank-title">ROOM STANDINGS</div>
                <div class="preview-rank-list">
                  <div class="preview-player"><span class="avatar dark">AJ</span><span>Alex J.</span><span class="preview-place">1st</span></div>
                  <div class="preview-player"><span class="avatar coral">MK</span><span>Mika K.</span><span class="preview-place">2nd</span></div>
                  <div class="preview-player"><span class="avatar">YD</span><span>You</span><span class="preview-place">3rd</span></div>
                </div>
              </div>
            </div>
            <div class="preview-foot"><span>FEWEST GUESSES WINS</span><strong><b>04</b> GUESSES</strong></div>
          </div>
        </div>
      </section>

      <section class="challenge-strip" aria-labelledby="join-heading">
        <div>
          <h2 class="strip-title" id="join-heading">Got a room code?</h2>
          <p class="strip-copy">Jump into a friend's challenge. You can join before the match starts.</p>
        </div>
        <form class="join-form" id="join-form">
          <input class="field" name="name" autocomplete="nickname" maxlength="20" placeholder="Your name" value="${esc(savedName())}" aria-label="Your name">
          <input class="field code-field" name="code" autocomplete="off" maxlength="6" placeholder="ENTER CODE" value="${esc(queryCode)}" aria-label="Room code" required>
          <button class="button button-lime" type="submit">Join room <span aria-hidden="true">→</span></button>
        </form>
      </section>

      <section class="how-section" id="how-to-play" aria-labelledby="how-heading">
        <div><h2 class="how-heading" id="how-heading">Four digits.<br>Two kinds of clues.</h2><p class="how-sub">A classic code-breaking game, with your friends racing the same clock.</p></div>
        <div class="how-steps">
          <article class="how-step"><span class="step-number">01</span><h3>Pick a secret</h3><p>The room gets one hidden four-digit number. Every digit is different.</p></article>
          <article class="how-step"><span class="step-number">02</span><h3>Read the clues</h3><p>A <b>bull</b> is right digit, right spot. A <b>cow</b> is right digit, wrong spot.</p></article>
          <article class="how-step"><span class="step-number">03</span><h3>Beat the room</h3><p>Solve in fewer guesses. If players tie on guesses, the faster solve takes it.</p></article>
        </div>
      </section>
    </div>`;
}

function renderCreate() {
  currentView = 'create';
  screen.innerHTML = `
    <section class="subpage">
      <a class="back-link" href="/" data-action="home">← Back to the lobby</a>
      <div class="eyebrow"><span class="eyebrow-mark">✳</span> SET UP YOUR CHALLENGE</div>
      <h1 class="subpage-heading">Make it a match.</h1>
      <p class="subpage-intro">Choose the room size and clock. We'll give you a code to share.</p>
      <form class="form-card" id="create-form">
        <div class="form-grid">
          <label class="form-field full"><span class="form-label">Your name</span><input class="field" name="name" autocomplete="nickname" maxlength="20" placeholder="e.g. Alex" value="${esc(savedName())}" required></label>
          <label class="form-field"><span class="form-label">Players in the room</span><select class="field field-select" name="maxPlayers">${Array.from({ length: 7 }, (_, index) => index + 2).map((count) => `<option value="${count}" ${count === 4 ? 'selected' : ''}>${count} players</option>`).join('')}</select></label>
          <div class="form-field"><span class="form-label">Time control</span><div class="time-options">
            ${[2, 3, 5, 10].map((minutes) => `<label class="time-option"><input type="radio" name="durationMinutes" value="${minutes}" ${minutes === 5 ? 'checked' : ''}><span>${minutes} min</span></label>`).join('')}
          </div></div>
        </div>
        <div class="form-note"><b>✳</b> Everyone gets the same secret number. The room starts when it's full, or you can start early.</div>
        <p class="form-error" id="create-error" aria-live="polite"></p>
        <div class="form-actions"><button class="button button-ink button-wide" type="submit">Create room <span aria-hidden="true">↗</span></button></div>
      </form>
    </section>`;
}

function playerRows(room, waiting = false) {
  const rows = room.players.map((player) => `
    <div class="player-row">
      <div class="player-ident"><span class="avatar ${avatarClass(player.name)}">${esc(initials(player.name))}</span><span class="player-name">${esc(player.name)}${player.isYou ? '<span class="player-you">YOU</span>' : ''}</span></div>
      ${player.isHost ? '<span class="host-tag">HOST</span>' : '<span class="panel-caption">JOINED</span>'}
    </div>`).join('');
  const slots = waiting ? Array.from({ length: Math.max(0, room.maxPlayers - room.players.length) }, () => `
    <div class="waiting-slot"><span class="slot-icon">＋</span><span>Waiting for a challenger…</span></div>`).join('') : '';
  return rows + slots;
}

function renderLobby() {
  currentView = 'lobby';
  const room = currentRoom;
  if (!room) return renderHome();
  const canStart = room.self.isHost && room.players.length >= 2;
  const share = roomShareUrl();
  screen.innerHTML = `
    <section class="room-page">
      <div class="room-topline">
        <div>
          <div class="room-kicker">CHALLENGE LOBBY · ${room.players.length} OF ${room.maxPlayers} PLAYERS</div>
          <h1 class="room-heading">Waiting on your crew <span class="waiting-indicator"><i></i> OPEN</span></h1>
          <div class="room-meta"><span>${room.maxPlayers} players</span><span class="meta-dot">·</span><span>${room.durationMinutes} minute clock</span><span class="meta-dot">·</span><span>4 unique digits</span></div>
        </div>
        <div class="room-topline-right"><div class="room-actions"><span class="room-code">ROOM CODE <strong>${esc(room.code)}</strong></span><button class="button button-quiet button-small" type="button" data-action="copy-code">Copy code</button><button class="button button-quiet button-small" type="button" data-action="leave">Leave</button></div></div>
      </div>
      <div class="room-lobby-grid">
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Players in the room</h2><span class="panel-caption">${room.players.length} / ${room.maxPlayers} JOINED</span></div>
          <div class="player-list">${playerRows(room, true)}</div>
        </section>
        <aside>
          <div class="copy-card">
            <div class="panel-caption">INVITE YOUR FRIENDS</div>
            <div class="share-link">${esc(share)}</div>
            <button class="button button-small button-wide" type="button" data-action="copy-link">Copy invite link <span aria-hidden="true">↗</span></button>
          </div>
          <div class="lobby-start">
            ${room.self.isHost
              ? `<button class="button button-ink" type="button" data-action="start" ${canStart ? '' : 'disabled'}>${room.players.length >= room.maxPlayers ? 'Room is full' : 'Start match now'} <span aria-hidden="true">→</span></button><p class="host-tip">${canStart ? 'Start whenever everyone is ready. The clock starts for all players at once.' : 'The match will start as soon as one more player joins.'}</p>`
              : '<div class="panel panel-pad"><span class="waiting-indicator"><i></i> Waiting for the host to start</span><p class="host-tip">Keep this page open. You will move straight into the match when it begins.</p></div>'}
          </div>
          <div class="panel panel-pad" style="margin-top:14px"><div class="panel-head"><h2 class="panel-title">Match settings</h2><span class="panel-caption">LOCKED IN</span></div><div class="settings-list"><div class="setting-row"><span>Players</span><strong>${room.maxPlayers} max</strong></div><div class="setting-row"><span>Time control</span><strong>${room.durationMinutes}:00</strong></div><div class="setting-row"><span>Secret</span><strong>4 unique digits</strong></div></div></div>
        </aside>
      </div>
    </section>`;
}

function standingsMarkup(room) {
  return room.players.map((player) => {
    const state = player.forfeited ? 'FORFEIT' : player.solved ? `SOLVED · ${fmtTime(player.solveSeconds)}` : `${player.guessCount} GUESSES`;
    return `<div class="standings-row ${player.isYou ? 'you' : ''}">
      <span class="standing-rank">${player.rank ? String(player.rank).padStart(2, '0') : '—'}</span>
      <span class="standing-person"><span class="avatar ${avatarClass(player.name)}">${esc(initials(player.name))}</span><span class="standing-name">${esc(player.name)}${player.isYou ? '<small>YOU</small>' : ''}</span></span>
      <span class="standing-score ${player.solved ? 'solved' : ''}">${state}</span>
    </div>`;
  }).join('');
}

function renderHistory(room) {
  if (!room.self.guesses.length) return '<div class="empty-history">Your first guess is waiting.<br>Take a shot at the code.</div>';
  return `<table class="history-table"><thead><tr><th>Guess</th><th>Clues</th><th>Result</th></tr></thead><tbody>${room.self.guesses.map((guess) => `
    <tr><td class="guess-value">${esc(guess.value)}</td><td><span class="result-pills"><span class="result-pill bull">${guess.bulls} bull${guess.bulls === 1 ? '' : 's'}</span><span class="result-pill cow">${guess.cows} cow${guess.cows === 1 ? '' : 's'}</span></span></td><td>${guess.bulls === 4 ? '<span class="host-tag">CRACKED</span>' : `<span class="panel-caption">#${Math.max(1, room.self.guessCount - room.self.guesses.indexOf(guess))}</span>`}</td></tr>`).join('')}</tbody></table>`;
}

function renderMatch(draft = '') {
  currentView = 'match';
  const room = currentRoom;
  if (!room) return renderHome();
  const remaining = Math.max(0, Math.ceil((room.expiresAt - Date.now()) / 1000));
  const solvedPlayer = room.players.find((player) => player.isYou && player.solved);
  screen.innerHTML = `
    <section class="room-page">
      <div class="match-top">
        <div class="match-info"><span class="brand-mark"><svg viewBox="0 0 40 40" fill="none"><path d="M12 8v11a8 8 0 0 0 16 0V8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M9 8h6M25 8h6M20 27v5m-6 0h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span><div><h1 class="match-title">Crack the shared code</h1><div class="match-caption">ROOM ${esc(room.code)} · ${room.maxPlayers} PLAYERS · ${room.durationMinutes} MINUTES</div></div></div>
        <div class="timer-box"><div class="timer-label">TIME REMAINING</div><div class="timer-value" id="clock-value">${fmtTime(remaining)}</div></div>
      </div>
      <div class="match-grid">
        <section>
          ${solvedPlayer ? `<div class="solve-banner"><div><strong>You cracked it!</strong><span>${room.self.guessCount} guesses · your solve is on the board.</span></div><b>#${String(solvedPlayer.rank).padStart(2, '0')}</b></div>` : ''}
          <div class="panel play-panel">
            <div class="play-panel-top"><h2 class="play-subtitle">Your guess board</h2><span class="try-count">${room.self.guessCount} ATTEMPT${room.self.guessCount === 1 ? '' : 'S'}</span></div>
            ${solvedPlayer
              ? '<div class="guess-entry"><span class="entry-label">YOU ARE LOCKED IN</span><p class="guess-help">Watch the standings while the rest of the room hunts down the number.</p></div>'
              : `<form class="guess-entry" id="guess-form"><label class="entry-label" for="guess-input">Your next guess</label><div class="entry-row"><input class="field guess-input" id="guess-input" name="guess" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]{4}" placeholder="0000" value="${esc(draft)}" required><button class="button button-ink" type="submit">Submit guess <span aria-hidden="true">→</span></button></div><p class="guess-help" id="guess-help">Four different digits. A bull is in the right place; a cow is in the wrong place.</p></form>`}
            <div class="history-wrap"><div class="history-head"><h3>Recent guesses</h3><span>ONLY YOU CAN SEE THESE</span></div>${renderHistory(room)}</div>
          </div>
        </section>
        <aside>
          <div class="panel standings-panel"><div class="panel-head"><h2 class="panel-title">Live standings</h2><span class="panel-caption">UPDATED LIVE</span></div><div class="standings-list">${standingsMarkup(room)}</div><p class="standings-note">Solve in fewer guesses to rank higher. If guesses tie, the quicker solve wins.</p></div>
          <div class="panel rules-card"><strong>THE CLUES</strong><p><b>Bull</b> = right digit, right place. <b>Cow</b> = right digit, different place. All four digits are unique.</p></div>
          <button class="button button-quiet button-small button-wide" style="margin-top:13px" type="button" data-action="leave">Leave match</button>
        </aside>
      </div>
    </section>`;
  if (!solvedPlayer) document.querySelector('#guess-input')?.focus({ preventScroll: true });
}

function renderResults() {
  currentView = 'results';
  clearInterval(clockInterval);
  clockInterval = null;
  const room = currentRoom;
  if (!room) return renderHome();
  const winners = room.players.filter((player) => player.rank === 1 && player.solved && !player.forfeited);
  const winner = winners[0];
  const title = winners.length > 1 ? 'Dead even.' : winner ? `${esc(winner.name)} takes it.` : 'Time is up.';
  const summary = winners.length > 1
    ? `${winners.length} players tied with ${winner.guessCount} guesses and the same solve time.`
    : winner
      ? `Cracked in ${winner.guessCount} guess${winner.guessCount === 1 ? '' : 'es'} and ${fmtTime(winner.solveSeconds)}.`
      : 'No one solved the shared code before the clock ran out.';
  const resultRows = room.players.map((player) => {
    let result = 'Time up';
    if (player.forfeited) result = 'Forfeit';
    else if (player.solved) result = `${player.guessCount} guesses`;
    const time = player.solved ? fmtTime(player.solveSeconds) : '—';
    return `<div class="results-row"><span class="results-rank">${String(player.rank).padStart(2, '0')}</span><span class="results-player"><span class="avatar ${avatarClass(player.name)}">${esc(initials(player.name))}</span>${esc(player.name)}${player.isYou ? '<span class="player-you">YOU</span>' : ''}</span><span class="results-cell ${player.rank === 1 && player.solved ? 'results-winner' : ''}">${result}</span><span class="results-cell">${time}</span><span class="results-cell">${player.rank === 1 && player.solved ? 'WINNER ✦' : player.forfeited ? '—' : 'FINISHED'}</span></div>`;
  }).join('');
  screen.innerHTML = `
    <section class="results-page">
      <div class="results-hero">
        <div class="eyebrow"><span class="eyebrow-mark">✳</span> MATCH COMPLETE · ROOM ${esc(room.code)}</div>
        <h1>${title}</h1>
        <p>${summary}</p>
        <div class="results-secret">THE SECRET WAS <strong>${esc(room.secret)}</strong></div>
      </div>
      <div class="panel results-table"><div class="results-table-head"><span>PLACE</span><span>PLAYER</span><span>GUESSES</span><span>SOLVE TIME</span><span>STATUS</span></div>${resultRows}</div>
      <div class="results-bottom"><p>Room ${esc(room.code)} · ${room.durationMinutes} minute challenge</p><button class="button button-ink" type="button" data-action="home">Back to the lobby <span aria-hidden="true">↗</span></button></div>
    </section>`;
}

function startClock() {
  clearInterval(clockInterval);
  const update = () => {
    const element = document.querySelector('#clock-value');
    if (!element || !currentRoom?.expiresAt) return;
    const remaining = Math.max(0, Math.ceil((currentRoom.expiresAt - Date.now()) / 1000));
    element.textContent = fmtTime(remaining);
    element.classList.toggle('urgent', remaining <= 30);
  };
  update();
  clockInterval = setInterval(update, 250);
}

function openRoom(room, token) {
  currentToken = token;
  currentRoom = room;
  try { sessionStorage.setItem(`bulls-cows:${room.code}`, token); } catch { /* Room still works until the page closes. */ }
  setRoomUrl(room.code);
  applyRoom(room);
}

async function joinRoom(code, name) {
  const normalizedCode = String(code || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalizedCode)) throw new Error('Enter the 6-character room code.');
  const result = await api(`/api/rooms/${encodeURIComponent(normalizedCode)}/join`, {
    method: 'POST', body: { name: name || 'Player' },
  });
  setName(name || 'Player');
  openRoom(result.room, result.playerToken);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const field = document.createElement('textarea');
    field.value = value;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
  showToast('Invite link copied.');
}

async function restoreRoom() {
  const code = new URLSearchParams(window.location.search).get('room');
  if (!code) return false;
  let token = null;
  try { token = sessionStorage.getItem(`bulls-cows:${code.toUpperCase()}`); } catch { /* Keep the join form available. */ }
  if (!token) return false;
  currentToken = token;
  try {
    const result = await api(`/api/rooms/${encodeURIComponent(code)}`);
    currentRoom = result.room;
    applyRoom(result.room);
    return true;
  } catch {
    currentToken = null;
    return false;
  }
}

screen.addEventListener('click', async (event) => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const action = control.dataset.action;
  if (control.tagName === 'A' && action === 'home') event.preventDefault();
  if (action === 'create') {
    stopStream();
    currentRoom = null;
    currentToken = null;
    renderCreate();
  } else if (action === 'home') {
    stopStream();
    currentRoom = null;
    currentToken = null;
    homeUrl();
    renderHome();
  } else if (action === 'copy-link') {
    await copyText(roomShareUrl());
  } else if (action === 'copy-code') {
    try {
      await navigator.clipboard.writeText(currentRoom.code);
      showToast('Room code copied.');
    } catch {
      showToast(`Room code: ${currentRoom.code}`);
    }
  } else if (action === 'start') {
    control.disabled = true;
    try {
      const result = await api(`/api/rooms/${encodeURIComponent(currentRoom.code)}/start`, { method: 'POST', body: {} });
      applyRoom(result.room);
    } catch (error) {
      showToast(error.message, true);
      control.disabled = false;
    }
  } else if (action === 'leave') {
    const code = currentRoom?.code;
    if (code) {
      try { await api(`/api/rooms/${encodeURIComponent(code)}/leave`, { method: 'POST', body: {} }); } catch { /* Return to the lobby even if a room expired. */ }
      try { sessionStorage.removeItem(`bulls-cows:${code}`); } catch { /* Ignore unavailable storage. */ }
    }
    stopStream();
    currentRoom = null;
    currentToken = null;
    homeUrl();
    renderHome();
  }
});

screen.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);

  if (form.id === 'join-form') {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const name = String(data.get('name') || 'Player').trim().slice(0, 20) || 'Player';
    try {
      await joinRoom(data.get('code'), name);
    } catch (error) {
      showToast(error.message, true);
      button.disabled = false;
    }
  }

  if (form.id === 'create-form') {
    const button = form.querySelector('button[type="submit"]');
    const errorBox = document.querySelector('#create-error');
    button.disabled = true;
    errorBox.textContent = '';
    const name = String(data.get('name') || 'Player').trim().slice(0, 20) || 'Player';
    try {
      const result = await api('/api/rooms', {
        method: 'POST',
        body: {
          name,
          maxPlayers: Number(data.get('maxPlayers')),
          durationMinutes: Number(data.get('durationMinutes')),
        },
      });
      setName(name);
      openRoom(result.room, result.playerToken);
    } catch (error) {
      errorBox.textContent = error.message;
      button.disabled = false;
    }
  }

  if (form.id === 'guess-form') {
    const input = form.querySelector('#guess-input');
    const help = form.querySelector('#guess-help');
    const guess = String(data.get('guess') || '');
    if (!/^\d{4}$/.test(guess) || new Set(guess).size !== 4) {
      help.textContent = 'Use four different digits, from 0 to 9.';
      help.classList.add('error');
      input.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api(`/api/rooms/${encodeURIComponent(currentRoom.code)}/guess`, { method: 'POST', body: { guess } });
      applyRoom(result.room);
    } catch (error) {
      help.textContent = error.message;
      help.classList.add('error');
      button.disabled = false;
      input.focus();
    }
  }
});

screen.addEventListener('input', (event) => {
  if (event.target.matches('#join-form [name="code"]')) {
    const cursor = event.target.selectionStart;
    event.target.value = event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6);
    event.target.setSelectionRange(Math.min(cursor, event.target.value.length), Math.min(cursor, event.target.value.length));
  }
  if (event.target.matches('#guess-input')) {
    const guess = event.target.value.replace(/\D/g, '').slice(0, 4);
    if (guess !== event.target.value) event.target.value = guess;
    document.querySelector('#guess-help')?.classList.remove('error');
  }
});

document.querySelectorAll('[data-action="create"]').forEach((button) => {
  button.addEventListener('click', () => {
    stopStream();
    currentRoom = null;
    currentToken = null;
    renderCreate();
  });
});

(async () => {
  const restored = await restoreRoom();
  if (!restored) renderHome();
})();
