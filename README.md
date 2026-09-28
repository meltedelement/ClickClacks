# Weapon Balls

Balls with spinning weapons bounce around an arena and fight. Every weapon gets
stronger in its own way each time it lands a hit.

## Running

```sh
npm install
npm run dev      # opens a dev server with hot reload
```

The menu button in the top right picks the matchup and has restart, pause, speed,
hitboxes, auto rematch, and fullscreen.

Shortcuts: **Space** pause, **R** restart, **H** hitboxes, **F** fullscreen, **Esc** close menu.

## Project layout

```
src/
  config.js            Global tuning: arena size, ball speed/HP, knockback, hitstop
  main.js              Entry point, wires Game + Controls together
  styles.css
  sim/                 Pure match logic, no DOM. Runs in the browser or in Node.
    Simulation.js      Spawning, the step loop, hits/parries/winner, emits events
    Ball.js            Movement, HP, hit cooldowns, drawing the ball
    collisions.js      Wall bounce, ball-vs-ball, weapon-vs-ball, weapon-vs-weapon
    math.js            Vector + segment geometry helpers
  weapons/
    Weapon.js          Base class every weapon extends
    Sword.js, Spear.js One file per weapon: stats, scaling, and how it's drawn
    index.js           Registry of selectable weapons
  abilities/
    Ability.js         Base class for special moves on a cooldown
    SpinSwipe.js       Sword: one rapid full spin for bonus damage
    ChargeDash.js      Spear: stop, aim, lunge for bonus damage
  game/                Browser-only
    Game.js            Fixed-timestep loop, pause/speed/hitstop, sim events -> effects
    Renderer.js        Draws the arena, balls, weapons, banners
    Effects.js         Particles, floating damage numbers, screen shake
  ui/
    Controls.js        Menu + keyboard shortcuts
tools/
  balance.js           Headless win-rate tester
```

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

Hooks: `shouldActivate`, `onStart`, `onUpdate`, `onEnd`, `onHit`, `onParry`,
`onOwnerHit` (the ability's ball got hit), and `draw(ctx)` for visuals, which are drawn
underneath the balls. `nearestEnemy(sim)` is a handy helper for targeting.
`ChargeDash.js` is the most complete example, with multiple phases, aiming,
movement control, and cancelling.

## Balancing

```sh
npm run balance        # 500 matches per pairing
npm run balance 2000   # more matches, more accurate
```

Prints win rates, draws, average fight length, and how much HP winners have left.
Weapon numbers live in each weapon's file; everything shared lives in `src/config.js`.
