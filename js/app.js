/* ============================================================
   APP — wires game rules, network and DOM together
   ============================================================
   No ?room= in the URL  -> you are the host (you make a link).
   ?room=abc123          -> you are the guest.

   Messages:  guest -> host  { action }
              host  -> guest { state }
   ============================================================ */

const params = new URLSearchParams(location.search);
const ROOM   = params.get('room');
const ME     = ROOM ? 'guest' : 'host';

let state     = null;   // current game state (see game.js)
let board     = null;   // current board data (see scripts/scrape.py)
let countries = [];     // [{ code, name }]

const $ = (id) => document.getElementById(id);

/* ---- Data ------------------------------------------------- */

const getJSON = (path) => fetch(path).then((r) => r.json());

async function loadBoard(id) {
  if (board?.id !== id) board = await getJSON(`data/boards/${id}.json`);
}

function flagUrl(name) {
  const c = countries.find((c) => c.name === name);
  return c ? `https://flagcdn.com/w80/${c.code.toLowerCase()}.png` : '';
}

// % of GeoGrid players who used this answer in this cell (null if the board has no rarity data)
function rarity(name, cell) {
  return board.rarity ? board.rarity[cell][name] ?? 0 : null;
}
const pctText = (name, cell) => (rarity(name, cell) === null ? '' : `${rarity(name, cell)}%`);

// GeoGrid's score: sum of the rarities of your answers, 100 per empty cell. Lower is better.
const rarityScore = () => state.cells.reduce((sum, name, i) => sum + (name ? rarity(name, i) : 100), 0);

/* ---- State flow ------------------------------------------- */

function dispatch(action) {
  if (ME === 'host') hostApply(action, 'host');
  else send({ action });
}

async function hostApply(action, from) {
  if (action.type === 'new' && from === 'host') await loadBoard(action.boardId);
  state = applyAction(state, action, from, board);
  saveHost();
  send({ state });
  render();
}

/* The host keeps its room + game in sessionStorage, so reloading the
   tab brings back the same room (the guest reconnects on its own).
   A new tab gets a new room. */
const HOST_KEY = 'hbgg-host';
let roomCode = null;

function saveHost() {
  try { sessionStorage.setItem(HOST_KEY, JSON.stringify({ roomCode, state })); } catch (_) {}
}
function loadHost() {
  try { return JSON.parse(sessionStorage.getItem(HOST_KEY)); } catch (_) { return null; }
}

async function onMessage(msg) {
  if (ME === 'host' && msg.action) return hostApply(msg.action, 'guest');
  if (ME === 'guest' && msg.state) {
    await loadBoard(msg.state.boardId);
    state = msg.state;
    render();
  }
}

/* ---- Rendering -------------------------------------------- */

function cellHTML(i) {
  const name = state.cells[i];
  if (name) return `<img src="${flagUrl(name)}" alt=""><span>${name}</span><span class="pct">${pctText(name, i)}</span>`;
  if (isOver(state)) return `<span class="muted">${board.answers[i].length} possible</span>`;
  return '';
}

function renderGrid() {
  const { rows, cols } = state.views[ME];
  const g = $('grid');
  g.innerHTML = '<div></div>' + cols.map((c) => `<div class="label">${board.cols[c]}</div>`).join('');
  rows.forEach((r) => {
    g.insertAdjacentHTML('beforeend', `<div class="label">${board.rows[r]}</div>`);
    for (const c of cols) {
      const i = 3 * r + c;
      const btn = document.createElement('button');
      btn.className = 'cell' + (state.cells[i] ? ' filled' : '');
      btn.innerHTML = cellHTML(i);
      btn.disabled  = !canPlace() || !!state.cells[i];
      btn.onclick   = () => dispatch({ type: 'place', cell: i });
      g.appendChild(btn);
    }
  });
}

const myRole   = () => roleOf(state, ME);
const canPlace = () => myRole() === 'hand' && state.pending && !isOver(state);

function renderPrompt() {
  const p = state.pending;
  const brain = myRole() === 'brain';
  const show = (id) => ['pick-form', 'unpick', 'discard'].forEach((x) => ($(x).hidden = x !== id));

  if (isOver(state)) {
    const score = state.cells.filter(Boolean).length;
    const rarityText = board.rarity ? ` · rarity ${rarityScore().toFixed(1)}` : '';
    $('prompt').textContent = `Game over: ${score} / 9${rarityText}`;
    show(null);
  } else if (brain && !p) {
    $('prompt').textContent = 'You are the Brain. Pick a country.';
    show('pick-form');
  } else if (brain && p) {
    $('prompt').innerHTML = `Waiting for the Hand to place <b>${p}</b>`;
    show('unpick');
  } else if (p) {
    $('prompt').innerHTML = `You are the Hand. Place <b>${p}</b>`;
    show('discard');
  } else {
    $('prompt').textContent = 'You are the Hand. Waiting for the Brain to pick…';
    show(null);
  }
}

