// The Tournament API: types for programs that run tournaments on the
// tournament service (tournament/, routes in tournament/README.md). The quiz
// (apps/quiz-of-doom/) is one such program. The tournament service plays each
// match on a game through the Match Host API (match-host.d.ts); callers never
// talk to the game.
//
// The service knows nothing about the game. Each entrant carries a `character`
// in the game's own format, and the tournament carries match `settings`; both
// go to the game as they are, and the game checks them. The types take the
// game's character (C) and result (R) as parameters, so a caller can type them:
// `Tournament<FighterInput, MatchResult>` for Weapon Balls.
//
// Copy this file (and match-host.d.ts, which it imports) into the calling
// project, or import it by path.
import type { HostResult } from './match-host.d.ts';

export type { HostResult } from './match-host.d.ts';

export type FormatId = 'double-elimination' | 'single-elimination' | 'round-robin';

/** GET /api/formats: one per format. */
export interface FormatInfo {
  id: FormatId;
  name: string;
  description: string;
  /** Settings for TournamentRequest.options, with what each does. */
  options: { key: keyof FormatOptions; description: string; default: number }[];
}

/** Format-specific settings. Unknown keys are ignored. */
export interface FormatOptions {
  /** Round robin: how many times each pair meets (1 or 2). Default 1. */
  legs?: number;
}

/** An entrant in the tournament, as the caller sends it. */
export interface EntrantInput<C = unknown> {
  /** Your id for this entrant, unique in the tournament. Matches, standings and winners use it. Public: don't use a secret. */
  id: string;
  /** The entrant's name, for people reading the tournament. The game gets only `character`. */
  name: string;
  /** A colour to show the entrant in, as "#rrggbb", or null. For people reading the tournament; the game gets only `character`. */
  color?: string | null;
  /** What the game gets for this entrant in each match, in the game's own format (for Weapon Balls a fighter, `FighterInput`). */
  character: C;
}

/** The game's settings for every match of a tournament, in the game's own format. Sent as the Match Host's `settings`. */
export type MatchSettings = Record<string, unknown>;

/** Body of POST /api/tournaments. */
export interface TournamentRequest<C = unknown> {
  format: FormatId;
  /** Two or more, each with a unique id. */
  entrants: EntrantInput<C>[];
  /** Shown to people, e.g. "Quiz battle". Optional. */
  name?: string;
  /** 0 to 2^32 - 1. The same seed and entrants give the same draw and the same fights. Random if left out. */
  seed?: number;
  /** Start each stage as soon as it is drawn. Default false: POST /start starts each one. */
  autoStart?: boolean;
  /** The game's settings for every match. Left out: the game's defaults. */
  match?: MatchSettings;
  options?: FormatOptions;
}

/** One item of the PATCH /api/tournaments/:id/entrants body. Only the given fields change. */
export type EntrantPatch<C = unknown> = Partial<Omit<EntrantInput<C>, 'id'>> & { id: string };

/**
 * Where an entrant is in the current stage.
 *   waiting   has a match in this stage, which has not started
 *   next      will have a match later in this stage (e.g. a losers bracket drawn once the winners bracket is done)
 *   fighting  its match of this stage is on the game, or about to be
 *   bye       no match in this stage, and still in
 *   through   won its match of this stage
 *   dropped   lost its match of this stage and moves to another bracket (double elimination)
 *   lost      lost its match of this stage and is still in (round robin)
 *   out       can no longer win
 *   champion  won the tournament
 */
export type EntrantState = 'waiting' | 'next' | 'fighting' | 'bye' | 'through' | 'dropped' | 'lost' | 'out' | 'champion';

export interface EntrantProgress {
  state: EntrantState;
  /** Entrant id of its opponent in this stage, if it has one. */
  opponent: string | null;
  /** Its bracket in this stage (`Group.side`), or null when out or the champion. */
  side: string | null;
  /** The name of that bracket, e.g. "Losers round 2". */
  bracket: string | null;
  wins: number;
  losses: number;
}

/** An entrant as the tournament holds it. */
export interface Entrant<C = unknown> {
  id: string;
  name: string;
  color: string | null;
  character: C;
  /** Why the game would refuse this character, as the game says it. Empty when it is fine (or the game has not been asked yet). */
  problems: string[];
  progress: EntrantProgress;
}

/** The entrants of one bracket in one stage. */
export interface Group {
  /** 'winners', 'losers' or 'final' (double elimination), 'main' (single elimination), 'league' (round robin). */
  side: string;
  /** "Winners semi-finals", "Losers round 2", "Grand final", "Quarter-finals", "Round 3", ... */
  name: string;
  /** Entrant ids in pairing order: entrants[0] v entrants[1], entrants[2] v entrants[3], ... */
  entrants: string[];
  /** The entrant with no match in this stage, or null. */
  bye: string | null;
  /** Not drawn yet: it waits for results earlier in the same stage, and `entrants` holds only those already known. */
  pending?: boolean;
}

