// Sound effects, synthesised on the fly with the Web Audio API (no audio files).
// Browsers only allow audio after a user gesture, so the audio context is created
// on the first click or key press; anything before that is silently skipped.

const STORAGE_KEY = 'weapon-balls:muted';
const MIN_GAP = 0.03; // s between two plays of the same sound, so fast-forward doesn't pile up

// Weapons that hit with a dull thud instead of a sharp slice.
const BLUNT = new Set(['mace']);

export class Sound {
  constructor() {
    this.ctx = null;
    this.lastPlayed = new Map();
    this.muted = loadMuted();

    const unlock = () => {
      this.init();
      if (this.ctx?.state === 'suspended') this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  get muted() {
    return this._muted;
  }

  set muted(muted) {
    this._muted = muted;
    saveMuted(muted);
  }

  init() {
    if (this.ctx) return;
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return;

    this.ctx = new AudioContext();
    // Compressor keeps a burst of overlapping hits from clipping.
    const compressor = new DynamicsCompressorNode(this.ctx, { threshold: -12, ratio: 6 });
    compressor.connect(this.ctx.destination);
    this.master = new GainNode(this.ctx, { gain: 0.5 });
    this.master.connect(compressor);
    this.noiseBuffer = makeNoise(this.ctx);
  }

  // ---- Game sounds -----------------------------------------------------------

  hit(damage, weaponId) {
    if (!this.ready('hit')) return;
    const power = Math.min(damage / 20, 1);
    const pitch = vary(1);

    if (BLUNT.has(weaponId)) {
      this.tone({ type: 'sine', freq: 140 * pitch, freqEnd: 45, dur: 0.22, gain: 0.7 + power * 0.3 });
      this.noise({ filter: 'lowpass', freq: 900, dur: 0.12, gain: 0.5 + power * 0.3 });
    } else {
      this.tone({ type: 'sine', freq: 190 * pitch, freqEnd: 70, dur: 0.12, gain: 0.5 + power * 0.3 });
      this.noise({ filter: 'bandpass', freq: 3200 * pitch, freqEnd: 1400, q: 1.2, dur: 0.14, gain: 0.45 + power * 0.25 });
    }
  }

  parry() {
    if (!this.ready('parry')) return;
    this.clang([1180, 1790, 2630], 0.35, 0.22);
  }

  block() {
    if (!this.ready('block')) return;
    this.clang([520, 790, 1310], 0.3, 0.25);
    this.noise({ filter: 'lowpass', freq: 1200, dur: 0.08, gain: 0.35 });
  }

  ability(phase, shake = 0) {
    if (!this.ready(`ability:${phase}`)) return;
    switch (phase) {
      case 'swipe':
        this.whoosh(0.35, 700, 2600, 0.55);
        break;
      case 'charge':
        this.tone({ type: 'sawtooth', freq: 180, freqEnd: 520, dur: 0.45, gain: 0.12, attack: 0.2, lowpass: 1400 });
        break;
      case 'dash':
        this.whoosh(0.18 + shake * 0.03, 900, 2200 + shake * 200, 0.3 + shake * 0.06);
        break;
      case 'slam': {
        const power = Math.min(shake / 12, 1);
        this.tone({ type: 'sine', freq: 110, freqEnd: 30, dur: 0.4 + power * 0.3, gain: 0.8 + power * 0.2 });
        this.noise({ filter: 'lowpass', freq: 600, freqEnd: 150, dur: 0.35 + power * 0.2, gain: 0.5 + power * 0.4 });
        break;
      }
    }
  }

  death() {
    if (!this.ready('death')) return;
    this.tone({ type: 'sine', freq: 90, freqEnd: 25, dur: 0.9, gain: 1 });
    this.tone({ type: 'triangle', freq: 220, freqEnd: 55, dur: 0.5, gain: 0.3 });
    this.noise({ filter: 'lowpass', freq: 2000, freqEnd: 100, dur: 0.8, gain: 0.7 });
  }

  end(hasWinner) {
    if (!this.ready('end')) return;
    // Short fanfare for a win, a sad slide down for a draw.
    const notes = hasWinner ? [523, 659, 784, 1047] : [392, 330, 262];
    notes.forEach((freq, i) => {
      const last = i === notes.length - 1;
      this.tone({ type: 'triangle', freq, dur: last ? 0.5 : 0.14, gain: 0.25, delay: 0.35 + i * 0.12 });
    });
  }

  // ---- Building blocks -------------------------------------------------------

  // True if the sound should play now. Also rate-limits each sound by key.
  ready(key) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return false;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(key) ?? -1) < MIN_GAP) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  tone({ type, freq, freqEnd = freq, dur, gain, attack = 0.005, delay = 0, lowpass }) {
    const { ctx } = this;
    const t = ctx.currentTime + delay;
    const osc = new OscillatorNode(ctx, { type, frequency: freq });
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);

    let out = osc;
    if (lowpass) out = out.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: lowpass }));
    out.connect(this.envelope(t, attack, dur, gain));

    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noise({ filter, freq, freqEnd = freq, q = 1, dur, gain, attack = 0.003 }) {
    const { ctx } = this;
    const t = ctx.currentTime;
    const src = new AudioBufferSourceNode(ctx, { buffer: this.noiseBuffer });
    // Start somewhere random in the buffer so repeated hits don't sound identical.
    const offset = Math.random() * (this.noiseBuffer.duration - dur - 0.1);
    const biquad = new BiquadFilterNode(ctx, { type: filter, frequency: freq, Q: q });
    biquad.frequency.setValueAtTime(freq, t);
    biquad.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);

    src.connect(biquad).connect(this.envelope(t, attack, dur, gain));
    src.start(t, Math.max(0, offset));
    src.stop(t + dur + 0.05);
  }

  // Metallic ring: a few inharmonic partials that decay at slightly different rates.
  clang(partials, dur, gain) {
    const pitch = vary(0.5);
    partials.forEach((freq, i) => {
      this.tone({ type: 'triangle', freq: freq * pitch, dur: dur * (1 - i * 0.2), gain: gain / (i + 1) });
    });
    this.noise({ filter: 'highpass', freq: 3000, dur: 0.04, gain: 0.3 });
  }

  // Filtered noise swept up then back down.
  whoosh(dur, low, high, gain) {
    const { ctx } = this;
    const t = ctx.currentTime;
    const src = new AudioBufferSourceNode(ctx, { buffer: this.noiseBuffer });
    const biquad = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: low, Q: 2 });
    biquad.frequency.setValueAtTime(low, t);
    biquad.frequency.exponentialRampToValueAtTime(high, t + dur * 0.4);
    biquad.frequency.exponentialRampToValueAtTime(low, t + dur);

    src.connect(biquad).connect(this.envelope(t, dur * 0.35, dur, gain));
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // Gain node that ramps up over `attack`, then decays to silence by `dur`.
  envelope(t, attack, dur, gain) {
    const env = new GainNode(this.ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(this.master);
    return env;
  }
}

function makeNoise(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Random pitch multiplier around 1, e.g. vary(1) is ±~6%.
function vary(amount) {
  return 1 + (Math.random() - 0.5) * 0.12 * amount;
}

function loadMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(muted) {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Storage blocked (private mode etc.); the setting just won't persist.
  }
}
