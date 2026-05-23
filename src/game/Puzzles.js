/**
 * Définition des énigmes et de leur logique côté serveur.
 *
 * Principe : le serveur est autoritaire. Les clients envoient des actions,
 * le serveur valide et diffuse l'état mis à jour à tout le monde.
 *
 * 3 énigmes coopératives :
 *  1) SYMBOL_SEQUENCE : un joueur voit une séquence de symboles, l'autre a le clavier.
 *  2) WIRE_ROUTING    : un joueur voit la cible, l'autre actionne des interrupteurs.
 *  3) LAUNCH_SEQUENCE : tous les joueurs doivent maintenir leur bouton en même temps.
 */

const SYMBOLS = ['◆', '▲', '●', '■', '★', '✦', '♦', '⬢'];

/* -------------------------------------------------------------------------- */
/* Énigme 1 — SYMBOL_SEQUENCE                                                 */
/* -------------------------------------------------------------------------- */
/**
 * Une séquence de 4 symboles est générée. Elle n'est révélée qu'au joueur
 * désigné "observateur" (le premier connecté). L'autre joueur voit un pad
 * de 8 symboles et doit saisir la séquence dans l'ordre.
 *
 * État :
 *  {
 *    type: 'SYMBOL_SEQUENCE',
 *    sequence: ['◆','▲','●','■'],      // visible serveur uniquement (filtré à l'envoi)
 *    pad: ['◆','▲','●','■','★','✦','♦','⬢'],
 *    progress: 0,                       // nombre de symboles correctement entrés
 *    attempts: 0,                       // erreurs accumulées
 *    maxAttempts: 3,
 *    solved: false,
 *    observerId: 'socketId',            // qui voit la séquence
 *  }
 */
function createSymbolPuzzle(observerId) {
  // Tire 4 symboles uniques aléatoires parmi 8
  const shuffled = [...SYMBOLS].sort(() => Math.random() - 0.5);
  const sequence = shuffled.slice(0, 4);
  // Le pad mélange aussi les positions pour pimenter la communication
  const pad = [...SYMBOLS].sort(() => Math.random() - 0.5);

  return {
    type: 'SYMBOL_SEQUENCE',
    sequence,
    pad,
    progress: 0,
    attempts: 0,
    maxAttempts: 3,
    solved: false,
    failed: false,
    observerId,
  };
}

/**
 * Vue filtrée par joueur : on cache la solution à ceux qui ne sont pas observateurs.
 */
function viewSymbolPuzzle(puzzle, viewerId) {
  return {
    type: puzzle.type,
    pad: puzzle.pad,
    progress: puzzle.progress,
    attempts: puzzle.attempts,
    maxAttempts: puzzle.maxAttempts,
    solved: puzzle.solved,
    failed: puzzle.failed,
    observerId: puzzle.observerId,
    isObserver: viewerId === puzzle.observerId,
    // Seul l'observateur voit la séquence à reproduire
    sequence: viewerId === puzzle.observerId ? puzzle.sequence : null,
  };
}

/**
 * Applique une action « presser un symbole ». Retourne true si l'état a changé.
 */
