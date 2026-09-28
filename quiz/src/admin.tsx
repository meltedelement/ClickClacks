// Admin connection shared by the admin page and the presenter page.
import { useState } from 'react';
import type { AdminView } from '../shared/types.ts';
import { post, useEvents } from './api.ts';

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
    <main>
      <h1>{title}</h1>
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
