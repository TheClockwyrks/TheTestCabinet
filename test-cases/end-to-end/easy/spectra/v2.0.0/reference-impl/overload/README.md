# Spectra — Overload

The **Overload** variant of Spectra. It is the base formation shooter — the same
two-band **polarity** combat, the swaying formation, the three drones, the
resonance/discharge economy, challenge stages, and stage scaling — with the main
menu offering a second mode alongside the standard **Sortie**:

- **LAUNCH** — the standard *Sortie* defense, exactly as the base game. A
  mismatched (wrong-band) shot is **wasted**.
- **OVERLOAD** — the same defense, but a mismatched shot is **no longer harmless**.
  It **feeds** the drone it hits, charging it toward an **overload**. You can no
  longer spray the swarm and ignore your band: every off-band shot arms the enemy.

The one rule that changes is what a mismatched offensive shot does; everything
else — bands and matching kills, the dual-use shield, the resonance meter and
discharge, all three drones and the Prism's spectral inversion, and the stages,
challenge stages, scoring, lives, and stage scaling — is identical to the base
game.

This is a self-contained static web app — plain **TypeScript** rendering to an
**HTML5 canvas**, bundled with **Vite**. No backend, accounts, network calls, or
API keys. It is the authored **reference implementation** of the Overload variant:
the correct build, shown on the case's Reference tab. It is never seeded into a
run.

## The overload mechanic

Each drone carries a **charge** counter, starting at `0`:

- A **matching** shot still **destroys** the drone (or its exposed layer, for the
  Prism), exactly as in the base game.
- A **mismatched** shot — opposite the drone's current band — no longer does
  nothing. It **adds `1` charge** (and is consumed). At **`3`** charge the drone
  **overloads**: it performs its per-type reaction and its charge **resets to `0`**
  (it can overload again). A small row of pips above a drone telegraphs its charge.

A **Flux struck mid-shimmer** takes no effect at all — it has no band to mismatch,
so it is neither destroyed nor charged. Challenge-stage flyovers are unaffected
(they never fire and cost no life).

## Overload reactions

Each drone overloads true to its identity:

- **Shard** — immediately **launches a headlong dive**: it peels out of formation
  (or redirects a dive) into a fast, straight plunge toward the player's current
  `x`, faster than a normal dive. Feed a Shard the wrong band and it comes at you.
- **Flux** — immediately **flips its band** (ending any held window or shimmer) and
  **fires a 3-shot downward spread** in its **new** band, then resumes its cycle.
- **Prism** — the **exposed layer** overloads, emitting a **two-band burst** (one
  cyan, one magenta); and if the **shell** is the exposed layer, the Prism **spawns
  one extra Shard escort** (of a random band) that flies in beside it. Feeding a
  Prism the wrong band on its shell only grows the swarm around it.

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

## Build

```sh
npm ci            # install exactly what the deploy installs
npm run build     # type-checks (tsc --noEmit) and emits the static site to dist/
npm run preview   # serve dist/ locally for a final check
```

`npm run dev` serves the game with hot-reload for development. The build sets
Vite's `base: "./"`, so `dist/` runs correctly whether served from a host root or
a per-run sub-path.

## Project layout

```
index.html               Vite entry; hosts the <canvas>
vite.config.ts           Build config (base: "./", emits to dist/)
vendor/particle-runtime  Vendored, prebuilt @test-cabinet/particle-runtime
src/
  main.ts                Bootstrap: canvas fit/letterbox + fixed-timestep loop
  constants.ts           Palette, geometry, tuning (logical 1280x720), overload tuning
  types.ts               Shared types (drones, bullets, states, drone charge)
  input.ts               Keyboard: held state + edge events
  assets.ts              Loads the provided sprites; per-band tinting; the burst
  particles.ts           Plays the provided drone-burst via the particle runtime
  audio.ts               Web Audio cues (mutable)
  paths.ts               Arc-length Bezier paths for entrances and dives
  waves.ts               Formation composition + entrance/challenge choreography
  game.ts                State machine, polarity combat, the Overload charge/reactions
  render.ts              All canvas drawing (neon-on-void)
```
