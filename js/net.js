/* ============================================================
   PEER-TO-PEER LINK
   ============================================================
   Two browsers talk directly over WebRTC (via PeerJS). The free
   PeerJS cloud server is used only to make the introduction, so
   we run no backend. A room code is just the host's peer id.

   Everything here assumes connections WILL drop (sleep, Wi-Fi
   blips, reloads), so both sides keep quietly retrying:
     - lost the PeerJS server -> reconnect with the same id
     - connection silent too long -> treat as dead, close it
     - guest lost the host -> keep reconnecting until it's back
   ============================================================ */

const PEER_PREFIX = 'hbgg-';
const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // Strict networks (corporate, some mobile) need a TURN relay.
      // e.g. a free metered.ca or Cloudflare Calls account:
      // { urls: 'turn:...', username: '...', credential: '...' },
    ],
  },
};

const HEARTBEAT_MS  = 4000;    // each side pings this often
const DEAD_AFTER_MS = 15000;   // nothing heard for this long = dead
const RETRY_MS      = 2000;

let conn = null;   // the one open connection to our partner

function randomRoomCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/* Watch one connection: report open/close exactly once, and ping
   so a silently dead link is noticed instead of hanging forever. */
function wire(c, h) {
  let lastSeen = Date.now();
  let timer = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    if (conn === c) conn = null;
    c.close();
    h.onClose();
  };

  c.on('open', () => {
    conn = c;
    lastSeen = Date.now();
    timer = setInterval(() => {
      if (Date.now() - lastSeen > DEAD_AFTER_MS) close();
      else c.send({ ping: 1 });
    }, HEARTBEAT_MS);
    h.onConnect();
  });
  c.on('data', (msg) => {
    lastSeen = Date.now();
    if (!msg.ping) h.onMessage(msg);
  });
  c.on('close', close);
  c.on('error', close);
  setTimeout(() => { if (!c.open) close(); }, DEAD_AFTER_MS);   // never got through
}

// If we lose the PeerJS server, get back on it (keeping our id).
function stayOnline(peer) {
  peer.on('disconnected', () => setTimeout(() => {
    if (!peer.destroyed && peer.disconnected) peer.reconnect();
  }, RETRY_MS));
}

/* Host: open a room and accept the guest (again and again, if they drop). */
function hostRoom(code, h, attempt = 0) {
  const peer = new Peer(PEER_PREFIX + code, PEER_OPTIONS);
  stayOnline(peer);
  peer.once('open', () => h.onReady(code));
  peer.on('connection', (c) => {
    if (conn) conn.close();     // newest guest wins (e.g. friend reloaded)
    wire(c, h);
  });
  peer.on('error', (e) => {
    // Right after a reload the server may still hold our old id for a moment.
    if (e.type === 'unavailable-id' && attempt < 5) {
      peer.destroy();
      setTimeout(() => hostRoom(code, h, attempt + 1), RETRY_MS);
    } else if (e.type === 'unavailable-id') {
      h.onError('This room is already open in another tab.');
    } else {
      console.warn('peer error:', e.type);
    }
  });
}

/* Guest: connect to a room, and keep reconnecting whenever it drops. */
function joinRoom(code, h) {
  const peer = new Peer(PEER_OPTIONS);
  stayOnline(peer);

  const retry = () => setTimeout(connect, RETRY_MS);
  const connect = () => {
    if (peer.destroyed) return;
    if (!peer.open) return retry();
    wire(peer.connect(PEER_PREFIX + code, { reliable: true }), {
      ...h,
      onClose: () => { h.onClose(); retry(); },
    });
  };

  peer.once('open', connect);
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') h.onWaiting();   // host is away; we keep retrying
    else console.warn('peer error:', e.type);
  });
}

function send(msg) {
  if (conn?.open) conn.send(msg);
}
