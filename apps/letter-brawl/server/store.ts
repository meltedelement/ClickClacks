// The Letter Brawl: the bracket's tournament (lobby draft, 1v1 stages, a champion),
// with a word game between stages in place of the bracket's one upgrade.
//
// Everyone in the tournament has the same hidden five-letter word. Once the
// tournament starts (everyone has their weapon and transformation), and in each
// break between stages, everyone still in makes ONE guess (two minutes to do it). The
// guess pays upgrades: one per letter in the word but elsewhere, two per letter
// in place. Solving it pays a transformation (picked first) as well. Once solved,
// it's solved: no more guesses, and every later break pays as if they solved it
// again (ten upgrades). Each upgrade is a pick from three, as in the bracket.
// The stage starts by itself once everyone has guessed (or run out of time) and
// taken their picks, or when the host says.
//
// Once there is a champion, everyone who played (out or not) fights one battle
// royale on the game with the build they finished with: a second winner, apart
// from the champion. The royale goes straight to the game's Match Host API, since
// the tournament service only plays 1v1s.
import { PartyError } from '../../../party/server/index.ts';
import { createBracket } from '../../bracket/server/store.ts';
import type { Player, StageRules } from '../../bracket/server/store.ts';
import type { TournamentService } from '../../bracket/server/tournament.ts';
import type { GameHost } from '../../royale/server/host.ts';
import { growDraft, shuffle, stack, withTransformationNext } from '../../royale/shared/draft.ts';
import type { Draft, Random } from '../../royale/shared/draft.ts';
import type { MatchResult, Skin } from '../../../games/weapon-balls/api/game.d.ts';
import { lookFields } from '../../royale/shared/looks.ts';
import type { AdminView, PlayerView, RoyalePlace, RoyaleView, WordStatus, WordView } from '../shared/types.ts';
import { SOLVED_PAYS, cleanWord, letterHints, mark, pays, solves } from '../shared/word.ts';
import type { Guess } from '../shared/word.ts';
import type { WordSource } from './words.ts';

export const GUESS_MS = 120_000;
const ARENA = '/game/?display&embed'; // the game's display page, through this app's proxy
const ROYALE_TIME_LIMIT = 300; // sim seconds; sudden death ends nearly every royale long before

interface Royale {
  fighters: { id: string; name: string; color: string; skin: Skin | null; tag: string | null; draft: Draft }[]; // in arena slot order
  status: RoyaleView['status'];
  dropsAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  matchId: string | null;
  result: MatchResult | null;
  error: string | null;
}

interface WordState {
  guesses: Guess[];
  solved: boolean;
  guessedIn: number; // the break (its stage, 0-based) of the last guess; -1 for none
  earned: { stage: number; upgrades: number; transformation: boolean } | null;
}

export interface LetterBrawlOptions {
  service: TournamentService;
  /** The game's Match Host API, for the royale at the end. */
  host: GameHost;
  words: WordSource;
  onChange(): void;
  /** How long a break's guess stays open. */
  guessMs?: number;
  arenaHoldMs?: number;
  winCardMs?: number;
  /** How long the champion is shown before the royale drops. */
  royaleDelayMs?: number;
  /** How long the game's winner banner stays up before the royale's places replace it. */
  royaleHoldMs?: number;
  random?: Random;
}

