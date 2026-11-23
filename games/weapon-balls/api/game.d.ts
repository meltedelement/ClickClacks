// The Game API: types for programs that queue matches on Weapon Balls (the
// routes are in server/matches.js and the README's "Match API" section).
//
// It is a Match Host (contracts/match-host.d.ts at the repo root), which is all
// the tournament service knows of it. A Match Host's characters are Weapon
// Balls' fighters: `FighterInput` is the character format, `MatchSettings` the
// settings, `Catalog` the catalog. Programs that know the
// game (the quiz) use these types for what they put in those. Copy this file
// (and match-host.d.ts) into the calling project, or import it by path.
import type { HostMatch, HostMatchRequest, HostResult, HostStatus, HostValidateRequest, HostValidateResponse } from '../../../contracts/match-host.d.ts';

/** A fighter to put in a match: the game's character format. */
export interface FighterInput {
  /** Shown above the ball and in the winner banner. `team` works too. */
  name?: string;
  team?: string;
  /** Ball colour as "#rrggbb". Optional: without it the ball takes its weapon's colour. */
  color?: string;
  /** Draws a ring in the ball's colour around it, to pick it out of a crowd. Display only. Default false. */
  highlight?: boolean;
  /** How the ball is drawn (see `Skin`). Display only. Default null: a plain disc in its colour. */
  skin?: Skin | null;
  /** Up to 12 characters shown before the name ("DEV · Ana"), in the skin's colour. Display only. Default null. */
  tag?: string | null;
  /**
   * Starting size in a royale, 0.25 to 4. Default 1; ignored outside a royale.
   * Radius, blades, max HP and damage scale as if the ball had grown or shrunk to
   * it, and a kill hands over the mass that goes with it.
   */
  size?: number;
  /** Weapon id, e.g. "sword". See GET /api/catalog. */
  weapon: string;
  /** Upgrade ids (repeat an id to stack it), or { id: count }. No transformations here. */
  upgrades?: string[] | Record<string, number>;
  /** Transformation ids from `GET /api/catalog`, in the same forms. Applied before the upgrades. */
  transformations?: string[] | Record<string, number>;
}

/**
 * How a ball can be drawn. 'gold': the shiny gold dev orb. 'birthday': its own
 * colour with sprinkles, a party hat and confetti. 'rainbow': every colour, turning.
 * 'galaxy': deep space with twinkling stars. 'diamond': pale blue facets.
 * 'fire': a hot core with flames.
 */
export type Skin = 'gold' | 'birthday' | 'rainbow' | 'galaxy' | 'diamond' | 'fire';

/** The game's settings for one match: `MatchRequest.settings`. */
export interface MatchSettings {
  /** Sim seconds before the match is called a draw. Default 180, at most 600. */
  timeLimit?: number;
  /**
   * 'hp': the match never ends in a draw. At the time limit, or after a double
   * KO, the fighter with the most HP left (as a share of max HP) wins, and an
   * exact tie is a seeded coin flip. Default null: a draw is possible.
   */
  tiebreak?: 'hp' | null;
  /**
   * Sim seconds before sudden death: from then on both fighters lose HP every
   * second, more each second, until one drops. Default 120 (in a royale, it grows
   * with the crowd); null turns it off.
   */
  suddenDeath?: number | null;
  /**
   * A battle royale: the arena grows to fit the crowd, balls spawn spread over
   * it, and a kill hands the victim's mass to the killer. It plays to the server's
   * clock and the same in every browser, so any number of display pages can show
   * it together. Default false.
   */
  royale?: boolean;
  /**
   * Plays to the server's clock and the same in every browser, like a royale,
   * so any number of display pages show it at the same moment (a phone that
   * reloads catches up). No hitstop, and no End button. Always true for a
   * royale. Default false.
   */
  shared?: boolean;
  /**
   * Shared matches only: seconds between a display putting the match up and its
   * clock starting, counted down on every display, so they all start it together
   * (one still loading, or whose arena was hidden, doesn't join late and skip
   * ahead). `startedAt` is that moment. 0 to 30, default 3; always 0 for a match
   * that isn't shared.
   */
  startDelay?: number;
}

