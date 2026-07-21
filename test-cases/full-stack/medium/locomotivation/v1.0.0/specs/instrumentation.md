# Locomotivation — Debug and automation API

Locomotivation ships a small debugging and automation surface so the game can be
driven and inspected from code, without touching the keyboard or waiting on real
time. It is what you use to iterate on the simulation, reproduce a specific
crossing, write automated checks of the mechanics, and capture clean screenshots of
an exact game state. This file defines that surface. Implement all of it, on the
same footing as the game itself.

Nothing here changes how a person plays. The debug API is inert during normal play,
doing nothing until something calls it, and the debug overlay is off until toggled.

## A deterministic core

The whole surface rests on the simulation being deterministic and steppable, which
the fixed-timestep loop in `specs/controls.md` already requires: a fixed timestep,
integrated in whole steps, decoupled from rendering. Two more properties make it
driveable from code:

- Render-free core. Game state advances by stepping the simulation and must not
  depend on a canvas, on `requestAnimationFrame`, or on wall-clock time to make
  progress. Rendering reads the state, never the other way around.
- Seeded randomness. Any randomness the game uses runs off a seedable generator, so
  reseeding and replaying the same calls reproduces the same result exactly. A build
  with no randomness satisfies this trivially, and the yard is otherwise fully
  deterministic (`specs/trains.md`).

Given the same seed and the same sequence of API calls and steps, the game reaches
the same state every time.

## The manual-clock model

The simulation advances in whole fixed steps of 1/60 of a second (`specs/controls.md`
mandates the rate). During normal play the animation-frame loop drains an accumulator
fed by the wall clock; the debug API can run those same steps directly.

The game holds an `autoStep` flag, `true` by default (normal human play). While
`autoStep` is `true`, the animation-frame loop advances the simulation from the wall
clock as usual. While it is `false`, the loop still renders every frame but does not
advance the simulation on its own: the only thing that advances the sim is an
explicit `step(ticks)` call.

`reset()` and `step()` both set `autoStep = false`, beginning a driver-clocked
session. Because no stray wall-clock frame advances the sim while `autoStep` is
`false`, a stepped scenario is exact and reproducible regardless of machine load.
`setAutoStep(true)` lets the game advance itself in real time again, for watching or
recording a live clip; `setAutoStep(false)` returns to manual, and `reset()`
re-arms manual. Injecting keyboard input does not change `autoStep`.

This is an ordinary manual-step-versus-run-live debugging affordance: step the sim
by hand to measure something exactly, or let it run live to watch it move.

## The `window.__loco` object

Expose the API as a single object on the global `window.__loco`, installed once the
game is running. It carries a `version` number (use `1`) and the operations below.
Values are plain numbers, strings, and booleans so a caller can read them directly;
coordinates are in the logical-pixel space of `specs/overview.md`, tile coordinates
are the `(col, row)` of `specs/world.md`, and times are in seconds. The one
exception is `step`, which advances the simulation in whole ticks rather than
seconds, so that stepping is exact; every time a caller reads or poses (the shift
clock, `simTime`, sprint charge) is still in seconds.

### Core operations

- `reset(options)` returns the game to its initial title state and re-arms manual
  stepping. `options` is optional, and `options.seed` (a number) seeds all of the
  game's randomness so a scenario replays identically.
- `step(ticks)` advances the simulation by exactly `ticks` fixed steps immediately,
  running the fixed-timestep update internally rather than waiting for real frames.
  The unit is whole simulation ticks, not seconds: the timestep is 60 Hz, so one
  tick is 1/60 of a second, `step(1)` runs a single simulation step and `step(60)`
  advances one second of game time. Nothing is rounded or approximated — the number
  of steps asked for is the number of steps run. `ticks` must be a non-negative
  integer; `step(0)` is legal and does nothing, while a fractional or negative value
  is invalid and the call fails loudly rather than guessing what was meant. This
  runs the real simulation forward from a set-up state to see where it lands.
  Stepping only advances a live level (a shift in progress, including the death beat
  and a last-train ride); it has no effect on a menu screen.
