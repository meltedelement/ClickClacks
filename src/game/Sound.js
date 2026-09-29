// Sound effects, synthesised on the fly with the Web Audio API (no audio files).
// Browsers only allow audio after a user gesture, so the audio context is created
// on the first click or key press; anything before that is silently skipped.

const STORAGE_KEY = 'weapon-balls:muted';
const MIN_GAP = 0.03; // s between two plays of the same sound, so fast-forward doesn't pile up

// Weapons that hit with a dull thud instead of a sharp slice.
const BLUNT = new Set(['mace']);

// One audio context for the page, shared by every Sound (the display page runs
// several games at once, and browsers limit how many contexts a page can open).
let audio = null; // { ctx, master, noiseBuffer } once unlocked
let masterMuted = loadMuted(STORAGE_KEY);

// Every sound is rate-limited per Sound instance above, but the display page has
// one Sound per screen: four arenas each starting their own oscillators and
// noise sources is four times the audio-node churn. This Map (key -> time of the
// last play) spreads the same limit across the whole page, so a busy screen can't
// multiply the voices.
const lastPlayedOnPage = new Map();

function unlockAudio() {
  if (!audio) {
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    // Compressor keeps a burst of overlapping hits from clipping.
    const compressor = new DynamicsCompressorNode(ctx, { threshold: -12, ratio: 6 });
    compressor.connect(ctx.destination);
    const master = new GainNode(ctx, { gain: 0.5 });
    master.connect(compressor);
    audio = { ctx, master, noiseBuffer: makeNoise(ctx) };
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
// A page that embeds the display (the quiz's big screen, with allow="autoplay")
// sends this after its own first click, which the browser lets count for this frame.
window.addEventListener('message', (e) => e.data === 'weapon-balls:unlock-audio' && unlockAudio());

export class Sound {
  // Mutes every Sound on the page. Saved across visits.
  static get muted() {
    return masterMuted;
  }

  static set muted(muted) {
    masterMuted = muted;
    saveMuted(STORAGE_KEY, muted);
  }

  // `key` names this Sound's own mute switch (e.g. one per display screen) so
  // it is saved across visits. Without a key it has none.
  constructor({ key = null } = {}) {
    this.key = key && `${STORAGE_KEY}:${key}`;
    this.lastPlayed = new Map();
    this._muted = this.key ? loadMuted(this.key) : false;
  }

  // This Sound's own mute, on top of the page-wide Sound.muted.
  get muted() {
    return this._muted;
  }

  set muted(muted) {
    this._muted = muted;
    if (this.key) saveMuted(this.key, muted);
  }

  get ctx() {
    return audio?.ctx ?? null;
  }

  get master() {
    return audio.master;
  }

  get noiseBuffer() {
    return audio.noiseBuffer;
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

  // A critical hit, on top of the normal hit sound: a deep boom, a bright
  // ringing strike and a sharp crack.
  crit() {
    if (!this.ready('crit')) return;
    this.tone({ type: 'sine', freq: 95, freqEnd: 32, dur: 0.6, gain: 0.9 });
    this.tone({ type: 'square', freq: 1320, freqEnd: 660, dur: 0.25, gain: 0.12, lowpass: 4000 });
    this.clang([1560, 2340, 3120], 0.5, 0.28);
    this.noise({ filter: 'highpass', freq: 2500, freqEnd: 900, dur: 0.18, gain: 0.55 });
  }

  // Quick airy swish of a blade missing.
  dodge() {
    if (!this.ready('dodge')) return;
    this.whoosh(0.16, 1400, 3800, 0.3);
  }

  // Small damage that isn't a weapon hit (thorns, spikes, shield bash, burning...).
  chip() {
    if (!this.ready('chip')) return;
    this.tone({ type: 'triangle', freq: 520 * vary(1), freqEnd: 260, dur: 0.08, gain: 0.18 });
    this.noise({ filter: 'bandpass', freq: 2400, dur: 0.05, gain: 0.2 });
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
      case 'throw':
        this.whoosh(0.3, 500, 2400, 0.5);
        break;
      case 'catch':
        this.clang([520, 790], 0.15, 0.12);
        break;
      case 'wrap':
        this.whoosh(0.15, 1200, 2800, 0.3);
        break;
      case 'portal':
        this.tone({ type: 'sine', freq: 260, freqEnd: 1100, dur: 0.3, gain: 0.3 });
        this.whoosh(0.3, 400, 1800, 0.35);
        break;
      case 'saw':
        this.tone({ type: 'sawtooth', freq: 220, freqEnd: 480, dur: 0.5, gain: 0.12, attack: 0.05, lowpass: 2400 });
        this.whoosh(0.3, 800, 3000, 0.35);
        break;
      case 'slam': {
        const power = Math.min(shake / 12, 1);
        this.tone({ type: 'sine', freq: 110, freqEnd: 30, dur: 0.4 + power * 0.3, gain: 0.8 + power * 0.2 });
        this.noise({ filter: 'lowpass', freq: 600, freqEnd: 150, dur: 0.35 + power * 0.2, gain: 0.5 + power * 0.4 });
        break;
      }
    }
  }

  upgrade(phase, shake = 0) {
    if (!this.ready(`upgrade:${phase}`)) return;
    switch (phase) {
      case 'heal':
        this.tone({ type: 'sine', freq: 660, freqEnd: 990, dur: 0.18, gain: 0.15 });
        break;
      case 'ward':
        this.tone({ type: 'triangle', freq: 440, freqEnd: 880, dur: 0.22, gain: 0.18 });
        break;
      case 'absorb':
        this.clang([880, 1320, 1980], 0.4, 0.2);
        this.tone({ type: 'sine', freq: 330, freqEnd: 165, dur: 0.25, gain: 0.3 });
        break;
      case 'throw':
      case 'net-throw':
        this.whoosh(0.22, 600, 1800, 0.35);
        break;
      case 'catch':
        this.clang([520, 790], 0.15, 0.12);
        break;
      case 'ignite':
        this.noise({ filter: 'lowpass', freq: 500, freqEnd: 2200, dur: 0.3, gain: 0.3, attack: 0.08 });
        break;
      case 'lunge':
        this.whoosh(0.2 + shake * 0.03, 900, 2600, 0.4);
        break;
      case 'net':
        this.noise({ filter: 'bandpass', freq: 900, freqEnd: 400, q: 0.8, dur: 0.2, gain: 0.4 });
        break;
      case 'impale':
        this.tone({ type: 'sine', freq: 160, freqEnd: 60, dur: 0.25, gain: 0.6 });
        this.noise({ filter: 'bandpass', freq: 1800, freqEnd: 600, q: 1.5, dur: 0.18, gain: 0.45 });
        break;
      case 'pulse':
        this.tone({ type: 'sine', freq: 220, freqEnd: 90, dur: 0.3, gain: 0.45 });
        this.whoosh(0.25, 300, 1200, 0.3);
        break;
      case 'tackle':
        this.noise({ filter: 'lowpass', freq: 1400, freqEnd: 300, dur: 0.15, gain: 0.5 });
        this.clang([330, 495], 0.2, 0.15);
        break;
      case 'hasten':
        this.tone({ type: 'triangle', freq: 880, freqEnd: 1320, dur: 0.1, gain: 0.1 });
        break;
      case 'clang':
        this.clang([1850, 2780, 4100], 0.25, 0.07);
        break;
      case 'stun':
        this.clang([990, 1485], 0.3, 0.15);
        this.tone({ type: 'triangle', freq: 1400, freqEnd: 700, dur: 0.35, gain: 0.12 });
        break;
      case 'launch':
        this.tone({ type: 'sine', freq: 110, freqEnd: 520, dur: 0.3, gain: 0.5 });
        break;
      case 'explode':
        this.tone({ type: 'sine', freq: 80, freqEnd: 25, dur: 0.7, gain: 1 });
        this.noise({ filter: 'lowpass', freq: 2200, freqEnd: 120, dur: 0.6, gain: 0.8 });
        break;
      case 'pillar':
        this.noise({ filter: 'lowpass', freq: 300, freqEnd: 2600, dur: 0.5, gain: 0.5, attack: 0.08 });
        this.tone({ type: 'sawtooth', freq: 70, freqEnd: 140, dur: 0.5, gain: 0.15, lowpass: 600 });
        break;
      case 'shadow':
        this.tone({ type: 'sine', freq: 520, freqEnd: 260, dur: 0.25, gain: 0.15 });
        break;
      case 'teleport':
        this.tone({ type: 'sine', freq: 1200, freqEnd: 300, dur: 0.2, gain: 0.25 });
        this.whoosh(0.2, 1200, 3600, 0.3);
        break;
      case 'steal':
        this.tone({ type: 'triangle', freq: 1320, freqEnd: 1760, dur: 0.08, gain: 0.12 });
        break;
      case 'loot':
        this.clang([1760, 2640], 0.2, 0.1);
        break;
      case 'slip':
        this.tone({ type: 'sine', freq: 300, freqEnd: 900, dur: 0.15, gain: 0.25 });
        break;
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

  // True if the sound should play now. Also rate-limits each sound by key,
  // both for this Sound and across every Sound on the page (see above).
  ready(key) {
    if (masterMuted || this.muted || !this.ctx || this.ctx.state !== 'running') return false;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(key) ?? -1) < MIN_GAP) return false;
    if (now - (lastPlayedOnPage.get(key) ?? -1) < MIN_GAP) return false;
    this.lastPlayed.set(key, now);
    lastPlayedOnPage.set(key, now);
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

function loadMuted(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function saveMuted(key, muted) {
  try {
    localStorage.setItem(key, muted ? '1' : '0');
  } catch {
    // Storage blocked (private mode etc.); the setting just won't persist.
  }
}
