# Valence — Debug and automation API

Valence ships a small debugging and automation surface so the game can be driven
and inspected from code, without touching the mouse or keyboard or waiting on
real time. It is what you use to iterate on the simulation, reproduce a specific
round or a specific unit's decomposition, script a scenario, and capture clean
screenshots of an exact game state. This file
defines that surface. Implement all of it, on the same footing as the game
itself.

Nothing here changes how a person plays. The debug API is inert during normal
play, doing nothing until something calls it, and the debug overlay is off until
toggled.

## A deterministic core

The whole surface rests on the simulation being deterministic and steppable,
which the tick loop in `specs/controls.md` already requires: a fixed timestep,
integrated in whole steps, decoupled from rendering. Two more properties make it
driveable from code:

- Render-free core. Game state advances by stepping the simulation and must not
  depend on a canvas, on `requestAnimationFrame`, or on wall-clock time to make
  progress. Rendering reads the state, never the other way around.
- Seeded randomness. Any randomness the game uses (the scatter of a particle
  burst, for instance) runs off a seedable generator, so reseeding and replaying
  the same calls reproduces the same result exactly. A round's composition, its
  spawn timing, and the path each unit is assigned are fixed by the round table
  (`specs/matter.md`) and are not random.

Given the same seed and the same sequence of API calls and steps, the game
reaches the same state every time.

## The manual clock

The tick loop advances the simulation in whole fixed steps — the 60 Hz tick of
`specs/controls.md`, so one tick is exactly 1/60 of a second of game time.
During normal play the animation-frame loop decides how many ticks to run from
the wall clock (scaled by the game speed), so the game runs itself. The debug
API can drive those ticks directly instead, which is what makes a scripted
scenario exact regardless of machine load.

The game holds an `autoStep` flag, `true` during normal human play. The
animation-frame loop advances the simulation only while `autoStep` is `true`;
while it is `false` the game still renders every frame but does not advance the
simulation on its own.

- `reset()` and `step()` set `autoStep = false`, beginning a driver-clocked
  session. While it is `false`, `step(ticks)` is the only thing that advances
  the simulation, so a stepped scenario is reproducible no matter what else the
  machine is doing; no stray wall-clock frame can pollute a measurement.
- `setAutoStep(true)` hands the clock back to the animation-frame loop so the
  game advances itself in real time again, which is what you want when watching
  or recording a live motion clip. `setAutoStep(false)` returns to manual
  stepping. `reset()` re-arms manual stepping.
- The other operations below (the control and input operations) do not change
  `autoStep`.

While the game is paused (the in-place pause or the pause menu,
`specs/controls.md`) the ticks are frozen, so `step(ticks)` advances nothing
until the game is resumed. This is the same freeze normal play applies; the
manual clock does not bypass it.

## The `window.__valence` object

Expose the API as a single object on the global `window.__valence`, installed
once the game is running. It carries a `version` number (use `1`) and the
operations below. Values are plain numbers, strings, and booleans so a caller
can read them directly; coordinates, sizes, and ranges are in the logical-pixel
space of `specs/overview.md`.

### Core operations

- `reset(options)` returns the game to its initial title state. `options` is
  optional, and `options.seed` (a number) seeds all of the game's randomness so
  a scenario replays identically. `reset` re-arms manual stepping
  (`autoStep = false`).
- `step(ticks)` advances the simulation by exactly `ticks` fixed steps
  immediately, running the fixed-timestep update internally rather than waiting
  for real frames. The unit is whole simulation ticks, not seconds: the timestep
  is 60 Hz, so one tick is 1/60 of a second, `step(1)` runs a single simulation
  step and `step(60)` advances one second of game time. Nothing is rounded or
  approximated — the number of steps asked for is the number of steps run.
  `ticks` must be a non-negative integer; `step(0)` is legal and does nothing,
  while a fractional or negative value is invalid and the call fails loudly
  rather than guessing what was meant. This runs the real simulation forward
  from a set-up state to see where it lands. Stepping advances a live run
  (matter moving, towers firing, decomposition, the economy, and any
  build-phase countdown) and has no effect on a menu screen or while the game is
  paused. Calling `step` (or `reset`) also switches the game to manual stepping,
  so successive steps advance the simulation by exactly the number of ticks
  asked for, with no stray wall-clock frames creeping in between calls.
