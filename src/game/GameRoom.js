/**
 * GameRoom — représente une partie (lobby + jeu).
 *
 * État de la partie :
 *  - LOBBY    : attente de joueurs, l'hôte peut lancer
 *  - PLAYING  : énigme en cours, timer actif
 *  - WON      : tous les puzzles résolus
 *  - LOST     : timer écoulé
 *
 * Le serveur est autoritaire : il valide les actions, applique la logique,
 * et émet des « snapshots » d'état à tous les clients (filtrés par joueur).
 */

const Puzzles = require('./Puzzles');

const ROOMS_SEQUENCE = [
  {
    id: 'cryotube',
    name: 'Salle de cryogénisation',
    intro: 'Vous vous réveillez dans une station spatiale en perdition. Sur le mur, un panneau de symboles clignote — il faut le décoder pour ouvrir la porte.',
    puzzleType: 'SYMBOL_SEQUENCE',
  },
  {
    id: 'serverhub',
    name: 'Cœur informatique',
    intro: 'Les serveurs grillent. Un écran central affiche une cible — vous devez stabiliser le réseau en activant les bons interrupteurs.',
    puzzleType: 'WIRE_ROUTING',
  },
  {
    id: 'escapebay',
    name: 'Sas de lancement',
    intro: 'La capsule de secours est prête. Chacun doit tenir son levier de mise à feu en même temps pendant 5 secondes.',
    puzzleType: 'LAUNCH_SEQUENCE',
  },
];

const TIMER_DURATION_MS = 20 * 60 * 1000; // 20 minutes

class GameRoom {
  constructor(code) {
    this.code = code;
    this.players = new Map();       // playerId -> { id, name, connected, isHost }
    this.hostId = null;
    this.state = 'LOBBY';
    this.currentRoomIndex = 0;
    this.puzzle = null;
    this.startedAt = null;
    this.endsAt = null;
    this.chatLog = [];              // { author, text, ts }
    this.lastActivity = Date.now();
  }

  /* ---------- Joueurs ---------- */

  addPlayer(id, name) {
    name = (name || '').trim().slice(0, 20) || 'Joueur';
    const isFirst = this.players.size === 0;
    this.players.set(id, {
      id, name,
      connected: true,
      isHost: isFirst,
    });
    if (isFirst) this.hostId = id;
    this.lastActivity = Date.now();
    return this.players.get(id);
  }

  /**
   * Reconnexion : on retrouve un slot par nom de joueur (cas où le socket id change).
   * Renvoie l'ancien playerId mis à jour, ou null si pas trouvé.
   */
  reconnectPlayer(oldName, newSocketId) {
    for (const [id, p] of this.players.entries()) {
      if (!p.connected && p.name === oldName) {
        // On migre l'entrée vers le nouveau socket id
        this.players.delete(id);
        const wasHost = p.isHost;
        const migrated = { ...p, id: newSocketId, connected: true };
        this.players.set(newSocketId, migrated);
        if (wasHost) this.hostId = newSocketId;
        // Si l'énigme courante référence l'ancien id (observateur, holding…), migrer
        this._migratePlayerId(id, newSocketId);
        this.lastActivity = Date.now();
        return migrated;
      }
    }
    return null;
  }

  _migratePlayerId(oldId, newId) {
    if (!this.puzzle) return;
    if (this.puzzle.observerId === oldId) this.puzzle.observerId = newId;
    if (this.puzzle.holding && oldId in this.puzzle.holding) {
      this.puzzle.holding[newId] = this.puzzle.holding[oldId];
      delete this.puzzle.holding[oldId];
    }
  }

  markDisconnected(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    // Si l'hôte se déconnecte, on transmet le rôle
    if (id === this.hostId) {
      const next = [...this.players.values()].find(pl => pl.connected);
      if (next) {
        this.hostId = next.id;
        next.isHost = true;
        p.isHost = false;
      }
    }
    // Pour la séquence de lancement : relâcher son bouton automatiquement
    if (this.puzzle && this.puzzle.holding) {
      this.puzzle.holding[id] = false;
    }
    this.lastActivity = Date.now();
  }

  removeDisconnectedPlayer(id) {
    const p = this.players.get(id);
    if (p && !p.connected) {
      this.players.delete(id);
    }
  }

