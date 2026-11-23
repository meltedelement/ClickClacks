// exactMath stands in for Math while a royale runs, so it has to agree with
// Math to within rounding, and must never change: devices running different
// versions of these numbers would show different fights.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asin, atan2, cos, exp, hypot, pow, sin, withExactMath } from './exactMath.js';
import { mulberry32 } from './random.js';

const close = (actual, expected, label, tolerance = 2e-15) => {
  const error = Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
  assert.ok(error <= tolerance, `${label}: got ${actual}, expected ${expected}`);
};

function samples(count, seed, from, to) {
  const random = mulberry32(seed);
  return Array.from({ length: count }, () => from + random() * (to - from));
}

test('sin and cos agree with Math over the angles a fight reaches', () => {
  for (const x of samples(50_000, 1, -20_000, 20_000)) {
    close(sin(x), Math.sin(x), `sin(${x})`);
    close(cos(x), Math.cos(x), `cos(${x})`);
  }
  for (const x of samples(20_000, 2, -7, 7)) {
    close(sin(x), Math.sin(x), `sin(${x})`);
    close(cos(x), Math.cos(x), `cos(${x})`);
  }
});

test('sin and cos are right around multiples of pi/2, where reduction loses digits', () => {
  for (let n = -64; n <= 64; n++) {
    for (const nudge of [0, 1e-12, -1e-12, 1e-6, -1e-6]) {
      const x = (n * Math.PI) / 2 + nudge;
      assert.ok(Math.abs(sin(x) - Math.sin(x)) < 1e-15, `sin(${x})`);
      assert.ok(Math.abs(cos(x) - Math.cos(x)) < 1e-15, `cos(${x})`);
    }
  }
});

test('atan2 agrees with Math in every quadrant and on the axes', () => {
  const values = samples(40_000, 3, -2000, 2000);
  for (let i = 0; i + 1 < values.length; i += 2) {
    close(atan2(values[i], values[i + 1]), Math.atan2(values[i], values[i + 1]), `atan2(${values[i]}, ${values[i + 1]})`);
  }
  for (const y of [0, -0, 1, -1, Infinity, -Infinity]) {
    for (const x of [0, -0, 1, -1, Infinity, -Infinity]) {
      assert.ok(Object.is(atan2(y, x), Math.atan2(y, x)) || Math.abs(atan2(y, x) - Math.atan2(y, x)) < 1e-15, `atan2(${y}, ${x})`);
    }
  }
});

test('asin agrees with Math', () => {
  for (const x of samples(50_000, 4, -1, 1)) close(asin(x), Math.asin(x), `asin(${x})`);
  assert.equal(asin(1), Math.PI / 2);
  assert.equal(asin(-1), -Math.PI / 2);
  assert.ok(Number.isNaN(asin(1.5)));
});

test('exp agrees with Math', () => {
  for (const x of samples(50_000, 5, -50, 50)) close(exp(x), Math.exp(x), `exp(${x})`, 4e-15);
  assert.equal(exp(0), 1);
  assert.equal(exp(1000), Infinity);
  assert.equal(exp(-1000), 0);
});

test('pow agrees with Math for what a fight uses', () => {
  for (const x of samples(20_000, 6, 0.001, 200)) {
    close(pow(x, 1 / 3), Math.pow(x, 1 / 3), `pow(${x}, 1/3)`, 1e-14);
    close(pow(x, 0.5), Math.pow(x, 0.5), `pow(${x}, 0.5)`, 1e-14);
    close(pow(x, 0.8), Math.pow(x, 0.8), `pow(${x}, 0.8)`, 1e-14);
  }
  assert.equal(pow(0.6, 2), 0.6 * 0.6);
  assert.equal(pow(2, 10), 1024);
  assert.equal(pow(2, -2), 0.25);
  assert.equal(pow(5, 0), 1);
  assert.equal(pow(0, 2), 0);
});

test('hypot agrees with Math', () => {
  const values = samples(40_000, 7, -2000, 2000);
  for (let i = 0; i + 1 < values.length; i += 2) close(hypot(values[i], values[i + 1]), Math.hypot(values[i], values[i + 1]), 'hypot');
  assert.equal(hypot(3, 4), 5);
  assert.equal(hypot(), 0);
});

test('withExactMath swaps the functions in, and back afterwards even after a throw', () => {
  const native = Math.sin;
  withExactMath(() => assert.equal(Math.sin, sin));
  assert.equal(Math.sin, native);
  assert.throws(() => withExactMath(() => { throw new Error('boom'); }));
  assert.equal(Math.sin, native);
});

// The exact bits, written out. If this fails the numbers changed, so a royale
// no longer plays out the way it did: fine on purpose, but never by accident.
test('the results are pinned to the bit', () => {
  const pinned = [sin(1.25), cos(1.25), sin(12345.678), cos(-987.654), atan2(3, -7), asin(0.75), exp(2.5), pow(7, 1 / 3), pow(3.7, 0.5)];
  const hex = pinned.map((n) => {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, n);
    return view.getBigUint64(0).toString(16);
  });
  assert.deepEqual(hex, PINNED);
});

const PINNED = ['3fee5e14fe11418c', '3fd42e3dd88bd952', 'bfe687d5890974a5', '3fd78dce32c96362', '4005e4c36ca0118a', '3feb235315c680dc', '40285d6fd931e0bb', '3ffe9b5dba58189d', '3ffec6d0353167a9'];
