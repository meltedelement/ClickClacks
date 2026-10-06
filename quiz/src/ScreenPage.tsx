// The big screen: what the room sees. It has no controls; the host drives it
// from the admin page. It shows the join address, the round titles, the
// questions and, after the reveal, the share of votes for each option. It never
// shows which team answered or what one team chose. In a battle break it shows
// the matches of the current stage (the admin page has the whole bracket), and while a stage plays it switches to the arena by itself: the
// game's display page, embedded, which plays the matches and reports each result.
// Beside the arena a panel follows the stage: each match, which arena it is on,
// and the results as they come in.
import { useEffect, useRef, useState } from 'react';
import type { AdminView, Stage, Tournament, TournamentMatch } from '../shared/types.ts';
import { currentStage, isSent, stageCount, stageMatches } from '../shared/tournament.ts';
import { roundPosition, stagesAllowed } from '../shared/rounds.ts';
import { AdminLogin, useAdmin } from './admin.tsx';
import { Standings } from './Bracket.tsx';
import { Brand, LETTERS, RoundProgress, TeamDot, WeaponSwatch, battleViewUrl, useJoinAddress, useSyncedTheme } from './ui.tsx';

// How long the arena stays up after a stage ends, so the last winner banner
// (shown for 4 s by the game's display page) is not cut off.
const ARENA_HOLD_MS = 6_000;
// The mouse pointer hides after this long without moving.
const CURSOR_IDLE_MS = 2_500;

type View = AdminView;

export function ScreenPage() {
  const admin = useAdmin();
  const { view, connected } = admin;
  const arena = useArena(view);
  const frame = useRef<HTMLIFrameElement>(null);
  const primed = usePrimed(frame);
  const layout = useArenaLayout(view, arena);
  const idle = useIdleCursor();
  useSyncedTheme();

  if (!view) return <AdminLogin title="Big screen" admin={admin} />;

  const { state } = view;
  const classes = ['screen'];
  if (idle) classes.push('idle');
  if (arena) classes.push('on-arena');

  return (
    <div className={classes.join(' ')}>
      <ArenaFrame view={view} frame={frame} visible={arena} />
      {arena ? (
        <ArenaPanel view={view} layout={layout} />
      ) : (
        <>
          <ScreenHeader view={view} connected={connected} />
          <main className="screen-body">
            {state.message && <p className="banner">{state.message}</p>}
            <Scene view={view} />
          </main>
        </>
      )}
      {arena && state.message && <p className="banner arena-message">{state.message}</p>}
      {!primed && <p className="screen-hint">Click anywhere for fullscreen and sound</p>}
    </div>
  );
}

function ScreenHeader({ view, connected }: { view: View; connected: boolean }) {
  const { state } = view;
  const intro = state.intro !== null ? roundPosition(state.questions, state.intro) : null;
  const round = roundPosition(state.questions, state.questionIndex);
  const inQuiz = state.phase === 'question' || state.phase === 'locked' || state.phase === 'reveal';

  let where = '';
  if (intro) where = `Round ${intro.index + 1} of ${intro.count}`;
  else if (inQuiz && round) where = `Round ${round.index + 1} of ${round.count} · Question ${round.position} of ${round.size}`;
  else if (state.phase === 'battle') where = 'Battle break';

  // The round title counts as the start of its round; otherwise the bar shows the current question.
  const bar = intro ? { round: intro.index, position: 0 } : inQuiz && round ? { round: round.index, position: round.position } : null;

  return (
    <>
      <header className="screen-head">
        <Brand />
        <div className="row">
          {!connected && <span className="status off">Reconnecting…</span>}
          {where && <span className="muted num">{where}</span>}
        </div>
      </header>
      {bar && round && <RoundProgress className="bleed" sizes={round.sizes} round={bar.round} position={bar.position} />}
    </>
  );
}

function Scene({ view }: { view: View }) {
  const { state } = view;
  if (state.intro !== null) return <RoundTitle view={view} index={state.intro} />;
  switch (state.phase) {
    case 'lobby':
      return <JoinScene view={view} />;
    case 'battle':
      return <BattleScene view={view} />;
    default:
      return <QuestionScene view={view} />;
  }
}

function JoinScene({ view }: { view: View }) {
  const address = useJoinAddress();
  return (
    <section className="join">
      <div className="stack loose">
        <p className="eyebrow">Get your phones out</p>
        <h1 className="screen-title">Join the Quiz of Doom</h1>
        <p className="join-url">{address}</p>
        <p className="screen-lead">Pick a team name, a colour and a weapon. Every correct answer upgrades your ball, and the balls fight in the arena.</p>
      </div>
      <TeamWall view={view} />
    </section>
  );
}

