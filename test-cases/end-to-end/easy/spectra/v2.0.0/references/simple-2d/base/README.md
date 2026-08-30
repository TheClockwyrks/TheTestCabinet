# Spectra — `simple-2d` reference implementation, `base` variant

The authored, **correct** reference build of the Spectra end-to-end test case's
`base` variant, on the
[Simple 2D](../../../../../../../../packages/simple-2d) engine. It is the answer
a run on `simple-2d` in the `base` variant is compared against. It is **never
seeded into a run** — handing a model the finished game would defeat the test —
and takes no part in the case's seed set. The case specs under `../../../specs/`
remain authoritative for the design.

The project is the case's seeded workspace
(`../../../workspaces/base/simple-2d`) with `src/game.ts` implemented, the game
split across new modules beside it, and its own tests written alongside, so what
is here is exactly what a run on this engine is asked to produce.

---

**Spectra** is a fixed-position formation shooter played on a lane at the bottom
of a starfield. A swarm of crystalline drones flies in on sweeping paths,
assembles into a slowly swaying block overhead, then peels off one at a time to
dive at the ship. A stage is cleared by destroying every drone of its wave.

Its defining idea is **polarity**. The cannon is tuned to one of two spectral
bands, cyan or magenta, and flips between them at will. A shot destroys only a
drone of the matching band, and the band held is also the hull's shield: enemy
fire of the ship's own band is absorbed harmlessly, and fire of the other band is
lethal. Because a formation always holds both bands at once, the drone worth
shooting and the bullets worth surviving pull the choice in opposite directions,
and the flip that saves the ship costs a held beat of fire. Absorbing fire and
landing matched kills fills a **resonance** meter; a full meter buys a
**discharge** that wipes every diver in the air and leaves the formation
untouched.

Three drones press that one idea three ways. A **Shard** holds a single band. A
**Flux** oscillates between the two on a telegraphed rhythm and can be destroyed
only on the beat, never mid-shimmer. A **Prism** wears both bands at once as a
shell over a core, arrives escorted by two Shards, and **inverts the bands of the
whole field** if it survives its dive to the bottom. Every third stage breaks the
pattern with a challenge flyover: forty drones sweep across in single-band
groups, fire nothing, cost nothing, and pay a bonus for a clean sweep.

This build ships the **Sortie** mode the `base` variant asks for, whose one rule
is that a wrong-band shot is simply wasted: the drone it hits is left exactly as
it was.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts,
network calls, or API keys; everything needed to play is in the built bundle.

## The look

The near-black field, the drifting starfield, the two band colours carried three
ways at once and the hatched frame an inversion throws around the field are this
build's own. The specification fixes the rules and the geometry and deliberately
leaves the palette, the type and the layout to the build, stating only what a
player has to read at a glance: the two bands apart from each other and from the
field, a Flux's shimmer, a Prism's two layers, a bullet's band. So the look lives
in `src/theme.ts` rather than beside the case-fixed figures in
`src/constants.ts`, which carries no colour and no typeface at all.

The two band colours are the one exception, and they are not this build's
invention: `CYAN` and `MAGENTA` are the exact pixels the seeded art is painted
in, so a code-drawn bullet and a sprite-drawn drone read as the same band. Each
band also carries a **shape accent** — the ring for cyan, the diamond for magenta
— used everywhere a band appears, so the two stay apart for a colourblind player.

The ship and the three drones are drawn from the **seeded art** under `assets/`,
loaded through the engine's asset loader under the fixed `assets/` root, with the
band composited over the drawn silhouette so the shape on screen is always the
seeded one. A destroyed drone pops with the seeded particle system, played
through `@test-cabinet/particle-runtime`'s pure `ParticleSimulator` and drawn
additively. Everything else — the field, the starfield, every bullet, the
discharge wave, the inversion's mark, the HUD and every screen — is drawn in
code.

## Controls