/**
 * Body of POST /api/matches. Two characters or more; more than two is a
 * free-for-all. `decisive: true` is the same as `settings.tiebreak: 'hp'`.
 */
export type MatchRequest = HostMatchRequest<FighterInput, MatchSettings>;

export interface Fighter {
  name: string | null;
  color: string | null;
  highlight: boolean;
  skin: Skin | null;
  tag: string | null;
  size: number;
  weapon: string;
  upgrades: string[];
  transformations: string[];
}

export type MatchStatus = 'queued' | 'playing' | 'done' | 'cancelled';

export interface MatchResult extends HostResult {
  /** Index into `characters`, or null for a draw. */
  winner: number | null;
  /** The winner's name, or its weapon id if it has no name. */
  winnerName: string | null;
  /** 'time' when a draw was called at the time limit, 'hp' when the hp tiebreak picked the winner. */
  reason: 'ko' | 'time' | 'hp';
  /** Sim seconds the match lasted. */
  time: number;
  /** HP left per fighter, in `characters` order. */
  hp: number[];
  /** The same as `hp`: the Match Host's tiebreak score. */
  scores: number[];
  /**
   * Fighter indices from first place to last: the winner, then fighters still
   * standing (most HP share first), then the knocked out, last out first.
   */
  ranking: number[];
}

export interface Match extends HostMatch<Fighter, MatchResult> {
  /** The caller's tag from the request, or null. */
  ref: string | null;
  status: MatchStatus;
  timeLimit: number;
  tiebreak: 'hp' | null;
  /** Sim seconds before sudden death starts, or null for none. */
  suddenDeath: number | null;
  /** Whether it's a battle royale (see MatchSettings). */
  royale: boolean;
  /** Whether it plays to the server's clock on every display (see MatchSettings). */
  shared: boolean;
  /** Seconds a shared match counts down before its clock starts (see MatchSettings); 0 if not shared. */
  startDelay: number;
  /** The display screen (0 to screens - 1) it went on, or null while it waits for a free one. */
  screen: number | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Set once status is 'done'. */
  result: MatchResult | null;
}

/** GET /api/status */
export interface Status extends HostStatus<Match> {
  /** Display pages connected. Matches only play while this is above 0. */
  displays: number;
  /** Matches the display plays at the same time (the SCREENS setting, 1 to 4). */
  screens: number;
  /** The matches on the screens now, playing or about to start. */
  onScreen: Match[];
  /** Matches not done yet, including the ones on screen. */
  queued: number;
  /** "/?display": the display page, on the game's own address. */
  displayPath: string;
}

/** Body of POST /api/validate: the characters (and optionally settings) to check. Nothing is queued. */
export type ValidateRequest = HostValidateRequest<FighterInput, MatchSettings>;

/** POST /api/validate: one entry per character, in order. `error` is what POST /api/matches would say. */
export type ValidateResponse = HostValidateResponse;

/** One entry in `Catalog.upgrades` or `Catalog.transformations`. */
export interface CatalogUpgrade {
  id: string;
  name: string;
  description: string;
  /** Weapon ids it fits, or null for any weapon. */
  weapons: string[] | null;
  /** Upgrade ids a fighter must also have. */
  requires: string[];
  /** Not offered to a fighter that has one of these (it would do nothing). Allowed in a loadout. */
  excludedBy: string[];
  /** null means no limit. */
  maxStacks: number | null;
  /** What several copies do together: entry i is for i + 2 copies (`description` is for one), up to `maxStacks` or 30. Empty when it can't stack. */
  stacked?: string[];
}

/** GET /api/catalog */
export interface Catalog {
  weapons: { id: string; name: string }[];
  /** Small upgrades. They go in `FighterInput.upgrades`. */
  upgrades: CatalogUpgrade[];
  /** Big upgrades that reshape the weapon. They go in `FighterInput.transformations`. */
  transformations: CatalogUpgrade[];
}

/** Every error response. */
export interface ApiError {
  error: string;
}
