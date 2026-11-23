# Ball Royale

Weapon Balls for a room: everyone opens one address on their phone or laptop,
drafts a weapon and upgrades, and drops into a battle royale with everyone else.
Each device shows the same fight at the same moment, following its owner's ball.

Built on [party](../../party/README.md), and plays its fights on the
[game](../../games/weapon-balls/README.md) through the Match Host API. No
dependencies and no build step of its own.

## Running it

From the repo root, after `npm run install:all` once:

```sh
npm run royale            # port 8080
npm run royale -- 9000    # another port (PORT=9000 works too)
```

It prints the host page (with the host key in the link) and the address players
join at. People need to be on the same network as the laptop. Ports above 1024
are open by default on Fedora Workstation; on another setup, allow the port in
the firewall. `http://<address>:<port>/` is all anyone needs.

## A round

1. **Draft.** Players join with a name, choose a weapon, then take one of three
   offers at each of five picks: a transformation first (it decides what the
   weapon is), then four upgrades. The order and the offer size are at the top of
   `shared/draft.ts`. Gun and Drone are left out for now (see below).
2. **Drop.** The host presses the button. Anyone unfinished gets the rest of their
   draft at random, and bots fill the arena up to the host's **Balls in the arena**
   setting (default 8). After a 5 second countdown it starts.
3. **Fight.** Everyone watches, with their own ball ringed in white and the view
   following it. In an arena bigger than the view (about a dozen balls or more),
   tapping zooms out to all of it and back. Someone joining now watches and is in
   the next round.
4. **Results.** Everyone's place and build. The host starts the next round: wins
   are kept and drafts start over (or carry on, in build-up mode, below).

**Build up.** The host's **Builds** setting (while drafting) switches from a new build
each round to one that grows. You choose a weapon and take one pick in the first round,
which is the transformation. After that you keep everything and add one upgrade each
round, so a fifth round looks like a normal full build and later ones go past it. Bots
are still rebuilt each round but keep pace, with one upgrade per round after the first.
Someone joining late takes all the picks they missed, and anyone who hasn't picked when
the round starts gets a random one, as in a normal draft. A cancelled round gives no
extra pick. Changing the setting clears everyone's builds, and so does the host's
**Restart everyone's builds** button. Wins stay either way.

The host can cancel a round at any time, which goes back to the draft with
everyone's picks intact, and can remove players. Keep the host page open and visible
during a fight (see below). Everything is in memory: restarting ends the game
night, and phones are asked to join again.

**Styles.** The host page's **Style** button beside a player opens a picker: any
colour for their ball, a skin (the game's `skin`: the gold dev orb, birthday,
rainbow, galaxy, diamond or fire) and a tag of up to 12 characters before their
name ("DEV · Ana"; the dev orb and birthday skins suggest one). It's looks only:
the fight is the same. It shows from the next round. `shared/looks.ts` checks
what the host sends and `client/ui.js` (`SKIN_LOOKS`) draws the picker.

**Telling balls apart.** Every player gets a colour nobody else has
(`shared/colors.ts`), plus their name and a ring in that colour around their ball.
Bots are all the same gray, with no name or ring. Each new colour is the one that
looks most different from the gray and the colours already taken, so they stay easy
to tell apart in a usual group and close but never equal at the 100-player limit.

**Bots are filler.** A bot has a random weapon and four small upgrades, with no
transformation, and starts smaller than a player: the host's **Bot size** setting,
default 75%. Its HP and damage shrink with it, and killing one gives less growth. With
3 players and 5 bots, players win about 70% of simulated fights with random builds.

**Unbalanced for a royale: Gun and Drone.** Neither is offered to players or bots,
and the weapon screen says so. They almost never win in a crowd: in 400 simulated
16-ball royales with drafted builds, Gun won 0.3% and Drone 0.5%, each with 12.5% of
the balls. `UNBALANCED_WEAPONS` in `server/store.ts` is the list; take one off to
bring it back. The game itself keeps both for normal matches and the quiz.

## How it fits together

```
phones, host page ──party API──▶ server/index.ts ──Match Host API──▶ the game (127.0.0.1)
        └──/game/ (display page only)──▶ proxied ─────────────────────▲
```

- `shared/draft.ts`: the draft rules, pure. What fits what comes from the game's
  catalog, so new weapons and upgrades show up by themselves.
- `shared/colors.ts`: the bots' gray and the players' colours.
- `shared/weapons.ts`: a line describing each weapon.

[`apps/bracket`](../bracket/README.md) borrows `shared/draft.ts`, `shared/colors.ts`,
`shared/weapons.ts`, `client/ui.js` and `client/style.css`, so check it when changing them.
- `server/store.ts`: the players, drafts and round, reached only through a
  `GameHost`, so `store.test.ts` plays whole rounds against a made-up game.
- `server/host.ts`: the Match Host client.
- `server/index.ts`: party routes, the pages, and a proxy to the game.
- `client/`: `phone.html` and `admin.html`, plain modules using party's client.
- `shared/types.ts`: what each page is sent.

**One port.** The game listens on 127.0.0.1 only. The proxy passes on its display
page and what that page calls (the fight's event stream, "started", "finished") and
nothing else, so nobody on the network can queue or cancel matches on it. The
game's parts of this are its `royale` match setting, a fighter's `highlight` and `size`,
`&follow=` on the display page and `HOST` on its server: all generic, and it knows nothing about
this app.

**Same fight on every device.** Nothing streams the fight: every device runs the
real sim from the same seed and build list. A royale runs with math that is the
same in every browser (`src/sim/exactMath.js` in the game) and to the server's
clock, so devices agree on the outcome and the moment, and one that slept or
reloaded fast-forwards to where everyone is. Every device reports the result it
got, and the first one in counts.

Because of that, **a fight needs at least one device with the page visible** to
reach its end: a browser pauses hidden tabs. If everyone's screen goes off, the round
waits, picks up when someone looks again, or the host can cancel it.

There are no accounts and no passwords for players: anyone who reaches the
port can join, and a modified browser could report a false result. It's built for
people you'd let onto your Wi-Fi, not for the open internet.

## Checks

```sh
npm test            # in this folder, or from the root with everything else
npm run typecheck   # borrows the quiz's TypeScript: npm install in ../quiz-of-doom first
```
