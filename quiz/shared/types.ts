// Types shared by the server and the React client.

export type Phase = 'lobby' | 'question' | 'locked' | 'reveal' | 'upgrades' | 'battle';

export const PHASES: Phase[] = ['lobby', 'question', 'locked', 'reveal', 'upgrades', 'battle'];

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
  maxStacks?: number;
  weapons?: string[]; // only offered to these weapons; omit for all
}

export interface Catalog {
  weapons: WeaponInfo[];
  upgrades: Upgrade[];
  upgradesPerCorrect: number;
  offerSize: number;
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
}

// What the game receives for one team.
export interface Loadout {
  team: string;
  weapon: string;
  upgrades: Record<string, number>;
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
  myAnswer: number | null;
  correct: number | null; // only set once the question is revealed
  team: {
    name: string;
    code: string;
    weapon: string;
    upgrades: Record<string, number>;
    picks: number;
    offer: string[] | null;
  };
}

export interface AdminView {
  state: State;
  catalog: Catalog;
  picks: Record<string, number>; // teamId -> picks available
  online: string[]; // teamIds with an open connection
}
