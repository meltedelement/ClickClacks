// All quiz state and the rules that change it. Every change goes through
// `mutate`, which fixes up derived data, saves to disk and notifies listeners.
import fs from 'node:fs';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import type { AdminView, Loadout, Phase, Question, State, Team, TeamView, Tournament, Upgrade } from '../shared/types.ts';
import { PHASES } from '../shared/types.ts';
import { roundPosition } from '../shared/rounds.ts';
import { TEAM_COLORS } from '../shared/colors.ts';
import { eligibleTransformations, fitLoadout, fitsWeapon } from '../shared/loadout.ts';
import { currentStage } from '../shared/tournament.ts';
import { getCatalog } from './catalog.ts';
import * as tournament from './tournament.ts';

// How many random transformations a team sees when it has a pick.
const TRANSFORM_OFFER_SIZE = 3;
// Teams get a transformation pick before every TRANSFORM_EVERY-th stage,
// starting with the first (stages 1, 3, 5, ...).
const TRANSFORM_EVERY = 2;

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
    tournamentId: null,
    intro: null,
  };
}

// Questions are read from quiz-questions.json once, then kept in state.json.
// Use the "reload questions" admin action to read the file again.
export let state: State = fs.existsSync(STATE_FILE) ? readJson<State>(STATE_FILE) : freshState(loadQuestions());
// The old 'upgrades' phase was removed: teams now pick as soon as they earn an upgrade.
if (!PHASES.includes(state.phase)) state.phase = 'lobby';
// A state.json from before the tournament service: the quiz kept the bracket
// itself. It can't be carried over; the host draws a new one.
delete (state as State & { battle?: unknown }).battle;
state.tournamentId ??= null;
// A state.json from before the round title moved to the server.
state.intro ??= null;
// A state.json from before transformations were kept apart from upgrades: move them over.
for (const team of state.teams) {
  team.entrantId ??= randomUUID(); // from before the tournament service
  team.transformations ??= [];
  for (const t of getCatalog().transformations) {
    const count = team.upgrades[t.id] ?? 0;
    if (count <= 0) continue;
    delete team.upgrades[t.id];
    for (let i = 0; i < count; i++) team.transformations.push(t.id);
  }
}

// A state.json from before team colours, or one where two teams share a colour:
// give each such team the first free colour.
state.teams.forEach((team, i) => {
  const valid = TEAM_COLORS.some((c) => c.hex === team.color);
  const shared = state.teams.slice(0, i).some((t) => t.color === team.color);
  if (!valid || shared) team.color = freeColors()[0] ?? '';
});

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

// ---- The battle ---------------------------------------------------------------

// The quiz's tournament, as the tournament service last reported it. Null
// before the host draws it (or while the quiz has not heard from the service).
export function battle(): Tournament | null {
  const t = tournament.current;
  return t && t.id === state.tournamentId ? t : null;
}

export function setTournament(id: string | null) {
  mutate(() => (state.tournamentId = id));
  tournament.follow(id);
}

// The tournament changed there: transformation picks and offers follow from it.
tournament.onChange(() => mutate(() => {}));
tournament.follow(state.tournamentId);

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
  const owned = [...Object.keys(team.upgrades).filter((id) => (team.upgrades[id] ?? 0) > 0), ...team.transformations];
  return getCatalog().upgrades.filter(
    (u) =>
      fitsWeapon(u, team.weapon) &&
      (u.maxStacks === undefined || (team.upgrades[u.id] ?? 0) < u.maxStacks) &&
      (!u.requires || u.requires.every((id) => owned.includes(id))) &&
      !u.excludedBy?.some((id) => owned.includes(id)),
  );
}

function randomSample(pool: string[], size: number): string[] {
  pool = [...pool];
  const sample: string[] = [];
  while (sample.length < size && pool.length > 0) {
    sample.push(pool.splice(randomInt(pool.length), 1)[0]);
  }
  return sample;
}

