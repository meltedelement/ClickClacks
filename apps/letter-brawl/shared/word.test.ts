import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SOLVED_PAYS, cleanWord, letterHints, mark, pays, solves } from './word.ts';

const short = (marks: string[]) => marks.map((m) => ({ hit: 'H', near: 'n', miss: '.' })[m]).join('');

test('marks: hits, nears and misses', () => {
  assert.equal(short(mark('crane', 'crane')), 'HHHHH');
  assert.equal(short(mark('slate', 'least')), 'nnHnn');
  assert.equal(short(mark('trace', 'crane')), '.HHnH');
});

test('a repeated letter is near only as often as the answer still has it', () => {
  // answer has one E: the hit takes it, the other E is a miss
  assert.equal(short(mark('geese', 'those')), '...HH');
  // answer has one L, not in place: only the first L is near
  assert.equal(short(mark('llama', 'world')), 'n....');
  // answer has two Ls, both hit: the third L is a miss
  assert.equal(short(mark('lolly', 'hello')), '.nHH.');
});

test('what a guess pays: one per near, two per hit, ten for a solve', () => {
  assert.equal(pays(mark('crane', 'crane')), 10);
  assert.equal(SOLVED_PAYS, 10);
  assert.equal(pays(mark('trace', 'crane')), 3 * 2 + 1);
  assert.equal(pays(mark('slate', 'least')), 4 + 2);
  assert.equal(pays(mark('fuzzy', 'crane')), 0);
  assert.equal(solves(mark('crane', 'crane')), true);
  assert.equal(solves(mark('trace', 'crane')), false);
});

test('cleaning a guess', () => {
  assert.equal(cleanWord(' Crane '), 'crane');
  assert.equal(cleanWord('cran'), null);
  assert.equal(cleanWord('cranes'), null);
  assert.equal(cleanWord('cr4ne'), null);
  assert.equal(cleanWord(undefined), null);
});

test('the keyboard shows the best each letter has been', () => {
  const hints = letterHints([
    { word: 'trace', marks: mark('trace', 'crane') },
    { word: 'clank', marks: mark('clank', 'crane') },
  ]);
  assert.equal(hints.c, 'hit', 'near in one guess, hit in the next');
  assert.equal(hints.t, 'miss');
  assert.equal(hints.n, 'hit');
  assert.equal(hints.z, undefined);
});
