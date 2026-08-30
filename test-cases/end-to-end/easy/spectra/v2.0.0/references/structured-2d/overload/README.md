# Spectra (Overload) — `structured-2d` reference implementation

The authored, **correct** reference build of the Spectra end-to-end test case's
**overload** variant, on the
[Structured 2D](../../../../../../../../packages/structured-2d) engine. It is the
answer a run on `structured-2d` is compared against. It is **never seeded into a
run** — handing a model the finished game would defeat the test — and takes no
part in the case's seed set. The case specs under `../../../specs/` remain
authoritative for the design.

The project is the case's seeded workspace with `src/game.ts` written, the game
split across new modules beside it, and its own tests written alongside, so what
is here is exactly what a run on this engine is asked to produce.

---

**Spectra** is a fixed-position formation shooter. A resonator-fighter holds a
lane along the bottom of a starfield while a swarm of drones flies in from above,
assembles into a slowly swaying block, and peels off one at a time to dive at the
ship.

Spectra's defining idea is **polarity**. Everything that can be shot or can shoot
is tuned to one of two spectral bands, **cyan** or **magenta**, and the ship holds
one at a time. That band is the only band its shots destroy, and it is also the
band its hull absorbs — so the tuning that lets the player kill what is in front
of them is the tuning that decides what can kill them. A formation always holds
both bands and the flip between them costs a beat of fire, so clearing a wave is a
run of timed band changes rather than a stream of shots.

Three drones press on that differently. A **Shard** holds one band for its life. A
**Flux** oscillates between them on a telegraphed rhythm and cannot be destroyed
mid-shimmer. A **Prism** wears two layers of opposite bands, shell around core, and
inverts the whole field's bands if a dive of its carries it to the bottom.
Absorbed fire and matching kills fill a **resonance** meter; a full meter buys one
screen-clearing **discharge**. Every third stage is a non-firing **challenge**
flyover.

This build ships the **Overload** mode, in which a wrong-band shot is not wasted:
it charges the drone it hits, and the third charge overloads it. A Shard plunges
at the ship, a Flux flips its band and sprays a fanned three-shot volley, and a
Prism bursts both bands at once and — with its shell still standing — pulls in
another Shard.

The look — a near-black field under a dim starfield, each drone lit in the band it
counts as, and the ring-and-diamond accent that carries a band without colour — is
this build's own. The specification fixes the rules, the geometry and the figures
and deliberately leaves the palette, the type and the layout to the build, so the
look lives in `src/theme.ts` rather than beside the case-fixed figures in
`src/constants.ts`. The ship and the three drones are drawn from the sprite art
seeded under `assets/`, and a destroyed drone pops with the seeded particle
system played through `@test-cabinet/particle-runtime`.

This is a self-contained static web app — plain **TypeScript** inside the engine's
gameplay framework, drawing to an **HTML5 canvas**, bundled with **Vite**. No
backend, accounts, network calls, or API keys; everything needed to play is in the
built bundle.

## Controls

Every control is a **registered engine action** on the `dpad-4-two-buttons` touch
layout, bound by `KeyboardEvent.code`:

| Action           | Keys                  | Does                                                     |
| ---------------- | --------------------- | -------------------------------------------------------- |
| `left` / `right` | Arrows or `A` / `D`   | Moves the ship along its lane.                           |
| `up` / `down`    | Arrows or `W` / `S`   | Moves a menu highlight, which wraps at both ends.        |
| `a`              | `Space`, `↑` or `W`   | Fires, every `0.16` s while held, up to three in flight. |
| `b`              | `F` or either `Shift` | Flips the ship's band, starting a `0.30` s fire lockout. |
| `discharge`      | `X`                   | Releases a discharge, if the meter is full.              |
| `confirm`        | `Enter` or `Space`    | Accepts the highlighted menu item.                       |
| `back`           | `Esc`                 | Leaves the current screen.                               |
| `pause`          | `P` or `Esc`          | Pauses live play, and resumes from the paused screen.    |
| `mute`           | `M`                   | Toggles sound, on any screen.                            |

