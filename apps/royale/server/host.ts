// The app's way to the game: the Match Host API, over HTTP. Weapon Balls' own
// types say what goes in the opaque parts (a character is a fighter, and so on).
import type { Catalog, Match, MatchRequest } from '../../../games/weapon-balls/api/game.d.ts';

export interface GameHost {
  catalog(): Promise<Catalog>;
  queue(request: MatchRequest): Promise<Match>;
  /** Waits for the match to be done or cancelled. */
  wait(id: string): Promise<Match>;
  cancel(id: string): Promise<void>;
}

const RETRY_MS = 2_000;

export function httpHost(api: string): GameHost {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${api}${path}`, init);
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new HostError(res.status, body.error ?? `The game answered ${res.status}`);
    return body as T;
  }

  return {
    catalog: () => call<Catalog>('/catalog'),
    queue: (request) => call<Match>('/matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }),
    async wait(id) {
      // The request is held open until the match ends, which Node's fetch gives
      // up on after a few minutes. Asking again is safe, so keep asking.
      for (;;) {
        try {
          return await call<Match>(`/matches/${id}?wait=1`);
        } catch (err) {
          if (err instanceof HostError) throw err; // the game answered: it won't get better
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
      }
    },
    async cancel(id) {
      await call(`/matches/${id}`, { method: 'DELETE' });
    },
  };
}

class HostError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
