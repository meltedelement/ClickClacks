// The game night: who has joined, their drafts, and the round being played. All
// the rules live here. index.ts only connects it to HTTP, and the game is reached
// through a GameHost, so tests can play whole rounds with a made-up one.
//
// A round: `draft` -> the host starts it -> `countdown` (unfinished drafts are
// completed at random, bots fill the arena) -> `fight` (the match is on the game)
// -> `results` -> the host moves on -> `draft`, where everyone's picks are cleared
// or, in build-up mode, kept with room for one more.
import { randomUUID } from 'node:crypto';
import { PartyError } from '../../../party/server/index.ts';
import type { Catalog, CatalogUpgrade, MatchResult } from '../../../games/weapon-balls/api/game.d.ts';
import { BOT_COLOR, playerColor } from '../shared/colors.ts';
import { changeLook, lookFields } from '../shared/looks.ts';
import type { Skin } from '../../../games/weapon-balls/api/game.d.ts';
import { WEAPON_BLURBS } from '../shared/weapons.ts';
import { FULL_DRAFT, botDraft, chooseWeapon, finishDraft, growDraft, isFinished, kindAt, newDraft, pick, shuffle, stack } from '../shared/draft.ts';
import type { Draft, Random } from '../shared/draft.ts';
import type { AdminView, Described, DraftView, Stacked, Mode, Phase, PlaceEntry, PlayerView, ResultsView } from '../shared/types.ts';
import type { GameHost } from './host.ts';

export const MAX_PLAYERS = 100;
const MAX_NAME = 20;
const MIN_BALLS = 2;
const MAX_BALLS = 100; // the game's royale gets heavy on phones well past this
const DEFAULT_MIN_BALLS = 8;
// Bots are filler: smaller than players, so with less HP and damage too, and with
// no transformation. At 75%, with 3 players and 5 bots, players win about 70% of
// simulated fights (about 30% with full-size transformed bots), and bots still can.
const DEFAULT_BOT_SIZE = 75; // percent of a player's starting size
const MIN_BOT_SIZE = 25; // the game's own limit
const MAX_BOT_SIZE = 100;
const TIME_LIMIT = 300; // sim seconds; sudden death ends nearly every round long before
const ARENA = '/game/?display&embed'; // the game's display page, through this app's proxy

// Unbalanced for a royale, so left out for now: not offered to players or bots.
// They almost never win in a crowd: in 400 simulated 16-ball royales with drafted
// builds, Gun won 0.3% and Drone 0.5%, each with 12.5% of the balls. Take one off
// this list to bring it back. The game itself still has them for normal matches.
const UNBALANCED_WEAPONS = ['drone', 'gun'];

export interface Player {
  token: string;
  id: string; // public: what other devices may see
  name: string;
  color: string;
  draft: Draft;
  wins: number;
  skin: Skin | null; // how the ball is drawn (the host's say, display only)
  tag: string | null; // before the name in the arena, e.g. "DEV"
}

interface Fighter {
  playerId: string | null; // null: a bot
  skin: Skin | null;
  tag: string | null;
  name: string;
  color: string;
  draft: Draft;
}

interface Round {
  fighters: Fighter[];
  matchId: string | null;
  dropsAt: number; // Date.now() when the countdown ends
  timer: ReturnType<typeof setTimeout> | null;
}

export interface RoyaleOptions {
  host: GameHost;
  /** Called after every change, for the views to go out again. */
  onChange(): void;
  countdownMs?: number;
  /** How long the winner's banner stays up in the arena before the results replace it. */
  resultHoldMs?: number;
  random?: Random;
}

