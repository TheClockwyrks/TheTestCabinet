# Wireworm — Debug and automation API

Wireworm ships a small debugging and automation surface so the game can be driven
and inspected from code, without touching the keyboard or waiting on real time. It
is what you use to iterate on the charge and discharge rules, reproduce a specific
worm scenario, script a scenario, and capture clean
screenshots of an exact game state. This file defines that surface. Implement all
of it, on the same footing as the game itself.

Nothing here changes how a person plays. The debug API is inert during normal
play, doing nothing until something calls it, and the debug overlay is off until
toggled.

## A deterministic core

The whole surface rests on the simulation being deterministic and steppable. Two
properties make that possible:

- Render-free core. Game state advances by stepping the simulation and must not
  depend on a canvas, on `requestAnimationFrame`, or on wall-clock time to make
  progress. Rendering reads the state, never the other way around.
- Seeded randomness. Every source of randomness the game uses, the starting node
  scatter, which edge the worm enters from, and when and where the foes spawn, runs
  off a seedable generator, so reseeding and replaying the same calls reproduces
  the same result exactly.

Given the same seed and the same sequence of API calls and steps, the game reaches
the same state every time.

## The manual clock

The simulation advances on a fixed timestep of 120 Hz — a step of exactly 1/120 of
a second of game time — supplied by a single fixed-step update that moves the whole
game forward by it. The rate is fixed rather than a suggestion, because `step(ticks)`
below advances the simulation in whole ticks of it: a tick is only a unit if its
length is fixed. Where the timestep comes from is switchable, so you can either
watch the game run in real time or drive it forward yourself one measured tick at a
time.

The game holds an `autoStep` flag, and it starts `true` (ordinary play). The
animation-frame loop advances the simulation only while `autoStep` is `true`; when
it is `false` the loop still renders every frame but does not advance the
simulation on its own. In that manual mode, `step(ticks)` below is the only thing
that moves the simulation forward, so a scripted scenario advances by exactly the
number of ticks you ask for and is reproducible regardless of machine load, with no
stray wall-clock frames slipping into a measurement.

- `reset(...)` and `step(...)` both switch the game into manual mode
  (`autoStep = false`), beginning a driver-clocked session.
- `setAutoStep(enabled)` switches back and forth: `setAutoStep(true)` lets the game
  advance itself in real time again (for watching or recording a motion clip);
  `setAutoStep(false)` returns to manual stepping.
- `keyDown`, `keyUp`, `press`, and the other control operations below do not change
  `autoStep`.

This is an ordinary manual-step-versus-run-live debugging affordance: pause the
clock to measure something exactly, let it run to watch it.

## The `window.__wireworm` object

Expose the API as a single object on the global `window.__wireworm`, installed once
the game is running. It carries a `version` number (use `1`) and the operations
below. Values are plain numbers, strings, and booleans so a caller can read them
directly. Cursor, foe, bolt, and arc coordinates are in the logical-pixel space of
`specs/overview.md`; node and worm-segment positions are tile coordinates
`(c, r)` on the grid of `specs/board.md`.

### Core operations

- `reset(options)` returns the game to its initial title state and switches to
  manual mode. `options` is optional, and `options.seed` (a number) seeds all of
  the game's randomness so a scenario replays identically.
- `step(ticks)` advances the simulation by exactly `ticks` fixed steps immediately,
  running the fixed-timestep update internally rather than waiting for real frames,
  and switches to manual mode. The unit is whole simulation ticks, not seconds: the
  timestep is 120 Hz, so one tick is 1/120 of a second, `step(1)` runs a single
  fixed step and `step(120)` advances one second of game time. Nothing is rounded
  or approximated — the number of steps asked for is the number of steps run.
  `ticks` must be a non-negative integer; `step(0)` is legal and does nothing, while
  a fractional or negative value is invalid and the call fails loudly rather than
  guessing what was meant. This runs the real systems forward from a set-up state to
  see where they land. Stepping only advances the live game (the `playing` state);
  it has no effect on a menu or end screen.