Every keyboard control is a **registered engine action** on the
`dpad-4-two-buttons` layout, except `discharge`, which is Spectra's own action
registered beyond it:

| Action           | Keys                             | Does                                                       |
| ---------------- | -------------------------------- | ---------------------------------------------------------- |
| `left` / `right` | Arrows or `A` / `D`              | Moves the ship along its lane; read as a hold.             |
| `a`              | `Space`, `↑` or `W`              | Fires, every `0.16` s while held, up to three in flight.   |
| `b`              | `F`, `Left Shift`, `Right Shift` | Flips the ship's band, and locks firing out for `0.30` s.  |
| `discharge`      | `X`                              | Spends a full resonance meter on the screen-clearing wave. |
| `up` / `down`    | Arrows or `W` / `S`              | Moves a menu highlight, wrapping at both ends.             |
| `confirm`        | `Enter` or `Space`               | Takes the highlighted menu item.                           |
| `back`           | `Esc`                            | Leaves the current screen.                                 |
| `pause`          | `P` or `Esc`                     | Pauses live play, and resumes it from the paused screen.   |
| `mute`           | `M`                              | Toggles sound, on any screen.                              |

Several keys drive more than one action — `Space` fires and confirms, `Esc`
pauses and goes back — and the screen decides which one applies, so no key ever
does two things at once.

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows
the screen, phase and stage, the score, lives, resonance and discharge readiness,
the inversion, the ship's lane position, band and lockout, every drone's id,
kind, stored and effective bands, position, phase, shimmer and shell, and how
many bullets and bursts are live. That key belongs to the engine, not to this
game.

## What the engine owns

`@test-cabinet/simple-2d` supplies everything that is the same in every browser
game, and none of it is written here: the frame loop and its delta time in
seconds, the state held by value and handed out `DeepReadonly`, the canvas fit
(uniform scale, centred letterbox, device pixel ratio), named keyboard actions
with edge detection, audio cue synthesis with mute and the first-gesture unlock,
asset loading under the fixed `assets/` root, and the debug overlay. What is left
is the game: the field, the bands, the swarm, the run, the drawing, and the state
the debug surface poses.

## The state is a value

Every field of `SpectraState` is `readonly` and every array a `readonly` array,
so the declared type and the `DeepReadonly` view the engine hands out are the
same shape, and nothing in this build writes to a state it was handed. What a
frame does instead is copy the state into `Sim` — a field-for-field mutable
mirror in `src/sim.ts` — advance that, and return it, which keeps each rule
readable as the rule while the immutability the engine requires is enforced at
the one boundary where it matters. There is no module-level game state and no
closure over mutable data; `render` and every diagnostic source are reads of the
state they are given, and the compiler is what says they cannot change it.