export function createRoyale({ host, onChange, countdownMs = 5_000, resultHoldMs = 4_000, random = Math.random }: RoyaleOptions) {
  const players = new Map<string, Player>(); // by token, in the order they joined
  let catalog: Catalog | null = null; // without the unbalanced weapons
  let unbalanced: string[] = []; // their names, to say why they're missing
  let colorsGiven = 0; // never reused, so someone new can't match a player still in the results
  let phase: Phase = 'draft';
  let roundNumber = 1;
  let minBalls = DEFAULT_MIN_BALLS;
  let botSize = DEFAULT_BOT_SIZE;
  let mode: Mode = 'fresh';
  let buildPicks = 1; // build-up mode: the picks everyone is up to, so one per round played
  let round: Round | null = null;
  let results: ResultsView | null = null;
  let notice: string | null = null;

  function draftLength(): number {
    return mode === 'buildup' ? buildPicks : FULL_DRAFT;
  }

  // ---- Views ---------------------------------------------------------------

  function describe(u: CatalogUpgrade): Described {
    return { id: u.id, name: u.name, description: u.description };
  }

  function describeId(id: string): Described {
    const known = catalog && [...catalog.transformations, ...catalog.upgrades].find((u) => u.id === id);
    return known ? describe(known) : { id, name: id, description: '' };
  }

  // Repeated picks as one entry, described for all the copies together.
  function describeStacked(ids: string[]): Stacked[] {
    return stack(ids).map(({ id, count }) => {
      const described = describeId(id);
      const known = catalog && [...catalog.transformations, ...catalog.upgrades].find((u) => u.id === id);
      const together = count > 1 ? known?.stacked?.[count - 2] : undefined;
      return { ...described, description: together ?? described.description, count };
    });
  }

  // Names for a one-line build: "Sharpened ×2".
  function stackedNames(ids: string[]): string[] {
    return stack(ids).map(({ id, count }) => describeId(id).name + (count > 1 ? ` ×${count}` : ''));
  }

  function describeWeapon(id: string): Described {
    const name = catalog?.weapons.find((w) => w.id === id)?.name ?? id;
    return { id, name, description: WEAPON_BLURBS[id] ?? '' };
  }

  function picksOf(draft: Draft): string[] {
    return [...draft.transformations, ...draft.upgrades];
  }

  function draftView(draft: Draft): DraftView {
    const finished = isFinished(draft);
    return {
      weapon: draft.weapon ? describeWeapon(draft.weapon) : null,
      weapons: draft.weapon ? [] : (catalog?.weapons ?? []).map((w) => describeWeapon(w.id)),
      unbalanced: draft.weapon ? [] : unbalanced,
      mode,
      finished,
      pickNumber: draft.step + 1,
      picksTotal: draft.length,
      kind: draft.weapon && !finished ? kindAt(draft.step, draft) : null,
      offer: draft.offer.map(describeId),
      picks: describeStacked(picksOf(draft)),
    };
  }

  function lobbyEntry(player: Player) {
    return { id: player.id, name: player.name, color: player.color, ready: isFinished(player.draft), wins: player.wins, skin: player.skin, tag: player.tag };
  }

  // Most wins first; joining order otherwise, so nobody jumps around for no reason.
  function lobby() {
    return [...players.values()].map(lobbyEntry).sort((a, b) => b.wins - a.wins);
  }

  function countdownLeft(): number {
    return round && phase === 'countdown' ? Math.max(0, round.dropsAt - Date.now()) : 0;
  }

  function playerView(player: Player): PlayerView {
    const slot = round ? round.fighters.findIndex((f) => f.playerId === player.id) : -1;
    return {
      phase,
      round: roundNumber,
      you: { id: player.id, name: player.name, color: player.color, wins: player.wins },
      draft: draftView(player.draft),
      lobby: lobby(),
      fight: round
        ? {
            round: roundNumber,
            arena: slot >= 0 ? `${ARENA}&follow=${slot}` : ARENA,
            slot: slot >= 0 ? slot : null,
            balls: round.fighters.length,
            countdownMs: countdownLeft(),
          }
        : null,
      results,
      notice,
    };
  }

  function adminView(online: string[]): AdminView {
    const onlineIds = new Set(online.map((token) => players.get(token)?.id));
    return {
      phase,
      round: roundNumber,
      mode,
      buildPicks,
      minBalls,
      botSize,
      ready: catalog !== null,
      players: [...players.values()].map((player) => ({
        ...lobbyEntry(player),
        online: onlineIds.has(player.id),
        picksDone: picksOf(player.draft).length,
        picksTotal: player.draft.length,
      })),
      fight: round
        ? { arena: ARENA, balls: round.fighters.length, bots: round.fighters.filter((f) => !f.playerId).length, countdownMs: countdownLeft() }
        : null,
      results,
      notice,
    };
  }

  // ---- Players -------------------------------------------------------------

  function join(rawName: unknown): string {
    const name = String(rawName ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    if (!name) throw new PartyError('Enter a name');
    if (players.size >= MAX_PLAYERS) throw new PartyError('This game is full');
    const taken = [...players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new PartyError('That name is taken');
    const token = randomUUID();
    players.set(token, { token, id: randomUUID(), name, color: playerColor(colorsGiven++), draft: newDraft(draftLength()), wins: 0, skin: null, tag: null });
    onChange();
    return token;
  }

  function requireDrafting(): Catalog {
    if (phase !== 'draft') throw new PartyError('This round has started. You can draft for the next one.');
    if (!catalog) throw new PartyError('The game is still starting. Try again in a moment.');
    return catalog;
  }

  // Draft rules throw plain errors whose messages are fit to show.
  function draftStep(player: Player, step: (catalog: Catalog) => Draft) {
    const known = requireDrafting();
    try {
      player.draft = step(known);
    } catch (err) {
      throw new PartyError((err as Error).message);
    }
    onChange();
  }

  function takeWeapon(player: Player, weapon: unknown) {
    draftStep(player, (known) => chooseWeapon(player.draft, String(weapon), known, random));
  }

  function takePick(player: Player, id: unknown) {
    draftStep(player, (known) => pick(player.draft, String(id), known, random));
  }

  function leave(token: string) {
    players.delete(token);
    onChange();
  }

  // The host's colour, skin and tag for a player's ball, from the next round.
  function setLook(id: unknown, change: unknown) {
    const player = [...players.values()].find((p) => p.id === id);
    if (!player) throw new PartyError('No such player');
    try {
      Object.assign(player, changeLook({ color: player.color, skin: player.skin, tag: player.tag }, change));
    } catch (err) {
      throw new PartyError((err as Error).message);
    }
    onChange();
  }

  function removeById(id: unknown) {
    const player = [...players.values()].find((p) => p.id === id);
    if (!player) throw new PartyError('No such player');
    leave(player.token);
  }

  // ---- The round -----------------------------------------------------------

  function setMinBalls(value: unknown) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < MIN_BALLS || n > MAX_BALLS) throw new PartyError(`Balls must be a whole number from ${MIN_BALLS} to ${MAX_BALLS}`);
    minBalls = n;
    onChange();
  }

  function setBotSize(value: unknown) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < MIN_BOT_SIZE || n > MAX_BOT_SIZE) throw new PartyError(`Bot size must be a whole number from ${MIN_BOT_SIZE} to ${MAX_BOT_SIZE}`);
    botSize = n;
    onChange();
  }

  function clearDrafts() {
    for (const player of players.values()) player.draft = newDraft(draftLength());
  }

  function setMode(value: unknown) {
    if (value !== 'fresh' && value !== 'buildup') throw new PartyError('There is no such mode');
    if (phase !== 'draft') throw new PartyError('The mode can only change while drafting');
    if (value === mode) return;
    mode = value;
    buildPicks = 1;
    clearDrafts();
    onChange();
  }

  // Build-up mode's fresh start: everyone picks a weapon again. Wins stand.
  function restartBuilds() {
    if (mode !== 'buildup') throw new PartyError('Builds only carry over in build-up mode');
    if (phase !== 'draft') throw new PartyError('Builds can only restart while drafting');
    buildPicks = 1;
    clearDrafts();
    onChange();
  }

  function start() {
    const known = requireDrafting();
    if (players.size === 0) throw new PartyError('Nobody has joined yet');
    for (const player of players.values()) player.draft = finishDraft(player.draft, known, random);
    const fighters: Fighter[] = [...players.values()].map((player) => ({ playerId: player.id, skin: player.skin, tag: player.tag, name: player.name, color: player.color, draft: player.draft }));
    for (let i = fighters.length; i < minBalls; i++) {
      const draft = botDraft(known, random, draftLength());
      fighters.push({ playerId: null, skin: null, tag: null, name: `Bot ${describeWeapon(draft.weapon!).name}`, color: BOT_COLOR, draft });
    }
    // Shuffled so that nobody's place in the arena depends on when they joined.
    const current: Round = { fighters: shuffle(fighters, random), matchId: null, dropsAt: Date.now() + countdownMs, timer: null };
    current.timer = setTimeout(() => void drop(current), countdownMs);
    round = current;
    phase = 'countdown';
    notice = null;
    onChange();
  }

  async function drop(current: Round) {
    if (round !== current) return;
    current.timer = null;
    try {
      const match = await host.queue({
        characters: current.fighters.map((f) => ({
          // Only players get a name and a ring: the bots are the small gray crowd around them.
          ...(f.playerId ? { name: f.name, highlight: true } : { size: botSize / 100 }),
          ...lookFields(f),
          color: f.color,
          weapon: f.draft.weapon!,
          transformations: f.draft.transformations,
          upgrades: f.draft.upgrades,
        })),
        decisive: true,
        ref: `royale/${roundNumber}`,
        // The arena is already up on every device through the drop countdown, so
        // the fight needn't count down again (the game's startDelay).
        settings: { royale: true, timeLimit: TIME_LIMIT, startDelay: 0 },
      });
      if (round !== current) {
        // Cancelled while the request was out.
        await host.cancel(match.id).catch(() => {});
        return;
      }
      current.matchId = match.id;
      phase = 'fight';
      onChange();
      const done = await host.wait(match.id);
      if (round !== current) return;
      if (done.status !== 'done' || !done.result) {
        backToDraft('The round was cancelled.');
        return;
      }
      const result = done.result;
      setTimeout(() => {
        if (round === current) finish(current, result);
      }, resultHoldMs);
    } catch (err) {
      if (round === current) backToDraft(`The game refused the round: ${(err as Error).message}`);
    }
  }

  function finish(current: Round, result: MatchResult) {
    const places = result.ranking.map((slot, i): PlaceEntry => {
      const fighter = current.fighters[slot];
      return {
        place: i + 1,
        name: fighter.name,
        color: fighter.color,
        bot: fighter.playerId === null,
        playerId: fighter.playerId,
        weapon: describeWeapon(fighter.draft.weapon!).name,
        picks: stackedNames(picksOf(fighter.draft)),
      };
    });
    const winner = places[0];
    for (const player of players.values()) if (player.id === winner.playerId) player.wins += 1;
    results = { round: roundNumber, seconds: result.time, balls: current.fighters.length, winner: winner.name, places };
    round = null;
    phase = 'results';
    onChange();
  }

  // Keeps everyone's picks: they can go again with what they have.
  function backToDraft(message: string) {
    if (round?.timer) clearTimeout(round.timer);
    round = null;
    phase = 'draft';
    notice = message;
    onChange();
  }

  function abort() {
    if (!round) throw new PartyError('No round is running');
    const { matchId } = round;
    backToDraft('The host cancelled the round.');
    if (matchId) host.cancel(matchId).catch(() => {}); // it may have finished just now
  }

  function nextRound() {
    if (phase !== 'results') throw new PartyError('The round has not finished');
    roundNumber += 1;
    if (mode === 'buildup') {
      buildPicks += 1;
      for (const player of players.values()) player.draft = growDraft(player.draft, buildPicks, catalog!, random);
    } else {
      clearDrafts();
    }
    results = null;
    notice = null;
    phase = 'draft';
    onChange();
  }

  return {
    findPlayer: (token: string) => players.get(token),
    playerView,
    adminView,
    join,
    takeWeapon,
    takePick,
    leave,
    removeById,
    setLook,
    setMinBalls,
    setBotSize,
    setMode,
    restartBuilds,
    start,
    abort,
    nextRound,
    setCatalog(next: Catalog) {
      // Their upgrades can stay: offers only hold what fits the chosen weapon.
      catalog = { ...next, weapons: next.weapons.filter((w) => !UNBALANCED_WEAPONS.includes(w.id)) };
      unbalanced = next.weapons.filter((w) => UNBALANCED_WEAPONS.includes(w.id)).map((w) => w.name);
      onChange();
    },
  };
}

export type Royale = ReturnType<typeof createRoyale>;
