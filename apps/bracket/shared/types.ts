// What the phones and the host page are sent. Names are for showing; a player's
// token is the secret and is never in any of these.
import type { FighterInput, MatchResult, Skin } from '../../../games/weapon-balls/api/game.d.ts';
import type { EntrantState, Tournament, TournamentMatchStatus } from '../../../contracts/tournament.d.ts';
import type { StepKind } from '../../royale/shared/draft.ts';

/** The tournament as the tournament service holds it, with Weapon Balls' fighters and results. */
export type BracketTournament = Tournament<FighterInput, MatchResult>;

/**
 * lobby: no tournament; players join and draft. picking: a stage is drawn and
 * waits for everyone's new pick. playing: its matches are on the game. done: there is a champion.
 */
export type Phase = 'lobby' | 'picking' | 'playing' | 'done';

export interface Described {
  id: string;
  name: string;
  description: string;
}

/** One entry in a build: repeats of a pick are one entry, described for all of them together. */
export interface Stacked extends Described {
  count: number;
}

export interface DraftView {
  weapon: Described | null;
  weapons: Described[]; // to choose from, empty once chosen
  finished: boolean;
  pickNumber: number; // 1-based, for "Pick 2 of 3"
  picksTotal: number;
  kind: StepKind | null;
  /** This pick is the second transformation, for getting far in the tournament. */
  bonus: boolean;
  offer: Described[];
  picks: Stacked[]; // what has been taken so far, repeats combined
}

export interface LobbyEntry {
  id: string;
  name: string;
  color: string;
  ready: boolean;
  titles: number; // tournaments won tonight
  /** In the tournament being played (false for someone who joined after it started). */
  entered: boolean;
  out: boolean;
  skin: Skin | null; // how the ball is drawn: the host's say
  tag: string | null; // before the name in the arena, e.g. "DEV"
}

export interface Side {
  id: string;
  name: string;
  color: string | null;
}

export interface MatchLine {
  id: string;
  /** Its bracket round, e.g. "Winners semi-finals". */
  round: string;
  a: Side;
  b: Side;
  status: TournamentMatchStatus;
  winner: string | null; // entrant id
  /** How it was won, e.g. "on HP", or null for a knockout. */
  how: string | null;
}

export interface GroupView {
  name: string;
  matches: MatchLine[];
  bye: Side | null;
  /** Drawn later in this stage (a losers round waits for the winners round). */
  pending: boolean;
}

export interface StandingLine extends Side {
  rank: number;
  wins: number;
  losses: number;
  build: string[]; // weapon, then picks
}

/** A match that just ended, shown over the arena for a few seconds. */
export interface WinCard {
  matchId: string;
  winner: Side;
  loser: Side;
  round: string;
  /** Sim seconds it lasted, or null when the host decided it. */
  seconds: number | null;
  /** The winner's HP left, or null when unknown. */
  hpLeft: number | null;
  /** 'ko', 'hp' (on HP at the time limit) or 'host'. */
  how: 'ko' | 'hp' | 'host';
}

export interface BracketView {
  format: string; // "Double elimination"
  stage: number; // 1-based
  stages: number; // how many the plan has
  stageName: string;
  /** The round on now ("Losers round 2"), or the rounds this stage plays when nothing is on. */
  round: string;
  /** Which match of that round is on now, e.g. 2 of 4. */
  roundMatch: { n: number; of: number } | null;
  groups: GroupView[];
  /** On the game now, or about to be. */
  now: MatchLine | null;
  next: MatchLine | null;
  champion: Side | null;
  standings: StandingLine[];
  /** The match that just ended, while its card is up. */
  justWon: WinCard | null;
}

export interface Progress {
  state: EntrantState;
  opponent: string | null; // a name
  bracket: string | null;
  wins: number;
  losses: number;
}

export interface PlayerView {
  phase: Phase;
  you: { id: string; name: string; color: string; titles: number };
  draft: DraftView;
  lobby: LobbyEntry[];
  /** Where you are in the tournament, or null when not in it. */
  progress: Progress | null;
  /** The format's id, for wording the status line. */
  format: string | null;
  bracket: BracketView | null;
  /** Where matches are shown while a stage plays, or null. */
  arena: string | null;
  notice: string | null;
}

export interface AdminPlayer extends LobbyEntry {
  online: boolean;
  picksDone: number;
  picksTotal: number;
}

export interface AdminView {
  phase: Phase;
  ready: boolean; // the game's catalog has arrived, so a tournament can start
  formats: Described[];
  format: string;
  players: AdminPlayer[];
  bracket: BracketView | null;
  arena: string | null;
  /** What the tournament service is waiting for, e.g. a display page. */
  note: string;
  notice: string | null;
}
