# Floe — `structured-2d` reference implementation

The authored, **correct** reference build of the Floe end-to-end test case's
`base` variant, on the
[Structured 2D](../../../../../../../packages/structured-2d) engine. Floe
supports three engines and ships one reference build per engine, so this is the
answer a run on `structured-2d` is shown. It is **never seeded into a run** —
handing a model the finished game would defeat the test — and takes no part in
the case's seed set. The case specs under `../../specs/` remain authoritative
for the design.

The project is the case's seeded workspace
(`../../workspaces/structured-2d/`) with `src/game.ts` written — and the modules
it grew beside it — and its own tests written beside the sources, so what is
here is exactly what a run on this engine is asked to produce.

---

**Floe** is a single-screen arcade crossing game for the browser. A small tundra
critter starts on the near shore of a frozen strait and works its way to the far
shore: first across eight lanes of sliding traffic, then over a solid median
shelf, then across eight lanes of open water by riding the floes drifting along
them. The far shore is a wall of solid ice cut by five bays, and a level is done
when all five are filled. There are eight levels, three lives, and a timer on
every crossing.

Floe's defining idea is **the hunter**. A polar bear emerges on the near shore
behind the critter and pursues it across the whole strait, gliding continuously
along the grid, routing around the same traffic the critter dodges and swimming
out over the open water after it as a submerged silhouette. The bear is not a
lane hazard on a fixed track, so no tile is safe to wait on and every pause is
paid for in ground.

This is a self-contained static web app — plain **TypeScript** inside the
engine's gameplay framework, drawing to an **HTML5 canvas**, bundled with
**Vite**. No backend, accounts, network calls, or API keys; everything needed to
play is in the built bundle.

## Controls

Every control is a **registered engine action** on the `dpad-4` touch layout,
bound to these keys:

| Action                           | Keys               | Does                                                                                   |
| -------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `up` / `down` / `left` / `right` | `↑↓←→` or `WASD`   | Hops the critter one tile while playing, and moves a menu's highlight on every screen. |
| `confirm`                        | `Enter` or `Space` | Accepts the highlighted menu item.                                                     |
| `back`                           | `Esc`              | Leaves the screen in front of you: how-to-play, the pause menu, and both end screens.  |
| `pause`                          | `P` or `Esc`       | Opens the pause menu from the live crossing.                                           |
| `mute`                           | `M`                | Toggles sound, on any screen.                                                          |

A held direction auto-repeats at the hop cooldown (`0.12` s), so holding a key
walks the critter. `Esc` drives **two** actions — `pause` and `back` — and the
game reads whichever the current screen calls for.

