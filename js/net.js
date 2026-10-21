/* ============================================================
   PEER-TO-PEER LINK
   ============================================================
   Two browsers talk directly over WebRTC (via PeerJS). The free
   PeerJS cloud server is used only to make the introduction, so
   we run no backend. A room code is just the host's peer id.
   ============================================================ */

const PEER_PREFIX = 'hbgg-';

let conn = null;

function randomRoomCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function wire(c, { onConnect, onMessage, onClose }) {
  c.on('open',  () => { conn = c; onConnect(); });
  c.on('data',  onMessage);
  c.on('close', () => { if (conn === c) conn = null; onClose(); });
}

/* Host: open a room and wait for one guest. */
function hostRoom(handlers) {
  const code = randomRoomCode();
  const peer = new Peer(PEER_PREFIX + code);
  peer.on('open', () => handlers.onReady(code));
  peer.on('connection', (c) => {
    if (conn) conn.close();     // newest guest wins (e.g. friend reloaded)
    wire(c, handlers);
  });
  peer.on('error', (e) => handlers.onError(e.type));
}

/* Guest: connect to an existing room. */
function joinRoom(code, handlers) {
  const peer = new Peer();
  peer.on('open',  () => wire(peer.connect(PEER_PREFIX + code, { reliable: true }), handlers));
  peer.on('error', (e) => handlers.onError(e.type));
}

function send(msg) {
  if (conn) conn.send(msg);
}
