// Client for the Game API (server/matches.js in the repo root, types in
// api/game.d.ts).
//
//   const s = await game.status();                        // display pages connected
//   const match = await game.queueMatch({ fighters, seed, tiebreak: 'hp' });
//   const done = await game.getMatch(match.id, true);     // holds until it is played
//
// GAME_API points at the game server. `npm start` in the repo root serves it on
// http://localhost:3002/api; `npm run dev` serves it on http://localhost:5173/api.
import type { Catalog, FighterInput, Match, MatchRequest, Status, ValidateResponse } from '../../api/game.d.ts';

export const GAME_API = (process.env.GAME_API ?? 'http://127.0.0.1:3002/api').replace(/\/+$/, '');
// The display page: the game's own page with ?display.
export const DISPLAY_URL = `${GAME_API.replace(/\/api$/, '')}/?display`;

const CONTROL_TIMEOUT_MS = 5_000;
const WAIT_TIMEOUT_MS = 15 * 60_000; // a match can take minutes on screen

// Thrown for anything that stopped a call. `status` is 0 when the game server
// could not be reached at all, and the HTTP status otherwise (400 for a bad
// loadout, 404 once the game has forgotten a match after a restart).
export class GameApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GameApiError';
    this.status = status;
  }
}

export function status(): Promise<Status> {
  return request<Status>('/status');
}

export function catalog(): Promise<Catalog> {
  return request<Catalog>('/catalog');
}

// Why the game would refuse each fighter, or null for one it takes.
export async function validate(fighters: FighterInput[]): Promise<(string | null)[]> {
  if (fighters.length === 0) return [];
  const res = await request<ValidateResponse>('/validate', { method: 'POST', body: { fighters } });
  return res.fighters.map((f) => (f.valid ? null : f.error));
}

export function queueMatch(match: MatchRequest): Promise<Match> {
  return request<Match>('/matches', { method: 'POST', body: match });
}

// With `wait`, the request stays open until the match is done or cancelled.
export function getMatch(id: string, wait = false): Promise<Match> {
  return request<Match>(`/matches/${encodeURIComponent(id)}${wait ? '?wait=1' : ''}`, {
    timeout: wait ? WAIT_TIMEOUT_MS : CONTROL_TIMEOUT_MS,
  });
}

// The matches queued with this `ref`, oldest first.
export function findMatches(ref: string): Promise<Match[]> {
  return request<Match[]>(`/matches?ref=${encodeURIComponent(ref)}`);
}

export function cancelMatch(id: string): Promise<Match> {
  return request<Match>(`/matches/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
}

async function request<T>(path: string, { method = 'GET', body, timeout = CONTROL_TIMEOUT_MS }: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GAME_API}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new GameApiError(0, `Game API not reachable at ${GAME_API}. Is the game server running?`);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body is only useful through the status below.
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Game API error (${res.status})`;
    throw new GameApiError(res.status, message);
  }
  return data as T;
}
