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

// Start the round-robin. Throws before anything is queued when the teams or
// their loadouts are not ready, so the admin page can show the problem.
export async function start() {
  const teams = store.state.teams;
  if (teams.length < 2) throw new store.UserError('A battle needs at least two teams.');

  const catalog = store.getCatalog();
  const problems: string[] = [];
  for (const team of teams) {
    for (const problem of validateLoadout(team, catalog)) problems.push(`${team.name}: ${problem}`);
  }
  if (problems.length > 0) throw new store.UserError(`Fix these loadouts before the battle — ${problems.join('; ')}`);

  const byTeam = new Map(teams.map((team) => [team.id, team]));
  const matches: BattleMatch[] = buildSchedule(teams.map((team) => team.id), () => randomInt(0, 2 ** 32)).map(
    (pairing, i) => ({
      id: `m${i + 1}`,
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

  store.beginBattle(matches);
  stopRequested = false;
  run();
}

// Called when the quiz server starts: a battle that was interrupted continues,
// and the match that was on screen is queued again.
export function resume() {
  const battle = store.state.battle;
  if (!battle || battle.finishedAt) return;
  store.resetUnfinishedMatches();
  stopRequested = false;
  run();
}

// Stop the battle. The match on screen is cancelled on the game server too.
export function stop() {
  stopRequested = true;
  const active = activeMatch();
  if (active) {
    if (active.gameId) cancelQuietly(active.gameId);
    store.cancelMatch(active.id, 'Stopped');
  }
  store.setBattleNote('Battle stopped.');
}

// Give up on one match so the schedule can move on. It is cancelled rather than
// drawn, so it never counts in the standings.
export function skip(matchId: string) {
  const match = store.state.battle?.matches.find((m) => m.id === matchId);
  if (!match) throw new store.UserError('Unknown match.');
  if (match.status === 'done') throw new store.UserError('That match is already played.');
  if (match.gameId) cancelQuietly(match.gameId);
  store.cancelMatch(match.id, 'Skipped by the host');
}

// Start again with the teams' current loadouts. Played matches keep their
// results; the match on screen is dropped and queued again with a new snapshot.
export async function resync() {
  if (!store.state.battle) throw new store.UserError('No battle has been started.');
  stop();
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
    const battle = store.state.battle;
    if (!battle || battle.finishedAt) return;

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
  return store.state.battle?.matches.find((match) => match.status === 'queued' || match.status === 'playing');
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
