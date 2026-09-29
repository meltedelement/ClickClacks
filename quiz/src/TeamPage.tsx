import { useEffect, useState } from 'react';
import type { TeamView, WeaponInfo } from '../shared/types.ts';
import { post, useEvents } from './api.ts';
import { Brand, LETTERS, RoundProgress, Status, ThemeToggle, WeaponSwatch } from './ui.tsx';

const TOKEN_KEY = 'quiz-team-token';

export function TeamPage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const { data: view, connected } = useEvents<TeamView | null>(token ? `/api/events?token=${token}` : null);

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

function TopBar({ name, children }: { name?: string; children?: React.ReactNode }) {
  return (
    <header className="topbar narrow">
      <div className="topbar-inner">
        <Brand name={name} />
        <div className="row" style={{ gap: 8 }}>
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
  const [code, setCode] = useState('');
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { token } = await post('/api/join', { name, weapon, code });
      onJoin(token);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="stack">
          <h1 className="title">Join the quiz</h1>
          <p className="lead">Every correct answer earns your team an upgrade for the battle at the end.</p>
        </div>
        <form onSubmit={submit} className="card stack loose">
          <label className="field">
            <span>Team name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="off" autoFocus />
          </label>
          <WeaponPicker weapons={weapons} value={weapon} onChange={setWeapon} />
          <label className="field">
            <span>Team code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="Optional" />
            <small>Only to rejoin a team from another phone.</small>
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary large block" disabled={!name.trim()}>
            Join
          </button>
        </form>
      </main>
    </>
  );
}

function TeamScreen({ view, token, connected, onLeave }: { view: TeamView; token: string; connected: boolean; onLeave: () => void }) {
  const [error, setError] = useState('');
  // True while a POST is in flight, so a slow connection cannot send the same action twice.
  const [busy, setBusy] = useState(false);
  const { team } = view;
  const upgradeName = (id: string) => view.upgrades.find((u) => u.id === id)?.name ?? id;
  const weaponName = view.weapons.find((w) => w.id === team.weapon)?.name ?? team.weapon;
  const canChangeWeapon = view.phase === 'lobby' && !view.weaponsLocked;
  const upgrades = Object.entries(team.upgrades).filter(([, n]) => n > 0);

  async function act(path: string, body: unknown) {
    setError('');
    setBusy(true);
    try {
      await post(path, body, { 'x-team-token': token });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar name={team.name}>
        <div className="row">
          <span className="pill">
            Code <strong>{team.code}</strong>
          </span>
          <Status connected={connected} />
        </div>
      </TopBar>

      <main className="page">
        {view.message && <p className="banner">{view.message}</p>}
        {error && <p className="error">{error}</p>}

        {view.phase === 'lobby' && (
          <section className="card stack loose">
            <div className="stack">
              <h2>Waiting for the host</h2>
              <p className="muted">
                {canChangeWeapon ? 'You can change your weapon until the quiz starts.' : 'Weapons are locked. The quiz starts soon.'}
              </p>
            </div>
            {canChangeWeapon && <WeaponPicker weapons={view.weapons} value={team.weapon} disabled={busy} onChange={(id) => act('/api/weapon', { weapon: id })} />}
          </section>
        )}

        {view.question && (
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
                <p className="notice good">Correct. Pick an upgrade below.</p>
              ) : (
                <p className="notice bad">{view.myAnswer === null ? 'No answer this time.' : 'Not this time.'}</p>
              ))}
          </section>
        )}

        {team.picks > 0 && team.offer && (
          <section className="card stack">
            <div className="card-head" style={{ marginBottom: 0 }}>
              <h2>Pick an upgrade</h2>
              {team.picks > 1 && <span className="pill accent">{team.picks} to pick</span>}
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

        {view.phase === 'battle' && (
          <section className="card stack">
            <h2>Battle time</h2>
            {view.battle ? (
              <>
                <p className="muted">
                  {view.battle.opponent ? (
                    <>
                      You are fighting <strong>{view.battle.opponent}</strong>.
                    </>
                  ) : (
                    'Waiting for your next match.'
                  )}
                </p>
                <p className="muted">
                  Battle {view.battle.number} · place <strong>{view.battle.rank ?? '–'}</strong> · {view.battle.wins}W of{' '}
                  {view.battle.played} · {view.battle.points} points
                </p>
              </>
            ) : (
              <p className="muted">The battle has not started yet.</p>
            )}
            <p className="muted">Watch the arena on the big screen.</p>
          </section>
        )}

        <section className="card">
          <div className="card-head">
            <h2>Your loadout</h2>
          </div>
          <dl className="loadout">
            <dt>Weapon</dt>
            <dd className="row start">
              <WeaponSwatch id={team.weapon} /> {weaponName}
            </dd>
            <dt>Upgrades</dt>
            <dd>
              {upgrades.length === 0 ? (
                <span className="muted">None yet</span>
              ) : (
                <div className="chips">
                  {upgrades.map(([id, n]) => (
                    <span key={id} className="chip">
                      {upgradeName(id)}
                      {n > 1 && <span className="count">×{n}</span>}
                    </span>
                  ))}
                </div>
              )}
            </dd>
          </dl>
        </section>

        <button className="ghost leave" onClick={() => confirm('Leave this team on this device? You can rejoin with the team name and code.') && onLeave()}>
          Leave team
        </button>
      </main>
    </>
  );
}
