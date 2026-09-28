// Big-screen view for the host: the current question, how many teams answered,
// and after the reveal, the percentage of votes for each option. It never shows
// which team answered or what one team chose. One button moves the quiz on.
import { useEffect } from 'react';
import type { AdminView } from '../shared/types.ts';
import { AdminLogin, useAdmin } from './admin.tsx';
import { Brand, LETTERS, Status, ThemeToggle, WeaponSwatch } from './ui.tsx';

interface Step {
  label: string;
  action: Record<string, unknown>;
}

// The action the "next" button does in each phase.
function nextStep({ state }: AdminView): Step | null {
  const hasNext = state.questionIndex < state.questions.length - 1;
  const nextQuestion = { type: 'setQuestion', index: state.questionIndex + 1 };
  switch (state.phase) {
    case 'lobby':
      return state.questions.length ? { label: 'Start quiz', action: { type: 'setQuestion', index: state.questionIndex } } : null;
    case 'question':
      return { label: 'Close answers', action: { type: 'setPhase', phase: 'locked' } };
    case 'locked':
      return { label: 'Reveal answer', action: { type: 'setPhase', phase: 'reveal' } };
    case 'reveal':
      return hasNext ? { label: 'Next question', action: nextQuestion } : { label: 'Start battle', action: { type: 'setPhase', phase: 'battle' } };
    case 'battle':
      return hasNext ? { label: 'Next question', action: nextQuestion } : null;
  }
}

export function PresenterPage() {
  const admin = useAdmin();
  const { view, connected, act, error } = admin;
  const step = view ? nextStep(view) : null;

  // Space, Enter or the right arrow does the next step (for a clicker or a keyboard).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!step || e.repeat || (e.target as HTMLElement).closest('input, select, textarea, button')) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        act(step.action);
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
  const phaseLabel = { lobby: 'Lobby', question: 'Answers open', locked: 'Answers closed', reveal: 'Answer', battle: 'Battle' }[state.phase];

  return (
    <div className="present">
      <header className="topbar">
        <div className="topbar-inner">
          <Brand name="Weapon Balls quiz" />
          <div className="row">
            {q && state.phase !== 'lobby' && (
              <span className="muted num">
                Question {state.questionIndex + 1} of {state.questions.length}
              </span>
            )}
            <span className={state.phase === 'question' ? 'pill accent' : state.phase === 'reveal' ? 'pill good' : 'pill'}>{phaseLabel}</span>
            <Status connected={connected} />
            <ThemeToggle />
          </div>
        </div>
      </header>
      {q && state.phase !== 'lobby' && (
        <div className="progress" style={{ borderRadius: 0, height: 3 }}>
          <div style={{ width: `${((state.questionIndex + 1) / state.questions.length) * 100}%` }} />
        </div>
      )}

      <main className="present-body">
        {error && <p className="error">{error}</p>}
        {state.message && <p className="banner">{state.message}</p>}

        {state.phase === 'lobby' && (
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

        {state.phase === 'battle' && (
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

        {showQuestion && (
          <section className="stack loose">
            <div className="stack">
              <p className="eyebrow">{q.round}</p>
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
        <button className="ghost" disabled={state.questionIndex <= 0} onClick={() => act({ type: 'setQuestion', index: state.questionIndex - 1 })}>
          ← Previous question
        </button>
        <div className="row">
          <span className="hint">
            <kbd>Space</kbd> or <kbd>→</kbd>
          </span>
          {step ? (
            <button className="primary" onClick={() => act(step.action)}>
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
