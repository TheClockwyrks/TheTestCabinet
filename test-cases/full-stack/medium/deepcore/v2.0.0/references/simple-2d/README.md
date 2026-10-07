# Deepcore

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

- **The mine** — a 32-column grid of 80-unit tiles running down to the Core chamber,
  **wider than the viewport** so the camera scrolls both ways (only ~16 columns on
  screen at once): a
  surface camp, then four bands — **topsoil**, **rockbed**, **deepstone**, **coreshell** —
  of increasing hardness, with the glowing **Core** in its chamber at the bottom. **Ten
  ore** types placed by **depth-frequency curves** at a **constant** density (4–5 available
  in any band, the mix shifting with depth), a rarer **gemstone** per band below the topsoil
  (**Verdite** / **Roselite** / **Aurite** — faceted cut jewels, worth 3× and weighing 2×
  that band's signature ore),
  buried **Resonite** / **Cryenite** material nodes, **hidden gas pockets** (drawn
  as ordinary dirt, betrayed only by a faint seep), **lava** (dirt-fringed), and
  **unbreakable-stone** boulders (routed around, never breakable) are scattered by band;
  carved tunnels are rendered with a Motherload-style inset dirt lip and rounded corners;
  a connectivity pass guarantees every run is winnable.
- **The miner** — a suited character animated across eight produced sprite-sheet cycles
  (idle, walk, drill-down, drill-side, jetpack, fall, hurt, fuel-out), driven by real
  physics: gravity, a fuel-burning jetpack (the only way up), and a drill that bites
  **down / left / right, never up**. Its climb is throttled by the weight in the bay, and
  past the jetpack tier's lift limit it cannot climb at all.
- **The loop** — dig ore → jetpack home → **sell** at the Ore Market → **buy fuel and
  hull repair** at the Fuel Depot and **buy upgrades** (fuel, drill, cargo, hull, jetpack,
  radiator, scanner) → **save** at the Save Pad → dig deeper. Nothing refills for free —
  fuel and repair are a paid sink, so the tension is both getting home before the tank runs
  dry _and_ affording the trip back down. The cargo bay caps ore by **slot count**; ore
  also has **weight** the jetpack must lift — open the **inventory** (`I`) to **drop** ore
  when overloaded.
- **Field supplies** — six single-use items bought at the **Supply Depot** (their own
  surface building) and used with `1`–`6` or the inventory: **Dynamite** / **Plastic
  Explosives** (blast a 3×3 / 5×5 clear — through unbreakable stone, setting off any gas),
  the **Quantum Teleporter** (risky drop to the surface) and **Matter Transmitter** (safe
  surfacing), **Regen Nanobots** (+hull), and **Emergency Fuel** (+fuel). The unstable
  **Core Sample** can also be **jettisoned** (`J`) as a ground item to flee its blast — a
  one-way discard that **can't be picked back up** (the **Core is inexhaustible**, so drill
  another).
- **The climax** — extract the **Core Sample** (a 90-second destabilization timer starts),
  race back up past the lava, **fabricate the Ignition Core**, and **launch**.
- **Modes** — the mine and balance are identical; only death differs. **Standard** lets you
  **restore from your last save**; **Hardcore** deletes the save and ends the run.
- **World size** — after the mode, pick **Quick** (half-depth), **Standard**, or **Marathon**
  (double-depth). The size scales only how **deep** the mine goes (the bands stay equal
  quarters and the ore/gas difficulty is keyed to the fraction of the descent), so it's a

## The engine

Deepcore is built on **Simple 2D** (`@clockwyrks/simple-2d`), which owns the frame loop
and the delta time each update is handed, the letterboxed device-pixel-ratio-aware fit of
the fixed `1280x720` stage onto the canvas, the named input actions the game registers, the
audio cue bus and its first-gesture unlock, the asset loader, and the read-only diagnostics
overlay on the backtick key. None of that is written here.

The engine draws nothing and holds no camera. It hands `render` a 2D context covering the
logical stage, and **the camera over the mine is the game's own transform on that context**
— `src/camera.ts` carries where it sits and the vertical lead it builds, and `src/render.ts`
applies and unwinds it.

The engine also holds the state **by value**: `update` is handed the current state as a
read-only view and returns the next one. A frame builds that next state in a mutable
**draft** (`src/state.ts`) that shares the mine's grid and replaces it a cell at a time, so
nothing here ever writes to a state the engine published — the type checker enforces it.

