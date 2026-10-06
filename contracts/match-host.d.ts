// The Match Host API: what a game implements so that other programs can play
// matches on it. The tournament service (tournament/) is the caller; Weapon
// Balls (games/weapon-balls/server/matches.js) is one host.
//
// A caller never looks inside a character, the match settings or the catalog:
// they are the game's own formats, and only the game checks them. The caller
// sends them as it got them, and asks the game (POST /validate) whether they
// are fine. Copy this file into the calling project, or import it by path.
//
//   GET    /status              displays connected, matches on screen, queue length
//   GET    /catalog             the game's description of itself (its own format)
//   POST   /validate            check characters and settings, without queueing anything
//   POST   /matches             queue a match -> HostMatch (201)
//   GET    /matches?ref=        the matches queued with that ref, oldest first
//   GET    /matches/:id         one match; ?wait=1 holds the request until it is done or cancelled
//   DELETE /matches/:id         cancel a match that is not done
//
// A host may play its matches on display pages (a screen people watch). It
// then plays queued matches only while one is connected, and reports how many
// with `displays`. A host that needs no display reports 1.

/** Body of POST /matches. */
export interface HostMatchRequest<C = unknown, S = Record<string, unknown>> {
  /** Two or more, in the game's own format. */
  characters: C[];
  /** Any tag of the caller's, up to 200 characters. Echoed on the match; GET /matches?ref= finds it. */
  ref?: string | null;
  /** 0 to 2^32 - 1. The same seed, characters and settings give the same match. Random if left out. */
  seed?: number;
  /** true: the match must name a winner. The game breaks a tie its own way. Default false: a draw is possible. */
  decisive?: boolean;
  /** The game's own settings for this match. Left out: the game's defaults. */
  settings?: S;
}

export type HostMatchStatus = 'queued' | 'playing' | 'done' | 'cancelled';

/** A finished match. Games add their own fields (Weapon Balls adds `time` and `hp`). */
export interface HostResult {
  /** Index into `characters`, or null for a draw. Never null for a decisive match. */
  winner: number | null;
  /** How the match was decided, in the game's words, e.g. "ko". */
  reason: string;
  /** Character indices from first place to last. */
  ranking: number[];
  /**
   * Optional: a number per character, higher is better (Weapon Balls: HP left).
   * Callers use it only to tell apart entrants with the same record, e.g. a
   * round robin's margin.
   */
  scores?: number[];
}

export interface HostMatch<C = unknown, R extends HostResult = HostResult> {
  id: string;
  ref: string | null;
  status: HostMatchStatus;
  /** The characters as the game holds them (it may have tidied up the ones it was sent). */
  characters: C[];
  seed: number;
  /** The display screen (0-based) it went on, or null while it waits for one. */
  screen: number | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Set once status is 'done'. */
  result: R | null;
}

/** GET /status */
export interface HostStatus<M extends HostMatch = HostMatch> {
  /** Display pages connected. Queued matches play only while this is above 0. */
  displays: number;
  /** Matches the host plays at the same time. */
  screens: number;
  /** The matches on the screens now, playing or about to start. */
  onScreen: M[];
  /** Matches not done yet, including the ones on screen. */
  queued: number;
  /** Where the display page is, relative to the API's origin (e.g. "/?display"), or null for a host without one. */
  displayPath: string | null;
}

/** Body of POST /validate. */
export interface HostValidateRequest<C = unknown, S = Record<string, unknown>> {
  characters: C[];
  settings?: S;
}

/** POST /validate: one entry per character, in order. Each `error` is what POST /matches would say. */
export interface HostValidateResponse {
  characters: { valid: boolean; error: string | null }[];
  /** What is wrong with the settings, or null when they are fine (or were not sent). */
  settings: string | null;
}

/** Every error response. */
export interface HostApiError {
  error: string;
}
