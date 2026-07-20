# Arc Foundry — Debug and automation API

Arc Foundry ships a small debugging and automation surface so the yard can be
driven and inspected from code, without touching the mouse or waiting on real
time. It is what you use to iterate on the simulation, reproduce a specific board
or wave, script a scenario for a bolt or a combine, and capture a clean
screenshot of an exact game state. This file defines that surface. Implement all
of it, on the same footing as the game itself.

Nothing here changes how a person plays. The debug API is inert during normal
play, doing nothing until something calls it, and the debug overlay is off until
toggled.

## A deterministic core

The whole surface rests on the simulation being deterministic and steppable,
which the fixed-timestep tick in `specs/controls.md` already requires. Two more
properties make it driveable from code:

- Render-free core. Game state advances by stepping the simulation and must not
  depend on a canvas, on `requestAnimationFrame`, or on wall-clock time to make
  progress. Unit movement, pathfinding, component fire, projectile travel, the
  status effects, and the economy all advance in the tick. Rendering reads the
  state, never the other way around.
- Seeded randomness. Every random draw the game makes runs off a seedable
  generator: the scrap-press type and quality roll, per-wave composition and
  spawn order, and the crit roll. Reseeding and replaying the same calls and
  steps reproduces the same result exactly.

Given the same seed and the same sequence of API calls and steps, the game
reaches the same state every time.

## The manual clock

The tick advances on an external timestep — the fixed 60 Hz tick of
`specs/controls.md`, so one tick is exactly 1/60 of a second of game time — and the
API can supply it directly. The game holds an `autoStep` flag, on by default for
normal play:

- While `autoStep` is on, the animation-frame loop advances the tick from the
  wall clock (scaled by the speed control), exactly as a person playing sees.
- While `autoStep` is off, the animation-frame loop still renders every frame but
  advances the tick only when `step` is called, so a scripted scenario advances
  by an exact amount of game time and is reproducible regardless of machine load.

`reset` and `step` turn `autoStep` off, beginning a driver-clocked session:
after either, `step(ticks)` is the only thing that advances the simulation.
`setAutoStep(true)` lets the game run itself in real time again, for watching or
recording a live clip; `setAutoStep(false)` returns to manual stepping. The
control and input operations below do not change `autoStep`.

## The `window.__foundry` object

Expose the API as a single object on the global `window.__foundry`, installed
once the game is running. It carries a `version` number (use `2`) and the
operations below. Values are plain numbers, strings, and booleans so a caller can
read them directly. Positions, ranges, and velocities are in the logical-pixel
space of `specs/overview.md`; tile coordinates are `(col, row)` on the grid of
`specs/board.md`.

### Core operations

- `reset(options)` returns the game to its initial title state. `options` is
  optional, and `options.seed` (a number) seeds all of the game's randomness so a
  scenario replays identically. `reset` turns `autoStep` off.
- `step(ticks)` advances the simulation by exactly `ticks` fixed steps immediately,
  running the fixed-timestep tick internally rather than waiting for real frames,
  and turns `autoStep` off. The unit is whole simulation ticks, not seconds: the
  timestep is 60 Hz, so one tick is 1/60 of a second, `step(1)` runs a single tick
  and `step(60)` advances one second of game time. Nothing is rounded or
  approximated — the number of steps asked for is the number of steps run.
  `ticks` must be a non-negative integer; `step(0)` is legal and does nothing,
  while a fractional or negative value is invalid and the call fails loudly rather
  than guessing what was meant. Stepping advances only the live simulation (a wave
  in progress, projectiles, burns, the economy); it does nothing on a menu screen
  and does nothing while the game is paused. It ignores the speed control, always
  advancing exactly `ticks` ticks of game time.
- `setAutoStep(enabled)` sets the `autoStep` flag. `setAutoStep(true)` hands the
  clock back to the animation-frame loop so the game runs in real time (for a
  live clip); `setAutoStep(false)` returns to manual stepping.
