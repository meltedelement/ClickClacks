// Big-screen view for the host: the current question, how many teams answered,
// and after the reveal, the percentage of votes for each option. It never shows
// which team answered or what one team chose. One button moves the quiz on,
// including into a battle break after every second round (see shared/rounds.ts).
import { useEffect, useState } from 'react';
import type { AdminView } from '../shared/types.ts';
import { currentRound, plannedStages } from '../shared/battle.ts';
import { Bracket } from './Bracket.tsx';
import { breakAfter, roundPosition, stagesAllowed, startsRound } from '../shared/rounds.ts';
import { AdminLogin, useAdmin } from './admin.tsx';
import { BattleViewLink, Brand, LETTERS, RoundProgress, Status, TeamDot, ThemeToggle, WeaponSwatch, battleViewUrl } from './ui.tsx';

// A step either sends an admin action, or shows the title of the round that
// starts at question `intro`. The round title exists only on this screen.
type Step = { label: string; action: Record<string, unknown> } | { label: string; intro: number };

// The step the "next" button does in each phase.
function nextStep({ state }: AdminView, intro: number | null): Step | null {
  if (intro !== null) return { label: 'Start round', action: { type: 'setQuestion', index: intro } };
  const hasNext = state.questionIndex < state.questions.length - 1;
  const goTo = (index: number): Step =>
    startsRound(state.questions, index) ? { label: 'Next round', intro: index } : { label: 'Next question', action: { type: 'setQuestion', index } };
  switch (state.phase) {
    case 'lobby':
      return state.questions.length ? { ...goTo(state.questionIndex), label: 'Start quiz' } : null;
    case 'question':
      return { label: 'Close answers', action: { type: 'setPhase', phase: 'locked' } };
    case 'locked':
      return { label: 'Reveal answer', action: { type: 'setPhase', phase: 'reveal' } };
    case 'reveal': {
      // A battle break after every second round and after the last one, until there is a champion.
      const battleLeft = state.teams.length >= 2 && !state.battle?.champion;
      if (battleLeft && breakAfter(state.questions, state.questionIndex)) return { label: 'Start battle', action: { type: 'setPhase', phase: 'battle' } };
      return hasNext ? goTo(state.questionIndex + 1) : null;
    }
    case 'battle': {
      // The host starts each stage from here. A break plays one stage; the
      // break after the last round plays every stage that is left.
      const battle = state.battle;
      const round = battle && currentRound(battle);
      if (!battle) return state.teams.length >= 2 ? { label: 'Draw the bracket', action: { type: 'battleCreate' } } : null;
      if (round?.status === 'playing') return null;
      if (round && !battle.champion && round.status === 'waiting' && round.index < stagesAllowed(state.questions, state.questionIndex)) {
        return { label: `Start ${round.name.toLowerCase()}`, action: { type: 'battleStartRound' } };
      }
      return hasNext ? { ...goTo(state.questionIndex + 1), label: 'Back to the quiz' } : null;
    }
  }
}

// The address teams type in to join. A presenter opened on localhost would
// show "localhost", which no phone can reach, so it asks the server for its
// address on the local network and keeps this page's port.
function useJoinAddress(): string {
  const [address, setAddress] = useState(location.host);
  useEffect(() => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
    fetch('/api/lan')
      .then((res) => res.json())
      .then(({ addresses }: { addresses: string[] }) => {
        if (addresses[0]) setAddress(location.port ? `${addresses[0]}:${location.port}` : addresses[0]);
      })
      .catch(() => {}); // keep showing location.host
  }, []);
  return address;
}

