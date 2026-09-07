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
- `reconcile()` brings every value the API reports into agreement with the state
  it is derived from, without advancing the simulation by any amount. A reading
  the build works out at the read already agrees and is left as it is; a reading
  it keeps as a stored copy is rewritten from its source, so a unit's `revealed`
  flag answers for the detectors covering it now and a tower's `targetId` for
  the matter on the board now. It is the call to make after posing a situation
  and before reading it. See
  [Reconciling derived state](#reconciling-derived-state).
- `setAutoStep(enabled)` sets the `autoStep` flag (see
  [The manual clock](#the-manual-clock)): `true` lets the game advance itself in
  real time, `false` returns to manual stepping.

### Reconciling derived state

A specification says what a build reports, not how it holds it, so a value this
one describes as derived may be worked out at the read in one build and kept as
a stored flag in another. Both are conformant, and they part company the moment
a control operation writes what the derived value depends on: the working build
answers for the board as posed, and the storing build answers for the board
before the pose. A caller that poses a situation and reads it straight back is
reading the wrong board, and whatever it concluded decides nothing.

`reconcile()` closes that gap. It re-derives every reading the API reports from
the state that reading is a function of, and it does so without moving the
clock, so a caller poses a board, reconciles it, and reads a description of the
board it posed. A build that works everything out at the read has nothing to do
and is fully conformant with an implementation that does nothing.

What it does not do is as fixed as what it does. It advances nothing: no tick
runs, no matter moves, no tower fires, no cooldown or timer counts down, no
build countdown ticks, no injected key is consumed, and `simTime` is where it
was. It fires nothing: no shot, no damage, no decomposition, no particle burst,
no sound, no screen or phase change, and no draw from the seeded generator. It
corrects nothing: a reading derived from a unit's position is re-derived from
where the unit is, and the unit is not moved to make that reading agreeable, nor
is a posed value clamped to what a rule would have allowed. An accumulated
figure — the energy, the integrity, the score, the round number, a tower's
`spent` — is the simulation's and is left alone. Calling it twice leaves the
same state as calling it once, and it is never an error: it may be called on any
screen, in either phase, paused or running.

`step()` is not a substitute. A step advances the clock and runs every system,
which moves the very thing a pose has just placed, so a measurement taken from a
posed board — how far a unit travelled under fire, how many ticks a kill took,
the first tick a tower acquired on — comes out wrong by the step that was meant
to refresh the reading. A step also spends cooldowns, consumes a held key, and
can fire the very event the caller is waiting for. `reconcile()` costs no
simulation time, so a measurement starts exactly where it was posed.

### Control operations

These set up a specific situation. Each one routes through the same systems
normal play uses, arranging the world rather than faking outcomes: a spawned
unit is a real unit the towers target and the damage model processes, a placed
tower is a real tower built through the real placement path, and a started round
is the real wave. A control operation never announces the outcome a scenario is
meant to produce; you arrange the situation, `step()` runs the real systems, and
`snapshot()` reads the result.

A control operation carries out its own transaction from wherever the game
stands, and it never asks how the caller got there. Which screen is up, which
phase the run is in, whether a tower is selected, whether the control is drawn
or enabled, and where a pointer would have had to be are all how a PLAYER
reaches the control; none of them is a condition on the operation, so
`startRound()` starts a round and `startScenario()` opens a scenario board
whatever screen and phase the game is on. What the transaction's own rules
decide is the effect rather than a gate on it, and those stand: a placement
still costs what it costs, an unaffordable one still builds nothing, and a tower
already at tier III still gains no tier. A pose applies the value it is given
rather than the value a rule would allow.

What no operation does is refuse quietly. A call the game has no defined state
for fails loudly, throwing an `Error` the caller sees: an argument that is not a
number, a name outside a stated set, an index outside a fixed structural range,
or a subject that does not exist — a tower id no tower carries, a targeting
priority on a support aura, which has none. Where an operation's own return
value states the outcome, as `placeTower` and `upgradeTower` do below, that
return value is the answer and the caller reads it; what never happens is a call
that returns with the state exactly as it was and says nothing about why.

- `selectMap(mapId)` begins a run on the map whose `id` matches `mapId`, exactly
  as choosing it at the map select would, opening on the untimed opening build
  phase, and from whatever screen the game is on. The available map ids are the
  `id`s in the snapshot's `maps` list, and an id naming none of them fails
  loudly rather than falling back to a map the caller did not ask for.
- `goToMapSelect()` opens the map-select screen from the title, as choosing the
  campaign start would, without beginning a run (useful for capturing that
  screen).
- `setEnergy(amount)` sets the current spendable energy directly, as a
  precondition (for example to afford a tower a scenario needs). The amount is
  applied as given and is not capped by anything the run has earned; `amount` is
  a number of at least `0`, and a negative one is outside the domain and fails
  loudly.
- `setIntegrity(amount)` sets the current integrity directly, as a precondition
  (for example just above zero to observe a leak fail containment). Reaching `0`
  still resolves through the real containment check.
- `setRound(n)` sets the round number the next `startRound()` will build, as a
  precondition. It does not spawn anything; the wave for round `n` is generated
  by the real wave system when the round starts. `n` is a whole number from `1`
  to `totalRounds`, and a value outside that fails loudly.
- `startRound()` starts (or, during a between-round countdown, sends early) the
  next round exactly as the START ROUND control would, spawning the real wave
  over time and paying the early-send bonus when a countdown is running. It runs
  the round-start transaction from wherever the game stands: the screen the game
  is on and the phase it is in are the player's route to the START ROUND control
  and are not conditions on this call.
- `startScenario()` opens a **scenario round**: a live round the wave system
  leaves empty and that does not end on its own. Everything else about it is an
  ordinary round. `phase` reads `"round"`, and the simulation behaves exactly as
  it does mid-round — towers acquire and fire, matter flows, decomposes and
  leaks, damage pays out, auras apply. What it does not do is send anything or
  finish: the round table is not consulted and nothing is queued, the round
  number does not advance, no early-send bonus is paid, and the round does not
  clear when the board is (or becomes) empty, so a scenario may kill, leak, and
  pose further matter without the run sliding back to the build phase. Losing is
  unaffected — integrity reaching `0` still fails containment and ends the run.
  It opens the scenario round from wherever the game stands — the screen and the
  phase are not conditions on it — and returns `true` once that round is live.
  To leave one, begin another run with `selectMap` or `reset()`.

  This is the board a scripted scenario runs on, and the reason it exists is that
  `startRound()` cannot be one: it always sends the round's real wave, and a
  scenario needs the game's real round behavior over a board holding only what
  the scenario itself posed. Nothing a player does reaches a scenario round — it
  is opened only by this call.

- `spawnUnit(spec)` puts one unit onto a path through the real spawn system, so
  it flows, is targeted, decomposes, leaks, and pays out like any other spawned
  unit. `spec` may set `type` (one of the matter types in `specs/matter.md`,
  defaulting to a plain atom), `electrons` (for an atom, its electron count),
  `inert` (release it shielded, the way a round-table row can shield any type —
  `specs/matter.md`; a type that is already inert is unaffected),
  `pathId` (which path, defaulting to path `0`), and `progress` (arc length
  along that path toward its collector, defaulting to the inlet). `type` is one
  of the matter types, `pathId` is one of the in-play map's path ids, and
  `progress` is between `0` and that path's `length`; each is a stated domain,
  so a value outside one fails loudly rather than being nudged to the nearest
  legal one. It returns the new unit's `id`. This is how a scenario poses an
  exact unit (a lone heavy, a single Dimer, a shielded Dimer, a revealed-or-not
  Noble) at a chosen point on a path and then runs the real sim over it.
- `placeTower(type, x, y)` builds a tower of `type` at board position `(x, y)`
  through the real placement path, enforcing the real legality (off the paths,
  no overlap, in bounds, affordable) and deducting the cost. It returns
  `{ ok, id, reason }`: on success `ok` is `true` and `id` is the new tower's
  id; when the spot or the bank will not carry it `ok` is `false` and `reason`
  names why (`"path"`, `"overlap"`, `"bounds"`, or `"cost"`). Those four are the
  placement transaction's own rules and the return value is how the caller is
  told which one decided; nothing about where a player would have had to click,
  which phase the run is in, or whether a tower is held in build mode is
  consulted. A `type` naming no tower fails loudly.
- `upgradeTower(id, branch)` upgrades the tower with the given `id` through the
  real upgrade path, deducting its cost, whatever is selected and whatever phase
  the run is in. At tier III `branch` is required and is `"A"` or `"B"` (the
  tower's two branches in the order `specs/towers.md` lists them); below tier
  III `branch` is ignored. It returns `true` if the upgrade was applied and
  `false` where the upgrade transaction itself decides against it — the tower is
  already at tier III, the branch a tier-III upgrade needs was not named, or the
  cost cannot be afforded. An `id` no tower carries fails loudly.
- `sellTower(id)` sells the tower with the given `id` through the real sell
  path, freeing its spot and returning the refund it paid, whatever is selected
  and whatever phase the run is in. An `id` no tower carries fails loudly.
- `selectTower(id)` selects the built tower with the given `id` so the inspector
  shows it (as clicking it would); passing `null` deselects. An `id` no tower
  carries fails loudly rather than quietly deselecting.
- `setTargeting(id, priority)` sets a damage tower's targeting priority
  (`"first"`, `"last"`, `"nearest"`, `"farthest"`, `"strongest"`, or
  `"weakest"`), as the inspector's targeting control would, whether or not that
  tower is the selected one. An `id` no tower carries, a `priority` outside the
  six, and a support aura — which has no single target and so no targeting to
  set — each fail loudly.
- `setInertPriority(id, on)` sets a damage tower's inert-priority toggle on or
  off, as the inspector's toggle would, whether or not that tower is the
  selected one. An `id` no tower carries and a support aura each fail loudly.
- `setSpeed(multiplier)` sets the game speed, as the speed control would.
  `multiplier` is `1`, `2`, or `3`, and a value outside those three fails
  loudly.

A typical check calls `selectMap` and `startScenario` to open a live board with
nothing on it, `setEnergy` and `placeTower` to build a tower beside a lane,
`spawnUnit` to pose a unit in its range, `reconcile()` to bring the readings
into agreement with the board it has just posed, `step()` a few ticks to run the
real firing and damage, and reads the result from `snapshot()`. The scenario round is
what makes the reading unambiguous: the only matter on the board is the unit the
check posed, so the energy, integrity and targeting it observes are that unit's
and nothing else's.

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

Several of these readings are DERIVED rather than stored — each is a function of
the board as it now stands, whatever the build happens to hold:

- a unit's `x` and `y`, from its `pathId` and `progress` along that path;
- its `speed`, from `baseSpeed` and the `slow` in effect;
- its `traits`, from its type and its bond;
- its `revealed`, `slow` and `damageBonus`, from the detectors, auras and
  effects reaching it where it now is;
- a tower's `range`, `damage` and `fireRate`, from its type, tier, branch and
  any aura over it;
- its `targetId` and `angle`, from its targeting priority over the live matter;
- `paths`, from the map in play.

A build is free to work any of these out at the read or to keep it as a stored
copy, and `reconcile()` is what brings a stored copy back into agreement after a
pose. The accumulated figures are not derived and no call re-derives them: the
`energy`, the `integrity`, the `score`, the `round`, a unit's `hp`, `electrons`
and `bond`, a tower's `cooldown` and `spent`, and `simTime` are the
simulation's, and only running it moves them.

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
