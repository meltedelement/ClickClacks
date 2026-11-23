# Ball Bracket

Weapon Balls for a room, as a tournament: everyone opens one address on their
phone, drafts a weapon and a transformation, and fights one on one through a
bracket. After every stage, everyone still in takes one more upgrade, so builds
grow as the tournament goes on. Every device shows the same fight at the same
moment.

Built on [party](../../party/README.md), and plays its tournament on the
[tournament service](../../tournament/README.md), which plays each match on the
[game](../../games/weapon-balls/README.md). No dependencies and no build step of
its own. It borrows the [royale](../royale/README.md)'s draft rules, colours,
weapon blurbs and page styles.

## Running it

From the repo root, after `npm run install:all` once:

```sh
npm run tournament            # port 8080
npm run tournament -- 9000    # another port (PORT=9000 works too)
```

It prints the host page (with the host key in the link) and the address players
join at. People need to be on the same network as the laptop. It starts three
servers: the game (3006) and a tournament service of its own (3007), both
listening on 127.0.0.1 only, and this app on the port everyone uses. `GAME_PORT`
and `TOURNAMENT_PORT` move the first two.

## A tournament

1. **Lobby.** Players join with a name, choose a weapon, then take one of three
   transformations. The host picks the format (double elimination by default,
   single elimination or round robin) and starts the tournament. Anyone who
   hasn't finished gets the rest at random. It needs two players or more; an odd
   one out gets a bye.
2. **A stage plays.** Its matches go to the game one at a time, and every phone
   and the host page show each one under a banner naming the round ("Winners
   semi-finals", match 2 of 4, stage 2 of 6). When a match ends, a card over
   the arena says who won and how ("KO in 42 s · 34 HP left") until the next one
   starts, about 4 seconds. The bracket and each player's status ("you
   fight Cy this stage", "one more loss and you are out") are under the arena.
   No shared screen is needed: everyone watches on their own phone.
3. **Picks.** When the next stage is drawn, everyone still in is offered three
   upgrades and takes one. Once per tournament, the first time half the players
   or fewer are still in (never fewer than two; in round robin, at the halfway
   stage), everyone still in also gets a **second transformation**, picked before
   that stage's upgrade. The stage starts by itself once they all have. The
   host can start it sooner, which picks at random for anyone still choosing.
4. **Champion.** The final standings with everyone's build. The champion gets a
   title (shown beside their name all night). The host starts a new tournament,
   and everyone drafts a fresh build in the lobby.

Matches use the game's defaults: sudden death from 120 s (both balls lose HP
every second, a little more each second), and at 180 s the one with more HP
left wins.

**Styles.** The host page's **Style** button beside a player opens a picker: any
colour for their ball, a skin (the game's `skin`: the gold dev orb, birthday,
rainbow, galaxy, diamond or fire) and a tag of up to 12 characters before their
name ("DEV · Ana"; the dev orb and birthday skins suggest one). It's looks only:
the fight is the same. It shows from the next stage. The royale's `shared/looks.ts` checks
what the host sends and its `client/ui.js` (`SKIN_LOOKS`) draws the picker.

Someone who joins during a tournament watches it and drafts for the next one.
Someone who leaves keeps fighting with the build they have. The host can stop a
stage (its unfinished matches restart from the beginning, with the same seeds,
when it starts again) and end the tournament at any time.

Everything is in memory. Restarting ends the night, and `npm run tournament` clears
the tournament service's saved state (`data/tournament-<port>/`, one folder per
copy, so two can run side by side on different ports) as it starts.

## How it fits together

```
phones, host page ──party API──▶ server/index.ts ──Tournament API──▶ tournament service ──Match Host API──▶ the game
        └──/game/ (display page only)──▶ proxied ──────────────────────────────────────────────────────────────▲
```

- `server/store.ts`: the players, their builds and the rules. It follows the
  tournament through a `TournamentService`, so `store.test.ts` plays one against
  a made-up service.
- `server/tournament.ts`: the Tournament API client, following the tournament's
  event stream.
- `server/index.ts`: party routes, the pages, and a proxy to the game's display page.
- `client/`: `phone.html` and `admin.html`, plain modules using party's client;
  `bracket.js` draws the bracket, the match on now and the standings for both.
- `shared/types.ts`: what each page is sent.

**Same fight on every device.** Matches are queued with the game's `shared`
setting: like a royale, every device runs the real sim from the same seed, with
math that is the same in every browser and to the server's clock. A phone that
sleeps or reloads catches up to where everyone is. Shared matches have no
hitstop (the brief freeze on a big hit), since a shared clock can't stop. The
game runs with one screen, so there is one match on at a time.

**No shared screen needed.** Each phone shows the match on now, and so does the
host page; any of them can be the only one watching. A fight needs **at least
one device with the page visible** to reach its end (a browser pauses hidden
tabs): if every screen goes dark, it waits and picks up when someone looks again.

There are no accounts and no passwords for players: anyone who reaches the port
can join, and a modified browser could report a false result. It's built for
people you'd let onto your Wi-Fi.

## Checks

```sh
npm test            # in this folder, or from the root with everything else
npm run typecheck   # borrows the quiz's TypeScript: npm install in ../quiz-of-doom first
```
