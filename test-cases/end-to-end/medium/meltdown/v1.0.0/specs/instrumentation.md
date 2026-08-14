# Meltdown — Debug and automation API

Meltdown ships a small debugging and automation surface so the game can be driven and
inspected from code, without touching the mouse or keyboard or waiting on real time.
It is what you use to iterate on the heat model and the pathing, reproduce a specific
thermal situation or siege, script a scenario, and capture clean
screenshots of an exact game state. This file defines that surface. Implement all of
it, on the same footing as the game itself.

Nothing here changes how a person plays. The debug API is inert during normal play,
doing nothing until something calls it, and the debug overlay is off until toggled.

## A deterministic core

The whole surface rests on the simulation being deterministic and steppable, which the
simulation model in `specs/gameplay.md` already requires: a fixed timestep, integrated
in whole steps, decoupled from rendering. Two properties make it drivable from code:

- Render-free core. Game state advances by stepping the simulation and must not depend
  on a canvas, on `requestAnimationFrame`, or on wall-clock time to make progress.
  The dependency runs one way: the simulation never reads from, waits on, or is
  driven by the renderer.
- Seeded randomness. Any randomness the game uses (which vent each unit of a wave
  enters from, the spawn timing jitter within a wave, and any variation the special
  modes introduce) runs off a seedable generator, so reseeding and replaying the same
  calls reproduces the same result exactly.

Given the same seed and the same sequence of API calls and steps, the game reaches the
same state every time.

The game advances on a fixed timestep — 60 Hz, so one step is exactly 1/60 of a
second of game time (`specs/gameplay.md`) — that the animation loop normally supplies
from the wall clock, so it plays in real time for a person at the keyboard. The debug
API can drive that timestep manually instead: `step(ticks)` advances the simulation by
exactly that many fixed steps, and `reset()` and `step()` switch the game to manual
stepping so the wall clock stops feeding it. From there `step()` is the only thing that
moves the simulation, and a scripted scenario is exact and reproducible whatever else
the machine is doing. `setAutoStep(true)` hands the clock back to the animation loop so
the game runs in real time again, which is handy for watching a scenario play out or
recording a motion clip.

## The `window.__meltdown` object

Expose the API as a single object on the global `window.__meltdown`, installed once the
game is running. It carries a `version` number (use `1`) and the operations below.
Values are plain numbers, strings, and booleans so a caller can read them directly.

Positions come in two forms this API uses consistently:

- A tile is a grid cell, identified by its column `col` (`0..49`) and row `row`
  (`0..35`), the tile grid of `specs/playfield.md`. A tower footprint is named by its
  top-left tile `(col, row)`.
- A pixel position is a logical-pixel coordinate on the 1280 x 720 stage
  (`specs/overview.md`), so a tile `(col, row)` has its center at
  `(18 + 19*col + 9.5, 18 + 19*row + 9.5)`.

