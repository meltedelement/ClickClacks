// The game night: who has joined, their builds, and the tournament being played.
// All the rules live here. index.ts only connects it to HTTP, and the tournament
// service is reached through a TournamentService, so tests can play a tournament
// with a made-up one.
//
// lobby (join, choose a weapon, take the first pick) -> the host starts the
// tournament (unfinished drafts are completed at random, every player is an
// entrant) -> for each stage: `playing` (the service plays its 1v1s on the game,
// one at a time) -> the next stage is drawn -> `picking` (everyone still in takes
// one more pick; the stage starts by itself once they all have, or when the host
// says) -> ... -> `done` (a champion) -> the host goes back to the lobby.
import { randomUUID } from 'node:crypto';
import { PartyError } from '../../../party/server/index.ts';
import type { Catalog, CatalogUpgrade, FighterInput, Skin } from '../../../games/weapon-balls/api/game.d.ts';
import type { EntrantInput, FormatInfo, TournamentMatch } from '../../../contracts/tournament.d.ts';
import { playerColor } from '../../royale/shared/colors.ts';
import { changeLook, lookFields } from '../../royale/shared/looks.ts';
import { chooseWeapon, finishDraft, growDraft, isFinished, kindAt, newDraft, pick, stack, withTransformationNext } from '../../royale/shared/draft.ts';
import type { Draft, Random } from '../../royale/shared/draft.ts';
import { WEAPON_BLURBS } from '../../royale/shared/weapons.ts';
import type { AdminView, BracketTournament, BracketView, Described, DraftView, Stacked, LobbyEntry, MatchLine, Phase, PlayerView, Side, WinCard } from '../shared/types.ts';
import type { TournamentService } from './tournament.ts';

export const MAX_PLAYERS = 64;
const MAX_NAME = 20;
// Picks before the first stage: the transformation. Every later stage adds one upgrade.
export const START_PICKS = 1;
const DEFAULT_FORMAT = 'double-elimination';
const ARENA = '/game/?display&embed'; // the game's display page, through this app's proxy
// Played to the server's clock with the same math on every device, so every
// phone shows the same fight at the same moment (the game's `shared` setting).
const MATCH_SETTINGS = { shared: true };

export interface Player {
  token: string;
  id: string; // public: what other devices may see, and the entrant id
  name: string;
  color: string;
  draft: Draft;
  titles: number;
  entered: boolean; // in the tournament being played
  skin: Skin | null; // how the ball is drawn (the host's say, display only)
  tag: string | null; // before the name in the arena, e.g. "DEV"
}

export interface BracketOptions {
  service: TournamentService;
  /** Called after every change, for the views to go out again. */
  onChange(): void;
  /** How long the arena stays up after a stage's last match, so its winner card shows. */
  arenaHoldMs?: number;
  /** How long a match's winner card stays up (the game's display waits 4 s before the next match). */
  winCardMs?: number;
  random?: Random;
  /** The tournament's name on the tournament service. */
  name?: string;
  /** For an app that plays the bracket with its own rules between stages. */
  rules?: StageRules;
}

/**
 * How another app changes what happens between stages (the Letter Brawl hands
 * out upgrades for word guesses). Without it, everyone still in gets one upgrade
 * per stage and, once, a second transformation.
 */
export interface StageRules {
  /** A new stage was drawn and waits: give the players still in it their picks (grow their drafts). */
  newStage(stage: number, stillIn: Player[]): void;
  /** Call newStage for the first stage too, so it waits for what players owe before it starts. */
  beforeFirstStage?: boolean;
  /** Something besides a pick this player (entered, still in) must do before the stage starts by itself. */
  owes?(player: Player): boolean;
  /** The night went back to the lobby. */
  onLobby?(): void;
  /** The tournament has its champion (called once per tournament) with everyone who played in it and is still here. */
  onDone?(entered: Player[]): void;
}