  getConnectedPlayerIds() {
    return [...this.players.values()]
      .filter(p => p.connected)
      .map(p => p.id);
  }

  isEmpty() {
    // Vide = aucun joueur connecté depuis un moment
    return [...this.players.values()].every(p => !p.connected);
  }

  /* ---------- Cycle de jeu ---------- */

  start() {
    if (this.state !== 'LOBBY') return false;
    if (this.players.size < 2) return false;
    this.state = 'PLAYING';
    this.currentRoomIndex = 0;
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + TIMER_DURATION_MS;
    this._loadCurrentPuzzle();
    return true;
  }

  _loadCurrentPuzzle() {
    const room = ROOMS_SEQUENCE[this.currentRoomIndex];
    // L'observateur est le premier joueur connecté (alterne d'une énigme à l'autre)
    const connectedIds = this.getConnectedPlayerIds();
    const observerId = connectedIds[this.currentRoomIndex % connectedIds.length] || connectedIds[0];
    this.puzzle = Puzzles.createPuzzle(room.puzzleType, observerId);
  }

  advanceRoom() {
    if (this.currentRoomIndex >= ROOMS_SEQUENCE.length - 1) {
      this.state = 'WON';
      return 'WON';
    }
    this.currentRoomIndex += 1;
    this._loadCurrentPuzzle();
    return 'NEXT';
  }

  /**
   * Vérifie le timer. Doit être appelé périodiquement.
   * Retourne true si l'état a changé (défaite).
   */
  checkTimer(now) {
    if (this.state !== 'PLAYING') return false;
    if (now >= this.endsAt) {
      this.state = 'LOST';
      return true;
    }
    return false;
  }

  /* ---------- Actions joueur ---------- */

  handleAction(playerId, action) {
    if (this.state !== 'PLAYING') return { changed: false };
    if (!this.players.has(playerId)) return { changed: false };
    if (!this.puzzle) return { changed: false };

    const changed = Puzzles.applyAction(this.puzzle, action, playerId);
    let advanced = null;
    if (this.puzzle.solved) {
      advanced = this.advanceRoom();
    }
    return { changed, advanced };
  }

  tickPuzzle(now) {
    if (this.state !== 'PLAYING' || !this.puzzle) return false;
    if (this.puzzle.type !== 'LAUNCH_SEQUENCE') return false;
    const ids = this.getConnectedPlayerIds();
    const changed = Puzzles.tickLaunchPuzzle(this.puzzle, ids, now);
    if (this.puzzle.solved) {
      this.advanceRoom(); // déclenche WON
      return true;
    }
    return changed;
  }

  /* ---------- Chat ---------- */

  addChatMessage(playerId, text) {
    const p = this.players.get(playerId);
    if (!p) return null;
    text = String(text || '').trim().slice(0, 200);
    if (!text) return null;
    const msg = { author: p.name, text, ts: Date.now() };
    this.chatLog.push(msg);
    // Limite à 50 messages mémorisés
    if (this.chatLog.length > 50) this.chatLog.shift();
    return msg;
  }

  /* ---------- Snapshots ---------- */

  /**
   * Renvoie une vue de l'état pour un joueur donné (filtrée).
   */
  snapshotFor(playerId) {
    const room = ROOMS_SEQUENCE[this.currentRoomIndex] || null;
    return {
      code: this.code,
      state: this.state,
      hostId: this.hostId,
      youAre: playerId,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, connected: p.connected, isHost: p.isHost,
      })),
      currentRoom: room ? {
        index: this.currentRoomIndex,
        total: ROOMS_SEQUENCE.length,
        id: room.id,
        name: room.name,
        intro: room.intro,
      } : null,
      puzzle: this.puzzle
        ? Puzzles.viewPuzzle(this.puzzle, playerId, this.getConnectedPlayerIds())
        : null,
      timeLeftMs: this.state === 'PLAYING'
        ? Math.max(0, this.endsAt - Date.now())
        : null,
      totalDurationMs: TIMER_DURATION_MS,
    };
  }
}

module.exports = { GameRoom, ROOMS_SEQUENCE, TIMER_DURATION_MS };
