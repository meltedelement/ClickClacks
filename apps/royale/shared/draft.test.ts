import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Catalog, CatalogUpgrade } from '../../../games/weapon-balls/api/game.d.ts';
import { FULL_DRAFT, OFFER_SIZE, botDraft, chooseWeapon, finishDraft, growDraft, isFinished, kindAt, newDraft, options, pick, sample, shuffle, stack } from './draft.ts';

function upgrade(id: string, more: Partial<CatalogUpgrade> = {}): CatalogUpgrade {
  return { id, name: id, description: `${id}.`, weapons: null, requires: [], excludedBy: [], maxStacks: null, ...more };
}

const catalog: Catalog = {
  weapons: [
    { id: 'sword', name: 'Sword' },
    { id: 'mace', name: 'Mace' },
  ],
  upgrades: [
    upgrade('damage'),
    upgrade('speed'),
    upgrade('once', { maxStacks: 1 }),
    upgrade('sword-only', { weapons: ['sword'] }),
    upgrade('mace-only', { weapons: ['mace'] }),
    upgrade('needs-big', { requires: ['big'] }),
    upgrade('not-with-big', { excludedBy: ['big'] }),
  ],
  transformations: [upgrade('big', { weapons: ['sword'], maxStacks: 1 }), upgrade('heavy', { weapons: ['mace'], maxStacks: 1 })],
};

// A repeatable random source.
function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

test('a draft starts with a weapon, then offers the steps in order', () => {
  const random = seeded();
  let draft = newDraft();
  assert.deepEqual(draft.offer, []);
  draft = chooseWeapon(draft, 'sword', catalog, random);
  assert.equal(kindAt(draft.step), 'transformation');
  assert.deepEqual(draft.offer, ['big']);
  draft = pick(draft, 'big', catalog, random);
  assert.equal(kindAt(draft.step), 'upgrade');
  assert.deepEqual(draft.transformations, ['big']);
  assert.equal(draft.offer.length, OFFER_SIZE);
});

test('an offer never holds the same thing twice', () => {
  const random = seeded(7);
  for (let i = 0; i < 200; i++) {
    const draft = pick(chooseWeapon(newDraft(), 'sword', catalog, random), 'big', catalog, random);
    assert.equal(new Set(draft.offer).size, draft.offer.length);
  }
});

test('options follow the weapon, stack limits, requirements and exclusions', () => {
  const sword = { ...newDraft(), weapon: 'sword' };
  const ids = (d: typeof sword) => options(d, 'upgrade', catalog).map((u) => u.id);
  assert.ok(ids(sword).includes('sword-only'));
  assert.ok(!ids(sword).includes('mace-only'));
  assert.ok(!ids(sword).includes('needs-big'));
  assert.ok(ids(sword).includes('not-with-big'));
  const big = { ...sword, transformations: ['big'] };
  assert.ok(ids(big).includes('needs-big'));
  assert.ok(!ids(big).includes('not-with-big'));
  assert.ok(!ids({ ...sword, upgrades: ['once'] }).includes('once'));
  assert.ok(ids({ ...sword, upgrades: ['damage'] }).includes('damage'), 'upgrades stack');
});

test('only what is on offer can be picked, and a weapon only once', () => {
  const random = seeded();
  const draft = chooseWeapon(newDraft(), 'sword', catalog, random);
  assert.throws(() => pick(draft, 'heavy', catalog, random), /not on offer/);
  assert.throws(() => chooseWeapon(draft, 'mace', catalog, random), /already/);
  assert.throws(() => chooseWeapon(newDraft(), 'axe', catalog, random), /no such weapon/);
});

test('a step with nothing to offer is skipped', () => {
  const noTransformations: Catalog = { ...catalog, transformations: [] };
  const draft = chooseWeapon(newDraft(), 'sword', noTransformations, seeded());
  assert.equal(draft.step, 1);
  const nothing: Catalog = { ...catalog, transformations: [], upgrades: [] };
  assert.ok(isFinished(chooseWeapon(newDraft(), 'sword', nothing, seeded())));
});