export function createBracket({ service, onChange, arenaHoldMs = 4_500, winCardMs = 4_500, random = Math.random, name = 'Ball Bracket', rules }: BracketOptions) {
  const players = new Map<string, Player>(); // by token, in the order they joined
  let catalog: Catalog | null = null;
  let formats: FormatInfo[] = [];
  let format = DEFAULT_FORMAT;
  let colorsGiven = 0;
  let t: BracketTournament | null = null;
  let following: string | null = null; // the id of the tournament this night is playing
  let picksStage = 0; // the stage whose pick everyone has been given
  let bonusStage: number | null = null; // the stage that gave everyone still in a second transformation
  let held = false; // the host stopped the stage, or it failed to start: don't start it again by itself
  let starting = false;
  let championCounted: string | null = null; // the tournament whose champion got a title
  let arenaUntil = 0; // Date.now() until which the arena stays up after a stage
  let notice: string | null = null;
  let winCard: WinCard | null = null;
  let winCardUntil = 0;

  // ---- Views ---------------------------------------------------------------

  function phase(): Phase {
    if (!t) return 'lobby';
    if (t.status === 'done') return 'done';
    return t.status === 'playing' ? 'playing' : 'picking';
  }

  function describe(u: CatalogUpgrade): Described {
    return { id: u.id, name: u.name, description: u.description };
  }

  function describeId(id: string): Described {
    const known = catalog && [...catalog.transformations, ...catalog.upgrades].find((u) => u.id === id);
    return known ? describe(known) : { id, name: id, description: '' };
  }

  // Repeated picks as one entry, described for all the copies together.
  function describeStacked(ids: string[]): Stacked[] {
    return stack(ids).map(({ id, count }) => {
      const described = describeId(id);
      const known = catalog && [...catalog.transformations, ...catalog.upgrades].find((u) => u.id === id);
      const together = count > 1 ? known?.stacked?.[count - 2] : undefined;
      return { ...described, description: together ?? described.description, count };
    });
  }

  // Names for a one-line build: "Sharpened ×2".
  function stackedNames(ids: string[]): string[] {
    return stack(ids).map(({ id, count }) => describeId(id).name + (count > 1 ? ` ×${count}` : ''));
  }

  function describeWeapon(id: string): Described {
    const name = catalog?.weapons.find((w) => w.id === id)?.name ?? id;
    return { id, name, description: WEAPON_BLURBS[id] ?? '' };
  }

  function picksOf(draft: Draft): string[] {
    return [...draft.transformations, ...draft.upgrades];
  }

  function draftView(draft: Draft): DraftView {
    const finished = isFinished(draft);
    return {
      weapon: draft.weapon ? describeWeapon(draft.weapon) : null,
      weapons: draft.weapon ? [] : (catalog?.weapons ?? []).map((w) => describeWeapon(w.id)),
      finished,
      pickNumber: draft.step + 1,
      picksTotal: draft.length,
      kind: draft.weapon && !finished ? kindAt(draft.step, draft) : null,
      bonus: draft.weapon !== null && !finished && kindAt(draft.step, draft) === 'transformation' && draft.transformations.length > 0,
      offer: draft.offer.map(describeId),
      picks: describeStacked(picksOf(draft)),
    };
  }

  function entrantOf(player: Player) {
    return player.entered ? t?.entrants.find((e) => e.id === player.id) : undefined;
  }

  function isOut(player: Player): boolean {
    return entrantOf(player)?.progress.state === 'out';
  }

  // Whether this player has a pick to take before the stage can start.
  function owesPick(player: Player): boolean {
    return player.entered && !isOut(player) && (!isFinished(player.draft) || (phase() === 'picking' && (rules?.owes?.(player) ?? false)));
  }

  function lobbyEntry(player: Player): LobbyEntry {
    const entered = player.entered && t !== null;
    const ready = entered && phase() === 'picking' && !isOut(player) ? !owesPick(player) : isFinished(player.draft);
    return { id: player.id, name: player.name, color: player.color, ready, titles: player.titles, entered, out: isOut(player), skin: player.skin, tag: player.tag };
  }

  function lobby(): LobbyEntry[] {
    return [...players.values()].map(lobbyEntry);
  }

  function side(id: string): Side {
    const entrant = t?.entrants.find((e) => e.id === id);
    return { id, name: entrant?.name ?? '?', color: entrant?.color ?? null };
  }

  // The bracket round a match belongs to, e.g. "Winners semi-finals".
  function roundOf(m: TournamentMatch): string {
    return t?.stages[m.stage]?.groups.find((g) => g.side === m.side)?.name ?? '';
  }

  function matchLine(m: TournamentMatch): MatchLine {
    const how = m.decidedBy === 'hp' ? 'on HP' : m.decidedBy === 'manual' ? 'by the host' : null;
    return { id: m.id, round: roundOf(m), a: side(m.entrants[0]), b: side(m.entrants[1]), status: m.status, winner: m.winner, how };
  }

  function winCardOf(m: TournamentMatch): WinCard {
    const winnerIndex = m.entrants.indexOf(m.winner!);
    const result = (m as BracketTournament['matches'][number]).result;
    const how = m.decidedBy === 'manual' ? 'host' : m.decidedBy === 'hp' ? 'hp' : 'ko';
    return {
      matchId: m.id,
      winner: side(m.winner!),
      loser: side(m.entrants[1 - winnerIndex]),
      round: roundOf(m),
      seconds: result ? result.time : null,
      hpLeft: result?.hp?.[winnerIndex] ?? null,
      how,
    };
  }

  function bracketView(): BracketView | null {
    if (!t) return null;
    const index = t.stages.length - 1;
    const stage = t.stages[index];
    const inStage = t.matches.filter((m) => m.stage === index);
    const open = inStage.filter((m) => m.status === 'playing' || m.status === 'queued' || m.status === 'pending');
    const now = open.find((m) => m.status === 'playing') ?? (t.status === 'playing' ? open[0] : undefined) ?? null;
    const next = open.find((m) => m !== now) ?? null;
    const tournament = t;
    // The round on now, or the ones this stage still plays when nothing is on.
    const sameRound = now ? inStage.filter((m) => m.side === now.side) : [];
    const unfinished = (stage?.groups ?? []).filter((g) => !inStage.some((m) => m.side === g.side && m.status === 'done') || inStage.some((m) => m.side === g.side && m.status !== 'done'));
    return {
      format: formats.find((f) => f.id === t!.format)?.name ?? t.format,
      stage: index + 1,
      stages: Math.max(t.plan.length, index + 1),
      stageName: stage?.name ?? '',
      round: now ? roundOf(now) : (unfinished.length > 0 ? unfinished : (stage?.groups ?? [])).map((g) => g.name).join(' · '),
      roundMatch: now ? { n: sameRound.indexOf(now) + 1, of: sameRound.length } : null,
      groups: (stage?.groups ?? []).map((g) => ({
        name: g.name,
        matches: inStage.filter((m) => m.side === g.side).map(matchLine),
        bye: g.bye ? side(g.bye) : null,
        pending: g.pending ?? false,
      })),
      now: now && matchLine(now),
      next: next && matchLine(next),
      champion: t.champion ? side(t.champion) : null,
      justWon: winCard && Date.now() < winCardUntil ? winCard : null,
      standings: t.standings.map((s) => {
        const character = tournament.entrants.find((e) => e.id === s.entrant)?.character;
        const build = character ? [describeWeapon(character.weapon).name, ...stackedNames([...asList(character.transformations), ...asList(character.upgrades)])] : [];
        return { ...side(s.entrant), rank: s.rank, wins: s.wins, losses: s.losses, build };
      }),
    };
  }

  function arena(): string | null {
    return phase() === 'playing' || Date.now() < arenaUntil ? ARENA : null;
  }

  function playerView(player: Player): PlayerView {
    const entrant = entrantOf(player);
    return {
      phase: phase(),
      you: { id: player.id, name: player.name, color: player.color, titles: player.titles },
      draft: draftView(player.draft),
      lobby: lobby(),
      progress: entrant
        ? {
            state: entrant.progress.state,
            opponent: entrant.progress.opponent ? side(entrant.progress.opponent).name : null,
            bracket: entrant.progress.bracket,
            wins: entrant.progress.wins,
            losses: entrant.progress.losses,
          }
        : null,
      format: t?.format ?? null,
      bracket: bracketView(),
      arena: arena(),
      notice,
    };
  }

  function adminView(online: string[]): AdminView {
    const onlineIds = new Set(online.map((token) => players.get(token)?.id));
    return {
      phase: phase(),
      ready: catalog !== null,
      formats: formats.map((f) => ({ id: f.id, name: f.name, description: f.description })),
      format,
      players: [...players.values()].map((player) => ({
        ...lobbyEntry(player),
        online: onlineIds.has(player.id),
        picksDone: picksOf(player.draft).length,
        picksTotal: player.draft.length,
      })),
      bracket: bracketView(),
      arena: arena(),
      note: t?.note ?? '',
      notice,
    };
  }

  // ---- Players -------------------------------------------------------------

  function join(rawName: unknown): string {
    const name = String(rawName ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    if (!name) throw new PartyError('Enter a name');
    if (players.size >= MAX_PLAYERS) throw new PartyError('This game is full');
    const taken = [...players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new PartyError('That name is taken');
    const token = randomUUID();
    players.set(token, { token, id: randomUUID(), name, color: playerColor(colorsGiven++), draft: newDraft(START_PICKS), titles: 0, entered: false, skin: null, tag: null });
    onChange();
    return token;
  }

  // Draft rules throw plain errors whose messages are fit to show.
  function draftStep(player: Player, step: (catalog: Catalog) => Draft) {
    if (!catalog) throw new PartyError('The game is still starting. Try again in a moment.');
    if (player.entered && t && phase() !== 'picking') throw new PartyError('Picks open between stages.');
    const known = catalog;
    try {
      player.draft = step(known);
    } catch (err) {
      throw new PartyError((err as Error).message);
    }
    onChange();
    maybeStartStage();
  }

  function takeWeapon(player: Player, weapon: unknown) {
    draftStep(player, (known) => chooseWeapon(player.draft, String(weapon), known, random));
  }

  function takePick(player: Player, id: unknown) {
    draftStep(player, (known) => pick(player.draft, String(id), known, random));
  }

  // Someone in the tournament who leaves keeps fighting with the build they have.
  function leave(token: string) {
    players.delete(token);
    onChange();
    maybeStartStage();
  }

  // The host's colour, skin and tag for a player's ball. In a tournament they
  // show from the next stage, when builds are sent again.
  function setLook(id: unknown, change: unknown) {
    const player = [...players.values()].find((p) => p.id === id);
    if (!player) throw new PartyError('No such player');
    try {
      Object.assign(player, changeLook({ color: player.color, skin: player.skin, tag: player.tag }, change));
    } catch (err) {
      throw new PartyError((err as Error).message);
    }
    onChange();
  }

  function removeById(id: unknown) {
    const player = [...players.values()].find((p) => p.id === id);
    if (!player) throw new PartyError('No such player');
    leave(player.token);
  }

  // ---- The tournament ------------------------------------------------------

  function setFormat(value: unknown) {
    if (t) throw new PartyError('The format can only change in the lobby');
    if (!formats.some((f) => f.id === value)) throw new PartyError('There is no such format');
    format = String(value);
    onChange();
  }

  function toEntrant(player: Player): EntrantInput<FighterInput> {
    const { draft } = player;
    return {
      id: player.id,
      name: player.name,
      color: player.color,
      character: { name: player.name, color: player.color, ...lookFields(player), weapon: draft.weapon!, transformations: draft.transformations, upgrades: draft.upgrades },
    };
  }

  async function startTournament() {
    if (t) throw new PartyError('A tournament is already on');
    if (!catalog) throw new PartyError('The game is still starting. Try again in a moment.');
    if (players.size < 2) throw new PartyError('A tournament needs two players or more');
    const known = catalog;
    const entering = [...players.values()];
    for (const player of entering) {
      player.draft = finishDraft(player.draft, known, random);
      player.entered = true;
    }
    let created: BracketTournament;
    try {
      created = await service.create({ format: format as BracketTournament['format'], name, entrants: entering.map(toEntrant), match: MATCH_SETTINGS });
    } catch (err) {
      for (const player of entering) player.entered = false;
      onChange();
      throw new PartyError(`The tournament did not start: ${(err as Error).message}`);
    }
    picksStage = rules?.beforeFirstStage ? -1 : 0;
    bonusStage = null;
    held = false;
    notice = null;
    following = created.id;
    service.follow(created.id, receive);
    receive(created); // the first stage starts from here: every draft is finished
  }

  // Every version of the tournament, from the service's answers and its event stream.
  function receive(next: BracketTournament | null) {
    if (!next) {
      if (t) backToLobby('The tournament was deleted on the tournament service.');
      return;
    }
    if (next.id !== following) return; // one that ended
    if (t && next.version < t.version) return; // an older copy
    const wasPlaying = t?.status === 'playing';
    const before = t;
    t = next;
    // A match that just got its winner: up goes its card.
    const justDone = before ? t.matches.find((m) => m.status === 'done' && m.winner && before.matches.find((o) => o.id === m.id)?.status !== 'done') : undefined;
    if (justDone) {
      winCard = winCardOf(justDone);
      winCardUntil = Date.now() + winCardMs;
      setTimeout(onChange, winCardMs + 50);
    }
    if (wasPlaying && t.status !== 'playing') {
      arenaUntil = Date.now() + arenaHoldMs;
      setTimeout(onChange, arenaHoldMs + 50);
    }
    // A new stage: everyone still in gets one more pick. The first time the field
    // is down to its top half, they get a second transformation too, picked first.
    const stage = t.stages.length - 1;
    if (t.status === 'waiting' && stage > picksStage && rules) {
      picksStage = stage;
      held = false;
      rules.newStage(stage, [...players.values()].filter((p) => p.entered && !isOut(p)));
    } else if (t.status === 'waiting' && stage > picksStage) {
      picksStage = stage;
      held = false;
      const bonus = bonusStage === null && reachedFar(t, stage);
      if (bonus) bonusStage = stage;
      for (const player of players.values()) {
        if (!player.entered || isOut(player)) continue;
        const draft = bonus ? withTransformationNext(player.draft) : player.draft;
        const extra = draft.transformationSteps?.length ?? 0;
        player.draft = growDraft(draft, START_PICKS + stage + extra, catalog!, random);
      }
    }
    if (t.status === 'done' && t.champion && championCounted !== t.id) {
      championCounted = t.id;
      const champion = [...players.values()].find((p) => p.id === t!.champion);
      if (champion) champion.titles += 1;
      rules?.onDone?.([...players.values()].filter((p) => p.entered));
    }
    onChange();
    maybeStartStage();
  }

  function maybeStartStage() {
    if (phase() !== 'picking' || held || starting) return;
    if ([...players.values()].some(owesPick)) return;
    void startStage();
  }

  // Sends everyone's builds as they are now, then starts the stage. Anyone who
  // hasn't picked (the host pressed start) gets a random pick.
  async function startStage() {
    if (!t || !catalog) return;
    starting = true;
    const id = t.id;
    try {
      for (const player of players.values()) {
        if (player.entered) player.draft = finishDraft(player.draft, catalog, random);
      }
      const entered = [...players.values()].filter((p) => p.entered);
      if (entered.length > 0) receive(await service.patchEntrants(id, entered.map(toEntrant)));
      receive(await service.start(id));
      notice = null;
    } catch (err) {
      held = true;
      notice = `The stage did not start: ${(err as Error).message}`;
    } finally {
      starting = false;
      onChange();
    }
  }

  function hostStartStage() {
    if (phase() !== 'picking') throw new PartyError('No stage is waiting to start');
    held = false;
    void startStage();
  }

  async function stopStage() {
    if (!t || phase() !== 'playing') throw new PartyError('No stage is playing');
    held = true;
    receive(await service.stop(t.id));
  }

  function backToLobby(message: string | null) {
    t = null;
    following = null;
    service.follow(null, receive);
    for (const player of players.values()) {
      player.entered = false;
      player.draft = newDraft(START_PICKS);
    }
    arenaUntil = 0;
    held = false;
    notice = message;
    rules?.onLobby?.();
    onChange();
  }

  // Ends the tournament (finished or not) and goes back to the lobby, where
  // everyone drafts a new build.
  async function endTournament() {
    if (!t) throw new PartyError('No tournament is on');
    const { id } = t;
    backToLobby(null);
    await service.remove(id).catch(() => {});
  }

  return {
    findPlayer: (token: string) => players.get(token),
    phase,
    isOut,
    catalog: () => catalog,
    /** Starts a waiting stage if nobody owes anything any more: call after a change a rule cares about. */
    recheck: maybeStartStage,
    playerView,
    adminView,
    join,
    takeWeapon,
    takePick,
    leave,
    removeById,
    setLook,
    setFormat,
    startTournament,
    startStage: hostStartStage,
    stopStage,
    endTournament,
    setCatalog(next: Catalog) {
      catalog = next;
      onChange();
    },
    setFormats(next: FormatInfo[]) {
      formats = next;
      if (!formats.some((f) => f.id === format) && formats[0]) format = formats[0].id;
      onChange();
    },
  };
}

// "Pretty far": half the field or fewer still in (never fewer than two). Round
// robin knocks nobody out, so there it's the halfway stage.
function reachedFar(t: BracketTournament, stage: number): boolean {
  if (t.format === 'round-robin') return stage >= Math.ceil(t.plan.length / 2);
  const stillIn = t.entrants.filter((e) => e.progress.state !== 'out').length;
  return stillIn <= Math.max(2, Math.ceil(t.entrants.length / 2));
}

function asList(value: string[] | Record<string, number> | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Object.entries(value).flatMap(([id, n]) => Array(n).fill(id));
}

export type Bracket = ReturnType<typeof createBracket>;
