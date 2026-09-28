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
  // One battle per trip to the battle phase, oldest first. The quiz flow can go
  // back into questions and reach the battle again (a battle per round), so the
  // results of every battle are kept and the table adds them up.
  battles: Battle[];
}

// What the game receives for one team.
export interface Loadout {
  team: string;
  weapon: string;
  upgrades: Record<string, number>;
}

// ---- The battle -------------------------------------------------------------

// One fighter as the game's match API takes it. Copied at battle start, so a
// later change on the admin page does not change a match that is already set.
export interface Fighter {
  name: string;
  weapon: string;
  upgrades: Record<string, number>;
}

export type BattleMatchStatus = 'pending' | 'queued' | 'playing' | 'done' | 'cancelled' | 'failed';

// One match in the round-robin. `a` and `b` are team ids.
export interface BattleMatch {
  id: string; // "<battle id>-m3", unique across every battle
  a: string;
  b: string;
  seed: number; // fixed by the quiz so a re-queue is the same fight
  gameId: string | null; // id from the game's match API
  status: BattleMatchStatus;
  fighters: [Fighter, Fighter]; // snapshot of the two loadouts
  winner: string | null; // team id; null is a draw, or no result yet
  hp: [number, number] | null;
  time: number | null; // sim seconds
  error?: string;
}

// One round-robin: a fresh one is dealt every time the quiz reaches the battle
// phase, so a team that picked up upgrades in between fights with them.
export interface Battle {
  id: string; // "b1", "b2"...
  startedAt: string;
  finishedAt: string | null;
  matches: BattleMatch[];
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
  // Set once the first battle has started. Null before that.
  battle: {
    number: number; // which battle is on (1-based)
    opponent: string | null; // name of the team they are fighting now or next
    status: BattleMatchStatus | null;
    rank: number | null; // 1-based place over every battle so far
    points: number;
    wins: number;
    played: number;
  } | null;
}

export interface AdminView {
  state: State;
  catalog: Catalog;
  picks: Record<string, number>; // teamId -> picks available
  online: string[]; // teamIds with an open connection
  game: GameStatus;
}
