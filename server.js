/**
 * Aurora-7 — Serveur principal.
 *
 * Express sert le client statique (./public).
 * Socket.IO gère le multijoueur temps réel.
 *
 * Architecture événementielle :
 *   Client -> Serveur :
 *     'lobby:create'   { name }                          -> 'lobby:joined'  { code, state }
 *     'lobby:join'     { code, name }                    -> 'lobby:joined' | 'lobby:error'
 *     'lobby:start'    {}                                -> diffuse 'state'
 *     'game:action'    { action }                        -> diffuse 'state'
 *     'chat:send'      { text }                          -> diffuse 'chat:msg'
 *     'lobby:restart'  {}                                -> diffuse 'state' (retour lobby)
 *
 *   Serveur -> Client :
 *     'state'          { ...snapshot }                   (état complet personnalisé)
 *     'chat:msg'       { author, text, ts }
 *     'chat:history'   [ messages ]
 *     'lobby:error'    { message }
 *     'pong'                                              (pour heartbeat)
 */

const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const { GameRoom } = require('./src/game/GameRoom');
const { generateUniqueRoomCode } = require('./src/utils/codeGenerator');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 20000,
});

// Sert le client statique
app.use(express.static(path.join(__dirname, 'public')));

// Healthcheck (utile pour Render)
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

/* -------------------------------------------------------------------------- */
/* État global en mémoire                                                     */
/* -------------------------------------------------------------------------- */

/** code -> GameRoom */
const rooms = new Map();
/** socketId -> { code, name } pour retrouver rapidement la salle d'un joueur */
const socketIndex = new Map();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function broadcastState(room) {
  // Snapshot personnalisé par joueur (chacun voit ce qu'il doit voir)
  for (const playerId of room.players.keys()) {
    const snap = room.snapshotFor(playerId);
    io.to(playerId).emit('state', snap);
  }
}

function sendStateTo(socketId, room) {
  io.to(socketId).emit('state', room.snapshotFor(socketId));
}

function emitError(socket, message) {
  socket.emit('lobby:error', { message });
}

function leaveCurrentRoom(socket, reason = 'leave') {
  const entry = socketIndex.get(socket.id);
  if (!entry) return;
  const room = rooms.get(entry.code);
  if (!room) {
    socketIndex.delete(socket.id);
    return;
  }
  room.markDisconnected(socket.id);
  socket.leave(entry.code);
  // On notifie les autres
  broadcastState(room);
  socketIndex.delete(socket.id);
}

/* -------------------------------------------------------------------------- */
/* Gestion socket                                                             */
/* -------------------------------------------------------------------------- */