/** waiting: drawn, not started. playing: its matches go to the game. done: every match has a winner. */
export type StageStatus = 'waiting' | 'playing' | 'done';

export interface Stage {
  index: number;
  name: string;
  status: StageStatus;
  groups: Group[];
}

/**
 * pending: not sent to the game yet. queued: sent, waiting for a screen.
 * playing: on a screen now. done: has a winner. cancelled / failed: needs a
 * replay or a winner from the caller; `error` says why.
 */
export type TournamentMatchStatus = 'pending' | 'queued' | 'playing' | 'done' | 'cancelled' | 'failed';

/** How a match was decided: 'manual' when the caller picked the winner (POST .../winner), otherwise the game's `reason` (e.g. "ko"). */
export type DecidedBy = 'manual' | (string & {});

export interface TournamentMatch<C = unknown, R extends HostResult = HostResult> {
  /** Unique in the tournament, e.g. "s2w1" (stage 2, winners match 1). */
  id: string;
  /** Index into `stages`. */
  stage: number;
  /** The `Group.side` it belongs to. */
  side: string;
  /** Entrant ids. In a grand final, the winners bracket champion comes first. */
  entrants: [string, string];
  /** The game seed: fixed by the tournament seed, so a match sent again is the same fight. */
  seed: number;
  status: TournamentMatchStatus;
  /** The game's match id while it is on the game. */
  hostMatchId: string | null;
  /** The game display screen (0-based) it is on, while it is on one. */
  screen: number | null;
  /** The entrants' characters it plays with, in `entrants` order, copied when its stage starts (or when it is drawn into a stage that is playing). */
  characters: C[] | null;
  /** Entrant id of the winner, once done. */
  winner: string | null;
  decidedBy: DecidedBy | null;
  /** The game's result, with character indices in `entrants` order. Null when not played, or decided by the caller. */
  result: R | null;
  error?: string;
}

/** The shape of one stage before it is drawn. */
export interface PlannedGroup {
  side: string;
  name: string;
  /** Entrants. */
  size: number;
}

export interface Standing {
  entrant: string;
  /** 1 is first. Entrants that can't be told apart share a rank. */
  rank: number;
  wins: number;
  losses: number;
  /** Round robin: points (a win is 1). Otherwise the same as `wins`. */
  points: number;
}

/** waiting: the current stage has not started. playing: it is on the game. done: there is a champion. */
export type TournamentStatus = 'waiting' | 'playing' | 'done';

export interface Tournament<C = unknown, R extends HostResult = HostResult> {
  id: string;
  name: string | null;
  format: FormatId;
  options: Required<FormatOptions>;
  seed: number;
  autoStart: boolean;
  /** Sent to the game with every match. Empty: the game's defaults. */
  match: MatchSettings;
  /** Goes up by one on every change. GET /api/tournaments/:id?wait=<version> waits for a higher one. */
  version: number;
  status: TournamentStatus;
  createdAt: string;
  finishedAt: string | null;
  entrants: Entrant<C>[];
  /** The stages drawn so far. The last one is the current stage. */
  stages: Stage[];
  matches: TournamentMatch<C, R>[];
  /** Every stage the tournament will have, by shape, as if the first entrant of every match wins. */
  plan: PlannedGroup[][];
  /** Best first. Final once `status` is 'done'. */
  standings: Standing[];
  champion: string | null;
  /** What the service is waiting for (a display page, the game server...), for the people running it. Empty when nothing. */
  note: string;
  /** Set when the game server forgot matches (it restarted) and they were sent again; cleared when a stage starts. */
  restart: { at: string; matches: string[] } | null;
}

/** GET /api/host: the game (the match host) the tournament service plays on. */
export interface HostLink {
  /** The Match Host API's address. */
  url: string;
  /** The game's display page: open it on the screen everyone watches. Empty until the game answers, or when it has none. */
  displayUrl: string;
  reachable: boolean;
  /** Display pages connected. Matches only play while this is above 0. */
  displays: number;
  /** Matches the display plays at the same time. */
  screens: number;
}

/** Body of POST /api/tournaments/:id/matches/:matchId/winner. */
export interface WinnerRequest {
  winner: string;
}

/** Body of POST /api/tournaments/:id/matches/:matchId/replay. */
export interface ReplayRequest {
  /** The new game seed. Random if left out. */
  seed?: number;
}

/** Every error response. */
export interface ApiError {
  error: string;
  /** POST /api/tournaments and PATCH .../entrants: the game's problems per entrant id, when that is why. */
  problems?: Record<string, string[]>;
}
