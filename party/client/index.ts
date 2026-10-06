// Party: the browser side. No framework: React (or anything else) wraps
// `subscribe` in its own way. The quiz's src/api.ts is a React example.
//
//   const stop = subscribe<MyView>(eventsUrl({ token }), {
//     onData: (view) => render(view),         // null: this player was removed
//     onConnected: (live) => showLive(live),
//   });
//   await post('/api/answer', { choice: 2 }, { token });
//
// Phones are bad at keeping connections: a sleeping phone or bad Wi-Fi leaves
// a socket that looks open and carries nothing. `subscribe` watches for the
// server's heartbeat and opens a new connection when it stops, when the page
// becomes visible again, and when the network comes back.
import { ADMIN_HEADER, EVENTS_PATH, PLAYER_HEADER, SILENCE_MS } from '../shared/protocol.ts';
import type { Credentials } from '../shared/protocol.ts';

export type { Credentials } from '../shared/protocol.ts';

const POST_TIMEOUT_MS = 10_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 15_000;

/** The event stream for a player (`{ token }`) or the admin pages (`{ adminKey }`). */
export function eventsUrl(credentials: Credentials): string {
  return 'token' in credentials
    ? `${EVENTS_PATH}?token=${encodeURIComponent(credentials.token)}`
    : `${EVENTS_PATH}?key=${encodeURIComponent(credentials.adminKey)}`;
}

/**
 * POSTs JSON to one of the app's routes, as a player or the admin when
 * credentials are given. Throws an Error whose message can be shown as it is:
 * the server's, or one about the connection.
 */
export async function post<T = any>(path: string, body: unknown, credentials?: Credentials): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (credentials && 'token' in credentials) headers[PLAYER_HEADER] = credentials.token;
  if (credentials && 'adminKey' in credentials) headers[ADMIN_HEADER] = credentials.adminKey;
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(POST_TIMEOUT_MS) });
  } catch {
    throw new Error('No answer from the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface Subscription<T> {
  /** Every view the server sends. */
  onData(view: T): void;
  /** Whether the stream is open now. */
  onConnected?(connected: boolean): void;
}

/**
 * Follows an event stream until the returned function is called. EventSource
 * reconnects by itself after a network error, but gives up for good after a bad
 * response (a 502 while a dev server restarts, say), and can sit on a half-dead
 * socket. So this also watches for silence and opens a new connection itself.
 */
export function subscribe<T>(url: string, { onData, onConnected = () => {} }: Subscription<T>): () => void {
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
    source = new EventSource(url);
    source.onopen = () => {
      onConnected(true);
      retryDelay = RETRY_MIN_MS;
      alive();
    };
    source.onmessage = (e) => {
      alive();
      onData(JSON.parse(e.data) as T);
    };
    source.addEventListener('ping', alive);
    source.onerror = () => {
      onConnected(false);
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
    onConnected(false);
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
}
