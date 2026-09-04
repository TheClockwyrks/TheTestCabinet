# Spectra — `structured-2d` reference implementation, `base`

The authored, **correct** reference build of the `base` variant of the Spectra
end-to-end test case, on the
[Structured 2D](../../../../../../../../packages/structured-2d) engine. It is the
answer a run on `structured-2d` is compared against. It is **never seeded into a
run** — handing a model the finished game would defeat the test — and takes no
part in the case's seed set. The case specs under `../../../specs/` remain
authoritative for the design.

The project is the case's seeded workspace
(`../../../workspaces/base/structured-2d/`) with `src/game.ts` written, the game
split across new modules beside it, and its own tests written alongside, so what
is here is exactly what a run on this engine is asked to produce.

---

**Spectra** is a fixed-position formation shooter. A resonator-fighter holds a
lane along the bottom of a starfield while a swarm of drones flies in from above,
assembles into a slowly swaying formation, and peels off one at a time to dive at
the ship.

Spectra's defining idea is **polarity**. Everything that can be shot or can shoot
is tuned to one of two spectral bands, **cyan** or **magenta**, and the ship holds
one band at a time. That band is the only band its shots destroy, and it is also
the band its hull absorbs — so the tuning that lets the player kill what is in
front of them is the tuning that decides what can kill them. A formation always
holds both bands, and the flip between them costs a beat of fire, so clearing a
wave is a run of timed band changes rather than a stream of shots.

The three drones each press on that differently. A **Shard** holds one band for
life. A **Flux** swings between the two on a telegraphed rhythm and shimmers as it
changes, settled on neither band and destroyed by no shot of either. A **Prism**
wears two layers at once — a shell of one band around a core of the other — and
swaps the whole field's bands if it survives a dive to the bottom. Absorbing fire
and killing drones fill a **resonance** meter; full, it pays for a band-blind
discharge that sweeps every diving drone and every enemy shot off the field. Every
third stage is a non-firing **challenge** flyover worth a perfect bonus.

The look — a near-black field under a drifting starfield, the two band colors
carried in light and in a shape accent (the ring for cyan, the diamond for
magenta), and a field-wide mark while the bands are swapped — is this build's own.
The specification fixes the rules, the geometry and the figures and deliberately
leaves the palette, the type and the layout to the build, so the look lives in
`src/theme.ts` rather than beside the case-fixed figures in `src/constants.ts`.
The ship and the three drones are drawn from the sprite art seeded under
`assets/`, and a destroyed drone pops with the seeded particle system played
through `@test-cabinet/particle-runtime`.

This is a self-contained static web app — plain **TypeScript** inside the engine's
gameplay framework, drawing to an **HTML5 canvas**, bundled with **Vite**. No
backend, accounts, network calls, or API keys; everything needed to play is in the
built bundle.

## Controls

Every control is a **registered engine action** on the `dpad-4-two-buttons` touch
layout, with `discharge` registered beyond it:

| Action           | Keys                  | Does                                                           |
| ---------------- | --------------------- | -------------------------------------------------------------- |
| `left` / `right` | Arrows or `A` / `D`   | Moves the ship along its lane.                                 |
| `up` / `down`    | Arrows or `W` / `S`   | Moves a menu highlight, wrapping at both ends.                 |
| `a`              | `Space`, `Up` or `W`  | Fires, every `0.16` s while held, up to three shots in flight. |
| `b`              | `F` or either `Shift` | Flips the ship's band, locking fire out for `0.30` s.          |
| `discharge`      | `X`                   | Releases a discharge, at a full meter.                         |
| `confirm`        | `Enter` or `Space`    | Accepts the highlighted menu item.                             |
| `back`           | `Esc`                 | Leaves the current screen.                                     |
| `pause`          | `P` or `Esc`          | Pauses live play, and resumes it from the pause menu.          |
| `mute`           | `M`                   | Toggles sound, on any screen.                                  |

Several keys drive two actions and the screen decides which applies: `Space` fires
while a wave is being played and confirms on a menu, `Up` and `W` fire and move a
highlight, and `Esc` pauses while a wave is being played and goes back otherwise.

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows the
screen, phase and stage, the score, lives and resonance, the inversion, the ship's
place, band and lockout, every drone's id, kind, stored and effective bands, place,
phase, shimmer and shell, and the counts of bullets and bursts. That key belongs to
the engine, not to this game.

## What the engine owns

`@test-cabinet/structured-2d` is a gameplay framework as much as a runtime, and
none of what it owns is written here: the frame loop and its replaceable clock, the
construction and ticking of the framework objects in a fixed order, the rendering
pipeline and the camera, the canvas fit (uniform scale, centered letterbox, device
pixel ratio), asset loading under the fixed `assets/` root, named keyboard actions
read through a player controller with consume-on-read edges, audio cue synthesis
with mute and the first-gesture unlock, and the debug overlay. What is left is the
game: the rules, the drawing, and the state the debug surface poses.

## One world, one live state

The game is a single `GameDefinition` with a single level, opened once and never
left: every screen is a value of `state.screen`, so the world and its game state
live for the whole session and a wave survives a stage advance without the world
being rebuilt. `SpectraMode` names `SpectraState` — the class `specs/state.md`
declares — as its `gameStateClass`, so `engine.world.state` is the one live
instance and the whole of the authoritative game. The player controller resolves
each frame's actions, the mode's tick advances the simulation, and the debug
surface's poses arrange the state at the call. Nothing lives in a module-level
variable or a closure, and the actors, their components and the controller hold no
authoritative state of their own.

