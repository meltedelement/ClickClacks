// What the phones and the admin page are sent. Names are for showing; a player's
// token is the secret and is never in any of these.
import type { StepKind } from './draft.ts';
import type { Skin } from '../../../games/weapon-balls/api/game.d.ts';

export type Phase = 'draft' | 'countdown' | 'fight' | 'results';

/** `fresh`: a whole new build each round. `buildup`: builds carry over, with one new pick a round. */
export type Mode = 'fresh' | 'buildup';

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
  unbalanced: string[]; // names of the weapons left out of the royale for now, shown beside that choice
  mode: Mode;
  finished: boolean;
  pickNumber: number; // 1-based, for "Pick 2 of 5"
  picksTotal: number;
  kind: StepKind | null;
  offer: Described[];
  picks: Stacked[]; // what has been taken so far, repeats combined
}

export interface LobbyEntry {
  id: string;
  name: string;
  color: string;
  ready: boolean;
  wins: number;
  skin: Skin | null; // how the ball is drawn: the host's say
  tag: string | null; // before the name in the arena, e.g. "DEV"
}

export interface FightView {
  round: number;
  /** Where the fight is shown. */
  arena: string;
  /** This player's ball, or null for someone watching who joined too late for it. */
  slot: number | null;
  balls: number;
  /** ms until the balls drop, counted from when this view was sent. 0 once they have. */
  countdownMs: number;
}

export interface PlaceEntry {
  place: number; // 1 is the winner
  name: string;
  color: string;
  bot: boolean;
  playerId: string | null;
  weapon: string;
  picks: string[];
}

export interface ResultsView {
  round: number;
  seconds: number;
  balls: number;
  winner: string;
  places: PlaceEntry[];
}

export interface PlayerView {
  phase: Phase;
  round: number;
  you: { id: string; name: string; color: string; wins: number };
  draft: DraftView;
  lobby: LobbyEntry[];
  fight: FightView | null;
  results: ResultsView | null;
  /** What the host needs to know, or is telling everyone (a round that failed). */
  notice: string | null;
}

export interface AdminPlayer extends LobbyEntry {
  online: boolean;
  picksDone: number;
  picksTotal: number;
}

export interface AdminView {
  phase: Phase;
  round: number;
  mode: Mode;
  buildPicks: number; // in build-up mode, how many picks everyone is up to
  minBalls: number;
  botSize: number; // percent of a player's starting size
  ready: boolean; // the game's catalog has arrived, so rounds can start
  players: AdminPlayer[];
  fight: { arena: string; balls: number; bots: number; countdownMs: number } | null;
  results: ResultsView | null;
  notice: string | null;
}