function rollOffer(team: Team): string[] {
  return randomSample(eligibleUpgrades(team).map((u) => u.id), getCatalog().offerSize);
}

// A team still in the battle gets one transformation pick for every
// TRANSFORM_EVERY-th stage: those already on the game, plus the next one while
// the quiz is in a battle break. Picks it did not use carry over. Zero when
// nothing fits its weapon.
export function transformPicks(team: Team): number {
  const t = battle();
  const stage = t && currentStage(t);
  const entrant = t?.entrants.find((e) => e.id === team.entrantId);
  if (!t || !stage || !entrant || t.champion || entrant.progress.state === 'out') return 0;
  if (eligibleTransformations(team, getCatalog()).length === 0) return 0;
  const givesPick = (index: number) => index % TRANSFORM_EVERY === 0;
  const started = t.stages.filter((s) => s.status !== 'waiting' && givesPick(s.index)).length;
  const earned = started + (state.phase === 'battle' && stage.status === 'waiting' && givesPick(stage.index) ? 1 : 0);
  return Math.max(0, earned - team.transformations.length);
}

// Give every team with picks left an offer, and remove offers from teams without picks.
// An offer is rolled again when it names one the team can no longer take (a
// new weapon, a stack limit reached by a host edit, a transformation that makes
// it useless, a new catalog).
function reconcile() {
  for (const team of state.teams) {
    const eligibleUpgradeIds = eligibleUpgrades(team).map((u) => u.id);
    if (picksAvailable(team) <= 0) team.offer = null;
    else if (!team.offer?.length || !team.offer.every((id) => eligibleUpgradeIds.includes(id))) team.offer = rollOffer(team);

    const eligible = eligibleTransformations(team, getCatalog());
    if (transformPicks(team) <= 0) team.transformOffer = null;
    else if (!team.transformOffer?.length || !team.transformOffer.every((id) => eligible.includes(id))) {
      team.transformOffer = randomSample(eligible, TRANSFORM_OFFER_SIZE);
    }
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
    transformations: getCatalog().transformations,
    takenColors: takenColors(team),
    questionNumber: state.questionIndex + 1,
    questionCount: state.questions.length,
    question: showQuestion ? { id: q.id, round: q.round, text: q.text, options: q.options } : null,
    round: showQuestion ? roundPosition(state.questions, state.questionIndex) : null,
    myAnswer: q ? (state.answers[q.id]?.[team.id] ?? null) : null,
    correct: q && showQuestion && state.revealed.includes(q.id) ? q.answer : null,
    team: {
      name: team.name,
      code: team.code,
      color: team.color,
      weapon: team.weapon,
      upgrades: team.upgrades,
      transformations: team.transformations,
      picks: picksAvailable(team),
      picksUsed: team.picksUsed,
      offer: team.offer,
      transformPicks: transformPicks(team),
      transformOffer: transformPicks(team) > 0 ? (team.transformOffer ?? []) : [],
    },
    battle: battleForTeam(team),
  };
}

// Where one team is in the battle. Null until the host draws the bracket.
function battleForTeam(team: Team): TeamView['battle'] {
  const t = battle();
  const stage = t && currentStage(t);
  const entrant = t?.entrants.find((e) => e.id === team.entrantId);
  if (!t || !stage || !entrant) return null;
  const { state: where, opponent, side, bracket, wins, losses } = entrant.progress;
  const name = (id: string) => t.entrants.find((e) => e.id === id)?.name ?? 'a deleted team';
  return {
    format: t.format,
    round: stage.name,
    bracket,
    side,
    wins,
    losses,
    state: where,
    opponent: opponent ? name(opponent) : null,
    champion: t.champion ? name(t.champion) : null,
  };
}

