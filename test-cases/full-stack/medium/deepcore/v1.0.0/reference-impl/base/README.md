# Deepcore — reference implementation (base variant)

A subterranean dig-and-build game that runs entirely in the browser. You are a lone
prospector stranded on Vhera Deep: **drill down** through four depth bands, **sell ore**
and **buy upgrades** at the surface camp, recover the exotic materials and the unstable
**Core Sample** the deep holds, and **fabricate the five-component escape rocket** at the
Launch Pad. Build it, **launch**, and fly home.

This build is **self-contained**: every sprite, animation frame, particle system, and
sound it plays was **produced during the run** with the six on-`PATH` asset tools
(`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, `music`) and committed
under [`assets/`](assets/). `npm run build` bundles those committed files and never
invokes the tools — see [`../../specs/assets.md`](../../specs/assets.md) and
[`ASSET-LAYOUT.md`](ASSET-LAYOUT.md) for the production contract and the canonical layout.

## What it is

- **The mine** — a 24×97 tile grid (`specs/world.md`): a surface camp, then four bands —
  **topsoil**, **rockbed**, **deepstone**, **coreshell** — of increasing hardness, with
  the glowing **Core** in its chamber at the bottom. Ore veins, buried **Resonite** /
  **Cryenite** material nodes, **gas pockets**, and **lava** are scattered by band; a
  connectivity pass guarantees every run is winnable.
- **The miner** — a suited character animated across eight produced sprite-sheet cycles
  (idle, walk, drill-down, drill-side, jetpack, fall, hurt, fuel-out), driven by real
  physics: gravity, a fuel-burning jetpack (the only way up), and a drill that bites
  **down / left / right, never up**.
- **The loop** — dig ore → jetpack home → **sell** at the Ore Market → **buy upgrades**
  (fuel, drill, cargo, hull, scanner) → dig deeper. Fuel and hull refill free at the
  surface; the tension is getting home before the tank runs dry.
- **The climax** — extract the **Core Sample** (a 90-second destabilization timer starts),
  race back up past the lava, **fabricate the Ignition Core**, and **launch**.
- **Modes** — the mine and balance are identical; only death differs. **Standard** drops
  your haul as a retrievable cache and respawns you at the surface; **Hardcore** ends the
  run.

## Install

Requires Node 20+. From this directory:

```
npm ci
```

The particle runtime is vendored (`vendor/particle-runtime`, a `file:` dependency), so a
plain `npm ci` resolves everything offline — no monorepo or registry access needed.

## Develop

```
npm run dev       # Vite dev server (hot reload) at the printed URL
```

## Build

```
npm run build     # tsc --noEmit  +  vite build  →  dist/
npm run preview   # serve the production build locally
```

`vite.config.ts` sets `base: "./"` so every emitted URL (JS/CSS, sprite frames, particle
`system.json` files, and `.wav` audio) is **page-relative** — the `dist/` output runs
correctly at a host root **or** under a per-run sub-path like `/runs/<id>/build/`.

## Controls

| Input | Action |
| --- | --- |
| `A` / `D` or `←` / `→` | Move & drill sideways |
| `S` or `↓` | Drill down |
| `W` / `↑` / `Space` | Fire the jetpack (climb; burns fuel) |
| `E` / `Enter` or click a building | Open a surface building panel |
| `Esc` | Pause (also closes an open panel) |
| `M` | Mute / unmute |
| Mouse | Menus, panels, and the SELL / BUY / FABRICATE / LAUNCH buttons |

Audio does not start until your first interaction (browsers block autoplay); `M` toggles
mute.

## Layout

```
src/            the engine — game state machine + fixed-timestep sim + Canvas 2D renderer
assets/         the PRODUCED art, VFX, and audio (committed; see ASSET-LAYOUT.md)
scripts/        the asset-generation scripts (gen-*.sh)
vendor/         the vendored @test-cabinet/particle-runtime (prebuilt)
dist/           the production build (git-ignored)
```

Balance/tuning constants (fuel rates, drill times, ore values, upgrade prices, rocket
component costs) live in [`src/constants.ts`](src/constants.ts), each pinned to a spec.
