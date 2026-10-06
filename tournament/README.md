# Tournament service

Runs tournaments on any game. A caller (the quiz, a script, another app) sends
the entrants, each with the character the game gets for it, and starts each
stage. The service sends every match to the game through the game's Match Host
API, waits for the game's official result, draws the next stage and reports it
all back as JSON.

```
Caller ──Tournament API──▶ tournament service ──Match Host API──▶ game (Weapon Balls, or any other)
```

The caller never talks to the game, and the game knows nothing about
tournaments. **The service knows nothing about the game either:** an entrant's
`character` (whatever the game plays with: for Weapon Balls, a fighter) and
the tournament's match `settings` are the game's own formats.
The service stores them, asks the game whether they are fine
(`POST /validate`), and sends them as they are. It passes the game's catalog
and status through, so callers only need this API. Any game that implements
[`contracts/match-host.d.ts`](../contracts/match-host.d.ts) can be played;
Weapon Balls (`games/weapon-balls/`) is the one in this repo. Plain Node with
no dependencies. State is kept in `data/tournaments.json`, so a restart carries
on where it stopped.

```sh
npm start                   # http://127.0.0.1:3003/api, game at HOST_API
npm run dev                 # the same, restarting on file changes
npm test                    # the formats' unit tests
npm run typecheck           # borrows the quiz's TypeScript: npm install in apps/quiz-of-doom first
HOST_API=http://127.0.0.1:5173/api PORT=3003 HOST=0.0.0.0 npm start
```

| Variable | Default | |
| --- | --- | --- |
| `HOST_API` | `http://127.0.0.1:3002/api` | The game's Match Host API. Weapon Balls serves it on 3002 with `npm start` in `games/weapon-balls/`, and on 5173 with `npm run dev` there. |
| `PORT` | `3003` | |
| `HOST` | `127.0.0.1` | Nothing here checks who asks, so by default only programs on this machine can reach it. |

From the repo root, `npm run dev:all` and `npm run start:all` start the game,
this service and the quiz together.

To try it with Weapon Balls but without a browser, `node tools/headless-display.js`
in `games/weapon-balls/` connects to the game as a display page and plays every
match with the real sim.

## Formats