export function adminView(online: string[]): AdminView {
  const catalog = getCatalog();
  return {
    state,
    catalog,
    picks: Object.fromEntries(state.teams.map((t) => [t.id, picksAvailable(t)])),
    transformPicks: Object.fromEntries(state.teams.map((t) => [t.id, transformPicks(t)])),
    online,
    tournament: battle(),
    formats: tournament.formats,
    game: {
      tournamentUrl: tournament.TOURNAMENT_API,
      tournamentReachable: tournament.link.reachable,
      url: tournament.link.game?.url ?? '',
      displayUrl: tournament.link.game?.displayUrl ?? '',
      reachable: tournament.link.reachable && Boolean(tournament.link.game?.reachable),
      displays: tournament.link.game?.displays ?? 0,
      screens: tournament.link.game?.screens ?? 0,
      catalogSource: catalog.source ?? 'file',
      catalogSyncedAt: catalog.syncedAt ?? null,
    },
  };
}

export { getCatalog };

export function loadouts(): Loadout[] {
  return state.teams.map((t) => ({ team: t.name, color: t.color, weapon: t.weapon, upgrades: { ...t.upgrades }, transformations: [...t.transformations] }));
}

// ---- Team actions -----------------------------------------------------------

export function findTeam(token: string | undefined): Team | undefined {
  return state.teams.find((t) => t.id === token);
}

function checkWeapon(weapon: string) {
  if (!getCatalog().weapons.some((w) => w.id === weapon)) throw new UserError('Unknown weapon');
}

// Upgrades and transformations are locked to their weapons. A new weapon drops
// the ones that only fit the old one (and the ones that required those), and
// the team gets the picks for the dropped upgrades back. Call inside mutate().
function setWeapon(team: Team, weapon: string) {
  if (weapon === team.weapon) return;
  const fitted = fitLoadout({ ...team, weapon }, getCatalog());
  team.weapon = weapon;
  team.upgrades = fitted.upgrades;
  team.transformations = fitted.transformations;
  team.picksUsed = Math.max(0, team.picksUsed - fitted.dropped);
  team.offer = null; // the old offer may hold upgrades for the old weapon
}

// The host may add only upgrades and transformations that fit the weapon.
// Only ids whose count goes up are checked, so the host can still remove one
// that does not fit.
function checkFits(before: Record<string, number>, after: Record<string, number>, list: Upgrade[], weapon: string) {
  for (const [id, n] of Object.entries(after)) {
    if (n <= (before[id] ?? 0)) continue;
    const upgrade = list.find((u) => u.id === id);
    if (upgrade && !fitsWeapon(upgrade, weapon)) {
      const weaponName = getCatalog().weapons.find((w) => w.id === weapon)?.name ?? weapon;
      throw new UserError(`${upgrade.name} does not fit the ${weaponName}`);
    }
  }
}

