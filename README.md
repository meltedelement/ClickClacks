# Weapon Balls

Balls with spinning weapons bounce around an arena and fight. Every weapon gets
stronger in its own way each time it lands a hit.

## Running

```sh
npm install
npm run dev      # opens a dev server with hot reload
```

To run the game and the [quiz](quiz/README.md) together, one command starts
both and points the quiz at the match API for you:

```sh
npm install && (cd quiz && npm install)
npm run dev:all    # hot reload: game 5173 (display), quiz client 5174, quiz API 3001
npm run start:all  # builds both, then serves: game 3002, quiz 3001
```

Either server stopping stops the other, and Ctrl-C stops everything. The
terminal shows only the two host pages, the admin key and the address teams
join at; the servers' own output appears only for errors, or if a server fails
(`npm run dev:all -- --verbose` shows all of it). Then open
the quiz's two host pages (`:3001` instead of `:5174` when built):

- Big screen: `http://localhost:5174/screen`. It embeds the game's display page
  and switches to it by itself while a battle stage plays.
- Admin: `http://localhost:5174/admin`. The host drives the quiz from here.

You can also start the two by hand. Then set `GAME_API` on the quiz server so
that it finds the game (`GAME_API=http://localhost:5173/api npm run dev` in
`quiz/`, or the built `:3002`).

Each fighter is a random weapon by default (rerolled every match, never a mirror
match). The menu button in the top right can pin a specific weapon per fighter, add and
remove upgrades per fighter (a Random fighter can only take upgrades that fit any weapon),
and has restart, pause, speed, hitboxes, auto rematch, sound, and fullscreen.

Shortcuts: **Space** pause, **R** restart, **H** hitboxes, **M** mute, **F** fullscreen, **Esc** close menu.

### Effects load and quality

The display page can run four arenas at once, each with its own canvas, so effects
scale themselves to the frame rate. `src/game/Quality.js` watches the animation-frame
interval; when frames start arriving late it steps the particle budget and the canvas
backing-store resolution down (and steps them back up once frames are comfortable
again). Effects are cosmetic, so this never changes how a match plays out — the
simulation and its results are untouched.

To pin a level instead of adapting, add `?quality=` to the page URL — `high`,
`medium`, `low` or `minimal`, e.g. `?display&quality=medium`. Useful on a venue
machine whose frame rate you already know.

`tools/bench-render.js` drives the real `Game`/`Effects`/`Renderer` loop headlessly
and reports canvas calls, particle counts and frame timings, which is how to check a
change to effects before trying it on the big screen:

```sh
node tools/bench-render.js --screens=4 --seconds=20
node tools/bench-render.js --mode=display --visible=4 --seconds=20   # the real display page
node tools/bench-render.js --screens=4 --storm=40 --quality=2        # sustained effects load
```

## Project layout

