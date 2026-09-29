// Client for the game's match API (server/matches.js in the repo root).
//
//   const s = await game.status();                     // display pages connected
//   const match = await game.queueMatch(fighters, seed, { tiebreak: 'hp' });
//   const done = await game.getMatch(match.id, true);  // holds until it is played
//
// GAME_API points at the game server. `npm start` in the repo root serves it on
// http://localhost:3002/api; `npm run dev` serves it on http://localhost:5173/api.
export const GAME_API = (process.env.GAME_API ?? 'http://localhost:3002/api').replace(/\/+$/, '');

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

export interface GameFighterInput {
  name?: string;
  team?: string;
  color?: string; // "#rrggbb"; without it the ball takes its weapon's colour
  weapon: string;
  upgrades?: string[] | Record<string, number>;
  transformations?: string[] | Record<string, number>;
}

export interface GameResult {
  winner: 0 | 1 | null; // null is a draw (never with the 'hp' tiebreak)
  winnerName: string | null;
  reason: 'ko' | 'time' | 'hp'; // 'hp': the tiebreak picked the winner at the time limit or after a double KO
  time: number; // sim seconds
  hp: [number, number];
}

export interface GameMatch {
  id: string;
  status: 'queued' | 'playing' | 'done' | 'cancelled';
  fighters: { name: string | null; color: string | null; weapon: string; upgrades: string[]; transformations: string[] }[];
  seed: number;
  timeLimit: number;
  tiebreak: 'hp' | null;
  screen: number | null; // the display screen it plays on, once it has one
  queuedAt: string;
  result: GameResult | null;
}

export interface GameStatus {
  displays: number;
  screens: number; // matches the display plays at the same time
  onScreen: GameMatch[];
  current: GameMatch | null;
  queued: number;
}

export function status(): Promise<GameStatus> {
  return request<GameStatus>('/status');
}

export interface QueueOptions {
  timeLimit?: number;
  tiebreak?: 'hp' | null;
}

export function queueMatch(fighters: GameFighterInput[], seed: number, { timeLimit, tiebreak }: QueueOptions = {}): Promise<GameMatch> {
  return request<GameMatch>('/matches', {
    method: 'POST',
    body: { fighters, seed, ...(timeLimit === undefined ? {} : { timeLimit }), ...(tiebreak ? { tiebreak } : {}) },
  });
}

// With `wait`, the request stays open until the match is done or cancelled.
export function getMatch(id: string, wait = false): Promise<GameMatch> {
  return request<GameMatch>(`/matches/${encodeURIComponent(id)}${wait ? '?wait=1' : ''}`, {
    timeout: wait ? WAIT_TIMEOUT_MS : CONTROL_TIMEOUT_MS,
  });
}

export function cancelMatch(id: string): Promise<GameMatch> {
  return request<GameMatch>(`/matches/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function reachable(): Promise<boolean> {
  try {
    await status();
    return true;
  } catch {
    return false;
  }
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
