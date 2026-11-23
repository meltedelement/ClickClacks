# Weapon Balls (and friends)

This repo holds a few separate modules. Each lives in its own folder, has its
own `package.json` and README, and talks to the others only through JSON APIs
or, for party, a small library API. Two of them are frameworks that know
nothing about any particular game.

| Module | What it is | Knows about |
| --- | --- | --- |
| [`games/weapon-balls/`](games/weapon-balls/README.md) | The game: balls with spinning weapons fight in an arena. Implements the Match Host API so other programs can play matches on it. | Nothing else here. |
| [`tournament/`](tournament/README.md) | **Framework.** A tournament service (double elimination, single elimination, round robin) that plays its matches on any game implementing the Match Host API. | Only the Match Host contract. |
| [`party/`](party/README.md) | **Framework.** Jackbox-style plumbing: players join on their phones, an admin runs it from a page, a big screen shows it to the room. A server library and a browser library. | Nothing: the app brings the state and the rules. |
| [`apps/quiz-of-doom/`](apps/quiz-of-doom/README.md) | The product that ties them together: a pub quiz whose correct answers earn Weapon Balls upgrades, with battle breaks played as a tournament. Built on party, a Tournament API client. | All of the above. It is the only place allowed to. |
| [`apps/royale/`](apps/royale/README.md) | A second product: people on the network draft a weapon and upgrades on their phones, then watch themselves fight a battle royale. Built on party, a Match Host API client. | Party and the game. |
| [`apps/bracket/`](apps/bracket/README.md) | A third: the same draft, but 1v1 fights through a tournament bracket, with one more upgrade after every stage. Built on party, a Tournament API client; borrows the royale's draft and look. | Party, the tournament service and the game. |
| [`apps/letter-brawl/`](apps/letter-brawl/README.md) | A fourth: the bracket, with one guess at a hidden word between stages; the letters you find pay upgrades. Reuses the bracket's rules engine. | Party, the tournament service, the game, and two open word APIs. |
| [`contracts/`](contracts/) | The API contracts, as TypeScript types: `match-host.d.ts` and `tournament.d.ts`. Imported by relative path; the only code the services share. | |

```
                  party (library)
                        │
apps/quiz-of-doom ──Tournament API──▶ tournament/ ──Match Host API──▶ games/weapon-balls
 (phones, admin,        contracts/tournament.d.ts      contracts/match-host.d.ts   (sim + display page)
  big screen)                                                 ▲
                  party (library)                             │
                        │                                     │
apps/royale ────────────┴────────── Match Host API ───────────┘
 (phones, host page; one port, the game stays private)

apps/bracket ──Tournament API──▶ its own tournament service ──Match Host API──▶ its own game
 (phones, host page; one port; the service and the game stay private)
```

The rules that keep the frameworks reusable:

- **The tournament service never looks inside a character.** Each entrant
  carries a `character` in the game's own format (whatever the game plays
  with: for Weapon Balls a fighter), and the tournament carries match
  `settings`; both go to the game as they are. The game checks them
  (`POST /validate`) and reports results in the shape the Match Host contract
  fixes (`winner`, `reason`, `ranking`, optional `scores`).
- **Party never looks inside the state.** The app gives it a way to find a
  player by token and a view per player and for the admin; party handles keys,
  tokens, live updates, presence and serving the client.
- **Games know nothing about tournaments or parties.** Weapon Balls is driven
  only through its Match Host API.
- **Only an app knows the concrete pieces** and joins them: the quiz types the
  tournament with Weapon Balls' fighter and result
  (`Tournament<FighterInput, MatchResult>`), the bracket does the same, and the
  royale, which needs no bracket, queues its one fight on the game directly.

A new game becomes playable in tournaments by implementing
`contracts/match-host.d.ts`. A new party game starts from `party/` (see its
README for the API and a worked example in its tests).

## Running

Install once from the repo root (the tournament service and party have no
dependencies; this installs the game and the quiz):

```sh
npm run install:all
```

### Just the game (no quiz, no tournament)

```sh
cd games/weapon-balls
npm run dev                  # hot reload: http://localhost:5173/?display
npm run build && npm start   # built: http://localhost:3002/?display (PORT=... to change)
```

The game also serves the Match Host API at `/api` on the same port. Its balance
tools (`npm run balance`, `sweep`, `flawless`) run from the same folder; see
`games/weapon-balls/README.md`.

### A royale night

```sh
npm run royale        # one port for everyone: 8080 (npm run royale -- 9000 for another)
```

Prints the host page and the address players join at from their phones. See
[`apps/royale/README.md`](apps/royale/README.md).

### A tournament night

```sh
npm run tournament    # one port for everyone: 8080 (npm run tournament -- 9000 for another)
```

Players draft on their phones and fight 1v1 through a bracket, adding an upgrade
after every stage. Prints the host page and the join address. See
[`apps/bracket/README.md`](apps/bracket/README.md).

### A Letter Brawl night

```sh
npm run brawl         # like npm run tournament, with a word guess between stages
```

See [`apps/letter-brawl/README.md`](apps/letter-brawl/README.md). The server needs internet access for the words.

### Everything together (the quiz night)

```sh
npm run dev:all       # hot reload: game 5173, tournament API 3003, quiz client 5174, quiz API 3001
npm run start:all     # builds the game and the quiz, then serves: game 3002, tournament API 3003, quiz 3001
```

Any server stopping stops the others, and Ctrl-C stops everything. The
terminal shows only the two host pages, the admin key and the address teams
join at; the servers' own output appears only for errors, or if a server fails
(`npm run dev:all -- --verbose` shows all of it). Then open the quiz's two host
pages (`:3001` instead of `:5174` when built):

- Big screen: `http://localhost:5174/screen`. It embeds the game's display page
  and switches to it by itself while a battle stage plays.
- Admin: `http://localhost:5174/admin`. The host drives the quiz from here.

### One module at a time

Run each from its own folder. Start the services in order, since each one is
pointed at the next by an environment variable.

| To run | Command (from) | Needs | Where |
| --- | --- | --- | --- |
| The game | `npm run dev` or `npm run build && npm start` (`games/weapon-balls/`) | nothing | 5173 dev, 3002 built |
| The tournament service | `HOST_API=http://127.0.0.1:5173/api npm start` (`tournament/`) | a running game; `HOST_API` defaults to the built game on 3002 | 3003 |
| The quiz | `npm run dev` or `npm run build && npm start` (`apps/quiz-of-doom/`) | a running tournament service; `TOURNAMENT_API` defaults to `http://127.0.0.1:3003/api` | 3001 (client 5174 in dev) |
| The royale | `GAME_URL=http://127.0.0.1:3002 npm start` (`apps/royale/`) | a running game; `npm run royale` in the root does both | 8080 |
| The bracket | `GAME_URL=... TOURNAMENT_API=... npm start` (`apps/bracket/`) | a running game (`SCREENS=1`) and a tournament service; `npm run tournament` in the root does all three | 8080 |
| The party demo (buzzer game) | `npm run demo` (`party/`) | nothing | 3100 |

For example, to play tournaments without the quiz: start the game, then the
tournament service (see `tournament/README.md` for its API).

## Checks

```sh
npm test            # tournament formats, party server, quiz, royale and bracket rules, the game's exact math (node --test)
npm run typecheck   # tournament, party, the quiz, the royale and the bracket (borrows the quiz's TypeScript)
```

The game's gameplay has no tests; its balance tool is how gameplay changes are
checked (`npm run balance` in `games/weapon-balls/`, see its README).