- `snapshot()` returns a plain, JSON-serializable object describing the current
  game state (see [Snapshot shape](#snapshot-shape)). It is a pure read and never
  changes anything.
- `setAutoStep(enabled)` sets the manual clock described above: `true` lets the
  game run itself in real time, `false` returns to manual stepping.

### Control operations

These set up a specific situation. Each one routes through the same systems normal
play uses, arranging the world rather than faking outcomes. To see a mechanic fire,
arrange its precondition with these, then `step()` and read the result from
`snapshot()`.

None of these operations starts a run on its own. `step()` only advances live play,
so a scenario that wants to run the simulation must first reach it — with
`enterPlay()` below (instant, for a posed scenario) or `startRun()` (a real run,
opening on its banner). Posing the world while the game sits on a menu is legal, but
nothing will move until you do.

- `enterPlay()` puts the game directly into live play (`screen` `"playing"`, `phase`
  `"active"`) and returns immediately, so a posed scenario is live the instant the
  call returns. It lays a fresh scattered field and leaves the board clear of worms
  and foes, the cursor centred in the band, and — unlike a real respawn — with **no
  level banner and no spawn-in invulnerability**, so a posed hit lands on the very
  next tick. Score, lives, and level are left as they are, so it can be called in any
  order with the other control operations. If live play is already running it does
  nothing. This is the operation a scripted check uses to reach a playable state
  without spending ticks; `startRun()` is for exercising the real entry path.
- `startRun()` starts a real run at level 1, exactly as choosing `DESCEND` from the
  menu would. The run opens on its level banner; step past it to reach live play.
- `setLevel(n)` sets the current level to `n` (`1..12`) as a precondition, and
  spawns that level's worm for it (of the level's length and cadence,
  `specs/worm.md`), so a scenario can start on a chosen level.
- `setScore(n)` sets the score directly, as a precondition.
- `setLives(n)` sets the lives remaining directly, as a precondition (for example
  to `1`, so the next hit ends the game through the real loss path).
- `setCursor(x, y)` places the defrag cursor at a logical-pixel position. The real
  band clamp still applies, so the cursor never lands outside the player band.
- `setNode(c, r, charge)` sets the node at tile `(c, r)` to `charge` (an integer in
  `{0, 1, 2, 3}`), creating the node if the tile was empty; a negative `charge`
  clears the tile. This arranges the terrain a scenario needs (an inert node, a
  charged node, a critical cluster); what a shot or the worm then does to it is
  produced by the real systems when you step.
- `clearField()` removes every node from the board, for a clean starting field.
- `setWorm(spec)` replaces the worms on the board with a single worm laid out by
  `spec`: `spec.segments` is an array of `{ c, r }` tiles with `segments[0]` the
  head and the rest trailing in order; `spec.dh` (`+1` right, `-1` left) and
  `spec.dv` (`+1` down, `-1` up) set its heading (defaulting to right and down).
  The worm then winds, charges, dives, splits, and is shot exactly like any other.
- `spawnFoe(kind, options)` adds one foe of `kind` (`"glitch"`, `"dropper"`, or
  `"corruptor"`) to the board. `options` may set `x` and `y` (logical-pixel
  position), `vx` (horizontal velocity), and, for a corruptor, `row` (the grid row
  it crawls). The foe then moves and interacts through its real behavior
  (`specs/foes.md`) when you step.
- `fire()` fires a bolt straight up from the cursor's current position now,
  bypassing the fire cadence so a scenario can shoot on demand. The bolt travels
  and resolves its hit through the real shot code as the simulation steps.

A typical check calls `enterPlay()`, uses `clearField`, `setNode`, `setWorm`, and
`setCursor` to arrange the exact situation wanted, calls `fire()`, then `step()` a
handful of ticks to run the real resolution and reads the result from `snapshot()`.
A check that means to exercise the real entry path uses `startRun()` instead and
steps past the banner to reach live play.

### Input operations

The control operations above pose the world directly. The API can also inject
keyboard input, so a caller can drive the game the way a player does: navigate the
menus, start a run, pause, toggle mute, move the cursor by holding a movement key,
and fire by holding the fire key. Injected input flows through the same handling the
real keyboard feeds, exercising the actual key bindings from `specs/controls.md`
rather than a parallel path. Injecting input does not switch the manual clock, so a
held movement key moves the cursor through the game's normal play code as the
simulation is stepped, which is how a caller confirms the controls themselves work.

- `keyDown(code)` presses a key down. `code` is a standard `KeyboardEvent.code`
  (for example `"ArrowLeft"`, `"ArrowRight"`, `"ArrowUp"`, `"ArrowDown"`, `"KeyA"`,
  `"KeyD"`, `"KeyW"`, `"KeyS"`, `"Space"`, `"Enter"`, `"Escape"`, `"KeyP"`,
  `"KeyM"`). The key becomes held, so a movement key drives the cursor and a held
  fire key fires while it is held and the simulation is stepped, and any one-shot
  action the key triggers on the current screen (a menu move, a confirm, a pause, a
  mute toggle) is applied immediately.
- `keyUp(code)` releases a previously pressed key, ending its held state.
- `press(code)` is a convenience tap, a `keyDown` immediately followed by `keyUp`.
  This is the usual way to trigger a one-shot action (moving a menu selection,
  confirming it, pausing, muting) without leaving the key held.

The usual shape for an input-driven scenario is to `press` through the menu to
start a run, then `keyDown` a movement or fire key and `step` (or let real time
pass) so the cursor moves or a bolt fires, then `keyUp` to release it, reading
`snapshot()` to see what happened.

## Snapshot shape

`snapshot()` returns an object with at least these fields:

```js
{
  version: 1,
  screen: "title" | "howto" | "playing" | "paused" | "victory" | "gameover",
  phase: "banner" | "active" | "respawn",  // sub-phase while screen === "playing"
  menuIndex: <number>,                      // highlighted row on a menu / end screen
  score: <number>,
  lives: <number>,
  level: <number>,                          // 1..12
  reachedLevel: <number>,                   // the level reached, for the end screens
  muted: <boolean>,                         // whether the mute toggle is on
  wormStepInterval: <number>,               // seconds per worm tile step at this level
  cursor: { x: <number>, y: <number>, invulnerable: <boolean> },
  // Every node currently on the board, each with its charge (0..3).
  nodes: [ { c: <number>, r: <number>, charge: <number> } ],
  // Every worm on the board; segments[0] is the head, the rest trail in order.
  worms: [
    {
      segments: [ { c: <number>, r: <number> } ],
      dh: <number>,       // horizontal heading: +1 right, -1 left
      dv: <number>,       // vertical heading: +1 down, -1 up
      diving: <boolean>,  // riding straight down a critical column
    },
  ],
  // Every foe on the board.
  foes: [
    {
      kind: "glitch" | "dropper" | "corruptor",
      // `vx`/`vy` are the foe's ACTUAL current velocity in logical px/s — what its
      // position is changing by right now, including any weave or dart its movement
      // applies. A foe whose horizontal motion reverses reports a `vx` that reverses
      // sign with it; reporting only an underlying drift while the foe visibly moves
      // some other way does not meet this contract.
      x: <number>, y: <number>, vx: <number>, vy: <number>,
      firstHit: <boolean>,  // a dropper that has taken its speed-up hit
    },
  ],
  bolts: [ { x: <number>, y: <number> } ],
  // Live discharge arcs, present only in the moments after a detonation.
  arcs: [ { x1: <number>, y1: <number>, x2: <number>, y2: <number> } ],
  simTime: <number>,  // accumulated simulation time, in seconds
}
```

`cursor.invulnerable` is `true` during the brief spawn-in invulnerability after a
respawn. A node absent from `nodes` is an empty tile. `arcs` is empty except in the
brief window while a discharge is drawn, so a detonation is visible as it fires.

## The debug overlay

Provide a read-only on-screen overlay showing the game's live internal state, so
you can watch what the simulation is doing while you play. It is toggled with the
backtick key (`` ` ``), off by default, and never changes gameplay; it only draws.

When on, it draws over the running game, legibly, in the game's monospace type, at
least: the current `screen` and `phase`, the score, lives, and level, the count of
nodes on the board, each worm's length, head tile, headings, and diving flag, each
foe's kind and position, and the cursor's position, the same facts `snapshot()`
reports. It is a diagnostic layer rather than part of the game's presentation, so
keep it visually plain and clearly separate from the HUD.