```
src/
  config.js            Global tuning: arena size, ball speed/HP, knockback, hitstop
  main.js              Entry point, wires Game + Controls together
  styles.css
  sim/                 Pure match logic, no DOM. Runs in the browser or in Node.
    Simulation.js      Spawning, the step loop, hits/parries/winner, emits events
    Ball.js            Movement, HP, hit cooldowns, statuses, drawing the ball
    Status.js          Base class for timed effects on a ball (burning, netted...)
    collisions.js      Wall bounce, ball-vs-ball, weapon-vs-ball, weapon-vs-weapon
    math.js            Vector + segment geometry helpers
    random.js          Seeded Math.random replacement for reproducible matches
  weapons/
    Weapon.js          Base class every weapon extends
    Sword.js, Spear.js, Mace.js, Daggers.js
                       One file per weapon: stats, scaling, and how it's drawn
    Shield.js          Off-hand shield that blocks enemy weapons
    OffhandSword.js    A shield shaped like a short sword (Dual Wielder)
    index.js           Registry of selectable weapons
  abilities/
    Ability.js         Base class for special moves on a cooldown
    SpinSwipe.js       Sword: one rapid full spin for bonus damage
    ChargeDash.js      Spear: stop, aim, lunge for bonus damage
    SpearThrow.js      Spear (Olympian): stop, aim, throw the spear round a loop back to hand
    DropSlam.js        Mace: from high up, plunge to the floor; damage grows with the fall
    DashFlurry.js      Daggers: gather both blades, then three rapid dashes
    Buzzsaw.js         Daggers (Saw): launch the blades as a saw that chases the enemy
  upgrades/
    Upgrade.js         Base class for roguelike upgrades applied from a loadout
    common.js          Small upgrades any weapon can take
    sword.js, spear.js, daggers.js, mace.js
                       Small upgrades for one weapon
    sword-transformations.js
                       Big upgrades that reshape the Sword (Stalwart, Captain...)
    spear-transformations.js
                       Big upgrades that reshape the Spear (Hoplite, Poseidon...)
    mace-transformations.js
                       Big upgrades that reshape the Mace (Portaler, Devil...)
    daggers-transformations.js
                       Big upgrades that reshape the Daggers (Rogue, Trickster...)
    index.js           Registry of upgrades (menu order), plus loadout validation
  game/                Browser-only
    Game.js            Fixed-timestep loop, pause/speed/hitstop, sim events -> effects
    Renderer.js        Draws the arena, balls, weapons, banners
    Effects.js         Particles, floating damage numbers, screen shake
    Quality.js         Steps arena resolution and particle budget down when frames slip
    Sound.js           Sound effects, synthesised with Web Audio (no audio files)
  ui/
    Controls.js        Menu + keyboard shortcuts
    TournamentDisplay.js
                       Display mode (?display): plays up to four queued matches at once
server/
  matches.js           Match API: queue matches over HTTP, get results back
  index.js             Serves the built game + the match API (npm start)
  api.d.ts             TypeScript types for programs calling the match API
tools/
  balance.js           Headless batch balance tester (win rates + combat stats)
  bench-render.js      Headless frame benchmark for the browser loop (effects load)
```

## Match API (tournaments)

Another program (such as the quiz server) can queue matches over HTTP. A
display page plays them live, and each result goes back to that program. The
display page decides the official result, so the recorded winner is always the
one the audience saw. The quiz server in `quiz/` is the reference caller: at the
battle phase it runs a knockout tournament through this API. It sends the
matches of a round one bracket at a time (winners bracket first), and the
display plays up to four of them at the same time (see `quiz/README.md`).

```sh
npm run dev                  # API at http://localhost:5173/api, display at http://localhost:5173/?display
npm run build && npm start   # API at http://localhost:3002/api, display at http://localhost:3002/?display (PORT=... to change)
```