A tower rotation is one of `0`, `1`, `2`, `3`, a count of 90-degree clockwise steps
applied to the tower's local radiator layout (`0` is un-rotated, local `N -> E -> S ->
W`; `specs/heat.md`). A tower type is one of `"arc"`, `"stutter"`, `"rime"`, `"flak"`,
`"bloom"`, `"lance"`, `"forge"`, `"sink"` (`specs/towers.md`). A surge type is one of
`"mote"`, `"sprint"`, `"hulk"`, `"swarm"`, `"drift"`, `"core"` (`specs/surge.md`). A
vent is `"left"` or `"top"`; an exhaust is `"right"` or `"bottom"` (`specs/playfield.md`).

### Core operations

- `reset(options)` returns the game to its initial title state. `options` is optional,
  and `options.seed` (a number) seeds all of the game's randomness so a scenario
  replays identically.
- `step(ticks)` advances the simulation by exactly `ticks` fixed steps immediately,
  running the fixed-timestep update internally rather than waiting for real frames.
  The unit is whole simulation ticks, not seconds: the timestep is 60 Hz, so one tick
  is 1/60 of a second, `step(1)` runs a single simulation step and `step(60)` advances
  one second of game time. Nothing is rounded or approximated — the number of steps
  asked for is the number of steps run. `ticks` must be a non-negative integer;
  `step(0)` is legal and does nothing, while a fractional or negative value is invalid
  and the call fails loudly rather than guessing what was meant. This runs the real
  simulation forward from a set-up state to see where it lands, advancing firing, heat,
  cooling, conduction, movers, surge movement, pathing, and the build-phase and wave
  timers. Stepping only advances the live game; it has no effect on a menu screen.
  Calling `step` (or `reset`) also switches the game to manual stepping, so the
  animation loop stops advancing the sim from the wall clock and successive steps
  advance the simulation by exactly the number of ticks asked for, with no stray
  wall-clock frames creeping in between calls.
- `snapshot()` returns a plain, JSON-serializable object describing the current game
  state (see [Snapshot shape](#snapshot-shape)). It is a pure read and never changes
  anything.
- `setAutoStep(enabled)` chooses who advances the clock. `setAutoStep(true)` hands the
  clock back to the animation loop so the game runs itself in real time again (for
  watching a posed scenario play out, or recording a live motion clip);
  `setAutoStep(false)` returns to manual stepping via `step`. `reset` and `step`
  already switch to manual on their own, so this is only needed to go back to real
  time. It never changes any game state, only which clock drives it.

### Control operations

These set up a specific situation. Each one routes through the same systems normal play
uses, arranging the world rather than faking outcomes: they start a game, adjust the
resources and the wave clock, build and manage towers through the real placement,
upgrade, and sell code, set a tower's heat as a starting point, and spawn surge into
the real pathing and combat systems. From there `step` runs the real firing, heat,
cooling, movement, pathing, and scoring forward.

- `startGame(mode, difficulty)` begins a fresh game, exactly as choosing it from the
  menus would: it opens on the untimed opening build phase. `mode` is `"containment"`,
  `"hundred"`, `"deeppockets"`, `"bottleneck"`, or `"suddendeath"` (`specs/modes.md`).
  `difficulty` is `"easy"`, `"medium"`, or `"hard"` and applies to Containment; the
  special modes ignore it. The starting money, lives, and wave count are set by the
  chosen mode and difficulty, exactly as a real start.
- `setMoney(amount)` sets the current money, a precondition for affording a layout;
  spending and refunds still resolve through the real economy.
- `setLives(count)` sets the lives remaining, a precondition for driving toward a loss
  or a win.
- `setWave(n)` sets the current wave and rebuilds the run to wave `n`'s build phase, the
  one preceding its release (its money, lives, and progression as they would stand
  entering that wave), a precondition for exercising a deep wave, a milestone wave, or
  the per-wave HP scaling without playing through every wave by hand. A snapshot taken
  there reports `wave: n`, since a build phase belongs to the wave it is preparing for
  (`specs/gameplay.md`).
- `setBuildTimer(seconds)` sets the between-wave build-phase countdown, so a scenario
  can drive it toward auto-start or measure the early-send bonus at a known time left.
  It applies only during a timed build phase, not the untimed opening phase.
- `startWave()` releases the next wave now, exactly as pressing Start (in the opening
  phase) or Send next wave (between waves) would, spawning it through the real wave
  spawner and claiming any early-send bonus.
- `armTower(type)` arms placement mode for a tower `type`, exactly as clicking its shop
  entry does. The held preview follows `movePreview` from there.
- `movePreview(col, row)` moves the held preview so its footprint's top-left sits at
  tile `(col, row)`, exactly as moving the mouse over the floor does. The preview's
  valid/invalid state updates through the real placement check.
- `rotatePreview()` rotates the held preview 90 degrees, exactly as the rotate control
  does, turning its radiator faces (`specs/heat.md`). Placement mode only.
- `place()` commits the held preview at its current footprint if it is valid, exactly
  as a left-click does: it deducts the cost, blocks the footprint tiles, and re-paths
  the surge. If the footprint is invalid it builds nothing. Placement stays armed
  afterward, as in normal play.
- `placeTower(type, col, row, rotation)` is a shorthand for arming `type`, rotating it
  to `rotation`, moving the preview to `(col, row)`, and placing it, all through the
  same placement code above. It is the quick way to lay out a floor for a scenario. It
  builds nothing if the footprint is invalid.
- `canPlace(type, col, row, rotation)` returns whether a `type` tower with that
  rotation could be placed with its footprint top-left at `(col, row)` right now,
  through the real placement check (on the grid, unoccupied, affordable, within any
  mode build zone, and not sealing the floor; `specs/playfield.md`, `specs/modes.md`). A
  pure read that builds nothing.
- `selectTower(id)` selects the placed tower with that `id`, exactly as clicking it
  does, opening its inspector. `null` deselects.
- `upgradeTower(id)` upgrades that tower one level through the real upgrade code
  (deducting its cost; `specs/towers.md`).
- `sellTower(id)` sells that tower through the real sell code, refunding it, reopening
  its footprint, and re-pathing the surge (`specs/towers.md`).
- `hoverShop(type)` sets the shop tower currently hovered, so the inspector area shows
  that type's info panel (`specs/playfield.md`); `null` clears the hover.
- `setHeat(id, H)` sets the current heat `H` (`0..100`) of the placed emitter with that
  `id`, a precondition for reproducing a thermal situation without waiting for it to
  build up. The real damage, trip, cooling, conduction, and slow systems act on that
  heat from the next step, so the outcome read back is still the game's own.
- `spawnUnit(type, vent)` spawns one real surge unit of `type` at `vent`, entering it
  into the same pathing and combat systems a wave spawn uses, and returns its `id`. Its
  assigned exhaust is that vent's fixed opposite (`specs/playfield.md`). Use it to drive a
  single unit through the maze, past a tower, or into an exhaust without composing a
  whole wave.

A typical check calls `startGame("containment", "medium")`, `placeTower` to lay a small
maze, `setMoney`/`setHeat` to set up the money or heat it wants, `spawnUnit` (or
`startWave`), `step()` a few dozen ticks to run the real systems, and reads the result
from `snapshot()`.

Note that `step` is the only operation counted in ticks. The durations this API poses
and reports are still seconds — `setBuildTimer(seconds)`, a snapshot's `buildTimer`,
`tripTimer`, and `simTime` — because they are game-facing quantities a player sees,
not amounts of stepping.

### Input operations

The control operations above pose the world directly. The API can also inject keyboard
input, so a caller can drive the game the way a player does with the keyboard
accelerators: navigate the menus, arm a shop tower, rotate the held preview, send a
wave, toggle speed, pause, and toggle mute. Injected input flows through the same
handling the real keyboard feeds, exercising the actual key bindings from
`specs/controls.md` rather than a parallel path. Injecting input does not take control
away from normal play, so this is how a caller confirms the controls themselves work.

- `keyDown(code)` presses a key down. `code` is a standard `KeyboardEvent.code` (for
  example `"Digit1"` through `"Digit8"`, `"KeyR"`, `"KeyF"`, `"KeyU"`, `"KeyS"`,
  `"KeyM"`, `"KeyP"`, `"Space"`, `"Enter"`, `"Escape"`, and the arrow keys). The key
  becomes held, and any one-shot action the key triggers on the current screen (a menu
  move, a confirm, arming a tower, rotating the preview, sending a wave, a speed
  toggle, a pause, a mute toggle) is applied immediately.
- `keyUp(code)` releases a previously pressed key, ending its held state.
- `press(code)` is a convenience tap, a `keyDown` immediately followed by `keyUp`. This
  is the usual way to trigger a one-shot action without leaving the key held.

The usual shape for an input-driven scenario is to `press` through the menu to start a
game, then `press` a hotkey (arm a tower, rotate, send the wave, pause, mute) and read
`snapshot()` to see the effect.

## Snapshot shape

`snapshot()` returns an object with at least these fields:

```js
{
  version: 1,
  screen: "title" | "modeselect" | "difficultyselect" | "howto"
        | "playing" | "paused" | "victory" | "gameover",
  phase: "opening" | "building" | "wave",  // the sub-phase while playing
  mode: "containment" | "hundred" | "deeppockets" | "bottleneck" | "suddendeath" | null,
  difficulty: "easy" | "medium" | "hard" | null,  // for Containment; null otherwise
  money: <number>,
  lives: <number>,
  score: <number>,
  wave: <number>,          // the wave this phase belongs to, incl. a build phase's
                           // coming wave (`specs/gameplay.md`); 0 outside a match
  waveCount: <number>,     // total waves N for this mode/difficulty
  buildTimer: <number> | null,  // between-wave countdown seconds; null otherwise
  wavePreview: [ <surgeType>, ... ] | null,  // coming wave's types, else null
  waveRemaining: <number>, // surge units of the current wave not yet dead or leaked
  muted: <boolean>,        // whether the mute toggle is currently on
  speed: 1 | 2,            // the game-speed toggle
  menuIndex: <number>,     // the highlighted item on a menu screen
  selected: <number> | null,   // id of the selected placed tower, or null
  hoverShop: <towerType> | null,  // the shop tower currently hovered, or null
  build: {                 // the held-preview state while placement is armed, else null
    type: <towerType>,
    col: <number>, row: <number>,   // the preview footprint's top-left tile
    rotation: 0 | 1 | 2 | 3,
    valid: <boolean>,      // whether the current footprint could be placed
  } | null,
  paths: {
    // Shortest open route length in tiles from each vent to its opposite exhaust,
    // recomputed live as the floor changes. Never null in valid play (the floor
    // can never be sealed), so a wall that lengthens a route shows up here.
    left: { length: <number> },   // left vent to right exhaust
    top:  { length: <number> },   // top vent to bottom exhaust
  },
  towers: [
    {
      id: <number>,
      type: <towerType>,
      col: <number>, row: <number>,   // footprint top-left tile
      size: 2 | 3 | 4,
      rotation: 0 | 1 | 2 | 3,
      level: 1 | 2 | 3,
      heat: <number>,        // 0..100 (0 for the Forge and Sink, which have no heat)
      redline: <number>,     // the tower's redline R
      heatMult: <number>,    // live heat damage multiplier (0.35..3.5; 0 for movers/Rime)
      damage: <number>,      // per-shot damage (baseDamage*heatMult; 0 movers/Rime)
      slowFactor: <number>,  // the Rime's live slow fraction (0..slowCeil); 0 otherwise
      tripped: <boolean>,    // whether it is offline in its trip cooldown
      tripTimer: <number>,   // seconds left on the trip cooldown, else 0
      firing: <boolean>,     // whether it has a target and is firing this step; always
                             // false while `tripped`, including the step that tripped it
      radiatorFaces: [ "N" | "E" | "S" | "W", ... ],  // radiator faces, world-oriented
      kills: <number>,       // lifetime kills by this tower
      damageDealt: <number>, // lifetime total damage by this tower
    },
  ],
  surge: [
    {
      id: <number>,
      type: <surgeType>,
      x: <number>, y: <number>,   // logical-pixel position of the unit
      col: <number>, row: <number>,  // its current tile (ground units)
      hp: <number>, maxHp: <number>,
      speed: <number>,       // its current speed in px/s, reflecting any active slow
      baseSpeed: <number>,   // its unslowed speed at this wave
      slowed: <boolean>,     // whether a slow is currently applied
      flying: <boolean>,     // true for a Drift flyer
      vent: "left" | "top",
      exhaust: "right" | "bottom",  // its fixed assigned exhaust
    },
  ],
  simTime: <number>,         // accumulated simulation time, in seconds
}
```

A tower's `radiatorFaces` are reported in world orientation, so it reports
which faces point at the open lane after the tower's placement rotation. `heat`,
`heatMult`, `damage`, and `tripped` are the same values the inspector and the
on-footprint heat read show. A surge unit's `speed` drops below its `baseSpeed` while a
Rime slow is on it, and a Core reports `slowed: false` because it is immune to slowing.

## The debug overlay

Provide a read-only on-screen overlay showing the game's live internal state, so you
can watch what the simulation is doing while you play. It is toggled with the backtick
key (`` ` ``), off by default, and never changes gameplay; it only draws.

When on, it draws over the running game, legibly, in the game's monospace type, at
least: the current `screen` and `phase`, the mode and difficulty, the money, lives,
wave, and score, and for each tower its type, heat, redline, whether it is tripped, and
its lifetime kills, and for each surge unit its type, tile, hp, and whether it is
slowed, the same facts `snapshot()` reports. It is a diagnostic layer rather than part
of the game's presentation, so keep it visually plain and clearly separate from the
HUD.
