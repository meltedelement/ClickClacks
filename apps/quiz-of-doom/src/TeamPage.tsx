import { useEffect, useState } from 'react';
import type { TeamView, WeaponInfo } from '../shared/types.ts';
import { eventsUrl, post, useEvents } from './api.ts';
import { TEAM_COLORS, colorName } from '../shared/colors.ts';
import { Brand, ColorPicker, LETTERS, RoundProgress, Status, TeamDot, ThemeToggle, WeaponSwatch } from './ui.tsx';

const TOKEN_KEY = 'quiz-team-token';
// How often the join form asks which colours other teams took.
const COLORS_POLL_MS = 3_000;

export function TeamPage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const { data: view, connected } = useEvents<TeamView | null>(token ? eventsUrl({ token }) : null);

  // The server sends null when the host deletes this team.
  useEffect(() => {
    if (view === null) logout();
  }, [view]);

  function login(newToken: string) {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
  }
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }

  if (!token) return <JoinForm onJoin={login} />;
  if (!view) {
    return (
      <>
        <TopBar>
          <Status connected={connected} />
        </TopBar>
        <main className="page">
          <p className="muted">Connecting…</p>
          <button className="ghost" onClick={logout}>
            Leave team
          </button>
        </main>
      </>
    );
  }
  return <TeamScreen view={view} token={token} connected={connected} onLeave={logout} />;
}