## Install

Requires Node 20+. From this directory:

```
npm ci
```

The engine and `@clockwyrks/particle-runtime` are resolved through relative `file:`
dependencies, so a plain `npm ci` resolves everything offline.

## Develop

```
npm run dev       # Vite dev server (hot reload) at the printed URL
```

## Build

```
npm run build     # tsc --noEmit  +  vite build  →  dist/
npm run preview   # serve the production build locally
```

`vite.config.ts` sets `base: "./"` so every emitted URL is **page-relative** — the `dist/`
output runs correctly at a host root **or** under a per-run sub-path. The produced assets
are copied into `dist/assets/` verbatim through `public/assets`, which links to the
committed `assets/` tree, so the paths the engine's loader resolves in development are the
paths the built site serves.

## Controls

| Input                             | Action                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A` / `D` or `←` / `→`            | Move & drill sideways                                                                                                                                     |
| `S` or `↓`                        | Drill down                                                                                                                                                |
| `W` / `↑` / `Space`               | Fire the jetpack (climb; burns fuel)                                                                                                                      |
| `E` / `Enter` or click a building | Activate a surface building — opens its panel (Fuel Depot, Ore Market, Upgrade Shop, Supply Depot, Launch Pad), or **saves** directly at the Save Pad     |
| `I` or the **BAG** button         | Open the inventory (cargo hold) to review and **drop** ore, and **USE** field supplies                                                                    |
| `1`–`6`                           | Use a field-supply item (dynamite, plastic explosives, quantum teleporter, matter transmitter, nanobots, emergency fuel) — bought at the **Supply Depot** |
| `J`                               | Jettison the carried Core Sample onto the ground (timer keeps running; one-way — can't be picked back up)                                                 |
| `Esc`                             | Pause (also closes an open panel)                                                                                                                         |
| `M`                               | Mute / unmute                                                                                                                                             |
| `` ` ``                           | Show and hide the engine's diagnostics overlay                                                                                                            |
| Mouse                             | Menus, panels, and the SELL / BUY / FABRICATE / LAUNCH buttons                                                                                            |

Audio does not start until your first interaction (browsers block autoplay); `M` toggles
mute.

## Layout

```
src/            the game: its state, its simulation, its renderer, and its debug surface
assets/         the produced art, effects, and audio (committed; see ASSET-LAYOUT.md)
public/assets   a link to assets/, which is how the bundler copies them into dist/
scripts/        the asset-generation scripts (gen-*.sh) and the showcase capture
showcase/       the store-page description and its captured media
dist/           the production build (git-ignored)
```

The modules under `src/` split along one line: what the simulation is
(`state`, `world`, `physics`, `drill`, `hazards`, `economy`, `items`, `rocket`, `scanner`,
`save`, `flow`, `simulation`), what the engine seam is (`input`, `audio`, `assets`,
`diagnostics`, `effects`), and what is drawn (`controls`, `render`, `theme`). `game.ts`
declares the state contract and binds the three functions the engine drives; `debug.ts` is
the automation surface its `initialize` returns beside the state.

Every figure the specification fixes lives in [`src/constants.ts`](src/constants.ts) under
the name the specification gives it, and every other module imports it from there. What the
specification leaves open — the camp's layout, the screen copy, the shake, the derived
depth curves — lives in [`src/tuning.ts`](src/tuning.ts), and the palette and the type in
[`src/theme.ts`](src/theme.ts).

## Tests

```
npm test          # Vitest, in Node, with coverage over src/
npm run typecheck # tsc --noEmit
npm run lint      # eslint .
npm run format    # prettier --check .
```

A test stands a **real engine** up over an `@napi-rs/canvas` canvas and a surface of its
own, with a `ConstantClock`, and drives the game with the same key and pointer events a
player's input sends — so it needs no browser. A rule that does not need a frame around it
is exercised over a draft directly. Every rate is per second and integrated against the
delta the update is handed, and the simulation reads nothing from the renderer.

## The showcase

`showcase/` holds the store-page description and its media. The carousel leads with a
**replay** — the engine's own recording of the frames the build drew, gzipped — rather than
a video, so what a reader sees is the game's own drawing. Recapture it with:

```
node scripts/capture-showcase.mjs
```

which serves the project, opens the capture page under `scripts/showcase/`, drives one
expedition with the same key events a keyboard sends, and writes the results into
`showcase/`.
