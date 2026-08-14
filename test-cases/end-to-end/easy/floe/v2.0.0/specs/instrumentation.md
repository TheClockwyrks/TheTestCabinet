# Floe — Debug and automation API

Floe ships a small debugging and automation surface so the game can be driven and
inspected from code, without touching the keyboard or waiting on real time. It is
what you use to iterate on the crossing and the hunter, reproduce a specific
scenario, script a scenario, and capture clean screenshots of
an exact game state. This file defines that surface. Implement all of it, on the same
footing as the game itself.

Nothing here changes how a person plays. The debug API is inert during normal play,
doing nothing until something calls it, and the debug overlay is off until toggled.

## A deterministic core

The whole surface rests on the simulation being deterministic and steppable, which
the simulation model in `specs/gameplay.md` already requires: a fixed timestep,
integrated in whole steps, decoupled from rendering. Two properties make it drivable
from code:

- Render-free core. Game state advances by stepping the simulation and must not
  depend on a canvas, on `requestAnimationFrame`, or on wall-clock time to make
  progress. The dependency runs one way: the simulation never reads from, waits
  on, or is driven by the renderer.
- Seeded randomness. Any randomness the game uses (which open bay the bonus-catch
  fish appears in, and the lanes' spawn phases) runs off a seedable generator, so
  reseeding and replaying the same calls reproduces the same result exactly.

Given the same seed and the same sequence of API calls and steps, the game reaches
the same state every time.

The game advances on a fixed timestep — `120` steps per second, each exactly `1/120`
of a second (`specs/gameplay.md`) — that the animation loop normally supplies from the
wall clock, so it plays in real time for a person at the keyboard. The debug API can
drive that timestep manually instead: `step(ticks)` advances the simulation by a whole
number of those fixed steps, and `reset()` and `step()` switch the game to manual
stepping so the wall clock stops feeding it — from there `step()` is the only thing
that moves the simulation, and a scripted scenario is exact and reproducible whatever
else the machine is doing. `setAutoStep(true)` hands the clock back to the animation
loop so the game runs in real time again (handy for watching a scenario play out or
recording a motion clip).

Time is counted in ticks rather than in seconds precisely because the step length is
fixed: a tick is a unit only because every tick is the same length. One tick is
`1/120 s`, so a second of game time is `120` ticks, `0.12 s` (the hop cooldown) is
`14.4` ticks, and a tenth of a second is `12` ticks.

## The `window.__floe` object

Expose the API as a single object on the global `window.__floe`, installed once the
game is running. It carries a `version` number (use `1`) and the operations below.
Values are plain numbers, strings, and booleans so a caller can read them directly.

Positions come in two forms this API uses consistently:

- A tile is a grid cell, identified by its column `col` (`0..39`) and row `r`
  (`0..19`), row 0 at the top and row 19 at the bottom (`specs/playfield.md`).
- A pixel position is strait-local: `x` is measured from the left edge of the strait
  and `y` from the top of the strait (the strait sits below the 80 px HUD bar), so a
  tile `(col, row)` has its top-left at `x = 32*col`, `y = 32*row`.

### Core operations

- `reset(options)` returns the game to its initial title state. `options` is
  optional, and `options.seed` (a number) seeds all of the game's randomness so a
  scenario replays identically.
- `step(ticks)` advances the simulation by exactly `ticks` fixed steps immediately,
  running the fixed-timestep update internally rather than waiting for real frames.
  `ticks` is a count of `1/120 s` simulation steps, so `step(120)` advances one second
  of game time and `step(1)` advances a single step. It advances exactly that many
  steps — no rounding, no accumulation, nothing left over — so a caller that asks for
  `n` gets `n`. `ticks` must be a non-negative whole number; a fractional or negative
  value is invalid and the call rejects it (throw) rather than rounding, because a
  rounded step would make the scenario that asked for it silently inexact.
  This runs the real simulation forward
  from a set-up state to see where it lands. Stepping only advances the live game
  (a crossing and its actors); it has no effect on a menu screen. Calling `step` (or
  `reset`) also switches the game to manual stepping — the animation loop stops
  advancing the sim from the wall clock — so successive steps advance the simulation
  by exactly the time asked for, with nothing else creeping in between calls.
- `snapshot()` returns a plain, JSON-serializable object describing the current game
  state (see [Snapshot shape](#snapshot-shape)). It is a pure read and never changes
  anything.

### Control operations

These set up a specific situation. Each one routes through the same systems normal
play uses, arranging the world rather than faking outcomes: they position actors and
lanes, and then `step` runs the real hopping, drift, collision, pursuit, scoring, and
level logic forward from there.

- `startGame()` begins a fresh run, exactly as choosing `CROSS` from the menu would:
  the playing state, level 1, a fresh crossing on the near shore with the bays empty.
- `setLevel(level)` sets the current level and rebuilds the strait for it (the
  per-level lane speeds and gaps, the shorter timer, and the second bear from level
  5), beginning a fresh crossing at that level. A precondition for exercising the
  progression without clearing levels by hand.
- `setLives(count)` sets the lives remaining.
- `setScore(points)` sets the running score. The next bonus-life milestone is
  recomputed to the next `10,000` boundary above `points`, so a later real score gain
  can cross it and award a life through the normal path.
- `setTimer(seconds)` sets the crossing timer, so a scenario can drive it toward
  expiry.
- `setBays(filled)` sets which of the 5 bays are filled. `filled` is an array of 5
  booleans, index 0 the leftmost bay. A precondition for exercising re-entry into a
  filled bay and clearing a level.
- `placeCritter(col, row)` positions the critter on a tile, through the same
  placement normal respawns use. From there `step` runs the real footing, drift, and
  collision on that tile (so it can drown on open water, be crushed by traffic, or be
  carried by a floe).
- `setLane(row, spec)` repopulates the lane at strait row `row` (an ice-band or
  water-band row) with items of that row's fixed kind, positioned at the tile columns
  in `spec.cols`. `spec` may also set `spec.speed` (tiles/second) and `spec.dir`
  (`1` for rightward, `-1` for leftward) to override the lane's motion; omit them to
  keep the lane's own values. Passing an empty `cols` clears the lane (all open water,
  or empty ice). This arranges where the vehicles and floes sit; the real
  `step`-driven motion and collision still decide every outcome.
- `setLaneMotion(row, spec)` changes how the lane at strait row `row` is moving,
  without disturbing what is in it. `spec.speed` (tiles/second) and `spec.dir` (`1`
  rightward, `-1` leftward) each override that lane's value when given and are left
  alone when omitted. Every item already in the lane keeps its exact position and
  simply travels on the new motion from the next `step`. A `speed` of `0` holds the
  lane still where it stands, and a later call sets it moving again — so traffic can be
  laid out exactly where it is wanted, left parked while the rest of the scene is
  arranged, and then released. Unlike `setLane` this never repopulates the lane, so
  positions built up over many steps are not lost to a change of speed.
- `setBear(index, state)` places a hunter's bear. `index` selects a hunter slot
  (`0`, or `1` for the second bear at level 5 and above). `state` of `{ col, row }`
  puts that bear on a tile and `{ x, y }` puts it at an exact strait-local pixel
  position — the bear glides continuously, so it is normally part-way between tiles,
  and the pixel form places it exactly there. Either form creates the bear if it has
  not yet emerged; a `state` of `null` removes it. Once placed, the real pursuit brain
  drives it from there on the next `step`.
- `setBearAI(enabled)` chooses whether the hunter's pursuit brain is running.
  `setBearAI(false)` stops the bears deciding and moving: each one holds the position
  it is in — or the one `setBear` puts it in — however many times the simulation is
  stepped, so a scene can be built around a bear that stays where it is put. It
  suspends the pursuit and nothing else: everything the world does to a bear still
  happens exactly as it would otherwise. A sliding hazard still resets it
  (`specs/hunter.md`), open water still submerges it and a floe still carries it, it
  still catches a critter that comes to it, and a bear that has been reset still
  re-emerges from the near shore on its usual delay. `setBearAI(true)` hands the
  pursuit back. It applies to every hunter slot, changes no other game state, and is
  on by default.
- `moveBear(index, direction)` sends a bear one tile in a grid direction under the
  caller's control rather than the pursuit's. `direction` is `"up"`, `"down"`,
  `"left"`, or `"right"`. The bear travels the way it always travels — the same
  continuous glide at the same speed (`specs/hunter.md`), settling on the next tile —
  so this drives the real movement rather than teleporting. It is a command rather
  than a suggestion: it does not consult the route the pursuit would have chosen, so a
  bear can be sent somewhere the pursuit would have routed around, and whatever the
  world then makes of that is the game's own business. A bear that is between tiles
  settles onto the tile it is entering before taking the commanded direction. It is
  most useful with `setBearAI(false)`, where nothing else is moving the bear.
- `setAutoStep(enabled)` chooses who advances the clock. `setAutoStep(true)` hands the
  clock back to the animation loop so the game runs itself in real time again (for
  watching a posed scenario play out, or recording a live motion clip);
  `setAutoStep(false)` returns to manual stepping via `step`. `reset` and `step`
  already switch to manual on their own, so this is only needed to go back to real
  time. It never changes any game state, only which clock drives it.

A typical check calls `startGame()`, `placeCritter`, `setLane` and/or `setBear` to
arrange the exact scenario wanted, `step()` a handful of ticks to run the real
systems, and reads the result from `snapshot()`.

### Input operations

The control operations above pose the world directly. The API can also inject
keyboard input, so a caller can drive the game the way a player does: navigate the
menus, start a run from the title, hop the critter, pause, and toggle mute. Injected
input flows through the same handling the real keyboard feeds, exercising the actual
key bindings from `specs/controls.md` rather than a parallel path. Injecting input
does not take control away from normal play: a movement key hops the critter through
the game's normal play code, so this is how a caller confirms the controls themselves
work.

- `keyDown(code)` presses a key down. `code` is a standard `KeyboardEvent.code` (for
  example `"ArrowUp"`, `"ArrowDown"`, `"ArrowLeft"`, `"ArrowRight"`, `"KeyW"`,
  `"KeyA"`, `"KeyS"`, `"KeyD"`, `"Enter"`, `"Space"`, `"Escape"`, `"KeyP"`,
  `"KeyM"`). The key becomes held (so a held direction auto-repeats hops at the hop
  cooldown while the simulation is stepped), and any one-shot action the key triggers
  on the current screen (a menu move, a confirm, a single hop, a pause, a mute toggle)
  is applied immediately.
- `keyUp(code)` releases a previously pressed key, ending its held state.
- `press(code)` is a convenience tap, a `keyDown` immediately followed by `keyUp`.
  This is the usual way to trigger a one-shot action (moving a menu selection,
  confirming it, a single hop, pausing, muting) without leaving the key held.

The usual shape for an input-driven scenario is to `press` through the menu to start
a run, then `press` a direction to hop, or `keyDown` a direction and `step` to
auto-repeat hops, reading `snapshot()` to see where the critter ended up.

## Snapshot shape

`snapshot()` returns an object with at least these fields:

```js
{
  version: 1,
  screen: "title" | "howto" | "playing" | "paused" | "victory" | "gameover",
  phase: "crossing" | "dying" | "clearing",  // the sub-phase while playing
  level: <number>,                 // current level, 1..8
  lives: <number>,                 // lives remaining
  score: <number>,                 // running score
  timer: <number>,                 // seconds left on the crossing timer
  timerMax: <number>,              // the crossing timer's full length this level
  muted: <boolean>,                // whether the mute toggle is currently on
  menuIndex: <number>,             // the highlighted item on a menu screen
  bays: [<boolean>, ...],          // the 5 bays, true where filled, left to right
  fishBay: <number> | null,        // the open bay currently holding the fish, or null
  critter: {
    col: <number>, row: <number>,  // its logical tile
    x: <number>, y: <number>,      // strait-local px of the sprite's top-left
    facing: "up" | "down" | "left" | "right",
    footing: "solid" | "floe" | "water",  // ground under it right now
  },
  bears: [
    // One entry per hunter slot. `present` is false before a bear has emerged or
    // after it has been reset; the other fields are meaningful only when present.
    { present: <boolean>, col: <number>, row: <number>,
      x: <number>, y: <number>,
      facing: "up" | "down" | "left" | "right", swimming: <boolean> },
  ],
  lanes: {
    // The eight ice-band lanes (rows 11..18) and the eight water-band lanes
    // (rows 2..9). Each item's `x` is strait-local px of its left edge and `len`
    // is its length in tiles.
    ice: [
      { row: <number>, dir: 1 | -1, speed: <number>,  // speed in tiles/second
        items: [ { kind: "plow" | "dogsled" | "car", x: <number>, len: <number> } ] },
    ],
    water: [
      { row: <number>, dir: 1 | -1, speed: <number>,
        items: [ { kind: "pan" | "raft3" | "raft4", x: <number>, len: <number> } ] },
    ],
  },
  simTime: <number>,               // accumulated simulation time, in seconds
}
```

`phase` is the sub-phase of a live game (it is meaningful only while `screen` is
`"playing"`):

- `"crossing"` — a critter is on the board and under the player's control. This is
  the phase for all of normal play.
- `"dying"` — the death pause that follows a lost life (`specs/gameplay.md`), from
  the moment the life is deducted until the fresh critter appears on the near shore.
  Every death has one, whatever caused it, so a snapshot taken at any point in that
  pause reports `"dying"` — and a caller stepping tick by tick across a death sees
  `"crossing"` become `"dying"` and then `"crossing"` again.
- `"clearing"` — a completed crossing or a filled level is being resolved. A build
  that resolves either immediately simply passes through this phase, so unlike
  `"dying"` it need not be observable between two steps.

`critter.footing` is `"solid"` on the shores, median, and ice band, `"floe"` while
standing on a floe over the water, and `"water"` while over open water (a state the
critter cannot survive past the next step). `bears[i].swimming` is true while that
bear is over open water and drawn from its swim frames. A bear's `x`/`y` are its
continuous glide position, so a caller can watch it move smoothly between tile
centers.

## The debug overlay

Provide a read-only on-screen overlay showing the game's live internal state, so you
can watch what the simulation is doing while you play. It is toggled with the
backtick key (`` ` ``), off by default, and never changes gameplay; it only draws.

When on, it draws over the running game, legibly, in the game's monospace type, at
least: the current `screen` and `phase`, the level, lives, score, and timer, the
critter's tile, pixel position, facing, and footing, and each bear's tile, pixel
position, facing, and whether it is swimming, the same facts `snapshot()` reports. It
is a diagnostic layer rather than part of the game's presentation, so keep it visually
plain and clearly separate from the HUD.
