# Spectra — `none` reference implementation, `overload` variant

The authored, **correct** reference build of the Spectra end-to-end test case on
**no engine**, in the **Overload** mode. It is **never seeded into a run** —
handing a model the finished game would defeat the test — and takes no part in
the case's seed set. The case specs under `../../specs/` remain authoritative for
the design.

The project is the case's seeded engineless workspace (`../../workspaces/none/`)
— the configuration and the seeded art, and nothing else — with the whole of
`src/` written: the runtime the game stands on, the game, and the tests for both.
What is here is exactly what a run on no engine is asked to produce.

---

**Spectra** is a fixed-position formation shooter for the browser. A
resonator-fighter holds a lane along the bottom of a starfield while a swarm of
drones flies in from above, assembles into a slowly swaying formation, and peels
off one at a time to dive at the ship.

Spectra's defining idea is **polarity**. Everything that can be shot or can shoot
is tuned to one of two spectral bands, **cyan** or **magenta**, and the ship holds
one at a time. That band is the only band its shots destroy, and it is also the
band its hull absorbs — so the tuning that lets the player kill what is in front
of them is the tuning that decides what can kill them. A formation always holds
both bands and the flip between them costs a beat of fire, so clearing a wave is a
run of timed band changes rather than a stream of shots.

The three drones each press on that differently. A **Shard** holds one band. A
**Flux** oscillates between them on a telegraphed rhythm and cannot be hit
mid-shimmer. A **Prism** wears two layers at once, shell around core, and swaps
the whole field's bands if it survives a dive to the bottom. Absorbing a bullet
and killing on a match fill a **resonance meter**, and a full meter buys a
**discharge** that wipes every diver off the field. Every third stage is a
non-firing **challenge flyover** worth a large perfect bonus.

This build ships the **Overload** mode, which settles the one rule the two modes
disagree about: a **wrong-band shot is not wasted**. It charges the drone it hits,
and the third charge **overloads** it into a reaction true to its kind — a Shard
plunges, a Flux flips its band and sprays a fan of fire, a Prism bursts both bands
and, with its shell still on, grows the swarm. So a missed band costs more than a
beat.

This is a self-contained static web app — plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine. The ship and the
three drones are drawn from the seeded sprite art under `assets/`, and a destroyed
drone pops with the seeded particle system played through
`@clockwyrks/particle-runtime`; the field, the bullets, the discharge, the HUD
and every screen are drawn in code, and the ten audio cues are synthesized on the
spot with the Web Audio API. No backend, accounts, network calls or API keys.

The **look is this build's own**. The specs fix no palette and no typeface; they
fix what a player must be able to read at a glance and leave the rest to the
build. Two colors are not free, though: the specs require **one palette for both
bands**, so the cyan and magenta this build draws in code are read straight off
the seeded art (`#34e2ff` and `#ff4ec7`) and a code-drawn bullet lands on exactly
the color a drone of that band carries. Every band-carrying thing also gets its
band's **shape accent** — a ring for cyan, a diamond for magenta — so the two stay
legible to a color-blind player. Those choices live in `src/theme.ts`, apart from
the figures the specs fix in `src/constants.ts`.

## Controls

The keyboard drives everything, as **named actions** bound to physical keys
(`KeyboardEvent.code`), so the bindings survive a non-QWERTY layout. Each screen
reads only its own actions, which is what keeps a shared key — `Space` is both
fire and confirm, `Escape` is both back and pause — from ever doing two things at
once.

| Action             | Keys                             | Does                                    |
| ------------------ | -------------------------------- | --------------------------------------- |
| `left` / `right`   | Arrows or `A` / `D`              | Moves the ship along its lane.          |
| `up` / `down`      | Arrows or `W` / `S`              | Moves a menu highlight, wrapping.       |
| `a`                | `Space`, `ArrowUp` or `W`        | Fires. Held, it repeats at the cadence. |
| `b`                | `F`, `ShiftLeft` or `ShiftRight` | Flips the ship's band.                  |
| `discharge`        | `X`                              | Releases a discharge on a full meter.   |
| `confirm` / `back` | `Enter` / `Space`, `Escape`      | Takes a menu item; leaves a screen.     |
| `pause`            | `Escape` or `P`                  | Pauses live play, and resumes it.       |
| `mute`             | `M`                              | Toggles sound, from any screen.         |

The backtick key (`` ` ``) shows and hides the read-only **debug overlay**. It is
part of the runtime layer rather than one of Spectra's actions.

## Running it

```sh
npm ci          # install; the packages resolve by relative file: path (see below)
npm run dev     # Vite dev server, with the assets/ tree served from the root
npm run build   # the complete static site into dist/, servable at any base path
npm run preview # serve the built dist/ locally
```

The four checks a run is held to run over this build too:

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run format      # prettier --check .
npm test            # vitest run --coverage
```

### The `file:` dependencies

This project's `package.json` depends on the repository's own packages by
relative `file:` paths, **eight levels up** from here, so it builds against
current source rather than against a vendored copy. `@clockwyrks/run-record` is
declared even though nothing in Spectra imports it: `@clockwyrks/particle-runtime`
re-exports a type from it, so a `file:` install of the runtime otherwise leaves
`tsc` reaching for a package npm would try to fetch from the registry. Build the
repository's packages first (`npm ci && npm run build:packages` at the repository
root).

