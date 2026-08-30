# Spectra — Overload on `simple-2d`, reference implementation

The authored, **correct** reference build of the Overload variant of the Spectra
end-to-end test case, on the
[Simple 2D](../../../../../../../../packages/simple-2d) engine. It is the answer a
run on this engine and this variant is compared against. It is **never seeded into
a run** — handing a model the finished game would defeat the test — and takes no
part in the case's seed set. The case specs under `../../../specs/` remain
authoritative for the design.

The project is the case's seeded workspace
(`../../../workspaces/overload/simple-2d/`) with `src/game.ts` implemented, the
game split across new modules beside it, and its own tests written alongside, so
what is here is exactly what a run on this engine is asked to produce.

---

**Spectra** is a fixed-position formation shooter. A resonator-fighter holds a lane
along the bottom of a starfield while a swarm of drones flies in from above,
assembles into a slowly swaying block, and peels off one at a time to dive at the
ship.

Its defining idea is **polarity**. Everything that can be shot or can shoot is tuned
to one of two spectral bands, cyan or magenta, and the ship holds one at a time.
That band is the only band its shots destroy, and it is also the band its hull
absorbs, so the tuning that lets the player kill what is in front of them is the
tuning that decides what can kill them. A formation always holds both bands, and the
flip costs a beat of fire, so clearing a wave is a run of timed band changes rather
than a stream of shots.

Three drones press on that differently. A **Shard** holds one band. A **Flux**
oscillates between them on a telegraphed rhythm and can be destroyed on neither
while it shimmers. A **Prism** wears a shell of one band around a core of the other,
and swaps the whole field's bands if a dive carries it to the bottom. Absorbing fire
and matching kills fill the resonance meter; a full meter pays one discharge, which
takes every diver on the field. Every third stage is a non-firing challenge flyover.

**Overload** is the mode this build ships. A wrong-band shot does not go to waste: it
feeds the drone it hits, and the third charge tips it over. A Shard plunges headlong
at the ship, a Flux flips its band and sprays three shots of the new one, and a Prism
bursts both bands and calls in another Shard while its shell still stands.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts, network
calls, or API keys; everything needed to play is in the built bundle.

## The look

The near-black void, its three-depth starfield, the cold HUD chrome and the violet
wash a spectral inversion lays over the field are this build's own. The
specification fixes the rules and the geometry and deliberately leaves the palette,
the type and the layout to the build, stating only what a player has to read at a
glance. So the look lives in `src/theme.ts` rather than beside the case-fixed
figures in `src/constants.ts`, which carries no colour and no typeface at all.

The **two band colours are read off the seeded art** rather than invented:
`assets/shard.png` is drawn in `#ff4ec7` and the cyan half of `assets/flux.png` in
`#34e2ff`, so a code-drawn bullet, the resonance meter and the polarity indicator
all carry the same pair the sprites do. Cyan takes the **ring** accent and magenta
the **diamond**, everywhere either band appears, so the two stay apart for a
colourblind player.

The ship and the three drones are drawn from the seeded art under `assets/`, each
centred on its entity and scaled to its own footprint. One silhouette serves both
bands: the seeded bitmap is drawn as it is, and then drawn again over its own alpha
through a canvas filter that flattens it to the band's colour, so the shape on
screen is always the seeded shape and only the colour and the accent change. Each
kind takes a different tint strength and a different core, so a Shard, a Flux, a
Prism and the ship of one band are four readings rather than one. A destroyed drone
pops with the seeded particle system, simulated with `ParticleSimulator` and
composited additively. Everything else — the field, the starfield, every bullet, the
discharge wave, the inversion's mark, both HUD strips, every screen and all text —
is drawn in code.

## Controls

Every keyboard control is a **registered engine action** on the
`dpad-4-two-buttons` layout, with `discharge` registered beyond it:

| Action           | Keys                  | Does                                                           |
| ---------------- | --------------------- | -------------------------------------------------------------- |
| `left` / `right` | Arrows or `A` / `D`   | Moves the ship along its lane.                                 |
| `up` / `down`    | Arrows or `W` / `S`   | Moves a menu highlight.                                        |
| `a`              | `Space`, `Up`, `W`    | Fires, every `0.16` s while held, up to three in flight.       |
| `b`              | `F` or either `Shift` | Flips the ship's band, at the cost of a `0.30` s fire lockout. |
| `discharge`      | `X`                   | Releases a discharge, on a full meter.                         |
| `confirm`        | `Enter` or `Space`    | Takes the highlighted menu item.                               |
| `back`           | `Esc`                 | Leaves the current screen.                                     |
| `pause`          | `P` or `Esc`          | Pauses live play, and resumes it.                              |
| `mute`           | `M`                   | Toggles sound, on any screen.                                  |

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows the
screen, phase and stage, the run's score, lives and meter, the inversion, the ship,
every drone with its stored and effective bands, its phase, its shimmer, its shell
and its charge, and how many bullets and bursts are live. That key belongs to the
engine, not to this game.

## What the engine owns

`@test-cabinet/simple-2d` supplies everything that is the same in every browser
game, and none of it is written here: the frame loop and its delta time in seconds,
the state held by value and handed out `DeepReadonly`, the canvas fit (uniform
scale, centred letterbox, device pixel ratio), named keyboard actions with edge
detection, audio cue synthesis with mute and the first-gesture unlock, asset loading
under the fixed `assets/` root, and the debug overlay. What is left is the game.

