# Spectra — `none` reference implementation

The authored, **correct** reference build of the Spectra end-to-end test case's
`base` variant on **no engine**. It is **never seeded into a run** — handing a
model the finished game would defeat the test — and takes no part in the case's
seed set. The case specs under `../../specs/` remain authoritative for the
design.

The project is the case's seeded workspace (`../../workspaces/none/`) — ten
configuration files, the seeded art under `assets/`, and nothing else — with the
whole of `src/` written: the runtime the game stands on, the game, and the tests
for both. What is here is exactly what a run on no engine is asked to produce.

---

**Spectra** is a fixed-position formation shooter for the browser. A
resonator-fighter holds a lane along the bottom of a starfield while a swarm of
drones flies in from above, assembles into a slowly swaying formation, and peels
off one at a time to dive at the ship.

Spectra's defining idea is **polarity**. Everything that can be shot or can shoot
is tuned to one of two spectral bands, **cyan** or **magenta**, and the ship
holds one band at a time. That band is the only band its shots destroy, and it is
also the band its hull absorbs — so the tuning that lets you kill what is in
front of you is the tuning that decides what can kill you. A formation always
holds both bands and the flip costs a beat of fire, so clearing a wave is a run
of timed band changes rather than a stream of shots.

The three drones press on that differently. A **Shard** holds one band for life.
A **Flux** oscillates between the two on a telegraphed rhythm and shimmers as it
turns, untouchable by either band while it does. A **Prism** wears a shell over a
core of the opposite band — break the shell, then the core — and inverts the
whole field's bands for five seconds if it reaches the bottom.

This is a self-contained static web app — plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine. No backend,
accounts, network calls, or API keys; everything needed to play is in the built
bundle.

The look is this build's own. The specs fix what a player must read at a glance —
the two bands apart from each other and from the field, a band by more than
color, the three drones apart, a Flux's shimmer, a Prism's two layers, the
inversion's field-wide mark — and leave the palette, the type and the layout to
the build. This build chose a near-black field under a dim starfield, the two
band colors the seeded art already carries (`#34e2ff` and `#ff4ec7`), a ring
accent for cyan and a diamond for magenta, an amber resonance meter and a violet
inversion. Those choices live in `src/theme.ts`, apart from the figures the specs
fix in `src/constants.ts`.

## The mode

One playable mode, **Sortie**: wave after wave of the swarm, flipping bands to
match what you fire at and to shield what fires at you, clearing each stage and
pressing into faster ones until the last life is lost. A mismatched shot is
simply wasted — the drone is left exactly as it was.

Every third stage is a **challenging stage**: forty non-firing drones sweep
across the field in five single-band groups, worth 100 each and 10,000 more if
none of them gets away.

## Controls

Every control is a **named action** bound to physical keys
(`KeyboardEvent.code`), so the bindings survive a non-QWERTY layout, and each
screen reads only the actions that belong to it.

| Action      | Keys                | Does                                    |
| ----------- | ------------------- | --------------------------------------- |
| `left`      | `←` or `A`          | Moves the ship left.                    |
| `right`     | `→` or `D`          | Moves the ship right.                   |
| `a`         | `Space`, `↑` or `W` | Fires; held, it repeats at the cadence. |
| `b`         | `F`, `Shift`        | Flips the ship's band.                  |
| `discharge` | `X`                 | Releases a discharge, at a full meter.  |
| `up`/`down` | `↑`/`↓` or `W`/`S`  | Moves a menu highlight, wrapping.       |
| `confirm`   | `Enter` or `Space`  | Takes the highlighted item.             |
| `back`      | `Esc`               | Leaves the current screen.              |
| `pause`     | `P` or `Esc`        | Pauses live play, and resumes it.       |
| `mute`      | `M`                 | Toggles sound, on any screen.           |

Several keys deliberately drive more than one action — `Space` fires on the live
field and confirms on a menu, `Esc` pauses in a wave and goes back on a menu — and
the screen decides which applies, so no key ever does two things at once.

