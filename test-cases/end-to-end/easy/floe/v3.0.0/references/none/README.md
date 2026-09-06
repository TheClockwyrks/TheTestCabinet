# Floe — `none` reference implementation

The authored, **correct** reference build of the Floe end-to-end test case's
`base` variant on **no engine**. It is **never seeded into a run** — handing a
model the finished game would defeat the test — and takes no part in the case's
seed set. The case specs under `../../specs/` remain authoritative for the
design.

The project is the case's seeded workspace (`../../workspaces/none/`) — ten
configuration files, the page, and the seeded art, and nothing else — with the
whole of `src/` written: the runtime the game stands on, the game, and the tests
for both. What is here is exactly what a run on no engine is asked to produce.

---

**Floe** is a single-screen arcade crossing game for the browser. A small tundra
critter starts on the near shore of a frozen strait and works its way to the far
shore: first across eight lanes of sliding traffic, then over a solid median
shelf, then across eight lanes of open water by riding the floes drifting along
them. The far shore is a wall of solid ice cut by five bays, and a level is done
when all five are filled. A run is eight levels, each faster than the last.

Floe's defining idea is **the hunter**. A polar bear emerges on the near shore
behind the critter and pursues it across the whole strait, gliding continuously
along the grid, routing around the same traffic the critter dodges and swimming
out over the open water after it. The bear is not a lane hazard on a fixed track,
so no tile is safe to wait on and every pause is paid for in ground.

This is a self-contained static web app — plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine and no runtime
dependency at all. No backend, accounts, network calls, or API keys; everything
needed to play is in the built bundle.

The look is this build's own. The specs fix what a player must be able to read at
a glance — the five bands told apart, deep water distinct from a floe on the same
row, an open bay distinct from the shore beside it, the critter and the bear
distinct from whatever they stand on, and every readout legible — and leave the
palette, the type, the HUD's arrangement and the sprite animation rates to the
build. This build chose a cold Arctic scheme: bright pack ice on the far shore,
deep navy water, a scoured grey-blue ice band, a paler median shelf and a
wind-blown tundra near shore, with gold marking a filled bay. Those choices live
in `src/theme.ts`, apart from the figures the specs fix in `src/constants.ts`.

## Playing

The critter hops one tile at a time and holding a direction repeats at
`HOP_COOLDOWN` (0.12 s). A crossing ends when the critter lands in an open bay,
which scores the row, the bay and two points per whole second left on the
crossing timer. Filling the fifth bay clears the level; clearing level eight wins
the run.

A life is lost to a bear catching the critter, a vehicle arriving on it, standing
on open water, being carried off a side edge, or the crossing timer running out.
A run starts with three lives and earns one more at every 10,000 points.

## Controls

The game stands on no engine, so the keyboard is part of the runtime this project
carries. Keys are read as `KeyboardEvent.code`, so a binding is the same physical
key on every layout.

