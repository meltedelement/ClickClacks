// Types for programs calling the match API (see matches.js for the routes).
// Copy this file into the calling project, or import it by path.

/** A fighter to put in a match. */
export interface FighterInput {
  /** Shown above the ball and in the winner banner. `team` works too. */
  name?: string;
  team?: string;
  /** Weapon id, e.g. "sword". See GET /api/catalog. */
  weapon: string;
  /** Upgrade ids (repeat an id to stack it), or { id: count }. */
  upgrades?: string[] | Record<string, number>;
}

/** Body of POST /api/matches. */
export interface MatchRequest {
  fighters: [FighterInput, FighterInput];
  /** 0 to 2^32 - 1. The same seed and fighters give the same fight. Random if left out. */
  seed?: number;
  /** Sim seconds before the match is called a draw. Default 180, at most 600. */
  timeLimit?: number;
}

export interface Fighter {
  name: string | null;
  weapon: string;
  upgrades: string[];
}

export type MatchStatus = 'queued' | 'playing' | 'done' | 'cancelled';

export interface MatchResult {
  /** Index into `fighters`, or null for a draw. */
  winner: 0 | 1 | null;
  /** The winner's name, or its weapon id if it has no name. */
  winnerName: string | null;
  /** 'time' when a draw was called at the time limit. */
  reason: 'ko' | 'time';
  /** Sim seconds the match lasted. */
  time: number;
  /** HP left per fighter. */
  hp: [number, number];
}

export interface Match {
  id: string;
  status: MatchStatus;
  fighters: [Fighter, Fighter];
  seed: number;
  timeLimit: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Set once status is 'done'. */
  result: MatchResult | null;
}

/** GET /api/status */
export interface Status {
  /** Display pages connected. Matches only play while this is above 0. */
  displays: number;
  /** The match on screen (or next to go on screen). */
  current: Match | null;
  /** Matches not done yet, including the current one. */
  queued: number;
}

/** GET /api/catalog */
export interface Catalog {
  weapons: { id: string; name: string }[];
  upgrades: {
    id: string;
    name: string;
    description: string;
    /** Weapon ids it fits, or null for any weapon. */
    weapons: string[] | null;
    /** Upgrade ids a fighter must also have. */
    requires: string[];
    /** null means no limit. */
    maxStacks: number | null;
    /** A big upgrade that reshapes the weapon. */
    transformation: boolean;
  }[];
}

/** Every error response. */
export interface ApiError {
  error: string;
}
