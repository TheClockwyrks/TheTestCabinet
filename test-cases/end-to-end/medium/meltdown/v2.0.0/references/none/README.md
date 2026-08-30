# Meltdown — `none` reference implementation

The authored, **correct** reference build of the Meltdown end-to-end test case's
`base` variant on **no engine**. It is **never seeded into a run** — handing a
model the finished game would defeat the test — and takes no part in the case's
seed set. The case specs under `../../specs/` remain authoritative for the
design.

The project is the case's seeded workspace (`../../workspaces/none/`) — ten
configuration files and nothing else — with the whole of `src/` written: the
runtime the game stands on, the game, and the tests for both. What is here is
exactly what a run on no engine is asked to produce.

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

This is a self-contained static web app — plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine and no runtime
dependency at all. No backend, accounts, network calls, or API keys; everything
needed to play is in the built bundle.

The look is this build's own. The specs fix what must be **readable** — the heat
a tower is carrying, whether it has tripped, which faces are radiators, where the
surge is and how much of it is left — and leave the palette and the type to the
build. This build chose a cold instrument panel: a charcoal floor under a steel
casing, a heat ramp running blue through amber to white, a tripped tower drawn as
a dark carcass with a red band, and a surge palette of greens, cyans and magentas
that sits nowhere on that ramp, so heat and surge can never be confused. Those
choices live in `src/theme.ts`, apart from the figures the specs fix in
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

The **backtick** key (`` ` ``) toggles the diagnostics overlay. That key belongs
to the runtime (`src/overlay.ts`), not to the game, and is not one of the actions
above.

**Playing well:** rotate a tower before you place it so its radiator faces meet
open air, leave lanes between blocks so the middle of your maze can breathe, and
watch the heat reads — a gun at its redline is at full power, and a gun past it
is a hole in your line for the length of its cooldown.

## The runtime this project carries

Meltdown runs on no engine, so the layer every browser game needs is part of the
build. It is sized for **this** game rather than for every 2D game — there is no
asset loader, because Meltdown loads nothing — and it is six files:

- **`src/runtime.ts`** — the frame loop and the wiring. It measures each frame's
  delta in **seconds** (clamping the gap a backgrounded tab resumes with), clears
  the canvas, installs the logical transform, and calls `update` then `render`.
  There is no fixed timestep and no accumulator: every rate in
  `src/constants.ts` is per second and is integrated against the delta, so the
  same second of play reaches the same state however it was divided into frames.
  It also owns the **manual clock** (below).
- **`src/viewport.ts`** — the canvas fit: one uniform scale, a centered
  letterbox, and the device pixel ratio, re-derived at the top of every frame so
  no resize handler is needed. `src/render.ts` draws in logical `1280x720`
  coordinates and never reads the canvas element's size.
- **`src/keyboard.ts`** — named actions over `KeyboardEvent.code` bindings, with
  edge detection: an edge is armed when an action leaves rest, consumed by the
  first reader, and discarded at the end of its frame.
- **`src/pointer.ts`** — the page's pointer and touch events, mapped back through
  that same fit into logical stage units and delivered as a press, a move and a
  release. The game never sees a `PointerEvent`.
- **`src/audio-bus.ts`** — cues declared by name and synthesized as one
  oscillator through one gain envelope, over a Web Audio context opened on the
  first user gesture. Nothing about audio can fail a frame.
- **`src/overlay.ts`** — the diagnostics panel: the backtick key, the drawing in
  device space over the finished frame, and its read-only-ness. The game only
  names the values it shows.

`src/main.ts` is the whole of the wiring between that layer and the game.

## Debugging and automation

The build exposes the surface `specs/instrumentation.md` specifies on
**`window.__meltdown`**, so a scenario can be posed in Meltdown's own world from
code — 47 operations over a deterministic core:

- `setAutoStep(enabled)` and `advance(seconds, frames)` — the **clock**. Nothing
  outside this build owns it, so the surface carries it: `setAutoStep(false)`
  stops the loop advancing the simulation from the wall clock, and
  `advance(seconds, frames)` runs that many whole frames — the same update the
  loop runs, then a render — covering that much game time. Drawing is unaffected
  either way, so the canvas always shows the state the last frame left. Because
  every rate is integrated against the frame's delta, `advance(1, 1)` and
  `advance(1, 120)` reach the same outcome.
- `reset(options?)` and `snapshot()` — return to the title screen (seedable) and
  read a JSON-serializable view of the whole state: the run, the routes, every
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

Every operation but the two clock calls is a read or a pose of `MeltdownState`:
they arrange the world, and the game's own update is what runs from there on the
next frame. There is deliberately no `keyDown`, `keyUp` or `press` on the
surface, and no overlay toggle: the runtime owns the keyboard and the backtick
key.

The surface is inert during normal play.

**The pause is real.** Pausing is resolved in the game's own update against the
game's own clock, not in the clock the surface hands out, so a paused build
freezes on the **wall** clock: the floor holds still and `simTime` holds where it
was, whether or not anything is stepping the game. That is measured directly in
`src/game.test.ts`, over real intervals of elapsed time and without calling
`advance` at all.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed.

## Install

```sh
npm ci
```

This project depends on no runtime package at all: everything it runs on is in
`src/`, so `npm ci` installs the TypeScript toolchain and nothing else.

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
The runtime's own modules are checked directly, over a `Surface` and a frame
callback the test drives itself; the game is checked by handing it real deltas
and reading the result back from its state, the cues its update played, and the
pixels its render produced on an `@napi-rs/canvas` context.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vitest.config.ts      The build's own test suite, over src/
src/
  main.ts             Bootstrap: stand the runtime up, initialize, install, run
  runtime.ts          The frame loop, the manual clock, and the wiring
  viewport.ts         The canvas fit: uniform scale, letterbox, pixel ratio
  keyboard.ts         Named actions over key codes, with edge detection
  pointer.ts          The page's pointer, in logical stage units
  audio-bus.ts        Web Audio cues and the first-gesture unlock
  overlay.ts          The diagnostics panel and the backtick key
  constants.ts        Every figure the specs fix (logical 1280x720)
  types.ts            The vocabulary the specs are written in
  theme.ts            This build's own look: palette, type, panel layout
  defs.ts             The eight towers and six surge types, as data
  debug.ts            The window.__meltdown surface over MeltdownState
  state.ts            The whole state, and the two ways it is reset
  game.ts             The four functions the runtime drives, and the pause gate
  rng.ts              The seeded generator, over MeltdownState.rngState
  grid.ts             Blocked tiles and the two distance fields the surge walks
  towers.ts           Everything derived from a tower rather than stored on one
  units.ts            Everything derived from a surge unit
  modes.ts            What a mode and a difficulty derive
  waves.ts            The wave progression, as closed forms
  heat.ts             The heat model: cooling, conduction, movers, the trip
  combat.ts           Targeting, the fire clock, and what a shot removes
  build.ts            Placing, rotating, upgrading and selling
  sim.ts              One frame of the run
  menus.ts            The menus and where confirming a row leads
  panel.ts            The build panel's layout and its hit rectangles
  input.ts            One resolution path for every key and every press
  render.ts           All canvas drawing, in logical space, over the theme
  diagnostics.ts      The values the overlay shows
  audio.ts            The ten audio cues
  *.test.ts           The build's own tests, beside the code they cover
```
