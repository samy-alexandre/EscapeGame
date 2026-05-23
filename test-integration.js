/**
 * Test d'intégration de bout en bout.
 * - Démarre le serveur sur un port libre
 * - Connecte 2 clients Socket.IO
 * - Crée une salle, rejoint, lance, résout les 3 énigmes, vérifie la victoire
 * - Teste aussi : chat, déconnexion/reconnexion, état serveur cohérent
 */
const { spawn } = require('child_process');
const http = require('http');
const { io: ioClient } = require('socket.io-client');

const PORT = 3456;
const HOST = `http://localhost:${PORT}`;
let serverProcess = null;
let testsPassed = 0;
let testsFailed = 0;
const errors = [];

function log(msg, ok = true) {
  const symbol = ok ? '✓' : '✗';
  const color = ok ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${symbol}\x1b[0m ${msg}`);
  if (ok) testsPassed++;
  else { testsFailed++; errors.push(msg); }
}

function logInfo(msg) { console.log(`  \x1b[90m${msg}\x1b[0m`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitFor(predicate, timeoutMs = 5000, label = 'condition') {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout : ${label}`));
      setTimeout(check, 50);
    };
    check();
  });
}

// Démarre le serveur en sous-processus pour qu'il ne meure pas
async function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['server.js'], {
      env: { ...process.env, PORT },
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    serverProcess.stdout.on('data', d => {
      const txt = d.toString();
      if (!ready && txt.includes('en orbite')) {
        ready = true;
        resolve();
      }
    });
    serverProcess.stderr.on('data', d => console.error('[server stderr]', d.toString()));
    serverProcess.on('error', reject);
    serverProcess.on('exit', code => {
      if (!ready) reject(new Error('Serveur arrêté avant d\'être prêt, code=' + code));
    });
    setTimeout(() => { if (!ready) reject(new Error('Démarrage serveur trop lent')); }, 10000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function makeClient() {
  const client = ioClient(HOST, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
  });
  client.states = [];  // historique des snapshots reçus
  client.errors = [];
  client.chatMsgs = [];
  client.on('state', s => client.states.push(s));
  client.on('lobby:error', e => client.errors.push(e));
  client.on('chat:msg', m => client.chatMsgs.push(m));
  client.last = () => client.states[client.states.length - 1];
  return client;
}

function waitState(client, pred, timeout = 3000, label = '') {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const s = client.last();
      if (s && pred(s)) return resolve(s);
      if (Date.now() - start > timeout) return reject(new Error('Timeout state : ' + label));
      setTimeout(check, 20);
    };
    check();
  });
}

