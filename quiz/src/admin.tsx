// Admin connection shared by the admin page and the big screen.
import { useState } from 'react';
import type { AdminView } from '../shared/types.ts';
import { post, useEvents } from './api.ts';
import { Brand, ThemeToggle } from './ui.tsx';

const KEY_STORAGE = 'quiz-admin-key';

export function useAdmin() {
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

  return { key, saveKey, view, connected, act, error };
}

export function AdminLogin({ title, admin }: { title: string; admin: ReturnType<typeof useAdmin> }) {
  const { key, saveKey, connected } = admin;
  return (
    <main className="center">
      <form
        className="card stack loose"
        onSubmit={(e) => {
          e.preventDefault();
          saveKey((new FormData(e.currentTarget).get('key') as string).trim());
        }}
      >
        <div className="stack">
          <div className="row">
            <Brand />
            <ThemeToggle />
          </div>
          <h1 className="title">{title}</h1>
          <p className={key && !connected ? 'error' : 'muted'}>
            {connected ? 'Loading…' : key ? 'Wrong admin key, or the server is not running.' : 'Enter the admin key to continue.'}
          </p>
        </div>
        <label className="field">
          <span>Admin key</span>
          <input name="key" type="password" defaultValue={key} autoFocus />
          <small>The server prints the admin key when it starts.</small>
        </label>
        <button className="primary large block">Connect</button>
      </form>
    </main>
  );
}
