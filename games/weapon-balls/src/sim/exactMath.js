// The Math functions the sim uses whose exact result is up to the JavaScript
// engine, rewritten with only + - * / and sqrt, which every engine must get
// exactly right. A seeded match run under withExactMath plays out the same in
// Chrome, Firefox, Safari and Node, down to the last bit, so devices that each
// run the sim all show the same fight. The native functions differ in the last
// bit (Math.atan2 differs even between Node 22 and Chrome 151), and a fight
// amplifies that until the balls are somewhere else entirely.
//
// Normal matches don't use this: they keep the native functions, so their
// seeded results are what they always were. Only royales do (see Game.runSim).
//
// Any new Math function the sim starts using that isn't exact by the spec
// (sqrt, abs, floor, min, max and so on are) has to be added here, or a royale
// will drift apart between browsers. Use Math.pow rather than `**` in the sim:
// the operator can't be swapped out. Accuracy is within a few units in the last
// place; only being the same everywhere matters.
//
// The polynomials are the ones from fdlibm (Sun Microsystems, freely
// distributable), the library most engines' own versions come from.

const PI = 3.141592653589793;
const PI_LO = 1.2246467991473531772e-16;
const PIO2_HI = 1.5707963267948965580;
const PIO2_LO = 6.12323399573676603587e-17;
const INV_PIO2 = 6.36619772367581382433e-1;
// pi/2 in pieces: PIO2_1 has few enough bits that n * PIO2_1 is exact for any n we'll see.
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const MAX_REDUCE = 1e6; // far beyond any angle in a fight

const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700;

const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer); // words[1] is the high word on every platform we run on

function kernelSin(x, y) {
  const z = x * x;
  const v = z * x;
  const r = 8.33333333332248946124e-3 + z * (-1.98412698298579493134e-4 + z * (2.75573137070700676789e-6 + z * (-2.50507602534068634195e-8 + z * 1.58969099521155010221e-10)));
  return x - (z * (0.5 * y - v * r) - y - v * -1.66666666666666324348e-1);
}

function kernelCos(x, y) {
  const z = x * x;
  const r = z * (4.16666666666666019037e-2 + z * (-1.38888888888741095749e-3 + z * (2.48015872894767294178e-5 + z * (-2.75573143513906633035e-7 + z * (2.08757232129817482790e-9 + z * -1.13596475577881948265e-11)))));
  return 1 - (0.5 * z - (z * r - x * y));
}

// Reduces x to [-pi/4, pi/4] (remainder y0 + y1) and returns which quadrant it was in.
let y0 = 0;
let y1 = 0;
function reduce(x) {
  if (Math.abs(x) > MAX_REDUCE) x -= 2 * PI * Math.round(x / (2 * PI));
  const n = Math.round(x * INV_PIO2);
  const t = x - n * PIO2_1;
  let w = n * PIO2_2;
  const r = t - w;
  w = n * PIO2_2T - (t - r - w);
  y0 = r - w;
  y1 = r - y0 - w;
  return ((n % 4) + 4) % 4;
}

export function sin(x) {
  if (x === 0 || !Number.isFinite(x)) return x === 0 ? x : NaN;
  switch (reduce(x)) {
    case 0:
      return kernelSin(y0, y1);
    case 1:
      return kernelCos(y0, y1);
    case 2:
      return -kernelSin(y0, y1);
    default:
      return -kernelCos(y0, y1);
  }
}

export function cos(x) {
  if (!Number.isFinite(x)) return NaN;
  switch (reduce(x)) {
    case 0:
      return kernelCos(y0, y1);
    case 1:
      return -kernelSin(y0, y1);
    case 2:
      return -kernelCos(y0, y1);
    default:
      return kernelSin(y0, y1);
  }
}

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];

