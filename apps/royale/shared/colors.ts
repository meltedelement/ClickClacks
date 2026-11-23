// Who is who in the arena: bots all share one gray, and every player gets a
// colour nobody else has. Each new colour is the one that looks most different
// from the gray and from every colour already handed out, so a small group gets
// very different colours and a big crowd still gets the best spread there is.

export const BOT_COLOR = '#757575';
const BOT_IN_OKLAB = { lightness: 0.562, a: 0, b: 0 };

// The ball's HP number is white and the arena is nearly black: a colour has to
// read against both. Saturated only, so that nothing passes for a bot.
const MIN_CONTRAST_WITH_WHITE = 2.5;
const MIN_CONTRAST_WITH_ARENA = 3;
const ARENA_LUMINANCE = 0.0103; // the game's #171a21
const LIGHTNESSES = Array.from({ length: 16 }, (_, i) => 0.46 + i * 0.02);
const CHROMAS = [0.14, 0.18, 0.22];
const HUE_STEP = 5; // degrees

interface Candidate {
  hex: string;
  lightness: number;
  a: number;
  b: number;
  closest: number; // how far it is from the nearest colour taken so far
}

const candidates = buildCandidates();
const handedOut: string[] = [];

// The nth colour handed out. Always the same for the same n.
export function playerColor(n: number): string {
  while (handedOut.length <= n) handedOut.push(takeFarthest());
  return handedOut[n];
}

function takeFarthest(): string {
  const best = candidates.reduce((far, c) => (c.closest > far.closest ? c : far));
  for (const c of candidates) c.closest = Math.min(c.closest, distance(c, best));
  return best.hex;
}

function buildCandidates(): Candidate[] {
  const found: Candidate[] = [];
  for (const lightness of LIGHTNESSES) {
    for (const chroma of CHROMAS) {
      for (let degrees = 0; degrees < 360; degrees += HUE_STEP) {
        const a = chroma * Math.cos((degrees * Math.PI) / 180);
        const b = chroma * Math.sin((degrees * Math.PI) / 180);
        const rgb = oklabToLinearRgb(lightness, a, b);
        if (rgb.some((c) => c < 0 || c > 1)) continue; // a screen can't show it
        const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        if (1.05 / (luminance + 0.05) < MIN_CONTRAST_WITH_WHITE) continue;
        if ((luminance + 0.05) / (ARENA_LUMINANCE + 0.05) < MIN_CONTRAST_WITH_ARENA) continue;
        const position = { lightness, a, b };
        found.push({ ...position, hex: `#${rgb.map(toHexChannel).join('')}`, closest: distance(position, BOT_IN_OKLAB) });
      }
    }
  }
  return found;
}

// In OKLab, distance matches how different two colours look.
function distance(one: { lightness: number; a: number; b: number }, other: { lightness: number; a: number; b: number }): number {
  return Math.hypot(one.lightness - other.lightness, one.a - other.a, one.b - other.b);
}

function oklabToLinearRgb(lightness: number, a: number, b: number): number[] {
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3);
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

function toHexChannel(linear: number): string {
  const gamma = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.round(gamma * 255).toString(16).padStart(2, '0');
}