function TopBar({ name, color, children }: { name?: string; color?: string; children?: React.ReactNode }) {
  return (
    <header className="topbar narrow">
      <div className="topbar-inner">
        <Brand name={name} color={color} />
        <div className="row" style={{ gap: '0.5rem' }}>
          {children}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function WeaponPicker({ weapons, value, onChange, disabled }: { weapons: WeaponInfo[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="label">Weapon</legend>
      <div className="tiles">
        {weapons.map((w) => (
          <label key={w.id} className="tile">
            <input type="radio" name="weapon" value={w.id} checked={value === w.id} onChange={() => onChange(w.id)} />
            <WeaponSwatch id={w.id} />
            {w.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function JoinForm({ onJoin }: { onJoin: (token: string) => void }) {
  const [weapons, setWeapons] = useState<WeaponInfo[]>([]);
  const [name, setName] = useState('');
  const [weapon, setWeapon] = useState('');
  const [color, setColor] = useState('');
  const [taken, setTaken] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [rejoin, setRejoin] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/weapons')
      .then((r) => r.json())
      .then((list: WeaponInfo[]) => {
        setWeapons(list);
        setWeapon(list[0]?.id ?? '');
      })
      .catch(() => setError('Cannot reach the server'));
  }, []);

  // Other teams join while this form is open, so keep the taken colours up to date.
  async function loadTaken() {
    try {
      const res = await fetch('/api/colors');
      setTaken(((await res.json()) as { taken: string[] }).taken);
    } catch {
      // Tried again on the next poll. The server checks the colour on join anyway.
    }
  }
  useEffect(() => {
    if (rejoin) return;
    loadTaken();
    const timer = setInterval(loadTaken, COLORS_POLL_MS);
    return () => clearInterval(timer);
  }, [rejoin]);

  // Start on the first free colour, and move off a colour another team just took.
  useEffect(() => {
    if (!color || taken.includes(color)) setColor(TEAM_COLORS.find((c) => !taken.includes(c.hex))?.hex ?? '');
  }, [taken, color]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { token } = await post('/api/join', rejoin ? { code } : { name, weapon, color });
      onJoin(token);
    } catch (err) {
      setError((err as Error).message);
      if (!rejoin) loadTaken();
    }
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="stack">
          <h1 className="title">Join the Quiz of Doom</h1>
          <p className="lead">Every correct answer earns your team an upgrade. Between rounds, your ball fights in the arena.</p>
        </div>
        {rejoin ? (
          <form onSubmit={submit} className="card stack loose">
            <label className="field">
              <span>Team code</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="off" autoFocus />
              <small>Shown on your team's other phone, or ask the host.</small>
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary large block" disabled={!code.trim()}>
              Rejoin
            </button>
            <button type="button" className="ghost" onClick={() => { setRejoin(false); setError(''); }}>
              Make a new team instead
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="card stack loose">
            <label className="field">
              <span>Team name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="off" autoFocus />
            </label>
            <ColorPicker value={color} taken={taken} onChange={setColor} />
            <WeaponPicker weapons={weapons} value={weapon} onChange={setWeapon} />
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary large block" disabled={!name.trim() || !color}>
              Join
            </button>
            <button type="button" className="ghost" onClick={() => { setRejoin(true); setError(''); }}>
              Rejoin with a team code
            </button>
          </form>
        )}
      </main>
    </>
  );
}

// After the lobby the phone has two tabs: the quiz, and the upgrades with the
// loadout. Picks wait for the team, so it can read and pick on the Upgrades tab
// while the questions go on. Neither tab opens by itself: the tab bar shows
// what is waiting on the other one.
type TeamTab = 'quiz' | 'upgrades';

function TeamScreen({ view, token, connected, onLeave }: { view: TeamView; token: string; connected: boolean; onLeave: () => void }) {
  const [error, setError] = useState('');
  // True while a POST is in flight, so a slow connection cannot send the same action twice.
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TeamTab>('quiz');
  const { team } = view;
  const canChangeWeapon = view.phase === 'lobby' && !view.weaponsLocked;
  const tabs = view.phase !== 'lobby';
  const upgradePicks = team.offer?.length ? team.picks : 0;
  const transformPicks = team.transformOffer.length > 0 ? team.transformPicks : 0;
  const toPick = upgradePicks + transformPicks;
  const unanswered = view.phase === 'question' && view.question !== null && view.correct === null && view.myAnswer === null;

  async function act(path: string, body: unknown) {
    setError('');
    setBusy(true);
    try {
      await post(path, body, { token });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function show(next: TeamTab) {
    setTab(next);
    window.scrollTo({ top: 0 });
  }

  return (
    <>
      <TopBar name={team.name} color={team.color}>
        <div className="row">
          <span className="pill">
            Code <strong>{team.code}</strong>
          </span>
          <Status connected={connected} />
        </div>
      </TopBar>

      <main className={tabs ? 'page with-tabs' : 'page'}>
        {view.message && <p className="banner">{view.message}</p>}
        {error && <p className="error">{error}</p>}

        {view.phase === 'lobby' && (
          <>
            <section className="card stack loose">
              <div className="stack">
                <h2>Waiting for the host</h2>
                <p className="muted">
                  {canChangeWeapon ? 'You can change your colour and weapon until the quiz starts.' : 'Colours and weapons are locked. The quiz starts soon.'}
                </p>
              </div>
              {canChangeWeapon && (
                <>
                  <ColorPicker value={team.color} taken={view.takenColors} disabled={busy} onChange={(hex) => act('/api/color', { color: hex })} />
                  <WeaponPicker weapons={view.weapons} value={team.weapon} disabled={busy} onChange={(id) => act('/api/weapon', { weapon: id })} />
                </>
              )}
            </section>
            <Loadout view={view} />
          </>
        )}

        {tabs && tab === 'quiz' && (
          <>
            <QuestionSection view={view} busy={busy} act={act} />
            {toPick > 0 && (
              <button className="upgrade waiting" onClick={() => show('upgrades')}>
                <strong>{waitingText(upgradePicks, transformPicks)}</strong>
                <span>Open the Upgrades tab when you have a moment. Picks wait for you, also during the next questions.</span>
              </button>
            )}
            {view.phase === 'battle' && (
              <section className="card stack">
                <h2>Battle time</h2>
                {view.battle ? <BattleStatus battle={view.battle} /> : <p className="muted">The bracket is not drawn yet.</p>}
                <p className="muted">Watch the arena on the big screen.</p>
              </section>
            )}
          </>
        )}

        {tabs && tab === 'upgrades' && (
          <>
            {unanswered && (
              <div className="notice attention">
                <span>
                  Question {view.round ? view.round.position : view.questionNumber} is open and you have not answered yet.
                </span>
                <button className="primary small" onClick={() => show('quiz')}>
                  Answer
                </button>
              </div>
            )}

            {transformPicks > 0 && (
              <section className="card stack">
                <div className="card-head" style={{ marginBottom: 0 }}>
                  <h2>Pick a transformation</h2>
                  {transformPicks > 1 && <span className="pill accent">{transformPicks} to pick</span>}
                </div>
                <p className="muted">
                  A transformation reshapes your weapon for the rest of the battle.{' '}
                  {view.phase === 'battle' ? 'Pick one before the next stage starts.' : view.nextBattle ? `Pick one before the battle after round ${view.nextBattle.round}.` : ''}
                </p>
                {team.transformOffer.map((id) => (
                  <button key={id} className="upgrade" disabled={busy} onClick={() => act('/api/transform', { transformationId: id, count: team.transformations.length })}>
                    <strong>{transformationOf(view, id)?.name ?? id}</strong>
                    <span>{transformationOf(view, id)?.description}</span>
                  </button>
                ))}
              </section>
            )}

            {upgradePicks > 0 && team.offer && (
              <section className="card stack">
                <div className="card-head" style={{ marginBottom: 0 }}>
                  <h2>Pick an upgrade</h2>
                  {upgradePicks > 1 && <span className="pill accent">{upgradePicks} to pick</span>}
                </div>
                {team.offer.map((id) => {
                  const upgrade = view.upgrades.find((u) => u.id === id);
                  return (
                    <button key={id} className="upgrade" disabled={busy} onClick={() => act('/api/pick', { upgradeId: id, picksUsed: team.picksUsed })}>
                      <strong>{upgrade?.name ?? id}</strong>
                      <span>{upgrade?.description}</span>
                    </button>
                  );
                })}
              </section>
            )}

            {toPick === 0 && (
              <section className="card stack">
                <h2>Nothing to pick</h2>
                <p className="muted">Every correct answer earns an upgrade. It waits here until you pick it, so you can take your time.</p>
              </section>
            )}
            {toPick > 0 && view.nextBattle && view.phase !== 'battle' && (
              <p className="hint">Upgrades and transformations you pick before the battle after round {view.nextBattle.round} fight in it.</p>
            )}

            <Loadout view={view} />
          </>
        )}

        {(!tabs || tab === 'upgrades') && (
          <button className="ghost leave" onClick={() => confirm('Leave this team on this device? You can rejoin with the team name and code.') && onLeave()}>
            Leave team
          </button>
        )}
      </main>

      {tabs && (
        <nav className="team-tabs" aria-label="Sections">
          <button className={tab === 'quiz' ? 'selected' : ''} aria-current={tab === 'quiz' ? 'page' : undefined} onClick={() => show('quiz')}>
            Quiz
            {unanswered && tab !== 'quiz' && <span className="badge warn" aria-label="Question open" />}
          </button>
          <button className={tab === 'upgrades' ? 'selected' : ''} aria-current={tab === 'upgrades' ? 'page' : undefined} onClick={() => show('upgrades')}>
            Upgrades
            {toPick > 0 && <span className="badge num">{toPick}</span>}
          </button>
        </nav>
      )}
    </>
  );
}

// "1 upgrade and 1 transformation to pick"
function waitingText(upgrades: number, transformations: number): string {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [upgrades > 0 && count(upgrades, 'upgrade'), transformations > 0 && count(transformations, 'transformation')].filter(Boolean);
  return `${parts.join(' and ')} to pick`;
}

function transformationOf(view: TeamView, id: string) {
  return view.transformations.find((t) => t.id === id);
}

function QuestionSection({ view, busy, act }: { view: TeamView; busy: boolean; act: (path: string, body: unknown) => void }) {
  if (!view.question) return null;
  return (
    <section className="stack loose">
      {view.round ? (
        <div className="stack">
          <div className="row">
            <span className="eyebrow">
              Round {view.round.index + 1} of {view.round.count}
            </span>
            <span className="muted num">
              Question {view.round.position} of {view.round.size}
            </span>
          </div>
          <RoundProgress sizes={view.round.sizes} round={view.round.index} position={view.round.position} />
          <h2 className="round-name">{view.round.name}</h2>
        </div>
      ) : (
        <span className="eyebrow">{view.question.round}</span>
      )}
      <p className="question-text">{view.question.text}</p>
      <div className="stack">
        {view.question.options.map((option, i) => {
          const classes = ['option'];
          let mark = '';
          if (view.correct === i) {
            classes.push('correct');
            mark = 'Correct';
          } else if (view.correct !== null && view.myAnswer === i) {
            classes.push('wrong');
            mark = 'Your answer';
          } else if (view.correct === null && view.myAnswer === i) classes.push('selected');
          else if (view.correct !== null) classes.push('dim');
          return (
            <button key={i} className={classes.join(' ')} disabled={busy || view.phase !== 'question' || view.correct !== null} onClick={() => act('/api/answer', { choice: i })}>
              <span className="letter">{LETTERS[i]}</span>
              <span className="text">{option}</span>
              {mark && <span className="mark">{mark}</span>}
            </button>
          );
        })}
      </div>
      {view.phase === 'question' && (
        <p className="notice">{view.myAnswer === null ? 'Pick an answer.' : 'Answer saved. You can change it until the host closes answers.'}</p>
      )}
      {view.phase === 'locked' && <p className="notice">Answers are closed. Wait for the reveal.</p>}
      {view.correct !== null &&
        (view.myAnswer === view.correct ? (
          <p className="notice good">Correct. You earned an upgrade.</p>
        ) : (
          <p className="notice bad">{view.myAnswer === null ? 'No answer this time.' : 'Not this time.'}</p>
        ))}
    </section>
  );
}

function Loadout({ view }: { view: TeamView }) {
  const { team } = view;
  const upgradeName = (id: string) => view.upgrades.find((u) => u.id === id)?.name ?? id;
  const weaponName = view.weapons.find((w) => w.id === team.weapon)?.name ?? team.weapon;
  const upgrades = Object.entries(team.upgrades).filter(([, n]) => n > 0);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Your loadout</h2>
      </div>
      <dl className="loadout">
        <dt>Colour</dt>
        <dd className="row start">
          <TeamDot color={team.color} /> {team.color ? colorName(team.color) : 'None'}
        </dd>
        <dt>Weapon</dt>
        <dd className="row start">
          <WeaponSwatch id={team.weapon} /> {weaponName}
        </dd>
        {team.transformations.length > 0 && (
          <>
            <dt>Transformations</dt>
            <dd>
              <div className="chips">
                {team.transformations.map((id, i) => (
                  <span key={`${id}-${i}`} className="chip" title={transformationOf(view, id)?.description}>
                    {transformationOf(view, id)?.name ?? id}
                  </span>
                ))}
              </div>
            </dd>
          </>
        )}
        <dt>Upgrades</dt>
        <dd>
          {upgrades.length === 0 ? (
            <span className="muted">None yet</span>
          ) : (
            <div className="chips">
              {upgrades.map(([id, n]) => (
                <span key={id} className="chip" title={view.upgrades.find((u) => u.id === id)?.description}>
                  {upgradeName(id)}
                  {n > 1 && <span className="count">×{n}</span>}
                </span>
              ))}
            </div>
          )}
        </dd>
      </dl>
    </section>
  );
}

function BattleStatus({ battle }: { battle: NonNullable<TeamView['battle']> }) {
  const { format, round, bracket, side, wins, losses, state, opponent, champion } = battle;
  const vs = opponent && <strong>{opponent}</strong>;
  const where = bracket ? `${round}, ${bracket}` : round;
  let lives = '';
  if (format === 'double-elimination' && side !== 'final') lives = losses === 0 ? ' You have not lost yet.' : ' One more loss and you are out.';
  else if (format === 'single-elimination') lives = ' One loss and you are out.';
  else if (format === 'round-robin') lives = ` You have ${wins} win${wins === 1 ? '' : 's'} from ${wins + losses} match${wins + losses === 1 ? '' : 'es'}.`;
  switch (state) {
    case 'champion':
      return <p className="notice good">You won the battle!</p>;
    case 'out':
      return format === 'round-robin' && champion ? (
        <p className="notice">
          The battle is over: {champion} won it.{lives}
        </p>
      ) : (
        <p className="notice bad">You are out.{champion && <> {champion} won the battle.</>}</p>
      );
    case 'lost':
      return (
        <p className="notice bad">
          You lost against {vs}. Wait for the next stage.{lives}
        </p>
      );
    case 'bye':
      return <p className="notice good">{where}: you have no match this stage.{lives}</p>;
    case 'through':
      return (
        <p className="notice good">
          You won against {vs}. Wait for the next stage.{format === 'round-robin' ? lives : ''}
        </p>
      );
    case 'dropped':
      return (
        <p className="notice bad">
          You lost against {vs}. {side === 'final' ? 'You get one more match: the grand final reset.' : 'You go to the losers bracket and fight again when the winners bracket of this stage is finished. One more loss and you are out.'}
        </p>
      );
    case 'fighting':
      return <p className="notice">{where}: you are fighting {vs} now.</p>;
    case 'next':
      return (
        <p className="notice">
          {where}: your match is drawn when the winners bracket of this stage is finished.{lives}
        </p>
      );
    case 'waiting':
      return (
        <p className="notice">
          {where}: you fight {vs} next.{lives} The host starts the stage.
        </p>
      );
  }
}
