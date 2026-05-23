/**
 * Point d'entrée client. Connecte les modules UI / Net / Puzzles / Audio.
 */
(function () {

  // ---- Init réseau ----
  Net.connect();

  Net.on('connection:status', (s) => {
    UI.setConnectionStatus(s.connected);
    if (!s.connected && UI.getCurrentScreen() !== 'menu') {
      UI.toast('Reconnexion en cours…');
    }
  });

  Net.on('lobby:joined', (data) => {
    UI.showScreen('lobby');
    Audio7.unlock();
    Audio7.startAmbient();
  });

  Net.on('lobby:error', (data) => {
    UI.showError(data.message || 'Erreur', UI.getCurrentScreen() === 'menu' ? 'menu' : 'toast');
    Audio7.SFX.error();
  });

  let lastRoomIndex = -1;
  let lastState = null;

  Net.on('state', (state) => {
    UI.setMyId(state.youAre);

    // Transitions d'écrans
    if (state.state === 'LOBBY') {
      if (UI.getCurrentScreen() !== 'lobby') UI.showScreen('lobby');
      UI.renderLobby(state);
    } else if (state.state === 'PLAYING') {
      if (UI.getCurrentScreen() !== 'game') {
        UI.showScreen('game');
        UI.clearChat();
        Audio7.SFX.doorOpen();
        lastRoomIndex = -1;
      }
      // Détection de changement de salle pour un son spécifique
      if (state.currentRoom && state.currentRoom.index !== lastRoomIndex) {
        if (lastRoomIndex !== -1) Audio7.SFX.doorOpen();
        lastRoomIndex = state.currentRoom.index;
      }
      UI.renderHud(state);
      UI.renderRoomIntro(state);
      Puzzles.render(document.getElementById('puzzle-container'), state.puzzle);
    } else if (state.state === 'WON' || state.state === 'LOST') {
      // Joue la transition seulement une fois
      const wasOther = !lastState || (lastState.state !== state.state);
      if (UI.getCurrentScreen() !== 'end' || wasOther) {
        UI.showScreen('end');
        UI.renderEnd(state);
        Audio7.stopAmbient();
      }
    }

    lastState = state;
  });

  Net.on('chat:msg', (msg) => UI.appendChat(msg));
  Net.on('chat:history', (msgs) => {
    UI.clearChat();
    for (const m of msgs) UI.appendChat(m);
  });

  // ---- Bindings MENU ----
  const inputName = document.getElementById('input-name');
  const inputCode = document.getElementById('input-code');

  // Persiste le pseudo entre les sessions (pratique)
  try {
    const saved = localStorage.getItem('aurora7:name');
    if (saved) inputName.value = saved;
  } catch (e) {}

  function persistName() {
    try { localStorage.setItem('aurora7:name', inputName.value.trim()); } catch (e) {}
  }

  inputCode.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '');
  });

  function attemptCreate() {
    const name = inputName.value.trim();
    if (!name) { UI.showError('Choisissez un pseudo.'); inputName.focus(); return; }
    persistName();
    Audio7.unlock();
    Audio7.SFX.uiClick();
    Net.createRoom(name);
  }

  function attemptJoin() {
    const name = inputName.value.trim();
    const code = inputCode.value.trim().toUpperCase();
    if (!name) { UI.showError('Choisissez un pseudo.'); inputName.focus(); return; }
    if (code.length < 4) { UI.showError('Entrez un code de salle valide.'); inputCode.focus(); return; }
    persistName();
    Audio7.unlock();
    Audio7.SFX.uiClick();
    Net.joinRoom(code, name);
  }

  document.getElementById('btn-create').addEventListener('click', attemptCreate);
  document.getElementById('btn-join').addEventListener('click', attemptJoin);
  inputCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptJoin();
  });
  inputName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (inputCode.value.trim().length >= 4) attemptJoin();
      else attemptCreate();
    }
  });

  // ---- Bindings LOBBY ----
  document.getElementById('btn-start').addEventListener('click', () => {
    Audio7.SFX.uiClick();
    Net.startGame();
  });

  document.getElementById('btn-leave').addEventListener('click', () => {
    Audio7.SFX.uiClick();
    Audio7.stopAmbient();
    Net.leaveRoom();
    UI.showScreen('menu');
  });

  document.getElementById('room-code').addEventListener('click', (e) => {
    const code = e.target.textContent.trim();
    if (!code || code === '----') return;
    UI.copyToClipboard(code);
    const toast = document.getElementById('copied-toast');
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 1500);
    Audio7.SFX.uiClick();
  });

  // ---- Bindings JEU ----
  document.getElementById('btn-chat-toggle').addEventListener('click', () => {
    UI.openChat();
  });

  document.getElementById('chat-close').addEventListener('click', () => {
    UI.closeChat();
  });

  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    Net.sendChat(text);
    input.value = '';
  });

  // ---- Bindings FIN ----
  document.getElementById('btn-replay').addEventListener('click', () => {
    Audio7.SFX.uiClick();
    Net.restartGame();
  });

  document.getElementById('btn-end-leave').addEventListener('click', () => {
    Audio7.SFX.uiClick();
    Audio7.stopAmbient();
    Net.leaveRoom();
    UI.showScreen('menu');
  });

  // Première interaction : on déverrouille l'audio
  document.addEventListener('click', () => Audio7.unlock(), { once: true });
  document.addEventListener('touchstart', () => Audio7.unlock(), { once: true });

})();