function atan(value) {
  if (value !== value) return NaN;
  let x = Math.abs(value);
  if (x === Infinity) return value > 0 ? PIO2_HI : -PIO2_HI;
  let id = -1;
  if (x >= 2.4375) {
    id = 3;
    x = -1 / x;
  } else if (x >= 1.1875) {
    id = 2;
    x = (x - 1.5) / (1 + 1.5 * x);
  } else if (x >= 0.6875) {
    id = 1;
    x = (x - 1) / (x + 1);
  } else if (x >= 0.4375) {
    id = 0;
    x = (2 * x - 1) / (2 + x);
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (3.33333333333329318027e-1 + w * (1.42857142725034663711e-1 + w * (9.09088713343650656196e-2 + w * (6.66107313738753120669e-2 + w * (4.97687799461593236017e-2 + w * 1.62858201153657823623e-2)))));
  const s2 = w * (-1.99999999998764832476e-1 + w * (-1.11111104054623557880e-1 + w * (-7.69187620504482999495e-2 + w * (-5.83357013379057348645e-2 + w * -3.65315727442169155270e-2))));
  if (id < 0) return value < 0 ? -(x - x * (s1 + s2)) : x - x * (s1 + s2);
  const result = ATAN_HI[id] - (x * (s1 + s2) - ATAN_LO[id] - x);
  return value < 0 ? -result : result;
}

export function atan2(y, x) {
  if (y !== y || x !== x) return NaN;
  if (y === 0) {
    const fromLeft = x < 0 || Object.is(x, -0);
    if (!fromLeft) return y;
    return Object.is(y, -0) ? -PI : PI;
  }
  if (x === 0) return y > 0 ? PIO2_HI : -PIO2_HI;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    if (!Number.isFinite(x) && !Number.isFinite(y)) {
      const angle = x > 0 ? PI / 4 : (3 * PI) / 4;
      return y > 0 ? angle : -angle;
    }
    if (!Number.isFinite(y)) return y > 0 ? PIO2_HI : -PIO2_HI;
    if (x > 0) return y > 0 ? 0 : -0;
    return y > 0 ? PI : -PI;
  }
  const z = atan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : z - PI_LO - PI;
}

function asinRatio(t) {
  const p = t * (1.66666666666666657415e-1 + t * (-3.25565818622400915405e-1 + t * (2.01212532134862925881e-1 + t * (-4.00555345006794114027e-2 + t * (7.91534994289814532176e-4 + t * 3.47933107596021167570e-5)))));
  const q = 1 + t * (-2.40339491173441421878 + t * (2.02094576023350569471 + t * (-6.88283971605453293030e-1 + t * 7.70381505559019352791e-2)));
  return p / q;
}

export function asin(x) {
  const abs = Math.abs(x);
  if (!(abs <= 1)) return NaN;
  if (abs === 1) return x > 0 ? PIO2_HI : -PIO2_HI;
  if (abs < 0.5) return x + x * asinRatio(x * x);
  const t = (1 - abs) * 0.5;
  const s = Math.sqrt(t);
  const result = PIO2_HI - (2 * (s + s * asinRatio(t)) - PIO2_LO);
  return x > 0 ? result : -result;
}

// 2^k, for k in the normal range.
function pow2(k) {
  words[0] = 0;
  words[1] = (k + 1023) << 20;
  return bits[0];
}

export function exp(x) {
  if (x !== x) return NaN;
  if (x > 709.78) return Infinity;
  if (x < -708) return 0; // nothing in a fight gets near this small
  const k = Math.round(x * INV_LN2);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (1.66666666666666019037e-1 + t * (-2.77777777770155933842e-3 + t * (6.61375632143793436117e-5 + t * (-1.65339022054652515390e-6 + t * 4.13813679705723846039e-8))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  // k can reach 1024 right at the top of the range, past what pow2 can write in one go.
  return k === 1024 ? y * 2 * pow2(1023) : y * pow2(k);
}

function log(x) {
  bits[0] = x;
  let k = (words[1] >>> 20) - 1023;
  words[1] = (words[1] & 0x000fffff) | 0x3ff00000; // the mantissa, in [1, 2)
  let m = bits[0];
  if (m > Math.SQRT2) {
    m *= 0.5;
    k += 1;
  }
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (3.999999999940941908e-1 + w * (2.222219843214978396e-1 + w * 1.531383769920937332e-1));
  const t2 = z * (6.666666666666735130e-1 + w * (2.857142874366239149e-1 + w * (1.818357216161805012e-1 + w * 1.479819860511658591e-1)));
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + (t1 + t2)) + k * LN2_LO) - f);
}

// Whole powers multiply out exactly as written; the rest go through log and exp.
export function pow(x, y) {
  if (y === 0 || x === 1) return 1;
  if (x !== x || y !== y) return NaN;
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    let result = 1;
    let base = x;
    for (let n = Math.abs(y); n > 0; n = Math.floor(n / 2)) {
      if (n % 2 === 1) result *= base;
      base *= base;
    }
    return y < 0 ? 1 / result : result;
  }
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) return NaN; // a fight never takes a fractional power of a negative
  return exp(y * log(x));
}

export function hypot(...values) {
  let sum = 0;
  for (const v of values) sum += v * v;
  return Math.sqrt(sum);
}

const EXACT = { sin, cos, asin, atan2, exp, pow, hypot };
const NATIVE = Object.fromEntries(Object.keys(EXACT).map((name) => [name, Math[name]]));

// Runs fn with Math's inexact functions swapped for the ones above.
export function withExactMath(fn) {
  Object.assign(Math, EXACT);
  try {
    return fn();
  } finally {
    Object.assign(Math, NATIVE);
  }
}
