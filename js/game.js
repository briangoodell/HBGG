/* ============================================================
   GAME RULES
   ============================================================
   Pure state + rules: no DOM, no network. The host is the
   single source of truth: every action (from either player)
   goes through applyAction() on the host, and the host sends
   the resulting state to the guest.

   Roles: the BRAIN picks a country, the HAND places it.

   Cells are always stored in the board's own order. Each player
   just *sees* the rows and columns in a different order (views),
   so neither can follow the other's layout.
   ============================================================ */

const MAX_GUESSES = 10;

/* ---- Views ------------------------------------------------ */

function shuffle3() {
  const p = [0, 1, 2];
  for (let i = 2; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

// Rotating by 1 or 2 moves every row/column to a different position.
const rotate = (p, k) => p.map((_, i) => p[(i + k) % 3]);
const rotateBy1or2 = (p) => rotate(p, 1 + Math.floor(Math.random() * 2));

function makeViews() {
  const rows = shuffle3(), cols = shuffle3();
  return {
    host:  { rows, cols },
    guest: { rows: rotateBy1or2(rows), cols: rotateBy1or2(cols) },
  };
}

function newGame(boardId, brain = 'host') {
  return {
    boardId,
    brain,              // 'host' | 'guest'; the other player is the hand
    views:   makeViews(),           // per player: display order of board rows/cols
    pending: null,      // country the brain picked, waiting to be placed
    cells:   Array(9).fill(null),   // country name per cell, row-major
    guesses: [],        // { country, cell, correct }; cell = null means discarded
  };
}

const guessesLeft = (s) => MAX_GUESSES - s.guesses.length;
const isOver      = (s) => guessesLeft(s) === 0 || s.cells.every(Boolean);
const roleOf      = (s, who) => (s.brain === who ? 'brain' : 'hand');

/* ---- Actions ---------------------------------------------- */
// Returns the next state, or the same state if the action is not allowed.

function applyAction(s, action, from, board) {
  const role = roleOf(s, from);

  switch (action.type) {
    case 'pick':
      if (role !== 'brain' || s.pending || isOver(s)) return s;
      if (s.cells.includes(action.country)) return s;
      return { ...s, pending: action.country };

    case 'unpick':
      if (role !== 'brain' || !s.pending) return s;
      return { ...s, pending: null };

    case 'place': {
      if (role !== 'hand' || !s.pending || s.cells[action.cell]) return s;
      const correct = board.answers[action.cell].includes(s.pending);
      const cells = [...s.cells];
      if (correct) cells[action.cell] = s.pending;
      return {
        ...s,
        cells,
        pending: null,
        guesses: [...s.guesses, { country: s.pending, cell: action.cell, correct }],
      };
    }

    case 'discard':
      if (role !== 'hand' || !s.pending) return s;
      return {
        ...s,
        pending: null,
        guesses: [...s.guesses, { country: s.pending, cell: null, correct: false }],
      };

    case 'swap':
      return { ...s, brain: s.brain === 'host' ? 'guest' : 'host', pending: null };

    case 'new':
      if (from !== 'host') return s;
      return newGame(action.boardId, s.brain);

    default:
      return s;
  }
}