- `snapshot()` returns a plain, JSON-serializable object describing the current
  game state (see [Snapshot shape](#snapshot-shape)). It is a pure read and never
  changes anything.
- `panelButtons()` returns the inspector's action buttons for the currently
  selected structure, in slot order, as an array of plain objects
  `{ action, label, x, y, w, h, disabled }`. `label` is the button text as drawn,
  `x`/`y`/`w`/`h` are its rectangle in the `1280x720` logical stage, and
  `disabled` reports whether it currently ignores clicks. `action` names the
  operation the button commits, using exactly these identifiers:

  | `action` | The control it reports |
  | --- | --- |
  | `keep` | KEEP (harvest a candidate) |
  | `downgrade` | DOWNGRADE (harvest one quality tier lower) |
  | `combine` | COMBINE (fold a matching quality pair) |
  | `comborecipe` | COMBINE SPECIAL (assemble a combination tower) |
  | `comboupgrade` | UPGRADE (raise a combination tower's level) |
  | `targeting` | the targeting-priority cycle |
  | `remove` | DISMANTLE |

  It returns an empty array when the inspector is not showing a structure's
  actions (nothing is selected, or a held rock has replaced the inspector). The
  action set and its geometry depend only on which structure is selected
  (`specs/controls.md`), so a caller can compare two calls across a change in game
  state and confirm the panel did not reflow. It is a pure read.

### Control operations

These set up a specific situation. Each one routes through the same systems normal
play uses, arranging the world rather than faking outcomes: a placed rock rolls
through the real press, a kept candidate becomes a component through the real
harvest, a combine resolves through the real combine code, a spawned unit walks
the real pathfinder. They establish preconditions; the observed result always
comes from stepping the real simulation forward.

Run setup:

- `startRun(options)` begins a run, exactly as choosing a campaign at the menus
  would. `options.map` is `"substation"`, `"switchyard"`, or `"transformer"`
  (default `"substation"`) and `options.difficulty` is `"easy"`, `"medium"`, or
  `"hard"` (default `"medium"`). The run opens on its untimed opening build phase.
- `setCharge(amount)` sets the current Charge, as a precondition for affording an
  upgrade. `setIntegrity(amount)` sets Grid Integrity, as a precondition for a
  leak or an overload. `setRefinement(level)` sets the Refinement level `R`
  (`0..8`), biasing future rolls per the odds table (`specs/build.md`).
  `setWave(n)` sets the current wave number, so the next spawned units scale to
  wave `n` (`specs/enemies.md`). Each sets a live value the real systems then
  resolve forward.

Building:

- `setNextRoll(type, quality)` arms the exact component the next placed rock will
  roll, so a scenario can reproduce a specific board. `type` is a base component
  type (`"capacitor"`, `"coil"`, `"emitter"`, `"arcnode"`, `"discharge"`,
  `"choke"`, `"rectifier"`, `"regulator"`) and `quality` is `1..5`. Passing
  `null` clears the arming and returns the press to its real seeded random roll.
  The rock still enters through the real placement path; this only fixes what it
  rolls.
- `placeRock(col, row)` drops a rock at the anchor tile `(col, row)` through the
  real placement path: it rolls a component (from the seeded RNG, or the value
  armed by `setNextRoll`), becomes a candidate, spends one stamp, and the floor
  re-paths. It is refused, exactly as a click would be, when the footprint is
  illegal (`specs/board.md`); the refusal is readable in the snapshot (no new
  candidate, `stampsLeft` unchanged).
- `select(id)` selects a piece by its id, as a left-click on it would.
- `setCombineSet(ids)` sets the explicit combine multiset (the pieces a
  shift-click selection would gather); passing `[]` clears it.
- `keep(id)` harvests a candidate as a permanent firing component. It is the
  level's one harvest, so it sends the wave (`specs/build.md`).
- `downgrade(id)` harvests a candidate as a firing component one quality tier
  lower. It is the harvest, so it sends the wave.
- `combine(initiatorId)` commits a combine from the initiating piece: a
  quality-combine of a matching pair, or a reachable combination-tower recipe. If
  a `combineSet` is set it folds exactly that set; otherwise it auto-resolves the
  ingredients, preferring to consume a fresh candidate over a standing tower
  (`specs/build.md`). It sends the wave when it consumes a fresh roll and leaves
  the phase running when it folds only standing towers.
- `dismantle(id)` removes a structure, clears its footprint, and re-paths the
  floor. It is a build-phase action (`specs/controls.md`) and returns nothing.
- `setTargeting(id, priority)` sets a firing component's targeting priority
  (`"first"`, `"last"`, `"nearest"`, `"strongest"`, `"weakest"`).
- `upgradeQuality()` buys the next Refinement level for Charge, in any phase.
- `upgradeCombo(id)` raises a combination tower's upgrade level by one for Charge,
  in any phase.

Waves and the Load:

- `spawnUnit(type, options)` releases Load units at the Entry through the real
  spawner, so a scenario can run a chosen unit forward without composing a whole
  wave. `type` is `"mote"`, `"spark"`, `"slug"`, `"cluster"`, `"filament"`,
  `"dynamo"`, or `"overload"` (the invincible post-final boss, `specs/enemies.md`).
  `options.count` (default `1`) spawns several, and `options.wave` scales their HP
  to that wave instead of the current one. Each unit walks the real pathfinder (or
  flies, for the Filament).

A wave otherwise begins the way normal play begins one: by committing the level's
harvest (`keep`, `downgrade`, or a fresh-consuming `combine`).

### Input operations

The control operations above act on the world directly. The API can also inject
raw input, so a caller can drive the game the way a player does, exercising the
actual key and pointer bindings of `specs/controls.md` rather than a parallel
path. Injected input flows through the same handlers the real keyboard and mouse
feed.

- `keyDown(code)` presses a key down. `code` is a standard `KeyboardEvent.code`
  (for example `"KeyB"`, `"KeyK"`, `"KeyC"`, `"KeyF"`, `"Space"`, `"Escape"`,
  `"KeyM"`, `"Enter"`, `"ArrowUp"`). Any one-shot action the key triggers on the
  current screen is applied immediately.
- `keyUp(code)` releases a previously pressed key.
- `press(code)` is a convenience tap, a `keyDown` immediately followed by a
  `keyUp`.
- `pointerMove(x, y)` moves the pointer to the logical-pixel position `(x, y)`,
  updating the held-stamp ghost and hover state.
- `click(x, y)` clicks at `(x, y)` (places a held rock, selects a piece, or
  activates a control there). `rightClick(x, y)` right-clicks (cancels a held
  rock). `shiftClick(x, y)` adds or removes a piece from the explicit combine set.

## Snapshot shape

`snapshot()` returns an object with at least these fields:

```js
{
  version: 2,
  screen: "title" | "mapselect" | "difficultyselect" | "howto"
        | "playing" | "paused" | "victory" | "overload",
  phase: "build" | "wave" | "finale" | null, // null off the board
  paused: <boolean>,                 // in-place pause (screen stays "playing")
  map: "substation" | "switchyard" | "transformer" | null,
  difficulty: "easy" | "medium" | "hard" | null,
  wave: <number>,                    // current wave (0 before Wave 1)
  totalWaves: <number>,              // N for the chosen difficulty
  waveActive: <boolean>,             // a wave is spawning or has live units
  charge: <number>,
  integrity: <number>,
  refinement: <number>,              // R, 0..8
  qualityOdds: [<t1>, <t2>, <t3>, <t4>, <t5>], // current roll odds (sum 1)
  stampsLeft: <number>,              // of the 5-per-level allowance
  speed: <number>,                   // 1 | 2 | 4 | 8
  muted: <boolean>,
  mazeLength: <number>,              // ground route length through the chain
  mazeRating: <number>,              // damage tallied on the Overload Dynamo
  selected: <id> | null,
  combineSet: [<id>, ...],
  overlays: { combos: <boolean>, dmgBoard: <boolean> },
  held: { active: <boolean>, col: <number>, row: <number>, legal: <boolean> } | null,
  entry: { col: <number>, row: <number> },
  collector: { col: <number>, row: <number> },
  waypoints: [ { index: <number>, col: <number>, row: <number> } ], // ordered
  units: [
    {
      id: <id>,
      type: "mote"|"spark"|"slug"|"cluster"|"filament"|"dynamo"|"overload",
      x: <number>, y: <number>,
      hp: <number>, maxHp: <number>,
      speed: <number>,               // current speed (after any slow)
      baseSpeed: <number>,           // unmodified roster speed
      flying: <boolean>,
      waypointIndex: <number>,       // the next waypoint it is heading to
      progress: <number>,            // scalar position along the chain
      slowFactor: <number>, slowUntil: <number>,
      burnDps: <number>, burnUntil: <number>,
      invincible: <boolean>,         // the Overload Dynamo
    },
  ],
  towers: [
    {
      id: <id>,
      kind: "candidate" | "component" | "blocker" | "combo",
      type: <string> | null,         // component type or combo id; null for a blocker
      quality: <number> | null,      // 1..5 for base pieces; null for combo/blocker
      level: <number> | null,        // 0..3 for a combo; null otherwise
      col: <number>, row: <number>,  // anchor (top-left tile)
      cx: <number>, cy: <number>,    // center (logical px)
      range: <number>, damage: <number>, fireRate: <number>,
      targeting: "first"|"last"|"nearest"|"strongest"|"weakest" | null,
      heading: <number>,             // firing-head rotation, radians
      firing: <boolean>,
      kills: <number>, damageDealt: <number>,
      auraRadius: <number>, auraBonus: <number>, // regulator / aura combos (else 0)
      abilities: [<string>, ...],    // e.g. ["splash", "burn"]
    },
  ],
  projectiles: [
    { id: <id>, x: <number>, y: <number>, vx: <number>, vy: <number>,
      type: <string>, heading: <number>, damage: <number>, targetId: <id> | null },
  ],
  simTime: <number>,                 // accumulated simulation time, in seconds
}
```

- `phase` is `"build"` during an untimed build phase, `"wave"` while a wave is
  live, `"finale"` during the post-final Overload Dynamo run (`specs/flow.md`),
  and `null` on a menu screen. `paused` is the in-place pause, which leaves
  `screen` at `"playing"` while freezing the tick (`specs/controls.md`).
- A `towers` entry covers all four things that occupy the grid
  (`specs/build.md`): a `candidate` (rolled, still keepable), a `component` (a
  kept or combined firing base tower), a `combo` (a combination tower with an
  upgrade `level`), and a `blocker` (inert). A `blocker` reports `type: null` and
  zero `damage`/`range`; a non-firing Regulator reports its `auraRadius` and
  `auraBonus` with zero `damage`. `damage` is the piece's effective per-shot
  damage including any aura buff on it. `damageDealt` and `kills` are the piece's
  running tallies (`specs/controls.md`).
- A `units` entry reports the live state the game moves and fires against: its
  position, current and base speed, HP, the waypoint it is heading to, its
  progress along the chain (the ordering the `first` target uses), and its active
  slow and burn. The Overload Dynamo reports `invincible: true`; its damage is
  tallied into `mazeRating` rather than removing HP.
- `qualityOdds` is the five-tier roll distribution at the current Refinement
  level, the same odds the scrap-press UI shows.

## The debug overlay

Provide a read-only on-screen overlay showing the game's live internal state, so
you can watch what the simulation is doing while you play. It is toggled with the
backtick key (`` ` ``), off by default, and never changes gameplay; it only draws.

When on, it draws over the running game, legibly, in the game's monospace type, at
least: the current `screen`, `phase`, and `paused` flag, the `wave n / N`, the
`charge`, `integrity`, and `refinement`, the remaining stamps, the game speed, the
live unit count, and the selected piece's id and its key stats. These are the same
facts `snapshot()` reports. It is a diagnostic layer rather than part of the game's
presentation, so keep it visually plain and clearly separate from the HUD.