## The state is a value

Every field of `SpectraState` is `readonly` and every array a `readonly` array, so
the declared type and the `DeepReadonly` view the engine hands out are the same
shape, and nothing in this build writes to a state it was handed. What a frame does
instead is copy the state into `Sim` — a field-for-field mutable mirror in
`src/sim.ts` — advance that, and return it, which keeps each rule readable as the
rule while the immutability the engine requires is enforced at the one boundary
where it matters. There is no module-level game state and no closure over mutable
data; `render` and every diagnostic source are reads of the state they are given,
and the compiler is what says they cannot change it.

**Every rate is per second, and a frame is divided into whole sub-steps.** An update
covering `dt` runs `max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of `dt / n` seconds
each, and each one advances every moving thing and then resolves contacts in the
order `specs/simulation.md` fixes. The whole game runs inside that loop, screens
included, so one second of game time reaches the same state whether it arrived as
one frame, as sixty, or as a hundred and twenty.

**Every drone's path is a function of its own declared fields.** Nothing holds a
heading or a waypoint of its own: an entrance is a pursuit of its slot along a curve
that straightens as it goes, a dive is a descent that bends toward the ship's
current x, and a challenge sweep is a weave across the field. That is what lets the
debug surface pose a drone and have the game's own motion run from there.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes, **through the engine**: `src/debug.ts` builds it, `initialize` returns it
beside the state as `[state, createDebugApi()]`, and a caller reads that same object
back off **`engine.debug`**. Nothing is published on the page.

Every operation is a pose or a reading over `SpectraState`, written in the shape of
`update`, and each pose sets one field and takes scalars:

```ts
engine.apply((s) => engine.debug.addDrone(s, "prism", 640, 200));
engine.apply((s) => engine.debug.setDroneBand(s, 1, "magenta"));
engine.apply((s) => engine.debug.addPlayerBullet(s, 640, 400, "magenta"));
await engine.advance(20);
const { drones, bullets, score } = engine.debug.snapshot(engine.state);
```

Beside the core (`reset`, seedable, and `snapshot`) it carries the screen and run
poses, the three **world gates** — `setWaveEntry`, `setDiveLaunching` and
`setShipContact`, each gating one faculty of the wave itself so a posed scenario is
not invaded by entities its requirement never asked for — the wave's dive clock, the
ship and its cannon, the meter and the inversion, the per-drone poses with their
three faculty gates each, the bullet operations, and the six `clear*` and `remove*`
operations. Everything about _driving a browser game_ — the clock, exact frames, key
events, the overlay, the mute bit — is the engine's, which is why the surface
carries no `advance`, no `keyDown` and no `setMuted`. It is inert during normal play.

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

The engine and the particle runtime are relative `file:` dependencies on the
repository's own `packages/`, which npm installs as symlinks, so this project builds
and tests against their current source. A run receives the same packages under
`.tcab/` instead, so the imports in the sources are the same either way.
`@test-cabinet/run-record` is declared because the particle runtime re-exports a
type from it; nothing here imports it.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload at the URL it prints (default
`http://localhost:5173`), and serves the `assets/` tree from the project root.

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**, with
`index.html` at its root and the seeded art under `dist/assets/`. Serve that
directory as-is from any static file server, at any base path:

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

`npm test` runs the build's own suite **in process**: `src/harness.ts` stands a real
engine up over an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, steps
it with `engine.advance` against a `ConstantClock`, drives the keyboard by
dispatching events at the surface's event target, poses scenarios through
`engine.apply`, and reads results back from the state, the debug surface, the
engine's cue events and the pixels the render produced. No browser is involved. One
file (`src/sprites.test.ts`) additionally stands `fetch` and `createImageBitmap` up
over the project's own `assets/` directory, so the seeded sprites and the seeded
particle system are loaded, drawn and simulated for real.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/, copies assets/ into it)
vitest.config.ts      The build's own test suite, over src/
assets/               The seeded art: four 64x64 PNGs and one particle system
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: the palette, the tints, the type
  game.ts             The SpectraState contract, BACKGROUND, and the three
                      functions the engine drives
  sim.ts              The mutable mirror a frame is built in, and FrameEvents
  bands.ts            Effective band, the shimmer, and every derived figure
  rng.ts              The seeded generator, whose whole state is one field
  wave.ts             What a wave is made of, and where each drone starts
  drones.ts           The four phases, the paths, and the shots a dive carries
  bullets.ts          Both bullet kinds, their flight and their bounds
  bursts.ts           The seeded particle system, played per destroyed drone
  discharge.ts        The meter's ceiling, the release, and the wave's radius
  overload.ts         Charge, and the reaction each kind runs when it tips
  contacts.ts         The five contact steps, in the order the frame fixes
  scoring.ts          Every figure paid, and the run's one extra life
  flow.ts             The opening state, reset, the run, the life, the stage
  step.ts             One frame: the sub-step loop and the screen it advances
  assets.ts           Loading the seeded files through the engine's loader
  input.ts            The registered actions and this frame's reads
  audio.ts            The ten engine cues
  diagnostics.ts      The values the engine's overlay shows
  debug.ts            The debug surface: poses and readings over SpectraState
  render.ts           All canvas drawing, in logical space
  harness.ts          The build's own test harness, imported by the tests alone
  *.test.ts           The build's own tests, beside the code they cover
```
