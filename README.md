# Weapon Balls

Balls with spinning weapons bounce around an arena and fight. Every weapon gets
stronger in its own way each time it lands a hit.

## Running

```sh
npm install
npm run dev      # opens a dev server with hot reload
```

Each fighter is a random weapon by default (rerolled every match, never a mirror
match). The menu button in the top right can pin a specific weapon per fighter, add and
remove upgrades per fighter (a Random fighter can only take upgrades that fit any weapon),
and has restart, pause, speed, hitboxes, auto rematch, sound, and fullscreen.

Shortcuts: **Space** pause, **R** restart, **H** hitboxes, **M** mute, **F** fullscreen, **Esc** close menu.

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
    SpearThrow.js      Spear (Olympian): stop, aim, throw the spear, dash after it
    DropSlam.js        Mace: from high up, plunge to the floor; damage grows with the fall
    DashFlurry.js      Daggers: gather both blades, then three rapid dashes
  upgrades/
    Upgrade.js         Base class for roguelike upgrades applied from a loadout
    common.js          Small upgrades any weapon can take
    sword.js, spear.js, daggers.js, mace.js
                       Small upgrades for one weapon
    sword-transformations.js
                       Big upgrades that reshape the Sword (Stalwart, Captain...)
    spear-transformations.js
                       Big upgrades that reshape the Spear (Hoplite, Poseidon...)
    index.js           Registry of upgrades (menu order), plus loadout validation
  game/                Browser-only
    Game.js            Fixed-timestep loop, pause/speed/hitstop, sim events -> effects
    Renderer.js        Draws the arena, balls, weapons, banners
    Effects.js         Particles, floating damage numbers, screen shake
    Sound.js           Sound effects, synthesised with Web Audio (no audio files)
  ui/
    Controls.js        Menu + keyboard shortcuts
    TournamentDisplay.js
                       Display mode (?display): plays matches queued through the match API
server/
  matches.js           Match API: queue matches over HTTP, get results back
  index.js             Serves the built game + the match API (npm start)
  api.d.ts             TypeScript types for programs calling the match API
tools/
  balance.js           Headless batch balance tester (win rates + combat stats)
```

## Match API (tournaments)

Another program (such as the quiz server) can queue matches over HTTP. A
display page plays them live, and each result goes back to that program. The
display page decides the official result, so the recorded winner is always the
one the audience saw. The quiz server in `quiz/` is the reference caller: at the
battle phase it snapshots every team's loadout and runs a round-robin through
this API, one match at a time (see `quiz/README.md`).

```sh
npm run dev                  # API at http://localhost:5173/api, display at http://localhost:5173/?display
npm run build && npm start   # API at http://localhost:3002/api, display at http://localhost:3002/?display (PORT=... to change)
```

Open the display page on the screen everyone watches and leave it open.
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
console.log(done.result); // { winner: 0 | 1 | null, winnerName, reason: 'ko' | 'time', time, hp }
```

| Route | |
| --- | --- |
| `POST /api/matches` | Queue a match: `{ fighters: [a, b], seed?, timeLimit? }`. A fighter is `{ name?, weapon, upgrades? }`, and `team` works in place of `name`. Upgrades can be a list of ids (repeat one to stack it) or an `{ id: count }` object. Returns the match (201), or 400 with `{ error }` when a loadout is invalid. |
| `GET /api/matches/:id` | One match. Add `?wait=1` to hold the request until it is `done` or `cancelled`. |
| `GET /api/matches` | Every match since the server started. |
| `DELETE /api/matches/:id` | Cancel a match that is queued or playing. If it's on screen, it stops. |
| `GET /api/status` | `{ displays, current, queued }`. Check `displays > 0` before waiting on a result. |
| `GET /api/catalog` | Weapon and upgrade ids, names, descriptions, stack limits and requirements, for building menus or offers. |

Matches play one at a time, in the order they were queued. There's a short
pause after each one so the winner banner stays on screen. A match's status
goes `queued` → `playing` → `done`, or ends as `cancelled`. `result.winner` is
an index into `fighters`, or `null` for a draw. A match still going at
`timeLimit` (default 180 sim seconds) is a draw with `reason: 'time'`. A bracket
has to decide what to do with a draw, such as replaying with another seed.

Each match has a seed (random unless you pass one), so every display page shows
the same fight. If the last display disconnects mid-match, the match goes back
to `queued` and restarts from the beginning when a display reconnects. It's the
same seed, so it's the same fight. The server keeps matches in memory only.

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
`src/upgrades/index.js` lists what could be added next.

To add one, write the class in `src/upgrades/common.js` (any weapon) or the
weapon's own file, and add it to `UPGRADES` in `src/upgrades/index.js`:

```js
export class Longsword extends Upgrade {
  static id = 'longsword';
  static displayName = 'Longsword';
  static description = 'Your sword is 25% longer.'; // per copy
  static weapons = ['sword']; // or leave out for any weapon
  static requires = []; // other upgrade ids that must be taken first
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
loadout order, except that transformations go first (see below). Then the ball's HP is
filled to `maxHp`. An upgrade can do any mix of these:

| What                       | How                                                           |
| -------------------------- | ------------------------------------------------------------- |
| Change starting stats      | `apply()`: `this.weapon.blades += 1`, `this.owner.maxHp += 20`, `this.ability.windup *= 0.5` |
| Combat stats               | `weapon.critChance`, `weapon.critMultiplier`, `owner.armor`, `owner.dodgeChance`, `contactDamage` on each of `weapon.shields`, `weapon.widthScale` (draw width, set it with `thickness`) |
| Change behaviour live      | The same modifier getters as abilities. Multipliers multiply together; flags are on if anything turns them on |
| React to things            | `onUpdate`, `onHit(target, sim, damage, point)`, `onParry`, `onOwnerHit(attacker, sim, damage)`, `onBlock(attacker, sim)`, `onWallBounce(sim)`, `onAbilityStart`, `onAbilityEnd` |
| Care where a hit landed    | `critsAt(point)`: return true to make that hit always crit. `damageMultiplierAt(point)`: scale its damage. `point` is on the blade, e.g. `Spear.headHit(point)` tells the head from the shaft |
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
shields stop blocking, and Poseidon's `Impaled` pins the ball to the trident's tip. Extend `Status` (`src/sim/Status.js`), set the modifier
getters (`speedMultiplier`, `damageTakenMultiplier`, `guardBroken`) and/or `onUpdate(dt, sim)`, and draw
it in `draw(ctx)`. A ball holds one status of each class, so applying it again refreshes
it. Guard damage with `sim.over` so nothing ticks after the match is decided.

### Transformations

Transformations are big upgrades that reshape a weapon, like the Sword's Stalwart (a
second shield) or Dual Wielder (the shield becomes a short sword), and the Spear's Poseidon
(a trident that skewers) or Olympian (swaps Charge Dash for Spear Throw). Mark one with
`static transformation = true`; they usually have `maxStacks = 1`. They combine freely with
each other and with small upgrades, are listed in their own group in the menu, and are
applied before every small upgrade, so e.g. Big Shield widens both of Stalwart's shields
whatever order they were picked in.

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
