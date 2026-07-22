# Deepcore: debug and automation API

Deepcore ships a small debugging and automation surface so the game can be driven and
inspected from code, without touching the keyboard or waiting on real time. It is what
you use to iterate on the simulation, reproduce a specific dig or core run, script
a scenario, and capture clean screenshots of an exact game state. This file defines
that surface. Implement all of it, on the same footing as the game itself.

Nothing here changes how a person plays. The debug API is inert during normal play,
doing nothing until something calls it, and the debug overlay is off until toggled.

## A deterministic core

The whole surface rests on the simulation being deterministic and steppable, which the
fixed-timestep loop in `specs/controls.md` already requires: a constant logic tick,
integrated in whole steps, decoupled from rendering. Two more properties make it
driveable from code:

- Render-free core. Game state advances by stepping the simulation and must not depend
  on a canvas, on `requestAnimationFrame`, or on wall-clock time to make progress.
  Rendering reads the state, never the other way around.
- Seeded randomness. All of the game's randomness runs off a seedable generator: the
  per-game mine generation (`specs/world.md`, the tunnels and the ore/gemstone/hazard/
  stone scatter and the random material-node positions) and any other gameplay
  randomness. Reseeding and replaying the same calls reproduces the same mine and the
  same result exactly. (The one deliberate exception is the Quantum Teleporter's
  randomized surfacing, which `specs/items.md` states is a live player action and need
  not be seed-reproducible.)

Given the same seed and the same sequence of API calls and steps, the game reaches the
same state every time.

## The manual-step clock

The simulation advances on an external timestep: a single fixed step, and by
`specs/controls.md` that step is exactly 1/60 of a second of game time. During normal
play the animation-frame loop drives that timestep from the wall clock so the game runs
itself in real time. The debug API can instead drive it directly, one tick at a time, so
a scripted scenario is exact and reproducible regardless of machine load. Because the
step length is fixed, the debug API counts time in whole TICKS rather than in seconds —
there is nothing to round and no ambiguity about what a step means.

- The game holds an `autoStep` flag, default true (normal human play). While `autoStep`
  is true the animation-frame loop advances the sim each frame from the wall clock; while
  it is false the loop still renders every frame but does not advance the sim, so
  `step(ticks)` below is the only thing that moves it.
- `reset()` and `step(ticks)` set `autoStep` to false, beginning a driver-clocked
  session. While it is false no stray wall-clock frame can pollute a measurement window,
  so a stepped scenario measures exact values.
- `setAutoStep(enabled)` (below) toggles the flag back. `setAutoStep(true)` lets the game
  advance itself in real time again, which is what you want while watching the mine or
  recording a motion clip; `setAutoStep(false)` returns to manual stepping. `reset()`
  re-arms manual. The input operations (`keyDown`, `keyUp`, `press`) and the control
  operations do not change `autoStep`.

This is an ordinary manual-step-versus-run-live debugging affordance: step the sim by
hand to inspect it frame by frame, or let it run to watch it.

## The `window.__deepcore` object

Expose the API as a single object on the global `window.__deepcore`, installed once the
game is running. It carries a `version` number (use `1`) and the operations below.
Values are plain numbers, strings, booleans, and JSON-serializable objects so a caller
can read them directly; coordinates and velocities are in the logical-pixel space of
`specs/overview.md`, and tile coordinates are `col`/`row` in the grid of
`specs/world.md`.

### Core operations

- `reset(options)` returns the game to its initial title state, discarding any
  in-progress expedition. `options` is optional, and `options.seed` (a number) seeds all
  of the game's randomness, above all the mine generation, so a scenario replays
  identically. After `reset` the game is at the title menu, and stepping is manual (see
  the manual-step clock).
- `step(ticks)` advances the simulation by exactly `ticks` fixed steps immediately,
  running the fixed-timestep update internally rather than waiting for real frames. The
  unit is whole simulation ticks, not seconds: the timestep is 60 Hz, so one tick is
  1/60 of a second, `step(1)` runs a single logic step and `step(60)` advances one second
  of game time. Nothing is rounded or approximated — the number of steps asked for is the
  number of steps run. `ticks` must be a non-negative integer; `step(0)` is legal and does
  nothing, while a fractional or negative value is invalid and the call fails loudly
  rather than guessing what was meant. It runs the real systems forward from a set-up
  state to see where they land: the miner falls, drills, and burns fuel, hazards fire, and
  the Core Sample timer ticks, exactly as they would in live play. Stepping advances the
  live mine only; it has no effect while a menu screen is up.