Open the display page on the screen everyone watches and leave it open. The
page is split into up to four arenas ("screens"), one match on each. Set the
number with `SCREENS=1` to `SCREENS=4` (default 4) when you start the server.
The grid shows only the screens in use: one match fills the page, two go side
by side, and three or four make a 2×2 grid. Each screen has a mute button in
its corner, and keys **1** to **4** do the same. **M** or the menu's Sound box
mutes all screens. The menu's pause, speed and hitbox settings apply to all
screens. `?display&embed` hides the menu, for a page that embeds the display
(the quiz's big screen). Such a page can post the message
`'weapon-balls:unlock-audio'` to the frame after its own first click, so the
arena plays sound without a click inside it.
Matches only play while at least one display page is connected. Browsers slow
down or pause background tabs, so keep the display tab visible. Then, from the
calling program:

```ts
import type { Match, MatchRequest } from './api'; // copy of server/api.d.ts

const API = 'http://localhost:3002/api';
const request: MatchRequest = {
  fighters: [
    { name: 'Alpha', weapon: 'sword', upgrades: { damage: 2, lifesteal: 1 } },
    { name: 'Beta', weapon: 'mace', upgrades: ['health', 'health'] },
  ],
};
const res = await fetch(`${API}/matches`, { method: 'POST', body: JSON.stringify(request) });
if (!res.ok) throw new Error((await res.json()).error); // e.g. an unknown upgrade id
const queued: Match = await res.json();

// Holds the request open until the match has been played on screen.
const done: Match = await (await fetch(`${API}/matches/${queued.id}?wait=1`)).json();
console.log(done.result); // { winner: 0 | 1 | null, winnerName, reason: 'ko' | 'time' | 'hp', time, hp }
```

### API reference

Everything is JSON over HTTP under `/api`. Request bodies must be a JSON object
(an empty body counts as `{}`) of at most 64 KB. CORS is open (`Access-Control-Allow-Origin: *`),
so a page on another local port can call it. TypeScript types for every shape
below are in [`server/api.d.ts`](server/api.d.ts); copy that file into the caller.

| Route | |
| --- | --- |
| `POST /api/matches` | Queue a match. |
| `GET /api/matches/:id` | One match. Add `?wait=1` to hold the request until it is `done` or `cancelled`. |
| `GET /api/matches` | Every match since the server started, in the order queued. |
| `DELETE /api/matches/:id` | Cancel a match that is queued or playing. If it's on screen, it stops. |
| `GET /api/status` | Displays connected, the matches on screen and the queue length. |
| `GET /api/catalog` | Weapon, upgrade and transformation ids, for building menus or offers. |

#### `POST /api/matches`

Request body (`MatchRequest`):

| Field | Type | |
| --- | --- | --- |
| `fighters` | `[Fighter, Fighter]` | Required, exactly two. `result.winner` indexes into this list. |
| `seed` | integer | Optional, 0 to 2³² − 1. The same seed and fighters give the same fight. Random if left out. |
| `timeLimit` | number | Optional, sim seconds above 0 and at most 600. Default 180. |
| `tiebreak` | `'hp'` \| `null` | Optional. With `'hp'` the match never ends in a draw: at `timeLimit`, or after a double KO, the fighter with the larger share of its max HP left wins. An exact tie is a coin flip from the match seed, so it is the same on every display. The banner says "WINS ON HP". Default `null`. |

A fighter (`FighterInput`):

| Field | Type | |
| --- | --- | --- |
| `weapon` | string | Required. A weapon id from `/api/catalog`. |
| `name` | string | Optional. Shown above the ball and in the winner banner. `team` is accepted in its place. |
| `color` | string | Optional. The ball colour as `"#rrggbb"`, e.g. a team colour. Without it, the ball takes the colour of its weapon. Another format is a 400. |
| `upgrades` | `string[]` or `{ [id]: count }` | Optional. A list of upgrade ids (repeat an id to stack it) or a map of id to copies, 0 to 100 each. `['damage', 'damage']` and `{ damage: 2 }` are the same. Upgrades are applied in the order given. A transformation here is a 400. |
| `transformations` | `string[]` or `{ [id]: count }` | Optional. Transformation ids from `transformations` in `/api/catalog`, in the same forms. They are applied before the upgrades. An upgrade that is not a transformation here is a 400. |

Every upgrade and transformation must exist, fit the weapon, stay within its
`maxStacks` and have the upgrades it `requires`. A bad request gets a 400 and nothing is queued.
Success is a **201** with the new `Match`:

```json
{
  "id": "5f0c3a1e-8d4b-4b8e-9a52-1c7e2f6a9d10",
  "status": "queued",
  "fighters": [
    { "name": "Alpha", "color": "#e5484d", "weapon": "sword", "upgrades": ["damage", "damage", "lifesteal"], "transformations": ["captain"] },
    { "name": "Beta", "color": null, "weapon": "mace", "upgrades": ["health", "health"], "transformations": [] }
  ],
  "seed": 2894113750,
  "timeLimit": 180,
  "tiebreak": null,
  "screen": null,
  "queuedAt": "2026-09-28T14:03:11.204Z",
  "startedAt": null,
  "finishedAt": null,
  "result": null
}
```

The stored `fighters` are normalised: `team` is folded into `name` (`null` when
neither was given), `color` is `null` when not given, and `upgrades` and `transformations` are always flat lists of ids.

#### The `Match` object

| Field | Type | |
| --- | --- | --- |
| `id` | string | UUID. |
| `status` | `'queued'` \| `'playing'` \| `'done'` \| `'cancelled'` | See the lifecycle below. |
| `fighters` | `[Fighter, Fighter]` | `{ name: string \| null, color: string \| null, weapon: string, upgrades: string[], transformations: string[] }`. |
| `seed` | integer | The seed the fight is played with, whether you passed it or not. |
| `timeLimit` | number | Sim seconds before a draw is called. |
| `tiebreak` | `'hp'` \| `null` | As requested. |
| `screen` | integer \| `null` | The display screen (0 to `screens` − 1) the match plays on. `null` while it waits for a free screen. It keeps the number after the match ends. |
| `queuedAt` | ISO timestamp | |
| `startedAt` | ISO timestamp \| `null` | When a display started it. Reset to `null` if it goes back to `queued`. |
| `finishedAt` | ISO timestamp \| `null` | Set when `done` or `cancelled`. |
| `result` | `MatchResult` \| `null` | Only set when `status` is `done`. A cancelled match has no result. |

`MatchResult`:

| Field | Type | |
| --- | --- | --- |
| `winner` | `0` \| `1` \| `null` | Index into `fighters`, or `null` for a draw. |
| `winnerName` | string \| `null` | The winner's `name`, or its weapon id if it has no name. `null` for a draw. |
| `reason` | `'ko'` \| `'time'` \| `'hp'` | `'time'` when nobody had won at `timeLimit`. `'hp'` when the `hp` tiebreak picked the winner. Otherwise `'ko'`. |
| `time` | number | Sim seconds the match lasted. |
| `hp` | `[number, number]` | HP left per fighter, in `fighters` order. |

A draw is `winner: null`. It is usually `reason: 'time'`, but two fighters
knocked out in the same step is also a draw, with `reason: 'ko'`. Check
`winner`, not `reason`. A bracket has to decide what to do with a draw, such as
replaying with another seed, or it can queue its matches with `tiebreak: 'hp'`.

#### `GET /api/matches/:id`

Returns the `Match`. With `?wait=1` (any value except `0` or `false`) the
request is held open until the match is `done` or `cancelled`, then returns it.
If it already is, it returns straight away. There is no timeout on the server
side, and a match can sit in the queue for minutes, so set a long (or no) client
timeout. If the connection drops, just ask again. With no display connected the
match never plays and the wait never ends, so check `/api/status` first.

#### `GET /api/matches`

Returns `Match[]`, oldest first, including finished and cancelled matches. The
server keeps them all until it restarts.

#### `DELETE /api/matches/:id`

Cancels a match and returns it with `status: 'cancelled'`. A match that is
playing stops on the display, and the next one in the queue goes on. Waiters on
`?wait=1` get the cancelled match. Cancelling a match that is already `done` or
`cancelled` is a 409.

#### `GET /api/status`

```json
{ "displays": 1, "screens": 4, "onScreen": [{ "...": "a Match" }], "current": { "...": "a Match" }, "queued": 3 }
```

| Field | Type | |
| --- | --- | --- |
| `displays` | number | Display pages connected right now. Matches only play while this is above 0. |
| `screens` | number | Matches the display plays at the same time (the `SCREENS` setting). |
| `onScreen` | `Match[]` | The matches on the screens now, `playing` or about to start (`queued`). |
| `current` | `Match` \| `null` | The first of `onScreen`, or `null`. For callers that play one match at a time. |
| `queued` | number | Matches not done yet, including the ones on screen. |

#### `GET /api/catalog`

```json
{
  "weapons": [{ "id": "sword", "name": "Sword" }],
  "upgrades": [
    {
      "id": "lifesteal",
      "name": "Lifesteal",
      "description": "…",
      "weapons": null,
      "requires": [],
      "excludedBy": [],
      "maxStacks": null
    }
  ],
  "transformations": [
    {
      "id": "captain",
      "name": "Captain",
      "description": "…",
      "weapons": ["sword"],
      "requires": [],
      "excludedBy": [],
      "maxStacks": 1
    }
  ]
}
```

`upgrades` holds the small upgrades and `transformations` the big upgrades that
reshape the weapon. Both lists use the same shape. `weapons` is the list of
weapon ids it fits (`null` for any weapon), `requires` the upgrade ids the
fighter must also have, `excludedBy` the upgrade ids that make it useless (don't
offer it to a fighter that has one; a loadout with both is still accepted) and
`maxStacks` the most copies allowed (`null` for no limit). `description` is per copy. Both lists are in menu order.

#### Errors

Every error is `{ "error": "message" }` with one of these statuses:

| Status | When |
| --- | --- |
| 400 | Invalid request. The message names the field, e.g. `fighters[1]: Unknown weapon: axe` or `fighters[0]: Upgrade "quick-drop" can't go on weapon "sword"`. Also a body that isn't a JSON object. |
| 404 | Unknown route, or no match with that id. |
| 405 | The route exists but not for that method. |
| 409 | Cancelling a match that already finished, or (display side) reporting on a match that is not on a screen. |
| 413 | Body over 64 KB. |
| 500 | Server error. |

#### Display routes

These are used by the display page (`src/ui/TournamentDisplay.js`), not by the
calling program. They are listed for anyone writing another display.

| Route | |
| --- | --- |
| `GET /api/display` | A server-sent event stream. Each message's `data` is `{ screens: (Match \| null)[] }`: the match on each screen, or `null` for a free screen. One is sent on connecting and another whenever a screen changes. A `: ping` comment goes out every 20 seconds. |
| `POST /api/matches/:id/start` | The display started playing the match. Moves it to `playing`. Only a match on a screen is accepted (409 otherwise). Safe to repeat. |
| `POST /api/matches/:id/result` | Body `{ winner: 0 \| 1 \| null, time: number, hp: [number, number], decidedBy?: 'ko' \| 'hp' }`. Marks the match `done` and builds `result` (the server works out `winnerName` and `reason`). `decidedBy: 'hp'` needs a winner and a match with the `hp` tiebreak. The first result in wins: a later one for a finished match just returns it. 409 if the match is not on a screen, 400 for a malformed body. |

### Lifecycle

Up to `screens` matches play at the same time, and only while a display page is
connected. A free screen takes the next match in the order they were queued, so
queue a round's matches in bracket order to get match 1 on screen 1. After a
match, its winner banner stays on its screen for a few seconds before the next
match starts there. A match's status goes `queued` → `playing` → `done`, or ends
as `cancelled` from either of the first two.

Each match has a seed (random unless you pass one), so every display page shows
the same fights on the same screens. If the last display disconnects, the
matches on screen go back to `queued` and restart from the beginning when a
display reconnects. It's the same seed, so it's the same fight. The server keeps
matches in memory only.

Use the same browser on every display. JavaScript engines can differ in the
last bit of some math functions (`Math.atan2` differs between Node 22 and
Chrome 151), so over a long fight a seed can play out differently in another
browser, or when rerun in Node.

## Adding a new weapon

1. Create `src/weapons/Dagger.js`:

   ```js
   import { Weapon } from './Weapon.js';

   export class Dagger extends Weapon {
     static id = 'dagger';
     static displayName = 'Dagger';
     static hue = 120; // ball colour (0–360)

     constructor(owner) {
       super(owner);
       this.damage = 1;
       this.spinSpeed = 5;
       this.length = 45;
       this.thickness = 4;
     }

     onHit(target, sim) {
       this.spinSpeed += 0.5;
     }

     // Draw pointing along +x starting at x = start (already rotated for you).
     drawLocal(ctx, start) {
       ctx.fillStyle = '#ddd';
       ctx.fillRect(start, -3, this.length, 6);
     }
   }
   ```

2. Add it to the list in `src/weapons/index.js`:

   ```js
   export const WEAPONS = [Sword, Spear, Dagger];
   ```

That's it. It appears in the fighter dropdowns and the balance script.

### Hooks available on `Weapon`

| Hook                           | When it runs                                   |
| ------------------------------ | ---------------------------------------------- |
| `onHit(target, sim)`           | After this weapon damages a ball (scaling goes here) |
| `onParry(otherWeapon, sim)`    | When this weapon clashes with another          |
| `canParry(otherWeapon)`        | Whether a clash right now parries (default: not within the parry cooldown) |
| `clashesWith(otherWeapon)`     | Return false to swing straight through that weapon: it isn't blocked, but the other one still is. The Daggers do this against other Daggers while they can't parry |
| `update(dt, sim)`              | Every physics step (call `super.update(dt, sim)`) |
| `drawLocal(ctx, start)`        | Drawing the weapon                             |

Set `this.blades = 2` (or more) for several copies of the weapon spaced evenly around
the ball, like the Daggers. Each blade hits and parries on its own.

`this.owner` is the ball holding the weapon, so a weapon can change its ball too
(e.g. `this.owner.speed += 20` for an "unarmed" fighter that gets faster).

## Abilities

Each weapon can have one special move: set `this.ability = new SomeAbility(this)` in
the weapon's constructor. Abilities fire automatically when they're off cooldown and
`shouldActivate(sim)` returns true, then run until they call `this.end(sim)`, which
starts the cooldown again.

```js
import { Ability } from './Ability.js';

export class Frenzy extends Ability {
  static displayName = 'Frenzy';

  constructor(weapon) {
    super(weapon, { cooldown: 5 });
  }

  get spinMultiplier() {
    return this.active ? 2 : 1;
  }

  onStart(sim) {
    this.timeLeft = 1;
    this.emit(sim, 'frenzy', { shake: 2 }); // optional visual feedback
  }

  onUpdate(dt, sim) {
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) this.end(sim);
  }
}
```

While active, an ability changes behaviour through modifier getters the engine reads
every step:

| Modifier              | Effect                                                        |
| --------------------- | ------------------------------------------------------------- |
| `spinMultiplier`      | Multiplies weapon spin speed (0 freezes it so you can aim it) |
| `bonusDamage`         | Flat damage added to the weapon's own before any multiplier; bonuses add up |
| `damageMultiplier`    | Multiplies damage dealt                                       |
| `knockbackMultiplier` | Multiplies how hard hits launch the target                    |
| `controlsMovement`    | When true, the ball stops easing back to its normal speed, so the ability can set `owner.vel` itself |
| `unblockable`         | When true, the weapon can't be parried and passes through other weapons |
| `unstoppable`         | When true, other balls can't push this one; it shoves them aside |
| `disarmed`            | When true, the weapon's blades are gone (e.g. thrown): they can't hit, clash or be drawn. Shields stay |
| `bladeSpread`         | For multi-blade weapons: 1 = evenly spaced, 0 = gathered side by side at the front |
| `damageTakenMultiplier` | Multiplies damage the ball takes from weapon hits |

Hooks: `shouldActivate`, `onStart`, `onUpdate`, `onEnd`, `onHit`, `onParry`,
`onOwnerHit` (the ability's ball got hit), and `draw(ctx)` / `drawOver(ctx)` for visuals, drawn
underneath / on top of the balls. `nearestEnemy(sim)` is a handy helper for targeting, and
`target.clearHitCooldown(this.weapon)` lets a rapid multi-hit move land every hit.
`ChargeDash.js` is the most complete example, with multiple phases, aiming,
movement control, and cancelling.

Keep an ability's gameplay numbers as fields set in its constructor (like
`this.dashSpeed = 950`), not module constants, so upgrades can change them.

## Upgrades

Upgrades are the roguelike layer's way of changing a fighter. The sim knows nothing
about runs or choices: each match is set up from one loadout per fighter, which is
plain data so it can be saved or sent to a worker.

```js
new Simulation([
  { weapon: 'sword', upgrades: ['damage', 'damage', 'lifesteal'] },
  { weapon: 'mace', upgrades: [] },
], { onEvent });
```

Upgrades stack: listing an id twice gives one upgrade with `stacks = 2`. An
unknown id, one that doesn't fit the weapon, one over its `maxStacks`, or one
missing an upgrade it `requires` throws. `upgradesFor(weaponId, owned)` in
`src/upgrades/index.js` lists what could be added next; it also leaves out an
upgrade while the fighter has one of its `excludedBy` (Long Dash once Olympian
or Runner has replaced the dash), though a loadout with both is still valid.

To add one, write the class in `src/upgrades/common.js` (any weapon) or the
weapon's own file, and add it to `UPGRADES` in `src/upgrades/index.js`:

```js
export class Longsword extends Upgrade {
  static id = 'longsword';
  static displayName = 'Longsword';
  static description = 'Your sword is 25% longer.'; // per copy
  static weapons = ['sword']; // or leave out for any weapon
  static requires = []; // other upgrade ids that must be taken first
  static excludedBy = []; // upgrade ids that make this one do nothing: not offered with them
  static maxStacks = Infinity;

  // Runs once per copy, so it stacks by itself. Adding a share of the starting
  // value stacks linearly instead of compounding.
  apply() {
    this.base ??= this.weapon.length;
    this.weapon.length += this.base * 0.25;
  }

  drawBlade(ctx, start) {
    // Extra detail on each blade, in the same space as Weapon.drawLocal.
  }
}
```

Modifier getters and hooks run once however many copies there are, so scale them
with `this.stacks` (e.g. `return 1 + 0.2 * this.stacks`).

After the weapon, its ability and its shields are built, upgrades are applied in
loadout order, except that transformations go first (see below) and, within each group,
a lower `static order` (default 0) goes first. The same order holds for every hook, e.g. which
upgrade's `preventHit` is asked first (Slippery's -1 puts it before Rogue). Then the ball's HP is
filled to `maxHp`. An upgrade can do any mix of these:

| What                       | How                                                           |
| -------------------------- | ------------------------------------------------------------- |
| Change starting stats      | `apply()`: `this.weapon.blades += 1`, `this.owner.maxHp += 20`, `this.ability.windup *= 0.5` |
| Combat stats               | `weapon.critChance`, `weapon.critMultiplier`, `owner.armor`, `owner.dodgeChance`, `contactDamage` on each of `weapon.shields`, `weapon.widthScale` (draw width, set it with `thickness`) |
| Change behaviour live      | The same modifier getters as abilities. Multipliers multiply together, `bonusDamage` adds up (use it for "+N damage on your next hit", not a multiplier, or two such bonuses multiply each other); flags are on if anything turns them on |
| React to things            | `onUpdate`, `onHit(target, sim, damage, point)`, `onParry`, `onOwnerHit(attacker, sim, damage)`, `onBlock(attacker, sim)`, `onWallBounce(sim)`, `onBump(otherBall, sim)` (the balls' bodies touched, every step they do), `onAbilityStart`, `onAbilityEnd` |
| Care where a hit landed    | `critsAt(point)`: return true to make that hit always crit. `damageMultiplierAt(point)`: scale its damage. `point` is on the blade, e.g. `Spear.headHit(point)` tells the head from the shaft |
| Hold an ability back       | `allowsAbilityStart(ability, sim)`: return false and that ability of this weapon won't start this step (Dancer keeps its dance and Charge Dash from overlapping) |
| Cancel a hit               | `preventHit(attacker, sim)`: return true and a weapon hit on this ball does nothing (after dodge, before crit) |
| Deal extra damage          | `sim.dealDamage(this.owner, target, amount, { reason, color })`: no knockback, ignores armor and dodge |
| Put an effect on a ball    | `target.addStatus(new Burning({ source: this.owner, ... }), sim)`: see `src/sim/Status.js` |
| Replace the ability        | `apply()`: `this.weapon.ability = new OtherAbility(this.weapon)` |
| Show that it's there       | `drawUnder(ctx)`, `drawBlade(ctx, start)`, `drawOver(ctx)` (browser only) |
| Show that something happened | `this.emit(sim, phase, { shake, burst, text, color, pos })`, sent as an `upgrade` event; `pos` defaults to the owner |

Upgrade hooks run after the ability's and the weapon's own, so they see this hit's
scaling. If an upgrade changes the ability's `cooldown`, set `cooldownLeft` too, since the
first cooldown was already worked out. If an upgrade emits a new phase and should make a sound, add a case to
`Sound.upgrade`.

### Statuses

A status is a timed effect on a ball, usually put there by an enemy's upgrade: Fire
Eater's `Burning` deals damage over time and Gladiator's `Netted` slows the ball and
makes it take more damage. Tackler's `GuardBroken` sets `guardBroken`, so the ball's weapon and
shields stop blocking, and Poseidon's `Impaled` pins the ball to the trident's tip. Crusher's
`Stunned` sets `stunned`, so the ball deals no damage at all (its weapon hits pass through and
`sim.dealDamage` skips it as a source), and Rubber Mace's `Bouncing` uses `onWallBounce(sim)`
to hurt the ball on every wall it hits. Extend `Status` (`src/sim/Status.js`), set the modifier
getters (`speedMultiplier`, `damageTakenMultiplier`, `guardBroken`, `stunned`) and/or the hooks
(`onUpdate(dt, sim)`, `onWallBounce(sim)`), and draw it in `draw(ctx)`. A ball holds one status of each class, so applying it again refreshes
it. Guard damage with `sim.over` so nothing ticks after the match is decided.

### Transformations

Transformations are big upgrades that reshape a weapon, like the Sword's Stalwart (a
second shield) or Dual Wielder (the shield becomes a short sword), and the Spear's Poseidon
(a trident that skewers) or Olympian (swaps Charge Dash for Spear Throw), and the Mace's
Portaler (Drop Slam falls through the floor and out of the ceiling) or Devil (a pillar of fire
where the slam lands), and the Daggers' Rogue (teleport away from a hit) or Saw (swaps Dash
Flurry for Buzzsaw). Mark one with
`static transformation = true`; they usually have `maxStacks = 1`. They combine freely with
each other and with small upgrades, are listed in their own group in the menu, and are
applied before every small upgrade, so e.g. Big Shield widens both of Stalwart's shields
whatever order they were picked in.

