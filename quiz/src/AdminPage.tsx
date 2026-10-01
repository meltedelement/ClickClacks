// The host's page. The control bar at the top moves the quiz on (Next, with
// Space, Enter, → or Page Down for a clicker) and says what the big screen
// shows. Below it, tabs: Live (what is happening now), Teams, Answers, Battle
// and Settings (manual control, data and resets).
import { Fragment, useEffect, useState } from 'react';
import type { AdminView, FormatId, Phase, Team } from '../shared/types.ts';
import { PHASES } from '../shared/types.ts';
import { fitLoadout, fitsWeapon } from '../shared/loadout.ts';
import { currentStage, isSent } from '../shared/tournament.ts';
import { groupRounds, roundPosition, stagesAllowed } from '../shared/rounds.ts';
import { Bracket, Standings } from './Bracket.tsx';
import { AdminLogin, useAdmin } from './admin.tsx';
import { backStep, idleReason, nextStep, screenLabel, type Step } from './flow.ts';
import { Brand, LETTERS, Status, TeamDot, ThemeToggle, WeaponSwatch, battleViewUrl, useJoinAddress } from './ui.tsx';
import { TEAM_COLORS } from '../shared/colors.ts';

type Act = (body: Record<string, unknown>) => void;

const PHASE_NAMES: Record<Phase, string> = { lobby: 'Lobby', question: 'Question: answers open', locked: 'Locked: answers closed', reveal: 'Reveal', battle: 'Battle break' };

const TABS = ['live', 'teams', 'answers', 'battle', 'settings'] as const;
type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = { live: 'Live', teams: 'Teams', answers: 'Answers', battle: 'Battle', settings: 'Settings' };

export function AdminPage() {
  const admin = useAdmin();
  const { view, connected, act, error } = admin;
  const [tab, setTab] = useHashTab();
  useNextKey(view ? nextStep(view) : null, act);

  if (!view) return <AdminLogin title="Quiz admin" admin={admin} />;
  const { state } = view;

  return (
    <>
      <header className="admin-head">
        <div className="admin-head-inner">
          <div className="row">
            <Brand name="Quiz admin" />
            <div className="row">
              <a className="button" href="/screen" target="_blank">
                Open big screen ↗
              </a>
              <Status connected={connected} />
              <ThemeToggle />
            </div>
          </div>
          <ControlBar view={view} act={act} />
          <nav className="tabs" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t} className={tab === t ? 'selected' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
                {TAB_NAMES[t]}
                {t === 'teams' && <span className="count num">{state.teams.length}</span>}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="page wide">
        {error && <p className="notice bad">{error}</p>}
        {tab === 'live' && <LiveTab view={view} act={act} />}
        {tab === 'teams' && <TeamsTab view={view} act={act} />}
        {tab === 'answers' && <AnswersTab view={view} act={act} />}
        {tab === 'battle' && <BattlePanel view={view} act={act} />}
        {tab === 'settings' && <SettingsTab view={view} act={act} />}
      </main>
    </>
  );
}