io.on('connection', (socket) => {
  // Heartbeat custom (en plus du ping natif Socket.IO)
  socket.on('ping:client', () => socket.emit('pong:server'));

  /* ---- LOBBY : créer une salle ---- */
  socket.on('lobby:create', (payload = {}) => {
    try {
      const name = sanitizeName(payload.name);
      const code = generateUniqueRoomCode(new Set(rooms.keys()));
      const room = new GameRoom(code);
      rooms.set(code, room);
      room.addPlayer(socket.id, name);
      socket.join(code);
      socketIndex.set(socket.id, { code, name });
      socket.emit('lobby:joined', { code });
      // Historique de chat (vide à la création mais on l'envoie quand même)
      socket.emit('chat:history', room.chatLog);
      broadcastState(room);
    } catch (e) {
      console.error('[lobby:create]', e);
      emitError(socket, 'Impossible de créer la salle.');
    }
  });

  /* ---- LOBBY : rejoindre ---- */
  socket.on('lobby:join', (payload = {}) => {
    try {
      const code = sanitizeCode(payload.code);
      const name = sanitizeName(payload.name);
      const room = rooms.get(code);
      if (!room) return emitError(socket, "Cette salle n'existe pas.");

      // Tentative de reconnexion par nom (si la partie a déjà commencé)
      const reconnected = room.reconnectPlayer(name, socket.id);
      if (reconnected) {
        socket.join(code);
        socketIndex.set(socket.id, { code, name });
        socket.emit('lobby:joined', { code });
        socket.emit('chat:history', room.chatLog);
        broadcastState(room);
        return;
      }

      // Nouvelles connexions interdites pendant la partie (sauf reconnexion)
      if (room.state !== 'LOBBY') {
        return emitError(
          socket,
          "La partie a déjà commencé. Utilisez le même pseudo qu'avant pour vous reconnecter."
        );
      }

      // Vérifie l'unicité du pseudo dans la salle
      const nameTaken = [...room.players.values()].some(p => p.name === name);
      if (nameTaken) return emitError(socket, 'Ce pseudo est déjà utilisé dans cette salle.');

      // Limite à 4 joueurs
      if (room.players.size >= 4) return emitError(socket, 'Cette salle est pleine (4 joueurs max).');

      room.addPlayer(socket.id, name);
      socket.join(code);
      socketIndex.set(socket.id, { code, name });
      socket.emit('lobby:joined', { code });
      socket.emit('chat:history', room.chatLog);
      broadcastState(room);
    } catch (e) {
      console.error('[lobby:join]', e);
      emitError(socket, 'Erreur lors de la connexion à la salle.');
    }
  });

  /* ---- LOBBY : démarrer ---- */
  socket.on('lobby:start', () => {
    const entry = socketIndex.get(socket.id);
    if (!entry) return;
    const room = rooms.get(entry.code);
    if (!room) return;
    if (room.hostId !== socket.id) return emitError(socket, "Seul l'hôte peut lancer la partie.");
    if (room.players.size < 2) return emitError(socket, 'Il faut au moins 2 joueurs.');
    const ok = room.start();
    if (!ok) return emitError(socket, 'Impossible de démarrer la partie.');
    broadcastState(room);
  });

  /* ---- LOBBY : recommencer après victoire/défaite ---- */
  socket.on('lobby:restart', () => {
    const entry = socketIndex.get(socket.id);
    if (!entry) return;
    const room = rooms.get(entry.code);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.state !== 'WON' && room.state !== 'LOST') return;
    // Reset de la partie en gardant les joueurs
    room.state = 'LOBBY';
    room.currentRoomIndex = 0;
    room.puzzle = null;
    room.startedAt = null;
    room.endsAt = null;
    // On nettoie les joueurs déconnectés à ce moment-là
    for (const [id, p] of [...room.players.entries()]) {
      if (!p.connected) room.players.delete(id);
    }
    broadcastState(room);
  });

  /* ---- JEU : actions ---- */
  socket.on('game:action', (payload = {}) => {
    const entry = socketIndex.get(socket.id);
    if (!entry) return;
    const room = rooms.get(entry.code);
    if (!room) return;
    const action = payload.action;
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') return;
    const { changed } = room.handleAction(socket.id, action);
    if (changed) broadcastState(room);
  });

  /* ---- CHAT ---- */
  socket.on('chat:send', (payload = {}) => {
    const entry = socketIndex.get(socket.id);
    if (!entry) return;
    const room = rooms.get(entry.code);
    if (!room) return;
    const msg = room.addChatMessage(socket.id, payload.text);
    if (msg) io.to(room.code).emit('chat:msg', msg);
  });

  /* ---- DÉCONNEXION ---- */
  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
  });
});

/* -------------------------------------------------------------------------- */
/* Boucles de jeu globales                                                    */
/* -------------------------------------------------------------------------- */

// Tick rapide pour la séquence de lancement (5 Hz)
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const changed = room.tickPuzzle(now);
    if (changed) broadcastState(room);
  }
}, 200);

// Tick lent pour le timer global (1 Hz) + nettoyage
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.checkTimer(now)) {
      broadcastState(room);
    } else if (room.state === 'PLAYING') {
      // Mise à jour régulière du timer côté client
      broadcastState(room);
    }
    // Nettoyage : salles vides depuis plus de 10 min
    if (room.isEmpty() && now - room.lastActivity > 10 * 60 * 1000) {
      rooms.delete(code);
    }
  }
}, 1000);

/* -------------------------------------------------------------------------- */
/* Helpers de validation                                                      */
/* -------------------------------------------------------------------------- */

function sanitizeName(name) {
  const s = String(name || '').trim().slice(0, 20);
  return s || 'Joueur';
}

function sanitizeCode(code) {
  return String(code || '').trim().toUpperCase().slice(0, 6);
}

/* -------------------------------------------------------------------------- */
/* Démarrage                                                                  */
/* -------------------------------------------------------------------------- */

server.listen(PORT, () => {
  console.log(`Aurora-7 en orbite sur http://localhost:${PORT}`);
});

// Arrêt propre
process.on('SIGTERM', () => {
  console.log('Arrêt du serveur...');
  io.close();
  server.close(() => process.exit(0));
});
