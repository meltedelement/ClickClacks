// Every tournament and the changes to it. Each change goes through `mutate`,
// which works out the derived fields (status, progress, standings), bumps the
// version, saves to data/tournaments.json and tells the listeners (the SSE
// streams and long polls in index.ts).
//
// Nothing here talks to the game; runner.ts does that and calls these. Nothing
// here looks inside a character or the match settings either: they are the
// game's, and only the game checks them.
import fs from 'node:fs';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import type { HostResult } from '../../contracts/match-host.d.ts';
import type { DecidedBy, Entrant, EntrantInput, EntrantPatch, Tournament, TournamentMatch, TournamentMatchStatus, TournamentRequest } from '../../contracts/tournament.d.ts';
import { currentStage, plan } from '../formats/common.ts';
import { getFormat, resolveOptions } from '../formats/index.ts';

const DATA_DIR = path.join(import.meta.dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'tournaments.json');
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// An error for the caller, with the HTTP status to send.
export class ApiError extends Error {
  status: number;
  problems?: Record<string, string[]>;

  constructor(status: number, message: string, problems?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.problems = problems;
  }
}

const tournaments = new Map<string, Tournament>();
const listeners = new Set<(t: Tournament, removed: boolean) => void>();

load();

function load() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as Tournament[];
    for (const t of saved) tournaments.set(t.id, t);
  } catch (err) {
    console.error(`Could not read ${DATA_FILE}; starting empty.`, err);
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify([...tournaments.values()], null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

export function onChange(fn: (t: Tournament, removed: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function list(): Tournament[] {
  return [...tournaments.values()];
}

export function get(id: string): Tournament {
  const t = tournaments.get(id);
  if (!t) throw new ApiError(404, `No tournament with id "${id}"`);
  return t;
}

// Runs `fn` on the tournament, then works out what follows from it and tells everyone.
export function mutate(t: Tournament, fn: () => void) {
  fn();
  derive(t);
  t.version++;
  save();
  for (const listener of listeners) listener(t, false);
}

function derive(t: Tournament) {
  const format = getFormat(t.format);
  const stage = currentStage(t);
  t.status = t.champion ? 'done' : stage?.status === 'playing' ? 'playing' : 'waiting';
  for (const entrant of t.entrants) entrant.progress = format.progress(t, entrant.id);
  t.standings = format.standings(t);
}

export function findMatch(t: Tournament, id: string): TournamentMatch {
  const match = t.matches.find((m) => m.id === id);
  if (!match) throw new ApiError(404, `No match with id "${id}" in this tournament`);
  return match;
}

// ---- Reading requests ----------------------------------------------------------

// Checks a TournamentRequest and builds the tournament. Nothing is stored yet:
// the caller validates the characters with the game first, then calls `add`.
export function build(body: TournamentRequest): Tournament {
  let format;
  let options;
  try {
    format = getFormat(body.format);
    options = resolveOptions(body.options);
  } catch (err) {
    throw new ApiError(400, (err as Error).message);
  }
  if (!Array.isArray(body.entrants) || body.entrants.length < 2) throw new ApiError(400, '"entrants" must be a list of two entrants or more');
  const entrants = body.entrants.map((input, i) => parseEntrant(input, `entrants[${i}]`));
  const seen = new Set<string>();
  for (const { id } of entrants) {
    if (seen.has(id)) throw new ApiError(400, `Two entrants have the id "${id}"`);
    seen.add(id);
  }
  if (body.name !== undefined && body.name !== null && typeof body.name !== 'string') throw new ApiError(400, '"name" must be a string');
  const seed = body.seed === undefined || body.seed === null ? randomInt(0, 2 ** 32) : parseSeed(body.seed);
  const match = parseMatchSettings(body.match);
  if (body.autoStart !== undefined && typeof body.autoStart !== 'boolean') throw new ApiError(400, '"autoStart" must be true or false');

  const ids = entrants.map((e) => e.id);
  const t: Tournament = {
    id: randomUUID(),
    name: body.name ?? null,
    format: format.id,
    options,
    seed,
    autoStart: body.autoStart ?? false,
    match,
    version: 0,
    status: 'waiting',
    createdAt: new Date().toISOString(),
    finishedAt: null,
    entrants,
    ...format.create(ids, seed, options),
    plan: plan(format, ids.length, options),
    standings: [],
    champion: null,
    note: '',
    restart: null,
  };
  derive(t);
  return t;
}

export function add(t: Tournament) {
  tournaments.set(t.id, t);
  mutate(t, () => {});
}

export function remove(t: Tournament) {
  tournaments.delete(t.id);
  save();
  for (const listener of listeners) listener(t, true);
}

function parseEntrant(input: EntrantInput, where: string): Entrant {
  if (!input || typeof input !== 'object') throw new ApiError(400, `${where} must be an object`);
  if (typeof input.id !== 'string' || !input.id) throw new ApiError(400, `${where}.id must be a non-empty string`);
  const entrant: Entrant = {
    id: input.id,
    name: '',
    color: null,
    character: null,
    problems: [],
    progress: { state: 'waiting', opponent: null, side: null, bracket: null, wins: 0, losses: 0 },
  };
  applyPatch(entrant, input, where);
  if (!entrant.name) throw new ApiError(400, `${where}.name must be a non-empty string`);
  if (input.character === undefined) throw new ApiError(400, `${where}.character is missing: what the game gets for this entrant`);
  return entrant;
}

// Copies the given fields onto the entrant, checking each.
function applyPatch(entrant: Entrant, patch: Partial<EntrantInput>, where: string) {
  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string' || !patch.name) throw new ApiError(400, `${where}.name must be a non-empty string`);
    entrant.name = patch.name;
  }
  if (patch.color !== undefined) {
    if (patch.color !== null && !(typeof patch.color === 'string' && HEX_COLOR.test(patch.color))) {
      throw new ApiError(400, `${where}.color must be a hex colour like "#e5484d", or null`);
    }
    entrant.color = patch.color;
  }
  // The game's to check (runner.ts asks it). A copy, so the caller's object is not shared.
  if (patch.character !== undefined) entrant.character = structuredClone(patch.character);
}

export function parseSeed(seed: unknown): number {
  if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) >= 2 ** 32) throw new ApiError(400, '"seed" must be a whole number from 0 to 2^32 - 1');
  return seed as number;
}

// The game's settings for every match. Only the game checks what is in them.
function parseMatchSettings(match: TournamentRequest['match']): Tournament['match'] {
  if (match === undefined || match === null) return {};
  if (typeof match !== 'object' || Array.isArray(match)) throw new ApiError(400, '"match" must be an object');
  return structuredClone(match);
}

// ---- Entrants ------------------------------------------------------------------

// The character the game gets for this entrant, as the caller gave it.
export function character(entrant: Entrant): unknown {
  return structuredClone(entrant.character);
}

export function entrant(t: Tournament, id: string): Entrant {
  const found = t.entrants.find((e) => e.id === id);
  if (!found) throw new ApiError(400, `No entrant with id "${id}" in this tournament`);
  return found;
}

// Checks every patch first, so a bad one changes nothing. Returns the entrants changed.
export function patchEntrants(t: Tournament, patches: EntrantPatch[]): Entrant[] {
  if (!Array.isArray(patches)) throw new ApiError(400, 'The body must be a list of entrant changes');
  const next = patches.map((patch, i) => {
    if (!patch || typeof patch !== 'object') throw new ApiError(400, `[${i}] must be an object`);
    const copy = structuredClone(entrant(t, patch.id));
    applyPatch(copy, patch, `[${i}]`);
    return copy;
  });
  mutate(t, () => {
    for (const changed of next) Object.assign(entrant(t, changed.id), changed);
  });
  return next.map((e) => entrant(t, e.id));
}

export function setProblems(t: Tournament, problems: Map<string, string[]>) {
  const changed = t.entrants.some((e) => problems.has(e.id) && JSON.stringify(e.problems) !== JSON.stringify(problems.get(e.id)));
  if (!changed) return;
  mutate(t, () => {
    for (const e of t.entrants) if (problems.has(e.id)) e.problems = problems.get(e.id)!;
  });
}

// ---- Stages and matches ----------------------------------------------------------

// The characters for a match, as the entrants are now.
function snapshot(t: Tournament, match: TournamentMatch) {
  match.characters = match.entrants.map((id) => character(entrant(t, id)));
}

// The current stage goes on the game. Its unplayed matches get the entrants' characters as they are now.
export function startStage(t: Tournament) {
  mutate(t, () => {
    const stage = currentStage(t)!;
    stage.status = 'playing';
    for (const match of t.matches) if (match.stage === stage.index && match.status === 'pending') snapshot(t, match);
    t.restart = null;
    t.note = '';
  });
}

// Draws what the format can draw inside the current stage. Matches drawn into
// a stage that is playing get their characters now. Returns true if anything was drawn.
export function update(t: Tournament): boolean {
  const stage = currentStage(t);
  const drawn = stage ? getFormat(t.format).update(t) : [];
  if (drawn.length === 0) return false;
  mutate(t, () => {
    if (stage!.status === 'playing') for (const match of drawn) snapshot(t, match);
  });
  return true;
}

// The current stage goes back to waiting. Matches sent to the game go back to
// pending (the runner cancels them there); played matches keep their result.
export function stopStage(t: Tournament) {
  mutate(t, () => {
    const stage = currentStage(t)!;
    stage.status = 'waiting';
    for (const match of t.matches) {
      if (match.stage === stage.index && (match.status === 'queued' || match.status === 'playing')) {
        Object.assign(match, { status: 'pending', hostMatchId: null, screen: null });
      }
    }
  });
}

// Every match in the current stage has a winner: draw the next stage, or crown the champion.
export function finishStage(t: Tournament) {
  mutate(t, () => {
    const stage = currentStage(t)!;
    const next = getFormat(t.format).advance(t);
    stage.status = 'done';
    if ('champion' in next) {
      t.champion = next.champion;
      t.finishedAt = new Date().toISOString();
    } else {
      t.stages.push(next.stage);
      t.matches.push(...next.matches);
    }
  });
}

export function setHostMatch(t: Tournament, id: string, hostMatchId: string | null, status: TournamentMatchStatus) {
  mutate(t, () => {
    const match = findMatch(t, id);
    Object.assign(match, { hostMatchId, status, screen: null });
  });
}

// Where the game has the tournament's matches on its display: { hostMatchId: { screen, playing } }.
export function setScreens(t: Tournament, onScreen: Map<string, { screen: number; playing: boolean }>) {
  const live = t.matches.filter((m) => m.hostMatchId && (m.status === 'queued' || m.status === 'playing'));
  const next = live.map((m) => {
    const where = onScreen.get(m.hostMatchId!);
    return { match: m, screen: where?.screen ?? null, status: (where?.playing ? 'playing' : 'queued') as TournamentMatchStatus };
  });
  if (next.every(({ match, screen, status }) => match.screen === screen && match.status === status)) return;
  mutate(t, () => {
    for (const { match, screen, status } of next) Object.assign(match, { screen, status });
  });
}

// A duplicate result (two displays, or a retry) does nothing.
export function recordResult(t: Tournament, id: string, outcome: { winner: string; decidedBy: DecidedBy; result: HostResult }) {
  const match = findMatch(t, id);
  if (match.status === 'done') return;
  mutate(t, () => {
    Object.assign(match, { status: 'done', screen: null, ...outcome });
    delete match.error;
  });
}

// The caller decides a match, e.g. one the game could not play.
export function setWinner(t: Tournament, id: string, winner: string) {
  const match = findMatch(t, id);
  if (!match.entrants.includes(winner)) throw new ApiError(400, 'The winner must be one of the two entrants of the match.');
  if (match.status === 'queued' || match.status === 'playing') throw new ApiError(409, 'That match is on the game now. Stop the stage first.');
  if (t.stages[match.stage]?.status === 'done') throw new ApiError(409, 'That stage is finished.');
  mutate(t, () => {
    getFormat(t.format).undo(t, match);
    Object.assign(match, { status: 'done', winner, decidedBy: 'manual', hostMatchId: null, screen: null, result: null });
    delete match.error;
  });
}

// The match is played again, with a new seed so it is a new fight.
export function replayMatch(t: Tournament, id: string, seed: number) {
  const match = findMatch(t, id);
  if (match.status === 'queued' || match.status === 'playing') throw new ApiError(409, 'That match is on the game now.');
  const stage = t.stages[match.stage];
  if (!stage || stage !== currentStage(t)) throw new ApiError(409, 'Only a match in the current stage can be played again.');
  mutate(t, () => {
    getFormat(t.format).undo(t, match);
    Object.assign(match, { status: 'pending', seed, hostMatchId: null, screen: null, winner: null, decidedBy: null, result: null });
    delete match.error;
    // Only the last stage can be replayed after it is done: that undoes the champion.
    if (stage.status === 'done') {
      stage.status = 'waiting';
      t.champion = null;
      t.finishedAt = null;
    }
  });
}

export function endMatch(t: Tournament, id: string, status: 'cancelled' | 'failed', error: string) {
  mutate(t, () => {
    const match = findMatch(t, id);
    Object.assign(match, { status, error, screen: null });
  });
}

export function setNote(t: Tournament, note: string) {
  if (t.note === note) return;
  mutate(t, () => {
    t.note = note;
  });
}

// The game forgot a match the service sent (it restarted), and it is sent
// again. Kept until the next stage starts, so people see why it started over.
export function noteRestart(t: Tournament, matchId: string) {
  mutate(t, () => {
    t.restart ??= { at: new Date().toISOString(), matches: [] };
    if (!t.restart.matches.includes(matchId)) t.restart.matches.push(matchId);
  });
}
