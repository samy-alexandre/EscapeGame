/**
 * Rendu et interactions des énigmes côté client.
 *
 * Chaque type d'énigme expose render(container, puzzleView).
 * Le serveur reste seul juge — le client n'envoie que des actions.
 *
 * On mémorise le rendu précédent pour faire des updates incrémentaux
 * lorsque possible (évite les flickers à chaque snapshot).
 */
(function (global) {

  let lastRenderedType = null;
  let lastPuzzle = null;
  let elements = {}; // cache d'éléments DOM par énigme

  /* -------------------------------------------------------------------------- */
  /* DISPATCHER                                                                 */
  /* -------------------------------------------------------------------------- */

  function render(container, puzzle) {
    if (!puzzle) {
      container.innerHTML = '';
      lastRenderedType = null;
      lastPuzzle = null;
      elements = {};
      return;
    }

    // Si le type a changé, on reconstruit tout
    if (puzzle.type !== lastRenderedType) {
      container.innerHTML = '';
      elements = {};
      lastRenderedType = puzzle.type;
      switch (puzzle.type) {
        case 'SYMBOL_SEQUENCE': mountSymbol(container, puzzle); break;
        case 'WIRE_ROUTING':    mountWire(container, puzzle); break;
        case 'LAUNCH_SEQUENCE': mountLaunch(container, puzzle); break;
      }
    }

    // Mise à jour
    switch (puzzle.type) {
      case 'SYMBOL_SEQUENCE': updateSymbol(puzzle); break;
      case 'WIRE_ROUTING':    updateWire(puzzle); break;
      case 'LAUNCH_SEQUENCE': updateLaunch(puzzle); break;
    }

    lastPuzzle = puzzle;
  }

  /* -------------------------------------------------------------------------- */
  /* SYMBOL_SEQUENCE                                                            */
  /* -------------------------------------------------------------------------- */

  function mountSymbol(container, p) {
    const wrap = document.createElement('div');
    wrap.className = 'puzzle';

    const role = document.createElement('div');
    role.className = 'puzzle-role';
    role.textContent = p.isObserver ? 'RÔLE : OBSERVATEUR' : 'RÔLE : OPÉRATEUR';

    const title = document.createElement('div');
    title.className = 'puzzle-title';
    title.textContent = 'Décodage des sigles';

    const instr = document.createElement('div');
    instr.className = 'puzzle-instruction';
    instr.textContent = p.isObserver
      ? "Mémorisez la séquence ci-dessous et dictez-la à votre coéquipier — dans l'ordre."
      : 'Votre coéquipier voit une séquence de symboles. Saisissez-la dans le bon ordre.';

    wrap.appendChild(role);
    wrap.appendChild(title);
    wrap.appendChild(instr);

    if (p.isObserver) {
      const seq = document.createElement('div');
      seq.className = 'sequence-display';
      wrap.appendChild(seq);
      elements.seq = seq;
    } else {
      const progress = document.createElement('div');
      progress.className = 'puzzle-progress';
      wrap.appendChild(progress);
      elements.progress = progress;

      const pad = document.createElement('div');
      pad.className = 'symbol-pad';
      for (const sym of p.pad) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pad-button';
        b.textContent = sym;
        b.dataset.symbol = sym;
        b.addEventListener('click', () => {
          Audio7.unlock();
          Audio7.SFX.uiClick();
          Net.sendAction({ type: 'PRESS_SYMBOL', symbol: sym });
          b.classList.add('pressed');
          setTimeout(() => b.classList.remove('pressed'), 300);
        });
        pad.appendChild(b);
      }
      wrap.appendChild(pad);
      elements.pad = pad;
    }

    const attempts = document.createElement('div');
    attempts.className = 'attempts-row';
    wrap.appendChild(attempts);
    elements.attempts = attempts;

    container.appendChild(wrap);
  }

  function updateSymbol(p) {
    if (p.isObserver && elements.seq) {
      // Affiche la séquence (animée à chaque changement)
      const current = elements.seq.dataset.seq;
      const next = (p.sequence || []).join('');
      if (current !== next) {
        elements.seq.innerHTML = '';
        for (const s of p.sequence) {
          const span = document.createElement('span');
          span.className = 'symbol';
          span.textContent = s;
          elements.seq.appendChild(span);
        }
        elements.seq.dataset.seq = next;
      }
    }

    if (elements.progress) {
      const total = 4;
      elements.progress.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const pip = document.createElement('span');
        pip.className = 'progress-pip' + (i < p.progress ? ' filled' : '');
        elements.progress.appendChild(pip);
      }
    }

    if (elements.attempts) {
      elements.attempts.innerHTML = '<span>Essais :</span>';
      for (let i = 0; i < p.maxAttempts; i++) {
        const pip = document.createElement('span');
        pip.className = 'attempt-pip' + (i < p.attempts ? ' lost' : '');
        elements.attempts.appendChild(pip);
      }
    }

    // Détection de feedback : si la progression a chuté, on signale une erreur
    if (lastPuzzle && lastPuzzle.type === 'SYMBOL_SEQUENCE') {
      if (p.progress > lastPuzzle.progress) Audio7.SFX.success();
      if (p.progress < lastPuzzle.progress && lastPuzzle.progress > 0) {
        Audio7.SFX.error();
        if (elements.pad) {
          for (const b of elements.pad.children) {
            b.classList.add('error');
            setTimeout(() => b.classList.remove('error'), 400);
          }
        }
      }
    }
  }

  /* -------------------------------------------------------------------------- */
  /* WIRE_ROUTING                                                               */
  /* -------------------------------------------------------------------------- */

  const COLOR_LABELS = { cyan: 'CYAN', magenta: 'MAGENTA', amber: 'AMBRE' };
  const COLOR_HEX = { cyan: '#06b6d4', magenta: '#db2777', amber: '#d97706' };

  function mountWire(container, p) {
    const wrap = document.createElement('div');
    wrap.className = 'puzzle wire-puzzle';

    const role = document.createElement('div');
    role.className = 'puzzle-role';
    role.textContent = p.isObserver ? 'RÔLE : DIAGNOSTIC' : 'RÔLE : MAINTENANCE';
    wrap.appendChild(role);

    const title = document.createElement('div');
    title.className = 'puzzle-title';
    title.textContent = 'Stabilisation du réseau';
    wrap.appendChild(title);

    const instr = document.createElement('div');
    instr.className = 'puzzle-instruction';
    instr.textContent = p.isObserver
      ? "Vous voyez la couleur cible. Communiquez l'état de la grille et la cible à votre coéquipier."
      : "Vous voyez la grille et 8 interrupteurs. Votre coéquipier vous dira quelle couleur viser.";
    wrap.appendChild(instr);

    if (p.isObserver) {
      const target = document.createElement('div');
      target.className = 'target-display';
      target.innerHTML = `
        <span class="target-label">Couleur cible</span>
        <span class="target-swatch" style="background:${COLOR_HEX[p.target] || '#888'}"></span>
        <span class="target-name">${COLOR_LABELS[p.target] || p.target}</span>
      `;
      wrap.appendChild(target);
    }

    const grid = document.createElement('div');
    grid.className = 'wire-grid';
    for (let i = 0; i < 16; i++) {
      const cell = document.createElement('div');
      cell.className = 'wire-cell';
      cell.dataset.idx = i;
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    elements.grid = grid;

    const matches = document.createElement('div');
    matches.className = 'wire-matches';
    wrap.appendChild(matches);
    elements.matches = matches;

    if (!p.isObserver) {
      const switches = document.createElement('div');
      switches.className = 'switch-grid';
      for (const id of p.switches) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'switch-button';
        b.textContent = id;
        b.dataset.switchId = id;
        b.addEventListener('click', () => {
          Audio7.unlock();
          Audio7.SFX.uiClick();
          Net.sendAction({ type: 'TOGGLE_SWITCH', switchId: id });
        });
        switches.appendChild(b);
      }
      wrap.appendChild(switches);
    }

    container.appendChild(wrap);
  }

  function updateWire(p) {
    if (elements.grid) {
      const cells = elements.grid.children;
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const color = p.grid[i];
        cell.className = 'wire-cell ' + color;
      }
    }
    if (elements.matches) {
      elements.matches.innerHTML = `Cellules conformes : <strong>${p.matches}</strong> / ${p.total}`;
    }
    // Feedback sonore quand un progrès est fait
    if (lastPuzzle && lastPuzzle.type === 'WIRE_ROUTING') {
      if (p.matches > lastPuzzle.matches) Audio7.SFX.tick();
    }
  }

  /* -------------------------------------------------------------------------- */
  /* LAUNCH_SEQUENCE                                                            */
  /* -------------------------------------------------------------------------- */

  function mountLaunch(container, p) {
    const wrap = document.createElement('div');
    wrap.className = 'puzzle launch-puzzle';

    const role = document.createElement('div');
    role.className = 'puzzle-role';
    role.textContent = 'MISE À FEU MANUELLE';
    wrap.appendChild(role);

    const title = document.createElement('div');
    title.className = 'puzzle-title';
    title.textContent = 'Séquence de lancement';
    wrap.appendChild(title);

    const instr = document.createElement('div');
    instr.className = 'puzzle-instruction';
    instr.textContent = "Tous les joueurs doivent maintenir leur levier rouge enfoncé EN MÊME TEMPS pendant 5 secondes.";
    wrap.appendChild(instr);

    const status = document.createElement('div');
    status.className = 'launch-status';
    wrap.appendChild(status);
    elements.status = status;

    const bar = document.createElement('div');
    bar.className = 'launch-bar';
    const fill = document.createElement('div');
    fill.className = 'launch-bar-fill';
    bar.appendChild(fill);
    wrap.appendChild(bar);
    elements.fill = fill;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'launch-button';
    btn.textContent = 'MAINTENIR';
    elements.btn = btn;

    // Gestion robuste maintenir/relâcher (souris + tactile + clavier + perte de focus)
    let holding = false;
    const startHold = (e) => {
      if (e) e.preventDefault();
      if (holding) return;
      holding = true;
      btn.classList.add('holding');
      Audio7.unlock();
      Net.sendAction({ type: 'HOLD_START' });
    };
    const stopHold = (e) => {
      if (e) e.preventDefault();
      if (!holding) return;
      holding = false;
      btn.classList.remove('holding');
      Net.sendAction({ type: 'HOLD_STOP' });
    };

    btn.addEventListener('mousedown', startHold);
    btn.addEventListener('mouseup', stopHold);
    btn.addEventListener('mouseleave', stopHold);
    btn.addEventListener('touchstart', startHold, { passive: false });
    btn.addEventListener('touchend', stopHold);
    btn.addEventListener('touchcancel', stopHold);
    // Sécurité : si la fenêtre perd le focus pendant qu'on maintient
    window.addEventListener('blur', stopHold);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopHold();
    });

    wrap.appendChild(btn);
    container.appendChild(wrap);
  }

  function updateLaunch(p) {
    if (elements.fill) {
      const pct = Math.round((p.progress || 0) * 100);
      elements.fill.style.width = pct + '%';
    }
    if (elements.status) {
      elements.status.innerHTML =
        `<strong>${p.holders} / ${p.totalPlayers}</strong> coéquipier(s) en position`;
    }
  }

  global.Puzzles = { render };
})(window);