- `snapshot()` returns a plain, JSON-serializable object describing the current game
  state (see [Snapshot shape](#snapshot-shape)). It is a pure read and never changes
  anything.

### Control operations

These set up a specific situation. Each one routes through the same systems normal
play uses, arranging the world rather than faking outcomes: after arranging a
scenario, `step()` runs the real movement, trains, cargo, collision, clock, and
win/fail code forward, and `snapshot()` (or the rendered canvas) reads the result.

- `startLevel(n)` enters campaign level `n` (1-based, `1..6`), exactly as choosing
  it from the level-select menu would, unlocking it if needed. The level opens live
  (the shift running) at its spawn with a full clock and three lives.
- `setWorker(state)` poses the worker. `state` may set its position as `col` and
  `row` (a tile) or as `x` and `y` (pixels), and/or its `facing` (`"down"`, `"up"`,
  `"left"`, `"right"`). The worker is placed through the same position the movement
  and collision systems read, and it stays there until movement input or another
  call moves it.
- `setClock(seconds)` sets the shift clock remaining, as a precondition; the real
  win and fail rules still resolve through play.
- `setLives(n)` sets the remaining lives, as a precondition.
- `setDelivered(color, count)` sets the delivered count toward the quota for a color
  (`"red"`, `"blue"`, `"green"`, `"amber"`), as a precondition for a partial-progress
  scenario; the real quota-satisfied and win rules still decide completion, so drive
  a real delivery to cross a threshold.
- `markUnique(id, delivered)` sets a unique package's delivered flag, as a
  precondition on a level with several uniques so a scenario can pre-satisfy the
  others. To exercise the delivery rule itself, deliver a unique for real by
  carrying it into its zone.
- `givePackage(spec)` puts a package directly into the worker's carried set as a
  precondition, arranging a carried load for a scenario. `spec` is
  `{ color, weightClass, archetype }` where `weightClass` is `"parcel"`, `"crate"`,
  or `"load"` and `archetype` is `"unique"`, `"dispenser"`, or `"optional"`
  (defaulting to `"dispenser"`). The real speed model, delivery, drop, and
  death-drop then run forward from the carried set. To exercise the pickup rule
  itself, pick a package up for real at a dispenser or a ground package.
- `clearCarried()` empties the worker's carried set, as a precondition reset.
- `spawnGroundPackage(spec)` places a package resting on a tile, as a precondition.
  `spec` is `{ col, row, color, weightClass, archetype }` (archetype defaulting to
  `"optional"`). It joins the same ground cargo the world holds, so it is picked up,
  or destroyed by a train passing over its tile, exactly as any resting package.
- `spawnTrain(spec)` puts a train onto a lane now, as a precondition, so a scenario
  faces a train at a chosen position without waiting out a schedule. `spec` is
  `{ line, orientation, dir, kind, headPos, isLast, consist }`: `orientation` is
  `"horizontal"` or `"vertical"`, `line` is the row (horizontal) or column
  (vertical) the body runs along, `dir` is `"east"`, `"west"`, `"south"`, or
  `"north"`, `kind` is `"freight"`, `"commuter"`, or `"bullet"` (which fixes its
  speed and default length), and `headPos` is the leading edge's distance in pixels
  from the entry edge (default `0`). For a last train set `isLast` true and give a
  `consist` (front-to-back array of `"engine"`, `"boxcar"`, `"flat-top"`,
  `"flat-top-half"`); the spawned train then advances and resolves collisions
  through the real train code.
- `forceLastTrain()` brings the level's derived last train on now (sets its spawn
  time to the current sim time), so a scenario need not wait for the clock to reach
  its derived window. It spawns and runs through the real last-train path.

A typical check calls `startLevel(3)`, poses the worker with `setWorker`, arranges a
train with `spawnTrain` or a load with `givePackage`, `step()`s a handful of ticks
to run the real systems, and reads the result from `snapshot()`.

### Input operations

The control operations above pose the world directly. The API can also inject
keyboard input, so a caller can drive the game the way a player does: navigate the
menus, start a level, move and sprint the worker by holding keys, pick up, drop,
throw a lever, pause, and toggle mute. Injected input flows through the same
handling the real keyboard feeds, exercising the actual key bindings from
`specs/controls.md` rather than a parallel path. A held movement key moves the
worker through the game's normal play code, so this is how a caller confirms the
controls themselves work.

- `keyDown(code)` presses a key down. `code` is a standard `KeyboardEvent.code`, for
  example `"KeyW"`, `"KeyA"`, `"KeyS"`, `"KeyD"`, `"ArrowUp"`, `"ArrowDown"`,
  `"ArrowLeft"`, `"ArrowRight"`, `"ShiftLeft"`, `"KeyE"`, `"Space"`, `"KeyQ"`,
  `"Escape"`, `"KeyM"`, or `"Enter"`. The key becomes held, so a movement or sprint
  key drives the worker while it is held and the simulation is stepped, and any
  one-shot action the key triggers on the current screen (a menu move, a confirm, a
  pick-up, a drop, a lever throw, a pause, a mute toggle) is applied immediately.
- `keyUp(code)` releases a previously pressed key, ending its held state.
- `press(code)` is a convenience tap, a `keyDown` immediately followed by a `keyUp`.
  This is the usual way to trigger a one-shot action (moving a menu selection,
  confirming it, picking up, dropping, throwing a lever, pausing, muting) without
  leaving the key held.

The usual shape for an input-driven scenario is to `press` through the menu into a
level, then `keyDown` a movement key and `step` (or let real time pass) so the
worker moves, then `keyUp` to release it, reading `snapshot()` to see where the
worker and the world ended up.

### Run-live control

- `setAutoStep(enabled)` runs the game live again when `true` (the sim advances from
  the wall clock, for watching or recording motion) and returns to manual stepping
  when `false`. See [The manual-clock model](#the-manual-clock-model). A `reset()`
  re-arms manual.

## Snapshot shape

`snapshot()` returns an object with at least these fields. `level`, `worker`, and
the world arrays describe the live level and are present while a level is loaded
(`playing`, `pause`, or a result screen); on the pure menus (`title`,
`level-select`, `how-to-play`) `level` and `worker` are `null` and the world arrays
are empty.

```js
{
  version: 1,
  screen: "title" | "level-select" | "how-to-play" | "playing" | "pause" |
          "level-complete" | "level-failed" | "victory",
  phase: "playing" | "dying" | "respawning" | "won" | "lost" | "boarding" | null,
  muted: <boolean>,       // whether the mute toggle is currently on
  autoStep: <boolean>,    // false while driver-clocked, true while running live
  simTime: <number>,      // accumulated simulation time for this level, in seconds

  // Campaign progression (always present).
  campaign: {
    levelCount: <number>,        // 6
    unlocked: <number>,          // highest unlocked level index (0-based)
    bestScores: [<number>, ...], // best score per completed level, by index
  },

  // The live level, or null on a pure menu.
  level: {
    index: <number>,   // 0-based
    number: <number>,  // 1-based
    name: <string>,
    clock: <number>,   // shift seconds remaining
    lives: <number>,
    quotaMet: <boolean>,
    failReason: "out-of-time" | "out-of-lives" | "unique-lost" | null,
    score: <number>,
    scoreParts: { required, optional, nearMiss, lastTrain, time, lives },
    nearMisses: <number>,
    optionalsDelivered: <number>,
  },

  // The worker, or null on a pure menu.
  worker: {
    x: <number>, y: <number>,
    facing: "down" | "up" | "left" | "right",
    anim: "idle" | "walk" | "sprint" | "carry" | "drop" | "squish",
    moving: <boolean>,
    sprinting: <boolean>,
    sprintCharge: <number>,    // seconds of sprint remaining, 0..SPRINT_MAX
    sprintLocked: <boolean>,   // load over the sprint threshold
    load: <number>,            // carried weight in capacity units
    loadFraction: <number>,    // load / W_max
    speed: <number>,           // current walk/sprint speed, px/s
    carried: [ { color, weightClass, archetype } ],  // in pickup order
  },

  // Live trains, each with its body box in stage pixels for collision/geometry reads.
  trains: [
    { trackId: <string>, kind: "freight" | "commuter" | "bullet",
      orientation: "horizontal" | "vertical",
      dir: "east" | "west" | "south" | "north",
      line: <number>, headPos: <number>, length: <number>, speed: <number>,
      isLast: <boolean>,
      box: { x0, y0, x1, y1 },
      // `consist` is present on the last train only.
      consist: [ "engine" | "boxcar" | "flat-top" | "flat-top-half", ... ],
    },
  ],

  // Resting cargo in the world (fixed uniques/optionals and dropped packages).
  ground: [ { color, weightClass, archetype, col, row, x, y } ],

  dispensers: [ { id, color, weightClass, ready: <boolean>, col, row } ],
  dropZones:  [ { id, color, col, row } ],
  levers:     [ { id, thrown: <boolean>, col, row } ],
  signals:    [ { id, state: "clear" | "warning" | "danger", col, row } ],

  // Required-quota progress and the uniques' status.
  quota:   [ { color, required, delivered } ],
  uniques: [ { id, color, delivered: <boolean>, lost: <boolean> } ],
}
```

`box` is the train's full body as an axis-aligned box in stage pixels, the same
geometry the lethal-overlap test uses, so a check can confirm a hit or a near-miss.
`speed` on the worker is its current walk or sprint speed after the weight model, so
a caller that poses a load can read the resulting speed directly. `sprintLocked`
reflects the load threshold, and `muted` reflects the mute toggle, so a caller that
presses the mute key can confirm it took effect.

## The debug overlay

Provide a read-only on-screen overlay showing the game's live internal state, so you
can watch what the simulation is doing while you play. It is toggled with the
backtick key (`` ` ``), off by default, and never changes gameplay; it only draws.

When on, it draws over the running game, legibly, in the game's monospace type, at
least: the current `screen` and `phase`, the shift `clock` and `lives`, the worker's
position, facing, animation, load and load fraction, sprint charge and whether
sprint is locked, and its carried packages; each live train's kind, line, and
leading-edge position; each signal's state; and the quota progress with each
unique's status. These are the same facts `snapshot()` reports. It is a diagnostic
layer rather than part of the game's presentation, so keep it visually plain and
clearly separate from the HUD.
