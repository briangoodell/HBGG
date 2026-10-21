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
  send({ state });
  render();
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
  const g = $('grid');
  g.innerHTML = '<div></div>' + board.cols.map((c) => `<div class="label">${c}</div>`).join('');
  board.rows.forEach((row, r) => {
    g.insertAdjacentHTML('beforeend', `<div class="label">${row}</div>`);
    for (let c = 0; c < 3; c++) {
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

function lobby(html) {
  $('lobby').hidden = false;
  $('game').hidden  = true;
  $('lobby-msg').innerHTML = html;
}

/* ---- Controls --------------------------------------------- */

$('pick-form').onsubmit = (e) => {
  e.preventDefault();
  const name = $('pick-input').value.trim();
  const c = countries.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!c || state.cells.includes(c.name)) return $('pick-input').select();
  $('pick-input').value = '';
  dispatch({ type: 'pick', country: c.name });
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
  $('countries').innerHTML = countries.map((c) => `<option value="${c.name}">`).join('');
  $('board-select').innerHTML = boardList.map((b) => `<option value="${b.id}">${b.title}</option>`).join('');

  const handlers = {
    onMessage,
    onError: (type) => lobby(type === 'peer-unavailable'
      ? 'Room not found. Ask your friend for a fresh link.'
      : `Connection error: ${type}`),
    onClose: () => lobby(ME === 'host'
      ? 'Your partner disconnected. They can rejoin with the same link.'
      : 'Lost the host. Reload to reconnect.'),
    onConnect: () => {
      if (ME === 'host') { send({ state }); render(); }
      else lobby('Connected. Loading game…');
    },
  };

  if (ME === 'host') {
    await loadBoard(boardList[0].id);
    state = newGame(board.id);
    lobby('Opening a room…');
    hostRoom({
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