function renderLog() {
  $('log').innerHTML = state.guesses.slice().reverse().map((g) => {
    const where = g.cell === null ? 'discarded'
      : `${board.rows[Math.floor(g.cell / 3)]} × ${board.cols[g.cell % 3]}`;
    const pct = g.correct ? ` <span class="pct">${pctText(g.country, g.cell)}</span>` : '';
    return `<li class="${g.correct ? 'ok' : 'bad'}">${g.country}${pct} <span class="muted">→ ${where}</span></li>`;
  }).join('');
}

function render() {
  notice('');
  $('lobby').hidden = true;
  $('game').hidden  = false;
  $('board-select').value = state.boardId;
  $('board-select').disabled = ME !== 'host';
  $('left').textContent = `${guessesLeft(state)} guesses left`;
  $('role').textContent = myRole() === 'brain' ? 'Brain' : 'Hand';
  renderGrid();
  renderPrompt();
  renderLog();
}

// A message about the connection: a banner over the game, or the lobby before it starts.
function notice(text) {
  if ($('game').hidden) return lobby(text);
  $('status').textContent = text;
  $('status').hidden = !text;
}

function lobby(html) {
  $('lobby').hidden = false;
  $('game').hidden  = true;
  $('lobby-msg').innerHTML = html;
}

/* ---- Controls --------------------------------------------- */

/* Country picker: type to filter, arrows + Enter or click to pick. */
let matches = [];   // countries shown in the dropdown
let active  = 0;    // highlighted one

function renderSuggest() {
  const q = $('pick-input').value.trim().toLowerCase();
  const starts = (c) => c.name.toLowerCase().startsWith(q);
  matches = !q ? [] : countries
    .filter((c) => c.name.toLowerCase().includes(q) && !state.cells.includes(c.name))
    .sort((a, b) => starts(b) - starts(a))   // prefix matches first, else alphabetical
    .slice(0, 8);
  active = Math.min(active, Math.max(matches.length - 1, 0));
  $('suggest').hidden = !matches.length;
  $('suggest').innerHTML = matches.map((c, i) =>
    `<li data-i="${i}" class="${i === active ? 'active' : ''}"><img src="${flagUrl(c.name)}" alt="">${c.name}</li>`
  ).join('');
}

function pickCountry(c) {
  $('pick-input').value = '';
  renderSuggest();
  dispatch({ type: 'pick', country: c.name });
}

$('pick-input').oninput = () => { active = 0; renderSuggest(); };
$('pick-input').onfocus = renderSuggest;
$('pick-input').onblur  = () => ($('suggest').hidden = true);
$('pick-input').onkeydown = (e) => {
  if (!matches.length || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
  renderSuggest();
};
$('suggest').onmousedown = (e) => e.preventDefault();   // keep focus in the input
$('suggest').onclick = (e) => {
  const li = e.target.closest('li');
  if (li) pickCountry(matches[li.dataset.i]);
};
$('pick-form').onsubmit = (e) => {
  e.preventDefault();
  if (matches.length) pickCountry(matches[active]);
};
$('unpick').onclick       = () => dispatch({ type: 'unpick' });
$('discard').onclick      = () => dispatch({ type: 'discard' });
$('swap').onclick         = () => dispatch({ type: 'swap' });
$('board-select').onchange = (e) => dispatch({ type: 'new', boardId: e.target.value });

/* ---- Start ------------------------------------------------ */

async function start() {
  const [boardList, countryList] = await Promise.all([
    getJSON('data/boards/index.json'),
    getJSON('data/countries.json'),
  ]);
  countries = countryList;
  $('board-select').innerHTML = boardList.map((b) => `<option value="${b.id}">${b.title}</option>`).join('');

  const handlers = {
    onMessage,
    onError:   (text) => lobby(text),
    onWaiting: () => notice('Waiting for the host to come back…'),
    onClose:   () => notice(ME === 'host'
      ? 'Your partner disconnected. Waiting for them to reconnect…'
      : 'Connection lost. Reconnecting…'),
    onConnect: () => {
      if (ME === 'host') { send({ state }); render(); }
      else notice('Connected. Loading game…');
    },
  };

  if (ME === 'host') {
    const saved = loadHost();
    roomCode = saved?.roomCode ?? randomRoomCode();
    state    = saved?.state ?? null;
    await loadBoard(state?.boardId ?? boardList[0].id);
    state ??= newGame(board.id);
    saveHost();
    lobby('Opening a room…');
    hostRoom(roomCode, {
      ...handlers,
      onReady: (code) => {
        const link = `${location.origin}${location.pathname}?room=${code}`;
        lobby(`Send this link to your partner:<br><input id="share" readonly value="${link}" onclick="this.select()">`);
      },
    });
  } else {
    lobby('Joining room…');
    joinRoom(ROOM, handlers);
  }
}

start();
