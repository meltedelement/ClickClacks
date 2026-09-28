// Runs the knockout: draws the bracket, and when the host starts a round,
// queues all of its matches on the game's match API at once. The game plays up
// to four at the same time on its display page. The driver waits for the
// display page's official result for each match, records it, and when every
// match in the round has a winner, draws the next round. The next round waits
// for the host.
//
// The game plays a queued match only while a display page (?display) is
// connected, so the driver waits for one instead of queueing into the void. The
// game keeps its matches in memory only, so if it restarts, a match that was
// sent is queued again with the same seed: the same fight.
import { randomInt } from 'node:crypto';
import type { Fighter, Team } from '../shared/types.ts';
import { currentRound, drawBracket, roundComplete, roundMatches, validateLoadout } from '../shared/battle.ts';
import * as game from './game.ts';
import * as store from './store.ts';

const DISPLAY_WAIT_MS = 2_000; // how often to look for a display page
const RETRY_MS = 3_000; // between attempts at a call that could not get through

// Goes up each time the host stops a round or resets the battle. A runner
// started before that sees the change and quits without touching the state.
let generation = 0;
const running = new Set<string>(); // ids of matches with a runner
// Runners send their matches to the game one after another, in match order, so
// match 1 of a round goes on screen 1, match 2 on screen 2, and so on.
let sendChain: Promise<unknown> = Promise.resolve();

