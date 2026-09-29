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
// Transformations use the same shape.
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
  upgrades: Upgrade[]; // earned with correct answers
  transformations: Upgrade[]; // big upgrades: one pick before each battle stage
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
  color: string; // hex from TEAM_COLORS (shared/colors.ts); no two teams share one. '' only when every colour was taken
  weapon: string;
  upgrades: Record<string, number>;
  transformations: string[]; // transformation ids, in the order the team picked them
  picksUsed: number;
  bonusPicks: number; // manual adjustment by the host
  offer: string[] | null; // upgrade ids the team can pick from now
  transformOffer?: string[] | null; // transformation ids the team can pick from now
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
  color: string;
  weapon: string;
  upgrades: Record<string, number>;
  transformations: string[];
}

// ---- The battle -------------------------------------------------------------

// One fighter as the game's match API takes it. Copied when its round starts,
// so a later change on the admin page does not change a match already sent.
export interface Fighter {
  name: string;
  color?: string; // ball colour; missing in matches drawn before teams had colours
  weapon: string;
  upgrades: Record<string, number>;
  transformations: string[];
}

// pending: not sent to the game yet. queued: sent; the game plays it when a screen is free.
export type BattleMatchStatus = 'pending' | 'queued' | 'done' | 'cancelled' | 'failed';

// How a match winner was found: a knockout, the game's HP tiebreak at the time
// limit, or the host on the admin page.
export type DecidedBy = 'ko' | 'hp' | 'host';

// The double elimination has two brackets. A team starts in the winners
// bracket. Its first loss moves it to the losers bracket, and its second loss
// puts it out. The last team in each bracket meet in the grand final.
export type BracketSide = 'winners' | 'losers' | 'final';

// One match in the double elimination. `a` and `b` are team ids.
export interface BattleMatch {
  id: string; // quiz-side id, e.g. "s2w1" (stage 2, winners match 1) or "s2l1" (losers)
  round: number; // index into Battle.rounds (the stage)
  side: BracketSide;
  a: string; // in the grand final, the winners bracket champion
  b: string;
  seed: number; // fixed by the bracket seed, so a re-queue is the same fight
  gameId: string | null; // id from the game's match API
  status: BattleMatchStatus;
  fighters: [Fighter, Fighter] | null; // snapshot of the two loadouts, taken when the stage starts
  winner: string | null; // team id, once the match is done
  decidedBy: DecidedBy | null;
  hp: [number, number] | null;
  time: number | null; // sim seconds
  error?: string;
}

// waiting: drawn, and the host has not started it. playing: its matches are on
// the game. done: every match has a winner.
export type BattleRoundStatus = 'waiting' | 'playing' | 'done';

// The teams of one bracket in one stage.
export interface BracketGroup {
  side: BracketSide;
  name: string; // "Winners semi-finals", "Losers round 2", "Grand final", ...
  teams: string[]; // in pairing order: teams[0] v teams[1], teams[2] v teams[3], ...
  bye: string | null; // the team with no match in this stage (an odd count, or the last team of its bracket)
  // Losers bracket only: not drawn yet. It waits for the teams that drop from
  // the winners bracket of this stage, and `teams` holds only the survivors.
  pending?: boolean;
}

// A stage: the matches that play in one battle break. The winners bracket
// plays first, then the losers bracket.
export interface BattleRound {
  index: number;
  name: string; // "Stage 1", "Stage 2", ...
  groups: BracketGroup[];
  status: BattleRoundStatus;
}

export interface Battle {
  seed: number; // the draw and every match seed come from this
  startedAt: string;
  finishedAt: string | null;
  rounds: BattleRound[]; // the stages; the last one is the current stage
  matches: BattleMatch[];
  champion: string | null; // team id
  note: string; // what the driver is waiting for, shown to the host
}

// What the quiz server knows about the game's match API right now.
export interface GameStatus {
  url: string;
  reachable: boolean;
  displays: number; // display pages connected; matches do not play without one
  screens: number; // matches the display page plays at the same time (0 until the game answers)
  onScreen: Record<string, GameScreen>; // game match id -> where it is on the display page
  restart: GameRestart | null; // the game server lost the current stage's matches
  catalogSource: 'game' | 'file';
  catalogSyncedAt: string | null;
}

// A match on one of the display page's screens.
export interface GameScreen {
  screen: number; // 0-based; the display page numbers them from 1
  playing: boolean; // false for the moment before the display starts it
}

// The game server forgot matches it had (it restarted), so the quiz sent them
// again. They play again from the start, with the same seeds.
export interface GameRestart {
  at: string; // ISO time the quiz noticed
  matches: string[]; // quiz match ids sent again
}

// Where one team is in the double elimination. See teamProgress in shared/battle.ts.
//   waiting: has a match in this stage, and the host has not started the stage
//   next: in the losers bracket of this stage, which is drawn when the winners bracket is finished
//   fighting: has a match on the game now
//   bye: has no match in this stage and stays in its bracket
//   through: won its match in this stage, waits for the next
//   dropped: lost its first match in this stage and goes to the losers bracket
//   out: lost two matches
//   champion: won the grand final
export type TeamBattleState = 'waiting' | 'next' | 'fighting' | 'bye' | 'through' | 'dropped' | 'out' | 'champion';

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
  transformations: Upgrade[]; // every transformation in the game, for names and descriptions
  takenColors: string[]; // colours other teams have
  team: {
    name: string;
    code: string;
    color: string;
    weapon: string;
    upgrades: Record<string, number>;
    transformations: string[];
    picks: number;
    picksUsed: number;
    offer: string[] | null;
    transformPicks: number; // transformations the team can pick now
    transformOffer: string[]; // transformation ids the team can pick from now (empty with no picks)
  };
  // Set once the bracket is drawn. Null before that.
  battle: {
    round: string; // name of the current stage
    bracket: string | null; // name of the team's bracket in this stage, e.g. "Losers round 2"
    side: BracketSide | null; // the team's bracket, or null when it is out or the champion
    losses: number;
    state: TeamBattleState;
    opponent: string | null; // name of the team they fight in the current stage
    champion: string | null; // name of the winner, once there is one
  } | null;
}

export interface AdminView {
  state: State;
  catalog: Catalog;
  picks: Record<string, number>; // teamId -> picks available
  transformPicks: Record<string, number>; // teamId -> transformation picks available
  online: string[]; // teamIds with an open connection
  game: GameStatus;
}
