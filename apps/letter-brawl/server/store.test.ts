// A tournament against a made-up tournament service and a made-up dictionary:
// what each guess pays, and when a stage starts. The bracket's own rules are
// tested in apps/bracket, the draft's in the royale, and the marking in shared/word.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Catalog, FighterInput, Match, MatchRequest, MatchResult } from '../../../games/weapon-balls/api/game.d.ts';
import type { GameHost } from '../../royale/server/host.ts';
import type { EntrantState, TournamentRequest } from '../../../contracts/tournament.d.ts';
import type { TournamentService } from '../../bracket/server/tournament.ts';
import type { BracketTournament } from '../shared/types.ts';
import { createLetterBrawl } from './store.ts';
import type { WordSource } from './words.ts';

const upgrade = (id: string) => ({ id, name: id.toUpperCase(), description: `${id}.`, weapons: null, requires: [], excludedBy: [], maxStacks: null });
const catalog: Catalog = {
  weapons: [{ id: 'sword', name: 'Sword' }],
  upgrades: [upgrade('damage'), upgrade('speed'), upgrade('armor'), upgrade('crit')],
  transformations: [upgrade('big'), upgrade('huge'), upgrade('vast')],
};
const formats = [{ id: 'single-elimination' as const, name: 'Single elimination', description: 'Out after one loss.', options: [] }];

function progress(state: EntrantState) {
  return { state, opponent: null, side: null, bracket: null, wins: 0, losses: 0 };
}

function fakeService() {
  let current: BracketTournament | null = null;
  let listener: ((t: BracketTournament | null) => void) | null = null;
  const created: TournamentRequest<FighterInput>[] = [];
  const calls: string[] = [];
  const bump = (change: Partial<BracketTournament>) => (current = { ...current!, ...change, version: current!.version + 1 });
  const service: TournamentService = {
    catalog: async () => catalog,
    formats: async () => formats,
    async create(request) {
      created.push(request);
      calls.push('create');
      current = {
        id: 't1', name: request.name ?? null, format: request.format, version: 1, status: 'waiting', match: request.match ?? {},
        entrants: request.entrants.map((e) => ({ id: e.id, name: e.name, color: e.color ?? null, character: e.character, problems: [], progress: progress('waiting') })),
        stages: [{ index: 0, name: 'Stage 1', status: 'waiting', groups: [] }],
        matches: [], plan: [[], [], []], standings: [], champion: null, note: '',
      } as unknown as BracketTournament;
      return current;
    },
    async patchEntrants(_id, list) {
      calls.push('patch');
      return bump({ entrants: current!.entrants.map((e) => ({ ...e, character: list.find((p) => p.id === e.id)?.character ?? e.character })) });
    },
    async start() {
      calls.push('start');
      return bump({ status: 'playing' });
    },
    async stop() {
      calls.push('stop');
      return bump({ status: 'waiting' });
    },
    async remove() {
      calls.push('remove');
      current = null;
    },
    follow(_id, onUpdate) {
      listener = onUpdate;
    },
  };
  return {
    service,
    created,
    calls,
    // The stage was played; the next one is drawn and waits. `out` are knocked out.
    nextStage(out: string[] = []) {
      const stages = current!.stages;
      listener?.(bump({
        status: 'waiting',
        stages: [...stages, { index: stages.length, name: `Stage ${stages.length + 1}`, status: 'waiting', groups: [] }] as BracketTournament['stages'],
        entrants: current!.entrants.map((e) => ({ ...e, progress: progress(out.includes(e.id) ? 'out' : 'waiting') })),
      }));
    },
    finish(champion: string) {
      listener?.(bump({ status: 'done', champion, standings: [], entrants: current!.entrants.map((e) => ({ ...e, progress: progress(e.id === champion ? 'champion' : 'out') })) }));
    },
  };
}

// The game, for the royale at the end: holds each match until the test finishes it.
function fakeHost() {
  const queued: MatchRequest[] = [];
  const cancelled: string[] = [];
  const waiting = new Map<string, (m: Match) => void>();
  const host: GameHost = {
    catalog: async () => catalog,
    async queue(request) {
      queued.push(request);
      return { id: `m${queued.length}`, status: 'queued' } as unknown as Match;
    },
    wait: (id) => new Promise((resolve) => waiting.set(id, resolve)),
    async cancel(id) {
      cancelled.push(id);
      waiting.get(id)?.({ id, status: 'cancelled', result: null } as unknown as Match);
    },
  };
  return {
    host,
    queued,
    cancelled,
    finish(id: string, ranking: number[]) {
      waiting.get(id)!({ id, status: 'done', result: { winner: ranking[0], reason: 'ko', ranking, time: 42 } as unknown as MatchResult } as unknown as Match);
    },
  };
}

