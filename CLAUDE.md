# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Weapon Balls: balls with spinning weapons bounce around an arena and fight. Vanilla JS (ES modules) + Canvas 2D, bundled with Vite. No framework, no runtime dependencies. README.md covers the file layout and the step-by-step for adding weapons/abilities; read it before adding content.

## Commands

```sh
npm run dev                              # Vite dev server with hot reload
npm run build                            # production build to dist/
npm run balance                          # headless balance run, 500 matches per pairing
npm run balance -- -g 2000 -w sword,mace # subset of weapons, more matches
npm run balance -- -s 42 --json a.json   # fixed seed; rerun after a tweak and compare
npm run balance -- --help
```

There are no tests or linter. The balance script is the main way to verify gameplay changes: run it with a fixed seed before and after a tuning change. Win rates outside 45–55% (weapon) or 40–60% (single matchup) are flagged.

## Architecture

**`src/sim/` is pure and headless.** It must not touch the DOM, `window`, or audio. `tools/balance.js` imports `Simulation` and the weapon registry directly and runs it in Node worker threads. Anything browser-only goes in `src/game/` or `src/ui/`. Weapon and ability `draw*` methods only receive a `ctx` and are never called by the sim, so they're fine.

**Randomness must go through `Math.random`.** The balance tool makes matches reproducible by replacing `Math.random` with a seeded PRNG (mulberry32) per match. Don't introduce another RNG source inside sim/weapons/abilities.

**Fixed timestep.** `Game` steps the sim at `CONFIG.physicsHz` (120 Hz) with an accumulator; the balance tool steps with the same `dt`. Hitstop, screen shake, particles and sound live only in `Game`/`Effects`/`Sound`, never in the sim, so they don't affect outcomes.

**Sim → presentation is one-way, via events.** `Simulation` calls `onEvent(type, data)` for `hit`, `parry`, `block`, `death`, `end`, and `ability` (the event list is documented at the top of `Simulation.js`). Two consumers exist and both may need updating when an event changes: `Game.handleSimEvent` (effects + sound) and the `onEvent` in `tools/balance.js` (stats).

**Combat resolution order each step** (`Simulation.resolveCombat`): weapon-vs-weapon clashes → weapons touching a shield → weapon-vs-ball hits. Any weapon touching another weapon or a shield is blocked for that step and cannot hit. A parry only fires if both weapons pass `canParry`; a shield block only needs the attacker's. `unblockable` weapons skip both checks. Per-target hit cooldowns are keyed by weapon (`Ball.hitCooldowns`), which is why multi-hit abilities call `target.clearHitCooldown(weapon)`.

**Weapons** (`src/weapons/`) are one or more straight blade segments spinning around the ball; hitboxes are capsules (`thickness` is half-width). Stats (`damage`, `spinSpeed`, `length`, ...) are per-instance and mutated in `onHit`/`onParry` for scaling. A weapon may also carry a `Shield` (see `Sword.js`). Register new weapons in `src/weapons/index.js`; the UI and balance tool pick them up from `WEAPONS`.

**Abilities** (`src/abilities/`) modify behaviour only through getters (`spinMultiplier`, `damageMultiplier`, `knockbackMultiplier`, `controlsMovement`, `unblockable`, `unstoppable`, `bladeSpread`). `Weapon` proxies these to the engine. A new kind of modifier means adding the getter to `Ability`, a proxy on `Weapon`, and reading it wherever the engine needs it (`Ball`, `collisions.js`, `Simulation`). Multi-phase abilities track `this.phase` and must call `this.end(sim)` themselves to start the cooldown. `ChargeDash.js` is the fullest example.

**Sound is keyed by string ids.** `Sound.ability(phase)` switches on the phase name passed to `Ability.emit` (`swipe`, `charge`, `dash`, `slam`), and `Sound.hit` checks weapon `id` against a `BLUNT` set. New abilities or weapons with their own sound need a matching case in `src/game/Sound.js`.

**Tuning lives in two places:** shared numbers (arena, ball speed/HP, knockback, cooldowns, hitstop) in `src/config.js`; weapon- and ability-specific numbers as constants or constructor stats in each weapon/ability file.
