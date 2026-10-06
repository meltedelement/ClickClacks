// The quiz's link to the tournament service (tournament/ in the repo root,
// API in contracts/tournament.d.ts there). The quiz never talks to the game:
// the tournament service plays the matches there and passes the game's catalog
// and status through. The tournament service knows nothing about Weapon Balls:
// each team goes to it as an entrant whose `character` is the game's
// `FighterInput`, which only the game reads.
//
//   - `current` mirrors the quiz's tournament, kept up to date from its event
//     stream (GET /tournaments/:id/events).
//   - `link` is whether the tournament service and the game behind it answer,
//     read every couple of seconds (GET /host).
//   - `sync()` sends the teams' names, colours and loadouts to the tournament
//     whenever they differ from what it holds. A stage takes the loadouts as
//     they are when it starts, so the quiz syncs before starting one.
//
// TOURNAMENT_API points at the tournament service (default http://127.0.0.1:3003/api).
import type { FighterInput } from '../../../games/weapon-balls/api/game.d.ts';
import type { EntrantInput, EntrantPatch, FormatId, FormatInfo, HostLink, TournamentRequest } from '../../../contracts/tournament.d.ts';
import type { Tournament } from '../shared/types.ts';

export const TOURNAMENT_API = (process.env.TOURNAMENT_API ?? 'http://127.0.0.1:3003/api').replace(/\/+$/, '');

const TIMEOUT_MS = 10_000; // a stage start asks the game to check every loadout first
const RECONNECT_MS = 2_000;

// Thrown for anything that stopped a call. `status` is 0 when the service
// could not be reached, and the HTTP status otherwise.
export class TournamentApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TournamentApiError';
    this.status = status;
  }
}

export let current: Tournament | null = null;
export const link = { reachable: false, host: null as HostLink | null };
export let formats: FormatInfo[] = [];

const listeners = new Set<() => void>();
export function onChange(fn: () => void) {
  listeners.add(fn);
}
function notify() {
  for (const fn of listeners) fn();
}

// ---- Requests ------------------------------------------------------------------

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${TOURNAMENT_API}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new TournamentApiError(0, `The tournament service is not reachable at ${TOURNAMENT_API}. Is it running?`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body is only useful through the status below.
  }
  if (!res.ok) throw new TournamentApiError(res.status, (data as { error?: string } | null)?.error ?? `Tournament API error (${res.status})`);
  return data as T;
}

// Every call that changes the tournament answers with it, so the mirror is fresh at once.
async function change(path: string, method: string, body?: unknown): Promise<Tournament> {
  const t = await request<Tournament>(path, method, body);
  setCurrent(t);
  return t;
}

function setCurrent(t: Tournament | null) {
  if (t && current && t.id === current.id && t.version < current.version) return; // an older copy
  current = t;
  notify();
}

export function create(format: FormatId, entrants: EntrantInput<FighterInput>[], seed?: number): Promise<Tournament> {
  const body: TournamentRequest<FighterInput> = { format, entrants, name: 'Quiz battle', ...(seed === undefined ? {} : { seed }) };
  return change('/tournaments', 'POST', body);
}

export const start = (id: string) => change(`/tournaments/${id}/start`, 'POST');
export const stop = (id: string) => change(`/tournaments/${id}/stop`, 'POST');
export const replay = (id: string, matchId: string) => change(`/tournaments/${id}/matches/${encodeURIComponent(matchId)}/replay`, 'POST', {});
export const setWinner = (id: string, matchId: string, winner: string) =>
  change(`/tournaments/${id}/matches/${encodeURIComponent(matchId)}/winner`, 'POST', { winner });

// Deletes the tournament there (its matches come off the game). Already gone is fine.
export async function remove(id: string) {
  try {
    await request(`/tournaments/${id}`, 'DELETE');
  } catch (err) {
    if (!(err instanceof TournamentApiError && err.status === 404)) throw err;
  }
  if (current?.id === id) setCurrent(null);
}

// ---- Keeping up ------------------------------------------------------------------

let onGone: ((id: string) => void) | null = null;
// Called when the tournament the quiz follows no longer exists on the service.
export function onDeleted(fn: (id: string) => void) {
  onGone = fn;
}

let followed: string | null = null;
let stream: AbortController | null = null;

// Follows the tournament with this id (null: none). The mirror updates on every
// change there. If the service drops the stream, it is opened again.
export function follow(id: string | null) {
  if (id === followed) return;
  followed = id;
  stream?.abort();
  stream = null;
  if (current && current.id !== id) setCurrent(null);
  if (id) void listen(id);
}

async function listen(id: string) {
  while (followed === id) {
    const controller = new AbortController();
    stream = controller;
    try {
      const res = await fetch(`${TOURNAMENT_API}/tournaments/${id}/events`, { signal: controller.signal });
      if (res.status === 404) {
        // Deleted there (or the service lost it): the quiz has no battle any more.
        if (followed === id) setCurrent(null);
        onGone?.(id);
        return;
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      let buffer = '';
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const message = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = message.split('\n').find((line) => line.startsWith('data: '));
          if (!data || followed !== id) continue;
          const t = JSON.parse(data.slice(6)) as Tournament | null;
          setCurrent(t);
          if (!t) {
            onGone?.(id);
            return;
          }
        }
      }
    } catch {
      // Dropped, or stopped by follow(); the loop decides.
    }
    if (followed === id) await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
  }
}

// Reads whether the service and the game answer, and the formats once.
export async function ping() {
  const before = JSON.stringify(link);
  try {
    link.host = await request<HostLink>('/host');
    link.reachable = true;
    if (formats.length === 0) formats = await request<FormatInfo[]>('/formats');
  } catch {
    link.reachable = false;
  }
  if (JSON.stringify(link) !== before) notify();
}

// ---- Entrants ------------------------------------------------------------------

// A team as this file needs it.
export interface TeamEntrant {
  id: string;
  name: string;
  color: string | null;
  weapon: string;
  upgrades: Record<string, number>;
  transformations: string[];
}

// The team as an entrant. Its character is what the game gets: the team's name
// and colour on the ball, and its loadout, with upgrades as a flat list in the
// order the team has them.
export function toEntrant(team: TeamEntrant): EntrantInput<FighterInput> {
  const color = team.color || null;
  return {
    id: team.id,
    name: team.name,
    color,
    character: {
      name: team.name,
      ...(color ? { color } : {}),
      weapon: team.weapon,
      upgrades: Object.entries(team.upgrades).flatMap(([id, n]) => Array(Math.max(0, n)).fill(id)),
      transformations: [...team.transformations],
    },
  };
}

let syncing: Promise<void> = Promise.resolve();

// Sends the teams whose entry in the tournament differs from them. Teams not in
// the tournament are skipped. Runs one at a time; resolves once the tournament has them.
export function sync(teams: TeamEntrant[]): Promise<void> {
  const next = syncing.then(async () => {
    const t = current;
    if (!t) return;
    const patches: EntrantPatch<FighterInput>[] = [];
    for (const team of teams) {
      const held = t.entrants.find((e) => e.id === team.id);
      if (!held) continue;
      const want = toEntrant(team);
      const same = held.name === want.name && held.color === want.color && JSON.stringify(held.character) === JSON.stringify(want.character);
      if (!same) patches.push(want);
    }
    if (patches.length > 0) await change(`/tournaments/${t.id}/entrants`, 'PATCH', patches);
  });
  syncing = next.catch(() => {});
  return next;
}
