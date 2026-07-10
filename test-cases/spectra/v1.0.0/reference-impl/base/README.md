# Spectra

**Spectra** is a fixed-position formation shooter for the browser. You pilot a
lone resonator-fighter along the bottom of the screen while a swarm of
crystalline drones flies in along sweeping paths, assembles into a swaying
formation overhead, then peels off to dive-bomb you. Clear every drone to advance
the stage.

Spectra's defining idea is **polarity**. Your cannon is tuned to one of two
spectral bands — **Cyan** (a ring motif) or **Magenta** (a diamond motif) — and
you flip between them at will. A shot only destroys a drone of the **matching**
band, and your current band is also your **shield**: enemy fire of your own band
is absorbed harmlessly (and builds resonance), while fire of the opposite band is
lethal. The swarm always holds **both** bands at once, so the drone you want to
shoot and the bullets you must survive constantly pull your choice in opposite
directions.

This directory is the authored **reference implementation** of the case's `base`
variant (the standard *Sortie* defense) — the *correct*, ground-truth build the
case is judged against. It is a self-contained static web app: plain
**TypeScript** rendering to an **HTML5 canvas**, bundled with **Vite**. No
backend, accounts, network calls, or API keys; everything needed to play is in the
built bundle.

## The three drones

- **Shard** — a fixed band for its whole life; one matching shot destroys it.
- **Flux** — oscillates its band on a telegraphed rhythm (hold → shimmer → other
  band). It can only be destroyed by a matching shot during a **held** window,
  never mid-shimmer.
- **Prism** — a two-band boss: break the outer **shell** with the shell's band,
  then the exposed **core** with the opposite band. It enters escorted by two
  Shards and fires a two-band burst while diving. A diving Prism that reaches the
  bottom of the field triggers a **spectral inversion** — the two bands swap
  across the whole field for a few seconds.

## Resonance and the discharge

Absorbing same-band fire and landing matching kills fills the **resonance** meter.
At full, press `X` for a **discharge**: an expanding wave that wipes every entering
and diving drone and clears all enemy fire (band-blind), but spares the formation.
It spends the whole meter.

## Stages

Every stage is one wave; clearing it advances to a faster, harder one. Every
**third** stage is a **challenge stage** — a non-firing, single-band flyover that
costs no lives, with `100` points per drone and a `10000` perfect bonus for
destroying them all.

## Controls

| Action | Keys |
| --- | --- |
| Move | `←` / `→` or `A` / `D` |
| Fire | `Space` (or `↑` / `W`) |
| Flip band | `Shift` (either) or `F` |
| Discharge | `X` (when resonance is full) |
| Pause | `Esc` or `P` |
| Menu navigation | `↑` / `↓` (or `W` / `S`) |
| Confirm / Back | `Enter` / `Space`  ·  `Esc` |
| Mute audio | `M` |

Flipping is instant but imposes a `0.30 s` fire lockout, so you cannot flip and
fire in the same instant.

## Provided art and effect

The ship and the three drones are rendered from the **provided sprites** under
`src/assets/` (`fighter`, `shard`, `flux`, `prism`), re-tinted per band at load
time; the ring/diamond band glyph is drawn in code on top so the band always reads
correctly. When a drone pops, the build plays the **provided** `drone-burst.json`
particle system through **`@test-cabinet/particle-runtime`** (its `/canvas`
binding), simulated live so each detonation scatters differently. That library is
vendored, prebuilt, under `vendor/particle-runtime/` so this project installs and
builds with a plain `npm ci` outside the monorepo.

## Requirements

- Node.js 18+ and npm. No other toolchain is needed.

## Install

```sh
npm ci        # or: npm install
```

## Run in development

```sh
npm run dev
```

Vite serves the game with hot-reload at the URL it prints (default
`http://localhost:5173`).

## Production build

```sh
npm run build
```

This type-checks the sources (`tsc --noEmit`) and emits a complete static site
into **`dist/`**, with `index.html` at its root. The build sets Vite's
`base: "./"`, so the output runs correctly whether served from a host root or a
per-run sub-path. Preview it locally:

```sh
npm run preview
```

## Project layout

```
index.html               Vite entry; hosts the <canvas>
vite.config.ts           Build config (base: "./", emits to dist/)
vendor/particle-runtime  Vendored, prebuilt @test-cabinet/particle-runtime
src/
  main.ts                Bootstrap: canvas fit/letterbox + fixed-timestep loop
  constants.ts           Palette, geometry, tuning (logical 1280x720)
  types.ts               Shared types (drones, bullets, states)
  input.ts               Keyboard: held state + edge events
  assets.ts              Loads the provided sprites; per-band tinting; the burst
  particles.ts           Plays the provided drone-burst via the particle runtime
  audio.ts               Web Audio cues (optional, mutable)
  paths.ts               Arc-length Bezier paths for entrances and dives
  waves.ts               Formation composition + entrance/challenge choreography
  game.ts                State machine, polarity combat, drones, scoring, scaling
  render.ts              All canvas drawing (neon-on-void)
```