function healthCheck() {
  return new Promise((resolve, reject) => {
    http.get(`${HOST}/health`, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchStatic(path) {
  return new Promise((resolve, reject) => {
    http.get(`${HOST}${path}`, res => {
      let len = 0;
      res.on('data', c => len += c.length);
      res.on('end', () => resolve({ status: res.statusCode, length: len }));
    }).on('error', reject);
  });
}

/* -------------------------------------------------------------------------- */
/* TESTS                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  AURORA-7 — Tests d\'intégration');
  console.log('═══════════════════════════════════════════\n');

  // ----- Démarrage serveur -----
  await startServer();
  log('Serveur démarré');

  // ----- Health -----
  const h = await healthCheck();
  log(`Health check : ${JSON.stringify(h)}`, h.ok === true);

  // ----- Statiques -----
  for (const p of ['/', '/css/style.css', '/js/main.js', '/js/audio.js',
                   '/js/network.js', '/js/ui.js', '/js/puzzles.js',
                   '/socket.io/socket.io.js']) {
    const r = await fetchStatic(p);
    log(`GET ${p} → ${r.status} (${r.length} B)`, r.status === 200 && r.length > 0);
  }

  // ----- Deux clients Socket.IO -----
  const alice = makeClient();
  const bob = makeClient();
  await waitFor(() => alice.connected && bob.connected, 3000, 'connexion clients');
  log('2 clients connectés en WebSocket');

  // ----- Création de salle -----
  alice.emit('lobby:create', { name: 'Alice' });
  let roomCode = null;
  await new Promise((resolve, reject) => {
    alice.once('lobby:joined', d => { roomCode = d.code; resolve(); });
    setTimeout(() => reject(new Error('Timeout création salle')), 3000);
  });
  log(`Salle créée, code=${roomCode}`, /^[A-Z2-9]{4}$/.test(roomCode));

  await waitState(alice, s => s.state === 'LOBBY' && s.players.length === 1, 2000, 'lobby créé');
  const aState1 = alice.last();
  log('Alice voit le lobby (1 joueur, hôte)',
      aState1.players[0].name === 'Alice' && aState1.players[0].isHost);

  // ----- Rejoindre la salle -----
  bob.emit('lobby:join', { code: roomCode, name: 'Bob' });
  await waitState(bob, s => s.state === 'LOBBY' && s.players.length === 2, 2000, 'bob rejoint');
  log('Bob a rejoint, lobby à 2 joueurs');

  // Vérifie qu'Alice voit Bob aussi
  await waitState(alice, s => s.players.length === 2, 1000, 'alice voit bob');
  log('Alice voit Bob dans le lobby');

  // ----- Erreur : pseudo en double -----
  const carol = makeClient();
  await waitFor(() => carol.connected, 2000);
  carol.emit('lobby:join', { code: roomCode, name: 'Alice' });
  await waitFor(() => carol.errors.length > 0, 2000, 'erreur pseudo dupliqué');
  log('Refus pseudo dupliqué : ' + carol.errors[0].message);
  carol.disconnect();

  // ----- Erreur : code inexistant -----
  const dave = makeClient();
  await waitFor(() => dave.connected, 2000);
  dave.emit('lobby:join', { code: 'XXXX', name: 'Dave' });
  await waitFor(() => dave.errors.length > 0, 2000, 'erreur code inexistant');
  log('Refus code de salle inexistant : ' + dave.errors[0].message);
  dave.disconnect();

  // ----- Démarrage par non-hôte refusé -----
  bob.errors.length = 0;
  bob.emit('lobby:start');
  await sleep(300);
  log('Démarrage refusé pour non-hôte', bob.errors.length > 0);

  // ----- Démarrage par l'hôte -----
  alice.emit('lobby:start');
  await waitState(alice, s => s.state === 'PLAYING', 2000, 'partie lancée');
  log('Partie lancée par l\'hôte');

  await waitState(bob, s => s.state === 'PLAYING', 1000, 'bob en jeu');
  log('Bob aussi en état PLAYING');

  // ----- Énigme 1 : SYMBOL_SEQUENCE -----
  const initialState = alice.last();
  log(`Salle 1 chargée : ${initialState.currentRoom.name}`,
      initialState.currentRoom.index === 0 && initialState.puzzle.type === 'SYMBOL_SEQUENCE');

  // L'un des deux est l'observateur
  const aPuzz = alice.last().puzzle;
  const bPuzz = bob.last().puzzle;
  log('Visibilité : un seul joueur voit la séquence',
      (aPuzz.sequence && !bPuzz.sequence) || (bPuzz.sequence && !aPuzz.sequence));

  const observer = aPuzz.isObserver ? alice : bob;
  const operator = aPuzz.isObserver ? bob : alice;
  const sequence = observer.last().puzzle.sequence;
  logInfo(`Séquence : ${sequence.join(' ')}`);

  // L'opérateur saisit la séquence
  for (const sym of sequence) {
    operator.emit('game:action', { action: { type: 'PRESS_SYMBOL', symbol: sym } });
    await sleep(80);
  }

  // Le serveur doit avoir avancé à la salle 2
  await waitState(alice, s => s.currentRoom && s.currentRoom.index === 1, 3000, 'salle 2');
  log('Énigme 1 résolue, passage à la salle 2');

  // ----- Énigme 2 : WIRE_ROUTING -----
  const wireState = alice.last();
  log(`Salle 2 chargée : ${wireState.currentRoom.name}`,
      wireState.puzzle.type === 'WIRE_ROUTING');

  // Trouve l'observateur (qui voit la cible)
  const wireObs = alice.last().puzzle.isObserver ? alice : bob;
  const wireOp = alice.last().puzzle.isObserver ? bob : alice;
  const target = wireObs.last().puzzle.target;
  logInfo(`Cible : ${target}`);
  log('Visibilité cible WIRE : seul l\'observateur voit',
      wireObs.last().puzzle.target && !wireOp.last().puzzle.target);

  // Brute-force : on essaie les 256 combinaisons d'interrupteurs (8 binaires)
  // En réalité, la logique des patterns garantit qu'il existe une solution.
  // Plus simple : on actionne aléatoirement jusqu'à résolution (avec un max d'essais).
  const switches = ['A','B','C','D','E','F','G','H'];
  let attempts = 0;
  const maxAttempts = 200;
  while (alice.last().currentRoom.index === 1 && attempts < maxAttempts) {
    const cur = alice.last().puzzle;
    if (cur.matches === cur.total) break;
    // Stratégie simple : actionner un interrupteur au hasard
    const s = switches[Math.floor(Math.random() * switches.length)];
    wireOp.emit('game:action', { action: { type: 'TOGGLE_SWITCH', switchId: s } });
    await sleep(30);
    attempts++;
  }

  // Note : avec le mélange depuis la cible, la grille est désormais soluble.
  // Le random peut soit la résoudre directement, soit pas — on gère les deux cas.
  const wireStateNow = alice.last().puzzle;
  if (alice.last().currentRoom.index >= 2) {
    log(`Wire puzzle résolu en ~${attempts} actions aléatoires`, true);
  } else {
    log(`Wire puzzle : ${wireStateNow.matches}/${wireStateNow.total} cellules conformes après ${attempts} actions`,
        wireStateNow.matches !== undefined);

    // Test ciblé : l'opérateur peut modifier
    const before = alice.last().puzzle.grid.slice();
    wireOp.emit('game:action', { action: { type: 'TOGGLE_SWITCH', switchId: 'A' } });
    await sleep(150);
    const after = alice.last().puzzle.grid ? alice.last().puzzle.grid.slice() : null;
    let changed = false;
    if (after) for (let i = 0; i < 16; i++) if (before[i] !== after[i]) { changed = true; break; }
    log('TOGGLE_SWITCH modifie effectivement la grille côté serveur', changed || alice.last().currentRoom.index >= 2);

    // Vérifie que l'opérateur ne peut PAS toggle l'observateur (validation autorité)
    if (alice.last().currentRoom.index < 2) {
      const beforeObs = alice.last().puzzle.grid.slice();
      wireObs.emit('game:action', { action: { type: 'TOGGLE_SWITCH', switchId: 'B' } });
      await sleep(200);
      const afterObs = alice.last().puzzle.grid.slice();
      let obsChanged = false;
      for (let i = 0; i < 16; i++) if (beforeObs[i] !== afterObs[i]) { obsChanged = true; break; }
      log('Action de l\'observateur sur WIRE rejetée par le serveur', !obsChanged);
    }

    // Brute-force déterministe pour atteindre la salle 3
    logInfo('Brute-force du wire puzzle pour atteindre la salle 3...');
    const startGrid = alice.last().puzzle.grid.slice();
    const targetColor = wireObs.last().puzzle.target;
    const SWITCH_PATTERNS = {
      A: [0, 1, 2, 3], B: [4, 5, 6, 7], C: [8, 9, 10, 11], D: [12, 13, 14, 15],
      E: [0, 4, 8, 12], F: [1, 5, 9, 13], G: [2, 6, 10, 14], H: [3, 7, 11, 15],
    };
    const COLORS = ['cyan', 'magenta', 'amber'];
    function simulateToggles(grid, sequence) {
      const g = grid.slice();
      for (const s of sequence) {
        for (const idx of SWITCH_PATTERNS[s]) {
          const cur = COLORS.indexOf(g[idx]);
          g[idx] = COLORS[(cur + 1) % 3];
        }
      }
      return g;
    }
    let solution = null;
    for (let mask = 0; mask < 6561 && !solution; mask++) {
      const counts = [];
      let m = mask;
      for (let i = 0; i < 8; i++) { counts.push(m % 3); m = Math.floor(m / 3); }
      const seq = [];
      for (let i = 0; i < 8; i++) for (let k = 0; k < counts[i]; k++) seq.push(switches[i]);
      const g = simulateToggles(startGrid, seq);
      if (g.every(c => c === targetColor)) solution = seq;
    }

    if (solution) {
      logInfo(`Solution trouvée : ${solution.join(' ')} (${solution.length} pressions)`);
      for (const s of solution) {
        wireOp.emit('game:action', { action: { type: 'TOGGLE_SWITCH', switchId: s } });
        await sleep(20);
      }
      await waitState(alice, s => s.currentRoom && s.currentRoom.index === 2, 3000, 'salle 3');
      log('Énigme 2 résolue, passage à la salle 3');
    } else {
      log('Aucune solution wire trouvée (BUG : puzzle non soluble)', false);
    }
  }

  // ----- Énigme 3 : LAUNCH_SEQUENCE -----
  const launchState = alice.last();
  log(`Salle 3 chargée : ${launchState.currentRoom.name}`,
      launchState.puzzle.type === 'LAUNCH_SEQUENCE');

  // Test : un seul joueur qui tient → pas de progression
  alice.emit('game:action', { action: { type: 'HOLD_START' } });
  await sleep(2000);
  const partial = alice.last().puzzle;
  log(`Avec 1 seul joueur, progress reste bas (${(partial.progress * 100).toFixed(0)}%)`,
      partial.progress < 0.1);

  alice.emit('game:action', { action: { type: 'HOLD_STOP' } });
  await sleep(200);

  // Les DEUX joueurs maintiennent → victoire en ~5s
  alice.emit('game:action', { action: { type: 'HOLD_START' } });
  bob.emit('game:action', { action: { type: 'HOLD_START' } });
  logInfo('Les deux joueurs maintiennent...');
  await waitState(alice, s => s.state === 'WON', 7000, 'victoire');
  log('Énigme 3 résolue : VICTOIRE');

  // ----- Chat -----
  alice.emit('chat:send', { text: 'On se retrouve dans la capsule !' });
  await waitFor(() => bob.chatMsgs.length > 0, 1000, 'chat reçu');
  log('Chat fonctionne : Bob a reçu le message d\'Alice',
      bob.chatMsgs[0].text === 'On se retrouve dans la capsule !');

  // ----- Restart -----
  alice.emit('lobby:restart');
  await waitState(alice, s => s.state === 'LOBBY', 2000, 'retour lobby');
  log('Restart de partie : retour au lobby');

  // ----- Déconnexion / Reconnexion -----
  alice.emit('lobby:start');
  await waitState(alice, s => s.state === 'PLAYING', 2000, 'relance');
  log('2e partie lancée');

  // Bob se déconnecte
  bob.disconnect();
  await sleep(300);
  const stateAfterDisco = alice.last();
  log('Alice voit Bob comme déconnecté',
      stateAfterDisco.players.some(p => p.name === 'Bob' && !p.connected));

  // Bob revient avec le même pseudo
  const bobRetry = makeClient();
  await waitFor(() => bobRetry.connected, 2000);
  bobRetry.emit('lobby:join', { code: roomCode, name: 'Bob' });
  await waitState(bobRetry, s => s.state === 'PLAYING' && s.players.some(p => p.name === 'Bob' && p.connected), 2000, 'bob reco');
  log('Bob s\'est reconnecté avec le même pseudo, en pleine partie');

  await waitState(alice, s => s.players.find(p => p.name === 'Bob' && p.connected) !== undefined, 1000);
  log('Alice voit Bob revenu en ligne');

  // ----- Nettoyage -----
  alice.disconnect();
  bob.disconnect();
  bobRetry.disconnect();
  await sleep(300);

  // ----- Validation : actions invalides ne crashent pas -----
  const evil = makeClient();
  await waitFor(() => evil.connected, 2000);
  evil.emit('lobby:join', { code: 'NOPE', name: 'Evil' });
  evil.emit('game:action', { action: null });
  evil.emit('game:action', { action: { type: 'INVALID_TYPE' } });
  evil.emit('chat:send', { text: '' });
  evil.emit('chat:send', { text: 'x'.repeat(10000) });
  evil.emit('game:action');
  evil.emit('lobby:start');
  await sleep(300);
  log('Le serveur survit aux entrées invalides et malformées');
  evil.disconnect();

  // ----- Healthcheck final -----
  await sleep(500);
  const finalHealth = await healthCheck();
  log(`Health final : ${JSON.stringify(finalHealth)}`, finalHealth.ok === true);

  // ----- Rapport -----
  console.log('\n═══════════════════════════════════════════');
  console.log(`  Tests : ${testsPassed} réussis, ${testsFailed} échoués`);
  console.log('═══════════════════════════════════════════\n');
  if (testsFailed > 0) {
    console.log('Échecs :');
    for (const e of errors) console.log('  - ' + e);
  }

  stopServer();
  process.exit(testsFailed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('\n\x1b[31mErreur fatale :\x1b[0m', err);
  stopServer();
  process.exit(2);
});
