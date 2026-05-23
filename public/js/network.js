/**
 * Couche réseau — encapsule Socket.IO et expose une API simple.
 *
 * Caractéristiques :
 *  - reconnexion automatique gérée par Socket.IO
 *  - heartbeat applicatif (en plus du ping natif)
 *  - mémorise pseudo + code pour rejoindre automatiquement après reco
 *  - callbacks via .on(event, fn)
 */
(function (global) {
  const listeners = new Map(); // event -> Set<fn>
  let socket = null;
  let connected = false;
  let lastJoin = null; // { code, name }
  let heartbeatTimer = null;

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  }

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error('[listener]', event, e); }
    }
  }

  function connect() {
    if (socket) return socket;
    // io() est exposé par /socket.io/socket.io.js servi par le serveur
    socket = global.io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      connected = true;
      emit('connection:status', { connected: true });
      // Si on était dans une salle, on tente de la rejoindre
      if (lastJoin) {
        socket.emit('lobby:join', lastJoin);
      }
      startHeartbeat();
    });

    socket.on('disconnect', (reason) => {
      connected = false;
      emit('connection:status', { connected: false, reason });
      stopHeartbeat();
    });

    socket.on('connect_error', (err) => {
      emit('connection:status', { connected: false, error: err.message });
    });

    socket.on('lobby:joined', (data) => {
      // On garde le code pour les éventuelles reconnexions
      if (lastJoin) lastJoin.code = data.code;
      emit('lobby:joined', data);
    });

    socket.on('lobby:error', (data) => emit('lobby:error', data));
    socket.on('state', (data) => emit('state', data));
    socket.on('chat:msg', (data) => emit('chat:msg', data));
    socket.on('chat:history', (data) => emit('chat:history', data));
    socket.on('pong:server', () => emit('pong:server'));

    return socket;
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (socket && socket.connected) socket.emit('ping:client');
    }, 8000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function createRoom(name) {
    connect();
    lastJoin = { code: null, name };
    socket.emit('lobby:create', { name });
  }

  function joinRoom(code, name) {
    connect();
    lastJoin = { code: code.toUpperCase(), name };
    socket.emit('lobby:join', { code: code.toUpperCase(), name });
  }

  function startGame() {
    socket?.emit('lobby:start');
  }

  function restartGame() {
    socket?.emit('lobby:restart');
  }

  function sendAction(action) {
    socket?.emit('game:action', { action });
  }

  function sendChat(text) {
    socket?.emit('chat:send', { text });
  }

  function leaveRoom() {
    lastJoin = null;
    if (socket) {
      socket.disconnect();
      socket.connect();
    }
  }

  function isConnected() { return connected; }

  global.Net = {
    connect, on,
    createRoom, joinRoom, startGame, restartGame,
    sendAction, sendChat, leaveRoom, isConnected,
  };
})(window);
