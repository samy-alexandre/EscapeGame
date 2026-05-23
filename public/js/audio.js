/**
 * Système audio synthétique.
 * Aucun fichier audio externe — tous les sons sont générés à la volée
 * via la Web Audio API. Cela évite les téléchargements lourds, les
 * problèmes de licence, et fonctionne hors-ligne.
 */
(function (global) {
  let ctx = null;
  let masterGain = null;
  let ambientNode = null;
  let muted = false;

  function ensureContext() {
    if (ctx) return ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.4;
    masterGain.connect(ctx.destination);
    return ctx;
  }

  /** Doit être appelé sur une interaction utilisateur (auto-play policies). */
  function unlock() {
    const c = ensureContext();
    if (c && c.state === 'suspended') c.resume();
  }

  function envelope(gainNode, attack, decay, sustain, release, peak = 1) {
    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(peak, now + attack);
    gainNode.gain.linearRampToValueAtTime(peak * sustain, now + attack + decay);
    gainNode.gain.linearRampToValueAtTime(0, now + attack + decay + release);
  }

  function tone({ freq = 440, type = 'sine', dur = 0.2, attack = 0.01, decay = 0.05, sustain = 0.6, release = 0.1, peak = 0.3 }) {
    if (muted) return;
    const c = ensureContext();
    if (!c) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(g);
    g.connect(masterGain);
    envelope(g, attack, decay, sustain, release, peak);
    osc.start();
    osc.stop(c.currentTime + attack + decay + release + 0.05);
  }

  function noise({ dur = 0.15, peak = 0.2, filterFreq = 1000 }) {
    if (muted) return;
    const c = ensureContext();
    if (!c) return;
    const bufferSize = c.sampleRate * dur;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.value = peak;
    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start();
  }

  /* Effets prédéfinis */
  const SFX = {
    uiClick:   () => tone({ freq: 880, type: 'square', dur: 0.05, attack: 0.001, decay: 0.02, sustain: 0.3, release: 0.04, peak: 0.15 }),
    success:   () => {
      tone({ freq: 660, type: 'triangle', attack: 0.005, decay: 0.05, sustain: 0.7, release: 0.15, peak: 0.25 });
      setTimeout(() => tone({ freq: 990, type: 'triangle', attack: 0.005, decay: 0.05, sustain: 0.7, release: 0.2, peak: 0.25 }), 90);
    },
    error:     () => {
      tone({ freq: 200, type: 'sawtooth', attack: 0.005, decay: 0.05, sustain: 0.5, release: 0.15, peak: 0.2 });
      setTimeout(() => tone({ freq: 150, type: 'sawtooth', attack: 0.005, decay: 0.05, sustain: 0.5, release: 0.15, peak: 0.2 }), 80);
    },
    doorOpen:  () => {
      noise({ dur: 0.4, peak: 0.15, filterFreq: 600 });
      tone({ freq: 110, type: 'sawtooth', attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.4, peak: 0.2 });
    },
    win:       () => {
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => tone({ freq: f, type: 'triangle', attack: 0.01, decay: 0.05, sustain: 0.7, release: 0.3, peak: 0.25 }), i * 110);
      });
    },
    lose:      () => {
      [400, 300, 200, 150].forEach((f, i) => {
        setTimeout(() => tone({ freq: f, type: 'sawtooth', attack: 0.01, decay: 0.05, sustain: 0.6, release: 0.4, peak: 0.2 }), i * 150);
      });
    },
    alert:     () => tone({ freq: 880, type: 'square', dur: 0.08, attack: 0.001, decay: 0.02, sustain: 0.6, release: 0.05, peak: 0.18 }),
    tick:      () => tone({ freq: 1200, type: 'sine', attack: 0.001, decay: 0.01, sustain: 0.3, release: 0.03, peak: 0.08 }),
    notify:    () => {
      tone({ freq: 740, type: 'sine', attack: 0.005, decay: 0.04, sustain: 0.6, release: 0.1, peak: 0.15 });
      setTimeout(() => tone({ freq: 988, type: 'sine', attack: 0.005, decay: 0.04, sustain: 0.6, release: 0.12, peak: 0.15 }), 80);
    },
  };

  /** Ambiance de fond (drone très léger). Démarre/arrête au besoin. */
  function startAmbient() {
    if (muted) return;
    const c = ensureContext();
    if (!c || ambientNode) return;
    const osc = c.createOscillator();
    const osc2 = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = 55;
    osc2.type = 'sine';
    osc2.frequency.value = 110.5; // léger battement
    g.gain.value = 0.05;
    osc.connect(g);
    osc2.connect(g);
    g.connect(masterGain);
    osc.start();
    osc2.start();
    ambientNode = { osc, osc2, g };
  }

  function stopAmbient() {
    if (!ambientNode) return;
    try {
      const now = ctx.currentTime;
      ambientNode.g.gain.linearRampToValueAtTime(0, now + 0.5);
      setTimeout(() => {
        try { ambientNode.osc.stop(); ambientNode.osc2.stop(); } catch (e) {}
        ambientNode = null;
      }, 600);
    } catch (e) { ambientNode = null; }
  }

  function setMuted(v) {
    muted = !!v;
    if (muted && ambientNode) stopAmbient();
  }

  global.Audio7 = { unlock, SFX, startAmbient, stopAmbient, setMuted };
})(window);
