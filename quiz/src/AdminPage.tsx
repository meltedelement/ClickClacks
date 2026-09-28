import { Fragment } from 'react';
import type { AdminView, Team } from '../shared/types.ts';
import { PHASES } from '../shared/types.ts';
import { standings } from '../shared/battle.ts';
import { groupRounds, roundPosition } from '../shared/rounds.ts';
import { AdminLogin, useAdmin } from './admin.tsx';
import { Brand, LETTERS, Status, ThemeToggle } from './ui.tsx';

export function AdminPage() {
  const admin = useAdmin();
  const { view, connected, act, error } = admin;

  if (!view) return <AdminLogin title="Quiz admin" admin={admin} />;

  const { state, catalog, picks, online } = view;
  const q = state.questions[state.questionIndex];
  const answers = (q && state.answers[q.id]) ?? {};
  const rounds = groupRounds(state.questions);
  const round = roundPosition(state.questions, state.questionIndex);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand name="Quiz admin" />
          <div className="row">
            <a href="/present" target="_blank">
              Open presenter view ↗
            </a>
            <Status connected={connected} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="page wide">
        {error && <p className="error">{error}</p>}

        <div className="admin-grid">
          <div className="stack">
            <section className="card stack">
              <div className="card-head" style={{ marginBottom: 0 }}>
                <h2>Flow</h2>
                {round && (
                  <span className="muted num">
                    Round {round.index + 1} of {round.count} · Question {round.position} of {round.size}
                  </span>
                )}
              </div>
              <div className="segmented" role="group" aria-label="Phase">
                {PHASES.map((phase) => (
                  <button key={phase} className={state.phase === phase ? 'selected' : ''} onClick={() => act({ type: 'setPhase', phase })}>
                    {phase}
                  </button>
                ))}
              </div>
              <div className="row start">
                <button disabled={state.questionIndex <= 0} onClick={() => act({ type: 'setQuestion', index: state.questionIndex - 1 })} aria-label="Previous question">
                  ←
                </button>
                <select className="grow" value={state.questionIndex} onChange={(e) => act({ type: 'setQuestion', index: Number(e.target.value) })}>
                  {rounds.map((r) => (
                    <optgroup key={r.label} label={r.label}>
                      {r.items.map(({ question, index }) => (
                        <option key={question.id} value={index}>
                          {question.id} {question.text.slice(0, 70)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  disabled={state.questionIndex >= state.questions.length - 1}
                  onClick={() => act({ type: 'setQuestion', index: state.questionIndex + 1 })}
                  aria-label="Next question"
                >
                  →
                </button>
              </div>
              <p className="hint">
                Order: question (teams answer) → locked (answers closed) → reveal (teams that got it right pick an upgrade at once) →
                battle. Selecting a question opens it for answers.
              </p>
            </section>

            <BattleCard view={view} act={act} />

            {q && (
              <section className="card stack">
                <div className="row">
                  <span className="eyebrow">
                    {q.id} · {q.round}
                  </span>
                  <div className="row">
                    <span className="pill">
                      <strong>
                        {Object.keys(answers).length} / {state.teams.length}
                      </strong>{' '}
                      answered
                    </span>
                    <span className={state.revealed.includes(q.id) ? 'pill good' : 'pill'}>
                      {state.revealed.includes(q.id) ? 'Revealed' : 'Not revealed'}
                    </span>
                  </div>
                </div>
                <h2 className="question-text">{q.text}</h2>
                <ol className="answer-list">
                  {q.options.map((option, i) => (
                    <li key={i} className={i === q.answer ? 'correct' : ''}>
                      <span className="letter">{LETTERS[i]}</span>
                      <span>{option}</span>
                      <span className="who">{state.teams.filter((t) => answers[t.id] === i).map((t) => t.name).join(', ') || '–'}</span>
                    </li>
                  ))}
                </ol>
                <p className="hint">No answer: {state.teams.filter((t) => answers[t.id] === undefined).map((t) => t.name).join(', ') || '–'}</p>
              </section>
            )}

            <section className="card flush">
              <div className="card-head" style={{ padding: '16px 18px 0' }}>
                <h2>Teams</h2>
                <span className="muted num">{state.teams.length}</span>
              </div>
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
                {state.teams.length === 0 && <p className="muted" style={{ padding: '4px 18px 18px' }}>No teams yet.</p>}
              </div>
            </section>

            <section className="card flush">
              <div className="card-head" style={{ padding: '16px 18px 0', display: 'block' }}>
                <h2>All answers</h2>
                <p className="hint" style={{ marginTop: 4 }}>
                  Change any answer here. Picks are recalculated from the answers of revealed questions, so fixes apply at once.
                </p>
              </div>
              <div className="scroll" style={{ maxHeight: 640 }}>
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
                    {rounds.map((r) => (
                      <Fragment key={r.label}>
                        <tr className="round-row">
                          <td colSpan={state.teams.length + 3}>{r.label}</td>
                        </tr>
                        {r.items.map(({ question }) => (
                          <tr key={question.id}>
                            <td title={question.text}>
                              <span className="faint num">{question.id}</span> {question.options[question.answer]}
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
                              <button className="small ghost" onClick={() => confirm('Clear all answers for this question?') && act({ type: 'clearAnswers', questionId: question.id })}>
                                Clear
                              </button>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="stack">
            <section className="card stack">
              <h2>Message to teams</h2>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  act({ type: 'setMessage', text: new FormData(e.currentTarget).get('text') });
                }}
              >
                <input name="text" key={state.message} defaultValue={state.message} placeholder="Banner shown to all teams" />
                <div className="row start">
                  <button className="primary">Show</button>
                  <button type="button" className="ghost" onClick={() => act({ type: 'setMessage', text: '' })}>
                    Clear
                  </button>
                </div>
              </form>
            </section>

            <section className="card stack">
              <h2>Weapons</h2>
              <label className="check">
                <input type="checkbox" checked={state.weaponsLocked} onChange={(e) => act({ type: 'setWeaponsLocked', locked: e.target.checked })} /> Lock weapon
                choice in the lobby
              </label>
              <p className="hint">Teams can change weapons only in the lobby. You can change a team's weapon at any time in the table.</p>
            </section>

            <section className="card stack">
              <h2>Dev controls</h2>
              <button onClick={() => act({ type: 'reloadQuestions' })}>Reload quiz-questions.json</button>
              <div className="row">
                <button className="grow" onClick={() => navigator.clipboard.writeText(JSON.stringify(loadouts(view), null, 2))}>
                  Copy loadouts JSON
                </button>
                <a href="/api/loadouts" target="_blank">
                  /api/loadouts ↗
                </a>
              </div>
              <button onClick={() => confirm('Reset the quiz but keep teams? Answers and upgrades are removed.') && act({ type: 'reset', keepTeams: true })}>
                Reset (keep teams)
              </button>
              <button className="danger" onClick={() => confirm('Reset everything, including teams?') && act({ type: 'reset', keepTeams: false })}>
                Reset everything
              </button>
              <p className="hint">
                Catalog: {catalog.source === 'game' ? 'live from the game' : 'offline copy'} — {catalog.upgrades.length} upgrades
                {catalog.syncedAt ? ` (read ${new Date(catalog.syncedAt).toLocaleTimeString()})` : ''}
              </p>
              <button onClick={() => act({ type: 'refreshCatalog' })}>Refresh catalog from the game</button>
              <details>
                <summary>Upgrade ids ({catalog.upgrades.length})</summary>
                <pre>{catalog.upgrades.map((u) => u.id).join('\n')}</pre>
              </details>
              <details>
                <summary>Raw state</summary>
                <pre>{JSON.stringify(state, null, 2)}</pre>
              </details>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}

// The round-robin: start / stop it, see the table, and see what each match is
// doing. The quiz server queues matches on the game's match API and records the
// result the display page reports.
function BattleCard({ view, act }: { view: AdminView; act: (body: Record<string, unknown>) => void }) {
  const { state, game } = view;
  const battle = state.battle;
  const rows = standings(state.teams, battle?.matches ?? []);
  const teamName = (id: string) => state.teams.find((t) => t.id === id)?.name ?? '(deleted team)';
  const planned = state.teams.length >= 2 ? (state.teams.length * (state.teams.length - 1)) / 2 : 0;
  const running = !!battle && !battle.finishedAt;
  const displayUrl = game.url.replace(/\/api\/?$/, '/?display');

  return (
    <section className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>Battle</h2>
        <span className="muted num">
          {battle ? `${battle.matches.filter((m) => m.status === 'done').length} / ${battle.matches.length} played` : `${planned} matches`}
        </span>
      </div>
      <p className="hint">
        Every team fights every other team once; the best record wins. The game plays one match at a time on the display page. Open{' '}
        <code>{displayUrl}</code> and leave it visible.
      </p>
      <div className="row start">
        <span className={game.reachable ? 'pill good' : 'pill'}>{game.reachable ? 'Game API up' : 'Game API down'}</span>
        <span className={game.displays > 0 ? 'pill good' : 'pill'}>
          {game.displays} display{game.displays === 1 ? '' : 's'}
        </span>
        <span className="faint mono">{game.url}</span>
      </div>
      <div className="row start">
        {!battle && (
          <button className="primary" disabled={state.teams.length < 2} onClick={() => act({ type: 'battleStart' })}>
            Start battle
          </button>
        )}
        {running && (
          <button onClick={() => act({ type: 'battleStop' })}>Stop</button>
        )}
        {running && <button onClick={() => act({ type: 'battleResync' })}>Resync loadouts</button>}
        {battle && (
          <button className="danger" onClick={() => confirm('Reset the battle? Every result is lost.') && act({ type: 'battleReset' })}>
            Reset battle
          </button>
        )}
      </div>
      {battle?.note && <p className="hint">{battle.note}</p>}
      {battle?.finishedAt && <p className="hint">Battle finished. {rows[0]?.name} wins the round-robin.</p>}

      {battle && (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Played</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>HP +/−</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.teamId}>
                  <td className="num">{i + 1}</td>
                  <td>{row.name}</td>
                  <td className="num">{row.played}</td>
                  <td className="num">{row.wins}</td>
                  <td className="num">{row.draws}</td>
                  <td className="num">{row.losses}</td>
                  <td className="num">{row.hpFor - row.hpAgainst > 0 ? `+${row.hpFor - row.hpAgainst}` : row.hpFor - row.hpAgainst}</td>
                  <td className="num">
                    <strong>{row.points}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {battle && (
        <div className="scroll" style={{ maxHeight: 320 }}>
          <table>
            <thead>
              <tr>
                <th>Match</th>
                <th>Status</th>
                <th>Winner</th>
                <th>Time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {battle.matches.map((match) => {
                const open = match.status === 'pending' || match.status === 'queued' || match.status === 'playing';
                return (
                  <tr key={match.id}>
                    <td>
                      <span className="faint num">{match.id}</span> {teamName(match.a)} vs {teamName(match.b)}
                    </td>
                    <td className={match.status === 'failed' ? 'error' : ''}>
                      {match.status}
                      {match.error ? ` — ${match.error}` : ''}
                    </td>
                    <td>{match.status === 'done' ? (match.winner ? teamName(match.winner) : 'draw') : '–'}</td>
                    <td className="num">{match.time === null ? '–' : `${Math.round(match.time)}s`}</td>
                    <td>
                      {open && (
                        <button className="small ghost" onClick={() => act({ type: 'battleSkip', matchId: match.id })}>
                          Skip
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
        <div className="team-name">
          <span className={online ? 'online on' : 'online'} title={online ? 'Online' : 'Offline'} />
          <input
            key={team.name}
            defaultValue={team.name}
            size={12}
            onBlur={(e) => e.target.value !== team.name && update({ name: e.target.value })}
          />
        </div>
      </td>
      <td className="mono">{team.code}</td>
      <td>
        <select value={team.weapon} onChange={(e) => update({ weapon: e.target.value })}>
          {catalog.weapons.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </td>
      <td className={picks < 0 ? 'error num' : 'num'}>{picks}</td>
      <td>
        <span className="stepper">
          <button className="small" onClick={() => update({ bonusPicks: team.bonusPicks - 1 })} aria-label="Remove bonus pick">
            −
          </button>
          <span className="num">{team.bonusPicks}</span>
          <button className="small" onClick={() => update({ bonusPicks: team.bonusPicks + 1 })} aria-label="Add bonus pick">
            +
          </button>
        </span>
      </td>
      <td>
        {Object.entries(team.upgrades).map(([id, n]) => (
          <div key={id} className="upgrade-line">
            <span className="grow">
              {upgradeName(id)} <span className="muted">×{n}</span>
            </span>
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
      <td className="offer">
        <span className={team.offer ? '' : 'faint'}>{team.offer?.map(upgradeName).join(', ') ?? '–'}</span>{' '}
        {team.offer && (
          <button className="small ghost" onClick={() => act({ type: 'rerollOffer', teamId: team.id })}>
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