`Space`, `↑`, `W` and `Esc` each drive two actions, and the screen decides which
applies: `Space` fires while the game is being played and confirms on a menu, and
`Esc` pauses while it is being played and goes back otherwise.

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows the
screen, phase and stage, the score and lives, the meter and whether a discharge is
ready, the inversion, the ship's position, band and lockout, every drone's id,
kind, stored and effective bands, position, phase, shimmer, shell and charge, the
Flux window, and the bullets and bursts on the field. That key belongs to the
engine, not to this game.

## What the engine owns

`@test-cabinet/structured-2d` is a gameplay framework as much as a runtime, and
none of what it owns is written here: the frame loop and its replaceable clock,
the construction and ticking of the framework objects in a fixed order, the
rendering pipeline and the camera, the canvas fit (uniform scale, centered
letterbox, device pixel ratio), asset loading under the fixed `assets/` root,
named keyboard actions read through a player controller with consume-on-read
edges, audio cue synthesis with mute and the first-gesture unlock, and the debug
overlay. What is left is the game: the rules, the drawing, and the state the debug
surface poses.

## One world, one live state

The game is a single `GameDefinition` with a single level, opened once and never
left: every screen is a value of `state.screen`, so a wave survives a stage
advance without the world being rebuilt. `SpectraMode` names `SpectraState` — the
class `specs/state.md` declares — as its `gameStateClass`, so `engine.world.state`
is the one live instance and the whole of the authoritative game. The player
controller resolves each frame's actions straight onto it, the mode's tick
advances the simulation, and the debug surface's poses arrange it at the call.
Nothing lives in a module-level variable or a closure; the actors, their
components and the controller hold no authoritative state of their own.

The mode's `beginPlay` adds **one player possessing nothing** — the ship is a
figure in the state rather than a pawn — and that player's controller,
`SpectraController`, is the one place input is read. The camera is left at rest,
so world units and the stage's `1280 x 720` logical units coincide. The level
places two actors, the `Field` and the `Ship`; the drones, the bullets and the
bursts get an actor each as the rosters gain them, tagged by the names in `TAGS`,
and `syncField` brings that set into step at the end of every tick. Each actor's
`DrawComponent` reads its own entity out of the state at the call, so the picture
is always the frame the simulation just produced.

Three details are worth naming because they are where this game meets the
framework:

- **A frame is divided into sub-steps.** `specs/simulation.md` fixes a ceiling of
  `1/120` s on how far a sub-step may carry anything, so the mode's tick runs
  `ceil(dt / SUBSTEP_MAX)` whole sub-steps of `dt / n` each, advancing every
  moving thing and then resolving contacts in the stated order. One second of game
  time covers the same ground whether it arrives as one frame, sixty, or a hundred
  and twenty.
- **The contact model is the game's, not the engine's.** A contact is an overlap
  of two circles about their centres, tested at the end of every sub-step — a
  finer grain than the engine's once-a-frame collision pass — so the build
  declares no colliders and runs the test itself in `src/contacts.ts`.
- **`phase` is Spectra's, not the match's.** The engine's `GameState` carries a
  match `phase` (`waiting`/`playing`/`over`); `specs/state.md` declares Spectra's
  `phase` as the sub-phase of the `inWave` screen (`live`/`ready`). The mode never
  calls `setPhase`, so the two vocabularies never meet; `src/game.ts` says how the
  declaration is made.

## The seeded art, in two bands

`specs/assets.md` seeds four `64 x 64` PNGs and one particle system, each sprite
in one band-state only, and asks that the other band-state be the same silhouette
carrying the other band's colour. This build composites the tint over the seeded
PNG at draw time, through a `grayscale → brightness → sepia → hue-rotate →
saturate` chain on `CanvasRenderingContext2D.filter`: it maps every drawn pixel
onto one band's colour while leaving the alpha, and so the silhouette, untouched.
The source handed to `drawImage` is therefore always the seeded bitmap, in either
band, and the route needs no second canvas — which is what makes it draw the same
picture in a browser and in a host that has no `document` to make one with. The
band's own accent, the ring for cyan and the diamond for magenta, is drawn in code
over it, so the pair always agree.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes, **through the engine**: the instance's `initialize` returns it, the engine
holds it, and a caller reads that same object back off **`engine.debug`**. Nothing
is published on the page.