The mode's `beginPlay` adds **one player possessing nothing** — the ship is a
figure in the state rather than a pawn — and that player's controller,
`SpectraController`, is the one place input is read. The camera is left at rest, so
world units and the stage's `1280 x 720` logical units coincide.

Four details are worth naming because they are where this game meets the
framework:

- **The field's actors mirror the state's rosters.** The level places the `Stage`
  and the `Ship`; `syncField` spawns one tagged actor per drone, per bullet and
  per burst, carries each to its entity's centre, and destroys the ones whose
  entity has left. It runs at the end of the mode's tick, after the simulation and
  before the pipeline renders, so the picture is the frame the tick produced. Each
  actor holds its entity's `id` and nothing else; its draw components read the
  entity out of the live state at the call.
- **The sub-step loop is the mode's tick.** `specs/simulation.md` divides a frame
  into `n = max(1, ceil(dt / SUBSTEP_MAX))` whole sub-steps and resolves contacts
  at the end of each, in a stated order, so one second of game time covers the same
  ground whether it arrives as one frame, as sixty or as a hundred and twenty. The
  held actions are read by every sub-step and the edges by the first alone, so a
  flip or a discharge acts exactly once however finely the frame was divided.
- **There are no colliders.** The engine's collision system reports pairs once per
  frame, after the actors have moved; Spectra's contact model is a circle overlap
  the game runs itself inside the sub-step loop, up to a hundred and twenty times
  a frame. A collider per entity would report a second, coarser set of contacts
  that no rule reads. `src/actors.ts` says so where the actors are declared.
- **`phase` is Spectra's, not the match's.** The engine's `GameState` carries a
  match `phase` (`waiting`/`playing`/`over`); `specs/state.md` declares Spectra's
  `phase` as the sub-phase of the `inWave` screen (`live`/`ready`). The mode never
  calls `setPhase`, so the two vocabularies never meet; `src/game.ts` says how the
  declaration is made.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes, **through the engine**: the instance's `initialize` returns it, the engine
holds it, and a caller reads that same object back off **`engine.debug`**. Nothing
is published on the page.

Every operation acts on the live world at the moment it is called, and every pose
sets one field:

```ts
engine.debug.reset({ seed: 7 });
engine.debug.setWaveEntry(false);
engine.debug.setDiveLaunching(false);
engine.debug.setShipContact(false);
engine.debug.setScreen("inWave");
engine.debug.addDrone("prism", 640, 300);
const id = engine.debug.snapshot().drones.slice(-1)[0].id;
engine.debug.setDroneBand(id, "cyan");
engine.debug.addPlayerBullet(640, 340, "cyan");
await engine.advance(2);
const { drones, score } = engine.debug.snapshot();
```

The operations are `reset` (seedable) and `snapshot`; the screen and run poses;
the three **world gates** `setWaveEntry`, `setDiveLaunching` and `setShipContact`,
each holding one faculty of the wave itself so a scenario can pose a field holding
only what its requirement concerns, beside the wave's own `setDiveClock`; the ship
and cannon poses; the drone poses, which build a drone one field at a time and gate
its travel, its band clock and its fire separately; the bullet poses; and the two
burst removals. There is no operation that flips, fires, discharges or mutes, and
none that adds a burst: a caller that wants an outcome drives the real action, and
a burst is what a destroyed drone leaves behind. The surface is inert during normal
play.

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
declared even though nothing here imports it: the particle runtime re-exports a
type from it, so a `file:` install of the runtime would otherwise leave `tsc`
reaching for a package npm would try to fetch from the registry. A run receives the
same packages under `.tcab/` instead, so the imports in the sources are the same
either way.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload at the URL it prints (default
`http://localhost:5173`). The dev server serves the seeded art under `assets/` from
the project root, which is the root the engine's loader resolves against.

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
snapshot, the engine's cue events, and the pixels the render produced. Node has
neither `createImageBitmap` nor a `fetch` that resolves a relative path, so the
seeded files arrive as absent there and the render draws the shapes it falls back
to; `src/art.test.ts` covers the sprite and particle paths by handing `loadArt` a
loader of its own. No browser is involved.

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
  theme.ts            This build's own look: the palette, the type, the layers
  game.ts             The SpectraState contract, the game instance, the game
                      mode, and the one-level game definition
  actors.ts           The field's actors, their draw components, and the sync
                      that keeps them in step with the state's rosters
  controller.ts       The player controller: the one seat actions are read from
  simulate.ts         A frame's sub-steps, and the order a sub-step resolves in
  swarm.ts            The four phases, the paths, the dive's fire, and the
                      wave's own dive launching
  waves.ts            What a wave is made of, and where it enters from
  drones, bands       `bands.ts`: the one effective-band rule, applied twice
  ship.ts             The lane, the cannon's three gates, and the flip
  discharge.ts        The resonance meter and the wave it pays for
  bursts.ts           The seeded particle system, played per destroyed drone
  flow.ts             The seven screens, the run's beats, and the reset
  scoring.ts          Every figure the run is paid, and the one extra life
  entities.ts         Ids, the generator's draws, and the two lookups
  events.ts           What a frame produced beside the state it advanced
  rng.ts              The seeded generator, over the state's own field
  input.ts            The registered actions, the layout check, and a frame's
                      resolved input
  audio.ts            The nine engine cues, played once per event per frame
  assets.ts           The seeded art, loaded through the engine's loader
  debug.ts            The debug surface: poses and readings over the live world
  diagnostics.ts      The values the engine's overlay shows
  render.ts           All canvas drawing, in world units on the stage
  harness.ts          The in-process engine harness the build's tests run on
  fixtures.ts         The pure states the rule tests are written over
  *.test.ts           The build's own tests, beside the code they cover
```