- `snapshot()` returns a plain, JSON-serializable object describing the current game
  state (see [Snapshot shape](#snapshot-shape)). It is a pure read and never changes
  anything.
- `tileAt(col, row)` returns a pure read of a single grid cell (see
  [Tile reads](#tile-reads)); it never changes anything.
- `findTile(kind)` returns the grid position of a tile of the given kind (see
  [Tile reads](#tile-reads)), a pure read used to locate a material node or the Core.

### Control operations

These set up a specific situation. Each one routes through the same systems normal play
uses, arranging the world rather than faking outcomes; the outcome is then produced by
running the real simulation forward with `step` and read back from `snapshot`,
`tileAt`, or the rendered pixels.

- `startExpedition(mode, size)` starts a fresh expedition and drops the miner on the
  surface, exactly as picking the mode and world size from the menus would. `mode` is
  `"standard"` or `"hardcore"` (`specs/modes.md`); `size` is `"quick"`, `"standard"`, or
  `"marathon"` (`specs/world.md`). The mine is generated from the current seed.
- `teleport(col, row)` places the miner at the center of the given cell and recenters the
  camera, a precondition for a scenario deep in the mine or at the Core chamber. The
  miner then falls, drills, and thrusts from there under the real physics.
- `setFuel(value)` and `setHull(value)` set the miner's current fuel or hull, clamped to
  the current maximum, as a precondition (for example, to set up a low-fuel warning, an
  out-of-fuel strand, or a near-death hull). They do not change the maxima, which the
  tiers set.
- `grantCredits(amount)` adds Credits to the balance, so a scenario can afford an upgrade,
  a field supply, a fuel/repair buy, or a rocket component without first digging for it.
- `grantGear(tiers)` sets upgrade tiers. Pass a single number to set every track to that
  tier `1..5`, or an object keyed by track (`fuel`, `drill`, `cargo`, `hull`, `jetpack`,
  `radiator`, `scanner`) to set specific ones. It applies through the real upgrade path
  (raising maxima and granting new capacity as `specs/upgrades.md` describes).
- `addCargo(ore, count)` adds `count` units of an ore (or gemstone) to the cargo bay
  through the real collection path, respecting the slot cap (a unit that will not fit is
  left behind, as in play). Used to pose a haul of a chosen weight for the weight/lift and
  selling checks.
- `giveMaterial(kind)` banks one exotic material into the satchel through the real
  collection path: `"resonite"` or `"cryenite"`. (The Core Sample is taken with
  `spawnCoreSample` below, because taking it starts the timer.)
- `dropOre(ore)` discards one unit of the named ore from the cargo bay through the real
  inventory drop path (`specs/mining.md`): the ore is lost, the load drops, and an
  overloaded miner can shed weight until it can lift off again.
- `spawnCoreSample()` extracts a Core Sample as drilling the Core does, banking it in the
  satchel and starting its 90-second destabilization timer (`specs/hazards.md`).
- `setTile(col, row, spec)` sets a grid cell's kind as a precondition so a scenario faces
  a known piece of terrain: `spec` is an object with a `kind`
  (`"rock"`, `"ore"`, `"material"`, `"gas"`, `"lava"`, `"stone"`, `"tunnel"`, `"core"`)
  and, for an ore or material tile, an `ore` or `material` field naming which. It arranges
  the world only; the outcome (a gas detonation, a lava burn, an ore pickup, an
  unbreakable-stone stop) is still produced by the real drill and contact systems when the
  miner reaches the tile. It never places a tile that generation forbids from sealing a
  route.
- `sell()` sells the cargo at the Ore Market for Credits and empties the bay
  (`specs/mining.md`), through the real market path.
- `buyUpgrade(track)` buys the next tier on a track (`specs/upgrades.md`); `buyFuel(units)`
  and `buyRepair(points)` buy fuel and hull repair at the Fuel Depot
  (`specs/character.md`); `buyItem(id)` buys a field supply and `useItem(id)` uses one
  (`specs/items.md`, ids `"dynamite"`, `"plastic-explosives"`, `"quantum-teleporter"`,
  `"matter-transmitter"`, `"nanobots"`, `"emergency-fuel"`); each routes through the same
  code the panel buttons do, deducting Credits and applying the effect.
- `fabricate()` fabricates the next uninstalled rocket component at the Launch Pad
  (`specs/rocket.md`), consuming its Credits and material through the real path; `launch()`
  launches once all five are installed, taking the game to Victory.
- `openPanel(panel)` opens a surface building panel (`"fuel-depot"`, `"ore-market"`,
  `"upgrade-shop"`, `"supply-depot"`, `"launch-pad"`) and `openInventory()` opens the
  inventory overlay; `closePanel()` closes whatever is open. These reach the panels for a
  screenshot of an exact state.
- `save()` saves the expedition to its single slot exactly as activating the surface Save
  Pad does (`specs/flow.md`), through the real save path, so it honors the block while a
  live Core Sample's timer runs.
- `setMuted(muted)` sets the audio mute toggle, the same one the mute control flips
  (`specs/controls.md`).
- `jettison()` jettisons the carried Core Sample onto the miner's tile as a ground item,
  its timer still running (`specs/items.md`).

A typical check calls `reset({ seed })`, `startExpedition("standard", "standard")`,
`teleport` and `setTile`/`grantGear`/`setFuel` to arrange the exact situation wanted,
`step()` a handful of ticks (or holds a movement key and steps) to run the real
systems, and reads the result from `snapshot()`, `tileAt()`, or a sampled pixel.

### Input operations

The control operations above pose the world directly. The API can also inject keyboard
input, so a caller can drive the game the way a player does: navigate the menus, move and
drill by holding a key, pause, open the inventory, use a field-supply hotkey, and toggle
mute. Injected input flows through the same handling the real keyboard feeds, exercising
the actual key bindings of `specs/controls.md` rather than a parallel path. Unlike the
control operations, injecting input does not switch the clock or take control away from
normal play: a held movement key drives the miner through the game's own update while the
sim is stepped, which is how a caller confirms the controls themselves work.

- `keyDown(code)` presses a key down. `code` is a standard `KeyboardEvent.code`, for
  example `"ArrowUp"`, `"ArrowDown"`, `"ArrowLeft"`, `"ArrowRight"`, `"KeyW"`, `"KeyA"`,
  `"KeyS"`, `"KeyD"`, `"Space"`, `"KeyE"`, `"Enter"`, `"Escape"`, `"KeyI"`, `"KeyM"`,
  `"KeyJ"`, and `"Digit1"`..`"Digit6"`. The key becomes held, so a movement or thrust key
  drives the miner while it is held and the simulation is stepped, and any one-shot action
  the key triggers on the current screen (a menu move, a confirm, an activate, a pause, an
  inventory toggle, a mute, a field-supply use, a jettison) is applied immediately.
- `keyUp(code)` releases a previously pressed key, ending its held state.
- `press(code)` is a convenience tap, a `keyDown` immediately followed by `keyUp`, the
  usual way to trigger a one-shot action without leaving the key held.

The usual shape for an input-driven scenario is to `press` through the menus to start an
expedition, then `keyDown` a movement or thrust key and `step` (or let real time pass) so
the miner moves or drills, then `keyUp` to release it, reading `snapshot()` to see where
the miner and its state ended up.

## Snapshot shape

`snapshot()` returns an object with at least these fields:

```js
{
  version: 1,
  screen: "title" | "mode-select" | "size-select" | "how-to-play"
        | "in-mine" | "paused" | "victory" | "game-over",
  panel: null | "fuel-depot" | "ore-market" | "upgrade-shop"
       | "supply-depot" | "launch-pad" | "inventory",
  mode: "standard" | "hardcore",
  worldSize: "quick" | "standard" | "marathon",
  autoStep: <boolean>,          // false while the driver clocks the sim
  muted: <boolean>,             // whether the audio mute toggle is on
  simTime: <number>,            // accumulated simulation time, in seconds
  hasSave: <boolean>,           // whether a save slot currently exists
  credits: <number>,
  creditsEarned: <number>,      // running total earned this run (for the summary)
  depthMeters: <number>,        // the miner's current depth
  deepestDepthMeters: <number>, // deepest reached this run
  coreTimer: <number> | null,   // seconds left on a live Core Sample, else null
  coreGround: null | { col: <number>, row: <number> }, // a jettisoned sample's tile
  camera: { x: <number>, y: <number> },
  miner: {
    x: <number>, y: <number>,   // logical-pixel position (top-left of the miner box)
    vx: <number>, vy: <number>,
    col: <number>, row: <number>,   // the cell the miner occupies
    facing: "east" | "west",
    state: "idle" | "walk" | "drill-down" | "drill-side"
         | "jetpack" | "fall" | "hurt" | "fuel-out",
    grounded: <boolean>,
    fuel: <number>, maxFuel: <number>,
    hull: <number>, maxHull: <number>,
    overloaded: <boolean>,      // load exceeds the jetpack's lift
    // Non-null while a cut is in progress:
    drilling: null | { col: <number>, row: <number>,
                       dir: "down" | "left" | "right", progress: <number> }, // 0..1
  },
  cargo: {
    slotsUsed: <number>, slotCap: <number>,
    loadKg: <number>,           // total weight of the haul
    liftLimitKg: <number>,      // heaviest load the current jetpack tier can climb with
    ore: { <oreName>: <count>, ... },   // held ore/gems by name, nonzero entries
  },
  satchel: {
    resonite: <number>, cryenite: <number>,
    coreSample: <boolean>,      // carrying a live Core Sample
  },
  tiers: {                      // current tier 1..5 on each track
    fuel: <number>, drill: <number>, cargo: <number>, hull: <number>,
    jetpack: <number>, radiator: <number>, scanner: <number>,
  },
  items: {                      // held field-supply counts
    "dynamite": <number>, "plastic-explosives": <number>,
    "quantum-teleporter": <number>, "matter-transmitter": <number>,
    "nanobots": <number>, "emergency-fuel": <number>,
  },
  rocket: {
    installed: [ <componentId>, ... ],  // ordered: "hull-frame","fuel-cells",
                                        // "guidance","thruster","ignition"
    nextComponent: <componentId> | null,   // the next one to fabricate, or null if done
  },
  scanner: {
    locked: <boolean>,          // pointing at a needed material in range
    target: "resonite" | "cryenite" | null,
    dirX: <number>, dirY: <number>,     // unit direction to the target, when locked
    distanceTiles: <number> | null,     // rough distance, when locked
  },
  summary: null | {             // set on victory/game-over
    deepestDepthMeters: <number>, creditsEarned: <number>,
    elapsedSeconds: <number>, mode: "standard" | "hardcore",
    componentsInstalled: <number>,
    deathCause: "fuel-out" | "hull-destroyed" | "core-detonation" | null,
  },
}
```

`overloaded` mirrors the HUD's OVERLOAD read: `loadKg` exceeds `liftLimitKg`. `drilling`
is `null` unless a cut is under way, and its `progress` runs `0` to `1` as the target
tile's health drains. `scanner.locked` is `false` (and the direction/distance omitted or
zero) whenever no needed material is in range, matching the indicator being hidden.

## Tile reads

The grid is large, so it is read by cell rather than dumped whole:

- `tileAt(col, row)` returns the cell's observable state:

```js
{
  kind: "rock" | "ore" | "material" | "gas" | "lava"
      | "stone" | "bedrock" | "tunnel" | "core",
  band: "topsoil" | "rockbed" | "deepstone" | "coreshell",
  ore: <oreName> | null,        // for an ore/gem tile
  material: "resonite" | "cryenite" | null,  // for a material node
  health: <number> | null,      // remaining tile health, or null if undrilled/not minable
  maxHealth: <number> | null,   // the band's full health for a minable tile
}
```

- `findTile(kind)` returns the `{ col, row }` of a tile of the given kind (the nearest to
  the miner where several exist, such as a material node or the Core), or `null` if there
  is none. It is what a scanner or material check uses to locate the guaranteed-but-hidden
  node without scanning the whole grid.

Both are pure reads that never change the world.

## The debug overlay

Provide a read-only on-screen overlay showing the game's live internal state, so you can
watch what the simulation is doing while you play. It is toggled with the backtick key
(`` ` ``), off by default, and never changes gameplay; it only draws.

When on, it draws over the running game, legibly, in the game's monospace type, at least:
the current `screen` and `panel`, the `mode`, the `worldSize`, and the `autoStep` flag;
the miner's position, velocity, `state`, `facing`, `grounded`, fuel/maxFuel and
hull/maxHull, and any active drill target and progress; Credits, depth in meters, the
cargo slots used over capacity with the load in kg and the OVERLOAD flag, the satchel
contents, the upgrade tiers, the Core Sample timer, and the scanner lock and target, the
same facts `snapshot()` reports. It is a diagnostic layer rather than part of the game's
presentation, so keep it visually plain and clearly separate from the HUD.
