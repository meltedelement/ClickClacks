# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The repo is a set of separate modules, each in its own folder with its own `package.json`, README and (for the game) CLAUDE.md. README.md at the root has the overview. Read a module's README before changing it.

| Folder | Module |
| --- | --- |
| `games/weapon-balls/` | The game (vanilla JS + Canvas, Vite). Its own CLAUDE.md covers the sim, weapons, upgrades and the match API. |
| `tournament/` | Framework: tournament service, plain Node + TypeScript, no dependencies. Plays matches on any Match Host. |
| `party/` | Framework: Jackbox-style server + browser library (rooms of phones, admin page, big screen), no dependencies. |
| `apps/quiz-of-doom/` | The quiz: React + Vite client, Node server. Built on party, drives the tournament service, knows Weapon Balls. |
| `contracts/` | `match-host.d.ts` and `tournament.d.ts`: the API contracts, types only, imported by relative path. |

## Commands

```sh
npm run install:all     # npm install in games/weapon-balls and apps/quiz-of-doom (the others have no dependencies)
npm run dev:all         # game + tournament service + quiz together, each pointed at the next (tools/run-all.js)
npm run start:all       # the same, built
npm test                # tournament formats, party server, quiz rules (node --test)
npm run typecheck       # tournament, party, quiz (all borrow the quiz's tsc: install it first)
```

Game commands (`npm run dev`, `npm run balance`, ...) run from `games/weapon-balls/`; see its CLAUDE.md.

## Boundaries

These are the point of the split; keep them.

- **The frameworks know no game.** Nothing in `tournament/` or `party/` may mention weapons, fighters, loadouts, HP, quizzes or teams, or import from `games/` or `apps/`. A game-specific need goes through the contract as opaque data (an entrant's `character`, `settings`, the catalog) or as a generic, optional field (`HostResult.scores`, which the round robin uses for margins).
- **Games know nothing about tournaments or parties.** Weapon Balls is driven only through its match API, which implements `contracts/match-host.d.ts`.
- **Only apps join modules.** The quiz may import the party libraries, the contracts and the game's API types (`games/weapon-balls/api/game.d.ts`), and its offline catalog script reads the game's registries. It never calls the game over HTTP: it goes through the tournament service (`/api/host`, `/api/host/catalog`).
- **Each service talks only to the next, over JSON:** quiz → Tournament API → tournament service → Match Host API → game. A contract change means updating both sides together: `contracts/match-host.d.ts` with `tournament/server/host.ts` and `games/weapon-balls/server/matches.js` (+ its `api/game.d.ts`); `contracts/tournament.d.ts` with `tournament/server/` and `apps/quiz-of-doom/server/tournament.ts`.
- **No new runtime dependencies** in the frameworks. They run as TypeScript in Node directly (type stripping: no enums, no parameter properties, `import type` for types).

## Modules

**Match Host contract** (`contracts/match-host.d.ts`). What a game implements to be played in tournaments: `GET /status` (with `displays`, `screens`, `onScreen`, `displayPath`), `GET /catalog` (opaque), `POST /validate` (`characters` and `settings`), `POST /matches` (`characters`, `seed`, `ref`, `decisive`, `settings`), `GET /matches[?ref=]`, `GET /matches/:id[?wait=1]`, `DELETE /matches/:id`. A result has `winner`, `reason`, `ranking` and optional `scores`; games add their own fields. "Character" is the contracts' word for whatever a game plays with; a game names it its own way (Weapon Balls: a fighter).

**Tournament service** (`tournament/`, documented in `tournament/README.md`). State in `tournament/data/tournaments.json`. `formats/` holds the formats (double elimination, single elimination, round robin), each a pure `Format` (`formats/Format.ts`): it draws stages from the tournament seed and never does I/O; add one to `FORMATS` in `formats/index.ts`. `server/store.ts` holds every change (through `mutate`, which fills in `status`, entrant `progress` and `standings`, bumps `version`, saves and notifies); it treats an entrant's `character` and the tournament's `match` settings as opaque. `server/runner.ts` is the only code that calls the Match Host (`server/host.ts`): it validates characters and settings with the game, sends a stage's matches in order with `decisive: true`, `settings` and `ref: "<tournament>/<match>"`, waits for results, requeues with the same seed when the game forgets a match, and draws the next stage. `server/index.ts` is the HTTP API plus SSE (`/tournaments/:id/events`). Match seeds come from the tournament seed per group (`groupRandom`), so a redrawn group is the same fight; the double elimination draws are pinned by a test. The contract's types are generic over the game's character and result (`Tournament<C, R>`).

**Party** (`party/`, documented in `party/README.md`). `createParty` (server) owns the admin key (`data/admin-token.txt` or `ADMIN_KEY`), player tokens (`x-player-token`), the admin header (`x-admin-key`), the SSE views (`/api/events`, heartbeat every 15 s, `null` for an unknown token), presence, JSON routes by access (`public`/`player`/`admin`, `PartyError` for a 400), `/api/lan` and the built client. The app supplies `findPlayer`, `playerView`, `adminView` and calls `broadcast()` after every change. `party/client` is framework-free (`post`, `eventsUrl`, `subscribe` with a silence watchdog and reconnects); `party/shared/protocol.ts` is the wire protocol both sides import. `server/party.test.ts` is a small buzzer game that pins the behaviour.

**Quiz** (`apps/quiz-of-doom/`, its own README). Its server is a party app (`server/index.ts` registers routes on `createParty`), and `src/api.ts` wraps party's client in a React hook. It is a Tournament API client (`server/tournament.ts`): it mirrors its tournament from the event stream, sends team loadouts as entrants whose `character` is Weapon Balls' `FighterInput` (`Team.entrantId` is the public id; `Team.id` is a device's secret token and must never leave the quiz) and syncs them before each stage starts. `shared/types.ts` types the tournament with Weapon Balls' fighter and result. Its own rules (battle breaks, transformation picks, offers) stay in the quiz and read the mirror.