Every operation acts on the live world at the moment it is called, and every pose
sets one field:

```ts
engine.debug.setScreen("inWave");
engine.debug.setWaveEntry(false);
engine.debug.setDiveLaunching(false);
engine.debug.addDrone("prism", 640, 220);
engine.debug.setDroneBand(1, "magenta");
engine.debug.addPlayerBullet(640, 300, "magenta");
await engine.advance(6);
const { drones, bullets, bursts } = engine.debug.snapshot();
```

The operations are `reset` (seedable) and `snapshot`; the screen and run poses;
the three **world gates** `setWaveEntry`, `setDiveLaunching` and `setShipContact`,
each holding one faculty of the wave itself so a scenario can pose a field holding
only what its requirement concerns, plus the wave's own `setDiveClock`; the ship
and cannon poses; the meter and the inversion; the drone poses, which build a
drone one field at a time and gate its travel, its band clock and its fire
separately; the bullet poses; and the two burst removals. There is no operation
that flips, fires, discharges or mutes: a caller drives the real action and reads
the outcome back. The surface is inert during normal play.

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

The engine, `@test-cabinet/structured-2d`, and the particle runtime,
`@test-cabinet/particle-runtime`, are relative `file:` dependencies on the
repository's own `packages/`, which npm installs as symlinks, so this project
builds and tests against their current source. `@test-cabinet/run-record` is
declared for the same reason: the particle runtime re-exports a type from it. A
run receives the same packages under `.tcab/` instead, so the imports in the
sources are the same either way.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload at the URL it prints (default
`http://localhost:5173`). The dev server serves the art under `assets/` from the
project root, which is the root the engine's loader resolves against.

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root and the seeded art at `dist/assets/`. Serve that
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

`npm test` runs the build's own suite **in process**: it stands a real engine up
over an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, steps it with
`engine.advance` against a `ConstantClock`, drives the keyboard by dispatching
events at the surface's event target, poses scenarios through the debug surface at
`engine.debug`, and reads results back from the world's state, the surface's
snapshot, the engine's cue events, the strings and images the drawing handed the
context, and the pixels the render produced. Node has neither `createImageBitmap`
nor a `fetch` that resolves a relative path, so the harness stands both up over
this project's own `assets/` directory and a headless run draws the same picture a
browser does. No browser is involved.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/, copies assets/ into it)
vitest.config.ts      The build's own test suite, over src/
assets/               The seeded art: four sprites and the drone-burst system
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: the palette, the layers, the type,
                      and the filter a seeded sprite reaches a band through
  game.ts             The SpectraState contract, the game instance, the game
                      mode, and the one-level game definition
  controller.ts       The player controller: the one seat actions are read
                      from, per frame
  sim.ts              The sub-step rule, and what one frame owes the game
  bands.ts            Effective band, the shimmer, and what a band decides
  ship.ts             The lane, the cannon's three gates, the flip, the release
  bullets.ts          The one roster, its motion, and the field's edges
  drones.ts           The three kinds' figures and a Flux's band clock
  swarm.ts            Entrances, the formation, dives, returns, and enemy fire
  waves.ts            What a wave is made of, and the challenge flyover
  contacts.ts         The order a sub-step resolves its contacts in
  destroy.ts          What a taken layer pays, pops, and fills
  discharge.ts        The wave's growth and what it takes
  overload.ts         The mode: charge, the three reactions, and the escort
  scoring.ts          Every figure the run is paid, and the extra life
  flow.ts             The screens, the holds, the lives, and reset
  bursts.ts           The seeded particle system, played per pop
  rng.ts              The seeded generator, over the state's own field
  input.ts            The registered actions and the layout check
  audio.ts            The ten engine cues, played once per event per frame
  debug.ts            The debug surface: poses and readings over the live world
  diagnostics.ts      The values the engine's overlay shows
  sprites.ts          The seeded art, loaded through the engine's loader
  render.ts           All canvas drawing, in world units on the stage
  actors.ts           The tagged actors and the pass that keeps them in step
  harness.ts          The in-process engine harness the build's tests run on
  fixtures.ts         The pure states the rules modules are tested over
  *.test.ts           The build's own tests, beside the code they cover
```
