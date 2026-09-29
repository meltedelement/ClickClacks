// Runs the round-robin: queues one match at a time on the game's match API,
// waits for the display page's official result, records it, and moves on.
//
// The game plays a queued match only while a display page (?display) is
// connected, so the driver waits for one instead of queueing into the void. The
// game keeps its matches in memory only, so if it restarts the match on screen
// is queued again with the same seed — the same fight.
import { randomInt } from 'node:crypto';
import type { BattleMatch, Fighter, Team } from '../shared/types.ts';
import { buildSchedule, validateLoadout } from '../shared/battle.ts';
import * as game from './game.ts';
import * as store from './store.ts';

const DISPLAY_WAIT_MS = 2_000; // how often to look for a display page
const RETRY_MS = 3_000; // between attempts at a call that could not get through

let stopRequested = false;
let currentRun: Promise<void> | null = null;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Deal a fresh round-robin of every team against every other team and start
// playing it. Called every time the quiz reaches the battle phase, so a team
// that earned upgrades since the last battle fights with them. Throws before
// anything is queued when the teams or their loadouts are not ready, so the
// admin page can show the problem.
export async function start() {
  if (store.currentBattle()) throw new store.UserError('A battle is already running.');
  const teams = store.state.teams;
  if (teams.length < 2) throw new store.UserError('A battle needs at least two teams.');

  const catalog = store.getCatalog();
  const problems: string[] = [];
  for (const team of teams) {
    for (const problem of validateLoadout(team, catalog)) problems.push(`${team.name}: ${problem}`);
  }
  if (problems.length > 0) throw new store.UserError(`Fix these loadouts before the battle — ${problems.join('; ')}`);

  const battleId = `b${store.state.battles.length + 1}`;
  const byTeam = new Map(teams.map((team) => [team.id, team]));
  const matches: BattleMatch[] = buildSchedule(teams.map((team) => team.id), () => randomInt(0, 2 ** 32)).map(
    (pairing, i) => ({
      id: `${battleId}-m${i + 1}`,
      a: pairing.a,
      b: pairing.b,
      seed: pairing.seed,
      gameId: null,
      status: 'pending',
      fighters: [fighter(byTeam.get(pairing.a)), fighter(byTeam.get(pairing.b))],
      winner: null,
      hp: null,
      time: null,
    }),
  );

  store.beginBattle({ id: battleId, startedAt: new Date().toISOString(), finishedAt: null, matches, note: '' });
  stopRequested = false;
  run();
}

// Called when the quiz server starts: a battle that was interrupted continues,
// and the match that was on screen is queued again.
export function resume() {
  if (!store.currentBattle()) return;
  store.resetUnfinishedMatches();
  stopRequested = false;
  run();
}

// True while a battle has not finished. The driver may be between matches, so
// this is about the battle, not about a request being in flight.
export function running(): boolean {
  return store.currentBattle() !== null;
}

// End the battle on screen, cancelling whatever has not been played. Matches
// already played keep their results. The next trip to the battle phase deals a
// fresh round-robin.
export function stop(reason = 'Battle stopped.') {
  stopRequested = true;
  const battle = store.currentBattle();
  if (!battle) return;
  const active = activeMatch();
  if (active?.gameId) cancelQuietly(active.gameId);
  for (const match of battle.matches) {
    if (match.status === 'pending' || match.status === 'queued' || match.status === 'playing') {
      store.cancelMatch(match.id, reason);
    }
  }
  store.setBattleNote(reason);
  store.finishBattle();
}

// Stop the driver without ending the battle, so resync() can pick the same one
// up again.
function halt() {
  stopRequested = true;
  const active = activeMatch();
  if (active?.gameId) cancelQuietly(active.gameId);
  if (active) store.setMatchGame(active.id, null, 'pending');
}

