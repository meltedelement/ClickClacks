// Plays tournaments on the game. When a stage starts, every match of it is sent
// to the Match Host API at once, in match order (so match 1 goes on screen 1). The
// runner waits for the display page's official result for each match and
// records it. A format may draw more matches inside the stage once results are
// in (the double elimination's losers bracket); those go to the game as soon as
// they are drawn. When every match of the stage has a winner, the next stage is
// drawn and waits for the caller (or starts at once with `autoStart`).
//
// The game plays a queued match only while a display page (?display) is
// connected, so the runner waits for one instead of queueing into the void.
// The game keeps its matches in memory only, so if it restarts, a match that
// was sent is queued again with the same seed: the same fight. Each match is
// sent with `ref: "<tournament id>/<match id>"`, so after this service restarts
// it finds a match it sent but had not saved yet, instead of sending it twice.
//
// Every match is sent with `decisive: true`: a tournament needs a winner, and
// the game breaks ties its own way. A draw (from a game that can't) is left for
// the caller to replay or decide.
import { randomInt } from 'node:crypto';
import type { Entrant, EntrantPatch, HostLink, Tournament, TournamentRequest } from '../../contracts/tournament.d.ts';
import { currentStage, stageComplete, stageMatches } from '../formats/common.ts';
import { getFormat } from '../formats/index.ts';
import * as host from './host.ts';
import * as store from './store.ts';
import { ApiError } from './store.ts';

const DISPLAY_WAIT_MS = 2_000; // how often to look for a display page
const RETRY_MS = 3_000; // between attempts at a call that could not get through
const POLL_MS = 500; // between reads of a match that is still on the game

// Goes up each time a stage is stopped or a tournament deleted. A runner
// started before that sees the change and quits without touching the state.
const generations = new Map<string, number>();
const generation = (t: Tournament) => generations.get(t.id) ?? 0;
const bump = (t: Tournament) => generations.set(t.id, generation(t) + 1);
const running = new Set<string>(); // `${tournament id}/${match id}` of matches with a runner
const key = (t: Tournament, matchId: string) => `${t.id}/${matchId}`;

// Matches go to the game one after another, in the order they are started.
let sendChain: Promise<unknown> = Promise.resolve();

