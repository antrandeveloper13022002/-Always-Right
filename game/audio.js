'use strict';
// Background music and two sound effects, synthesised with Web Audio — no
// audio files. A light, swung jazz loop (I–vi–ii–V in C) at a low volume.
// Browsers only allow sound after a click, so start() is called from one.

const GameAudio = (() => {
  const BPM = 104;
  const SWING = 0.62;          // share of a beat taken by the first 8th note
  const VOLUME = 0.16;
  const LOOKAHEAD = 0.12;      // seconds scheduled ahead of the clock

  // Chords as MIDI notes (root position voicings around middle C).
  const CHORDS = [
    { root: 36, notes: [60, 64, 67, 71] },   // Cmaj7
    { root: 45, notes: [57, 60, 64, 67] },   // Am7
    { root: 38, notes: [62, 65, 69, 72] },   // Dm7
    { root: 43, notes: [59, 62, 65, 67] },   // G7
  ];
  const MELODY = [72, 74, 76, 79, 81, 84];   // C major pentatonic, upper octave

  let ctx = null;
  let master = null;
  let noise = null;
  let timer = 0;
  let nextTime = 0;
  let step = 0;               // 8th-note counter
  let isMuted = false;
  let fx = null;
  let ambience = null;
  let rainTimer = 0;
  const FX_VOLUME = 0.7;
  const RAIN_VOLUME = 0.55;

  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

  function setup() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 5200;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    master = ctx.createGain();
    master.gain.value = isMuted ? 0 : VOLUME;
    warmth.connect(glue).connect(master).connect(ctx.destination);
    master.input = warmth;
    // Effects and the rain have their own buses, louder than the music.
    fx = ctx.createGain();
    fx.gain.value = isMuted ? 0 : FX_VOLUME;
    fx.connect(ctx.destination);
    ambience = ctx.createGain();
    ambience.gain.value = isMuted ? 0 : RAIN_VOLUME;
    ambience.connect(ctx.destination);

    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  // ---- Instruments -------------------------------------------------------
  function tone(freq, at, dur, { type = 'sine', gain = 0.2, attack = 0.01, release = 0.25, detune = 0, out = master.input } = {}) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(gain * 0.4, at + dur);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur + release);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + dur + release + 0.05);
  }

  function hiss(at, dur, { gain = 0.1, type = 'highpass', freq = 7000, q = 0.7, out = master.input, sweep = 0 } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    if (sweep) {
      filter.frequency.setValueAtTime(freq, at);
      filter.frequency.exponentialRampToValueAtTime(sweep, at + dur);
    }
    src.connect(filter).connect(env).connect(out);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.02);
  }

  function kick(at, gain = 0.5, { from = 120, to = 45, out = master.input } = {}) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + 0.12);
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + 0.3);
  }

  function keys(chord, at, dur) {
    for (const note of chord.notes) {
      tone(hz(note), at, dur, { type: 'sine', gain: 0.05, attack: 0.008, release: 0.35 });
      tone(hz(note), at, dur, { type: 'triangle', gain: 0.018, attack: 0.008, release: 0.3, detune: 6 });
    }
  }

  // ---- Sequencer: 8 eighth notes per bar, one chord per bar ---------------
  function playStep(at, eighth) {
    const bar = Math.floor(step / 8) % CHORDS.length;
    const chord = CHORDS[bar];
    const beatLen = 60 / BPM;

    // Drums: kick on 1 and the "and" of 3, rim on 2 and 4, swung hats.
    if (eighth === 0 || eighth === 5) kick(at, eighth === 0 ? 0.5 : 0.32);
    if (eighth === 2 || eighth === 6) hiss(at, 0.09, { gain: 0.16, type: 'bandpass', freq: 1900, q: 1.4 });
    hiss(at, 0.035, { gain: eighth % 2 ? 0.035 : 0.06 });

    // Keys: on 1 and pushed onto the "and" of 2.
    if (eighth === 0) keys(chord, at, beatLen * 1.2);
    if (eighth === 3) keys(chord, at, beatLen * 1.6);

    // Bass: root, fifth, then a chromatic approach to the next chord.
    const next = CHORDS[(bar + 1) % CHORDS.length].root;
    const bass = { 0: chord.root, 4: chord.root + 7, 6: chord.root + 12, 7: next + 1 }[eighth];
    if (bass !== undefined) tone(hz(bass), at, beatLen * 0.45, { type: 'triangle', gain: 0.22, release: 0.12 });

    // A playful, sparse melody on top.
    if (eighth % 2 === 1 ? Math.random() < 0.28 : Math.random() < 0.38) {
      const note = MELODY[Math.floor(Math.random() * MELODY.length)];
      tone(hz(note), at, beatLen * 0.3, { type: 'sine', gain: 0.045, attack: 0.005, release: 0.4 });
    }
  }

  function schedule() {
    const beatLen = 60 / BPM;
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      const eighth = step % 8;
      playStep(nextTime, eighth);
      nextTime += beatLen * (eighth % 2 === 0 ? SWING : 1 - SWING);
      step += 1;
    }
  }

  // ---- Public API --------------------------------------------------------
  function start() {
    try {
      if (!ctx) setup();
      if (ctx.state === 'suspended') ctx.resume();
      if (timer) return;
      nextTime = ctx.currentTime + 0.1;
      timer = setInterval(schedule, 25);
      startRain();
    } catch (error) {
      timer = 0; // no Web Audio: the game simply stays silent
    }
  }

  function setMuted(value) {
    isMuted = value;
    if (isMuted) stopVoice();
    if (!master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(isMuted ? 0 : VOLUME, ctx.currentTime + 0.3);
    for (const [bus, level] of [[fx, FX_VOLUME], [ambience, RAIN_VOLUME]]) {
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.linearRampToValueAtTime(isMuted ? 0 : level, ctx.currentTime + 0.3);
    }
  }

  // ---- Rain outside: a steady wash, a low rumble, drops ticking on the glass.
  function startRain() {
    if (rainTimer) return;
    const loop = (type, freq, q, gain) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const level = ctx.createGain();
      level.gain.value = gain;
      src.connect(filter).connect(level).connect(ambience);
      src.start();
    };
    loop('bandpass', 2600, 0.35, 0.05);   // the wash
    loop('lowpass', 260, 0.7, 0.09);      // the rumble
    rainTimer = setInterval(() => {
      if (isMuted) return;
      const at = ctx.currentTime + Math.random() * 0.1;
      if (Math.random() < 0.55) hiss(at, 0.012 + Math.random() * 0.01, { gain: 0.05 + Math.random() * 0.05, type: 'bandpass', freq: 3000 + Math.random() * 3500, q: 3, out: ambience });
      if (Math.random() < 0.04) tone(1800 + Math.random() * 900, at, 0.02, { gain: 0.012, release: 0.08, out: ambience });   // a fat drop
    }, 90);
  }

  // ---- One-shot effects ----------------------------------------------------
  const EFFECTS = {
    stamp: (at) => { kick(at, 0.9); hiss(at, 0.06, { gain: 0.4, type: 'lowpass', freq: 900 }); },
    page: (at) => hiss(at, 0.22, { gain: 0.14, type: 'bandpass', freq: 3200, q: 0.6 }),
    // A fist on the window: a dull thud, then the pane rings.
    knock: (at) => {
      kick(at, 0.9, { from: 95, to: 48, out: fx });
      hiss(at, 0.07, { gain: 0.35, type: 'bandpass', freq: 1100, q: 1.2, out: fx });
      tone(2350, at + 0.005, 0.03, { gain: 0.03, release: 0.35, out: fx });
      tone(3170, at + 0.005, 0.03, { gain: 0.02, release: 0.28, out: fx });
    },
    crack: (at) => {
      hiss(at, 0.09, { gain: 0.45, type: 'highpass', freq: 3200, out: fx });
      for (let i = 1; i < 5; i++) hiss(at + i * 0.018 + Math.random() * 0.01, 0.012, { gain: 0.25, type: 'bandpass', freq: 4500 + Math.random() * 2500, q: 4, out: fx });
      tone(5300, at, 0.01, { gain: 0.02, release: 0.2, out: fx });
    },
    slam: (at) => {
      kick(at, 1, { from: 80, to: 40, out: fx });
      hiss(at, 0.16, { gain: 0.5, type: 'lowpass', freq: 650, out: fx });
      hiss(at, 0.05, { gain: 0.25, type: 'bandpass', freq: 380, q: 2, out: fx });
    },
    whoosh: (at) => hiss(at, 0.24, { gain: 0.18, type: 'bandpass', freq: 700, q: 1.2, sweep: 2600, out: fx }),
    paper: (at) => {
      for (let i = 0; i < 7; i++) hiss(at + Math.random() * 0.16, 0.025, { gain: 0.12, type: 'bandpass', freq: 2000 + Math.random() * 2500, q: 2, out: fx });
    },
    shutter: (at) => {
      hiss(at, 0.015, { gain: 0.3, type: 'highpass', freq: 4000, out: fx });
      hiss(at + 0.06, 0.02, { gain: 0.22, type: 'highpass', freq: 3000, out: fx });
    },
    // The citation printer: a motor hum under rapid dot-matrix ticks.
    printer: (at) => {
      tone(118, at, 1.2, { type: 'sawtooth', gain: 0.018, attack: 0.05, release: 0.1, out: fx });
      for (let t = 0; t < 1.2; t += 0.032) hiss(at + t, 0.008, { gain: 0.06 + Math.random() * 0.04, type: 'bandpass', freq: 1900, q: 3, out: fx });
    },
    alarm: (at) => {
      for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 880, at + i * 0.14, 0.1, { type: 'square', gain: 0.03, attack: 0.005, release: 0.03, out: fx });
    },
    refuse: (at) => {
      tone(392, at, 0.12, { type: 'triangle', gain: 0.08, release: 0.15, out: fx });
      tone(311, at + 0.14, 0.18, { type: 'triangle', gain: 0.08, release: 0.25, out: fx });
    },
    slide: (at) => hiss(at, 0.5, { gain: 0.08, type: 'bandpass', freq: 1500, q: 0.8, sweep: 900, out: fx }),
    // A footstep on wet pavement: a soft heel plus a little splash.
    step: (at) => {
      hiss(at, 0.05, { gain: 0.14, type: 'lowpass', freq: 800, out: fx });
      hiss(at + 0.01, 0.06, { gain: 0.05, type: 'highpass', freq: 2600, out: fx });
    },
    umbrella: (at) => {
      hiss(at, 0.28, { gain: 0.14, type: 'bandpass', freq: 1100, q: 0.6, sweep: 2200, out: fx });
      tone(2600, at + 0.26, 0.01, { gain: 0.03, release: 0.05, out: fx });
    },
  };

  function sfx(name, delay = 0) {
    if (!ctx || isMuted || !EFFECTS[name]) return;
    EFFECTS[name](ctx.currentTime + 0.01 + delay);
  }

  // ---- Voices: babble, one blip per Vietnamese syllable --------------------
  // Each syllable is a buzz shaped by two vowel formants, and its pitch
  // follows the tone mark (sắc rises, huyền falls, hỏi dips, ngã breaks
  // upward, nặng drops short). Not words, but it sounds like Vietnamese.
  const VOICE_VOLUME = 0.5;
  const MAX_SYLLABLES = 34;
  const FORMANTS = { a: [800, 1250], e: [520, 1850], i: [320, 2300], o: [520, 920], u: [360, 820] };
  const TONES = {   // pitch multipliers at start, middle, end; duration factor
    flat: [1, 1, 1, 1], sac: [0.98, 1.08, 1.24, 1], huyen: [0.94, 0.86, 0.8, 1.05],
    hoi: [0.95, 0.8, 0.94, 1.05], nga: [1, 0.9, 1.3, 1.05], nang: [0.86, 0.78, 0.74, 0.7],
  };
  let voiceBus = null;

  function syllables(text) {
    const out = [];
    for (const raw of text.split(/\s+/)) {
      if (!raw) continue;
      const word = raw.normalize('NFD');
      const tone = /́/.test(word) ? 'sac' : /̀/.test(word) ? 'huyen' : /̉/.test(word) ? 'hoi'
        : /̃/.test(word) ? 'nga' : /̣/.test(word) ? 'nang' : 'flat';
      const base = word.replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd');
      const vowel = (base.match(/[aeiouy]/) || ['a'])[0].replace('y', 'i');
      const pause = /[.!?…]$/.test(raw) ? 0.26 : /[,;:]$/.test(raw) ? 0.14 : 0;
      if (/[a-z0-9]/.test(base)) out.push({ tone, vowel, pause });
    }
    return out.slice(0, MAX_SYLLABLES);
  }

  // Speaks `text` after `delay` seconds; returns how long it lasts.
  // pitch: base frequency in Hz; angry: harsher, faster; radio: walkie-talkie.
  function voice(text, { pitch = 150, angry = false, radio = false, delay = 0 } = {}) {
    stopVoice();
    if (!ctx || isMuted) return 0;
    const bus = ctx.createGain();
    bus.gain.value = VOICE_VOLUME * (angry ? 1.25 : 1);
    let out = bus;
    if (radio) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1400;
      band.Q.value = 0.9;
      bus.connect(band);
      out = band;
    }
    out.connect(ctx.destination);
    voiceBus = bus;

    const start = ctx.currentTime + 0.05 + delay;
    let at = start;
    if (radio) hiss(at - 0.04, 0.08, { gain: 0.2, type: 'bandpass', freq: 2500, q: 0.8 });
    const speed = angry ? 0.78 : 1;
    for (const s of syllables(text)) {
      const [p0, p1, p2, len] = TONES[s.tone];
      const dur = (0.095 + Math.random() * 0.03) * len * speed;
      const f = pitch * (1 + (Math.random() - 0.5) * 0.06);
      const osc = ctx.createOscillator();
      osc.type = angry ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(f * p0, at);
      osc.frequency.linearRampToValueAtTime(f * p1, at + dur * 0.5);
      osc.frequency.linearRampToValueAtTime(f * p2, at + dur);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(0.16, at + 0.012);
      env.gain.setValueAtTime(0.16, at + dur * 0.7);
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.03);
      osc.connect(env);
      for (const [i, freq] of FORMANTS[s.vowel].entries()) {
        const formant = ctx.createBiquadFilter();
        formant.type = 'bandpass';
        formant.frequency.value = freq * (pitch > 170 ? 1.12 : 1);
        formant.Q.value = i ? 7 : 4;
        const mix = ctx.createGain();
        mix.gain.value = i ? 0.7 : 1;
        env.connect(formant).connect(mix).connect(bus);
      }
      osc.start(at);
      osc.stop(at + dur + 0.05);
      at += dur + 0.03 * speed + s.pause * speed;
    }
    if (radio) hiss(at, 0.1, { gain: 0.16, type: 'bandpass', freq: 2500, q: 0.8 });
    return at - start + delay;
  }

  function stopVoice() {
    if (!voiceBus || !ctx) return;
    const bus = voiceBus;
    voiceBus = null;
    bus.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    setTimeout(() => bus.disconnect(), 300);
  }

  return { start, setMuted, sfx, voice, stopVoice, isMuted: () => isMuted };
})();