| Id | |
| --- | --- |
| `double-elimination` | Out after two losses. A stage plays one winners bracket round, then one losers bracket round, which is drawn when the winners round is done (it needs the entrants that just dropped). The two bracket winners meet in the grand final, with a reset if the losers bracket side wins it. |
| `single-elimination` | Out after one loss. Each stage is one knockout round. |
| `round-robin` | Everyone meets everyone, `options.legs` times (1 or 2; the second leg swaps sides). Each stage is one round of the schedule. A win is a point; ties are broken on wins against the entrants on the same points, then on score margin (the game's optional `scores`: HP left for Weapon Balls). |

The first draw is a seeded shuffle of the entrants. In every format, an odd
entrant out gets a bye, and a bye goes first in the next stage, so nobody gets
two in a row. Every match is sent as `decisive`, so the game breaks ties its
own way (Weapon Balls on HP) and names a winner. The same seed and entrants
give the same draw and the same fights.

To add a format, implement `Format` (`formats/Format.ts`) in a new file under
`formats/` and add it to `FORMATS` in `formats/index.ts`. The store and runner
only use that interface. `formats/common.ts` has the shared pieces: pairing a
group, match seeds, standings for knockouts, and `plan`.

## API

Everything is JSON under `/api`. Types for every shape are in
[`contracts/tournament.d.ts`](../contracts/tournament.d.ts) at the repo root
(it imports `contracts/match-host.d.ts`): copy both into the caller. They take
the game's character and result types as parameters, e.g.
`Tournament<FighterInput, MatchResult>` with Weapon Balls' types from
`games/weapon-balls/api/game.d.ts`. CORS is open. Every error is
`{ "error": "message" }`, plus `problems` (entrant id → the game's reasons)
when a character is the reason.

| Route | |
| --- | --- |
| `GET /api/formats` | `FormatInfo[]`: each format's id, name, description and options. |
| `GET /api/formats/:id/plan?entrants=8` | `PlannedGroup[][]`: the stages a tournament of that size has, by shape. Add `&legs=2` for a double round robin. |
| `POST /api/tournaments` | Draw a tournament (`TournamentRequest`). **201** with the `Tournament`. |
| `GET /api/tournaments` | Every tournament. |
| `GET /api/tournaments/:id` | One. `?wait=<version>` holds the request until its `version` is higher (a long poll), or 404 if it is deleted. |
| `GET /api/tournaments/:id/events` | Server-sent events: the whole `Tournament` on connecting and after every change; `null` if it is deleted. A `: ping` comment every 20 s. |
| `PATCH /api/tournaments/:id/entrants` | Change entrants: a list of `{ id, name?, color?, character? }`. The game checks the new characters; a refused one keeps its `problems`, and a stage it is in can't start until it is fixed. |
| `POST /api/tournaments/:id/start` | Start the current stage. Its matches get the entrants' characters as they are now, and go to the game. 400 with `problems` if the game refuses a character in the stage. |
| `POST /api/tournaments/:id/stop` | Take the current stage off the game. Its unfinished matches wait until it is started again, with the same seeds. |
| `POST /api/tournaments/:id/matches/:matchId/replay` | Play a match of the current stage again: `{ seed? }` (random if left out). The grand final can be replayed after it is done, which removes the champion. |
| `POST /api/tournaments/:id/matches/:matchId/winner` | Decide a match yourself: `{ winner: entrantId }`, e.g. for one the game could not play. `decidedBy` becomes `'manual'`. |
| `DELETE /api/tournaments/:id` | Delete it. Its unfinished matches come off the game. |
| `GET /api/host` | `HostLink`: the game's API and display page, whether it answers, and the display pages connected. |
| `GET /api/host/catalog` | The game's catalog, passed through as the game gives it (for Weapon Balls: weapons, upgrades and transformations). The last good copy if the game is down; 502 if there never was one. |

Every call that changes a tournament answers with the whole `Tournament`.
Replaying or deciding a winners bracket match again takes back the losers
bracket draw of its stage. That is refused (409) once a losers match of the
stage has started or has a result; stop the stage first.

### Example

```ts
import type { Tournament, TournamentRequest } from './tournament'; // copy of contracts/tournament.d.ts
import type { FighterInput } from './game'; // copy of games/weapon-balls/api/game.d.ts

const API = 'http://127.0.0.1:3003/api';
const post = async (path: string, body?: unknown): Promise<Tournament> => {
  const res = await fetch(`${API}${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
};

// Each character is whatever the game takes: here, a Weapon Balls fighter (FighterInput).
const request: TournamentRequest<FighterInput> = {
  format: 'round-robin',
  entrants: [
    { id: 'alpha', name: 'Alpha', color: '#e5484d', character: { name: 'Alpha', color: '#e5484d', weapon: 'sword', upgrades: { damage: 2 } } },
    { id: 'beta', name: 'Beta', character: { name: 'Beta', weapon: 'mace', transformations: ['devil'] } },
    { id: 'gamma', name: 'Gamma', character: { name: 'Gamma', weapon: 'spear' } },
  ],
  match: { timeLimit: 120 }, // the game's settings for every match
  autoStart: true, // play every stage as soon as it is drawn
};
let t = await post('/tournaments', request);

// Follow it until there is a champion (or use GET /tournaments/:id/events).
while (t.status !== 'done') t = await (await fetch(`${API}/tournaments/${t.id}?wait=${t.version}`)).json();
console.log(t.champion, t.standings);
```

### The `Tournament` object

| Field | |
| --- | --- |
| `id`, `name`, `format`, `options`, `seed`, `autoStart`, `match` | As requested, with defaults filled in. `match` holds the game's settings for every match (`{}` for the game's defaults). |
| `version` | Goes up on every change. |
| `status` | `'waiting'` (the current stage has not started), `'playing'`, or `'done'` (there is a champion). |
| `entrants` | `Entrant[]`: `{ id, name, color, character }` as sent, plus `problems` (the game's reasons to refuse the character) and `progress` (where it is now: `state`, `opponent`, `side`, `bracket`, `wins`, `losses`). `name` and `color` are for people; the game gets only `character`. |
| `stages` | The stages drawn so far; the last is the current one. Each has `groups`: `{ side, name, entrants, bye, pending? }`, entrants in pairing order. A `pending` group waits for results earlier in the same stage. |
| `matches` | `TournamentMatch[]`: `{ id, stage, side, entrants: [a, b], seed, status, hostMatchId, screen, characters, winner, decidedBy, result, error? }`. `result` is the game's result as it sent it (Weapon Balls adds `time` and `hp`); `decidedBy` is its `reason`, or `'manual'`. `status` goes `pending` → `queued` (sent to the game) → `playing` (on screen `screen`) → `done`, or ends as `cancelled`/`failed` with an `error`, waiting for a replay or a winner. |
| `plan` | Every stage the tournament will have, by shape, for showing stages that are not drawn yet. |
| `standings` | `{ entrant, rank, wins, losses, points }[]`, best first. Entrants that can't be told apart share a rank. |
| `champion` | The winner's entrant id, once there is one. |
| `note` | What the service is waiting for (a display page, the game server...), for the people running it. |
| `restart` | Set when the game server forgot matches (it restarted) and they were sent again with the same seeds. Cleared when a stage starts. |

## How matches reach the game

When a stage starts, its matches go to the game in order (match 1 goes on
screen 1). Each is queued with `decisive: true`, its seed, the tournament's
`match` settings as `settings`, and `ref: "<tournament id>/<match id>"`. Then
the runner waits on the game's `GET /matches/:id?wait=1` for the result. A
draw (from a game that can't break ties) is left `cancelled` for the caller to
replay or decide.

- The game plays only while a display page is connected. Until one is, matches
  are not sent, and `note` says so.
- If the game server restarts it forgets its matches (404). They are sent again
  with the same seeds, which gives the same fights, and `restart` says so.
- If this service restarts, it carries on: a match already sent is picked up on
  the game, found by its `ref` if it was sent but not saved yet.
- A character the game refuses fails just that match (`failed`, with the game's
  error). Fix the entrant, then replay the match or decide it. Settings the
  game refuses are a 400 when the tournament is created.