test('finishDraft completes any draft with a legal build', () => {
  const random = seeded(3);
  for (let i = 0; i < 200; i++) {
    const draft = finishDraft(newDraft(), catalog, random);
    assert.ok(isFinished(draft));
    assert.equal(draft.transformations.length, 1);
    assert.equal(draft.upgrades.length, FULL_DRAFT - 1);
    assert.ok(draft.upgrades.filter((id) => id === 'once').length <= 1);
    assert.ok(!draft.upgrades.includes(draft.weapon === 'sword' ? 'mace-only' : 'sword-only'));
  }
  // A finished draft is left as it is, and one part way through keeps its picks.
  const partway = chooseWeapon(newDraft(), 'mace', catalog, random);
  assert.equal(finishDraft(partway, catalog, random).weapon, 'mace');
  const finished = finishDraft(newDraft(), catalog, random);
  assert.deepEqual(finishDraft(finished, catalog, random), finished);
});

test('a bot gets a full set of small upgrades and no transformation', () => {
  const random = seeded(5);
  for (let i = 0; i < 200; i++) {
    const draft = botDraft(catalog, random);
    assert.ok(isFinished(draft));
    assert.deepEqual(draft.transformations, []);
    assert.equal(draft.upgrades.length, FULL_DRAFT - 1);
    assert.ok(!draft.upgrades.includes('needs-big'), 'nothing that needs a transformation');
  }
});

test('a draft can grow one pick at a time and keeps what it has', () => {
  const random = seeded(11);
  let draft = chooseWeapon(newDraft(1), 'sword', catalog, random);
  assert.equal(kindAt(draft.step), 'transformation');
  draft = pick(draft, 'big', catalog, random);
  assert.ok(isFinished(draft), 'one pick is all it has for now');
  assert.deepEqual(draft.offer, []);

  draft = growDraft(draft, 2, catalog, random);
  assert.ok(!isFinished(draft));
  assert.equal(draft.step, 1);
  assert.equal(draft.offer.length, OFFER_SIZE);
  const chosen = draft.offer[0];
  draft = pick(draft, chosen, catalog, random);
  assert.ok(isFinished(draft));
  assert.equal(draft.weapon, 'sword');
  assert.deepEqual(draft.transformations, ['big']);
  assert.deepEqual(draft.upgrades, [chosen]);

  // Someone who hasn't chosen a weapon just has more picks ahead, from the first.
  const late = growDraft(newDraft(1), 3, catalog, random);
  assert.equal(late.length, 3);
  assert.equal(late.step, 0);
  assert.deepEqual(late.offer, []);

  // With nothing left to offer, a grown draft is simply finished.
  const nothing: Catalog = { ...catalog, transformations: [], upgrades: [] };
  assert.ok(isFinished(growDraft(chooseWeapon(newDraft(1), 'sword', nothing, random), 2, nothing, random)));
});

test('a short bot draft has as many upgrades as a player of that length', () => {
  const random = seeded(13);
  assert.deepEqual(botDraft(catalog, random, 1).upgrades, []);
  assert.equal(botDraft(catalog, random, 4).upgrades.length, 3);
});

test('sample and shuffle keep every item at most once', () => {
  const list = [1, 2, 3, 4, 5];
  assert.deepEqual(shuffle(list, seeded()).sort(), list);
  assert.equal(sample(list, 2, seeded()).length, 2);
  assert.equal(sample(list, 9, seeded()).length, 5);
  assert.deepEqual(list, [1, 2, 3, 4, 5], 'the input is untouched');
});

test('stack combines repeated picks in the order first taken', () => {
  assert.deepEqual(stack(['a', 'b', 'a', 'c', 'a']), [
    { id: 'a', count: 3 },
    { id: 'b', count: 1 },
    { id: 'c', count: 1 },
  ]);
});
