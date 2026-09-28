import { useState } from 'react';
import type { AdminView, Team } from '../shared/types.ts';
import { PHASES } from '../shared/types.ts';
import { post, useEvents } from './api.ts';

const KEY_STORAGE = 'quiz-admin-key';

export function AdminPage() {
  const [key, setKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? '');
  const [error, setError] = useState('');
  // With no key, stay disconnected instead of retrying a request the server rejects.
  const { data: view, connected } = useEvents<AdminView>(key ? `/api/events?key=${encodeURIComponent(key)}` : null);

  async function act(body: Record<string, unknown>) {
    setError('');
    try {
      await post('/api/admin', body, { 'x-admin-key': key });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function saveKey(value: string) {
    localStorage.setItem(KEY_STORAGE, value);
    setKey(value);
  }

  if (!view) {
    return (
      <main>
        <h1>Quiz admin</h1>
        <p>{connected ? 'Loading…' : key ? 'Wrong admin key, or the server is not running.' : 'Enter the admin key to continue.'}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveKey((new FormData(e.currentTarget).get('key') as string).trim());
          }}
        >
          <input name="key" type="password" placeholder="Admin key" defaultValue={key} autoFocus /> <button>Connect</button>
        </form>
        <p className="hint">The server prints the admin key when it starts.</p>
      </main>
    );
  }

  const { state, catalog, picks, online } = view;
  const q = state.questions[state.questionIndex];
  const answers = (q && state.answers[q.id]) ?? {};

  return (
    <main className="wide">
      <header className="row">
        <h1>Quiz admin</h1>
        <span className={connected ? 'ok' : 'error'}>{connected ? 'connected' : 'reconnecting…'}</span>
      </header>
      {error && <p className="error">{error}</p>}

      <section>
        <h2>Flow</h2>
        <div className="row wrap">
          {PHASES.map((phase) => (
            <button key={phase} className={state.phase === phase ? 'selected' : ''} onClick={() => act({ type: 'setPhase', phase })}>
              {phase}
            </button>
          ))}
        </div>
        <div className="row wrap">
          <button disabled={state.questionIndex <= 0} onClick={() => act({ type: 'setQuestion', index: state.questionIndex - 1 })}>
            ◀ Prev question
          </button>
          <select value={state.questionIndex} onChange={(e) => act({ type: 'setQuestion', index: Number(e.target.value) })}>
            {state.questions.map((question, i) => (
              <option key={question.id} value={i}>
                {question.id} {question.text.slice(0, 50)}
              </option>
            ))}
          </select>
          <button disabled={state.questionIndex >= state.questions.length - 1} onClick={() => act({ type: 'setQuestion', index: state.questionIndex + 1 })}>
            Next question ▶
          </button>
        </div>
        <p className="hint">
          Order: question (teams answer) → locked (answers closed) → reveal (teams that got it right pick an upgrade at once) →
          battle. Selecting a question opens it for answers.
        </p>
      </section>

      {q && (
        <section>
          <h2>
            Q{q.id}: {q.text}
          </h2>
          <p className="hint">{q.round}</p>
          <p>
            {Object.keys(answers).length} / {state.teams.length} teams answered · {state.revealed.includes(q.id) ? 'revealed' : 'not revealed'}
          </p>
          <ol className="options">
            {q.options.map((option, i) => (
              <li key={i} className={i === q.answer ? 'correct' : ''}>
                {option} — {state.teams.filter((t) => answers[t.id] === i).map((t) => t.name).join(', ') || '–'}
              </li>
            ))}
          </ol>
          <p>No answer: {state.teams.filter((t) => answers[t.id] === undefined).map((t) => t.name).join(', ') || '–'}</p>
        </section>
      )}

      <section>
        <h2>Teams ({state.teams.length})</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Code</th>
                <th>Weapon</th>
                <th>Picks left</th>
                <th>Bonus picks</th>
                <th>Upgrades</th>
                <th>Offer</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {state.teams.map((team) => (
                <TeamRow key={team.id} team={team} view={view} picks={picks[team.id]} online={online.includes(team.id)} act={act} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Message and weapons</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            act({ type: 'setMessage', text: new FormData(e.currentTarget).get('text') });
          }}
        >
          <input name="text" key={state.message} defaultValue={state.message} placeholder="Banner shown to all teams" />
          <button>Set</button>
          <button type="button" onClick={() => act({ type: 'setMessage', text: '' })}>
            Clear
          </button>
        </form>
        <label>
          <input type="checkbox" checked={state.weaponsLocked} onChange={(e) => act({ type: 'setWeaponsLocked', locked: e.target.checked })} /> Lock weapon
          choice
        </label>
      </section>

      <section>
        <h2>All answers (dev)</h2>
        <p className="hint">Change any answer here. Picks are recalculated from the answers of revealed questions, so fixes apply at once.</p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Question</th>
                <th>Revealed</th>
                {state.teams.map((t) => (
                  <th key={t.id}>{t.name}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {state.questions.map((question) => (
                <tr key={question.id}>
                  <td title={question.text}>
                    {question.id} correct: {question.options[question.answer]}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={state.revealed.includes(question.id)}
                      onChange={(e) => act({ type: 'setRevealed', questionId: question.id, revealed: e.target.checked })}
                    />
                  </td>
                  {state.teams.map((t) => {
                    const choice = state.answers[question.id]?.[t.id];
                    return (
                      <td key={t.id} className={choice === undefined ? '' : choice === question.answer ? 'correct' : 'wrong'}>
                        <select
                          value={choice ?? ''}
                          onChange={(e) =>
                            act({ type: 'setAnswer', questionId: question.id, teamId: t.id, choice: e.target.value === '' ? null : Number(e.target.value) })
                          }
                        >
                          <option value="">–</option>
                          {question.options.map((option, i) => (
                            <option key={i} value={i}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                  <td>
                    <button className="small" onClick={() => confirm('Clear all answers for this question?') && act({ type: 'clearAnswers', questionId: question.id })}>
                      Clear
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Dev controls</h2>
        <div className="row wrap">
          <button onClick={() => act({ type: 'reloadQuestions' })}>Reload quiz-questions.json</button>
          <button onClick={() => navigator.clipboard.writeText(JSON.stringify(loadouts(view), null, 2))}>Copy loadouts JSON</button>
          <a href="/api/loadouts" target="_blank">
            /api/loadouts
          </a>
          <button onClick={() => confirm('Reset the quiz but keep teams? Answers and upgrades are removed.') && act({ type: 'reset', keepTeams: true })}>
            Reset (keep teams)
          </button>
          <button className="danger" onClick={() => confirm('Reset everything, including teams?') && act({ type: 'reset', keepTeams: false })}>
            Reset everything
          </button>
        </div>
        <details>
          <summary>Raw state</summary>
          <pre>{JSON.stringify(state, null, 2)}</pre>
        </details>
      </section>
      <p className="hint">Upgrades available: {catalog.upgrades.map((u) => u.id).join(', ')}</p>
    </main>
  );
}

function loadouts({ state }: AdminView) {
  return state.teams.map((t) => ({ team: t.name, weapon: t.weapon, upgrades: t.upgrades }));
}

interface TeamRowProps {
  team: Team;
  view: AdminView;
  picks: number;
  online: boolean;
  act: (body: Record<string, unknown>) => void;
}

function TeamRow({ team, view, picks, online, act }: TeamRowProps) {
  const { catalog } = view;
  const update = (patch: Partial<Team>) => act({ type: 'updateTeam', teamId: team.id, patch });
  const setUpgrade = (id: string, n: number) => update({ upgrades: { ...team.upgrades, [id]: n } });
  const upgradeName = (id: string) => catalog.upgrades.find((u) => u.id === id)?.name ?? id;

  return (
    <tr>
      <td>
        <span className={online ? 'ok' : 'muted'}>●</span>{' '}
        <input
          key={team.name}
          defaultValue={team.name}
          size={12}
          onBlur={(e) => e.target.value !== team.name && update({ name: e.target.value })}
        />
      </td>
      <td>{team.code}</td>
      <td>
        <select value={team.weapon} onChange={(e) => update({ weapon: e.target.value })}>
          {catalog.weapons.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </td>
      <td className={picks < 0 ? 'error' : ''}>{picks}</td>
      <td className="nowrap">
        <button className="small" onClick={() => update({ bonusPicks: team.bonusPicks - 1 })}>
          −
        </button>{' '}
        {team.bonusPicks}{' '}
        <button className="small" onClick={() => update({ bonusPicks: team.bonusPicks + 1 })}>
          +
        </button>
      </td>
      <td>
        {Object.entries(team.upgrades).map(([id, n]) => (
          <div key={id} className="nowrap">
            {upgradeName(id)} ×{n}{' '}
            <button className="small" onClick={() => setUpgrade(id, n - 1)}>
              −
            </button>
            <button className="small" onClick={() => setUpgrade(id, n + 1)}>
              +
            </button>
          </div>
        ))}
        <select value="" onChange={(e) => e.target.value && setUpgrade(e.target.value, (team.upgrades[e.target.value] ?? 0) + 1)}>
          <option value="">+ add…</option>
          {catalog.upgrades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        {team.offer?.map(upgradeName).join(', ') ?? '–'}{' '}
        {team.offer && (
          <button className="small" onClick={() => act({ type: 'rerollOffer', teamId: team.id })}>
            Reroll
          </button>
        )}
      </td>
      <td>
        <button className="small danger" onClick={() => confirm(`Delete team ${team.name}?`) && act({ type: 'deleteTeam', teamId: team.id })}>
          Delete
        </button>
      </td>
    </tr>
  );
}