- `snapshot()` returns a plain, JSON-serializable object describing the current
  game state (see [Snapshot shape](#snapshot-shape)). It is a pure read and
  never changes anything.
- `setAutoStep(enabled)` sets the `autoStep` flag (see
  [The manual clock](#the-manual-clock)): `true` lets the game advance itself in
  real time, `false` returns to manual stepping.

### Control operations

These set up a specific situation. Each one routes through the same systems
normal play uses, arranging the world rather than faking outcomes: a spawned
unit is a real unit the towers target and the damage model processes, a placed
tower is a real tower built through the real placement path, and a started round
is the real wave. A control operation never announces the outcome a scenario is
meant to produce; you arrange the situation, `step()` runs the real systems, and
`snapshot()` reads the result.

- `selectMap(mapId)` begins a run on the map whose `id` matches `mapId`, exactly
  as choosing it at the map select would, opening on the untimed opening build
  phase. The available map ids are the `id`s in the snapshot's `maps` list.
- `goToMapSelect()` opens the map-select screen from the title, as choosing the
  campaign start would, without beginning a run (useful for capturing that
  screen).
- `setEnergy(amount)` sets the current spendable energy directly, as a
  precondition (for example to afford a tower a scenario needs). Energy still
  cannot go below `0`.
- `setIntegrity(amount)` sets the current integrity directly, as a precondition
  (for example just above zero to observe a leak fail containment). Reaching `0`
  still resolves through the real containment check.
- `setRound(n)` sets the round number the next `startRound()` will build, as a
  precondition. It does not spawn anything; the wave for round `n` is generated
  by the real wave system when the round starts.
- `startRound()` starts (or, during a between-round countdown, sends early) the
  next round exactly as the START ROUND control would, spawning the real wave
  over time and paying the early-send bonus when a countdown is running.
- `spawnUnit(spec)` puts one unit onto a path through the real spawn system, so
  it flows, is targeted, decomposes, leaks, and pays out like any other spawned
  unit. `spec` may set `type` (one of the matter types in `specs/matter.md`,
  defaulting to a plain atom), `electrons` (for an atom, its electron count),
  `inert` (release it shielded, the way a round-table row can shield any type —
  `specs/matter.md`; a type that is already inert is unaffected),
  `pathId` (which path, defaulting to path `0`), and `progress` (arc length
  along that path toward its collector, defaulting to the inlet). It returns the
  new unit's `id`. This is how a scenario poses an exact unit (a lone heavy, a
  single Dimer, a shielded Dimer, a revealed-or-not Noble) at a chosen point on
  a path and then
  runs the real sim over it.
- `placeTower(type, x, y)` builds a tower of `type` at board position `(x, y)`
  through the real placement path, enforcing the real legality (off the paths,
  no overlap, in bounds, affordable) and deducting the cost. It returns
  `{ ok, id, reason }`: on success `ok` is `true` and `id` is the new tower's
  id; on refusal `ok` is `false` and `reason` names why (`"path"`, `"overlap"`,
  `"bounds"`, or `"cost"`).
- `upgradeTower(id, branch)` upgrades the tower with the given `id` through the
  real upgrade path, deducting its cost. At tier III `branch` is required and is
  `"A"` or `"B"` (the tower's two branches in the order `specs/towers.md` lists
  them); below tier III `branch` is ignored. It returns `true` if the upgrade
  was applied.
- `sellTower(id)` sells the tower with the given `id` through the real sell
  path, freeing its spot and returning the refund it paid.
- `selectTower(id)` selects the built tower with the given `id` so the inspector
  shows it (as clicking it would); passing `null` deselects.
- `setTargeting(id, priority)` sets a damage tower's targeting priority
  (`"first"`, `"last"`, `"nearest"`, `"farthest"`, `"strongest"`, or
  `"weakest"`), as the inspector's targeting control would.
- `setInertPriority(id, on)` sets a damage tower's inert-priority toggle on or
  off, as the inspector's toggle would.
- `setSpeed(multiplier)` sets the game speed (for example `1`, `2`, or `3`), as
  the speed control would.

A typical check calls `selectMap`, `setEnergy` and `placeTower` to build a tower
beside a lane, `spawnUnit` to pose a unit in its range, `step()` a few ticks to
run the real firing and damage, and reads the result from `snapshot()`.

### Input operations

The control operations above pose the world directly. The API can also inject
keyboard input, so a caller can drive the game the way a player does with the
keyboard: navigate the menus, start a round, pause, toggle mute, cycle speed,
and use the tower and inspector hotkeys. Injected input flows through the same
handling the real keyboard feeds, exercising the actual key bindings from
`specs/controls.md` rather than a parallel path.

- `keyDown(code)` presses a key down. `code` is a standard `KeyboardEvent.code`
  (for example `"Space"`, `"Escape"`, `"Enter"`, `"KeyM"`, `"KeyF"`, `"KeyU"`,
  `"KeyS"`, `"KeyT"`, `"KeyI"`, `"ArrowUp"`, `"ArrowDown"`, `"Digit1"` …
  `"Digit7"`). The key becomes held, and any one-shot action it triggers on the
  current screen (a menu move, a confirm, a pause, a mute toggle, a speed cycle,
  a tower-shop hotkey) is applied immediately.
- `keyUp(code)` releases a previously pressed key, ending its held state.
- `press(code)` is a convenience tap, a `keyDown` immediately followed by
  `keyUp`. This is the usual way to trigger a one-shot action without leaving
  the key held.

## Snapshot shape

`snapshot()` returns an object with at least these fields:

```js
{
  version: 1,
  screen: "title" | "mapselect" | "howto" | "playing" | "paused" | "victory" | "defeat",
  paused: <boolean>,        // in-place pause active (meaningful on the "playing" screen)
  phase: "build" | "round", // within a run: the between-round build phase, or a live round
  maps: [                   // the catalog of maps the campaign offers
    { id: <string>, name: <string>,
      difficulty: "easy" | "medium" | "hard",
      topology: "single" | "branching" | "multiple",
      style: "curved" | "straight" },
  ],
  map: <string> | null,     // the id of the map currently in play, or null off a run
  speed: <number>,          // current game-speed multiplier (1, 2, 3)
  muted: <boolean>,
  energy: <number>,
  integrity: <number>,
  score: <number>,
  round: <number>,          // current round number (0 before Round 1)
  totalRounds: <number>,    // 40
  buildCountdown: <number> | null,  // seconds left in a timed build phase (else null)
  result: "victory" | "defeat" | null,
  paths: [                  // the in-play map's paths (empty off a run)
    { id: <number>, length: <number>, points: [{ x: <number>, y: <number> }, ...] },
  ],
  matter: [                 // every live unit
    { id: <number>,
      type: "atom" | "dimer" | "polymer" | "lattice" | "noble" | "isotope"
          | "chelate" | "shroud" | "macromass",
      x: <number>, y: <number>,
      pathId: <number>, progress: <number>,   // which path, and arc length toward its collector
      speed: <number>, baseSpeed: <number>,   // current (after any slow) and unslowed speed
      hp: <number>, maxHp: <number>,          // remaining and starting shells/hit points
      electrons: <number> | null,  // remaining electron count for an atom; else null
      bond: <number> | null, maxBond: <number> | null,  // bond now/max; null if unbonded
      traits: { bonded: <boolean>, heavy: <boolean>, inert: <boolean> },
      revealed: <boolean>,      // an inert unit currently revealed by a detector
      slow: <number>,           // slow multiplier in effect (1 = none)
      damageBonus: <number>,    // extra damage/hit from excite/brittle/mark (0 = none)
    },
  ],
  towers: [                 // every built tower
    { id: <number>,
      type: "emitter" | "ionizer" | "cleaver" | "reactor" | "beam" | "catalyst" | "moderator",
      x: <number>, y: <number>,
      tier: <number>,           // 1, 2, or 3
      branch: "A" | "B" | null, // the chosen tier-III branch, else null
      damageType: "energy" | "kinetic" | "nuclear" | null,  // null for the support auras
      range: <number>, damage: <number>, fireRate: <number>,
      targeting: <string> | null,     // targeting priority (damage towers), null for auras
      inertPriority: <boolean>,        // damage towers
      angle: <number> | null,   // head heading in radians (damage towers); null for auras
      targetId: <number> | null,       // the unit it is currently firing at, or null
      cooldown: <number>,              // seconds until it can fire again
      spent: <number>,                 // total energy spent on it (build + upgrades)
    },
  ],
  projectiles: [            // shots in flight
    { id: <number>, x: <number>, y: <number>, vx: <number>, vy: <number>,
      damageType: "energy" | "kinetic" | "nuclear",
      damage: <number>, targetId: <number> | null },
  ],
  effects: [                // particle bursts currently playing
    { id: <number>, kind: "strip" | "bondsnap" | "split" | "neutralize" | "reveal" | "muzzle",
      x: <number>, y: <number> },
  ],
  simTime: <number>,        // accumulated simulation time, in seconds
}
```

`progress` is arc length toward a path's collector, so the unit with the
greatest `progress` on a path is the "first" target. `bond` is the outstanding
bond-integrity pool of a bonded cluster and falls to `0` as it is chipped open;
`electrons` falls by one each time an atom is stripped. `revealed` is `true`
while a detector can see an inert unit and for as long as a lingering reveal
lasts. `slow` reflects the strongest slow currently on the unit, and
`damageBonus` the extra per-hit damage from an excite, brittle, or mark effect.
`effects` lists the decomposition and muzzle bursts playing this frame, so a
caller can read which burst is playing and where.

## The debug overlay

Provide a read-only on-screen overlay showing the game's live internal state, so
you can watch what the simulation is doing while you play. It is toggled with
the backtick key (`` ` ``), off by default, and never changes gameplay; it only
draws.

When on, it draws over the running game, legibly, in the game's monospace type,
at least: the current `screen`, `phase`, and paused flag, the round number and
its progress, energy, integrity, and score, the current game speed, a count of
live matter, towers, and projectiles, and, for the unit nearest the pointer (or
a chosen unit), its type, traits, remaining hit points, bond pool, and slow.
This is the same ground truth `snapshot()` reports. It is a diagnostic layer
rather than part of the game's presentation, so keep it visually plain and
clearly separate from the HUD.
