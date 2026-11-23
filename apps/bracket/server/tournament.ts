// The app's way to the tournament service (tournament/ at the repo root, API in
// contracts/tournament.d.ts). The app never queues matches on the game itself:
// the service plays them there, and passes the game's catalog through. Each
// player goes to it as an entrant whose `character` is Weapon Balls' FighterInput.
import type { Catalog, FighterInput } from '../../../games/weapon-balls/api/game.d.ts';
import type { EntrantPatch, FormatInfo, TournamentRequest } from '../../../contracts/tournament.d.ts';
import type { BracketTournament } from '../shared/types.ts';

export interface TournamentService {
  catalog(): Promise<Catalog>;
  formats(): Promise<FormatInfo[]>;
  create(request: TournamentRequest<FighterInput>): Promise<BracketTournament>;
  patchEntrants(id: string, patches: EntrantPatch<FighterInput>[]): Promise<BracketTournament>;
  start(id: string): Promise<BracketTournament>;
  stop(id: string): Promise<BracketTournament>;
  /** Deletes it there (its matches come off the game). Already gone is fine. */
  remove(id: string): Promise<void>;
  /** Calls `onUpdate` with the tournament on every change there, and null if it is deleted. null stops following. */
  follow(id: string | null, onUpdate: (t: BracketTournament | null) => void): void;
}

const TIMEOUT_MS = 10_000; // a stage start asks the game to check every build first
const RECONNECT_MS = 2_000;

export class ServiceError extends Error {
  status: number; // 0: not reachable

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function httpService(api: string): TournamentService {
  async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${api}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ServiceError(0, `The tournament service is not answering at ${api}.`);
    }
    const data = (await res.json().catch(() => null)) as { error?: string; problems?: Record<string, string[]> } | null;
    if (!res.ok) throw new ServiceError(res.status, data?.error ?? `The tournament service answered ${res.status}`);
    return data as T;
  }

  let followed: string | null = null;
  let stream: AbortController | null = null;

  async function listen(id: string, onUpdate: (t: BracketTournament | null) => void) {
    while (followed === id) {
      const controller = new AbortController();
      stream = controller;
      try {
        const res = await fetch(`${api}/tournaments/${id}/events`, { signal: controller.signal });
        if (res.status === 404) {
          if (followed === id) onUpdate(null);
          return;
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        let buffer = '';
        for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const message = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = message.split('\n').find((line) => line.startsWith('data: '));
            if (!data || followed !== id) continue;
            const t = JSON.parse(data.slice(6)) as BracketTournament | null;
            onUpdate(t);
            if (!t) return;
          }
        }
      } catch {
        // Dropped, or stopped by follow(null).
      }
      if (followed === id) await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
    }
  }

  return {
    catalog: () => call<Catalog>('/host/catalog'),
    formats: () => call<FormatInfo[]>('/formats'),
    create: (request) => call<BracketTournament>('/tournaments', 'POST', request),
    patchEntrants: (id, patches) => call<BracketTournament>(`/tournaments/${id}/entrants`, 'PATCH', patches),
    start: (id) => call<BracketTournament>(`/tournaments/${id}/start`, 'POST'),
    stop: (id) => call<BracketTournament>(`/tournaments/${id}/stop`, 'POST'),
    async remove(id) {
      try {
        await call(`/tournaments/${id}`, 'DELETE');
      } catch (err) {
        if (!(err instanceof ServiceError && err.status === 404)) throw err;
      }
    },
    follow(id, onUpdate) {
      if (id === followed) return;
      followed = id;
      stream?.abort();
      stream = null;
      if (id) void listen(id, onUpdate);
    },
  };
}
