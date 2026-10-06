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
| [`contracts/`](contracts/) | The API contracts, as TypeScript types: `match-host.d.ts` and `tournament.d.ts`. Imported by relative path; the only code the services share. | |

```
                  party (library)
                        │
apps/quiz-of-doom ──Tournament API──▶ tournament/ ──Match Host API──▶ games/weapon-balls
 (phones, admin,        contracts/tournament.d.ts      contracts/match-host.d.ts   (sim + display page)
  big screen)
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
- **Only an app (the quiz) knows the concrete pieces** and joins them: it types
  the tournament with Weapon Balls' fighter and result
  (`Tournament<FighterInput, MatchResult>`).

A new game becomes playable in tournaments by implementing
`contracts/match-host.d.ts`. A new party game starts from `party/` (see its
README for the API and a worked example in its tests).

## Running

```sh
npm run install:all   # npm install in every module that has dependencies
npm run dev:all       # hot reload: game 5173 (display), tournament API 3003, quiz client 5174, quiz API 3001
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

You can also start them by hand, each from its own folder. Then set `HOST_API`
on the tournament service so that it finds the game
(`HOST_API=http://127.0.0.1:5173/api npm start` in `tournament/`, or the built
`:3002`), and `TOURNAMENT_API` on the quiz server (default
`http://127.0.0.1:3003/api`). To work on the game alone, `npm run dev` in
`games/weapon-balls/`.

## Checks

```sh
npm test            # tournament formats, party server, quiz rules (node --test)
npm run typecheck   # tournament, party and the quiz (borrows the quiz's TypeScript)
```

The game has no tests; its balance tool is how gameplay changes are checked
(`npm run balance` in `games/weapon-balls/`, see its README).
