// The draft: pick a weapon, then take one of a few offers at each step. Pure and
// free of I/O. What fits what comes from the game's catalog, so a new weapon or
// upgrade in the game shows up here by itself. The game still checks every build
// when the match is queued.
import type { Catalog, CatalogUpgrade } from '../../../games/weapon-balls/api/game.d.ts';

export type StepKind = 'transformation' | 'upgrade';

// How many picks a whole draft has when builds start fresh each round. In build-up
// mode a draft starts shorter and grows by one pick a round (growDraft).
export const FULL_DRAFT = 5;
export const OFFER_SIZE = 3;
// Upgrades have no stack limit, but each copy owned makes another one rarer: an
// upgrade's chance to be offered is multiplied by this for every copy you have.
export const REPEAT_WEIGHT = 0.5;

// The order of the picks. The transformation goes first because it decides what
// the weapon is: some upgrades only work with one, and some stop working with one.
// A draft can have more transformation picks later (`transformationSteps`): the
// bracket gives one to everyone who gets far.
export function kindAt(step: number, draft?: Pick<Draft, 'transformationSteps'>): StepKind {
  return step === 0 || (draft?.transformationSteps ?? []).includes(step) ? 'transformation' : 'upgrade';
}

export interface Draft {
  weapon: string | null;
  transformations: string[];
  upgrades: string[];
  length: number; // how many steps this draft has for now
  step: number; // the current step; `length` when finished
  offer: string[]; // what can be picked now, empty before a weapon is chosen and when finished
  /** Steps after the first that offer a transformation instead of an upgrade. */
  transformationSteps?: number[];
}

export type Random = () => number;

export function newDraft(length = FULL_DRAFT): Draft {
  return { weapon: null, transformations: [], upgrades: [], length, step: 0, offer: [] };
}

export function isFinished(draft: Draft): boolean {
  return draft.weapon !== null && draft.step >= draft.length;
}

// What this draft could take at a step of this kind: the same rules the game
// applies, plus leaving out what something already owned makes useless.
export function options(draft: Draft, kind: StepKind, catalog: Catalog): CatalogUpgrade[] {
  const owned = [...draft.transformations, ...draft.upgrades];
  const list = kind === 'transformation' ? catalog.transformations : catalog.upgrades;
  return list.filter(
    (u) =>
      (!u.weapons || u.weapons.includes(draft.weapon ?? '')) &&
      (u.maxStacks === null || owned.filter((id) => id === u.id).length < u.maxStacks) &&
      u.requires.every((id) => owned.includes(id)) &&
      !u.excludedBy.some((id) => owned.includes(id)),
  );
}

// Moves on to the first step from `step` that has anything to offer.
function offerFrom(draft: Draft, step: number, catalog: Catalog, random: Random): Draft {
  for (let i = step; i < draft.length; i++) {
    const available = options(draft, kindAt(i, draft), catalog);
    if (available.length > 0) {
      const owned = [...draft.transformations, ...draft.upgrades];
      const weights = available.map((u) => Math.pow(REPEAT_WEIGHT, owned.filter((id) => id === u.id).length));
      return { ...draft, step: i, offer: weightedSample(available, weights, OFFER_SIZE, random).map((u) => u.id) };
    }
  }
  return { ...draft, step: draft.length, offer: [] };
}

export function chooseWeapon(draft: Draft, weapon: string, catalog: Catalog, random: Random): Draft {
  if (draft.weapon !== null) throw new Error('You already chose a weapon');
  if (!catalog.weapons.some((w) => w.id === weapon)) throw new Error('There is no such weapon');
  return offerFrom({ ...draft, weapon }, 0, catalog, random);
}

export function pick(draft: Draft, id: string, catalog: Catalog, random: Random): Draft {
  if (!draft.offer.includes(id)) throw new Error('That is not on offer');
  const kind = kindAt(draft.step, draft);
  const picked: Draft =
    kind === 'transformation'
      ? { ...draft, transformations: [...draft.transformations, id] }
      : { ...draft, upgrades: [...draft.upgrades, id] };
  return offerFrom(picked, draft.step + 1, catalog, random);
}

// Gives a draft more steps, keeping what it has: the next offer is ready straight
// away if a weapon has been chosen, or comes when one is.
export function growDraft(draft: Draft, length: number, catalog: Catalog, random: Random): Draft {
  const longer = { ...draft, length };
  return draft.weapon === null ? longer : offerFrom(longer, draft.step, catalog, random);
}

// Makes the draft's next new step (its current length) a transformation pick.
// Grow it afterwards to give that step, and any more, a place.
export function withTransformationNext(draft: Draft): Draft {
  return { ...draft, transformationSteps: [...(draft.transformationSteps ?? []), draft.length] };
}

// Fills in whatever is left of a draft at random: for someone who hasn't finished
// when the round starts, and for bots.
export function finishDraft(draft: Draft, catalog: Catalog, random: Random): Draft {
  let current = draft;
  if (current.weapon === null) current = chooseWeapon(current, sample(catalog.weapons, 1, random)[0].id, catalog, random);
  while (!isFinished(current)) current = pick(current, sample(current.offer, 1, random)[0], catalog, random);
  return current;
}

// A bot's build: a random weapon and the small upgrades only. With no transformation
// on offer that step is skipped, and so is anything that requires one.
export function botDraft(catalog: Catalog, random: Random, length = FULL_DRAFT): Draft {
  return finishDraft(newDraft(length), { ...catalog, transformations: [] }, random);
}

// Repeated picks as one entry each, with how many there are, in the order first taken.
export function stack(ids: readonly string[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count }));
}

// `count` different items in a random order (fewer if the list is shorter).
export function sample<T>(list: readonly T[], count: number, random: Random): T[] {
  const pool = [...list];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// Like `sample`, but each item is drawn in proportion to its weight. With equal
// weights it draws exactly what `sample` would from the same random numbers.
export function weightedSample<T>(list: readonly T[], weights: readonly number[], count: number, random: Random): T[] {
  const pool = [...list];
  const w = [...weights];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    let total = 0;
    for (let k = i; k < pool.length; k++) total += w[k];
    let r = random() * total;
    let j = i;
    while (j < pool.length - 1 && r >= w[j]) r -= w[j++];
    [pool[i], pool[j]] = [pool[j], pool[i]];
    [w[i], w[j]] = [w[j], w[i]];
  }
  return pool.slice(0, count);
}

export function shuffle<T>(list: readonly T[], random: Random): T[] {
  return sample(list, list.length, random);
}