// Give up on one match so the schedule can move on. It is cancelled rather than
// drawn, so it never counts in the standings.
export function skip(matchId: string) {
  const match = store.currentBattle()?.matches.find((m) => m.id === matchId);
  if (!match) throw new store.UserError('That match is not in the battle on screen.');
  if (match.status === 'done') throw new store.UserError('That match is already played.');
  if (match.gameId) cancelQuietly(match.gameId);
  store.cancelMatch(match.id, 'Skipped by the host');
}

// Start again with the teams' current loadouts. Played matches keep their
// results; the match on screen is dropped and queued again with a new snapshot.
export async function resync() {
  if (!store.currentBattle()) throw new store.UserError('No battle is running.');
  halt();
  await currentRun?.catch(() => {});
  store.resetUnfinishedMatches();
  const byTeam = new Map(store.state.teams.map((team) => [team.id, team]));
  store.resyncFighters(new Map([...byTeam].map(([id, team]) => [id, fighter(team)])));
  stopRequested = false;
  run();
}

function run() {
  if (currentRun) return;
  currentRun = drive()
    .catch((err) => console.error('Battle stopped with an error:', err))
    .finally(() => {
      currentRun = null;
    });
}

async function drive() {
  for (;;) {
    if (stopRequested) return;
    const battle = store.currentBattle();
    if (!battle) return;

    const next = battle.matches.find((match) => match.status === 'pending');
    if (!next) {
      store.setBattleNote('');
      store.finishBattle();
      return;
    }
    if (!(await waitForDisplay())) return;

    let queued: game.GameMatch;
    try {
      queued = await game.queueMatch(next.fighters, next.seed);
    } catch (err) {
      if (!(err instanceof game.GameApiError)) throw err;
      // A loadout the game refuses fails just this match. Anything else is
      // usually the game server not being there: wait and try again.
      if (err.status > 0) {
        store.failMatch(next.id, err.message);
        continue;
      }
      store.setBattleNote(err.message);
      await delay(RETRY_MS);
      continue;
    }

    store.setMatchGame(next.id, queued.id, 'queued');
    store.setBattleNote(`${nameOf(next.a)} vs ${nameOf(next.b)}`);

    const outcome = await awaitResult(next, queued.id);
    if (outcome === 'stopped') return;
    if (outcome === 'requeue') store.setMatchGame(next.id, null, 'pending');
  }
}

// The game only plays a queued match while a display page is connected.
async function waitForDisplay(): Promise<boolean> {
  for (;;) {
    if (stopRequested) return false;
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

// Waits for the display page to play the match on screen.
async function awaitResult(match: BattleMatch, gameId: string): Promise<'next' | 'requeue' | 'stopped'> {
  for (;;) {
    if (stopRequested) {
      await cancelQuietly(gameId);
      store.cancelMatch(match.id, 'Stopped');
      return 'stopped';
    }
    let played: game.GameMatch;
    try {
      played = await game.getMatch(gameId, true);
    } catch (err) {
      if (!(err instanceof game.GameApiError)) throw err;
      // 404: the game restarted and forgot the match. Queue it again, same seed.
      if (err.status === 404) return 'requeue';
      if (err.status === 0) {
        await delay(RETRY_MS);
        continue;
      }
      store.failMatch(match.id, err.message);
      return 'next';
    }
    if (played.status === 'cancelled') {
      store.cancelMatch(match.id, 'Cancelled on the display');
      return 'next';
    }
    if (played.status === 'done' && played.result) {
      store.recordResult(match.id, {
        winner: played.result.winner === null ? null : played.result.winner === 0 ? match.a : match.b,
        hp: played.result.hp,
        time: played.result.time,
      });
      return 'next';
    }
    await delay(500); // still queued or playing: ask again
  }
}

function activeMatch(): BattleMatch | undefined {
  return store.currentBattle()?.matches.find((match) => match.status === 'queued' || match.status === 'playing');
}

function nameOf(teamId: string): string {
  return store.state.teams.find((team) => team.id === teamId)?.name ?? 'a deleted team';
}

function fighter(team: Team | undefined): Fighter {
  if (!team) throw new Error('A team disappeared while the battle was being set up.');
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
