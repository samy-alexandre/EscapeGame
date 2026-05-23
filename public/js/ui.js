/**
 * UI — gestion des écrans (menu / lobby / jeu / fin), chat et notifications.
 * Tout ce qui n'est pas la mécanique des énigmes vit ici.
 */
(function (global) {

  const screens = {
    menu: document.getElementById('screen-menu'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
    end: document.getElementById('screen-end'),
  };

  let currentScreen = 'menu';
  let myId = null;
  let chatUnread = 0;
  let chatOpen = false;

  function showScreen(name) {
    if (!screens[name]) return;
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    currentScreen = name;
  }

  function setConnectionStatus(connected) {
    const dot = document.getElementById('conn-dot');
    const txt = document.getElementById('conn-text');
    if (!dot || !txt) return;
    dot.classList.toggle('connected', connected);
    dot.classList.toggle('disconnected', !connected);
    txt.textContent = connected ? 'Liaison active' : 'Reconnexion…';
  }

  function showError(message, target = 'menu') {
    if (target === 'menu') {
      const el = document.getElementById('menu-error');
      el.textContent = message;
      // Efface après quelques secondes
      clearTimeout(showError._t);
      showError._t = setTimeout(() => { el.textContent = ''; }, 4000);
    } else {
      toast(message, 'error');
    }
  }

  function toast(message, kind = '') {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'toast visible' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.classList.remove('visible');
    }, 2500);
  }

  /* ---------- LOBBY rendering ---------- */

  function renderLobby(state) {
    myId = state.youAre;
    document.getElementById('room-code').textContent = state.code;

    const list = document.getElementById('player-list');
    list.innerHTML = '';
    for (const p of state.players) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'player-dot' + (p.connected ? '' : ' offline');
      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = p.name + (p.connected ? '' : ' (déconnecté)');
      li.appendChild(dot);
      li.appendChild(name);
      if (p.id === state.youAre) {
        const tag = document.createElement('span');
        tag.className = 'player-tag you';
        tag.textContent = 'Vous';
        li.appendChild(tag);
      }
      if (p.isHost) {
        const tag = document.createElement('span');
        tag.className = 'player-tag';
        tag.textContent = 'Hôte';
        li.appendChild(tag);
      }
      list.appendChild(li);
    }

    const startBtn = document.getElementById('btn-start');
    const startHint = document.getElementById('start-hint');
    const isHost = state.hostId === state.youAre;
    const enough = state.players.filter(p => p.connected).length >= 2;
    startBtn.disabled = !(isHost && enough);
    if (!isHost) {
      startHint.textContent = "L'hôte va lancer la partie.";
    } else if (!enough) {
      startHint.textContent = 'Attendez au moins un second joueur.';
    } else {
      startHint.textContent = 'Tout est prêt — lancez quand vous voulez.';
    }
  }

  /* ---------- HUD ---------- */

  function renderHud(state) {
    if (!state.currentRoom) return;
    document.getElementById('room-progress-text').textContent =
      `Salle ${state.currentRoom.index + 1} / ${state.currentRoom.total}`;

    const dotsEl = document.getElementById('progress-dots');
    dotsEl.innerHTML = '';
    for (let i = 0; i < state.currentRoom.total; i++) {
      const d = document.createElement('span');
      d.className = 'progress-dot';
      if (i < state.currentRoom.index) d.classList.add('done');
      else if (i === state.currentRoom.index) d.classList.add('current');
      dotsEl.appendChild(d);
    }

    // Timer
    const t = document.getElementById('timer');
    if (state.timeLeftMs != null) {
      const total = Math.max(0, state.timeLeftMs);
      const m = Math.floor(total / 60000);
      const s = Math.floor((total % 60000) / 1000);
      t.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      t.classList.remove('warning', 'danger');
      if (total < 60000) t.classList.add('danger');
      else if (total < 5 * 60000) t.classList.add('warning');
    }
  }

  function renderRoomIntro(state) {
    const el = document.getElementById('room-intro');
    if (!state.currentRoom) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <h2>${escapeHtml(state.currentRoom.name)}</h2>
      <p>${escapeHtml(state.currentRoom.intro)}</p>
    `;
  }

  /* ---------- Fin de partie ---------- */

  function renderEnd(state) {
    const card = document.getElementById('end-card');
    const title = document.getElementById('end-title');
    const text = document.getElementById('end-text');
    const eyebrow = document.getElementById('end-eyebrow');
    const replayBtn = document.getElementById('btn-replay');

    card.classList.remove('win', 'lose');
    if (state.state === 'WON') {
      card.classList.add('win');
      eyebrow.textContent = 'TRANSMISSION FINALE';
      title.textContent = 'ÉCHAPPÉS';
      text.textContent = "La capsule s'éjecte dans le vide. La station Aurora-7 disparaît dans votre dos. Vous l'avez fait — ensemble.";
      Audio7.SFX.win();
    } else if (state.state === 'LOST') {
      card.classList.add('lose');
      eyebrow.textContent = 'SIGNAL PERDU';
      title.textContent = 'OXYGÈNE ÉPUISÉ';
      text.textContent = "Les lumières s'éteignent une à une. Aurora-7 garde ses secrets — et son équipage.";
      Audio7.SFX.lose();
    }
    replayBtn.hidden = state.hostId !== state.youAre;
  }

  /* ---------- Chat ---------- */

  function appendChat(msg) {
    const log = document.getElementById('chat-log');
    const div = document.createElement('div');
    div.className = 'chat-msg' + (msg.system ? ' system' : '');
    if (msg.system) {
      div.textContent = msg.text;
    } else {
      const author = document.createElement('span');
      author.className = 'chat-author';
      author.textContent = msg.author + ' ›';
      const text = document.createElement('span');
      text.className = 'chat-text';
      text.textContent = ' ' + msg.text;
      div.appendChild(author);
      div.appendChild(text);
    }
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    if (!chatOpen && currentScreen === 'game' && !msg.system) {
      chatUnread++;
      updateChatBadge();
      Audio7.SFX.notify();
    }
  }

  function clearChat() {
    document.getElementById('chat-log').innerHTML = '';
  }

  function updateChatBadge() {
    const b = document.getElementById('chat-badge');
    if (chatUnread > 0) {
      b.hidden = false;
      b.textContent = chatUnread > 9 ? '9+' : String(chatUnread);
    } else {
      b.hidden = true;
    }
  }

  function openChat() {
    document.getElementById('chat-panel').classList.add('open');
    document.getElementById('chat-panel').setAttribute('aria-hidden', 'false');
    chatOpen = true;
    chatUnread = 0;
    updateChatBadge();
    setTimeout(() => document.getElementById('chat-input').focus(), 200);
  }

  function closeChat() {
    document.getElementById('chat-panel').classList.remove('open');
    document.getElementById('chat-panel').setAttribute('aria-hidden', 'true');
    chatOpen = false;
  }

  /* ---------- Utils ---------- */

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  global.UI = {
    showScreen, setConnectionStatus, showError, toast,
    renderLobby, renderHud, renderRoomIntro, renderEnd,
    appendChat, clearChat, openChat, closeChat,
    copyToClipboard, escapeHtml,
    getMyId: () => myId,
    setMyId: (id) => { myId = id; },
    getCurrentScreen: () => currentScreen,
  };
})(window);
