// Types shared by the server and the React client.

export type Phase = 'lobby' | 'question' | 'locked' | 'reveal' | 'battle';

export const PHASES: Phase[] = ['lobby', 'question', 'locked', 'reveal', 'battle'];

export interface Question {
  id: string;
  round: string;
  text: string;
  options: string[];
  answer: number; // index into options
}

export interface WeaponInfo {
  id: string; // must match the game's weapon id
  name: string;
}

// The quiz only stores upgrade ids and counts. The game decides what each id does.
export interface Upgrade {
  id: string;
  name: string;
  description: string;
  maxStacks?: number; // omit for no limit
  weapons?: string[]; // only offered to these weapons; omit for all
  requires?: string[]; // upgrade ids the team must own first; omit for none
}

export interface Catalog {
  weapons: WeaponInfo[];
  upgrades: Upgrade[];
  upgradesPerCorrect: number;
  offerSize: number;
  // Where this catalog came from. 'game' = live from GET /api/catalog,
  // 'file' = the generated offline fallback in data/game.json.
  source?: 'game' | 'file';
  syncedAt?: string | null;
}

export interface Team {
  id: string; // secret token the team's device uses
  code: string; // short code to rejoin from another device
  name: string;
  weapon: string;
  upgrades: Record<string, number>;
  picksUsed: number;
  bonusPicks: number; // manual adjustment by the host
  offer: string[] | null; // upgrade ids the team can pick from now
}

export interface State {
  phase: Phase;
  questionIndex: number;
  questions: Question[];
  revealed: string[]; // question ids that count towards picks
  answers: Record<string, Record<string, number>>; // questionId -> teamId -> option index
  teams: Team[];
  message: string;
  weaponsLocked: boolean;
  battle: Battle | null; // the knockout, once the host draws the bracket
}

// What the game receives for one team.
export interface Loadout {
  team: string;
  weapon: string;
  upgrades: Record<string, number>;
}

// ---- The battle -------------------------------------------------------------

// One fighter as the game's match API takes it. Copied when its round starts,
// so a later change on the admin page does not change a match already sent.
export interface Fighter {
  name: string;
  weapon: string;
  upgrades: Record<string, number>;
}

// pending: not sent to the game yet. queued: sent; the game plays it when a screen is free.
export type BattleMatchStatus = 'pending' | 'queued' | 'done' | 'cancelled' | 'failed';

// How a match winner was found: a knockout, the game's HP tiebreak at the time
// limit, or the host on the admin page.
export type DecidedBy = 'ko' | 'hp' | 'host';

// One match in the knockout. `a` and `b` are team ids.
export interface BattleMatch {
  id: string; // quiz-side id, e.g. "r1m3" (round 1, match 3)
  round: number; // index into Battle.rounds
  a: string;
  b: string;
  seed: number; // fixed by the bracket seed, so a re-queue is the same fight
  gameId: string | null; // id from the game's match API
  status: BattleMatchStatus;
  fighters: [Fighter, Fighter] | null; // snapshot of the two loadouts, taken when the round starts
  winner: string | null; // team id, once the match is done
  decidedBy: DecidedBy | null;
  hp: [number, number] | null;
  time: number | null; // sim seconds
  error?: string;
}

// waiting: drawn, and the host has not started it. playing: its matches are on
// the game. done: every match has a winner.
export type BattleRoundStatus = 'waiting' | 'playing' | 'done';

export interface BattleRound {
  index: number;
  name: string; // "Quarter-finals", "Semi-finals", "Final", or "Round N"
  teams: string[]; // the teams in this round, in bracket order
  bye: string | null; // with an odd count, the team that goes through without a match
  status: BattleRoundStatus;
}

export interface Battle {
  seed: number; // the draw and every match seed come from this
  startedAt: string;
  finishedAt: string | null;
  rounds: BattleRound[]; // the last one is the current round
  matches: BattleMatch[];
  champion: string | null; // team id
  note: string; // what the driver is waiting for, shown to the host
}

// What the quiz server knows about the game's match API right now.
export interface GameStatus {
  url: string;
  reachable: boolean;
  displays: number; // display pages connected; matches do not play without one
  catalogSource: 'game' | 'file';
  catalogSyncedAt: string | null;
}

// Where one team is in the knockout. See teamProgress in shared/battle.ts.
//   waiting: has a match in this round, and the host has not started the round
//   fighting: has a match on the game now
//   bye: goes through this round without a match
//   through: won this round, waits for the next
//   out: lost a match
//   champion: won the final
export type TeamBattleState = 'waiting' | 'fighting' | 'bye' | 'through' | 'out' | 'champion';

// Where a question is in its round. See shared/rounds.ts.
export interface RoundPosition {
  index: number; // 0-based round number
  count: number; // rounds in the quiz
  name: string; // the round name without the "Round N: " prefix
  position: number; // 1-based question number in this round
  size: number; // questions in this round
  sizes: number[]; // questions in each round, for the progress bar
}

export interface TeamView {
  phase: Phase;
  message: string;
  weaponsLocked: boolean;
  weapons: WeaponInfo[];
  upgrades: Upgrade[];
  questionNumber: number;
  questionCount: number;
  question: { id: string; round: string; text: string; options: string[] } | null;
  round: RoundPosition | null;
  myAnswer: number | null;
  correct: number | null; // only set once the question is revealed
  team: {
    name: string;
    code: string;
    weapon: string;
    upgrades: Record<string, number>;
    picks: number;
    picksUsed: number;
    offer: string[] | null;
  };
  // Set once the bracket is drawn. Null before that.
  battle: {
    round: string; // name of the current round
    state: TeamBattleState;
    opponent: string | null; // name of the team they fight in the current round
    champion: string | null; // name of the winner, once there is one
  } | null;
}

export interface AdminView {
  state: State;
  catalog: Catalog;
  picks: Record<string, number>; // teamId -> picks available
  online: string[]; // teamIds with an open connection
  game: GameStatus;
}