A run never needs any of this: the package store stages the transitive closure
into `.vendor/packages/` and rewrites the dependency to a path inside it.

## How the source is laid out

The build stands on no engine, so the layer every browser game needs is part of
it. It is kept apart from the game, in its own five modules, and the game reaches
it only through the `Game<S>` contract in `src/runtime.ts`.

### The runtime layer

| File           | What it owns                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `runtime.ts`   | The frame loop, the delta it measures, the canvas fit, and the clock `setAutoStep` / `advance` take away.                      |
| `viewport.ts`  | The letterboxed, device-pixel-ratio-aware fit of the fixed 1280x720 stage. A pure function of four numbers.                    |
| `keyboard.ts`  | Named actions over `KeyboardEvent.code`: holds, one-frame press edges, many-to-many bindings.                                  |
| `audio-bus.ts` | The ten cues, synthesized on the spot. A muted bus starts **nothing**, and nothing opens the context before the first gesture. |
| `overlay.ts`   | The read-only diagnostics panel and the backtick that toggles it.                                                              |
| `images.ts`    | Loading the seeded files, always **page-relative**, so the site runs at any base path.                                         |

### The game

| File             | What it owns                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constants.ts`   | Every figure the specification fixes, named once, with the four stage formulas as functions.                                                                                                                                     |
| `theme.ts`       | The palette and the type. Nothing the specification fixes lives here.                                                                                                                                                            |
| `types.ts`       | The one state object the loop advances, the renderer reads and the debug surface poses.                                                                                                                                          |
| `game.ts`        | The frame: the sub-step loop, the order everything advances in, and `reset`.                                                                                                                                                     |
| `simulation`     | `bands.ts` (effective band), `ship.ts`, `swarm.ts`, `drones.ts`, `waves.ts`, `paths.ts`, `field.ts`, `resonance.ts`, `combat.ts`, `scoring.ts`, `progression.ts`, `stages.ts`, `screens.ts`, `mode.ts`, `entities.ts`, `rng.ts`. |
| `assets.ts`      | The seeded art, and the second band derived from it by an exact recolor.                                                                                                                                                         |
| `bursts.ts`      | The seeded particle system, played through the runtime's pure `ParticleSimulator`.                                                                                                                                               |
| `render.ts`      | Everything drawn. A pure read of the state.                                                                                                                                                                                      |
| `debug.ts`       | `window.__spectra`: the debug and automation surface.                                                                                                                                                                            |
| `diagnostics.ts` | The values the overlay shows.                                                                                                                                                                                                    |
| `main.ts`        | The wiring, and deliberately nothing else.                                                                                                                                                                                       |

## Three decisions worth naming

Each is a place the specification leaves a choice open, and this build takes one.

**Everything that changes with time changes inside the sub-step loop.** A frame is
divided into `n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of `h = dt / n`, and
every clock, timer, position and burst advances by `h` inside it — nothing is
integrated once per frame outside. That is what makes `advance(1, 1)`,
`advance(1, 60)` and `advance(1, 120)` run the same hundred and twenty sub-steps
and reach the _identical_ state.

**A dive turns back rather than wrapping.** `specs/swarm.md` allows either ending;
this build takes the first, so no dive in it holds a discontinuity, and the
smoothed curve's samples are bounded a few units above `FIELD_BOTTOM` so a looping
dive never enters the bottom HUD strip. A diving Prism still crosses
`PRISM_INVERT_Y` on the way down, which is what inverts the field.

**The second band is baked once, not composited per draw.** Each seeded PNG is
hard-edged pixel art of at most four colors, so the other band-state is an exact
color swap over the same pixels — which keeps the alpha silhouette of the seeded
file identical, and costs one `drawImage` per drone rather than an offscreen
composite. A Prism's core is lifted out of the same file by flooding from its
centre across everything that is neither the shell's color nor the opaque gap
between the layers.

## The tests

`src/**/*.test.ts`, run in process by Vitest with coverage over `src/`. They drive
the **real** game: the real `update`, the real input path, the real cue bus, and —
for everything about the look — a real 2D context through `@napi-rs/canvas`, so
what a legibility test measures is the pixels the build actually leaves rather
than a value it reports. `src/harness.test-support.ts` stands in for the runtime
and `src/art.test-support.ts` decodes the seeded art; neither is a test, and
neither is part of the shipped bundle.