function countIds(ids: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

// Colours that belong to a team other than `except`.
export function takenColors(except?: Team): string[] {
  return state.teams.flatMap((t) => (t !== except && t.color ? [t.color] : []));
}

function freeColors(): string[] {
  const taken = takenColors();
  return TEAM_COLORS.map((c) => c.hex).filter((hex) => !taken.includes(hex));
}

// A team's colour must come from the palette, and no other team may have it.
function checkColor(color: unknown, team?: Team): string {
  const hex = String(color ?? '').toLowerCase();
  if (!TEAM_COLORS.some((c) => c.hex === hex)) {
    throw new UserError(freeColors().length > 0 ? 'Pick a colour' : 'Every colour is taken. Ask the host to free one.');
  }
  if (takenColors(team).includes(hex)) throw new UserError('Another team has that colour. Pick a different one.');
  return hex;
}

// A code alone rejoins its team, so codes must be unique.
function newCode(): string {
  let code: string;
  do code = String(randomInt(1000, 10000));
  while (state.teams.some((t) => t.code === code));
  return code;
}

export function join(name: string, weapon: string, color: string, code: string): Team {
  code = String(code ?? '').trim();
  if (code) {
    const team = state.teams.find((t) => t.code === code);
    if (!team) throw new UserError('No team has that code. The host can see the codes.');
    return team;
  }

  name = String(name ?? '').trim().slice(0, 30);
  if (!name) throw new UserError('Enter a team name');
  if (state.teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    throw new UserError('That team name is taken. To rejoin, use the team code (the host can see it).');
  }

  checkWeapon(weapon);
  const team: Team = {
    id: randomUUID(),
    entrantId: randomUUID(),
    code: newCode(),
    name,
    color: checkColor(color),
    weapon,
    upgrades: {},
    transformations: [],
    picksUsed: 0,
    bonusPicks: 0,
    offer: null,
    transformOffer: null,
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
  mutate(() => setWeapon(team, weapon));
}

// Same rule as the weapon: the team chooses in the lobby, the host at any time.
export function chooseColor(team: Team, color: string) {
  if (state.phase !== 'lobby' || state.weaponsLocked) throw new UserError('Colours can only be changed in the lobby');
  const hex = checkColor(color, team);
  mutate(() => (team.color = hex));
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

// `count` is the number of transformations the device saw when it sent the
// pick, so a repeated pick (double tap, or a retry) is rejected.
export function pickTransformation(team: Team, id: string, count?: number) {
  if (count !== undefined && count !== team.transformations.length) throw new UserError('That pick is already saved');
  if (transformPicks(team) <= 0) throw new UserError('You have no transformation to pick now');
  if (!team.transformOffer?.includes(id)) throw new UserError('That transformation is not on offer');
  mutate(() => {
    team.transformations.push(id);
    team.transformOffer = null;
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
        state.intro = null;
        if (a.phase === 'reveal' && q && !state.revealed.includes(q.id)) state.revealed.push(q.id);
      });
    }
    case 'setQuestion': {
      const index = Number(a.index);
      if (!(index >= 0 && index < state.questions.length)) throw new UserError('No such question');
      return mutate(() => {
        state.questionIndex = index;
        state.intro = null;
        // A revealed question stays revealed, so teams cannot change to the shown answer.
        state.phase = state.revealed.includes(state.questions[index].id) ? 'reveal' : 'question';
      });
    }
    case 'setIntro': {
      const index = a.index === null ? null : Number(a.index);
      if (index !== null && !(index >= 0 && index < state.questions.length)) throw new UserError('No such question');
      return mutate(() => (state.intro = index));
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
      const weapon = patch.weapon ?? team.weapon;
      if (patch.upgrades !== undefined) checkFits(team.upgrades, patch.upgrades, getCatalog().upgrades, weapon);
      if (Array.isArray(patch.transformations)) {
        checkFits(countIds(team.transformations), countIds(patch.transformations.map(String)), getCatalog().transformations, weapon);
      }
      const color = patch.color !== undefined ? checkColor(patch.color, team) : undefined;
      return mutate(() => {
        if (patch.name !== undefined) team.name = String(patch.name).trim().slice(0, 30) || team.name;
        if (color !== undefined) team.color = color;
        if (patch.weapon !== undefined) setWeapon(team, patch.weapon);
        if (patch.bonusPicks !== undefined) team.bonusPicks = Number(patch.bonusPicks) || 0;
        if (patch.upgrades !== undefined) {
          team.upgrades = Object.fromEntries(
            Object.entries(patch.upgrades as Record<string, number>).filter(([, n]) => n > 0),
          );
        }
        if (Array.isArray(patch.transformations)) team.transformations = patch.transformations.map(String);
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
        state.intro = null;
      });
    }
    case 'reset': {
      const questions = loadQuestions();
      const teams = a.keepTeams
        ? state.teams.map((t) => ({ ...t, upgrades: {}, transformations: [], picksUsed: 0, bonusPicks: 0, offer: null, transformOffer: null }))
        : [];
      return mutate(() => (state = freshState(questions, teams)));
    }
    default:
      throw new UserError(`Unknown action: ${a.type}`);
  }
}

// Make sure a state file exists and offers are up to date on startup.
mutate(() => {});