function applySymbolAction(puzzle, action, playerId) {
  if (puzzle.solved || puzzle.failed) return false;
  if (action.type !== 'PRESS_SYMBOL') return false;
  // Seul un non-observateur peut presser (l'observateur dicte, l'autre exécute)
  if (playerId === puzzle.observerId) return false;
  if (!SYMBOLS.includes(action.symbol)) return false;

  const expected = puzzle.sequence[puzzle.progress];
  if (action.symbol === expected) {
    puzzle.progress += 1;
    if (puzzle.progress >= puzzle.sequence.length) {
      puzzle.solved = true;
    }
  } else {
    puzzle.attempts += 1;
    puzzle.progress = 0;
    if (puzzle.attempts >= puzzle.maxAttempts) {
      // On régénère une nouvelle séquence au lieu de bloquer la partie
      const fresh = createSymbolPuzzle(puzzle.observerId);
      puzzle.sequence = fresh.sequence;
      puzzle.pad = fresh.pad;
      puzzle.attempts = 0;
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Énigme 2 — WIRE_ROUTING                                                    */
/* -------------------------------------------------------------------------- */
/**
 * Une grille 4x4 de cellules colorées. Une CIBLE est : « toutes les cellules
 * doivent être de la couleur X ». La cible est connue d'un joueur (l'observateur),
 * les interrupteurs sont chez l'autre.
 *
 * Chaque interrupteur (8 au total, A..H) bascule la couleur de plusieurs cellules
 * selon un schéma fixe non révélé. Les joueurs doivent expérimenter et communiquer.
 *
 * Pour rester soluble en coop sans frustration : on s'assure que la cible est
 * atteignable, et on affiche un compteur "cellules conformes / 16".
 */
const TARGET_COLORS = ['cyan', 'magenta', 'amber'];

// Chaque interrupteur bascule entre les 3 couleurs sur un sous-ensemble de cellules.
// Schémas fixes — pensés pour qu'avec 8 interrupteurs, toute config soit atteignable.
const SWITCH_PATTERNS = {
  A: [0, 1, 2, 3],         // ligne 1
  B: [4, 5, 6, 7],         // ligne 2
  C: [8, 9, 10, 11],       // ligne 3
  D: [12, 13, 14, 15],     // ligne 4
  E: [0, 4, 8, 12],        // colonne 1
  F: [1, 5, 9, 13],        // colonne 2
  G: [2, 6, 10, 14],       // colonne 3
  H: [3, 7, 11, 15],       // colonne 4
};

function createWirePuzzle(observerId) {
  // Choix de la couleur cible
  const target = TARGET_COLORS[Math.floor(Math.random() * TARGET_COLORS.length)];
  // On part d'une grille uniformément à la cible (donc résolue),
  // puis on la "mélange" en appliquant des toggles aléatoires.
  // Cela garantit qu'il existe au moins une solution (la séquence inverse).
  const grid = Array.from({ length: 16 }, () => target);
  const switches = Object.keys(SWITCH_PATTERNS);

  // 5 à 10 mélanges pour garder le puzzle stimulant mais soluble
  const scrambleCount = 5 + Math.floor(Math.random() * 6);
  for (let i = 0; i < scrambleCount; i++) {
    const s = switches[Math.floor(Math.random() * switches.length)];
    for (const idx of SWITCH_PATTERNS[s]) {
      const cur = TARGET_COLORS.indexOf(grid[idx]);
      grid[idx] = TARGET_COLORS[(cur + 1) % TARGET_COLORS.length];
    }
  }

  // Si par chance on est retombé sur la cible, on force un mélange minimum
  if (grid.every(c => c === target)) {
    const s = switches[Math.floor(Math.random() * switches.length)];
    for (const idx of SWITCH_PATTERNS[s]) {
      const cur = TARGET_COLORS.indexOf(grid[idx]);
      grid[idx] = TARGET_COLORS[(cur + 1) % TARGET_COLORS.length];
    }
  }

  return {
    type: 'WIRE_ROUTING',
    grid,
    target,
    solved: false,
    observerId,
  };
}

function viewWirePuzzle(puzzle, viewerId) {
  const matches = puzzle.grid.filter(c => c === puzzle.target).length;
  return {
    type: puzzle.type,
    grid: puzzle.grid,
    matches,
    total: puzzle.grid.length,
    solved: puzzle.solved,
    observerId: puzzle.observerId,
    isObserver: viewerId === puzzle.observerId,
    // Seul l'observateur voit la cible
    target: viewerId === puzzle.observerId ? puzzle.target : null,
    switches: Object.keys(SWITCH_PATTERNS),
  };
}

function applyWireAction(puzzle, action, playerId) {
  if (puzzle.solved) return false;
  if (action.type !== 'TOGGLE_SWITCH') return false;
  if (playerId === puzzle.observerId) return false;
  const pattern = SWITCH_PATTERNS[action.switchId];
  if (!pattern) return false;

  // Avance d'un cran dans le cycle des couleurs pour chaque cellule touchée
  for (const idx of pattern) {
    const current = TARGET_COLORS.indexOf(puzzle.grid[idx]);
    puzzle.grid[idx] = TARGET_COLORS[(current + 1) % TARGET_COLORS.length];
  }

  // Test de complétion
  if (puzzle.grid.every(c => c === puzzle.target)) {
    puzzle.solved = true;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Énigme 3 — LAUNCH_SEQUENCE                                                 */
/* -------------------------------------------------------------------------- */
/**
 * Chaque joueur doit maintenir son bouton « ARM » enfoncé. Quand tous les
 * joueurs maintiennent simultanément pendant LAUNCH_DURATION ms, on s'échappe.
 *
 * État :
 *  {
 *    type: 'LAUNCH_SEQUENCE',
 *    holding: { [playerId]: true|false },
 *    progress: 0..1,           // mis à jour par la boucle de jeu (server tick)
 *    solved: false,
 *  }
 */
const LAUNCH_DURATION_MS = 5000;

function createLaunchPuzzle() {
  return {
    type: 'LAUNCH_SEQUENCE',
    holding: {},
    progress: 0,
    solved: false,
    _accumulated: 0, // ms accumulés quand tout le monde tient
    _lastTick: null,
  };
}

function viewLaunchPuzzle(puzzle, viewerId, playerIds) {
  // On envoie à chacun s'il tient + combien de joueurs tiennent
  const holders = playerIds.filter(id => puzzle.holding[id]).length;
  return {
    type: puzzle.type,
    iAmHolding: !!puzzle.holding[viewerId],
    holders,
    totalPlayers: playerIds.length,
    progress: puzzle.progress,
    solved: puzzle.solved,
  };
}

function applyLaunchAction(puzzle, action, playerId) {
  if (puzzle.solved) return false;
  if (action.type === 'HOLD_START') {
    puzzle.holding[playerId] = true;
    return true;
  }
  if (action.type === 'HOLD_STOP') {
    puzzle.holding[playerId] = false;
    return true;
  }
  return false;
}

/**
 * Tick de la séquence de lancement : à appeler ~5x/sec.
 * Avance la progression si TOUS les joueurs (connectés) maintiennent.
 */
function tickLaunchPuzzle(puzzle, playerIds, now) {
  if (puzzle.solved) return false;
  if (playerIds.length === 0) {
    puzzle._lastTick = now;
    return false;
  }

  const allHolding = playerIds.every(id => puzzle.holding[id]);
  const last = puzzle._lastTick || now;
  const dt = now - last;
  puzzle._lastTick = now;

  if (allHolding) {
    puzzle._accumulated = Math.min(LAUNCH_DURATION_MS, puzzle._accumulated + dt);
  } else {
    // Décroît plus lentement pour ne pas être trop punitif
    puzzle._accumulated = Math.max(0, puzzle._accumulated - dt * 0.5);
  }
  const newProgress = puzzle._accumulated / LAUNCH_DURATION_MS;
  const changed = Math.abs(newProgress - puzzle.progress) > 0.01;
  puzzle.progress = newProgress;
  if (puzzle._accumulated >= LAUNCH_DURATION_MS) {
    puzzle.solved = true;
    return true;
  }
  return changed;
}

/* -------------------------------------------------------------------------- */
/* Façade unifiée                                                             */
/* -------------------------------------------------------------------------- */

function createPuzzle(type, observerId) {
  switch (type) {
    case 'SYMBOL_SEQUENCE': return createSymbolPuzzle(observerId);
    case 'WIRE_ROUTING':    return createWirePuzzle(observerId);
    case 'LAUNCH_SEQUENCE': return createLaunchPuzzle();
    default: throw new Error('Énigme inconnue : ' + type);
  }
}

function viewPuzzle(puzzle, viewerId, playerIds) {
  switch (puzzle.type) {
    case 'SYMBOL_SEQUENCE': return viewSymbolPuzzle(puzzle, viewerId);
    case 'WIRE_ROUTING':    return viewWirePuzzle(puzzle, viewerId);
    case 'LAUNCH_SEQUENCE': return viewLaunchPuzzle(puzzle, viewerId, playerIds);
    default: return null;
  }
}

function applyAction(puzzle, action, playerId) {
  switch (puzzle.type) {
    case 'SYMBOL_SEQUENCE': return applySymbolAction(puzzle, action, playerId);
    case 'WIRE_ROUTING':    return applyWireAction(puzzle, action, playerId);
    case 'LAUNCH_SEQUENCE': return applyLaunchAction(puzzle, action, playerId);
    default: return false;
  }
}

module.exports = {
  createPuzzle,
  viewPuzzle,
  applyAction,
  tickLaunchPuzzle,
};