Most Mace transformations work through Drop Slam's fields: `canRise` (Pilot) lets it fly up
to the ceiling, `wraps` (Portaler) sends it through the floor, `phase === 'drop'` is the part
that hits, and `landing` (`{ pos, dir, fallen, tips }`, set when it reaches the floor or
ceiling, until the next slam starts) lets `onAbilityEnd` react to where it came down (Kamikaze,
Devil).

A weapon can hold several shields (`weapon.shields`). Code that adds or replaces shields
should keep that in mind, and a thrown shield sets `shield.away` so it can't block while
it's gone (`weapon.heldShields` skips it).

## Balancing

Runs a batch of headless matches between every pair of weapons, spread across
all CPU cores.

```sh
npm run balance                          # 500 matches per pairing
npm run balance -- 5000                  # more matches, tighter error bars
npm run balance -- -g 2000 -w sword,mace # only some weapons
npm run balance -- -g 1000 --mirror      # include sword vs sword etc.
npm run balance -- -w sword,sword+lifesteal,mace   # fighters with upgrades
npm run balance -- -w sword,sword+damage:3+crit    # :N stacks an upgrade
npm run balance -- -T -g 200             # every transformation vs every other
npm run balance -- --list                # weapon and upgrade ids
npm run balance -- -s 42 --json a.json   # fixed seed: rerun after a tweak and compare
npm run balance -- --csv matches.csv     # one row per match for your own analysis
npm run balance -- --help                # all options
```

It prints:

- **Weapons**: overall win rate with a 95% error margin, flagged `strong`/`weak`
  when it's clearly outside 45–55%, plus HP left on wins, comeback wins and how
  often it lands the first hit.
- **Combat**: damage dealt/taken, DPS, hits, average and max hit, parries,
  shield blocks, ability uses, the share of damage done by abilities and by
  non-weapon sources (thorns, spikes), crits and dodges.
- **Scaling**: average weapon stats at the end of a match vs. at the start.
- **Win matrix** and **Matchups**: every pairing's win rates, match length
  (average, median, p10–p90), and how often the first hit decides the fight.
- **Overall**: snowball factor (first hit -> win), comeback rate, spawn-side bias.

Win rates are red above 55% (60% for a single matchup) and cyan below 45% (40%).
Weapon numbers live in each weapon's file; everything shared lives in `src/config.js`.
