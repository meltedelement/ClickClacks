// All quiz state and the rules that change it. Every change goes through
// `mutate`, which fixes up derived data, saves to disk and notifies listeners.
import fs from 'node:fs';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import type {
  AdminView,
  Battle,
  BattleMatch,
  BattleMatchStatus,
  DecidedBy,
  Fighter,
  Loadout,
  Phase,
  Question,
  State,
  Team,
  TeamView,
} from '../shared/types.ts';
import { PHASES } from '../shared/types.ts';
import { roundPosition } from '../shared/rounds.ts';
import { advance, currentRound, teamProgress } from '../shared/battle.ts';
import { getCatalog } from './catalog.ts';
import { GAME_API } from './game.ts';

const DATA_DIR = path.join(import.meta.dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
// The quiz file lives at the repo root, next to the game.
const QUESTIONS_FILE = path.join(import.meta.dirname, '..', '..', 'quiz-questions.json');

export class UserError extends Error {}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

interface QuizFile {
  rounds: { round: number; name: string; questions: { id: string; question: string; options: string[]; answerIndex: number }[] }[];
}

export function loadQuestions(): Question[] {
  const file = readJson<QuizFile>(QUESTIONS_FILE);
  const questions = file.rounds.flatMap((r) =>
    r.questions.map((q) => ({
      id: q.id,
      round: `Round ${r.round}: ${r.name}`,
      text: q.question,
      options: q.options,
      answer: q.answerIndex,
    })),
  );
  for (const q of questions) {
    if (!q.id || !q.text || !Array.isArray(q.options) || !(q.answer >= 0 && q.answer < q.options.length)) {
      throw new Error(`quiz-questions.json: question ${q.id} is invalid`);
    }
  }
  return questions;
}

function freshState(questions: Question[], teams: Team[] = []): State {
  return {
    phase: 'lobby',
    questionIndex: 0,
    questions,
    revealed: [],
    answers: {},
    teams,
    message: '',
    weaponsLocked: false,
    battle: null,
  };
}

// Questions are read from quiz-questions.json once, then kept in state.json.
// Use the "reload questions" admin action to read the file again.
export let state: State = fs.existsSync(STATE_FILE) ? readJson<State>(STATE_FILE) : freshState(loadQuestions());
// The old 'upgrades' phase was removed: teams now pick as soon as they earn an upgrade.
if (!PHASES.includes(state.phase)) state.phase = 'lobby';
// A state.json from before the knockout existed (or from the old round-robin), or a damaged one.
if (!state.battle || !Array.isArray(state.battle.rounds) || !Array.isArray(state.battle.matches)) state.battle = null;

const listeners = new Set<() => void>();
export function onChange(fn: () => void) {
  listeners.add(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

function save() {
  fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
}

function mutate(fn: () => void) {
  fn();
  reconcile();
  save();
  notify();
}

// The catalog changed (the game answered, or a new one was read). Offers may
// name upgrades that are no longer on offer, so drop them and roll new ones.
export function onCatalogChanged() {
  if (state.teams.some((team) => team.offer !== null)) mutate(() => state.teams.forEach((team) => (team.offer = null)));
  else notify();
}

// ---- The game server --------------------------------------------------------

// Cached so every view can show it without waiting for a request.
const gameInfo = { url: GAME_API, reachable: false, displays: 0 };

export function setGameStatus(patch: { reachable?: boolean; displays?: number }) {
  const changed =
    (patch.reachable !== undefined && patch.reachable !== gameInfo.reachable) ||
    (patch.displays !== undefined && patch.displays !== gameInfo.displays);
  if (patch.reachable !== undefined) gameInfo.reachable = patch.reachable;
  if (patch.displays !== undefined) gameInfo.displays = patch.displays;
  if (changed) notify();
}

// ---- Derived data -----------------------------------------------------------

function currentQuestion(): Question | null {
  return state.questions[state.questionIndex] ?? null;
}

// Picks are always recomputed from answers, so changing an answer or
// un-revealing a question fixes the count automatically.
export function picksAvailable(team: Team): number {
  let correct = 0;
  for (const q of state.questions) {
    if (state.revealed.includes(q.id) && state.answers[q.id]?.[team.id] === q.answer) correct++;
  }
  return correct * getCatalog().upgradesPerCorrect + team.bonusPicks - team.picksUsed;
}

function eligibleUpgrades(team: Team) {
  const owned = Object.keys(team.upgrades).filter((id) => (team.upgrades[id] ?? 0) > 0);
  return getCatalog().upgrades.filter(
    (u) =>
      (!u.weapons || u.weapons.includes(team.weapon)) &&
      (u.maxStacks === undefined || (team.upgrades[u.id] ?? 0) < u.maxStacks) &&
      (!u.requires || u.requires.every((id) => owned.includes(id))),
  );
}

function rollOffer(team: Team): string[] {
  const pool = eligibleUpgrades(team).map((u) => u.id);
  const offer: string[] = [];
  while (offer.length < getCatalog().offerSize && pool.length > 0) {
    offer.push(pool.splice(randomInt(pool.length), 1)[0]);
  }
  return offer;
}

// Give every team with picks left an offer, and remove offers from teams without picks.
function reconcile() {
  for (const team of state.teams) {
    if (picksAvailable(team) <= 0) team.offer = null;
    else if (!team.offer || team.offer.length === 0) team.offer = rollOffer(team);
  }
}

// ---- Views ------------------------------------------------------------------

export function teamView(team: Team): TeamView {
  const q = currentQuestion();
  const showQuestion = q && state.phase !== 'lobby' && state.phase !== 'battle';
  return {
    phase: state.phase,
    message: state.message,
    weaponsLocked: state.weaponsLocked,
    weapons: getCatalog().weapons,
    upgrades: getCatalog().upgrades,
    questionNumber: state.questionIndex + 1,
    questionCount: state.questions.length,
    question: showQuestion ? { id: q.id, round: q.round, text: q.text, options: q.options } : null,
    round: showQuestion ? roundPosition(state.questions, state.questionIndex) : null,
    myAnswer: q ? (state.answers[q.id]?.[team.id] ?? null) : null,
    correct: q && showQuestion && state.revealed.includes(q.id) ? q.answer : null,
    team: {
      name: team.name,
      code: team.code,
      weapon: team.weapon,
      upgrades: team.upgrades,
      picks: picksAvailable(team),
      picksUsed: team.picksUsed,
      offer: team.offer,
    },
    battle: battleForTeam(team),
  };
}

// Where one team is in the knockout. Null until the host draws the bracket.
function battleForTeam(team: Team): TeamView['battle'] {
  const battle = state.battle;
  const round = battle && currentRound(battle);
  if (!battle || !round) return null;
  const { state: where, opponent } = teamProgress(battle, team.id);
  return {
    round: round.name,
    state: where,
    opponent: opponent ? teamName(opponent) : null,
    champion: battle.champion ? teamName(battle.champion) : null,
  };
}

function teamName(id: string): string {
  return state.teams.find((t) => t.id === id)?.name ?? 'a deleted team';
}

export function adminView(online: string[]): AdminView {
  const catalog = getCatalog();
  return {
    state,
    catalog,
    picks: Object.fromEntries(state.teams.map((t) => [t.id, picksAvailable(t)])),
    online,
    game: {
      ...gameInfo,
      catalogSource: catalog.source ?? 'file',
      catalogSyncedAt: catalog.syncedAt ?? null,
    },
  };
}

export { getCatalog };

export function loadouts(): Loadout[] {
  return state.teams.map((t) => ({ team: t.name, weapon: t.weapon, upgrades: { ...t.upgrades } }));
}

// ---- Team actions -----------------------------------------------------------

export function findTeam(token: string | undefined): Team | undefined {
  return state.teams.find((t) => t.id === token);
}

function checkWeapon(weapon: string) {
  if (!getCatalog().weapons.some((w) => w.id === weapon)) throw new UserError('Unknown weapon');
}

export function join(name: string, weapon: string, code: string): Team {
  name = String(name ?? '').trim().slice(0, 30);
  if (!name) throw new UserError('Enter a team name');

  const existing = state.teams.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (String(code ?? '').trim() === existing.code) return existing;
    throw new UserError('That team name is taken. To rejoin, enter the team code (the host can see it).');
  }

  checkWeapon(weapon);
  const team: Team = {
    id: randomUUID(),
    code: String(randomInt(1000, 10000)),
    name,
    weapon,
    upgrades: {},
    picksUsed: 0,
    bonusPicks: 0,
    offer: null,
  };
  mutate(() => state.teams.push(team));
  return team;
}

export function answer(team: Team, choice: number) {
  const q = currentQuestion();
  if (state.phase !== 'question' || !q || state.revealed.includes(q.id)) throw new UserError('Answers are closed');
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) throw new UserError('Invalid choice');
  mutate(() => {
    state.answers[q.id] ??= {};
    state.answers[q.id][team.id] = choice;
  });
}

export function chooseWeapon(team: Team, weapon: string) {
  if (state.phase !== 'lobby' || state.weaponsLocked) throw new UserError('Weapons can only be changed in the lobby');
  checkWeapon(weapon);
  mutate(() => {
    team.weapon = weapon;
    team.offer = null; // the old offer may hold upgrades for the old weapon
  });
}

// `picksUsed` is the count the device saw when it sent the pick. If it no
// longer matches, the pick is a repeat (double tap, or a retry after a timeout).
export function pick(team: Team, upgradeId: string, picksUsed?: number) {
  if (picksUsed !== undefined && picksUsed !== team.picksUsed) throw new UserError('That pick is already saved');
  if (picksAvailable(team) <= 0 || !team.offer?.includes(upgradeId)) throw new UserError('That upgrade is not on offer');
  mutate(() => {
    team.upgrades[upgradeId] = (team.upgrades[upgradeId] ?? 0) + 1;
    team.picksUsed++;
    team.offer = null;
  });
}

// ---- Battle -----------------------------------------------------------------
// State changes for the knockout, used by server/battle.ts (which talks to the
// game) and by the views. They only touch `state.battle`.

function findBattleMatch(id: string): BattleMatch | undefined {
  return state.battle?.matches.find((m) => m.id === id);
}

export function beginBattle(battle: Battle) {
  mutate(() => {
    state.battle = battle;
  });
}

// The current round goes on the game. Each of its unplayed matches gets the
// two teams' loadouts as they are now.
export function startRound(fighters: Map<string, Fighter>) {
  mutate(() => {
    const round = state.battle && currentRound(state.battle);
    if (!state.battle || !round) return;
    round.status = 'playing';
    for (const match of state.battle.matches) {
      if (match.round !== round.index || match.status !== 'pending') continue;
      const a = fighters.get(match.a);
      const b = fighters.get(match.b);
      if (a && b) match.fighters = [a, b];
    }
  });
}

// The current round goes back to waiting. Matches sent to the game go back to
// pending (the driver cancels them there); played matches keep their result.
export function stopRound() {
  mutate(() => {
    const round = state.battle && currentRound(state.battle);
    if (!state.battle || !round || round.status !== 'playing') return;
    round.status = 'waiting';
    for (const match of state.battle.matches) {
      if (match.round === round.index && match.status === 'queued') {
        match.status = 'pending';
        match.gameId = null;
      }
    }
  });
}

// Every match in the current round has a winner: draw the next round, or crown the champion.
export function finishRound() {
  mutate(() => {
    const battle = state.battle;
    const round = battle && currentRound(battle);
    if (!battle || !round || round.status === 'done') return;
    const next = advance(battle);
    round.status = 'done';
    if ('champion' in next) {
      battle.champion = next.champion;
      battle.finishedAt = new Date().toISOString();
    } else {
      battle.rounds.push(next.round);
      battle.matches.push(...next.matches);
    }
  });
}

export function setMatchGame(id: string, gameId: string | null, status: BattleMatchStatus) {
  mutate(() => {
    const match = findBattleMatch(id);
    if (!match) return;
    match.gameId = gameId;
    match.status = status;
  });
}

// A duplicate result (two displays, or a retry) is a no-op.
export function recordResult(id: string, result: { winner: string; decidedBy: DecidedBy; hp: [number, number]; time: number }) {
  mutate(() => {
    const match = findBattleMatch(id);
    if (!match || match.status === 'done') return;
    match.status = 'done';
    match.winner = result.winner;
    match.decidedBy = result.decidedBy;
    match.hp = result.hp;
    match.time = result.time;
    delete match.error;
  });
}

// The host decides a match, e.g. one the game could not play.
export function setWinner(id: string, winner: string) {
  const match = findBattleMatch(id);
  if (!match) throw new UserError('Unknown match.');
  if (winner !== match.a && winner !== match.b) throw new UserError('The winner must be one of the two teams.');
  if (match.status === 'queued') throw new UserError('That match is on the game now. Stop the round first.');
  if (state.battle?.rounds[match.round]?.status === 'done') throw new UserError('That round is finished.');
  mutate(() => {
    match.status = 'done';
    match.winner = winner;
    match.decidedBy = 'host';
    match.gameId = null;
    delete match.error;
  });
}

// The match is played again, with a new seed so it is a new fight.
export function replayMatch(id: string, seed: number) {
  const match = findBattleMatch(id);
  if (!match) throw new UserError('Unknown match.');
  if (match.status === 'queued') throw new UserError('That match is on the game now.');
  const round = state.battle?.rounds[match.round];
  if (!round || round !== currentRound(state.battle!)) throw new UserError('Only a match in the current round can be played again.');
  mutate(() => {
    Object.assign(match, { status: 'pending', seed, gameId: null, winner: null, decidedBy: null, hp: null, time: null });
    delete match.error;
    // Only the final can be replayed after it is done: that undoes the champion.
    if (round.status === 'done') {
      round.status = 'waiting';
      state.battle!.champion = null;
      state.battle!.finishedAt = null;
    }
  });
}

export function cancelMatch(id: string, reason: string) {
  mutate(() => {
    const match = findBattleMatch(id);
    if (match) {
      match.status = 'cancelled';
      match.error = reason;
    }
  });
}

export function failMatch(id: string, error: string) {
  mutate(() => {
    const match = findBattleMatch(id);
    if (match) {
      match.status = 'failed';
      match.error = error;
    }
  });
}

export function setBattleNote(note: string) {
  if (!state.battle || state.battle.note === note) return;
  mutate(() => {
    if (state.battle) state.battle.note = note;
  });
}

export function resetBattle() {
  mutate(() => {
    state.battle = null;
  });
}

// ---- Admin actions ----------------------------------------------------------

type Action = { type: string; [key: string]: any };

function teamById(id: unknown): Team {
  const team = state.teams.find((t) => t.id === id);
  if (!team) throw new UserError('Unknown team');
  return team;
}

export function adminAction(a: Action) {
  switch (a.type) {
    case 'setPhase': {
      if (!PHASES.includes(a.phase)) throw new UserError('Unknown phase');
      const q = currentQuestion();
      return mutate(() => {
        state.phase = a.phase as Phase;
        if (a.phase === 'reveal' && q && !state.revealed.includes(q.id)) state.revealed.push(q.id);
      });
    }
    case 'setQuestion': {
      const index = Number(a.index);
      if (!(index >= 0 && index < state.questions.length)) throw new UserError('No such question');
      return mutate(() => {
        state.questionIndex = index;
        // A revealed question stays revealed, so teams cannot change to the shown answer.
        state.phase = state.revealed.includes(state.questions[index].id) ? 'reveal' : 'question';
      });
    }
    case 'setAnswer':
      return mutate(() => {
        state.answers[a.questionId] ??= {};
        if (a.choice === null) delete state.answers[a.questionId][a.teamId];
        else state.answers[a.questionId][a.teamId] = Number(a.choice);
      });
    case 'clearAnswers':
      return mutate(() => delete state.answers[a.questionId]);
    case 'setRevealed':
      return mutate(() => {
        state.revealed = state.revealed.filter((id) => id !== a.questionId);
        if (a.revealed) state.revealed.push(a.questionId);
      });
    case 'updateTeam': {
      const team = teamById(a.teamId);
      const patch = a.patch ?? {};
      if (patch.weapon !== undefined) checkWeapon(patch.weapon);
      return mutate(() => {
        if (patch.name !== undefined) team.name = String(patch.name).trim().slice(0, 30) || team.name;
        if (patch.weapon !== undefined && patch.weapon !== team.weapon) {
          team.weapon = patch.weapon;
          team.offer = null;
        }
        if (patch.bonusPicks !== undefined) team.bonusPicks = Number(patch.bonusPicks) || 0;
        if (patch.upgrades !== undefined) {
          team.upgrades = Object.fromEntries(
            Object.entries(patch.upgrades as Record<string, number>).filter(([, n]) => n > 0),
          );
        }
      });
    }
    case 'rerollOffer': {
      const team = teamById(a.teamId);
      return mutate(() => (team.offer = null));
    }
    case 'deleteTeam':
      return mutate(() => {
        state.teams = state.teams.filter((t) => t.id !== a.teamId);
        for (const answers of Object.values(state.answers)) delete answers[a.teamId];
      });
    case 'setMessage':
      return mutate(() => (state.message = String(a.text ?? '')));
    case 'setWeaponsLocked':
      return mutate(() => (state.weaponsLocked = Boolean(a.locked)));
    case 'reloadQuestions': {
      const questions = loadQuestions();
      return mutate(() => {
        state.questions = questions;
        state.questionIndex = Math.min(state.questionIndex, Math.max(0, questions.length - 1));
      });
    }
    case 'reset': {
      const questions = loadQuestions();
      const teams = a.keepTeams
        ? state.teams.map((t) => ({ ...t, upgrades: {}, picksUsed: 0, bonusPicks: 0, offer: null }))
        : [];
      return mutate(() => (state = freshState(questions, teams)));
    }
    default:
      throw new UserError(`Unknown action: ${a.type}`);
  }
}

// Make sure a state file exists and offers are up to date on startup.
mutate(() => {});