| Key                  | Does                                       |
| -------------------- | ------------------------------------------ |
| `↑` / `W`            | Hop up; move a menu selection up.          |
| `↓` / `S`            | Hop down; move a menu selection down.      |
| `←` / `A`, `→` / `D` | Hop left and right; move a menu selection. |
| `Enter` or `Space`   | Accept the highlighted menu item.          |
| `Esc`                | Go back a screen.                          |
| `P` or `Esc`         | Pause a live crossing.                     |
| `M`                  | Toggle mute, on any screen.                |
| `` ` ``              | Show and hide the debug overlay.           |

`Esc` drives **two** things — pause and back — and the game reads whichever the
screen in front of the player calls for: it pauses a crossing, and steps back
from the how-to, pause and end screens. `P` closes the pause menu as well as
opening it. A menu selection wraps at both ends.

**The menus also take a mouse and a finger.** Moving the pointer onto an entry
selects it; pressing and releasing inside one entry confirms it; a touch contact
selects the entry it lands on and confirms the entry it lifts on, provided the
two are the same one. `src/pointer.ts` is the layer that delivers those events
and `src/menus.ts` is where each entry's region is laid out — the same place the
renderer takes its baselines from, so the region a pointer hits is the entry a
player sees.

The four movement keys are read as **held** on the playing screen, so a held
direction hops repeatedly; everywhere else they are read as press edges, so one
press moves the selection one item.

## The runtime this project carries

Floe runs on no engine, so the layer every browser game needs is part of the
build. It is sized for this game rather than for every 2D game, and it is six
files:

- **`src/runtime.ts`** — the frame loop and the wiring. Floe's simulation runs on
  a **fixed timestep** of `TICK_HZ` (120) steps a second, so the loop measures
  each frame's elapsed time (clamping the gap a backgrounded tab resumes with),
  runs the whole `TICK_DT` ticks that time completes, and carries the remainder
  into the next frame. The leftover fraction is handed to `render` as `alpha`,
  which is what lets a body be drawn between two ticks rather than snapping 120
  times a second. It also owns the **manual clock** (below).
- **`src/viewport.ts`** — the canvas fit: one uniform scale, a centered
  letterbox, and the device pixel ratio, re-derived at the top of every frame so
  no resize handler is needed. `src/render.ts` draws in logical `1280x720`
  coordinates and never reads the canvas element's size.
- **`src/keyboard.ts`** — intents over `KeyboardEvent.code` bindings, with edge
  detection: an edge is armed when an intent leaves rest, consumed by the first
  reader, and discarded at the end of the tick it was armed in.
- **`src/pointer.ts`** — the mouse and the finger: each event mapped from CSS
  pixels into the stage's own units through the frame's fit, and paired into the
  two edges a menu is decided from — a position the player is indicating, and a
  gesture that ended carrying both of its ends.
- **`src/menus.ts`** — where each menu's entries sit and the region each is
  picked from, read by the renderer, by the rules, and by `menuItemRect` on the
  debug surface, so the three cannot disagree.
- **`src/images.ts`** — the seeded sprite art, gathered through the bundler's own
  glob so every frame's URL resolves against the page rather than the origin
  root, and the produced site runs at any base path.
- **`src/audio-bus.ts`** — cues declared by name and synthesized as one
  oscillator through one gain envelope, over a Web Audio context opened on the
  first user gesture. Nothing about audio can fail a tick.
- **`src/overlay.ts`** — the debug panel: the backtick key, the drawing in device
  space over the finished frame, and its read-only-ness. The game only names the
  values it shows.

`src/main.ts` is the whole of the wiring between that layer and the game.

## Debugging and automation

The build installs the surface `specs/instrumentation.md` specifies on
**`window.__floe`** as soon as the game has initialized, so a scenario can be
posed on Floe's own strait from code. Every operation sets one field, reads the
state, or moves the clock, and `snapshot()` reports every field a pose can set,
so every pose is verifiable by setting it and reading it back.

- **The clock** — `setAutoStep(enabled)` and `advance(ticks)`. Nothing outside
  this build owns it, so the surface carries it: `setAutoStep(false)` stops the
  loop advancing the simulation from the wall clock, and `advance(ticks)` runs
  that many whole simulation ticks, each exactly `TICK_DT`. Drawing is unaffected
  either way, so the canvas always shows the state the last tick left.
- **The core** — `reset()` returns the game to its title values, level 1 laid
  out afresh; `snapshot()` reads the whole state back as plain JSON.
- **The screen and the run** — `setScreen`, `setPhase`, `setPhaseTimer`,
  `setMenuIndex`, `setScore`, `setLives`, `setLevel`, `setReachedLevel` and
  `setTimer`. `setLevel(n)` lays the strait out for that level, because the
  sixteen lanes at that level's speeds and gaps are what a level means.
- **The world gates** — `setBearEmergence`, `setCatchTest`, `setFishCadence` and
  `setTimerRunning`, each gating one faculty of the run and nothing else, each on
  at a fresh start and restored by `reset`. They are what lets a scenario about
  the ice band run without a bear wandering into it.
- **The bodies** — `addCritter`, `removeCritter`, `setCritterTile`,
  `setCritterX`, `setCritterFacing`, `setHopCooldown` and `setBestRow`;
  `addBear`, `removeBear`, `clearBears`, `setBearTile`, `setBearPosition`,
  `setBearStep`, `setBearTarget`, and the three per-bear gates `setBearSense`,
  `setBearRouting` and `setBearTravel`.
- **The two bands** — `addVehicle`, `removeVehicle`, `clearVehicles`,
  `setVehicleX`, `addFloe`, `removeFloe`, `clearFloes`, `setFloeX`,
  `setLaneSpeed`, `setLaneDirection` and `setLanePhase`. Posing an item and
  posing a lane's motion are independent, and `setLanePhase` relays one lane
  at a chosen phase without touching its motion.
- **The bays** — `setBay`, `clearBays`, `setFishBay` and `clearFish`.

Every operation but the two clock calls arranges the strait and lets the game's
own rules run from there on the next tick, so a scenario driven from code behaves
exactly like one played by hand. There is deliberately no `keyDown`, `keyUp` or
`press` — the keyboard belongs to the runtime layer beneath the game, and a
driver dispatches real key events at the page — no overlay operation, because the
runtime owns the backtick key and the panel, and no `setMuted`: mute is reached
through the mute action and `muted` is read back from the snapshot.

The surface is inert during normal play.

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
with `index.html` at its root and the seeded art under `dist/assets/`. Serve that
directory as-is from any static file server, at the root or under a sub-path:

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
The runtime's own modules are checked directly; the game is checked by posing a
scenario through the same debugging surface a driver uses, advancing a counted
number of ticks and reading the snapshot back; and the drawing is checked by
rendering to an `@napi-rs/canvas` context and reading the pixels, with the seeded
frames loaded off this project's own `assets/` directory.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/, copies assets/ into it)
vitest.config.ts      The build's own test suite, over src/
assets/               The seeded sprite art: seven folders of per-frame PNGs
src/
  main.ts             Bootstrap: load the art, stand the runtime up, install, run
  runtime.ts          The frame loop, the fixed-tick accumulator, the wiring
  viewport.ts         The canvas fit: uniform scale, letterbox, pixel ratio
  keyboard.ts         Intents over key codes, with edge detection
  pointer.ts          The mouse and the finger, in stage units
  menus.ts            Where each menu sits, and the region each entry is picked from
  images.ts           Loading the seeded frames, page-relative
  audio-bus.ts        Web Audio cues and the first-gesture unlock
  overlay.ts          The debug panel and the backtick key
  constants.ts        Every figure the specs fix (logical 1280x720)
  theme.ts            This build's own look: palette, type, HUD, animation rates
  types.ts            The shape of the whole game state
  game.ts             The rules, the run, the screens, and the one tick
  hunter.ts           The bear: which tiles are open, its routing, its glide
  lanes.ts            The two bands, the ring their items wrap around, covering
  entities.ts         The critter and the bears: placing, footing, removal
  grid.ts             The strait's geometry, as questions the rest of it asks
  rng.ts              The game's random source, behind three helpers
  debug.ts            The window.__floe surface over the live state
  snapshot.ts         The snapshot shape, as a pure read
  diagnostics.ts      The values the overlay shows
  assets.ts           The seven folders and the frame layout of each set
  audio.ts            The ten audio cues
  render.ts           All canvas drawing, in logical space, over the theme
  harness.test-support.ts  What the build's own tests drive the game through
  *.test.ts           The build's own tests, beside the code they cover
```