The **backtick** key (`` ` ``) toggles the engine's debug overlay. That key
belongs to the engine, not to this game.

**Watch the bear.** It travels faster on ice than in water, it will not step
into a tile a vehicle is about to sweep, and a vehicle that arrives on it takes
it off the strait — so leading it into a plow lane is the way to buy a moment.

## How the game maps onto the engine

`@test-cabinet/structured-2d` supplies the gameplay framework the game is
written _inside_, and the build's own code is the subclasses:

- **One level**, under the name `LEVELS` fixes. The engine opens `strait` and
  the game never opens another: every screen is a value of the state's `screen`
  field, so the world and its game state live for the whole session and a level
  advance in Floe's own sense rearranges the strait rather than opening a world.
  The level's `load` decodes the seven folders of seeded art, and the engine
  awaits it before any actor exists, so a body reads its frame as a plain value.
- **One game mode.** `FloeMode` (`src/game.ts`) adds the single player,
  registers the overlay's sources, and owns the **fixed-step clock**: it
  accumulates the frame's delta and advances the simulation by the whole
  `TICK_DT` (`1/120` s) ticks that delta completes, carrying the remainder, so
  the ticks run over an interval of game time are the same however that interval
  was divided into frames.
- **The strait as tagged actors.** The critter, the bears, the vehicles, the
  floes and the bonus catch are actors carrying their tags from `TAGS`
  (`src/bodies.ts`), found with `world.byTag` under the names the specification
  uses. A body's transform is its position: a centre for the critter, a bear and
  the bonus catch, and the left edge for a vehicle or a floe. None of them ticks
  — a tick of theirs would run against the frame's delta rather than the fixed
  step — so the mode's tick is the whole simulation and each body's `sync`
  chooses its frame and writes its interpolation offset afterwards.
- **Sprites and direct drawing.** Each body carries a `SpriteComponent` over its
  seeded frame; a leftward vehicle is mirrored by anchoring the frame's right
  edge on the transform and scaling `x` by `-1`, and the three-tile raft is the
  left `96 x 32` of `assets/raft/0.png` through the component's `source`.
  Everything no folder covers — the five bands, the bays, the bonus catch, the
  splashes, the HUD and the screens — is a `DrawComponent`, ordered by the layer
  table in `src/theme.ts`.
- **One controller.** `FloeController` possesses nothing: it reads the frame's
  eight actions and resolves them into the state, and because controllers tick
  first, the mode's tick consumes exactly what this frame reported.
- **State in framework objects.** `FloeState` is the world's game state and
  carries the run's figures; the bodies are the world's actors. Nothing lives in
  a module-level variable or a closure outside them, apart from the decoded art,
  which is immutable and belongs to the whole game.
- **Audio, input, rendering, the camera, the canvas fit and the overlay** — all
  the engine's. The build defines the ten `CUES` and registers the eight
  `ACTIONS` once, in `initialize`, and draws in logical 1280×720 coordinates.

## The debug and automation surface

`specs/instrumentation.md` fixes a surface for driving the game from code, and
this build implements it in `src/debug.ts`. The instance's `initialize` builds
the finished surface and **returns it**; the engine hands back exactly that
object from `engine.debug`, and that is the one way a caller reaches it. Nothing
is published on the page.

Every operation acts on the **live world** through the same systems play uses,
reading `engine.world` at the moment of the call. A pose takes only its own
arguments and returns nothing; a reading takes none and returns plain data:

```ts
engine.debug.setScreen("playing");
engine.debug.clearVehicles();
engine.debug.addCritter(20, 19);
engine.debug.addBear(20, 15);
await engine.advance(120);
const { bears } = engine.debug.snapshot();
```

Beyond `reset(options?)` and `snapshot()`, the surface poses the screen and the
run, the four **world gates** (`setBearEmergence`, `setCatchTest`,
`setFishCadence`, `setTimerRunning` — each gating one faculty so nothing a
scenario did not ask for happens), the critter, the bears with their three
per-bear faculties (`setBearSense`, `setBearRouting`, `setBearTravel`), the two
lane rosters and the per-row lane motion, and the bays and the bonus catch.
Every field a pose can set is reported by `snapshot()`, so each is verifiable by
setting it and reading it back.

Everything about _driving a browser game_ rather than about Floe is the
engine's: the scripted clocks and `engine.advance` own time, key events are
dispatched at the engine's input seam, `cue:played` reports the audio, and the
overlay is toggled by the engine's own key. The surface deliberately carries no
operation for any of them, and none for mute — that is reached through the
`mute` action, and `muted` is read back from the snapshot.

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

The engine, `@test-cabinet/structured-2d`, is a relative `file:` dependency on
the repository's `packages/structured-2d`, which npm installs as a symlink, so
this project builds and tests against the engine's current source. A run
receives the same package at `.tcab/engine/@test-cabinet/structured-2d/`
instead, so the import in the sources is the same either way.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload at the URL it prints (default
`http://localhost:5173`). The dev server also serves `assets/` from the project
root, which is the root the engine's loader resolves every frame under.

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root and the seeded art copied to `dist/assets/`. Every
URL the site requests resolves against the page rather than the origin root, so
the directory runs as-is at any base path of any static file server:

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

`npm test` runs the build's own suite **in process**: it builds a real engine
over an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, steps it
with `engine.advance` against a `ConstantClock` whose step is one simulation
tick, poses it through `engine.debug`, and reads the result back from the
world's tagged actors, the game state, the engine's events, and the pixels the
pipeline produced. No browser is involved. The pure modules — the tile map, the
seeded generator — are called directly by the tests beside them.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/, copies assets/)
vitest.config.ts      The build's own test suite, over src/
assets/               The seeded sprite art: seven folders of per-frame PNGs
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: palette, type, layers, HUD, rates
  game.ts             FloeState, the GameDefinition, the instance, and the mode
                      that owns the fixed-step clock
  bodies.ts           The strait's actors: the critter, a bear, a lane item,
                      the bonus catch, and the lookups that find them
  entities.ts         Placing and removing those bodies, and footing
  grid.ts             The strait's geometry, as derived readings
  lanes.ts            The two bands: layout, the wrap ring, motion, covering
  hunter.ts           The bear's arithmetic: open tiles, routing, the glide
  sim.ts              One tick of the whole game, and the presentation pass
  controller.ts       The player controller: the frame's actions into the state
  scenery.ts          The five bands, the bays, and the death effects
  hud.ts              The five HUD readouts
  screens.ts          The six screens and their menus
  debug.ts            The debug and automation surface (specs/instrumentation.md)
  snapshot.ts         The snapshot shape that surface returns
  diagnostics.ts      The overlay sources
  sprites.ts          Loading the seven folders, and the frame layouts
  audio.ts            The ten cue definitions, and the per-tick cue bag
  input.ts            Action registration
  rng.ts              The seeded generator, whose state lives on the game state
  harness.test-support.ts
                      The engine harness the build's own tests stand up
  *.test.ts           The build's own tests, beside what they test
```
