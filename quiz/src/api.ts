import { useEffect, useState } from 'react';

export async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

// Subscribes to live state from the server. `undefined` = not received yet.
// EventSource reconnects by itself if the server restarts.
export function useEvents<T>(url: string | null) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setData(undefined);
    if (!url) return;
    const source = new EventSource(url);
    source.onopen = () => setConnected(true);
    source.onmessage = (e) => setData(JSON.parse(e.data));
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [url]);

  return { data, connected };
}