The backtick key, `` ` ``, shows and hides the read-only diagnostics overlay. It
belongs to the runtime rather than to the game, it is off when the game starts,
and it works on every screen.

## The runtime this project carries

Spectra runs on no engine, so the layer every browser game needs is part of the
build. It is sized for this game rather than for every 2D game, and it is six
files:

- **`src/runtime.ts`** — the frame loop and the wiring. It measures each frame's
  delta in **seconds** (clamping the gap a backgrounded tab resumes with), clears
  the canvas, installs the logical transform, and calls `update` then `render`.
  Nothing here imposes a timestep: the game divides its own delta into whole
  sub-steps of at most `1/120` of a second, so the same second of play reaches
  the same state however it was divided into frames. It also owns the **manual
  clock** (below).
- **`src/viewport.ts`** — the canvas fit: one uniform scale, a centred letterbox,
  and the device pixel ratio, re-derived at the top of every frame so no resize
  handler is needed. `src/render.ts` draws in logical `1280x720` coordinates and
  never reads the canvas element's size.
- **`src/keyboard.ts`** — named actions over `KeyboardEvent.code` bindings, with
  edge detection: an edge is armed when an action leaves rest, consumed by the
  first reader, and discarded at the end of its frame.
- **`src/audio-bus.ts`** — cues declared by name and synthesized as one
  oscillator through one gain envelope, over a Web Audio context opened on the
  first user gesture. While the bus is muted **nothing is started at all**, and
  nothing about audio can fail a frame.
- **`src/overlay.ts`** — the diagnostics panel: the backtick key, the drawing in
  device space over the finished frame, and its read-only-ness. The game only
  names the values it shows.
- **`src/images.ts`** — the one part of the build that touches the network. It
  asks for each seeded file by the bare name `specs/assets.md` gives it, resolved
  against `document.baseURI`, so the produced site runs unchanged at the root of a
  static host and under a sub-path of it.

`src/main.ts` is the whole of the wiring between that layer and the game.

## The seeded art

Four `64x64` PNGs and one particle system sit flat under `assets/`, and the build
draws every ship and drone from them rather than from art of its own.

Each sprite is seeded in **one** band-state, and `src/art.ts` derives the other:
the same silhouette, pixel for pixel, with every band-carrying pixel repainted in
the other band's color and the ring or diamond accent drawn **in code** on top,
so the shape on screen is always the seeded one and a band never reads as a cyan
diamond or a magenta ring. A Prism's core is the same derivation with the shell's
pixels dropped.

`assets/drone-burst.json` is played, not hand-coded: each destroyed drone gets its
own `ParticleSimulator` from `@clockwyrks/particle-runtime`, scattered at random
so successive pops differ while the flash, the ring and the two-band sparks read
the same. `src/bursts.ts` steps it inside the
sub-step loop and composites the particles additively over the field.

## Debugging and automation

The build exposes the surface `specs/instrumentation.md` specifies on
**`window.__spectra`**, so a scenario can be posed in Spectra's own world from
code:

- `setAutoStep(enabled)` and `advance(seconds, frames)` — the **clock**. Nothing
  outside this build owns it, so the surface carries it: `setAutoStep(false)`
  stops the loop advancing the simulation from the wall clock, and
  `advance(seconds, frames)` runs that many whole frames — the same update the
  loop runs, then a render — covering that much game time. Drawing is unaffected
  either way. Because a frame divides into whole sub-steps of at most `1/120`,
  `advance(1, 1)` and `advance(1, 60)` reach exactly the same state.
- `reset()` and `snapshot()` — restore every declared field to its title-screen
  value, and read a JSON-serializable view of the whole state.
- The screen and the run: `setScreen`, `setPhase`, `setPhaseTimer`,
  `setMenuIndex`, `setScore`, `setLives`, `setStage`, `setExtraLifeAwarded`.
- The three **world gates** and the wave's clock: `setWaveEntry`,
  `setDiveLaunching`, `setShipContact` and `setDiveClock`. Each gates one faculty
  and nothing else, so a scenario gets a field holding only what its question is
  about.
- The ship: `setShipX`, `setShipBand`, `setFireLockout`, `setFireCooldown`.
- The band systems: `setResonance` and `setInversion`.
- The drones, one field at a time: `addDrone`, `setDronePosition`, `setDroneBand`,
  `setDronePhase`, `setDroneSlot`, `setDroneBandClock`, `setDroneShell`, the three
  per-drone faculty gates `setDroneTravel` / `setDroneOscillation` /
  `setDroneFire`, `removeDrone` and `clearDrones`.
- The bullets and the bursts: `addPlayerBullet`, `addEnemyBullet`,
  `setBulletVelocity`, `removeBullet`, `clearPlayerBullets`, `clearEnemyBullets`,
  `removeBurst` and `clearBursts`.

Every operation but the two clock calls is a read or a pose of one field of
`SpectraState`: they **arrange the world**, and the game's own stepping, contact,
band, scoring and stage rules run from there. That is why there is no `flip`, no
`fire` and no `discharge` on the surface — each of those is an outcome, reached by
driving the real action and reading the result back — and no `keyDown`, `keyUp` or
overlay toggle either: the runtime reports which keys are down and owns the
backtick key.

The surface is inert during normal play.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed.

## Install

```sh
npm ci
```

This reference sits inside the repository, so it depends on the repository's own
packages by relative `file:` paths, eight levels up from here — `npm run
build:packages` at the repository root builds them first. `@clockwyrks/run-record`
is declared even though nothing in Spectra imports it: `@clockwyrks/particle-runtime`
re-exports a type from it, so a `file:` install of the runtime would otherwise
leave `tsc` reaching for a package npm would try to fetch from the registry. A run
receives the same runtime vendored under `.vendor/`, which is what the seeded
workspace's `package.json` names.

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

`npm test` runs the build's own suite **in process**, with no browser involved.
The runtime's own modules are checked directly — the fit, the keyboard's edges,
the bus's silence, the panel — and the game is checked by standing it up over an
`@napi-rs/canvas` canvas and a keyboard of the test's own, stepping it with an
exact number of frames of an exact length, and reading the result back from the
state, from the cues its update raised, from the sprites its render handed
`drawImage`, and from the pixels it produced. The seeded PNGs are decoded and put
through the real derivation, so the silhouette the game draws is the one the case
ships.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/, copies assets/ into it)
vitest.config.ts      The build's own test suite, over src/
assets/               The seeded art: four PNGs and one particle system
src/
  main.ts             Bootstrap: decode the art, stand the runtime up, run
  runtime.ts          The frame loop, the manual clock, and the wiring
  viewport.ts         The canvas fit: uniform scale, letterbox, pixel ratio
  keyboard.ts         Named actions over key codes, with edge detection
  audio-bus.ts        Web Audio cues and the first-gesture unlock
  overlay.ts          The diagnostics panel and the backtick key
  images.ts           Page-relative loading of the seeded art
  art.ts              Deriving both band-states from one seeded silhouette
  constants.ts        Every figure the specs fix (logical 1280x720)
  theme.ts            This build's own look: the palette and the type
  types.ts            The whole of the game's state, in one value
  random.ts           The game's random draws, over the host's own generator
  paths.ts            Arc-length curves: entrances, dives and returns
  bands.ts            Effective band, contact half-extents, the overlap test
  waves.ts            What a wave is made of, and how its drones fly in
  swarm.ts            The four phases, the dive launcher, and enemy fire
  bursts.ts           The seeded particle system, played and composited
  cues.ts             The nine cues and how a frame raises one
  starfield.ts        The marks behind the play field
  game.ts             The state, the sub-stepped frame, and every contact
  render.ts           All canvas drawing, in logical space, over the theme
  diagnostics.ts      The values the overlay shows
  debug.ts            The window.__spectra surface over SpectraState
  harness.test-support.ts  The rig the build's own tests drive the game through
  *.test.ts           The build's own tests, beside the code they cover
```
