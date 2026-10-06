// Client for the Match Host API (contracts/match-host.d.ts in the repo root):
// the game the tournament plays its matches on. Nothing here knows which game
// that is. Characters, settings and the catalog are the game's own formats, sent
// and passed on as they are.
//
//   const s = await host.status();                           // display pages connected
//   const match = await host.queueMatch({ characters, seed, decisive: true });
//   const done = await host.getMatch(match.id, true);        // holds until it is played
//
// HOST_API points at the game's Match Host API. Weapon Balls serves it on
// http://localhost:3002/api with `npm start`, and on http://localhost:5173/api
// with `npm run dev`.
import type { HostMatch, HostMatchRequest, HostStatus, HostValidateResponse } from '../../contracts/match-host.d.ts';
import type { MatchSettings } from '../../contracts/tournament.d.ts';

export const HOST_API = (process.env.HOST_API ?? 'http://127.0.0.1:3002/api').replace(/\/+$/, '');

const CONTROL_TIMEOUT_MS = 5_000;
const WAIT_TIMEOUT_MS = 15 * 60_000; // a match can take minutes on screen

// Thrown for anything that stopped a call. `status` is 0 when the game could
// not be reached at all, and the HTTP status otherwise (400 for a character the
// game refuses, 404 once the game has forgotten a match after a restart).
export class HostApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HostApiError';
    this.status = status;
  }
}

// The display page's full address, from the path the game gives in its status.
export function displayUrl(status: HostStatus): string {
  return status.displayPath === null ? '' : new URL(status.displayPath, HOST_API).href;
}

export function status(): Promise<HostStatus> {
  return request<HostStatus>('/status');
}

export function catalog(): Promise<unknown> {
  return request<unknown>('/catalog');
}

// Why the game would refuse each character (null for one it takes), and the settings.
export async function validate(characters: unknown[], settings: MatchSettings): Promise<{ characters: (string | null)[]; settings: string | null }> {
  const res = await request<HostValidateResponse>('/validate', { method: 'POST', body: { characters, settings } });
  return { characters: res.characters.map((c) => (c.valid ? null : c.error)), settings: res.settings ?? null };
}

export function queueMatch(match: HostMatchRequest): Promise<HostMatch> {
  return request<HostMatch>('/matches', { method: 'POST', body: match });
}

// With `wait`, the request stays open until the match is done or cancelled.
export function getMatch(id: string, wait = false): Promise<HostMatch> {
  return request<HostMatch>(`/matches/${encodeURIComponent(id)}${wait ? '?wait=1' : ''}`, {
    timeout: wait ? WAIT_TIMEOUT_MS : CONTROL_TIMEOUT_MS,
  });
}

// The matches queued with this `ref`, oldest first.
export function findMatches(ref: string): Promise<HostMatch[]> {
  return request<HostMatch[]>(`/matches?ref=${encodeURIComponent(ref)}`);
}

export function cancelMatch(id: string): Promise<HostMatch> {
  return request<HostMatch>(`/matches/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
}

async function request<T>(path: string, { method = 'GET', body, timeout = CONTROL_TIMEOUT_MS }: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${HOST_API}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new HostApiError(0, `The game is not reachable at ${HOST_API}. Is its server running?`);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body is only useful through the status below.
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Match Host API error (${res.status})`;
    throw new HostApiError(res.status, message);
  }
  return data as T;
}
