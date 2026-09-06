# Meltdown — `structured-2d` reference implementation

The authored, **correct** reference build of the Meltdown end-to-end test case's
`base` variant on the **Structured 2D** engine. It is **never seeded into a
run** — handing a model the finished game would defeat the test — and takes no
part in the case's seed set. The case specs under `../../specs/` remain
authoritative for the design.

The project is the case's seeded workspace (`../../workspaces/structured-2d/`)
with the whole of `src/game.ts` and the modules beside it written. What is here
is exactly what a run on this engine is asked to produce, with one deliberate
difference: the engine is resolved by a relative `file:` path into this
repository's `packages/structured-2d/` rather than from the vendored copy a
seeded run gets, so the reference is always built against current engine source.

---

**Meltdown** is an open-field tower-defense game for the browser, played on the
floor of a reactor. Waves of surge intruders pour in through two vents cut into
the casing wall and cross the floor toward the exhausts opposite; you stop them
by building emitter towers on the open floor.

There is no fixed path. **Every tower is also a wall**, so the maze the surge
walks is the one you build, and the surge re-routes the instant the floor
changes. Winding it the long way round is how the guns get the time they need.

Meltdown's defining idea is **heat as power**. An emitter fires harder the hotter
it runs, climbing to full power at its own redline and holding it there — and an
emitter carried all the way to the top of the scale **trips offline** to cool,
leaving a hole in the defense. A tower sheds heat only through the faces that
touch open air, so a tight block of guns bakes its own core, and each tower's
radiator faces are aimed by **rotating it before it is placed**. Two structures
sculpt the heat rather than firing: a thermostatic **Forge** that warms its
neighbours toward a setpoint, and a **Sink** that draws heat out through a face
nothing else can cool through. The cryo **Rime** runs the rule backward and slows
hardest when it is cold.

This is a self-contained static web app — **TypeScript** on the Structured 2D
engine, bundled with **Vite**. No backend, accounts, network calls, or API keys;
everything needed to play is in the built bundle.

The look is this build's own. The specs fix what must be **readable** — the heat
a tower is carrying, whether it has tripped, which faces are radiators, where the
surge is and how much of it is left — and leave the palette and the type to the
build. This build chose a cold instrument panel: a charcoal floor under a steel
casing, a heat ramp running blue through amber to white, a tripped tower drawn as
a dark carcass under red hazard stripes, and a surge palette of greens, cyans and
magentas that sits nowhere on that ramp, so heat and surge can never be confused.
Those choices live in `src/theme.ts`, apart from the figures the specs fix in
`src/constants.ts`.

## Modes

- **Containment** — the standard run, at **Easy**, **Medium**, or **Hard**. The
  only mode with a difficulty; it sets the starting money and the wave count.
- **The Hundred** — one onslaught instead of a progression.
- **Deep Pockets** — money is no object, and no interest is paid.
- **Bottleneck** — building is confined to a marked central zone.
- **Sudden Death** — one life.

A run is won by clearing its last wave and lost when the lives reach zero.

## Controls

Meltdown is **built with the pointer and driven with the keys beside it**. Every
interaction and every menu is reachable with the pointer alone, so the game is
fully playable on a touchscreen.

**With the pointer:** a press and release inside one region is one interaction —
a menu row, a shop entry, a panel control, or the floor. With a placement armed,
the held footprint follows the pointer across the floor; a press on a valid
footprint places it, and on an invalid one builds nothing and spends nothing.
With nothing armed, a press on a placed tower selects it and opens its inspector.

**With the keys**, each bound to a physical key (`KeyboardEvent.code`), so the
bindings survive a non-QWERTY layout:

| Action         | Key       | Does                                            |
| -------------- | --------- | ----------------------------------------------- |
| `up`/`down`    | `↑` / `↓` | Moves the highlighted menu row.                 |
| `left`/`right` | `←` / `→` | The same, on the other axis.                    |
| `confirm`      | `Enter`   | Takes the highlighted row.                      |
| `back`         | `Esc`     | Cancels, deselects, pauses, or leaves a screen. |
| `pause`        | `P`       | Opens the pause screen and returns from it.     |
| `mute`         | `M`       | Toggles sound, on any screen.                   |
| `arm1`–`arm8`  | `1`–`8`   | Arms the eight shop types, in shop order.       |
| `rotate`       | `R`       | Turns the held preview one step.                |
| `send`         | `Space`   | Sends the next wave, or begins Wave 1.          |
| `speed`        | `F`       | Toggles the game speed between 1x and 2x.       |
| `upgrade`      | `U`       | Upgrades the selected tower.                    |
| `sell`         | `S`       | Sells the selected tower.                       |

