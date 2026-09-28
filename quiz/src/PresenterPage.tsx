// Big-screen view for the host: the current question, how many teams answered,
// and after the reveal, the percentage of votes for each option. It never shows
// which team answered or what one team chose. One button moves the quiz on.
import { useEffect } from 'react';
import type { AdminView } from '../shared/types.ts';
import { AdminLogin, useAdmin } from './admin.tsx';

const LETTERS = 'ABCDEFGH';

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
  const revealed = !!q && state.phase === 'reveal';
  const showQuestion = q && (state.phase === 'question' || state.phase === 'locked' || state.phase === 'reveal');
  const weaponName = (id: string) => catalog.weapons.find((w) => w.id === id)?.name ?? id;

  return (
    <main className="present">
      <header className="row">
        <div className="hint">
          {q ? `Question ${state.questionIndex + 1} / ${state.questions.length} · ${q.round}` : 'No questions'} · {state.phase}
        </div>
        <span className={connected ? 'ok' : 'error'}>{connected ? 'connected' : 'reconnecting…'}</span>
      </header>
      {error && <p className="error">{error}</p>}
      {state.message && <p className="banner">{state.message}</p>}

      {state.phase === 'lobby' && (
        <section>
          <h1 className="big">Join the quiz</h1>
          <p className="question">
            Open <strong>{location.origin}</strong> on your phone.
          </p>
        </section>
      )}

      {state.phase === 'battle' && <h1 className="big">Battle time!</h1>}

      {showQuestion && (
        <section>
          <h1 className="big">{q.text}</h1>
          <p className="hint">
            {Object.keys(answers).length} / {state.teams.length} teams answered
          </p>
          <div className="options-grid">
            {q.options.map((option, i) => {
              const votes = Object.values(answers).filter((choice) => choice === i).length;
              const percent = Object.keys(answers).length ? Math.round((votes / Object.keys(answers).length) * 100) : 0;
              const classes = ['present-option'];
              if (revealed) classes.push(i === q.answer ? 'correct' : 'dim');
              return (
                <div key={i} className={classes.join(' ')}>
                  <div className="row">
                    <span>
                      <strong>{LETTERS[i]}</strong> {option}
                    </span>
                    {revealed && <span className="count">{percent}%</span>}
                  </div>
                  {revealed && (
                    <div className="bar">
                      <div style={{ width: `${percent}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(state.phase === 'lobby' || state.phase === 'battle') && (
        <section>
          <h2>Teams ({state.teams.length})</h2>
          <div className="chips">
            {state.teams.length === 0 && <span className="hint">No teams yet.</span>}
            {state.teams.map((t) => (
              <span key={t.id} className="chip">
                {t.name}
                <span className="hint"> · {weaponName(t.weapon)}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <footer className="row">
        <button disabled={state.questionIndex <= 0} onClick={() => act({ type: 'setQuestion', index: state.questionIndex - 1 })}>
          ◀ Prev question
        </button>
        {step ? (
          <button className="next" onClick={() => act(step.action)}>
            {step.label} ▶
          </button>
        ) : (
          <span className="hint">End of the quiz</span>
        )}
      </footer>
      <p className="hint">Space, Enter or → also does the next step.</p>
    </main>
  );
}
