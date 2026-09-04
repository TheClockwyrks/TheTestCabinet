# Floe — `simple-2d` reference implementation

The authored, **correct** reference build of the Floe end-to-end test case, on
the [Simple 2D](../../../../../../../packages/simple-2d) engine. It is the answer
a run on `simple-2d` is compared against. It is **never seeded into a run** —
handing a model the finished game would defeat the test — and takes no part in
the case's seed set. The case specs under `../../specs/` remain authoritative for
the design.

The project is the case's seeded workspace with `src/game.ts` implemented, the
game split across new modules beside it, and its own tests written alongside, so
what is here is exactly what a run on this engine is asked to produce.

---

**Floe** is a single-screen arcade crossing game, played in the browser on a
frozen strait at blue hour. A small tundra critter starts on the near shore and
hops its way to the far shore: first across **eight lanes of sliding traffic** —
plows, dogsleds, and cars, each lane at its own speed and direction — then over a
solid median shelf, then across **eight lanes of open water**, riding the floes
drifting along them. The far shore is a wall of solid ice cut by **five bays**,
and a level is done when all five are filled. A run is eight levels, each faster
and gappier than the last, under a crossing timer that shortens as it climbs.

Floe's defining idea is **the hunter**. A polar bear emerges on the near shore
behind the critter and pursues it across the whole strait, gliding continuously
along the grid, routing around the same traffic the critter dodges, and swimming
out over the open water after it as a submerged silhouette. It is not a lane
hazard on a fixed track, so no tile is safe to wait on and every pause is paid
for in ground. Traffic takes a bear off the strait as readily as it takes the
critter, so leading one into a plow lane is a real move. From level 5 a second
bear hunts beside the first.

The polar-strait look — a five-band palette that steps down in lightness from the
bright far shore to the deep navy water, so the two safe strips read lighter than
the two crossing zones on either side — is this build's own: the specification
fixes the rules and the geometry and deliberately leaves the palette, the type,
and the animation rates to the build, so the look lives in `src/theme.ts` rather
than beside the case-fixed figures in `src/constants.ts`. The critter, the bear,
the three vehicles, and the two floes are drawn from the **sprite art seeded with
the case** under `assets/`; everything else — the strait, the bays, the bonus
catch, the HUD, and every screen — is drawn in code.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts,
network calls, or API keys; everything needed to play is in the built bundle.

## The six screens

`title` (the menu), `howto` (how to play), `playing` (the live crossing),
`paused` (a frozen strait behind a menu), `victory` (the run won), and `gameover`
(the run lost).

## Controls

Every control is a **registered engine action** on the `dpad-4` layout; the game
never reads a key event itself.

| Action                           | Keys               | Does                                                                                                                            |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `up` / `down` / `left` / `right` | Arrows or `WASD`   | On `playing`, hops the critter one tile that way; a held direction auto-repeats. Elsewhere, moves the menu highlight, wrapping. |
| `confirm`                        | `Enter` or `Space` | Accepts the highlighted menu item.                                                                                              |
| `back`                           | `Esc`              | Leaves the screen in front of you.                                                                                              |
| `pause`                          | `P` or `Esc`       | Opens the pause menu from `playing`.                                                                                            |
| `mute`                           | `M`                | Toggles sound, on any screen.                                                                                                   |

`Esc` drives both: on `playing` it pauses, and on every other screen it goes
back. `P` closes the pause menu as well as opening it.

**The menus also take a mouse and a finger**, through the engine's pointer rather
than through a registered action. Moving the pointer onto an entry selects it;
pressing and releasing inside one entry confirms it; a touch contact selects the
entry it lands on and confirms the entry it lifts on, provided the two are the
same one. `src/menus.ts` is where each entry's region is laid out — the same
place the renderer takes its baselines from, so the region a pointer hits is the
entry a player sees.

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows
the screen and phase, the level, lives, score, and timer, the critter's tile,
centre, facing, and footing, each bear's tile, centre, facing, swim flag, and
target, how many vehicles and floes are on the strait, and which bays are
filled. That key belongs to the engine, not to this game.

## What the engine owns

`@test-cabinet/simple-2d` supplies everything that is the same in every browser
game, and none of it is written here: the frame loop and its delta time in
seconds, the state held by value and handed out `DeepReadonly`, the canvas fit
(uniform scale, centered letterbox, device pixel ratio), named keyboard actions
with edge detection, the asset loader that resolves every path under the fixed
`assets/` root relative to the page, audio cue synthesis with mute and the
first-gesture unlock, and the debug overlay. What is left is the game: the
strait, the lanes, the hop, the hunt, the run, the drawing, and the state the
debug surface poses.

**The fixed step is not the engine's.** `specs/overview.md` fixes the simulation
at `TICK_HZ` (`120`) steps a second; the engine hands `update` the frame's real
elapsed seconds, and turning that into whole `TICK_DT` ticks with the remainder
carried is this build's own work, in `src/simulate.ts`.