// The tab lives in the address (#teams), so a reload keeps it.
function useHashTab(): [Tab, (tab: Tab) => void] {
  const read = () => {
    const hash = location.hash.slice(1);
    return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : 'live';
  };
  const [tab, setTab] = useState<Tab>(read);
  useEffect(() => {
    const onHash = () => setTab(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [
    tab,
    (next) => {
      history.replaceState(null, '', next === 'live' ? location.pathname : `#${next}`);
      setTab(next);
    },
  ];
}

// Space, Enter, the right arrow or Page Down does the next step (a presentation
// clicker sends one of these). Space and Enter already press a focused button,
// so skip them there. Nothing happens while typing in a field.
function useNextKey(step: Step | null, act: Act) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!step || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea, summary')) return;
      if ((e.key === ' ' || e.key === 'Enter') && target.closest('button, a')) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        act(step.action);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}

function ControlBar({ view, act }: { view: AdminView; act: Act }) {
  const { state, game } = view;
  const next = nextStep(view);
  const back = backStep(view);
  const round = roundPosition(state.questions, state.questionIndex);
  const intro = state.intro !== null ? roundPosition(state.questions, state.intro) : null;
  const q = state.questions[state.questionIndex];
  const answered = q ? Object.keys(state.answers[q.id] ?? {}).length : 0;

  let where: string;
  let title: string;
  if (intro) {
    where = `Round ${intro.index + 1} of ${intro.count}`;
    title = intro.name;
  } else if (state.phase === 'lobby') {
    where = 'Lobby';
    title = `${state.teams.length} team${state.teams.length === 1 ? '' : 's'} joined`;
  } else if (state.phase === 'battle') {
    const r = view.tournament && currentStage(view.tournament);
    where = 'Battle break';
    title = view.tournament?.champion ? 'The battle is over' : r ? `${r.name} · ${r.status === 'playing' ? 'playing' : r.status === 'waiting' ? 'ready to start' : 'done'}` : 'Bracket not drawn';
  } else {
    where = round ? `Round ${round.index + 1} of ${round.count} · Question ${round.position} of ${round.size}` : '';
    title = q?.text ?? '';
  }

  // Warn before a step that needs the arena when none is connected.
  const needsArena = next && (next.action.type === 'battleStartRound' || (next.action.type === 'setPhase' && next.action.phase === 'battle'));
  const arenaMissing = needsArena && (!game.reachable || game.displays === 0);

  return (
    <div className="control-bar">
      <div className="control-now">
        <p className="eyebrow">{where}</p>
        <p className="control-title" title={title}>
          {title}
        </p>
        <p className="control-meta">
          <span>
            Big screen: <strong>{screenLabel(view)}</strong>
          </span>
          {state.phase === 'question' && !intro && (
            <span className="num">
              · {answered} of {state.teams.length} answered
            </span>
          )}
          {arenaMissing && (
            <span className="warn-text">
              · {!game.tournamentReachable ? 'the tournament server is not answering' : !game.reachable ? 'the game server is not answering' : 'no arena connected: open the big screen'}
            </span>
          )}
        </p>
      </div>
      <div className="control-buttons">
        <button className="ghost" disabled={!back} onClick={() => back && act(back.action)}>
          ← {back?.label ?? 'Back'}
        </button>
        {next ? (
          <button className="primary large" onClick={() => act(next.action)}>
            {next.label} →
          </button>
        ) : (
          <button className="primary large" disabled>
            {idleReason(view)}
          </button>
        )}
        <span className="hint nowrap">
          <kbd>Space</kbd> <kbd>→</kbd>
        </span>
      </div>
    </div>
  );
}

// ---- Live -------------------------------------------------------------------

function LiveTab({ view, act }: { view: AdminView; act: Act }) {
  const { state } = view;
  let main;
  if (state.phase === 'battle') main = <BattlePanel view={view} act={act} />;
  else if (state.intro !== null) main = <RoundIntroCard view={view} />;
  else if (state.phase === 'lobby') main = <LobbyCard view={view} act={act} />;
  else main = <QuestionCard view={view} />;

  return (
    <div className="admin-grid">
      <div className="stack">{main}</div>
      <TeamStatusCard view={view} />
    </div>
  );
}

function LobbyCard({ view, act }: { view: AdminView; act: Act }) {
  const address = useJoinAddress();
  const { state } = view;
  return (
    <section className="card stack loose">
      <div className="stack">
        <h2>Lobby</h2>
        <p className="muted">
          Teams join at <strong className="mono">{address}</strong>. The big screen shows the address and the teams as they join.
        </p>
      </div>
      <label className="check">
        <input type="checkbox" checked={state.weaponsLocked} onChange={(e) => act({ type: 'setWeaponsLocked', locked: e.target.checked })} /> Lock colours and weapons now
      </label>
      <p className="hint">Teams can change their colour and weapon only in the lobby. You can change them for a team at any time on the Teams tab.</p>
    </section>
  );
}

function RoundIntroCard({ view }: { view: AdminView }) {
  const { state } = view;
  const round = roundPosition(state.questions, state.intro!);
  const first = state.questions[state.intro!];
  if (!round) return null;
  return (
    <section className="card stack">
      <p className="eyebrow">
        Round {round.index + 1} of {round.count} · {round.size === 1 ? '1 question' : `${round.size} questions`}
      </p>
      <h2 className="question-text">{round.name}</h2>
      <p className="muted">The big screen shows the round title. The phones do not change. Next opens the first question:</p>
      {first && <p className="notice">{first.text}</p>}
    </section>
  );
}

function QuestionCard({ view }: { view: AdminView }) {
  const { state } = view;
  const q = state.questions[state.questionIndex];
  if (!q) return <p className="muted">No questions. Check quiz-questions.json and reload it on the Settings tab.</p>;
  const answers = state.answers[q.id] ?? {};
  const revealed = state.revealed.includes(q.id);
  const missing = state.teams.filter((t) => answers[t.id] === undefined);

  return (
    <section className="card stack">
      <div className="row">
        <span className="eyebrow">
          {q.id} · {roundPosition(state.questions, state.questionIndex)?.name ?? q.round}
        </span>
        <div className="row">
          <span className="pill">
            <strong>
              {Object.keys(answers).length} / {state.teams.length}
            </strong>{' '}
            answered
          </span>
          <span className={revealed ? 'pill good' : 'pill'}>{revealed ? 'Revealed' : 'Not revealed'}</span>
        </div>
      </div>
      <h2 className="question-text">{q.text}</h2>
      <ol className="answer-list">
        {q.options.map((option, i) => (
          <li key={i} className={i === q.answer ? 'correct' : ''}>
            <span className="letter">{LETTERS[i]}</span>
            <span>{option}</span>
            <span className="who">
              {state.teams
                .filter((t) => answers[t.id] === i)
                .map((t) => t.name)
                .join(', ') || '–'}
            </span>
          </li>
        ))}
      </ol>
      {missing.length > 0 && <p className="hint">No answer yet: {missing.map((t) => t.name).join(', ')}</p>}
    </section>
  );
}

// Who is online and who still has something to pick, at a glance.
function TeamStatusCard({ view }: { view: AdminView }) {
  const { state, online, picks, transformPicks } = view;
  const offline = state.teams.filter((t) => !online.includes(t.id)).length;
  return (
    <section className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>Teams</h2>
        <span className="muted num">{offline > 0 ? `${offline} offline` : state.teams.length ? 'all online' : ''}</span>
      </div>
      {state.teams.length === 0 ? (
        <p className="muted">No teams yet.</p>
      ) : (
        <ul className="team-status">
          {state.teams.map((t) => (
            <li key={t.id}>
              <span className={online.includes(t.id) ? 'online on' : 'online'} title={online.includes(t.id) ? 'Online' : 'Offline'} />
              <TeamDot color={t.color} />
              <span className="grow name">{t.name}</span>
              {(transformPicks[t.id] ?? 0) > 0 && <span className="pill warn">transformation</span>}
              {picks[t.id] > 0 && (
                <span className="pill accent">
                  {picks[t.id]} pick{picks[t.id] === 1 ? '' : 's'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Teams ------------------------------------------------------------------

function TeamsTab({ view, act }: { view: AdminView; act: Act }) {
  const { state, catalog } = view;
  const [open, setOpen] = useState<string | null>(null);
  const weaponName = (id: string) => catalog.weapons.find((w) => w.id === id)?.name ?? id;
  const upgradeName = (id: string) => catalog.upgrades.find((u) => u.id === id)?.name ?? id;
  const transformationName = (id: string) => catalog.transformations.find((u) => u.id === id)?.name ?? id;

  if (state.teams.length === 0) return <p className="muted">No teams yet.</p>;

  return (
    <section className="card flush">
      <div className="scroll">
        <table className="teams-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Code</th>
              <th>Weapon</th>
              <th>Picks left</th>
              <th>Upgrades</th>
              <th>Transformations</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {state.teams.map((team) => {
              const isOpen = open === team.id;
              const online = view.online.includes(team.id);
              const picks = view.picks[team.id];
              const upgrades = Object.entries(team.upgrades);
              return (
                <Fragment key={team.id}>
                  <tr className={isOpen ? 'open' : ''}>
                    <td>
                      <span className="team-name">
                        <span className={online ? 'online on' : 'online'} title={online ? 'Online' : 'Offline'} />
                        <TeamDot color={team.color} />
                        <strong>{team.name}</strong>
                      </span>
                    </td>
                    <td className="mono">{team.code}</td>
                    <td>
                      <span className="row start" style={{ gap: '0.5rem' }}>
                        <WeaponSwatch id={team.weapon} />
                        {weaponName(team.weapon)}
                      </span>
                    </td>
                    <td className={picks < 0 ? 'error num' : 'num'}>
                      {picks}
                      {(view.transformPicks[team.id] ?? 0) > 0 && <span className="hint"> + {view.transformPicks[team.id]} transformation</span>}
                    </td>
                    <td className="summary">{upgrades.length ? upgrades.map(([id, n]) => `${upgradeName(id)}${n > 1 ? ` ×${n}` : ''}`).join(', ') : <span className="faint">–</span>}</td>
                    <td className="summary">{team.transformations.length ? team.transformations.map(transformationName).join(', ') : <span className="faint">–</span>}</td>
                    <td>
                      <button className="small" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : team.id)}>
                        {isOpen ? 'Done' : 'Edit'}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="editor-row">
                      <td colSpan={7}>
                        <TeamEditor team={team} view={view} act={act} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TeamEditor({ team, view, act }: { team: Team; view: AdminView; act: Act }) {
  const { catalog } = view;
  const update = (patch: Partial<Team>) => act({ type: 'updateTeam', teamId: team.id, patch });
  const setUpgrade = (id: string, n: number) => update({ upgrades: { ...team.upgrades, [id]: n } });
  const upgradeName = (id: string) => catalog.upgrades.find((u) => u.id === id)?.name ?? id;
  const transformationName = (id: string) => catalog.transformations.find((u) => u.id === id)?.name ?? id;
  const fits = catalog.transformations.filter((t) => fitsWeapon(t, team.weapon) && !team.transformations.includes(t.id));
  const atLimit = (id: string) => (team.upgrades[id] ?? 0) >= (catalog.upgrades.find((u) => u.id === id)?.maxStacks ?? Infinity);
  // The host may add any upgrade that fits the weapon, even one the phones would not offer.
  const addable = catalog.upgrades.filter((u) => fitsWeapon(u, team.weapon) && !atLimit(u.id));
  // The game's own check, through the tournament service. Only known once the bracket is drawn.
  const problems = view.tournament?.entrants.find((e) => e.id === team.entrantId)?.problems ?? [];
  // The server drops upgrades and transformations that do not fit the new weapon.
  const changeWeapon = (weapon: string) => {
    const fitted = fitLoadout({ ...team, weapon }, catalog);
    const lost = [
      ...Object.keys(team.upgrades).filter((id) => team.upgrades[id] > 0 && !(id in fitted.upgrades)).map(upgradeName),
      ...team.transformations.filter((id) => !fitted.transformations.includes(id)).map(transformationName),
    ];
    const weaponName = catalog.weapons.find((w) => w.id === weapon)?.name ?? weapon;
    if (lost.length > 0 && !confirm(`${weaponName} removes ${[...new Set(lost)].join(', ')} from ${team.name}. Change the weapon?`)) return;
    update({ weapon });
  };

  return (
    <div className="team-editor">
      <div className="stack">
        <label className="field">
          <span>Name</span>
          <input key={team.name} defaultValue={team.name} maxLength={30} onBlur={(e) => e.target.value !== team.name && update({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Colour</span>
          <select value={team.color} onChange={(e) => update({ color: e.target.value })}>
            {!team.color && <option value="">None</option>}
            {TEAM_COLORS.map((c) => {
              const owner = view.state.teams.find((t) => t !== team && t.color === c.hex);
              return (
                <option key={c.hex} value={c.hex} disabled={Boolean(owner)}>
                  {owner ? `${c.name} (${owner.name})` : c.name}
                </option>
              );
            })}
          </select>
        </label>
        <label className="field">
          <span>Weapon</span>
          <select value={team.weapon} onChange={(e) => changeWeapon(e.target.value)}>
            {catalog.weapons.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Bonus picks</span>
          <span className="stepper">
            <button className="small" onClick={() => update({ bonusPicks: team.bonusPicks - 1 })} aria-label="Remove bonus pick">
              −
            </button>
            <span className="num">{team.bonusPicks}</span>
            <button className="small" onClick={() => update({ bonusPicks: team.bonusPicks + 1 })} aria-label="Add bonus pick">
              +
            </button>
          </span>
        </div>
      </div>

      <div className="stack">
        <span className="label">Upgrades</span>
        {Object.entries(team.upgrades).map(([id, n]) => (
          <div key={id} className="upgrade-line">
            <span className="grow">
              {upgradeName(id)} <span className="muted">×{n}</span>
            </span>
            <button className="small" onClick={() => setUpgrade(id, n - 1)} aria-label={`Remove one ${upgradeName(id)}`}>
              −
            </button>
            <button className="small" onClick={() => setUpgrade(id, n + 1)} disabled={atLimit(id)} aria-label={`Add one ${upgradeName(id)}`}>
              +
            </button>
          </div>
        ))}
        <select value="" onChange={(e) => e.target.value && setUpgrade(e.target.value, (team.upgrades[e.target.value] ?? 0) + 1)}>
          <option value="">Add an upgrade…</option>
          {addable.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <p className="hint">
          Offer: {team.offer?.map(upgradeName).join(', ') ?? 'none'}{' '}
          {team.offer && (
            <button className="small ghost" onClick={() => act({ type: 'rerollOffer', teamId: team.id })}>
              Reroll
            </button>
          )}
        </p>
      </div>

      <div className="stack">
        <span className="label">Transformations</span>
        {team.transformations.map((id, i) => (
          <div key={`${id}${i}`} className="upgrade-line">
            <span className="grow">{transformationName(id)}</span>
            <button
              className="small"
              onClick={() => update({ transformations: team.transformations.filter((_, j) => j !== i) })}
              aria-label={`Remove ${transformationName(id)}`}
            >
              −
            </button>
          </div>
        ))}
        {fits.length > 0 && (
          <select value="" onChange={(e) => e.target.value && update({ transformations: [...team.transformations, e.target.value] })}>
            <option value="">Add a transformation…</option>
            {fits.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {problems.length > 0 && <p className="error">The game would refuse this loadout: {problems.join('; ')}</p>}
        <div className="grow" />
        <button className="small danger" style={{ alignSelf: 'flex-start' }} onClick={() => confirm(`Delete team ${team.name}?`) && act({ type: 'deleteTeam', teamId: team.id })}>
          Delete team
        </button>
      </div>
    </div>
  );
}

// ---- Answers ----------------------------------------------------------------

function AnswersTab({ view, act }: { view: AdminView; act: Act }) {
  const { state } = view;
  const rounds = groupRounds(state.questions);
  return (
    <section className="card flush">
      <p className="hint" style={{ padding: '1rem 1.125rem 0' }}>
        Change any answer here. Picks are counted from the answers of revealed questions, so a fix applies at once.
      </p>
      <div className="scroll" style={{ maxHeight: '70vh' }}>
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
                {r.items.map(({ question, index }) => (
                  <tr key={question.id} className={index === state.questionIndex ? 'current' : ''}>
                    <td title={question.text}>
                      <span className="faint num">{question.id}</span> {question.options[question.answer]}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={state.revealed.includes(question.id)}
                        onChange={(e) => act({ type: 'setRevealed', questionId: question.id, revealed: e.target.checked })}
                        aria-label={`Question ${question.id} revealed`}
                      />
                    </td>
                    {state.teams.map((t) => {
                      const choice = state.answers[question.id]?.[t.id];
                      return (
                        <td key={t.id} className={choice === undefined ? '' : choice === question.answer ? 'correct' : 'wrong'}>
                          <select
                            value={choice ?? ''}
                            onChange={(e) => act({ type: 'setAnswer', questionId: question.id, teamId: t.id, choice: e.target.value === '' ? null : Number(e.target.value) })}
                          >
                            <option value="">–</option>
                            {question.options.map((option, i) => (
                              <option key={i} value={i}>
                                {LETTERS[i]} · {option}
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
  );
}

// ---- Battle -----------------------------------------------------------------

const FORMAT_HELP: Record<FormatId, string> = {
  'double-elimination':
    'Double elimination from a seeded random draw. A first loss drops a team to the losers bracket, and a second loss puts it out. An odd team out gets a bye. The last team of each bracket meet in the grand final, with a reset if the losers bracket team wins.',
  'single-elimination': 'Single elimination from a seeded random draw. One loss and the team is out. An odd team out gets a bye and plays first in the next stage.',
  'round-robin': 'Every team meets every other team once. Each stage is one round; a win is a point, and the top of the table wins.',
};

// The battle: draw it, start and stop each stage, and fix a match the game
// could not finish. The tournament service sends the matches to the game; the
// arena on the big screen plays them and reports the result.
function BattlePanel({ view, act }: { view: AdminView; act: Act }) {
  const { state, game } = view;
  const battle = view.tournament;
  const round = battle && currentStage(battle);
  const entrant = (id: string) => battle?.entrants.find((e) => e.id === id);
  const teamName = (id: string) => state.teams.find((t) => t.entrantId === id)?.name ?? entrant(id)?.name ?? '(deleted team)';
  const teamColor = (id: string) => state.teams.find((t) => t.entrantId === id)?.color ?? entrant(id)?.color ?? '';
  const allowed = stagesAllowed(state.questions, state.questionIndex);
  const picking = state.teams.filter((t) => (view.transformPicks[t.id] ?? 0) > 0);
  const [format, setFormat] = useState<FormatId>('double-elimination');

  return (
    <section className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>Battle</h2>
        <span className="muted num">
          {battle
            ? `${view.formats.find((f) => f.id === battle.format)?.name ?? battle.format} · ${battle.matches.filter((m) => m.status === 'done').length} / ${battle.matches.length} played · seed ${battle.seed}`
            : `${state.teams.length} teams`}
        </span>
      </div>

      <div className="row wrap">
        <span className={game.tournamentReachable ? 'pill good' : 'pill warn'}>{game.tournamentReachable ? 'Tournament server up' : 'Tournament server down'}</span>
        <span className={game.reachable ? 'pill good' : 'pill warn'}>{game.reachable ? 'Game server up' : 'Game server down'}</span>
        <span className={game.displays > 0 ? 'pill good' : 'pill warn'}>
          {game.displays === 0 ? 'No arena connected' : game.displays === 1 ? '1 arena connected' : `${game.displays} arenas connected`}
        </span>
        {game.displayUrl && (
          <a className="small-link" href={battleViewUrl(game.displayUrl)} target="_blank" rel="noopener">
            Arena alone ↗
          </a>
        )}
      </div>
      {!game.tournamentReachable && <p className="notice bad">The tournament server is not answering at {game.tournamentUrl}.</p>}
      {game.tournamentReachable && !game.reachable && <p className="notice bad">The game server is not answering the tournament server{game.url ? ` at ${game.url}` : ''}.</p>}
      {game.reachable && game.displays === 0 && <p className="notice bad">Matches play only while an arena is open. Open the big screen and leave it visible.</p>}

      {!battle && (
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            const seed = String(new FormData(e.currentTarget).get('seed') ?? '').trim();
            act({ type: 'battleCreate', format, ...(seed ? { seed: Number(seed) } : {}) });
          }}
        >
          <select value={format} onChange={(e) => setFormat(e.target.value as FormatId)} aria-label="Format">
            {(view.formats.length ? view.formats : [{ id: 'double-elimination' as const, name: 'Double elimination' }]).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <input name="seed" inputMode="numeric" placeholder="Seed (optional)" size={16} />
          <button className="primary" disabled={state.teams.length < 2 || !game.tournamentReachable}>
            Draw the bracket
          </button>
          <span className="hint">Starting the first battle break draws it too (as a double elimination).</span>
        </form>
      )}

      {battle && (
        <div className="row wrap">
          {round && !battle.champion && round.status === 'waiting' && (
            <button className={round.index < allowed ? 'primary' : ''} onClick={() => act({ type: 'battleStartRound' })}>
              Start {round.name.toLowerCase()}
            </button>
          )}
          {round?.status === 'playing' && <button onClick={() => act({ type: 'battleStopRound' })}>Stop {round.name.toLowerCase()}</button>}
          <button className="danger" onClick={() => confirm('Reset the battle? The bracket and every result are lost.') && act({ type: 'battleReset' })}>
            Reset battle
          </button>
        </div>
      )}
      {battle && round && !battle.champion && round.status === 'waiting' && round.index >= allowed && (
        <p className="hint">The quiz is not at the battle break for {round.name.toLowerCase()} yet. You can still start it here.</p>
      )}
      {battle && round?.status === 'waiting' && picking.length > 0 && <p className="hint">Still picking a transformation: {picking.map((t) => t.name).join(', ')}</p>}
      {battle?.note && <p className="notice">{battle.note}</p>}
      {battle?.restart && (
        <p className="notice bad">
          The game server restarted at {new Date(battle.restart.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} and lost its matches.{' '}
          {battle.restart.matches.join(', ')} went back on the game and {battle.restart.matches.length === 1 ? 'starts' : 'start'} again with the same fights. In dev
          mode a change to a game file restarts the game server: use <code>npm run start:all</code> for the event.
        </p>
      )}
      {battle?.champion && <p className="notice good">{teamName(battle.champion)} wins the battle.</p>}

      {battle?.format === 'round-robin' && <Standings battle={battle} teamName={teamName} teamColor={teamColor} />}

      {battle && (
        <div className="scroll">
          <Bracket
            battle={battle}
            teamName={teamName}
            teamColor={teamColor}
            screensKnown={game.reachable && game.displays > 0}
            actions={(match) => {
              const roundOpen = battle.stages[match.stage]?.status !== 'done';
              const isFinal = match.stage === battle.stages.length - 1;
              if (isSent(match)) return null;
              if (match.status === 'done' && !(isFinal && battle.champion) && !roundOpen) return null;
              const [a, b] = match.entrants;
              return (
                <>
                  {match.status !== 'done' && roundOpen && (
                    <>
                      <button className="small ghost" onClick={() => act({ type: 'battleSetWinner', matchId: match.id, winner: a })}>
                        {teamName(a)} wins
                      </button>
                      <button className="small ghost" onClick={() => act({ type: 'battleSetWinner', matchId: match.id, winner: b })}>
                        {teamName(b)} wins
                      </button>
                    </>
                  )}
                  {(match.status === 'cancelled' || match.status === 'failed' || match.status === 'done') && (
                    <button
                      className="small ghost"
                      onClick={() => (match.status !== 'done' || confirm('Play this match again? Its result is removed.')) && act({ type: 'battleReplay', matchId: match.id })}
                    >
                      Replay
                    </button>
                  )}
                </>
              );
            }}
          />
        </div>
      )}

      <details>
        <summary>How the battle works</summary>
        <p className="hint" style={{ marginTop: '0.5rem' }}>
          {FORMAT_HELP[battle?.format ?? format]} At the time limit the team with more HP left wins. Each battle break plays one stage, and the break after the last
          round plays the rest. The tournament server runs the battle and sends each match to the game.
        </p>
      </details>
    </section>
  );
}

// ---- Settings ---------------------------------------------------------------

function SettingsTab({ view, act }: { view: AdminView; act: Act }) {
  const { state, catalog } = view;
  const rounds = groupRounds(state.questions);

  return (
    <div className="settings-grid">
      <section className="card stack">
        <h2>Message to everyone</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            act({ type: 'setMessage', text: new FormData(e.currentTarget).get('text') });
          }}
        >
          <input name="text" key={state.message} defaultValue={state.message} placeholder="Shown on the phones and the big screen" />
          <div className="row start">
            <button className="primary">Show</button>
            <button type="button" className="ghost" disabled={!state.message} onClick={() => act({ type: 'setMessage', text: '' })}>
              Clear
            </button>
          </div>
        </form>
      </section>

      <section className="card stack">
        <h2>Lobby</h2>
        <label className="check">
          <input type="checkbox" checked={state.weaponsLocked} onChange={(e) => act({ type: 'setWeaponsLocked', locked: e.target.checked })} /> Lock colours and weapons
        </label>
        <p className="hint">Teams can change them only in the lobby. You can change them for a team at any time on the Teams tab.</p>
      </section>

      <section className="card stack">
        <h2>Jump</h2>
        <p className="hint">Set the phase or open a question directly. Opening a question opens it for answers, unless it was revealed already.</p>
        <label className="field">
          <span>Phase</span>
          <select value={state.phase} onChange={(e) => act({ type: 'setPhase', phase: e.target.value })}>
            {PHASES.map((phase) => (
              <option key={phase} value={phase}>
                {PHASE_NAMES[phase]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Question</span>
          <select value={state.questionIndex} onChange={(e) => act({ type: 'setQuestion', index: Number(e.target.value) })}>
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
        </label>
      </section>

      <section className="card stack">
        <h2>Questions and catalog</h2>
        <button onClick={() => act({ type: 'reloadQuestions' })}>Reload quiz-questions.json</button>
        <button onClick={() => act({ type: 'refreshCatalog' })}>Refresh the catalog from the game</button>
        <p className="hint">
          Catalog: {catalog.source === 'game' ? 'live from the game' : 'offline copy'}, {catalog.upgrades.length} upgrades, {catalog.transformations.length} transformations
          {catalog.syncedAt ? ` (read ${new Date(catalog.syncedAt).toLocaleTimeString()})` : ''}.
        </p>
      </section>

      <section className="card stack">
        <h2>Data</h2>
        <div className="row start">
          <button onClick={() => navigator.clipboard.writeText(JSON.stringify(loadouts(view), null, 2))}>Copy loadouts JSON</button>
          <a href="/api/loadouts" target="_blank">
            /api/loadouts ↗
          </a>
        </div>
        <details>
          <summary>Upgrade ids ({catalog.upgrades.length})</summary>
          <pre>{catalog.upgrades.map((u) => u.id).join('\n')}</pre>
        </details>
        <details>
          <summary>Transformation ids ({catalog.transformations.length})</summary>
          <pre>{catalog.transformations.map((u) => u.id).join('\n')}</pre>
        </details>
        <details>
          <summary>Raw state</summary>
          <pre>{JSON.stringify(state, null, 2)}</pre>
        </details>
      </section>

      <section className="card stack danger-zone">
        <h2>Reset</h2>
        <div className="stack">
          <button className="danger" onClick={() => confirm(FULL_RESET_CONFIRM) && act({ type: 'reset', keepTeams: false })}>
            Full reset
          </button>
          <p className="hint">
            Deletes all the data: every team (the phones go back to the join page), answers, upgrades, transformations, the bracket and its results, and the
            message. The questions are read again from quiz-questions.json. The admin key stays.
          </p>
        </div>
        <div className="stack">
          <button onClick={() => confirm('Start over with the same teams? Their answers, upgrades, transformations and the bracket are deleted.') && act({ type: 'reset', keepTeams: true })}>
            Start over, keep the teams
          </button>
          <p className="hint">The same, but the teams stay joined with their names, colours and weapons.</p>
        </div>
      </section>
    </div>
  );
}

const FULL_RESET_CONFIRM =
  'Full reset: delete every team, answer, upgrade and the whole bracket? The phones go back to the join page. This cannot be undone.';

function loadouts({ state }: AdminView) {
  return state.teams.map((t) => ({ team: t.name, color: t.color, weapon: t.weapon, upgrades: t.upgrades, transformations: t.transformations }));
}