const fakeWords = (answer: string): WordSource => ({
  answer: async () => answer,
  isWord: async (word) => !word.startsWith('x'),
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// Starts a tournament. Unless `firstBreak` is false, everyone guesses FUZZY (no
// letters of CRANE, so it pays nothing) and stage 1 starts.
async function setup(guessMs = 60_000, firstBreak = true) {
  const fake = fakeService();
  const gameHost = fakeHost();
  const game = createLetterBrawl({ service: fake.service, host: gameHost.host, words: fakeWords('crane'), onChange: () => {}, arenaHoldMs: 0, royaleDelayMs: 5, royaleHoldMs: 0, guessMs, random: () => 0 });
  game.setCatalog(catalog);
  game.setFormats(formats);
  const [ana, ben, cy] = ['Ana', 'Ben', 'Cy'].map((name) => game.findPlayer(game.join(name))!);
  await game.startTournament();
  await tick();
  if (firstBreak) {
    for (const p of [ana, ben, cy]) await game.guess(p, 'fuzzy');
    await tick();
  }
  return { fake, gameHost, game, ana, ben, cy };
}

const pickAll = (game: Awaited<ReturnType<typeof setup>>['game'], ...players: Awaited<ReturnType<typeof setup>>['ana'][]) => {
  for (const p of players) while (!game.playerView(p).draft.finished) game.takePick(p, game.playerView(p).draft.offer[0].id);
};

test('everyone starts with a weapon and one transformation, then one guess before stage 1', async () => {
  const { fake, game, ana, ben, cy } = await setup(60_000, false);
  assert.equal(fake.created[0].name, 'Letter Brawl');
  for (const e of fake.created[0].entrants) assert.equal((e.character.transformations as string[]).length, 1);
  assert.deepEqual(fake.calls, ['create'], 'stage 1 waits for the guesses');
  let view = game.playerView(ana);
  assert.equal(view.phase, 'picking');
  assert.equal(view.word!.status, 'guessing');
  assert.equal(view.bracket!.stage, 1);

  await game.guess(ana, 'trace'); // .HHnH: 7 upgrades, picked before stage 1
  view = game.playerView(ana);
  assert.deepEqual(view.word!.earned, { upgrades: 7, transformation: false });
  assert.equal(view.draft.picksTotal, 1 + 7);
  pickAll(game, ana);
  await game.guess(ben, 'fuzzy');
  await game.guess(cy, 'fuzzy');
  await tick();
  assert.deepEqual(fake.calls, ['create', 'patch', 'start']);
  assert.equal(game.playerView(ana).draft.picks.reduce((n, p) => n + p.count, 0), 1 + 7, 'the transformation and the 7 upgrades go into stage 1');
  assert.equal(game.playerView(ana).word!.status, 'waiting');
  await assert.rejects(game.guess(ana, 'crane'), /between stages/);
});

test('a break: one guess each, paid in upgrades, and the stage starts once all have guessed and picked', async () => {
  const { fake, game, ana, ben, cy } = await setup();
  fake.nextStage([cy.id]);
  assert.equal(game.playerView(ana).phase, 'picking');
  assert.equal(game.playerView(ana).word!.status, 'guessing');
  assert.equal(game.playerView(cy).word!.status, 'waiting', 'out: no guess');
  assert.equal(game.playerView(ana).draft.finished, true, 'nothing to pick until the guess');

  await assert.rejects(game.guess(ana, 'cran'), /five letters/);
  await assert.rejects(game.guess(ana, 'xylox'), /isn't in the word list/);
  await game.guess(ana, 'TRACE'); // .HHnH: 3 hits and a near
  const view = game.playerView(ana);
  assert.equal(view.word!.status, 'guessed');
  assert.deepEqual(view.word!.guesses.at(-1)!.marks, ['miss', 'hit', 'hit', 'near', 'hit']);
  assert.deepEqual(view.word!.earned, { upgrades: 7, transformation: false });
  assert.equal(view.word!.answer, null);
  assert.equal(view.draft.picksTotal, 1 + 7);
  assert.equal(view.draft.kind, 'upgrade');
  await assert.rejects(game.guess(ana, 'crane'), /One guess per break/);

  pickAll(game, ana);
  await tick();
  assert.equal(fake.calls.length, 3, 'Ben has not guessed: the stage waits');
  assert.equal(game.adminView([]).players.find((p) => p.id === ben.id)!.ready, false);
  await game.guess(ben, 'fuzzy'); // pays nothing
  assert.equal(game.playerView(ben).draft.finished, true);
  await tick();
  assert.deepEqual(fake.calls.slice(3), ['patch', 'start'], 'all guessed and picked: it starts');
  assert.equal(game.playerView(ana).word!.status, 'waiting');
});

test('solving pays a transformation and ten upgrades, then ten every break with no more guessing', async () => {
  const { fake, game, ana, ben } = await setup();
  fake.nextStage();
  await game.guess(ana, 'crane');
  let view = game.playerView(ana);
  assert.equal(view.word!.status, 'solved');
  assert.equal(view.word!.answer, 'crane');
  assert.deepEqual(view.word!.earned, { upgrades: 10, transformation: true });
  assert.equal(view.draft.kind, 'transformation', 'the transformation is picked first');
  assert.equal(view.draft.bonus, true);
  assert.equal(view.draft.picksTotal, 1 + 1 + 10);
  assert.equal(game.playerView(ben).word!.answer, null, 'only the solver sees it');
  pickAll(game, ana);
  await game.guess(ben, 'fuzzy');
  await tick();

  fake.nextStage();
  view = game.playerView(ana);
  assert.equal(view.word!.status, 'solved');
  assert.deepEqual(view.word!.earned, { upgrades: 10, transformation: false });
  assert.equal(view.draft.picksTotal, 12 + 10);
  await assert.rejects(game.guess(ana, 'crane'), /already solved/);
  pickAll(game, ana);
  assert.equal(game.playerView(ana).draft.picks.reduce((n, p) => n + p.count, 0), 22);
  const transformations = game.adminView([]).players.find((p) => p.id === ana.id)!;
  assert.equal(transformations.picksDone, 22);
});

test('time runs out: whoever has not guessed misses the break, and the stage starts', async () => {
  const { fake, game, ana, ben } = await setup(30);
  fake.nextStage();
  await game.guess(ana, 'fuzzy');
  assert.equal(game.adminView([]).guessMsLeft! > 0, true);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(game.playerView(ben).word!.status, 'waiting', 'the stage started');
  assert.deepEqual(fake.calls.slice(3), ['patch', 'start']);
  await assert.rejects(game.guess(ben, 'crane'), /between stages/);
});

test('the host can start the stage before everyone guesses', async () => {
  const { fake, game, ben } = await setup();
  fake.nextStage();
  game.startStage();
  await tick();
  assert.equal(fake.calls.at(-1), 'start');
  await assert.rejects(game.guess(ben, 'crane'));
});

test('the answer shows to everyone once the tournament is over, and the lobby has no word', async () => {
  const { fake, game, ana, ben } = await setup();
  fake.nextStage();
  await game.guess(ana, 'fuzzy');
  assert.equal(game.adminView([]).answer, null, 'not on the host screen during the tournament');
  fake.finish(ben.id);
  assert.equal(game.playerView(ana).phase, 'done');
  assert.equal(game.playerView(ana).word!.answer, 'crane');
  assert.equal(game.adminView([]).answer, 'crane');
  await game.endTournament();
  assert.equal(game.playerView(ana).word, null);
});

test('the tournament ends with a royale of everyone, out or not, and its own winner', async () => {
  const { fake, gameHost, game, ana, ben, cy } = await setup();
  fake.nextStage([cy.id]);
  for (const p of [ana, ben]) await game.guess(p, 'fuzzy');
  await tick();
  fake.finish(ben.id);
  let view = game.playerView(ana);
  assert.equal(view.bracket!.champion!.id, ben.id);
  assert.equal(view.royale!.status, 'soon');
  assert.equal(view.royale!.balls, 3);
  assert.equal(view.arena, null, 'the arena waits for the royale');
  assert.equal(gameHost.queued.length, 0);

  await tick();
  assert.equal(gameHost.queued.length, 1);
  const request = gameHost.queued[0];
  assert.equal(request.settings!.royale, true);
  assert.deepEqual(request.characters.map((c) => c.name).sort(), ['Ana', 'Ben', 'Cy'], 'Cy was knocked out, and fights too');
  const slot = request.characters.findIndex((c) => c.name === 'Ana');
  view = game.playerView(ana);
  assert.equal(view.royale!.status, 'fighting');
  assert.equal(view.arena, `/game/?display&embed&follow=${slot}`, 'each phone follows its own ball');
  assert.equal(game.adminView([]).arena, '/game/?display&embed');

  const cySlot = request.characters.findIndex((c) => c.name === 'Cy');
  gameHost.finish('m1', [cySlot, ...[0, 1, 2].filter((i) => i !== cySlot)]);
  await tick();
  view = game.playerView(ana);
  assert.equal(view.royale!.status, 'done');
  assert.equal(view.royale!.winner!.id, cy.id, 'the royale winner is not the champion');
  assert.equal(view.bracket!.champion!.id, ben.id);
  assert.equal(view.royale!.places.length, 3);
  assert.equal(view.royale!.places[0].build[0], 'Sword');
  assert.equal(view.arena, null);
  assert.equal(game.adminView([]).royale!.winner!.name, 'Cy');

  await game.endTournament();
  assert.equal(game.playerView(ana).royale, null);
});

test('a new tournament cancels a royale still fighting', async () => {
  const { fake, gameHost, game, ana, ben } = await setup();
  fake.finish(ana.id);
  await tick();
  assert.equal(game.playerView(ben).royale!.status, 'fighting');
  await game.endTournament();
  assert.deepEqual(gameHost.cancelled, ['m1']);
  assert.equal(game.playerView(ben).royale, null);
});