**There is no fixed timestep.** Every rate is per second and integrated against
the frame's delta time, and a frame covering `dt` seconds is divided into
`n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of `dt / n` each. Every clock,
every countdown and every position moves inside that loop, so one second of game
time reaches the identical state whether it arrived as one frame, as sixty or as
a hundred and twenty. Held actions are read by every sub-step; the press edges —
the flip, the discharge, a menu move, a pause — are handed to the first sub-step
alone, so a press acts exactly once however finely the frame was divided.

**Every random choice runs off one seeded generator** whose whole state is the
single number `rngState` in the game's state: the wave's layout, which drone
dives next, the gap before the next dive, a Flux's starting phase and each
burst's scatter. `reset({ seed })` reseeds it, so a scenario replays exactly.

## Debugging and automation

The game exposes the debugging and automation surface
`specs/instrumentation.md` fixes, **through the engine**: `src/debug.ts` builds
it, `initialize` returns it beside the state as `[state, createDebugApi()]`, and
a caller reads that same object back off **`engine.debug`**. Nothing is published
on the page.

Every operation is a pose or a reading over `SpectraState`, written in the shape
of `update`, and each pose sets one field and takes scalars:

```ts
engine.apply((s) => engine.debug.setScreen(s, "inWave"));
engine.apply((s) => engine.debug.addDrone(s, "prism", 640, 300));
engine.apply((s) => engine.debug.setShipBand(s, "magenta"));
engine.apply((s) => engine.debug.addPlayerBullet(s, 640, 500, "magenta"));
await engine.advance(20);
const { drones, bullets, bursts, score } = engine.debug.snapshot(engine.state);
```

Beside the core (`reset`, seedable, and `snapshot`) it carries the screen and run
poses, the three **world gates** — `setWaveEntry`, `setDiveLaunching` and
`setShipContact`, each gating one faculty of the wave itself so a posed scenario
is not invaded by entities its requirement never asked for — the ship and cannon
poses, the resonance and inversion poses, the per-drone operations with their
three faculty gates each, the bullet operations, and the four removals, one per
roster. Everything about _driving a browser game_ — the clock, exact frames, key
events, the overlay, the mute bit — is the engine's, which is why the surface
carries no `advance`, no `keyDown` and no `setMuted`. There is likewise no
operation that flips, fires or discharges: a caller drives the real action and
reads the result. It is inert during normal play.

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

The engine, `@test-cabinet/simple-2d`, and the particle runtime,
`@test-cabinet/particle-runtime`, are relative `file:` dependencies on the
repository's own `packages/`, which npm installs as symlinks, so this project
builds and tests against their current source. A run receives the same packages
at `.tcab/engine/` and `.tcab/packages/` instead, so the imports in the sources
are the same either way. `@test-cabinet/run-record` is declared here as well,
even though nothing in Spectra imports it: `@test-cabinet/particle-runtime`
re-exports a type from it, and a `file:` install of the runtime otherwise leaves
`tsc` reaching for a package npm would try to fetch from the registry.

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

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root and the seeded art under `dist/assets/`. Serve that
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

`npm test` runs the build's own suite **in process**: `src/engine.test.ts`
stands a real engine up over an `@napi-rs/canvas` canvas and a `SurfaceMetrics`
of its own, steps it with `engine.advance` against a `ConstantClock`, drives the
keyboard by dispatching events at the surface's event target, poses scenarios
through `engine.apply`, and reads results back from the state, the debug surface,
the engine's cue events and the pixels the render produced. It also stands
`fetch` and `createImageBitmap` up over the project's own `assets/` directory, so
the seeded art and the seeded particle system are loaded and drawn for real. No
browser is involved. The other files unit-test the pure rules directly.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/, copies assets/ into it)
vitest.config.ts      The build's own test suite, over src/
assets/               The seeded art: four 64x64 PNGs and the burst system
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: palette and type
  game.ts             The SpectraState contract, BACKGROUND, and the three
                      functions the engine drives
  sim.ts              The mutable mirror a frame is built in, and FrameEvents
  rng.ts              The one seeded generator, whose state is one number
  bands.ts            Effective band: the stored band taken as its opposite once
                      per swap that holds, and the shimmer and inversion tests
  ship.ts             The lane clamp, the three fire gates, and the flip
  swarm.ts            The four phases, the entrance, the dive, and enemy fire
  waves.ts            What a wave is made of, and the challenge stage's sweeps
  discharge.ts        The resonance meter and the wave it pays for
  bursts.ts           The seeded particle system, played per destroyed drone
  scoring.ts          Every figure paid, and the run's one extra life
  flow.ts             The opening state, reset, the run, the life, the stage
  simulate.ts         One frame, from the top: sub-steps and the contact order
  assets.ts           Loading the seeded art through the engine's loader
  input.ts            The registered actions and this frame's reads
  audio.ts            The nine engine cues
  diagnostics.ts      The values the engine's overlay shows
  debug.ts            The debug surface: poses and readings over SpectraState
  render.ts           All canvas drawing, in logical space
  *.test.ts           The build's own tests, beside the code they cover
```