function TeamWall({ view }: { view: View }) {
  const { teams } = view.state;
  const weaponName = (id: string) => view.catalog.weapons.find((w) => w.id === id)?.name ?? id;
  return (
    <div className="stack">
      <p className="eyebrow">
        {teams.length === 0 ? 'No teams yet' : teams.length === 1 ? '1 team' : `${teams.length} teams`}
      </p>
      <div className="team-wall">
        {teams.map((t) => (
          <div key={t.id} className="team-card" style={{ '--team': t.color || 'var(--faint)' } as React.CSSProperties}>
            <strong>{t.name}</strong>
            <span className="row start">
              <WeaponSwatch id={t.weapon} />
              {weaponName(t.weapon)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoundTitle({ view, index }: { view: View; index: number }) {
  const round = roundPosition(view.state.questions, index);
  if (!round) return null;
  return (
    <section className="round-intro">
      <p className="eyebrow">
        Round {round.index + 1} of {round.count}
      </p>
      <h1 className="screen-title huge">{round.name}</h1>
      <p className="screen-lead">{round.size === 1 ? '1 question' : `${round.size} questions`}</p>
    </section>
  );
}

function QuestionScene({ view }: { view: View }) {
  const { state } = view;
  const q = state.questions[state.questionIndex];
  if (!q) return null;
  const answers = state.answers[q.id] ?? {};
  const answerCount = Object.keys(answers).length;
  const revealed = state.phase === 'reveal';
  const round = roundPosition(state.questions, state.questionIndex);

  return (
    <section className="stack loose">
      <div className="stack">
        <p className="eyebrow">{round ? round.name : q.round}</p>
        <h1 className="screen-title">{q.text}</h1>
      </div>
      <div className="options">
        {q.options.map((option, i) => {
          const votes = Object.values(answers).filter((choice) => choice === i).length;
          const percent = answerCount ? Math.round((votes / answerCount) * 100) : 0;
          const classes = ['screen-option'];
          if (revealed) classes.push(i === q.answer ? 'correct' : 'dim');
          return (
            <div key={i} className={classes.join(' ')}>
              <div className="line">
                <span className="letter">{LETTERS[i]}</span>
                <span className="text">{option}</span>
                {revealed && <span className="percent num">{percent}%</span>}
              </div>
              {revealed && (
                <div className="progress">
                  <div style={{ width: `${percent}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* The dots fill in join order, not by team, so the screen never shows which team answered. */}
      <div className="answered">
        <div className="answered-dots" aria-hidden="true">
          {state.teams.map((t, i) => (
            <span key={t.id} className={i < answerCount ? 'on' : ''} />
          ))}
        </div>
        <span className="num">
          {answerCount} of {state.teams.length} teams answered{state.phase === 'locked' && ' · answers closed'}
        </span>
      </div>
    </section>
  );
}

// Team names and colours by entrant id: the team's own, or what the tournament
// holds for a team that was deleted.
function teamLookup(view: View) {
  const entrant = (id: string) => view.tournament?.entrants.find((e) => e.id === id);
  return {
    teamName: (id: string) => view.state.teams.find((t) => t.entrantId === id)?.name ?? entrant(id)?.name ?? '(deleted team)',
    teamColor: (id: string) => view.state.teams.find((t) => t.entrantId === id)?.color ?? entrant(id)?.color ?? '',
  };
}

function BattleScene({ view }: { view: View }) {
  const { state } = view;
  const battle = view.tournament;
  const { teamName, teamColor } = teamLookup(view);

  if (!battle) {
    return (
      <section className="stack loose">
        <p className="eyebrow">Battle break</p>
        <h1 className="screen-title">The bracket is about to be drawn</h1>
        <TeamWall view={view} />
      </section>
    );
  }

  if (battle.champion) {
    const color = teamColor(battle.champion);
    return (
      <section className="champion" style={{ '--team': color || 'var(--accent)' } as React.CSSProperties}>
        <p className="eyebrow">Champion</p>
        <h1 className="screen-title huge">{teamName(battle.champion)}</h1>
        <p className="screen-lead">wins the battle</p>
      </section>
    );
  }

  const round = currentStage(battle);
  const stages = stageCount(battle);
  const picking = state.teams.filter((t) => (view.transformPicks[t.id] ?? 0) > 0);
  const lastBreak = stagesAllowed(state, state.questionIndex) === Infinity;

  return (
    <section className="stack loose battle-scene">
      <div className="stack">
        <p className="eyebrow">Battle break{lastBreak ? ' · the stages left play now' : ''}</p>
        <h1 className="screen-title">
          {round ? `${round.name} of ${stages}` : 'Battle'}
          {round?.status === 'waiting' && <span className="muted"> · up next</span>}
        </h1>
      </div>
      {round?.status === 'waiting' && picking.length > 0 && (
        <p className="banner">
          Pick a transformation on your phone.{' '}
          {picking.length <= 6 ? `Still picking: ${picking.map((t) => t.name).join(', ')}` : `${picking.length} teams are still picking.`}
        </p>
      )}
      {round && (
        <FitToScreen>
          <div className="stack loose">
            <StageBoard battle={battle} round={round} teamName={teamName} teamColor={teamColor} />
            {battle.format === 'round-robin' && <Standings battle={battle} teamName={teamName} teamColor={teamColor} />}
          </div>
        </FitToScreen>
      )}
    </section>
  );
}

// The matches of one stage, one block per bracket: who fights whom, and the
// results as they come in.
interface StageBoardProps {
  battle: Tournament;
  round: Stage;
  teamName: (id: string) => string;
  teamColor: (id: string) => string;
  // Beside the arena: how many arenas show, so each match can say which one it is on.
  screens?: { layout: number };
}

function StageBoard({ battle, round, teamName, teamColor, screens }: StageBoardProps) {
  const matches = stageMatches(battle, round.index);
  return (
    <div className="stage-board">
      {round.groups.map((group) => {
        const own = matches.filter((m) => m.side === group.side);
        return (
          <section key={group.side} className="stage-group" style={{ flexGrow: Math.max(1, own.length + (group.bye ? 1 : 0)) }}>
            <h2 className="eyebrow">{group.name}</h2>
            {group.pending ? (
              <p className="muted">Drawn when the winners bracket is finished</p>
            ) : (
              <div className="stage-matches">
                {own.map((match) => (
                  <ScreenMatch
                    key={match.id}
                    match={match}
                    teamName={teamName}
                    teamColor={teamColor}
                    screen={screens ? match.screen : undefined}
                    layout={screens?.layout ?? 1}
                  />
                ))}
                {group.bye && (
                  <div className="screen-match bye">
                    <div className="side">
                      <TeamDot color={teamColor(group.bye)} />
                      <span className="grow">{teamName(group.bye)}</span>
                    </div>
                    <p className="meta">{group.entrants.length === 1 ? 'Waits for the other bracket' : 'No match this stage'}</p>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

interface ScreenMatchProps {
  match: TournamentMatch;
  teamName: (id: string) => string;
  teamColor: (id: string) => string;
  screen?: number | null; // the arena it is on; undefined: not known here; null: sent, waiting for a free arena
  layout: number;
}

function ScreenMatch({ match, teamName, teamColor, screen, layout }: ScreenMatchProps) {
  const done = match.status === 'done';
  const side = (id: string, i: 0 | 1) => (
    <div className={done ? (match.winner === id ? 'side won' : 'side lost') : 'side'}>
      <TeamDot color={teamColor(id)} />
      <span className="grow">{teamName(id)}</span>
      {done && match.hp && <span className="num hp">{Math.round(match.hp[i])} HP</span>}
    </div>
  );
  const queued = isSent(match);
  const waiting = queued && screen === null;
  let meta: React.ReactNode = '';
  if (done) meta = match.decidedBy === 'hp' ? 'Won on HP' : match.decidedBy === 'host' ? 'Decided by the host' : 'Knockout';
  else if (waiting) meta = 'Waiting for an arena';
  else if (queued) {
    meta = (
      <>
        {screen != null && layout > 1 && <ScreenGlyph index={screen} layout={layout} />}
        Fighting now
      </>
    );
  } else if (screen !== undefined) meta = 'Up next';
  return (
    <div className={queued && !waiting ? 'screen-match live' : 'screen-match'}>
      {side(match.entrants[0], 0)}
      {side(match.entrants[1], 1)}
      {meta && <p className="meta">{meta}</p>}
    </div>
  );
}

// Scales its content down (never up) to fit the width of the page and the
// height left below it, so a 16-team bracket stays on one screen.
function FitToScreen({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, left: 0, height: undefined as number | undefined });

  useEffect(() => {
    function fit() {
      if (!outer.current || !inner.current) return;
      const bottom = parseFloat(getComputedStyle(document.documentElement).fontSize) * 2;
      const width = outer.current.clientWidth;
      const room = window.innerHeight - outer.current.getBoundingClientRect().top - window.scrollY - bottom;
      // The natural size: offsetWidth and offsetHeight ignore the transform.
      const scale = Math.min(1, width / inner.current.scrollWidth, room / inner.current.offsetHeight);
      setFit({ scale, left: (width - inner.current.scrollWidth * scale) / 2, height: inner.current.offsetHeight * scale });
    }
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(outer.current!);
    observer.observe(inner.current!);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  return (
    <div ref={outer} className="fit" style={{ height: fit.height }}>
      <div ref={inner} className="fit-inner" style={{ transform: `translateX(${fit.left}px) scale(${fit.scale})` }}>
        {children}
      </div>
    </div>
  );
}

// The game's display page, embedded. It stays loaded once the game has
// answered, also while it is hidden, so it counts as a connected display and
// the first match starts at once. Removing it mid-match would make the game put
// the match back in its queue, so it is never removed, only hidden.
function ArenaFrame({ view, frame, visible }: { view: View; frame: React.RefObject<HTMLIFrameElement | null>; visible: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!src && view.game.reachable && view.game.displayUrl) setSrc(battleViewUrl(view.game.displayUrl, { embed: true }));
  }, [src, view.game.reachable, view.game.displayUrl]);
  if (!src) return null;
  return (
    <iframe
      ref={frame}
      className={visible ? 'arena' : 'arena hidden'}
      src={src}
      title="Arena"
      allow="autoplay; fullscreen"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
    />
  );
}

// Beside the arena: the stage that is playing, so the room can follow the
// bracket. After the stage ends (while the arena stays up for the last winner)
// the next stage is already drawn, so this shows the last stage that started.
function ArenaPanel({ view, layout }: { view: View; layout: number }) {
  const battle = view.tournament;
  const round = battle && [...battle.stages].reverse().find((r) => r.status !== 'waiting');
  if (!battle || !round) return null;
  const { teamName, teamColor } = teamLookup(view);
  const stages = stageCount(battle);

  return (
    <aside className="arena-panel">
      <div>
        <p className="eyebrow">Battle</p>
        <h2 className="arena-panel-title">
          {round.name} <span className="muted">of {stages}</span>
        </h2>
      </div>
      <FitToScreen>
        <StageBoard battle={battle} round={round} teamName={teamName} teamColor={teamColor} screens={{ layout }} />
      </FitToScreen>
    </aside>
  );
}

// Which arena a match is on: a small map of the arena grid (two side by side,
// or 2×2 for three or four) with its cell filled.
function ScreenGlyph({ index, layout }: { index: number; layout: number }) {
  const cells = layout <= 2 ? 2 : 4;
  return (
    <span className={cells === 2 ? 'glyph wide' : 'glyph'} role="img" aria-label={`Arena ${index + 1}`}>
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} className={i === index ? 'on' : ''} />
      ))}
    </span>
  );
}

// How many arenas the display shows, following its rule (src/ui/TournamentDisplay.js
// in the game): it grows as soon as a match needs another arena, and shrinks
// only when a new set of matches starts after every arena is idle.
function useArenaLayout(view: View | undefined, arena: boolean): number {
  const [layout, setLayout] = useState(1);
  const idle = useRef(true);
  const battle = view?.tournament;
  const live = battle ? battle.matches.flatMap((m) => (isSent(m) && m.screen !== null ? [m.screen] : [])) : [];
  const needed = live.length ? Math.max(...live) + 1 : 0;
  useEffect(() => {
    if (!arena) {
      idle.current = true;
      return;
    }
    if (needed > layout || (idle.current && needed > 0)) setLayout(needed);
    idle.current = needed === 0;
  }, [arena, needed, layout]);
  return layout;
}

// True while a stage plays (and for a moment after), when the game can play it.
function useArena(view: View | undefined): boolean {
  const round = view?.tournament ? currentStage(view.tournament) : null;
  const live = Boolean(view?.game.reachable && round?.status === 'playing');
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (live) {
      setHeld(true);
      return;
    }
    const timer = setTimeout(() => setHeld(false), ARENA_HOLD_MS);
    return () => clearTimeout(timer);
  }, [live]);
  return live || held;
}

// The first click goes fullscreen and lets the embedded arena play sound
// (browsers block sound until someone clicks the page). Until then a hint shows.
function usePrimed(frame: React.RefObject<HTMLIFrameElement | null>): boolean {
  const [primed, setPrimed] = useState(false);
  useEffect(() => {
    function onClick() {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      frame.current?.contentWindow?.postMessage('weapon-balls:unlock-audio', '*');
      setPrimed(true);
    }
    window.addEventListener('pointerdown', onClick);
    return () => window.removeEventListener('pointerdown', onClick);
  }, [frame]);
  return primed;
}

// Hides the mouse pointer when it has not moved for a moment.
function useIdleCursor(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS);
    function onMove() {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS);
    }
    window.addEventListener('pointermove', onMove);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);
  return idle;
}