export function PresenterPage() {
  const admin = useAdmin();
  const { view, connected, act, error } = admin;
  const [intro, setIntro] = useState<number | null>(null);
  const joinAddress = useJoinAddress();
  const step = view ? nextStep(view, intro) : null;

  // Any change from the server (from this screen or the admin page) ends the round title.
  useEffect(() => setIntro(null), [view?.state.questionIndex, view?.state.phase]);

  function run(s: Step) {
    if ('intro' in s) setIntro(s.intro);
    else act(s.action);
  }

  // Space, Enter or the right arrow does the next step (for a clicker or a keyboard).
  // Space and Enter already press a focused button, so skip them there. The
  // arrow and Page Down must still work after a click leaves the focus on a button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!step || e.repeat) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea')) return;
      if ((e.key === ' ' || e.key === 'Enter') && target.closest('button')) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        run(step);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!view) return <AdminLogin title="Presenter view" admin={admin} />;

  const { state, catalog } = view;
  const q = state.questions[state.questionIndex];
  const answers = (q && state.answers[q.id]) ?? {};
  const answerCount = Object.keys(answers).length;
  const revealed = !!q && state.phase === 'reveal';
  const showQuestion = q && (state.phase === 'question' || state.phase === 'locked' || state.phase === 'reveal');
  const weaponName = (id: string) => catalog.weapons.find((w) => w.id === id)?.name ?? id;
  const phaseLabel = intro !== null ? 'Next round' : { lobby: 'Lobby', question: 'Answers open', locked: 'Answers closed', reveal: 'Answer', battle: 'Battle' }[state.phase];
  const round = q ? roundPosition(state.questions, state.questionIndex) : null;
  const introRound = intro !== null ? roundPosition(state.questions, intro) : null;
  // The bar shows the round title as the start of its round, and otherwise the current question.
  const bar = introRound ? { round: introRound.index, position: 0 } : round && state.phase !== 'lobby' ? { round: round.index, position: round.position } : null;

  return (
    <div className="present">
      <header className="topbar">
        <div className="topbar-inner">
          <Brand name="Weapon Balls quiz" />
          <div className="row">
            {introRound ? (
              <span className="muted num">
                Round {introRound.index + 1} of {introRound.count}
              </span>
            ) : (
              round &&
              state.phase !== 'lobby' && (
                <span className="muted num">
                  Round {round.index + 1} of {round.count} · Question {round.position} of {round.size}
                </span>
              )
            )}
            <span className={state.phase === 'question' ? 'pill accent' : state.phase === 'reveal' ? 'pill good' : 'pill'}>{phaseLabel}</span>
            <BattleViewLink gameApi={view.game.url} />
            <Status connected={connected} />
            <ThemeToggle />
          </div>
        </div>
      </header>
      {bar && round && <RoundProgress className="bleed" sizes={round.sizes} round={bar.round} position={bar.position} />}

      <main className="present-body">
        {error && <p className="error">{error}</p>}
        {state.message && <p className="banner">{state.message}</p>}

        {introRound && (
          <section className="round-intro">
            <p className="eyebrow">
              Round {introRound.index + 1} of {introRound.count}
            </p>
            <h1 className="present-q">{introRound.name}</h1>
            <p className="muted">{introRound.size === 1 ? '1 question' : `${introRound.size} questions`}</p>
          </section>
        )}

        {!introRound && state.phase === 'lobby' && (
          <section className="join">
            <div>
              <p className="eyebrow">Get your phones out</p>
              <h1 className="present-q" style={{ marginTop: 12 }}>
                Join the quiz
              </h1>
              <p className="muted" style={{ marginTop: 16, fontSize: 20 }}>
                Open this address, choose a team name and a weapon.
              </p>
              <span className="join-url">{joinAddress}</span>
            </div>
            <TeamList teams={state.teams} weaponName={weaponName} />
          </section>
        )}

        {!introRound && state.phase === 'battle' && (
          <section className="stack loose">
            <div>
              <p className="eyebrow">Watch the arena</p>
              <h1 className="present-q" style={{ marginTop: 12 }}>
                Battle time
              </h1>
            </div>
            <BattleBoard view={view} />
            {!state.battle && <TeamList teams={state.teams} weaponName={weaponName} />}
          </section>
        )}

        {!introRound && showQuestion && (
          <section className="stack loose">
            <div className="stack">
              <p className="eyebrow">{round ? `Round ${round.index + 1} · ${round.name}` : q.round}</p>
              <h1 className="present-q">{q.text}</h1>
            </div>
            <div className="present-grid">
              {q.options.map((option, i) => {
                const votes = Object.values(answers).filter((choice) => choice === i).length;
                const percent = answerCount ? Math.round((votes / answerCount) * 100) : 0;
                const classes = ['present-option'];
                if (revealed) classes.push(i === q.answer ? 'correct' : 'dim');
                return (
                  <div key={i} className={classes.join(' ')}>
                    <div className="line">
                      <span className="letter">{LETTERS[i]}</span>
                      <span className="text">{option}</span>
                      {revealed && <span className="percent">{percent}%</span>}
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
            <div className="answered present-meta">
              <div className="answered-dots" aria-hidden="true">
                {state.teams.map((t, i) => (
                  <span key={t.id} className={i < answerCount ? 'on' : ''} />
                ))}
              </div>
              <span className="num">
                {answerCount} of {state.teams.length} teams answered
              </span>
            </div>
          </section>
        )}
      </main>

      <footer className="present-footer">
        {/* Different keys, so a focused Back button is not reused as "Previous question" when Space is pressed next. */}
        {intro !== null ? (
          <button key="back" className="ghost" onClick={() => setIntro(null)}>
            ← Back
          </button>
        ) : (
          <button key="previous" className="ghost" disabled={state.questionIndex <= 0} onClick={() => act({ type: 'setQuestion', index: state.questionIndex - 1 })}>
            ← Previous question
          </button>
        )}
        <div className="row">
          <span className="hint">
            <kbd>Space</kbd> or <kbd>→</kbd>
          </span>
          {step ? (
            <button className="primary" onClick={() => run(step)}>
              {step.label} →
            </button>
          ) : (
            <span className="muted">{state.phase === 'battle' && state.battle && !state.battle.champion ? 'Stage in progress' : 'End of the quiz'}</span>
          )}
        </div>
      </footer>
    </div>
  );
}

function TeamList({ teams, weaponName }: { teams: AdminView['state']['teams']; weaponName: (id: string) => string }) {
  return (
    <div className="stack">
      <div className="row">
        <h2 className="eyebrow">Teams</h2>
        <span className="muted num">{teams.length}</span>
      </div>
      {teams.length === 0 ? (
        <p className="muted">No teams yet.</p>
      ) : (
        <div className="team-grid">
          {teams.map((t) => (
            <div key={t.id} className="team-card">
              <strong>
                <TeamDot color={t.color} /> {t.name}
              </strong>
              <span className="row start" style={{ gap: 8 }}>
                <WeaponSwatch id={t.weapon} />
                {weaponName(t.weapon)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// What the room watches while the arena plays: the bracket, who still has to
// pick a transformation, and who won. The display page decides each result;
// the quiz only records it.
function BattleBoard({ view }: { view: AdminView }) {
  const { state, game } = view;
  const battle = state.battle;
  if (!battle) return <p className="muted">The bracket is not drawn yet.</p>;

  const teamName = (id: string) => state.teams.find((t) => t.id === id)?.name ?? '(deleted team)';
  const teamColor = (id: string) => state.teams.find((t) => t.id === id)?.color ?? '';
  const round = currentRound(battle);
  const stages = Math.max(plannedStages(battle.rounds[0]?.groups[0]?.teams.length ?? 0).length, battle.rounds.length);
  const picking = state.teams.filter((t) => (view.transformPicks[t.id] ?? 0) > 0);

  return (
    <div className="stack loose">
      {round && !battle.champion && (
        <p className="muted num">
          {round.name} of {stages}
          {stagesAllowed(state.questions, state.questionIndex) === Infinity ? ' · the stages left play now' : ' · one stage in this break'}
        </p>
      )}
      {round?.status === 'waiting' && !battle.champion && picking.length > 0 && (
        <p className="banner">
          Pick a transformation on your phone before the stage starts. Still picking: {picking.map((t) => t.name).join(', ')}.
        </p>
      )}
      {battle.note && <p className="banner">{battle.note}</p>}
      {game.restart && <p className="banner">The game restarted. The matches on screen start again from the beginning, with the same fights.</p>}
      {!game.reachable && <p className="banner">The game server is not answering at {game.url}.</p>}
      {game.reachable && game.displays === 0 && (
        <p className="banner">No display page is open. Show {battleViewUrl(game.url)} on the big screen.</p>
      )}
      {battle.champion && <h2 className="present-q">{teamName(battle.champion)} wins the battle</h2>}
      <div className="scroll">
        <Bracket battle={battle} teamName={teamName} teamColor={teamColor} onScreen={game.reachable && game.displays > 0 ? game.onScreen : undefined} />
      </div>
    </div>
  );
}