export function createLetterBrawl({ service, host, words, onChange, guessMs = GUESS_MS, arenaHoldMs, winCardMs, royaleDelayMs = 10_000, royaleHoldMs = 4_000, random = Math.random }: LetterBrawlOptions) {
  const state = new Map<string, WordState>(); // by player id, for the tournament on
  let answer: string | null = null;
  let upcoming: Promise<string> | null = null; // the next tournament's answer, fetched ahead
  let breakStage = -1; // the stage (0-based) whose break is on, or was last; -1 before the first
  let guessUntil = 0; // Date.now() until which this break's guesses are open
  let closer: ReturnType<typeof setTimeout> | undefined;
  const checking = new Set<string>(); // players whose guess is being looked up
  let royale: Royale | null = null; // the final royale of the tournament that just ended
  let royalesPlayed = 0;

  const rules: StageRules = {
    newStage(stage, stillIn) {
      breakStage = stage;
      guessUntil = Date.now() + guessMs;
      clearTimeout(closer);
      // Time's up: whoever hasn't guessed misses this break, and the stage may start.
      closer = setTimeout(() => {
        onChange();
        bracket.recheck();
      }, guessMs + 50);
      for (const player of stillIn) {
        const word = wordState(player.id);
        if (!word.solved) continue;
        grant(player, SOLVED_PAYS, false);
        word.earned = { stage, upgrades: SOLVED_PAYS, transformation: false };
      }
    },
    beforeFirstStage: true, // one guess before the first fight, once the transformations are in
    owes: (player) => statusOf(player.id, player.entered, bracket.isOut(player)) === 'guessing',
    onLobby() {
      reset();
      cancelRoyale();
    },
    onDone: scheduleRoyale,
  };

  const bracket = createBracket({ service, onChange, arenaHoldMs, winCardMs, random, name: 'Letter Brawl', rules });

  function nextAnswer(): Promise<string> {
    upcoming ??= words.answer();
    return upcoming;
  }
  void nextAnswer();

  function reset() {
    state.clear();
    answer = null;
    breakStage = -1;
    guessUntil = 0;
    clearTimeout(closer);
  }

  function wordState(id: string): WordState {
    let word = state.get(id);
    if (!word) {
      word = { guesses: [], solved: false, guessedIn: -1, earned: null };
      state.set(id, word);
    }
    return word;
  }

  function breakOpen(): boolean {
    return answer !== null && breakStage >= 0 && bracket.phase() === 'picking';
  }

  function statusOf(id: string, entered: boolean, out: boolean): WordStatus | null {
    if (!answer || !entered) return null;
    const word = wordState(id);
    if (word.solved) return 'solved';
    if (out || !breakOpen()) return 'waiting';
    if (word.guessedIn === breakStage) return 'guessed';
    return Date.now() < guessUntil ? 'guessing' : 'missed';
  }

  // More picks: a transformation first if they earned one, then the upgrades.
  function grant(player: Player, upgrades: number, transformation: boolean) {
    const catalog = bracket.catalog();
    if (!catalog || (upgrades === 0 && !transformation)) return;
    const draft = transformation ? withTransformationNext(player.draft) : player.draft;
    player.draft = growDraft(draft, draft.length + upgrades + (transformation ? 1 : 0), catalog, random);
  }

  async function guess(player: Player, raw: unknown) {
    const word = cleanWord(raw);
    if (!word) throw new PartyError('A guess is five letters');
    const why: Partial<Record<WordStatus, string>> = {
      solved: 'You already solved it',
      guessed: 'One guess per break: the next one opens after this stage',
      missed: 'Time ran out for this break\'s guess',
      waiting: 'Guesses open between stages',
    };
    const before = statusOf(player.id, player.entered, bracket.isOut(player));
    if (before !== 'guessing') throw new PartyError(before ? why[before]! : 'You are not in this tournament');
    if (checking.has(player.id)) throw new PartyError('Still checking your guess');
    checking.add(player.id);
    let real: boolean;
    try {
      real = word === answer || (await words.isWord(word));
    } finally {
      checking.delete(player.id);
    }
    if (!real) throw new PartyError(`${word.toUpperCase()} isn't in the word list`);
    // The break may have closed while the dictionary answered.
    const now = statusOf(player.id, player.entered, bracket.isOut(player));
    if (now !== 'guessing') throw new PartyError(now ? why[now]! : 'You are not in this tournament');

    const mine = wordState(player.id);
    const marks = mark(word, answer!);
    const solved = solves(marks);
    mine.guesses.push({ word, marks });
    mine.guessedIn = breakStage;
    mine.solved = solved;
    mine.earned = { stage: breakStage, upgrades: pays(marks), transformation: solved };
    grant(player, pays(marks), solved);
    onChange();
    bracket.recheck();
  }

  // ---- The final royale ----------------------------------------------------

  function scheduleRoyale(entered: Player[]) {
    cancelRoyale();
    if (entered.length < 2) return;
    // Shuffled, so nobody's place in the arena depends on when they joined.
    const fighters = shuffle(entered, random).map((p) => ({ id: p.id, name: p.name, color: p.color, skin: p.skin, tag: p.tag, draft: p.draft }));
    const current: Royale = { fighters, status: 'soon', dropsAt: Date.now() + royaleDelayMs, timer: null, matchId: null, result: null, error: null };
    current.timer = setTimeout(() => void drop(current), royaleDelayMs);
    royale = current;
  }

  async function drop(current: Royale) {
    if (royale !== current) return;
    current.timer = null;
    royalesPlayed += 1;
    try {
      const match = await host.queue({
        characters: current.fighters.map((f) => ({
          name: f.name,
          highlight: true,
          color: f.color,
          ...lookFields(f),
          weapon: f.draft.weapon!,
          transformations: f.draft.transformations,
          upgrades: f.draft.upgrades,
        })),
        decisive: true,
        ref: `letter-brawl/royale/${royalesPlayed}`,
        settings: { royale: true, timeLimit: ROYALE_TIME_LIMIT },
      });
      if (royale !== current) {
        await host.cancel(match.id).catch(() => {}); // ended while the request was out
        return;
      }
      current.matchId = match.id;
      current.status = 'fighting';
      onChange();
      const done = await host.wait(match.id);
      if (royale !== current) return;
      if (done.status !== 'done' || !done.result) throw new Error('it was cancelled on the game');
      const result = done.result;
      setTimeout(() => {
        if (royale !== current) return;
        current.result = result;
        current.status = 'done';
        onChange();
      }, royaleHoldMs);
    } catch (err) {
      if (royale !== current) return;
      current.status = 'failed';
      current.error = `The royale did not play: ${(err as Error).message}`;
      onChange();
    }
  }

  function cancelRoyale() {
    if (!royale) return;
    const { timer, matchId } = royale;
    if (timer) clearTimeout(timer);
    royale = null;
    if (matchId) host.cancel(matchId).catch(() => {}); // it may have finished just now
  }

  function buildOf(draft: Draft): string[] {
    const catalog = bracket.catalog();
    const nameOf = (id: string) => [...(catalog?.transformations ?? []), ...(catalog?.upgrades ?? [])].find((u) => u.id === id)?.name ?? id;
    const weapon = catalog?.weapons.find((w) => w.id === draft.weapon)?.name ?? draft.weapon ?? '?';
    return [weapon, ...stack([...draft.transformations, ...draft.upgrades]).map(({ id, count }) => nameOf(id) + (count > 1 ? ` ×${count}` : ''))];
  }

  function royaleView(viewer: string | null): RoyaleView | null {
    if (!royale) return null;
    const { fighters, result } = royale;
    const slot = viewer ? fighters.findIndex((f) => f.id === viewer) : -1;
    const places: RoyalePlace[] = result
      ? result.ranking.map((i, n) => ({ place: n + 1, id: fighters[i].id, name: fighters[i].name, color: fighters[i].color, build: buildOf(fighters[i].draft) }))
      : [];
    const first = places[0];
    return {
      status: royale.status,
      balls: fighters.length,
      msLeft: royale.status === 'soon' ? Math.max(0, royale.dropsAt - Date.now()) : null,
      arena: slot >= 0 ? `${ARENA}&follow=${slot}` : ARENA,
      winner: first ? { id: first.id, name: first.name, color: first.color } : null,
      places,
      seconds: result ? result.time : null,
      error: royale.error,
    };
  }

  // The arena is up while the royale fights (and its winner banner shows).
  function arenaWith(base: string | null, view: RoyaleView | null): string | null {
    return view?.status === 'fighting' ? view.arena : base;
  }

  function wordView(player: Player): WordView | null {
    const status = statusOf(player.id, player.entered, bracket.isOut(player));
    if (!status) return null;
    const word = wordState(player.id);
    const earned = breakOpen() && word.earned?.stage === breakStage ? word.earned : null;
    return {
      status,
      guesses: word.guesses,
      hints: letterHints(word.guesses),
      msLeft: status === 'guessing' ? guessUntil - Date.now() : null,
      earned: earned && { upgrades: earned.upgrades, transformation: earned.transformation },
      answer: word.solved || bracket.phase() === 'done' ? answer : null,
    };
  }

  async function startTournament() {
    reset();
    answer = await nextAnswer();
    upcoming = null;
    try {
      await bracket.startTournament();
    } catch (err) {
      upcoming = Promise.resolve(answer); // keep it for the next try
      answer = null;
      throw err;
    }
    void nextAnswer();
  }

  // The host starting the stage early closes the guesses too.
  function startStage() {
    guessUntil = Math.min(guessUntil, Date.now());
    bracket.startStage();
  }

  return {
    ...bracket,
    playerView(player: Player): PlayerView {
      const base = bracket.playerView(player);
      const final = royaleView(player.id);
      return { ...base, arena: arenaWith(base.arena, final), word: wordView(player), royale: final };
    },
    adminView(online: string[]): AdminView {
      const base = bracket.adminView(online);
      const final = royaleView(null);
      const open = breakOpen() && Date.now() < guessUntil;
      return {
        ...base,
        players: base.players.map((p) => {
          const word = state.get(p.id);
          const last = word?.guesses.at(-1);
          return { ...p, word: statusOf(p.id, p.entered, p.out), guesses: word?.guesses.length ?? 0, lastMarks: last && word!.guessedIn === breakStage ? last.marks : null };
        }),
        guessMsLeft: open ? guessUntil - Date.now() : null,
        answer: bracket.phase() === 'done' ? answer : null,
        arena: arenaWith(base.arena, final),
        royale: final,
      };
    },
    startTournament,
    startStage,
    guess,
  };
}

export type LetterBrawl = ReturnType<typeof createLetterBrawl>;