## The state is a value

Nothing in this build writes to a state it was handed. Every field of `FloeState`
is `readonly` and every array a `readonly` array, so the declared type and the
`DeepReadonly` view the engine hands out are the same shape. What `update` and
every debug pose do instead is **copy** the state they were given into a `Sim` —
a field-for-field mirror of `FloeState` with the `readonly` markers dropped —
advance that, and return it, which is what lets the rules read as the rules
(`bear.x += travel` is the sentence `specs/hunter.md` writes) while the
immutability the engine requires is enforced at the one boundary where it
matters. There is no module-level game state and no closure over mutable data;
`render` and every diagnostic source are reads of the state they are given.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes, **through the engine**: `src/debug.ts` builds it, `initialize` returns it
beside the state as `[state, createDebugApi()]`, and a caller reads that same
object back off **`engine.debug`**. Nothing is published on the page.

Every operation is a pose or a reading over `FloeState`, written in the shape of
`update`:

```ts
engine.apply((s) => engine.debug.setScreen(s, "playing"));
engine.apply((s) => engine.debug.setLevel(s, 3)); // lays the strait out for it
engine.apply((s) => engine.debug.clearVehicles(s));
engine.apply((s) => engine.debug.addCritter(s, 20, 19));
engine.apply((s) => engine.debug.addBear(s, 20, 10));
const { bears, critter } = engine.debug.snapshot(engine.state);
```

Each pose sets **one field** and takes scalars, and `snapshot` reports every
field a pose can set, so every operation is verifiable by setting it and reading
it back. Beside the poses are four **world gates** — `setBearEmergence`,
`setCatchTest`, `setFishCadence`, `setTimerRunning` — and three **per-bear
gates** — `setBearSense`, `setBearRouting`, `setBearTravel` — each gating one
faculty and leaving the rest of the game running exactly as it does in play, so a
scenario is posed holding only what it is about. Everything about _driving a
browser game_ — the clock, exact frames, key events, the overlay, the mute bit —
is the engine's, which is why the surface carries no `advance`, no `keyDown`, and
no `setMuted`. The surface is inert during normal play.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed.

## Install

From the repository root, install the npm workspace and build its packages:

```sh
npm ci && npm run build:packages
```

Then, in this directory:

```sh
npm ci
```

The engine, `@test-cabinet/simple-2d`, is a relative `file:` dependency on the
repository's `packages/simple-2d`, which npm installs as a symlink, so this
project builds and tests against the engine's current source. A run receives the
same package at `.tcab/engine/@test-cabinet/simple-2d/` instead, so the import in
the sources is the same either way.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload at the URL it prints (default
`http://localhost:5173`). The dev server serves `assets/` from the project root,
which is the same path the engine's loader resolves against in the built site.

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root and the seeded sprite art copied to
`dist/assets/`. Serve that directory as-is from any static file server, at the
root or under a sub-path:

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

`npm test` runs the build's own suite **in process**: `src/units.test.ts` calls
the pure pieces directly, where a figure can be asserted exactly rather than
after a tick's worth of integration; `src/engine.test.ts` stands a real engine up
over an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, steps it with
`engine.advance` against a `ConstantClock` at the simulation's own rate, drives
the keyboard by dispatching events at the surface's event target, poses scenarios
through `engine.apply`, and reads results back from the state, the debug surface,
and the engine's cue events; `src/render.test.ts` reads the pixels the render
produced. No browser is involved.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/, copies assets/ into it)
vitest.config.ts      The build's own test suite, over src/
assets/               The sprite art seeded with the case: seven folders
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: palette, type, animation rate
  game.ts             The FloeState contract and the three functions the engine
                      drives; per-frame input, muting, and cue wiring
  sim.ts              The writable mirror one transition is built in
  simulate.ts         One tick, and the fixed-step frame the ticks run under
  strait.ts           The strait's geometry and the one covering rule
  lanes.ts            The sixteen lanes: layout, wrap, per-level scaling
  critter.ts          Footing, the hop and its five refusals, the floe carry
  hunter.ts           The bear: sense, routing, travel, emergence, the catch
  fish.ts             The bonus catch's cadence
  scoring.ts          Every award, and the bonus lives the score earns
  flow.ts             The run, the six screens, and every transition between
  screens.ts          What a frame's input does to the screen in front of you
  timing.ts           When a countdown has run out
  rng.ts              The seeded generator: a draw beside the next state
  input.ts            The registered actions and their edge reads
  audio.ts            The ten engine cues, played once per event per tick
  assets.ts           The seven sprite folders, loaded through the engine
  render.ts           All canvas drawing, in logical space
  diagnostics.ts      The values the engine's overlay shows
  debug.ts            The debug surface: poses and readings over FloeState
  snapshot.ts         The plain projection the surface reads
  *.test.ts           The build's own tests, beside the code they cover
```