function inOrder<T>(fn: () => Promise<T>): Promise<T> {
  const result = sendChain.then(fn);
  sendChain = result.catch(() => {});
  return result;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Draws the bracket. Nothing is sent to the game until the host starts the first round.
export function create(seed?: number) {
  if (store.state.battle) throw new store.UserError('There is already a bracket. Reset the battle first.');
  const teams = store.state.teams;
  if (teams.length < 2) throw new store.UserError('A battle needs at least two teams.');
  checkLoadouts(teams);
  const bracketSeed = seed === undefined ? randomInt(0, 2 ** 32) : parseSeed(seed);
  const { rounds, matches } = drawBracket(
    teams.map((team) => team.id),
    bracketSeed,
  );
  store.beginBattle({
    seed: bracketSeed,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    rounds,
    matches,
    champion: null,
    note: '',
  });
}

// Sends every unplayed match of the current round to the game, with the
// teams' loadouts as they are now.
export function startRound() {
  const battle = store.state.battle;
  const round = battle && currentRound(battle);
  if (!battle || !round) throw new store.UserError('Draw the bracket first.');
  if (battle.champion) throw new store.UserError('The battle is over.');
  if (round.status !== 'waiting') throw new store.UserError(`The ${round.name} already started.`);

  const teams = store.state.teams.filter((team) => round.teams.includes(team.id));
  if (teams.length < round.teams.length) throw new store.UserError('A team in this round was deleted. Reset the battle.');
  checkLoadouts(teams);

  store.startRound(new Map(teams.map((team) => [team.id, fighter(team)])));
  store.setBattleNote('');
  run();
  settleRound(); // a round whose matches the host already decided
}

// Takes the current round off the game. Its unplayed matches wait for the host
// to start the round again (same seeds, same fights).
export function stopRound() {
  const battle = store.state.battle;
  const round = battle && currentRound(battle);
  if (!battle || !round || round.status !== 'playing') throw new store.UserError('No round is playing.');
  generation++;
  for (const match of roundMatches(battle, round.index)) {
    if (match.status === 'queued' && match.gameId) cancelQuietly(match.gameId);
  }
  store.stopRound();
  store.setBattleNote(`${round.name} stopped. Start it again to replay the unfinished matches.`);
}

// Plays a match again with a new seed. In a round that is playing, it goes on the game at once.
export function replay(matchId: string) {
  store.replayMatch(matchId, randomInt(0, 2 ** 32));
  run();
}

// The host picks the winner, e.g. for a match the game could not play.
export function setWinner(matchId: string, winner: string) {
  store.setWinner(matchId, winner);
  settleRound();
}

export function reset() {
  generation++;
  for (const match of store.state.battle?.matches ?? []) {
    if (match.status === 'queued' && match.gameId) cancelQuietly(match.gameId);
  }
  store.resetBattle();
}

// Called when the quiz server starts: a round that was playing carries on. A
// match already sent to the game is picked up there (if the game restarted
// too and forgot it, it is sent again with the same seed).
export function resume() {
  run();
}

// Starts a runner for every unfinished match of the current round, if it is playing.
function run() {
  const battle = store.state.battle;
  const round = battle && currentRound(battle);
  if (!battle || !round || round.status !== 'playing') return;
  const gen = generation;
  for (const match of roundMatches(battle, round.index)) {
    if ((match.status !== 'pending' && match.status !== 'queued') || running.has(match.id)) continue;
    running.add(match.id);
    runMatch(match.id, gen)
      .catch((err) => {
        console.error(`Match ${match.id} stopped with an error:`, err);
        if (gen === generation) store.failMatch(match.id, String(err));
      })
      .finally(() => {
        running.delete(match.id);
        // A runner from before a stop may leave a pending match behind: pick it up.
        run();
        settleRound();
      });
  }
}

// After a match ends: move on when the round is complete, or tell the host
// what needs a decision once nothing is left running.
function settleRound() {
  const battle = store.state.battle;
  const round = battle && currentRound(battle);
  if (!battle || !round || round.status === 'done') return;
  if (roundComplete(battle, round.index)) {
    store.finishRound();
    const next = store.state.battle && currentRound(store.state.battle);
    store.setBattleNote(store.state.battle?.champion ? '' : `${round.name} finished. Start the ${next?.name.toLowerCase()} when you are ready.`);
    return;
  }
  if (round.status !== 'playing') return;
  const stuck = roundMatches(battle, round.index).filter((m) => m.status === 'cancelled' || m.status === 'failed');
  if (stuck.length > 0 && !roundMatches(battle, round.index).some((m) => running.has(m.id))) {
    store.setBattleNote(`${stuck.map((m) => m.id).join(', ')} did not finish. Replay each one or pick its winner.`);
  }
}

async function runMatch(id: string, gen: number) {
  for (;;) {
    if (gen !== generation) return;
    const match = store.state.battle?.matches.find((m) => m.id === id);
    if (!match) return;
    // Sent before this server restarted: wait for the result on the game.
    if (match.status === 'queued' && match.gameId) {
      if ((await awaitResult(id, match.gameId, gen)) !== 'requeue') return;
      store.setMatchGame(id, null, 'pending');
      continue;
    }
    if (match.status !== 'pending') return;
    if (!match.fighters) {
      store.failMatch(id, 'No loadouts were copied for this match.');
      return;
    }
    const fighters = match.fighters;

    let queued: game.GameMatch | null;
    try {
      queued = await inOrder(async () => ((await waitForDisplay(gen)) ? game.queueMatch(fighters, match.seed, { tiebreak: 'hp' }) : null));
    } catch (err) {
      if (!(err instanceof game.GameApiError)) throw err;
      if (gen !== generation) return;
      // A loadout the game refuses fails just this match. Anything else is
      // usually the game server not being there: wait and try again.
      if (err.status > 0) {
        store.failMatch(id, err.message);
        return;
      }
      store.setBattleNote(err.message);
      await delay(RETRY_MS);
      continue;
    }
    if (!queued) return; // stopped while waiting for a display
    if (gen !== generation) {
      await cancelQuietly(queued.id);
      return;
    }

    store.setMatchGame(id, queued.id, 'queued');
    store.setBattleNote('');
    const outcome = await awaitResult(id, queued.id, gen);
    if (outcome !== 'requeue') return;
    store.setMatchGame(id, null, 'pending');
  }
}

// The game only plays a queued match while a display page is connected.
async function waitForDisplay(gen: number): Promise<boolean> {
  for (;;) {
    if (gen !== generation) return false;
    try {
      const status = await game.status();
      store.setGameStatus({ reachable: true, displays: status.displays });
      if (status.displays > 0) return true;
      store.setBattleNote('Open the game display page (?display). Matches do not play without one.');
    } catch (err) {
      store.setGameStatus({ reachable: false, displays: 0 });
      store.setBattleNote(err instanceof game.GameApiError ? err.message : String(err));
    }
    await delay(DISPLAY_WAIT_MS);
  }
}

// Waits for the display page to play the match.
async function awaitResult(id: string, gameId: string, gen: number): Promise<'next' | 'requeue' | 'stopped'> {
  for (;;) {
    if (gen !== generation) return 'stopped';
    let played: game.GameMatch;
    try {
      played = await game.getMatch(gameId, true);
    } catch (err) {
      if (!(err instanceof game.GameApiError)) throw err;
      if (gen !== generation) return 'stopped';
      // 404: the game restarted and forgot the match. Queue it again, same seed.
      if (err.status === 404) return 'requeue';
      if (err.status === 0) {
        await delay(RETRY_MS);
        continue;
      }
      store.failMatch(id, err.message);
      return 'next';
    }
    if (gen !== generation) return 'stopped';
    if (played.status === 'cancelled') {
      store.cancelMatch(id, 'Cancelled on the game server');
      return 'next';
    }
    if (played.status === 'done' && played.result) {
      const match = store.state.battle?.matches.find((m) => m.id === id);
      if (!match) return 'next';
      const { winner, reason, hp, time } = played.result;
      // The tiebreak means the game always names a winner. A game from before
      // the tiebreak can still report a draw; the host decides that one.
      if (winner === null) {
        store.cancelMatch(id, 'Draw. Replay it or pick the winner.');
        return 'next';
      }
      store.recordResult(id, { winner: winner === 0 ? match.a : match.b, decidedBy: reason === 'hp' ? 'hp' : 'ko', hp, time });
      return 'next';
    }
    await delay(500); // still queued or playing: ask again
  }
}

function checkLoadouts(teams: Team[]) {
  const catalog = store.getCatalog();
  const problems: string[] = [];
  for (const team of teams) {
    for (const problem of validateLoadout(team, catalog)) problems.push(`${team.name}: ${problem}`);
  }
  if (problems.length > 0) throw new store.UserError(`Fix these loadouts before the battle: ${problems.join('; ')}`);
}

function parseSeed(seed: unknown): number {
  const n = Number(seed);
  if (!Number.isInteger(n) || n < 0 || n >= 2 ** 32) throw new store.UserError('The seed must be a whole number from 0 to 4294967295.');
  return n;
}

function fighter(team: Team): Fighter {
  return { name: team.name, weapon: team.weapon, upgrades: { ...team.upgrades } };
}

// The game may already be gone; there is nothing to cancel then.
async function cancelQuietly(gameId: string) {
  try {
    await game.cancelMatch(gameId);
  } catch {
    // Ignored on purpose.
  }
}