function inOrder<T>(fn: () => Promise<T>): Promise<T> {
  const result = sendChain.then(fn);
  sendChain = result.catch(() => {});
  return result;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- The game ------------------------------------------------------------------

export const link: HostLink = { url: host.HOST_API, displayUrl: '', reachable: false, displays: 0, screens: 0 };
const linkListeners = new Set<() => void>();

export function onLinkChange(fn: () => void) {
  linkListeners.add(fn);
}

function setLink(status: Awaited<ReturnType<typeof host.status>> | null) {
  const next = {
    reachable: status !== null,
    displays: status?.displays ?? 0,
    screens: status?.screens ?? 0,
    displayUrl: status ? host.displayUrl(status) : link.displayUrl, // the last known one while the game is down
  };
  const changed = next.reachable !== link.reachable || next.displays !== link.displays || next.screens !== link.screens || next.displayUrl !== link.displayUrl;
  Object.assign(link, next);
  if (changed) for (const fn of linkListeners) fn();
  if (!status) return;
  const onScreen = new Map(status.onScreen.filter((m) => m.screen !== null).map((m) => [m.id, { screen: m.screen as number, playing: m.status === 'playing' }]));
  for (const t of store.list()) if (t.status === 'playing') store.setScreens(t, onScreen);
}

// Keeps `link` and the screen of each match up to date. Called on a timer.
export async function pingGame() {
  try {
    setLink(await host.status());
  } catch {
    setLink(null);
  }
}

// The game's problems with each entrant's character, or null when the game could
// not be asked. Settings the game refuses are a 400: only the caller can fix them.
async function checkEntrants(t: Tournament, entrants: Entrant[]): Promise<Map<string, string[]> | null> {
  let checked;
  try {
    checked = await host.validate(entrants.map(store.character), t.match);
  } catch (err) {
    if (err instanceof host.HostApiError) return null;
    throw err;
  }
  if (checked.settings) throw new ApiError(400, `The game refuses the match settings: ${checked.settings}`);
  return new Map(entrants.map((e, i) => [e.id, checked.characters[i] ? [checked.characters[i] as string] : []]));
}

function problemsOf(entrants: Entrant[]): Record<string, string[]> | null {
  const found = entrants.filter((e) => e.problems.length > 0);
  return found.length > 0 ? Object.fromEntries(found.map((e) => [e.id, e.problems])) : null;
}

function describe(problems: Record<string, string[]>, t: { entrants: Entrant[] }): string {
  return Object.entries(problems)
    .map(([id, list]) => `${t.entrants.find((e) => e.id === id)?.name ?? id}: ${list.join('; ')}`)
    .join(' · ');
}

// ---- Caller actions ------------------------------------------------------------

// Draws the tournament after the game has checked every character. A character the
// game refuses is a 400. If the game can't be reached the tournament is still
// drawn, and the characters are checked again when each stage starts.
export async function create(body: TournamentRequest): Promise<Tournament> {
  const t = store.build(body);
  const problems = await checkEntrants(t, t.entrants);
  if (problems) {
    for (const e of t.entrants) e.problems = problems.get(e.id) ?? [];
    const bad = problemsOf(t.entrants);
    if (bad) throw new ApiError(400, `The game refuses these characters: ${describe(bad, t)}`, bad);
  } else {
    t.note = 'The game could not check the characters (it is not reachable). They are checked again when a stage starts.';
  }
  store.add(t);
  if (t.autoStart) await startStage(t);
  return t;
}

// Changes entrants. The game checks the changed characters; a refused one is kept
// with its `problems`, and its stage can't start until it is fixed.
export async function patchEntrants(t: Tournament, patches: EntrantPatch[]): Promise<Tournament> {
  const changed = store.patchEntrants(t, patches);
  const problems = await checkEntrants(t, changed);
  if (problems) store.setProblems(t, problems);
  return t;
}

// Sends every unplayed match of the current stage to the game, with the
// entrants' characters as they are now.
export async function startStage(t: Tournament) {
  const ready = () => {
    const stage = currentStage(t);
    if (!stage) throw new ApiError(409, 'The tournament has no stage.');
    if (t.champion) throw new ApiError(409, 'The tournament is over.');
    if (stage.status !== 'waiting') throw new ApiError(409, `${stage.name} already started.`);
    return stage;
  };
  const stage = ready();
  // Also the entrants of a group not drawn yet: they play later in the stage.
  const ids = new Set(stage.groups.flatMap((g) => g.entrants));
  const entrants = t.entrants.filter((e) => ids.has(e.id));
  const problems = await checkEntrants(t, entrants);
  if (problems) store.setProblems(t, problems);
  const bad = problemsOf(entrants);
  if (bad) throw new ApiError(400, `Fix these characters first: ${describe(bad, t)}`, bad);
  ready(); // another request may have started it while the game was checking
  store.startStage(t);
  run(t);
  settle(t); // a stage whose matches the caller already decided
}

// Takes the current stage off the game. Its unplayed matches wait until the
// stage is started again (same seeds, same fights).
export function stopStage(t: Tournament) {
  const stage = currentStage(t);
  if (!stage || stage.status !== 'playing') throw new ApiError(409, 'No stage is playing.');
  bump(t);
  for (const match of stageMatches(t, stage.index)) {
    if ((match.status === 'queued' || match.status === 'playing') && match.hostMatchId) void cancelQuietly(match.hostMatchId);
  }
  store.stopStage(t);
  store.setNote(t, `${stage.name} stopped. Start it again to replay the unfinished matches.`);
}

// Plays a match again with a new seed. In a stage that is playing, it goes on the game at once.
export function replay(t: Tournament, matchId: string, seed?: number) {
  checkDependents(t, matchId);
  store.replayMatch(t, matchId, seed === undefined ? randomInt(0, 2 ** 32) : store.parseSeed(seed));
  run(t);
}

// The caller picks the winner, e.g. for a match the game could not play.
export function setWinner(t: Tournament, matchId: string, winner: string) {
  checkDependents(t, matchId);
  store.setWinner(t, matchId, winner);
  settle(t); // the last match of a group decided can draw the next group
}

// Deletes the tournament, and takes its unfinished matches off the game.
export function remove(t: Tournament) {
  bump(t);
  for (const match of t.matches) {
    if ((match.status === 'queued' || match.status === 'playing') && match.hostMatchId) void cancelQuietly(match.hostMatchId);
  }
  store.remove(t);
}

// Called when the service starts: stages that were playing carry on. A match
// already sent to the game is picked up there (if the game restarted too and
// forgot it, it is sent again with the same seed).
export function resume() {
  for (const t of store.list()) {
    settle(t); // the service may have stopped between a result and the draw that follows it
    run(t);
  }
}

// Other matches of the stage were drawn from this one's result. To play it or
// decide it again, the format takes that draw back, so none of them may have
// started.
function checkDependents(t: Tournament, matchId: string) {
  const match = store.findMatch(t, matchId);
  const dependents = getFormat(t.format).dependents(t, match);
  if (dependents.some((m) => m.status === 'done')) {
    throw new ApiError(409, 'A match drawn from this one already has a result, so it cannot change now.');
  }
  if (dependents.some((m) => m.status === 'queued' || m.status === 'playing' || running.has(key(t, m.id)))) {
    throw new ApiError(409, 'Matches drawn from this one are on the game. Stop the stage first.');
  }
}

// ---- Running matches -----------------------------------------------------------

// Starts a runner for every unfinished match of the current stage, if it is playing.
function run(t: Tournament) {
  const stage = currentStage(t);
  if (!stage || stage.status !== 'playing') return;
  const gen = generation(t);
  for (const match of stageMatches(t, stage.index)) {
    const id = key(t, match.id);
    if (!['pending', 'queued', 'playing'].includes(match.status) || running.has(id)) continue;
    running.add(id);
    runMatch(t, match.id, gen)
      .catch((err) => {
        console.error(`Match ${id} stopped with an error:`, err);
        if (gen === generation(t)) store.endMatch(t, match.id, 'failed', String(err));
      })
      .finally(() => {
        running.delete(id);
        if (!store.list().includes(t)) return; // deleted
        // A runner from before a stop may leave a pending match behind: pick it up.
        run(t);
        settle(t);
      });
  }
}

// After a match ends: draw what can be drawn inside the stage, move on when the
// stage is complete, or say what needs a decision once nothing is left running.
function settle(t: Tournament) {
  if (!store.list().includes(t)) return;
  if (store.update(t)) run(t);
  const stage = currentStage(t);
  if (!stage || stage.status === 'done') return;
  if (stageComplete(t, stage.index)) {
    store.finishStage(t);
    const next = currentStage(t);
    if (t.champion) return store.setNote(t, '');
    if (t.autoStart) {
      startStage(t).catch((err) => store.setNote(t, `${next?.name} could not start: ${(err as Error).message}`));
      return;
    }
    store.setNote(t, `${stage.name} finished. ${next?.name} is drawn and waits to be started.`);
    return;
  }
  if (stage.status !== 'playing') return;
  const matches = stageMatches(t, stage.index);
  const stuck = matches.filter((m) => m.status === 'cancelled' || m.status === 'failed');
  if (stuck.length > 0 && !matches.some((m) => running.has(key(t, m.id)))) {
    store.setNote(t, `${stuck.map((m) => m.id).join(', ')} did not finish. Replay each one or pick its winner.`);
  }
}

async function runMatch(t: Tournament, id: string, gen: number) {
  for (;;) {
    if (gen !== generation(t)) return;
    const match = t.matches.find((m) => m.id === id);
    if (!match) return;
    // Sent before: wait for the result on the game.
    if ((match.status === 'queued' || match.status === 'playing') && match.hostMatchId) {
      if ((await awaitResult(t, id, match.hostMatchId, gen)) !== 'requeue') return;
      store.noteRestart(t, id);
      store.setHostMatch(t, id, null, 'pending');
      continue;
    }
    if (match.status !== 'pending') return;
    if (!match.characters) {
      store.endMatch(t, id, 'failed', 'No characters were copied for this match.');
      return;
    }
    const { characters, seed } = match;
    const ref = key(t, id);

    let queued: Awaited<ReturnType<typeof host.queueMatch>> | null;
    try {
      queued = await inOrder(async () => {
        if (!(await waitForDisplay(t, gen))) return null;
        // Sent just before this service stopped, and not saved: take that one.
        const sent = (await host.findMatches(ref)).find((m) => m.seed === seed && (m.status === 'queued' || m.status === 'playing'));
        return sent ?? host.queueMatch({ characters, seed, ref, decisive: true, settings: t.match });
      });
    } catch (err) {
      if (!(err instanceof host.HostApiError)) throw err;
      if (gen !== generation(t)) return;
      // A character the game refuses fails just this match. Anything else is
      // usually the game server not being there: wait and try again.
      if (err.status > 0) {
        store.endMatch(t, id, 'failed', err.message);
        return;
      }
      store.setNote(t, err.message);
      await delay(RETRY_MS);
      continue;
    }
    if (!queued) return; // stopped while waiting for a display
    if (gen !== generation(t)) {
      await cancelQuietly(queued.id);
      return;
    }

    store.setHostMatch(t, id, queued.id, 'queued');
    store.setNote(t, '');
    void pingGame(); // show its screen now, not at the next ping
    const outcome = await awaitResult(t, id, queued.id, gen);
    if (outcome !== 'requeue') return;
    store.noteRestart(t, id);
    store.setHostMatch(t, id, null, 'pending');
  }
}

// The game only plays a queued match while a display page is connected.
async function waitForDisplay(t: Tournament, gen: number): Promise<boolean> {
  for (;;) {
    if (gen !== generation(t)) return false;
    try {
      const status = await host.status();
      setLink(status);
      if (status.displays > 0) return true;
      store.setNote(t, `Open the game's display page${link.displayUrl ? ` (${link.displayUrl})` : ''}. Matches do not play without one.`);
    } catch (err) {
      setLink(null);
      store.setNote(t, err instanceof host.HostApiError ? err.message : String(err));
    }
    await delay(DISPLAY_WAIT_MS);
  }
}

// Waits for the display page to play the match.
async function awaitResult(t: Tournament, id: string, hostId: string, gen: number): Promise<'next' | 'requeue' | 'stopped'> {
  for (;;) {
    if (gen !== generation(t)) return 'stopped';
    let played;
    try {
      played = await host.getMatch(hostId, true);
    } catch (err) {
      if (!(err instanceof host.HostApiError)) throw err;
      if (gen !== generation(t)) return 'stopped';
      // 404: the game restarted and forgot the match. Queue it again, same seed.
      if (err.status === 404) return 'requeue';
      if (err.status === 0) {
        await delay(RETRY_MS);
        continue;
      }
      store.endMatch(t, id, 'failed', err.message);
      return 'next';
    }
    if (gen !== generation(t)) return 'stopped';
    if (played.status === 'cancelled') {
      store.endMatch(t, id, 'cancelled', 'Cancelled on the game server');
      return 'next';
    }
    if (played.status === 'done' && played.result) {
      const match = t.matches.find((m) => m.id === id);
      if (!match) return 'next';
      const { winner, reason } = played.result;
      // Matches are sent as decisive, so the game should always name a winner.
      // A game that can't break a tie reports a draw; the caller decides that one.
      if (winner === null) {
        store.endMatch(t, id, 'cancelled', 'Draw. Replay it or pick the winner.');
        return 'next';
      }
      store.recordResult(t, id, { winner: match.entrants[winner], decidedBy: reason, result: played.result });
      return 'next';
    }
    await delay(POLL_MS); // still queued or playing: ask again
  }
}

// The game may already be gone; there is nothing to cancel then.
async function cancelQuietly(hostId: string) {
  try {
    await host.cancelMatch(hostId);
  } catch {
    // Ignored on purpose.
  }
}
