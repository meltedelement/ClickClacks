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
  excludedBy?: string[]; // not offered to a team that owns one of these (it would do nothing); omit for none
}

export interface Catalog {
  weapons: WeaponInfo[];
  upgrades: Upgrade[]; // earned with correct answers
  transformations: Upgrade[]; // big upgrades: one pick for each battle break the schedule marks
  upgradesPerCorrect: number;
  offerSize: number;
  // Where this catalog came from. 'game' = live from GET /api/catalog,
  // 'file' = the generated offline fallback in data/game.json.
  source?: 'game' | 'file';
  syncedAt?: string | null;
}

export interface Team {
  id: string; // secret token the team's device uses; never leaves the quiz server
  entrantId: string; // public id: the team's entrant id in the tournament
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

// What follows one round of questions. `state.schedule` has one per round; see shared/rounds.ts.
export interface RoundBreak {
  stages: number | 'rest'; // bracket stages the battle break after the round plays: 0 = no break, 'rest' = every stage left
  transformation: boolean; // teams get a transformation pick for this break
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
  tournamentId: string | null; // the battle on the tournament service, once the host draws it
  // The big screen shows the title of the round that starts at this question
  // index. The phones do not change. Any phase or question change clears it.
  intro: number | null;
  schedule: RoundBreak[]; // one per round: the battle break after it (the last round always plays the rest)
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
// The tournament service runs the battle (tournament/ in the repo root). These
// are its types, from its API contract; the quiz only sends it the teams and
// shows what it reports.

export type {
  DecidedBy,
  Entrant,
  EntrantState,
  FormatId,
  FormatInfo,
  GameLink,
  Group,
  PlannedGroup,
  Stage,
  Standing,
  Tournament,
  TournamentMatch,
} from '../../api/tournament.d.ts';
import type { EntrantState, FormatId, FormatInfo, Tournament } from '../../api/tournament.d.ts';

// The tournament service and the game behind it, as the quiz server sees them now.
export interface GameStatus {
  tournamentUrl: string; // the Tournament API the quiz uses
  tournamentReachable: boolean;
  url: string; // the game's API, as the tournament service reaches it ('' until it answers)
  displayUrl: string; // the game's display page ('' until the tournament service answers)
  reachable: boolean; // the game answers the tournament service
  displays: number; // display pages connected; matches do not play without one
  screens: number; // matches the display page plays at the same time (0 until the game answers)
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
  // The next battle break (1-based number of the round it follows), or null
  // when no break is left. Picks made before its stage starts fight in it.
  nextBattle: { round: number } | null;
  // Set once the bracket is drawn. Null before that.
  battle: {
    format: FormatId;
    round: string; // name of the current stage
    bracket: string | null; // name of the team's bracket in this stage, e.g. "Losers round 2"
    side: string | null; // the team's bracket ('winners', 'losers', 'final', 'main', 'league'), or null when it is out or the champion
    wins: number;
    losses: number;
    state: EntrantState;
    opponent: string | null; // name of the team they fight in the current stage
    champion: string | null; // name of the winner, once there is one
  } | null;
}

export interface AdminView {
  state: State;
  tournament: Tournament | null; // the battle, as the tournament service last reported it
  formats: FormatInfo[]; // the formats the tournament service offers (empty until it answers)
  catalog: Catalog;
  picks: Record<string, number>; // teamId -> picks available
  transformPicks: Record<string, number>; // teamId -> transformation picks available
  online: string[]; // teamIds with an open connection
  game: GameStatus;
}
