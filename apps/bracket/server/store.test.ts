// A tournament against a made-up tournament service: what the app sends it, and
// how builds grow between stages. The draft's own rules are tested in the royale
// (apps/royale/shared/draft.test.ts), and the formats in tournament/formats.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Catalog, FighterInput } from '../../../games/weapon-balls/api/game.d.ts';
import type { EntrantPatch, EntrantState, TournamentRequest } from '../../../contracts/tournament.d.ts';
import type { BracketTournament } from '../shared/types.ts';
import { START_PICKS, createBracket } from './store.ts';
import type { TournamentService } from './tournament.ts';

const upgrade = (id: string) => ({ id, name: id.toUpperCase(), description: `${id}.`, weapons: null, requires: [], excludedBy: [], maxStacks: null });
const catalog: Catalog = {
  weapons: [
    { id: 'sword', name: 'Sword' },
    { id: 'mace', name: 'Mace' },
  ],
  upgrades: [upgrade('damage'), upgrade('speed'), upgrade('armor'), upgrade('crit')],
  transformations: [upgrade('big'), upgrade('huge')],
};
const formats = [{ id: 'single-elimination' as const, name: 'Single elimination', description: 'Out after one loss.', options: [] }];

// A tournament service that holds one tournament and changes it only when told:
// by the app's calls, or by the test standing in for its matches being played.
function fakeService() {
  let current: BracketTournament | null = null;
  let listener: ((t: BracketTournament | null) => void) | null = null;
  const created: TournamentRequest<FighterInput>[] = [];
  const patches: EntrantPatch<FighterInput>[][] = [];
  const calls: string[] = [];

  function bump(change: Partial<BracketTournament>): BracketTournament {
    current = { ...current!, ...change, version: current!.version + 1 };
    return current;
  }

  const service: TournamentService = {
    catalog: async () => catalog,
    formats: async () => formats,
    async create(request) {
      created.push(request);
      calls.push('create');
      current = {
        id: 't1',
        name: request.name ?? null,
        format: request.format,
        version: 1,
        status: 'waiting',
        match: request.match ?? {},
        entrants: request.entrants.map((e) => ({ id: e.id, name: e.name, color: e.color ?? null, character: e.character, problems: [], progress: progress('waiting') })),
        stages: [{ index: 0, name: 'Stage 1', status: 'waiting', groups: [] }],
        matches: [],
        plan: [[], []],
        standings: [],
        champion: null,
        note: '',
      } as unknown as BracketTournament;
      return current;
    },
    async patchEntrants(_id, list) {
      patches.push(list);
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
    patches,
    calls,
    current: () => current!,
    // The service's event stream: the tournament moved on.
    push(change: Partial<BracketTournament>) {
      listener?.(bump(change));
    },
  };
}

function progress(state: EntrantState) {
  return { state, opponent: null, side: null, bracket: null, wins: 0, losses: 0 };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup() {
  const fake = fakeService();
  const bracket = createBracket({ service: fake.service, onChange: () => {}, arenaHoldMs: 0, random: () => 0 });
  bracket.setCatalog(catalog);
  bracket.setFormats(formats);
  const tokens = ['Ana', 'Ben', 'Cy'].map((name) => bracket.join(name));
  const players = tokens.map((token) => bracket.findPlayer(token)!);
  return { fake, bracket, tokens, players };
}

test('a tournament: shared 1v1s, one more pick per stage for those still in, a champion', async () => {
  const { fake, bracket, players } = setup();
  const [ana, ben, cy] = players;
  bracket.takeWeapon(ana, 'sword');
  bracket.takePick(ana, bracket.playerView(ana).draft.offer[0].id);
  assert.equal(bracket.playerView(ana).draft.finished, true);

  await bracket.startTournament();
  await tick();
  const [request] = fake.created;
  assert.deepEqual(request.match, { shared: true });
  assert.equal(request.format, 'single-elimination');
  assert.equal(request.entrants.length, 3);
  // Ben and Cy hadn't drafted: they got a weapon and a transformation at random.
  for (const entrant of request.entrants) {
    assert.ok(entrant.character.weapon);
    assert.equal((entrant.character.transformations as string[]).length, START_PICKS);
  }
  assert.deepEqual(fake.calls, ['create', 'patch', 'start']);
  assert.equal(bracket.playerView(ana).phase, 'playing');
  assert.equal(bracket.playerView(ana).arena, '/game/?display&embed');

  // Stage 1 is played: Cy is out. Stage 2 is drawn and waits.
  fake.push({
    status: 'waiting',
    stages: [...fake.current().stages, { index: 1, name: 'Stage 2', status: 'waiting', groups: [] }],
    entrants: fake.current().entrants.map((e) => ({ ...e, progress: progress(e.id === cy.id ? 'out' : 'waiting') })),
  });
  // Two of three are still in: the top half. A second transformation first, then the stage's upgrade.
  assert.equal(bracket.playerView(ana).phase, 'picking');
  assert.equal(bracket.playerView(ana).draft.picksTotal, START_PICKS + 2);
  assert.equal(bracket.playerView(ana).draft.kind, 'transformation');
  assert.equal(bracket.playerView(ana).draft.bonus, true);
  assert.equal(bracket.playerView(cy).draft.finished, true, 'nothing to pick once out');

  bracket.takePick(ana, bracket.playerView(ana).draft.offer[0].id);
  assert.equal(bracket.playerView(ana).draft.kind, 'upgrade');
  assert.equal(bracket.playerView(ana).draft.bonus, false);
  bracket.takePick(ana, bracket.playerView(ana).draft.offer[0].id);
  await tick();
  assert.equal(fake.calls.at(-1), 'start', 'not started again yet: still the first start');
  assert.equal(fake.calls.length, 3);
  bracket.takePick(ben, bracket.playerView(ben).draft.offer[0].id);
  bracket.takePick(ben, bracket.playerView(ben).draft.offer[0].id);
  await tick();
  assert.deepEqual(fake.calls.slice(3), ['patch', 'start'], 'everyone has picked: the stage starts by itself');
  const sent = fake.patches.at(-1)!.find((p) => p.id === ana.id)!;
  assert.equal((sent.character!.transformations as string[]).length, 2);
  assert.equal((sent.character!.upgrades as string[]).length, 1);

  fake.push({
    status: 'done',
    champion: ana.id,
    standings: [{ entrant: ana.id, rank: 1, wins: 2, losses: 0, points: 2 }],
    entrants: fake.current().entrants.map((e) => ({ ...e, progress: progress(e.id === ana.id ? 'champion' : 'out') })),
  });
  const view = bracket.playerView(ana);
  assert.equal(view.phase, 'done');
  assert.equal(view.you.titles, 1);
  assert.equal(view.bracket!.champion!.name, 'Ana');
  assert.deepEqual(view.bracket!.standings[0].build.slice(0, 1), ['Sword']);

  await bracket.endTournament();
  assert.equal(fake.calls.at(-1), 'remove');
  assert.equal(bracket.playerView(ana).phase, 'lobby');
  assert.equal(bracket.playerView(ana).draft.weapon, null, 'a new build for the next tournament');
  assert.equal(bracket.playerView(ana).you.titles, 1, 'titles are kept');
});

test('a stage the host stopped waits for the host to start it again', async () => {
  const { fake, bracket } = setup();
  await bracket.startTournament();
  await tick();
  await bracket.stopStage();
  await tick();
  assert.equal(fake.calls.at(-1), 'stop');
  assert.equal(bracket.adminView([]).phase, 'picking');
  bracket.startStage();
  await tick();
  assert.equal(fake.calls.at(-1), 'start');
  assert.equal(bracket.adminView([]).phase, 'playing');
});

test('someone joining mid-tournament watches, and drafts for the next one', async () => {
  const { bracket } = setup();
  await bracket.startTournament();
  await tick();
  const late = bracket.findPlayer(bracket.join('Dee'))!;
  const view = bracket.playerView(late);
  assert.equal(view.progress, null);
  assert.equal(view.phase, 'playing');
  bracket.takeWeapon(late, 'mace');
  assert.equal(bracket.playerView(late).draft.weapon!.name, 'Mace');
});

test('a tournament needs two players', async () => {
  const fake = fakeService();
  const bracket = createBracket({ service: fake.service, onChange: () => {} });
  bracket.setCatalog(catalog);
  bracket.setFormats(formats);
  bracket.join('Solo');
  await assert.rejects(bracket.startTournament(), /two players/);
});

test('the round on now, and which match of it', async () => {
  const { fake, bracket, players } = setup();
  const [ana, ben, cy] = players;
  await bracket.startTournament();
  await tick();
  const match = (id: string, side: string, a: string, b: string, status: string) => ({ id, stage: 0, side, entrants: [a, b], status, winner: null, decidedBy: null });
  fake.push({
    stages: [{ index: 0, name: 'Stage 1', status: 'playing', groups: [
      { side: 'winners', name: 'Winners semi-finals', entrants: [ana.id, ben.id, cy.id], bye: cy.id },
      { side: 'losers', name: 'Losers round 1', entrants: [], bye: null, pending: true },
    ] }],
    matches: [match('m1', 'winners', ana.id, ben.id, 'done'), match('m2', 'winners', cy.id, ana.id, 'playing')],
  } as unknown as Partial<BracketTournament>);
  const view = bracket.playerView(ana).bracket!;
  assert.equal(view.round, 'Winners semi-finals');
  assert.deepEqual(view.roundMatch, { n: 2, of: 2 });
  assert.equal(view.now!.round, 'Winners semi-finals');

  // Between stages nothing is on: the banner names what the stage will play.
  fake.push({ status: 'waiting', matches: [match('m1', 'winners', ana.id, ben.id, 'done'), match('m2', 'winners', cy.id, ana.id, 'done')] } as unknown as Partial<BracketTournament>);
  assert.equal(bracket.playerView(ana).bracket!.round, 'Losers round 1');
  assert.equal(bracket.playerView(ana).bracket!.roundMatch, null);
});

test('a match that just ended gets a winner card for a few seconds', async () => {
  const fake = fakeService();
  const bracket = createBracket({ service: fake.service, onChange: () => {}, winCardMs: 40, random: () => 0 });
  bracket.setCatalog(catalog);
  bracket.setFormats(formats);
  const [ana, ben] = ['Ana', 'Ben'].map((name) => bracket.findPlayer(bracket.join(name))!);
  await bracket.startTournament();
  await tick();
  const stages = [{ index: 0, name: 'Stage 1', status: 'playing', groups: [{ side: 'main', name: 'Final', entrants: [ana.id, ben.id], bye: null }] }];
  const match = { id: 'm1', stage: 0, side: 'main', entrants: [ana.id, ben.id], status: 'playing', winner: null, decidedBy: null, result: null };
  fake.push({ stages, matches: [match] } as unknown as Partial<BracketTournament>);
  assert.equal(bracket.playerView(ana).bracket!.justWon, null);

  fake.push({ matches: [{ ...match, status: 'done', winner: ben.id, decidedBy: 'ko', result: { time: 41.6, hp: [0, 33.2] } }] } as unknown as Partial<BracketTournament>);
  const card = bracket.playerView(ana).bracket!.justWon!;
  assert.equal(card.winner.name, 'Ben');
  assert.equal(card.loser.name, 'Ana');
  assert.equal(card.round, 'Final');
  assert.equal(card.how, 'ko');
  assert.equal(card.seconds, 41.6);
  assert.equal(card.hpLeft, 33.2);

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(bracket.playerView(ana).bracket!.justWon, null, 'gone after its few seconds');
});

test('the host can dress up a player: colour, skin and tag go with their build', async () => {
  const { fake, bracket, players } = setup();
  const [ana] = players;
  bracket.setLook(ana.id, { skin: 'gold', tag: 'DEV', color: '#123456' });
  const entry = bracket.adminView([]).players[0];
  assert.deepEqual([entry.skin, entry.tag, entry.color], ['gold', 'DEV', '#123456']);
  await bracket.startTournament();
  await tick();
  const looks = fake.created[0].entrants.map((e) => [e.name, e.character.skin ?? null, e.character.tag ?? null]);
  assert.deepEqual(looks, [['Ana', 'gold', 'DEV'], ['Ben', null, null], ['Cy', null, null]]);
  assert.equal(fake.created[0].entrants[0].character.color, '#123456');
});

test('the second transformation comes once, when the field is down to its top half', async () => {
  const fake = fakeService();
  const bracket = createBracket({ service: fake.service, onChange: () => {}, random: () => 0 });
  bracket.setCatalog(catalog);
  bracket.setFormats(formats);
  const players = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => bracket.findPlayer(bracket.join(name))!);
  await bracket.startTournament();
  await tick();
  const toStage = (index: number, outCount: number) => {
    fake.push({
      status: 'waiting',
      stages: [...fake.current().stages, { index, name: `Stage ${index + 1}`, status: 'waiting', groups: [] }],
      entrants: fake.current().entrants.map((e, i) => ({ ...e, progress: progress(i < outCount ? 'out' : 'waiting') })),
    });
  };
  const stillIn = players[5];
  const pickAll = async () => {
    for (const p of players) while (!bracket.playerView(p).draft.finished) bracket.takePick(p, bracket.playerView(p).draft.offer[0].id);
    await tick();
  };

  toStage(1, 2); // 4 of 6 still in: not yet
  assert.equal(bracket.playerView(stillIn).draft.kind, 'upgrade');
  assert.equal(bracket.playerView(stillIn).draft.picksTotal, START_PICKS + 1);
  await pickAll();

  toStage(2, 3); // 3 of 6: the top half
  assert.equal(bracket.playerView(stillIn).draft.bonus, true);
  assert.equal(bracket.playerView(stillIn).draft.picksTotal, START_PICKS + 3);
  await pickAll();

  toStage(3, 4); // still in the top half, but it only comes once
  assert.equal(bracket.playerView(stillIn).draft.kind, 'upgrade');
  assert.equal(bracket.playerView(stillIn).draft.picksTotal, START_PICKS + 4);
  await pickAll();
  assert.equal(bracket.playerView(stillIn).draft.picks.reduce((n, p) => n + p.count, 0), START_PICKS + 4);
  assert.equal(bracket.playerView(players[0]).draft.picks.reduce((n, p) => n + p.count, 0), START_PICKS, 'out before stage 2: no more picks');
});
