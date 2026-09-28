import { useEffect, useState } from 'react';

const POST_TIMEOUT_MS = 10_000;

export async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch {
    throw new Error('No answer from the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

// The server sends a ping event every 15 s (see server/index.ts). If nothing
// arrives for this long, the connection is dead even if the browser has not noticed.
const SILENCE_MS = 35_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 15_000;

// Subscribes to live state from the server. `undefined` = not received yet.
// EventSource reconnects by itself after a network error, but it gives up for
// good after a bad response (for example a 502 while the dev server restarts),
// and it can sit on a half-dead socket after bad Wi-Fi or a phone sleep. So we
// also watch for silence and open a new connection ourselves.
export function useEvents<T>(url: string | null) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setData(undefined);
    setConnected(false);
    if (!url) return;

    let source: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = RETRY_MIN_MS;
    let lastSeen = Date.now();

    function alive() {
      lastSeen = Date.now();
      clearTimeout(watchdog);
      watchdog = setTimeout(reconnect, SILENCE_MS);
    }

    function connect() {
      source = new EventSource(url!);
      source.onopen = () => {
        setConnected(true);
        retryDelay = RETRY_MIN_MS;
        alive();
      };
      source.onmessage = (e) => {
        alive();
        setData(JSON.parse(e.data));
      };
      source.addEventListener('ping', alive);
      source.onerror = () => {
        setConnected(false);
        if (source?.readyState === EventSource.CLOSED) {
          clearTimeout(retry);
          retry = setTimeout(reconnect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        }
      };
      alive();
    }

    function reconnect() {
      source?.close();
      clearTimeout(retry);
      setConnected(false);
      connect();
    }

    // A phone that wakes up or gets its network back often holds a dead socket.
    function onWake() {
      if (document.visibilityState === 'visible' && Date.now() - lastSeen > SILENCE_MS / 2) reconnect();
    }

    connect();
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      source?.close();
      clearTimeout(watchdog);
      clearTimeout(retry);
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [url]);

  return { data, connected };
}
