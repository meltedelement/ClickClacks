// Whole rounds against a made-up game: what the phones and the host see at each
// step. The draft's own rules are tested in shared/draft.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Catalog, Match, MatchRequest, MatchResult } from '../../../games/weapon-balls/api/game.d.ts';
import { BOT_COLOR } from '../shared/colors.ts';
import { createRoyale } from './store.ts';
import type { GameHost } from './host.ts';

const upgrade = (id: string) => ({ id, name: id.toUpperCase(), description: `${id}.`, weapons: null, requires: [], excludedBy: [], maxStacks: null });
const catalog: Catalog = {
  weapons: [
    { id: 'sword', name: 'Sword' },
    { id: 'mace', name: 'Mace' },
    { id: 'drone', name: 'Drone' },
    { id: 'gun', name: 'Gun' },
  ],
  upgrades: [upgrade('damage'), upgrade('speed'), upgrade('armor'), upgrade('crit')],
  transformations: [upgrade('big'), upgrade('huge')],
};

// A game that does what it's told: holds each match until the test finishes it.
function fakeHost() {
  const queued: MatchRequest[] = [];
  const cancelled: string[] = [];
  const finishers = new Map<string, (match: Match) => void>();
  let refuse: string | null = null;
  const host: GameHost = {
    catalog: async () => catalog,
    async queue(request) {
      if (refuse) throw new Error(refuse);
      queued.push(request);
      return { id: `match-${queued.length}` } as Match;
    },
    wait: (id) => new Promise((resolve) => finishers.set(id, resolve)),
    async cancel(id) {
      cancelled.push(id);
      finishers.get(id)?.({ id, status: 'cancelled', result: null } as Match);
    },
  };
  return {
    host,
    queued,
    cancelled,
    refuseWith: (message: string) => (refuse = message),
    finish(id: string, ranking: number[]) {
      const result = { winner: ranking[0], reason: 'ko', ranking, time: 42 } as MatchResult;
      finishers.get(id)!({ id, status: 'done', result } as Match);
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup(minBalls = 4) {
  const game = fakeHost();
  let changes = 0;
  const royale = createRoyale({ host: game.host, onChange: () => changes++, countdownMs: 0, resultHoldMs: 0 });
  royale.setCatalog(catalog);
  royale.setMinBalls(minBalls);
  const join = (name: string) => royale.findPlayer(royale.join(name))!;
  return { game, royale, join, changes: () => changes };
}

test('joining: names are required, unique and tidied', () => {
  const { royale, join } = setup();
  assert.throws(() => royale.join('   '), /Enter a name/);
  const ada = join('  Ada   Lovelace  ');
  assert.equal(ada.name, 'Ada Lovelace');
  assert.throws(() => royale.join('ada lovelace'), /taken/);
  assert.equal(join('A very long name that goes on and on').name.length, 20);
});

test('everyone gets a colour of their own, however many join and whoever leaves', () => {
  const { royale, join } = setup();
  const first = join('First');
  royale.leave(first.token);
  const colors = [first.color, ...Array.from({ length: 100 }, (_, n) => join(`Player ${n}`).color)];
  assert.equal(new Set(colors).size, colors.length);
  assert.ok(!colors.includes(BOT_COLOR));
});

test('players are named and ringed in their own colours, and every bot is the same gray', async () => {
  const { game, royale, join } = setup(6);
  const ada = join('Ada');
  const bob = join('Bob');
  royale.start();
  await tick();
  const { characters } = game.queued[0];
  const humans = characters.filter((c) => c.name);
  const bots = characters.filter((c) => !c.name);
  assert.deepEqual(humans.map((c) => c.highlight), [true, true]);
  assert.deepEqual(humans.map((c) => c.color).sort(), [ada.color, bob.color].sort());
  assert.equal(bots.length, 4);
  for (const bot of bots) {
    assert.equal(bot.color, BOT_COLOR);
    assert.ok(!bot.highlight);
  }
  // Bots are small and untransformed; players are neither.
  for (const bot of bots) {
    assert.equal(bot.size, 0.75);
    assert.deepEqual(bot.transformations, []);
  }
  for (const human of humans) {
    assert.equal(human.size, undefined);
    assert.equal(human.transformations!.length, 1);
  }

  // A bot's dot in the results is the same gray.
  const bot = characters.findIndex((c) => !c.name);
  game.finish('match-1', [bot, ...[...characters.keys()].filter((i) => i !== bot)]);
  await tick();
  assert.equal(royale.playerView(ada).results!.places[0].color, BOT_COLOR);
});

test('the weapons unbalanced for a royale are not offered to anyone, and say so', async () => {
  const { game, royale, join } = setup(100);
  const ada = join('Ada');
  const view = royale.playerView(ada);
  assert.deepEqual(view.draft.weapons.map((w) => w.id), ['sword', 'mace']);
  assert.deepEqual(view.draft.unbalanced, ['Drone', 'Gun']);
  assert.throws(() => royale.takeWeapon(ada, 'gun'), /no such weapon/);
  assert.throws(() => royale.takeWeapon(ada, 'drone'), /no such weapon/);
  royale.start(); // Ada's random build and 99 bots
  await tick();
  assert.equal(game.queued[0].characters.length, 100);
  for (const { weapon } of game.queued[0].characters) assert.ok(['sword', 'mace'].includes(weapon), weapon);
});

test('a view never shows a token, and the draft walks through its steps', () => {
  const { royale, join } = setup();
  const ada = join('Ada');
  const bob = join('Bob');
  let view = royale.playerView(ada);
  assert.equal(view.draft.weapons.length, 2);
  assert.ok(view.draft.weapons[0].description, 'weapons say what they do');
  assert.ok(!JSON.stringify(view).includes(ada.token));
  assert.ok(!JSON.stringify(view).includes(bob.token));
  assert.ok(!JSON.stringify(royale.adminView([ada.token])).includes(ada.token));

  royale.takeWeapon(ada, 'sword');
  view = royale.playerView(ada);
  assert.equal(view.draft.kind, 'transformation');
  assert.equal(view.draft.pickNumber, 1);
  assert.throws(() => royale.takePick(ada, 'nonsense'), /not on offer/);
  while (!royale.playerView(ada).draft.finished) royale.takePick(ada, royale.playerView(ada).draft.offer[0].id);
  view = royale.playerView(ada);
  assert.equal(view.draft.picks.reduce((n, p) => n + p.count, 0), 5);
  assert.equal(view.lobby.find((p) => p.name === 'Ada')!.ready, true);
  assert.equal(view.lobby.find((p) => p.name === 'Bob')!.ready, false);
});

test('a round: unfinished drafts are completed, bots fill the arena, and the results come back', async () => {
  const { game, royale, join } = setup(4);
  const ada = join('Ada');
  const bob = join('Bob');
  royale.takeWeapon(ada, 'mace');

  royale.start();
  assert.equal(royale.playerView(ada).phase, 'countdown');
  assert.equal(ada.draft.weapon, 'mace', 'what Ada picked stands');
  assert.equal(ada.draft.upgrades.length, 4, 'the rest is filled in');
  assert.ok(bob.draft.weapon, 'Bob, who picked nothing, gets a build');
  await tick();

  assert.equal(royale.playerView(ada).phase, 'fight');
  const request = game.queued[0];
  assert.equal(request.characters.length, 4);
  assert.equal(request.decisive, true);
  assert.equal(request.settings?.royale, true);
  const slotOf = (name: string) => request.characters.findIndex((c) => c.name === name);
  assert.deepEqual(request.characters.filter((c) => !c.name).length, 2, 'two bots, unnamed');
  const fight = royale.playerView(ada).fight!;
  assert.equal(fight.slot, slotOf('Ada'));
  assert.ok(fight.arena.endsWith(`&follow=${slotOf('Ada')}`), 'the arena follows their own ball');
  assert.deepEqual(royale.adminView([]).fight && { balls: royale.adminView([]).fight!.balls, bots: royale.adminView([]).fight!.bots }, { balls: 4, bots: 2 });

  const bots = request.characters.flatMap((c, i) => (c.name ? [] : [i]));
  game.finish('match-1', [slotOf('Bob'), bots[0], slotOf('Ada'), bots[1]]);
  await tick();

  const view = royale.playerView(ada);
  assert.equal(view.phase, 'results');
  assert.equal(view.results!.winner, 'Bob');
  assert.equal(view.results!.seconds, 42);
  assert.deepEqual(view.results!.places.map((p) => [p.place, p.bot]), [[1, false], [2, true], [3, false], [4, true]]);
  assert.equal(view.results!.places[2].name, 'Ada');
  assert.equal(view.results!.places[2].weapon, 'Mace');
  assert.equal(view.lobby[0].name, 'Bob', 'the winner tops the table');
  assert.equal(view.lobby[0].wins, 1);
});

test('the next round clears the drafts and keeps the wins', async () => {
  const { game, royale, join } = setup(2);
  const ada = join('Ada');
  royale.start();
  await tick();
  const slot = game.queued[0].characters.findIndex((c) => c.name === 'Ada');
  game.finish('match-1', [slot, 1 - slot]);
  await tick();
  assert.throws(() => royale.start(), /has started/);
  royale.nextRound();
  const view = royale.playerView(ada);
  assert.equal(view.phase, 'draft');
  assert.equal(view.round, 2);
  assert.equal(view.you.wins, 1);
  assert.equal(view.draft.weapon, null);
  assert.equal(view.results, null);
});

// Plays a round to its end with slot 0 winning.
async function playRound(game: ReturnType<typeof fakeHost>, royale: ReturnType<typeof createRoyale>) {
  royale.start();
  await tick();
  const { characters } = game.queued.at(-1)!;
  game.finish(`match-${game.queued.length}`, [...characters.keys()]);
  await tick();
  return characters;
}

test('build-up mode: one pick each round, and builds carry over', async () => {
  const { game, royale, join } = setup(3);
  royale.setMode('buildup');
  const ada = join('Ada');

  royale.takeWeapon(ada, 'mace');
  let view = royale.playerView(ada).draft;
  assert.equal(view.mode, 'buildup');
  assert.equal(view.kind, 'transformation');
  assert.equal(view.picksTotal, 1);
  royale.takePick(ada, view.offer[0].id);
  assert.equal(royale.playerView(ada).draft.finished, true);
  const transformation = ada.draft.transformations[0];

  let characters = await playRound(game, royale);
  let mine = characters.find((c) => c.name === 'Ada')!;
  assert.deepEqual(mine.transformations, [transformation]);
  assert.deepEqual(mine.upgrades, []);
  for (const bot of characters.filter((c) => !c.name)) {
    assert.deepEqual(bot.upgrades, [], 'bots start with no upgrades either');
    assert.deepEqual(bot.transformations, []);
  }

  royale.nextRound();
  view = royale.playerView(ada).draft;
  assert.equal(view.weapon!.id, 'mace', 'the weapon stays');
  assert.equal(view.kind, 'upgrade');
  assert.equal(view.pickNumber, 2);
  assert.equal(view.picksTotal, 2);
  assert.equal(royale.playerView(ada).lobby[0].ready, false, 'not ready until the new pick is taken');
  const first = view.offer[0].id;
  royale.takePick(ada, first);

  characters = await playRound(game, royale);
  mine = characters.find((c) => c.name === 'Ada')!;
  assert.deepEqual(mine.upgrades, [first]);
  for (const bot of characters.filter((c) => !c.name)) assert.equal(bot.upgrades!.length, 1, 'bots keep pace');

  // Not picking in time still gets the round's one upgrade, at random.
  royale.nextRound();
  characters = await playRound(game, royale);
  mine = characters.find((c) => c.name === 'Ada')!;
  const upgrades = mine.upgrades as string[];
  assert.equal(upgrades.length, 2);
  assert.equal(upgrades[0], first);
});

test('build-up mode: someone joining late catches up on the picks they missed', async () => {
  const { game, royale, join } = setup(2);
  royale.setMode('buildup');
  join('Ada');
  await playRound(game, royale);
  const late = join('Late'); // during the results
  royale.nextRound();
  assert.equal(royale.playerView(late).draft.picksTotal, 2);
  royale.takeWeapon(late, 'sword');
  assert.equal(royale.playerView(late).draft.kind, 'transformation');
  royale.takePick(late, royale.playerView(late).draft.offer[0].id);
  assert.equal(royale.playerView(late).draft.kind, 'upgrade');
  royale.takePick(late, royale.playerView(late).draft.offer[0].id);
  assert.equal(royale.playerView(late).draft.finished, true);
  const newcomer = join('Newcomer'); // while drafting
  assert.equal(royale.playerView(newcomer).draft.picksTotal, 2);
});

test('build-up mode: a cancelled round gives no extra pick', async () => {
  const { game, royale, join } = setup(2);
  royale.setMode('buildup');
  const ada = join('Ada');
  royale.start();
  await tick();
  royale.abort();
  await tick();
  assert.equal(royale.adminView([]).buildPicks, 1);
  assert.equal(royale.playerView(ada).draft.finished, true);
  await playRound(game, royale);
  royale.nextRound();
  assert.equal(royale.adminView([]).buildPicks, 2);
});

test('changing the mode or restarting builds clears them, and only while drafting', async () => {
  const { game, royale, join } = setup(2);
  assert.equal(royale.adminView([]).mode, 'fresh');
  assert.throws(() => royale.setMode('nonsense'), /no such mode/);
  assert.throws(() => royale.restartBuilds(), /build-up/);
  const ada = join('Ada');
  royale.takeWeapon(ada, 'sword');

  royale.setMode('fresh');
  assert.equal(ada.draft.weapon, 'sword', 'choosing the same mode changes nothing');
  royale.setMode('buildup');
  assert.equal(ada.draft.weapon, null);
  assert.equal(ada.draft.length, 1);

  await playRound(game, royale);
  assert.throws(() => royale.setMode('fresh'), /only change while drafting/);
  assert.throws(() => royale.restartBuilds(), /only restart while drafting/);
  royale.nextRound();
  assert.equal(royale.adminView([]).buildPicks, 2);

  const wins = ada.wins;
  royale.restartBuilds();
  assert.equal(royale.adminView([]).buildPicks, 1);
  assert.equal(ada.draft.weapon, null);
  assert.equal(ada.draft.length, 1);
  assert.equal(ada.wins, wins, 'wins stand');

  royale.setMode('fresh');
  assert.equal(ada.draft.length, 5);
});

test('nothing can start with nobody there, and drafting stops once a round starts', async () => {
  const { royale, join } = setup(2);
  assert.throws(() => royale.start(), /Nobody/);
  const ada = join('Ada');
  royale.start();
  assert.throws(() => royale.takeWeapon(ada, 'sword'), /has started/);
  assert.throws(() => royale.nextRound(), /has not finished/);
  await tick();
});

test('someone joining during a fight watches it, and is in the next one', async () => {
  const { game, royale, join } = setup(2);
  join('Ada');
  royale.start();
  await tick();
  const late = join('Late');
  const { fight, phase } = royale.playerView(late);
  assert.equal(phase, 'fight');
  assert.equal(fight!.slot, null);
  assert.ok(!fight!.arena.includes('follow'));
  game.finish('match-1', [0, 1]);
  await tick();
  royale.nextRound();
  royale.start();
  await tick();
  assert.equal(royale.playerView(late).fight!.slot !== null, true);
  assert.equal(game.queued[1].characters.filter((c) => c.name).length, 2);
});

test('a player who leaves mid-fight still appears in the results', async () => {
  const { game, royale, join } = setup(2);
  const ada = join('Ada');
  const bob = join('Bob');
  royale.start();
  await tick();
  royale.leave(ada.token);
  game.finish('match-1', [0, 1]);
  await tick();
  const view = royale.playerView(bob);
  assert.equal(view.results!.places.length, 2);
  assert.ok(view.results!.places.some((p) => p.name === 'Ada'));
});

test('the host can call off a round, in the countdown or the fight, and picks are kept', async () => {
  const game = fakeHost();
  const royale = createRoyale({ host: game.host, onChange: () => {}, countdownMs: 60_000, resultHoldMs: 0 });
  royale.setCatalog(catalog);
  const ada = royale.findPlayer(royale.join('Ada'))!;
  royale.start();
  const weapon = ada.draft.weapon;
  royale.abort();
  assert.equal(royale.playerView(ada).phase, 'draft');
  assert.match(royale.playerView(ada).notice!, /cancelled/);
  assert.equal(ada.draft.weapon, weapon);
  await tick();
  assert.equal(game.queued.length, 0, 'the countdown never dropped');
  assert.throws(() => royale.abort(), /No round/);

  const { game: game2, royale: royale2, join } = setup(2);
  const bob = join('Bob');
  royale2.start();
  await tick();
  royale2.abort();
  await tick();
  assert.deepEqual(game2.cancelled, ['match-1']);
  assert.equal(royale2.playerView(bob).phase, 'draft');
});

test('a round the game refuses goes back to the draft and says why', async () => {
  const { game, royale, join } = setup(2);
  const ada = join('Ada');
  game.refuseWith('characters[0]: Unknown weapon');
  royale.start();
  await tick();
  const view = royale.playerView(ada);
  assert.equal(view.phase, 'draft');
  assert.match(view.notice!, /Unknown weapon/);
});

test('the host starts with 8 balls and bots at 75%, and can change both', async () => {
  const game = fakeHost();
  const royale = createRoyale({ host: game.host, onChange: () => {}, countdownMs: 0, resultHoldMs: 0 });
  royale.setCatalog(catalog);
  assert.equal(royale.adminView([]).minBalls, 8);
  assert.equal(royale.adminView([]).botSize, 75);
  royale.join('Ada');
  royale.setBotSize(50);
  royale.start();
  await tick();
  const { characters } = game.queued[0];
  assert.equal(characters.length, 8);
  assert.deepEqual(characters.filter((c) => !c.name).map((c) => c.size), Array(7).fill(0.5));
});

test('admin settings are checked, and removed players are gone', () => {
  const { royale, join } = setup();
  assert.throws(() => royale.setMinBalls(1), /whole number/);
  assert.throws(() => royale.setMinBalls(2.5), /whole number/);
  royale.setMinBalls(30);
  assert.equal(royale.adminView([]).minBalls, 30);
  assert.throws(() => royale.setBotSize(10), /Bot size/);
  assert.throws(() => royale.setBotSize(101), /Bot size/);
  assert.throws(() => royale.setBotSize('big'), /Bot size/);
  const ada = join('Ada');
  assert.equal(royale.adminView([ada.token]).players[0].online, true);
  assert.equal(royale.adminView([]).players[0].online, false);
  royale.removeById(ada.id);
  assert.equal(royale.findPlayer(ada.token), undefined);
  assert.throws(() => royale.removeById('nobody'), /No such player/);
});

test('before the game has answered, the lobby works but rounds and picks wait', () => {
  const game = fakeHost();
  const royale = createRoyale({ host: game.host, onChange: () => {}, countdownMs: 0, resultHoldMs: 0 });
  const ada = royale.findPlayer(royale.join('Ada'))!;
  assert.equal(royale.adminView([]).ready, false);
  assert.throws(() => royale.takeWeapon(ada, 'sword'), /still starting/);
  assert.throws(() => royale.start(), /still starting/);
  royale.setCatalog(catalog);
  assert.equal(royale.adminView([]).ready, true);
});

test('the host can give a player a colour, a skin and a tag, and only them', async () => {
  const { game, royale, join } = setup(3);
  const ada = join('Ada');
  join('Bob');
  royale.setLook(ada.id, { color: '#FFAA00', skin: 'birthday', tag: ' B-DAY ' });
  assert.deepEqual(pickLook(royale.adminView([]).players.find((p) => p.name === 'Ada')!), { color: '#ffaa00', skin: 'birthday', tag: 'B-DAY' });
  royale.setLook(ada.id, { skin: 'gold' }); // the rest stays
  royale.start();
  await tick();
  const [request] = game.queued;
  const looks = request.characters.filter((c) => c.skin || c.tag).map((c) => [c.name, c.color, c.skin, c.tag]);
  assert.deepEqual(looks, [['Ada', '#ffaa00', 'gold', 'B-DAY']]);
  royale.setLook(ada.id, { skin: null, tag: '' });
  assert.deepEqual(pickLook(royale.adminView([]).players.find((p) => p.name === 'Ada')!), { color: '#ffaa00', skin: null, tag: null });
  assert.throws(() => royale.setLook('nobody', { skin: 'gold' }), /No such player/);
  assert.throws(() => royale.setLook(ada.id, { skin: 'plaid' }), /No such skin/);
  assert.throws(() => royale.setLook(ada.id, { color: 'red' }), /colour/);
  assert.throws(() => royale.setLook(ada.id, { tag: 'much too long a tag' }), /at most 12/);
});

function pickLook(p: { color: string; skin: unknown; tag: unknown }) {
  return { color: p.color, skin: p.skin, tag: p.tag };
}
