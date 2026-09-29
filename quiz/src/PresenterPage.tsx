// Big-screen view for the host: the current question, how many teams answered,
// and after the reveal, the percentage of votes for each option. It never shows
// which team answered or what one team chose. One button moves the quiz on.
import { useEffect, useState } from 'react';
import type { AdminView } from '../shared/types.ts';
import { roundPosition, startsRound } from '../shared/rounds.ts';
import { AdminLogin, useAdmin } from './admin.tsx';
import { Brand, LETTERS, RoundProgress, Status, ThemeToggle, WeaponSwatch } from './ui.tsx';

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
    case 'reveal':
      return hasNext ? goTo(state.questionIndex + 1) : { label: 'Start battle', action: { type: 'setPhase', phase: 'battle' } };
    case 'battle':
      return hasNext ? goTo(state.questionIndex + 1) : null;
  }
}

export function PresenterPage() {
  const admin = useAdmin();
  const { view, connected, act, error } = admin;
  const [intro, setIntro] = useState<number | null>(null);
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
              <span className="join-url">{location.host}</span>
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
            <TeamList teams={state.teams} weaponName={weaponName} />
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
            <span className="muted">End of the quiz</span>
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
              <strong>{t.name}</strong>
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
