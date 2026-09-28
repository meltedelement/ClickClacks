import { useEffect, useState } from 'react';
import type { TeamView, WeaponInfo } from '../shared/types.ts';
import { post, useEvents } from './api.ts';

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
      <main>
        <p>Connecting…</p>
        <button onClick={logout}>Leave team</button>
      </main>
    );
  }
  return <TeamScreen view={view} token={token} connected={connected} onLeave={logout} />;
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
    <main>
      <h1>Join the quiz</h1>
      <form onSubmit={submit} className="stack">
        <label>
          Team name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoFocus />
        </label>
        <label>
          Weapon
          <select value={weapon} onChange={(e) => setWeapon(e.target.value)}>
            {weapons.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Team code (only to rejoin an existing team)
          <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
        </label>
        <button type="submit">Join</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}

function TeamScreen({ view, token, connected, onLeave }: { view: TeamView; token: string; connected: boolean; onLeave: () => void }) {
  const [error, setError] = useState('');
  const { team } = view;
  const upgradeName = (id: string) => view.upgrades.find((u) => u.id === id)?.name ?? id;

  async function act(path: string, body: unknown) {
    setError('');
    try {
      await post(path, body, { 'x-team-token': token });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main>
      <header className="row">
        <div>
          <strong>{team.name}</strong> · code {team.code}
        </div>
        <span className={connected ? 'ok' : 'error'}>{connected ? 'connected' : 'reconnecting…'}</span>
      </header>

      {view.message && <p className="banner">{view.message}</p>}
      {error && <p className="error">{error}</p>}

      <section>
        {view.phase === 'lobby' && !view.weaponsLocked ? (
          <label>
            Weapon{' '}
            <select value={team.weapon} onChange={(e) => act('/api/weapon', { weapon: e.target.value })}>
              {view.weapons.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>Weapon: {view.weapons.find((w) => w.id === team.weapon)?.name ?? team.weapon}</p>
        )}
      </section>

      {view.phase === 'lobby' && <p>Waiting for the host to start. You can change your weapon until the quiz starts.</p>}

      {view.question && (
        <section>
          <h2>
            Question {view.questionNumber} / {view.questionCount}
          </h2>
          <p className="hint">{view.question.round}</p>
          <p className="question">{view.question.text}</p>
          <div className="stack">
            {view.question.options.map((option, i) => {
              const classes = ['option'];
              if (view.myAnswer === i) classes.push('selected');
              if (view.correct === i) classes.push('correct');
              else if (view.correct !== null && view.myAnswer === i) classes.push('wrong');
              return (
                <button key={i} className={classes.join(' ')} disabled={view.phase !== 'question'} onClick={() => act('/api/answer', { choice: i })}>
                  {option}
                </button>
              );
            })}
          </div>
          {view.phase === 'question' && <p>{view.myAnswer === null ? 'Pick an answer.' : 'Answer saved. You can change it until the host closes answers.'}</p>}
          {view.phase === 'locked' && <p>Answers are closed.</p>}
          {view.correct !== null && <p>{view.myAnswer === view.correct ? 'Correct! Pick an upgrade below.' : 'Not this time.'}</p>}
        </section>
      )}

      {team.picks > 0 && team.offer && (
        <section>
          <h2>Pick an upgrade{team.picks > 1 && ` (${team.picks} to pick)`}</h2>
          <div className="stack">
            {team.offer.map((id) => {
              const upgrade = view.upgrades.find((u) => u.id === id);
              return (
                <button key={id} className="option" onClick={() => act('/api/pick', { upgradeId: id })}>
                  <strong>{upgrade?.name ?? id}</strong>
                  <br />
                  {upgrade?.description}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {view.phase === 'battle' && <p>Battle time! Watch the arena.</p>}

      <section>
        <h3>Your upgrades</h3>
        {Object.keys(team.upgrades).length === 0 ? (
          <p>None yet.</p>
        ) : (
          <ul>
            {Object.entries(team.upgrades).map(([id, n]) => (
              <li key={id}>
                {upgradeName(id)} ×{n}
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="small" onClick={() => confirm('Leave this team on this device? You can rejoin with the team name and code.') && onLeave()}>
        Leave team
      </button>
    </main>
  );
}
