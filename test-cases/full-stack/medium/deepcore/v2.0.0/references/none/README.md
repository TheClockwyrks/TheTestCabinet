# Deepcore — reference implementation (base variant)

> **Status: carried forward from v1.0.0 and NOT yet ported.** This tree is
> v1.0.0's build, byte for byte. It is the raw material for v2.0.0's engineless
> reference, not that reference. It does not satisfy this version's
> specification, and nothing should be captured from it or read as evidence
> about it until the port lands.
>
> What the port has to close, at least:
>
> | Concern | This tree | What v2.0.0 fixes |
> | --- | --- | --- |
> | Debug surface | 40 compound operations (`teleport`, `addCargo`, `grantCredits`, `grantGear`, `startExpedition`, `openPanel`, `step`) | 52 atomic ones (`setMinerPosition`, `setCargo`, `setCredits`, `setTier`, `setScreen`, `setPanel`, `advance`), one field or one clock move each, per `specs/instrumentation.md` |
> | Constant names and values | `TILE_SIZE = 80`, `ORE_DENSITY = 0.15` | `TILE` (`80`), `ORE_DENSITY` (`0.14`), and 37 further named figures the specification states |
> | Specification | v1.0.0's fifteen specs | all fourteen rewritten; `specs/proof.md` gone |
> | Camera | a lead-based follow with `CAMERA_LEAD_FRACTION` (`0.335`), separate release (`1.1`) and reverse (`0.6`) times, and a `45` still-speed | the same shape restated as `CAM_LEAD_MAX` (`212`), `CAM_LEAD_RAMP` (`2`), one `CAM_UNWIND_MULT` (`4`) for both directions, and `CAM_STILL_SPEED` (`40`), with exact clamps and rates `specs/world.md` states |
>
> The two sibling directories, `references/simple-2d/` and
> `references/structured-2d/`, hold nothing but a README of their own for the
> same reason.

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

- **The mine** — a 32×97 grid of 80px tiles (`specs/world.md`), **wider than the
  viewport** so the camera scrolls both ways (only ~16 columns on screen at once): a
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
  **down / left / right, never up**.
- **The loop** — dig ore → jetpack home → **sell** at the Ore Market → **buy fuel and
  hull repair** at the Fuel Depot and **buy upgrades** (fuel, drill, cargo, hull, jetpack,
  radiator, scanner) → **save** at the Save Pad → dig deeper. Nothing refills for free —
  fuel and repair are a paid sink, so the tension is both getting home before the tank runs
  dry *and* affording the trip back down. The cargo bay caps ore by **slot count**; ore
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
  shorter or longer dig through the same game. The chosen size is saved with the expedition.
- **Saving** — the surface **Save Pad** is the only way to save (one slot); it has **no
  menu** — activating it (`E` / click) banks progress on the spot. **CONTINUE** on the main
  menu resumes it.

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
| `E` / `Enter` or click a building | Activate a surface building — opens its panel (Fuel Depot, Ore Market, Upgrade Shop, Supply Depot, Launch Pad), or **saves** directly at the Save Pad |
| `I` or the **BAG** button | Open the inventory (cargo hold) to review and **drop** ore, and **USE** field supplies |
| `1`–`6` | Use a field-supply item (dynamite, plastic explosives, quantum teleporter, matter transmitter, nanobots, emergency fuel) — bought at the **Supply Depot** |
| `J` | Jettison the carried Core Sample onto the ground (timer keeps running; one-way — can't be picked back up) |
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
