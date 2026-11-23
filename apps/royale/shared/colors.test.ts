import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOT_COLOR, playerColor } from './colors.ts';

const ARENA = '#171a21'; // the game's background
const MOST_PLAYERS = 100; // MAX_PLAYERS, with room for people leaving and joining

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// WCAG contrast: 1 is no difference, 21 is black on white.
function contrast(one: string, other: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = channels(hex).map(linear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05;
  };
  const [a, b] = [luminance(one), luminance(other)];
  return Math.max(a, b) / Math.min(a, b);
}

// How different two colours look: distance in OKLab.
function apart(one: string, other: string) {
  const oklab = (hex: string) => {
    const [r, g, b] = channels(hex).map(linear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const [x, y] = [oklab(one), oklab(other)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const colors = (count: number) => Array.from({ length: count }, (_, n) => playerColor(n));

test('nobody shares a colour, and each is one the game accepts', () => {
  const all = colors(MOST_PLAYERS * 2);
  assert.equal(new Set(all).size, all.length);
  for (const color of all) assert.match(color, /^#[0-9a-f]{6}$/);
});

test('every colour stands out from the bots and the arena, and carries the white HP number', () => {
  for (const color of colors(MOST_PLAYERS * 2)) {
    assert.ok(apart(color, BOT_COLOR) >= 0.13, `${color} is too close to the bots' gray`);
    assert.ok(contrast(color, ARENA) >= 2.95, `${color} fades into the arena`);
    assert.ok(contrast(color, '#ffffff') >= 2.45, `the HP number is lost on ${color}`);
  }
  assert.ok(contrast(BOT_COLOR, ARENA) >= 3, 'bots can be seen too');
});

test('colours stay easy to tell apart as the group grows', () => {
  const closestPair = (count: number) => {
    const group = colors(count);
    return Math.min(...group.flatMap((color, i) => group.slice(i + 1).map((other) => apart(color, other))));
  };
  assert.ok(closestPair(8) >= 0.15, `8 players: ${closestPair(8)}`);
  assert.ok(closestPair(16) >= 0.1, `16 players: ${closestPair(16)}`);
  assert.ok(closestPair(32) >= 0.07, `32 players: ${closestPair(32)}`);
  assert.ok(closestPair(100) >= 0.04, `100 players: ${closestPair(100)}`);
});

test('the colours come out in the same order whatever is asked first', () => {
  const later = playerColor(40);
  assert.equal(playerColor(40), later);
  assert.equal(colors(41)[40], later);
});