`back` resolves in order — it cancels a held placement first, then deselects,
then pauses from live play, and only then leaves the screen — so one key does the
obvious thing whatever is on screen. Every action fires once per press: holding a
key down does not repeat it.

The **backtick** key (`` ` ``) toggles the engine's diagnostics overlay. That key
belongs to the engine, not to the game, and is not one of the actions above.

**Playing well:** rotate a tower before you place it so its radiator faces meet
open air, leave lanes between blocks so the middle of your maze can breathe, and
watch the heat reads — a gun at its redline is at full power, and a gun past it
is a hole in your line for the length of its cooldown.

## How the game sits on the engine

The engine owns the frame loop and its delta time, rendering and the camera, the
canvas fit, the keyboard and the pointer, the audio bus and its first-gesture
unlock, and the debug overlay. `src/main.ts` is the whole of the wiring: it
stands the engine up over the page's canvas at the logical `1280x720` field,
binds the game, and runs.

The game is written inside the engine's framework, and the shape is small:

- **One game definition, one level.** The game opens `LEVELS.floor` and never
  opens another — every screen is a value of the state's `screen` field, so the
  world and its game state live for the whole session.
- **One game instance.** Its `initialize` registers every action in `ACTIONS`
  against the keys `BINDINGS` gives it, defines the ten cues, and returns the
  debug surface the engine hands back from `engine.debug`.
- **One game mode.** Its `gameStateClass` is `MeltdownState`, the authoritative
  state `specs/state.md` declares; its `beginPlay` adds the single player and
  registers the diagnostic sources; and **its `tick` is where the whole
  simulation advances**. That placement is a requirement rather than a
  preference: the engine runs the mode after every actor has ticked, so the mode
  sees a settled world and knows the frame's shot counts, which is exactly what
  the two-phase heat model needs. A per-tower actor tick could not do it — an
  actor ticking in spawn order would read some neighbours' new heats and some
  neighbours' old ones, which is what `specs/heat.md` forbids.
- **One player controller.** It is the one place the frame's actions and the
  engine's ordered pointer samples are read, because an action's edge is
  consume-on-read and two readers would split a single press.
- **Actors that draw and hold nothing.** Every tower and every surge unit is an
  actor carrying its tag from `TAGS`, but each one holds only the id of the
  roster entry it draws and reads that entry off the world's state at the call.
  `syncActors` keeps the actor set level with the rosters, at the end of each
  tick and after any debug pose that adds or removes an entity.

**Meltdown attaches no colliders.** Range is a distance from a footprint centre,
splash is a distance from an impact, and the maze is a set of blocked tiles, so
the engine's collision pass reports nothing and the routes live on the game
state as derived data rebuilt whenever the blocked set changes.

## Debugging and automation

The game instance's `initialize` returns the surface `specs/instrumentation.md`
specifies, and the engine hands that same object back from **`engine.debug`** —
the one way a caller reaches it. Nothing is installed on the page. Every
operation acts on the live world at the moment it is called: a **pose** takes
only the arguments its heading names, arranges the running game through the same
systems play uses, and returns nothing; a **reading** returns plain data built at
the call and changes nothing.

- `reset()` and `snapshot()` — return to the title screen and read a
  JSON-serializable view of the whole state: the run, the routes, every
  panel control's hit rectangle, every tower with its live heat, damage and
  radiator faces, and every surge unit.
- The **run**: `setScreen`, `setPhase`, `setMenuIndex`, `setMode`,
  `setDifficulty`, `setMoney`, `setLives`, `setScore`, `setWave`,
  `setBuildTimer`, `setWavePending`, `setSpeed` — each sets its field alone and
  runs no entry effect, because reaching an entry effect is what the run's own
  transitions are for.
- The **world gate**: `setWaveSpawning(false)` stops the run releasing surge of
  its own accord, so a scenario can put exactly the units it means on the floor
  and nothing else arrives.
- The **vent pose** and the **vent draw**: `setSpawnVent("left" | "top" | null)`
  fixes the vent every unit the run releases enters at in place of the draw,
  and `null` returns the release to the draw; `drawVent()` performs one draw on
  its own and returns the vent, so a scenario can sample the draw without
  releasing anything.
- The **towers**: `addTower`, `removeTower`, `clearTowers`, and the poses
  `setTowerHeat`, `setTowerTripped`, `setTowerTripTimer`, `setTowerLevel`,
  `setTowerFresh`, plus two gates — `setTowerFiring` and `setTowerThermal` —
  that separate a tower's gun from its thermal model, so either can be watched
  with the other held still.
- **Building**, through the real code: `setArmed`, `setPreview`,
  `setPreviewRotation`, `place`, `setSelected`, `setHoverShop`, `upgradeTower`
  and `sellTower` spend, refund and re-pave the floor exactly as a player's press
  does.
- The **surge**: `addUnit`, `removeUnit`, `clearSurge`, and the poses
  `setUnitPosition`, `setUnitHp`, `setUnitMaxHp`, `setUnitSlow`,
  `setUnitSlowTimer`, and a `setUnitMotion` gate.
- The **pointer**: `pointerDown`, `pointerMove` and `pointerUp` report an event
  down the game's own pointer path, so a posed press and a player's press are the
  same event. They resolve silently — an operation of this surface resolves
  outside the frame loop, and a cue belongs to a frame.

There is no clock operation and no keyboard operation on the surface: the clock,
the keyboard, the audio bus and the overlay are the engine's. A caller advances
the game with `engine.advance(n)` against a clock of its own, and drives keys by
dispatching keyboard-shaped events at the engine's event target. There is no
`setMuted` either — mute is reached the way a player reaches it, through the `M`
binding or the panel's mute control, and the snapshot reports the result.

The surface is inert during normal play.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed.

## Install

```sh
npm ci
```

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload at the URL it prints (default
`http://localhost:5173`).

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root. Serve that directory as-is from any static file
server:

```sh
npm run preview        # serves dist/ locally for a final check
```

## Checks

```sh
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier --check
npm test               # vitest, with coverage over src/
```

`npm test` runs the build's own suite **in process**, with no browser involved.
`src/harness.ts` stands a real engine up over an `@napi-rs/canvas` canvas and a
`SurfaceMetrics` of its own, steps it with `engine.advance` against a
`ConstantClock`, drives keys and the pointer by dispatching events at that
surface's event target, and reads the result back from the world's own
`MeltdownState`, the debug surface `initialize` returned, the engine's
`cue:played` events, and the pixels the render produced.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vitest.config.ts      The build's own test suite, over src/
src/
  main.ts             Bootstrap: create the engine, bind the game, run
  game.ts             The game definition, MeltdownState, and the framework objects
  constants.ts        Every figure the specs fix (logical 1280x720)
  theme.ts            This build's own look: the heat ramp and the palette
  copy.ts             The prose the screens draw, beside the copy the specs fix
  geometry.ts         The tile grid, footprints, faces and openings
  routes.ts           The surge's step rule, as two distance fields
  stats.ts            Everything derived from a tower or a unit rather than stored
  waves.ts            What a mode derives, and the wave progression
  heat.ts             The heat model, resolved in two phases, and the trip
  combat.ts           Targeting, the fire clock, and what a shot removes
  surge.ts            Crossing the floor, leaking, and the wave spawner
  build.ts            The placement atoms and the acts a player performs
  run.ts              The run's phases, its clocks, and its four income lines
  flow.ts             The screens, the menus, and what starts a run
  sim.ts              One frame of the simulation, in the order the specs fix
  layout.ts           Where the panel put each control, and each menu's rows
  pointer.ts          One resolution path for every press, posed or played
  input.ts            The actions the game registers, against their bindings
  controller.ts       The one seat the frame's input is read from
  actors.ts           The floor's bodies, and syncing them to the rosters
  render.ts           All canvas drawing, in logical space, over the theme
  audio.ts            The ten cues, declared once and played from the frame loop
  diagnostics.ts      The values the engine's overlay shows
  debug.ts            The surface initialize returns and engine.debug hands back
  harness.ts          The headless engine the build's own suite drives
  *.test.ts           The build's own tests, beside the code they cover
```
