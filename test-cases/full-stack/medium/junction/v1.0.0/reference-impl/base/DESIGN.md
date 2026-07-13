# Junction — Reference implementation DESIGN

This is the implementation contract for the engineers who build the authored,
ground-truth **`base`** reference implementation of the `junction` full-stack case. It is
a self-contained static web app whose **core simulation is authored in Rust and compiled to
WebAssembly** (the case requirement, `specs/simulation.md`) and driven by a thin
**TypeScript** view layer rendering to a single **HTML5 canvas**, bundled with **Vite**
(`base: "./"`), no backend/accounts/network/API keys. All produced assets are committed
under `assets/` and loaded page-relative via `import.meta.glob`; the particle systems play
through `@test-cabinet/particle-runtime` and the audio through Web Audio.

**The Rust/wasm boundary.** The deterministic city model — the tile world, the network
graph, transit + congestion, utilities, the economy, development, the tools, and the game
state machine — lives in the **`sim-core/`** Rust crate, compiled with `wasm-pack` to the
**committed** `src/sim-core-pkg/` (a build INPUT, not a build step: `npm run build` is
Node-only and never runs `cargo`/`wasm-pack`; re-generate with `npm run build:wasm` and
commit). The front end (`src/*.ts`) owns only presentation and I/O: rendering, the HUD, the
camera, input, audio, and particle playback. The renderer reads the tile arrays **zero-copy**
as typed-array views over the wasm module's linear memory; the moving agents, HUD stats,
menus, and notifications cross as small per-frame copies — so a frame is one `step` call
plus direct reads. The same `sim-core` crate compiles **natively** for the balance harness
(`§7`), exactly as the adversarial case's `foray-core` compiles both native and to wasm.

Read the specs first — they are authoritative. This document does not restate them; it
pins the **numbers, types, module boundaries, layout, and proof plan** the engineers work
against. Every value here is consistent with `specs/overview.md` and the system specs;
where the spec leaves a value to us, this document fixes it and the `README` must state it
(the spec calls those out: zoning cost, walk distance, debt limit, refund policy,
re-zoning of developed tiles, tax model).

---

## 1. Game summary and rules

**Junction** is a top-down transit-and-utility city builder on a fixed **1280×720**
stage. The player looks straight down on a bounded tile map, **zones** buildable land
Residential / Commercial / Industrial, lays **roads and one rail line with stations**, and
runs **power (plant + wires)** and **water (source + pipes)**. Zoned tiles **develop
themselves** — but only where they have **road access + power + water + demand** — and grow
through **three density tiers**, then **abandon** when a precondition is lost. Citizens and
goods **path across** the network; overloaded links **congest** and slow every trip;
industry and jams emit **pollution** that lowers **land value** and suppresses nearby
development. A **budget** settles every in-game **month**: tax income vs. upkeep.

- **No win state.** Junction is open-ended (`specs/flow.md`): the "score" is **peak
  population** and **months survived solvent**, shown only at the end.
- **Loss = bankruptcy.** The treasury may go negative down to a **debt limit**
  (`DEBT_LIMIT = -$20,000`). When a budget period settles with the treasury **at or past**
  the debt limit **and** the period balance still negative, the city is **bankrupt**
  (`specs/economy.md`, `specs/flow.md`) → the bankruptcy state shows the final tally and
  offers restart. Above the limit the city runs on credit and can recover.
- **The `base` mode / start** (`specs/mode.md`, seeded as `specs/mode.md` from
  `mode-standard.md`): main menu entry **`NEW CITY`**, then **`HOW TO PLAY`**. The start is
  a **mostly flat buildable valley** with a winding **river** (water source + amenity) and
  a couple of **hills**; a **modest starting treasury** (`START_TREASURY = $30,000`); a
  **short pre-placed road stub** near the map centre; **RCI demand already positive** so
  zoning develops from the first months; the camera **centered on the stub** on load.
  This start config is isolated to `src/mode.ts`; everything else is common.

The game is a small state machine (`§5`): **title → howto**, **title → playing → paused**,
**playing → bankruptcy → playing/title**.

---

## 2. Core data model (Rust: `sim-core/src/types.rs` + tile arrays in `sim-core/src/world.rs`)

The model lives in the **Rust core**; the shapes below are given in TypeScript-ish form for
brevity but are Rust structs/enums in `sim-core/src/types.rs`, and the view layer mirrors
the handful it reads in `src/types.ts`. The world is a **struct-of-arrays tile grid** (dense
`Vec<u8>`/`Vec<f32>`/`Vec<i16>` arrays indexed by `idx = row * MAP_COLS + col`) for the
per-tile fields the sim sweeps every tick, plus object lists for placed sources and moving
agents. The `u8`/`f32` tile arrays are the ones the renderer reads **zero-copy** as
typed-array views over wasm linear memory (`§4`, the `World` view in `src/sim.ts`); their
pointers are stable because the `Vec`s are allocated once and never resized.

### 2.1 Enums and small unions

```ts
export type Terrain = "earth" | "grass" | "water" | "hill";       // specs/map.md
export type ZoneKind = "res" | "com" | "ind";                     // specs/map.md
export type NetKind  = "road" | "rail" | "wire" | "pipe";         // per-tile carriers
export type Tier = 0 | 1 | 2 | 3;   // 0 = empty lot, 1 low / 2 med / 3 high (specs/map.md)

export type Tool =
  | "zoneRes" | "zoneCom" | "zoneInd"
  | "road" | "rail" | "station"
  | "plant" | "wire" | "source" | "pipe"
  | "bulldoze";                                                    // specs/controls.md

export type GameState = "title" | "howto" | "playing" | "paused" | "bankrupt";
export type Overlay = "none" | "traffic" | "utility" | "landvalue"; // specs/controls.md
export type VehicleKind = "car" | "truck" | "tram";
export type Cue = "build" | "chime" | "alert";                    // produced audio events
export type FxKind = "haze" | "dust" | "fireworks";               // produced particle systems
```

### 2.2 Per-tile fields (parallel typed arrays, length `MAP_COLS*MAP_ROWS`)

| Array | Type | Meaning |
| --- | --- | --- |
| `terrain` | `Uint8Array` (Terrain) | fixed at start; gates buildability (`specs/map.md`) |
| `zone` | `Uint8Array` (0 = none, else ZoneKind+1) | painted zone kind |
| `net` | `Uint8Array` bitmask (road/rail/wire/pipe/station/span) | which carriers occupy the tile |
| `tier` | `Uint8Array` (Tier) | current developed density tier (0 = empty lot) |
| `build` | `Float32Array` 0..1 | construction/upgrade progress toward next tier |
| `decay` | `Float32Array` 0..1 | dilapidation progress toward abandonment |
| `pollution` | `Float32Array` 0..100 | diffusing pollution field (`specs/economy.md`) |
| `land` | `Float32Array` 0..1 | computed land value (`specs/economy.md`) |
| `powered` | `Uint8Array` bool | reached & served by a power network this tick |
| `watered` | `Uint8Array` bool | reached & served by a water network this tick |
| `access` | `Uint8Array` bool | within `WALK_TILES` of the road network |
| `roadNet` / `railNet` / `powerNet` / `waterNet` | `Int16Array` | connected-component id per carrier (recomputed on edit) |
| `load` | `Float32Array` | trips assigned to this road/rail tile this tick (traffic overlay + congestion) |
| `cap` | `Float32Array` | link capacity (derived from net kind) |

Buildings/lots are **not** separate objects — a developed tile is `zone!=none && tier>0`;
its sprite is chosen from `(zone, tier)` (`src/assets.ts`). This keeps the develop/abandon
sweep a cheap array pass.

### 2.3 Object lists (on the `World` / `Game`)

```ts
export interface Source {            // a power plant or water source (2×2 footprint)
  id: number; kind: "plant" | "source";
  col: number; row: number;          // top-left tile
  capacity: number;                  // POWER_PLANT_CAP / WATER_SOURCE_CAP
  supplied: number;                  // demand actually met this tick (for over-draw read)
  net: number;                       // connected-component id it feeds
}

export interface Vehicle {           // a visible agent on the network (specs/transit.md)
  id: number; kind: VehicleKind;
  path: number[];                    // tile indices, origin→destination
  seg: number; t: number;            // segment index + 0..1 along it (interpolated render)
  speed: number;                     // px/s, scaled down by the congestion on its tile
  angle: number;                     // heading, for sprite rotation
}

export interface Milestone { id: string; label: string; }   // fired once (fireworks + chime)

export interface Notification {      // brief, non-blocking HUD toast (specs/flow.md)
  text: string; age: number; ttl: number; tone: "info" | "good" | "alert";
}

// animated junction signal
export interface Signal { col: number; row: number; phase: number; }
```

### 2.4 Aggregate / economy state (`GameStats`, recomputed per month settle)

```ts
export interface Rci { r: number; c: number; d: number; }   // demand −100..+100 (d = industrial)

export interface Budget {
  treasury: number;                  // $ (may be negative to DEBT_LIMIT)
  income: number; upkeep: number;    // last settled period, $/month
  balance: number;                   // income − upkeep
  taxRate: number;                   // TAX_DEFAULT.., set by the player
}

export interface GameStats {
  population: number; jobs: number; shops: number;
  peakPopulation: number;
  power: { supply: number; demand: number };   // top-strip balance + shortfall flag
  water: { supply: number; demand: number };
  monthsSurvived: number;            // whole budget periods elapsed
}
```

### 2.5 The `Game` object (owned by `src/sim.ts`)

Holds the `World` (tile arrays + `sources`), `vehicles`, `signals`, `rci`, `budget`,
`stats`, the current `state`/`overlay`/`activeTool`/`paused`/`speed`, the `Camera`
(`§4`), the selection & hover tile, `notifications`, fired `milestones`, and two **queues
drained by `main.ts`** each frame — `sndQueue: Cue[]` and `fxQueue: {kind:FxKind; x:number;
y:number; strength:number}[]` — exactly the valence pattern (sim never touches Web Audio or
canvas directly). `Game` also exposes the tool actions (`applyTool`, `bulldoze`,
`setTaxRate`) and the fixed-step entry `fixedStep(dt)`.

---

## 3. Constants & tuning table

The numbers split by concern: the **simulation tuning** (grid size, tiers, transit/utility
capacities, the economy and RCI coefficients, milestones — every number a *rule* reads) lives
in the Rust core at **`sim-core/src/constants.rs`**, and the **presentation** constants the
view needs (the palette `COL`, `FONT`, stage/camera geometry, `NET_*` bit values the renderer
tests, the tool palette metadata) stay in **`src/constants.ts`**. Values the spec leaves to
us are fixed in `constants.rs` and restated in the `README`. The **native balance harness**
(`sim-core/tests/balance.rs`, `§7`) validates the tunables; treat the economy numbers as its
starting point — a tuning change is a one-line edit in `constants.rs` re-checked with
`cargo test`.

### 3.1 Stage, grid, camera (`specs/overview.md`, `specs/map.md`, `specs/controls.md`)

| Const | Value | Note |
| --- | --- | --- |
| `STAGE_W`,`STAGE_H` | 1280, 720 | fixed logical stage |
| `TOP_H`,`BOT_H` | 64, 64 | HUD strips: top `[0,64]`, bottom `[656,720]` |
| `VIEW_Y0`,`VIEW_Y1` | 64, 656 | city view band, full width |
| `TILE` | 24 | logical px per tile at 1× zoom |
| `MAP_COLS`,`MAP_ROWS` | 96, 72 | map is 2304×1728 world px — larger than the view |
| `ZOOM_MIN/DEF/MAX` | 16 / 24 / 34 | on-screen px per tile (mouse-wheel zoom) |
| `PAN_SPEED` | 640 | world px/s for keyboard pan |
| `EDGE_MARGIN` | 24 | edge-scroll band (screen px) |

### 3.2 Simulation & clock (`specs/controls.md`, `specs/flow.md`)

| Const | Value | Note |
| --- | --- | --- |
| `TICK_HZ` | 6 | fixed sim ticks/sec |
| `FIXED_STEP` | 1/6 | seconds per tick (render interpolates between) |
| `TICKS_PER_MONTH` | 24 | ⇒ 4 s/month at 1× — the budget period beat |
| `SPEEDS` | `[1, 2, 3]` | normal / fast / faster tick multipliers |
| `START_MONTH` | `{ month: 0, year: 2027 }` | HUD clock; renders `MMM YYYY` |

### 3.3 Terrain & palette (`specs/overview.md`)

`COL` holds the exact palette hex from `specs/overview.md`, keyed by role — the whole table
verbatim (`bg #12161c`, `earth #2a2f26`, `grass #33502f`, `water #245a73`, `hill #3a3630`,
`res #4caf6d`, `com #4a90d9`, `ind #e0a63c`, `road #3c434d`, `rail #b061e6`,
`station #ece6db`, `power #ffcb52`, `pipe #47c8e0`, `congest #ff7a3c`, `pollution #8a7d5a`,
`money #7cd45a`, `alert #ff5a52`, `panel #161b22`, `text #e6ebf0`, `text2 #9aa4af`,
`text3 #5b6570`). `FONT` is a **system monospace stack** (no downloaded web font):
`"SF Mono","JetBrains Mono","DejaVu Sans Mono",Menlo,Consolas,monospace`.

### 3.4 Zones, tiers, development (`specs/map.md`, `specs/economy.md`)

| Per-tier array (index = tier 1..3) | res | com | ind |
| --- | --- | --- | --- |
| `POP` (residents) | 10 / 30 / 75 | — | — |
| `JOBS` | — | 8 / 24 / 55 | 12 / 32 / 80 |
| `SHOP_CAP` (shopping slots) | — | 12 / 34 / 78 | — |
| `UTIL_DEMAND` (power = water, units) | 1 / 3 / 6 | 1 / 3 / 6 | 2 / 5 / 10 |
| `POLL_EMIT` (per tick) | 0 | 0 | 0.4 / 0.9 / 1.6 |
| `TAX_BASE` (per occupant, monthly) | — | — | scaled by `land` and `taxRate` |

Development gates & pace:
`WALK_TILES = 3` (road-access reach). Construction: `BUILD_TICKS = 18` (≈3 s, plays the
construction sheet + one dust puff, `specs/map.md`). Tier-up needs demand>0, services,
and `land ≥ LAND_TIER = [_, 0.50, 0.72]` sustained `UPGRADE_TICKS = 48`. Abandonment: a
tile missing any precondition accrues `decay` at `DECAY_RATE = 1/36 per tick`; at 1.0 it
drops a tier (or reverts a tier-1 to an empty lot). Regaining preconditions bleeds `decay`
back down. **Zoning cost** `ZONE_COST = $10/tile`, **no upkeep** (`README`); re-zoning a
developed tile is **refused** until it is bulldozed (`README`).

### 3.5 Transit (`specs/transit.md`)

| Const | Value | Note |
| --- | --- | --- |
| `ROAD_CAP` | 14 | trips/tick a road tile carries at full speed |
| `RAIL_CAP` | 70 | rail segment capacity (high, offloads roads) |
| `CONGEST_K` | 1.5 | travel-time mult = `1 + K·max(0, load/cap − 1)` |
| `SPAN_TILES` | bridge/tunnel | road/rail/wire/pipe over water/hill only as a span |
| `COMMUTE_FRAC` | 0.6 | share of a res tile's pop that makes a work/shop trip |
| `RAIL_SPEED_MULT` | 2.0 | a station-to-station leg is this much faster than road |
| `VEHICLE_CAP_ON_SCREEN` | 220 | render budget — aggregate flow, sample vehicles to draw |

Congestion coloring on the traffic overlay ramps `load/cap` from clear →
`congest #ff7a3c` → `alert #ff5a52` (`specs/transit.md`).

### 3.6 Utilities (`specs/utilities.md`)

`POWER_PLANT_CAP = 150`, `WATER_SOURCE_CAP = 150` supply units. A tile is served when
adjacent to a carrier whose component traces to a source with spare capacity; over-draw
starves the **farthest-from-source tiles first** (deterministic BFS order), which is the
visible effect the spec asks for.

### 3.7 Economy: costs, upkeep, budget (`specs/economy.md`, `specs/transit.md`, `specs/utilities.md`)

| Item | Capital $ | Upkeep $/month |
| --- | --- | --- |
| Zone R/C/I (per tile) | 10 | 0 |
| Road (per tile) | 12 | 2 |
| — span over water/hill | +48 (=60) | +4 (=6) |
| Rail (per tile) | 30 | 4 |
| Station | 200 | 12 |
| Wire (per tile) | 6 | 1 |
| Pipe (per tile) | 6 | 1 |
| Power plant (2×2) | 700 | 30 |
| Water source (2×2) | 450 | 22 |
| Bulldoze | 4 | — (refunds `BULLDOZE_REFUND = 0.4` of capital) |

Budget: `START_TREASURY = 30000`, `DEBT_LIMIT = -20000`, `TAX_DEFAULT = 0.09`,
`TAX_MIN/MAX/STEP = 0 / 0.20 / 0.01`. Monthly **income** `Σ occupant·land·taxRate·TAX_CAPITA`
(`TAX_CAPITA = 1.8`, tunable via `sim/`); a higher `taxRate` also **suppresses demand**
(`§3.8`). **Bankruptcy** when a settle finds `treasury ≤ DEBT_LIMIT && balance < 0`.

### 3.8 Pollution, land value, RCI demand (`specs/economy.md`)

- **Pollution field** (per tick): sources add `POLL_EMIT` (industry) and
  `0.15·max(0,load/cap−1)` (congested roads); then diffuse with `POLL_DIFFUSE = 0.12` to
  4-neighbors and decay `POLL_DECAY = 0.04`; clamp `[0,100]`.
- **Land value** (per tile, recomputed each tick, `0..1`): `base 0.35` `+ amenity`
  (water/park within radius 4, up to `+0.30`) `+ 0.15` if powered+watered+access `+ 0.10`
  near a station `− 0.6·(pollution/100)` `− up to 0.25` for adjacent congestion; clamp.
- **RCI demand** (`−100..+100`, eased toward targets each month):
  `R ← k·(openJobs) − kv·(vacantHousing) − TAX_PEN·taxRate`;
  `C ← k·(population/shopNeed unmet) + k·(goodsFromIndustry) − oversupplyC − TAX_PEN·taxRate`;
  `D(ind) ← k·(commercialGoodsPull) + k·(workforce) − oversupplyI − TAX_PEN·taxRate`.
  `TAX_PEN = 220`. The exact coefficients live here and are validated by `sim/`; what must
  hold (per spec) is the loop — jobs pull R, people pull C/I, oversupply pushes a demand
  negative — and that growth is **capped by service** (a tile only develops toward demand
  when access+power+water+land allow).

### 3.9 Milestones (`specs/flow.md`)

`MILESTONES`: first rail line built; population ≥ 500 / 2 000 / 5 000 / 10 000; first tier-3
building; first fully-served district. Each fires **once** → a `Notification` + the
**fireworks** particle one-shot + the **chime** cue.

---

## 4. Module breakdown

Two halves: the **Rust simulation core** (`sim-core/src/*.rs`, compiled to wasm) and the
**TypeScript view layer** (`src/*.ts`) that drives it.

### 4.1 Rust core — `sim-core/src/*.rs`

| File | Responsibility | Key items |
| --- | --- | --- |
| `constants.rs` | All simulation tuning (`§3`): grid/clock, per-tier tables, transit/utility caps, cost/upkeep, pollution/land/RCI coefficients, milestones, tool placement metadata. | `POP/JOBS/UTIL_DEMAND`, `COST/UPKEEP`, `RCI_*`, `NET_*`, `drag_kind`, … |
| `types.rs` | The data model (`§2`): enums (`Terrain`/`ZoneKind`/`Tool`/`GameState`/…), `Source`, `Vehicle`, `Notification`, `Signal`, `Rci`, `Budget`, `GameStats`, `FxEvent`, `Snapshot`. | all enums/structs above |
| `rng.rs` | Seeded PRNG (mulberry32, wrapping-u32 exactly matching the JS stream) so terrain gen and vehicle spawns are deterministic. | `Rng` |
| `world.rs` | The tile grid: allocates the `Vec` arrays (`§2.2`), index helpers, the **starter-valley generator** (river, hills — `specs/mode.md`), buildability, net-bitmask helpers. | `World`, `idx`, `in_bounds`, `buildable`, `generate_valley(seed)` |
| `graph.rs` | Connected-component labelling per carrier (rebuilt on edit) + the multi-source Dijkstra **route field** over the road+rail graph weighted by live per-link travel time. | `rebuild_networks`, `route_field` |
| `transit.rs` | **Signature system.** Each tick: trips from developed R tiles to nearest jobs/shops, load laid on links via `route_field`, congestion travel-time, spawn/advance visible `Vehicle`s. Writes `access`, `load`. Plus `rebuild_signals`, `vehicle_pos`. | `step_transit`, `vehicle_pos`, `rebuild_signals` |
| `utilities.rs` | Power & water: propagate supply through each source's component, mark `powered`/`watered`, resolve **over-draw** (farthest-first), report supply/demand. | `step_utilities` |
| `economy.rs` | Pollution diffusion+decay, land-value recompute, monthly **RCI demand** update, and the **budget settle** (income/upkeep/treasury, bankruptcy test). | `step_pollution`, `recompute_land`, `update_rci`, `settle_budget` |
| `develop.rs` | Per-tile develop/upgrade/abandon sweep from the gate conditions (`access && powered && watered && demand>0 && land≥tier`), driving `build`/`decay`/`tier`, queuing dust FX. | `step_development` |
| `tools.rs` | Tool legality (with refusal reasons), span-aware cost, placement + bulldoze mutation, `tiles_for_drag`, `source_covering`. | `can_place`, `capital_cost_at`, `apply_tool`, `tiles_for_drag` |
| `mode.rs` | The `base` start config (`specs/mode.md`): `menu_label "NEW CITY"`, tagline, seed, `START_TREASURY`, starting RCI, stub geometry. | `MODE` |
| `menus.rs` | The core owns each state's menu list (title/howto/paused/bankrupt) so render + keyboard nav agree; the highlight index lives on the `Game`. | `menu_items(state)` |
| `game.rs` | The `Game`: owns world/economy state, the **state machine**, the menu index; `fixed_step(dt)` orders the tick; tool/selection/tax actions; `snd`/`fx` queues; the scripted proof surface. DOM-free — the camera is a front-end concern. | `Game` |
| `wasm.rs` (wasm only) | The `#[wasm_bindgen]` boundary: `step`, tile-array pointers (zero-copy), packed vehicle/signal/source snapshots, scalar getters, menus, `tool_preview`, action + proof methods, `drain_sounds`/`drain_fx`. | `Sim`, `wasm_memory` |
| `tests/balance.rs` | The native balance harness (`§7`) — `cargo test`. | — |

### 4.2 TypeScript view layer — `src/*.ts`

| File | Responsibility | Key exports |
| --- | --- | --- |
| `sim.ts` | Loads the wasm core (`sim-core-pkg/`) and presents it as a `Game`: zero-copy tile-array `World` views (rebuilt on memory growth), live scalar getters, per-frame vehicle/signal/source/notification reads, the menu list, `toolPreview`, the queue drains, and every player/proof action. | `Game`, `createGame`, `initSim` |
| `grid.ts` | Pure tile-index geometry helpers the renderer/input need (mirror the Rust `world` helpers). | `idx`, `colOf`, `rowOf`, `inBounds` |
| `constants.ts` | Presentation constants: palette `COL`, `FONT`, stage/camera geometry, `NET_*` bit values, the tool palette metadata `TOOLS`. | `COL`, `FONT`, `TILE`, `NET_*`, `TOOLS`, … |
| `types.ts` | The view-side mirror of the enums/small unions the renderer reads. | the unions above |
| `camera.ts` | Camera pan/zoom, **clamp to map bounds**, `world↔screen` restricted to the `[64,656]` band. This is the one piece of spatial state the FRONT END owns. | `Camera` |
| `assets.ts` | Load the **produced** files via `import.meta.glob` (page-relative), map `(zone,tier)`→sprite, road-shape→sprite, icon lookups, `FxKind`→system, `Cue`→wav url. | `loadAssets`, `zoneSprite`, `roadSprite`, `iconOf` |
| `audio.ts` | Web Audio playback of the produced `.wav`s — cues on events, ambient hum + music bed looped, no autostart before gesture, mute toggle. | `Audio` |
| `particles.ts` | Play produced systems through `@test-cabinet/particle-runtime`'s `/canvas` binding: persistent **pollution-haze** + one-shot dust/fireworks. | `Haze`, `Bursts` |
| `overlays.ts` | The in-code data overlays (traffic/utility/land-value) drawn from the tile views. | `drawOverlay` |
| `hud.ts` | The in-code HUD chrome (top vitals, bottom RCI + palette + cost readout + tax stepper) + the shared canvas primitives; returns `Clickable[]`. | `drawHud`, `text`, `roundRect`, `blit`, `hexA` |
| `render.ts` | The frame: terrain/zones/buildings/carriers/utilities (produced sprites), interpolated vehicles + animated sheets, the live haze, then `overlays`, `hud`, selection/tool ghost (from `game.toolPreview`), and the menu/state screens. | `render` |
| `input.ts` | Pointer + keyboard capture, viewport transform to logical space, drag tracking, wheel→zoom. | `Input` |
| `main.ts` | Bootstrap: fit the stage, load assets **and** the wasm core, wire input, run the fixed-timestep loop, drain the core's sound/fx queues (fireworks placed at the view centre), expose `window.__junction`. | — |

`src/vite-env.d.ts`, `index.html` (single `#stage` canvas, monospace, `image-rendering:
pixelated`, `#12161c` background), `vite.config.ts` (`base: "./"`), `tsconfig.json`,
`package.json` (+ committed `package-lock.json`), a vendored `vendor/particle-runtime/` copy
so a plain `npm ci` resolves the `file:` dep, and the committed `src/sim-core-pkg/` wasm
build input (re-generated with `npm run build:wasm`, never by `npm run build`).

---

## 5. Render / HUD layout and state machine

### 5.1 Stage bands (`specs/overview.md`)

Everything is drawn in logical 1280×720 space; `main.ts` fits it to the window
(letterboxed, centered, `imageSmoothingEnabled=false`, correct before any input, any DPR).

- **Top HUD strip `y ∈ [0,64]`** — the city vitals dashboard, left→right (from the
  `gameplay` mockup): **TREASURY** (money icon + `$` in `money`/`alert` by sign), **BALANCE**
  (`±$N/mo`), **POPULATION**, **POWER** (`%` served + a small meter bar), **WATER** (`%` +
  meter), a flexible spacer, an **ALERT chip** when a condition is live (losing money /
  near debt limit / a network over-drawn / a gridlocked corridor named), and the
  **CLOCK** (`MMM YYYY`) + **SPEED** indicator (`▶ / ▶▶ / ▶▶▶`, or `❚❚` when paused).
- **City view `y ∈ [64,656]`, full width** — the top-down camera onto the tile map.
  Draw order: terrain fill → pollution/land overlay tint (if toggled) → zoned lots →
  developed **building sprites** by `(zone,tier)` → **road/rail/station** sprites (road
  shape chosen from neighbors) → **wire/pipe** sprites → **plant/source** 2×2 sprites →
  **live pollution haze** particles → **vehicles** (interpolated, animated sheets) +
  **signal** sheets at junctions → traffic/utility overlay (if toggled) → selection/hover
  cursor, tool ghost + drag rectangle, illegal-placement refusal cue.
- **Bottom HUD strip `y ∈ [656,720]`** — **RCI meters** (three vertical bars R/C/I, filled
  by demand, labelled by letter and color) toward the left; a divider; the **build
  palette** (tool buttons: `RES COM IND ROAD RAIL STATN PWR WIRE WTR PIPE RAZE`, active one
  highlighted, each with its produced glyph icon) toward the right; the **cost readout**
  (active tool name + `$N/tile` or total) at the far right; a compact **tax stepper**
  (`TAX 9% ◂ ▸`) adjacent — also bound to `[` / `]`.

Colorblind-safe: each zone reads by **building form** as well as hue, road vs rail read as
different link forms, and the HUD names each in words (`specs/overview.md`).

### 5.2 State machine (`specs/flow.md`, `specs/controls.md`)

```
title ──NEW CITY──▶ playing ──Esc──▶ paused ──Resume──▶ playing
  │                    │                 ├─Restart──▶ playing (fresh valley)
  │                    │                 └─Quit─────▶ title
  ├──HOW TO PLAY──▶ howto ──Back/Esc──▶ title
  └◀──MENU── bankrupt ◀──insolvent past debt limit── playing
                 └──TRY AGAIN──▶ playing (fresh valley)
```

- **In-place pause** (`Space`) is a **flag** (`game.paused`), not a state: ticks freeze but
  the board stays interactive (pan, overlays, place). Distinct from the **`Esc` paused
  menu** state, which also freezes (`specs/controls.md`).
- Menus (title/howto/paused/bankrupt) are pointer- **and** keyboard-navigable
  (`↑/↓`/`W`/`S` move, `Enter`/`Space` confirm, `Esc` back); `menus.ts` is the shared list.
- **Bankruptcy** screen shows the **final tally**: `PEAK POPULATION`, `SURVIVED N MONTHS`,
  and `FINAL DEBT −$N` (matching the `game-over` mockup), with `TRY AGAIN` / `MENU`.

### 5.3 Camera & tools (`specs/controls.md`)

Pan: arrows/`WASD`, mouse-drag, and edge-scroll; **clamped** to map bounds. Zoom: mouse
wheel between `ZOOM_MIN..MAX`, HUD strips fixed. Tools: exactly one active; click or **drag**
to paint zones / lay runs; illegal placement (water/hill zone, unaffordable build, station
off the road net, source not beside water) **refused clearly** with a cursor cue; spans
over water/hill priced up in the readout. Speed keys `1/2/3` (or `+`/`-`), `Space` pause,
`M` mute, overlay toggle keys (e.g. `Tab` cycles `none→traffic→utility→landvalue`).

---

## 6. Proof plan (`specs/proof.md`)

Captured from the **built** game with the project-local Playwright (`scripts/proof.mjs`,
pinned in `package.json`), driven through a `window.__junction` test hook that `main.ts`
exposes. The hook offers deterministic helpers so the captures are reproducible:
`newCity(seed)`, `zoneRect(kind,c0,r0,c1,r1)`, `road(c0,r0,c1,r1)`, `rail(...)`,
`station(c,r)`, `plant(c,r)`, `source(c,r)`, `wire(...)`, `pipe(...)`, `setTax(rate)`,
`setTreasury(v)`, `setSpeed(n)`, `setOverlay(o)`, `centerOn(c,r)`, `advance(months)`,
`snapshot()` (population/treasury/balance), and `forceBankruptcy()` (drops tax to 0 and
strips income for the crisis clip). Each helper drives the real **wasm core** through the
`Game` binding — no fake state. Because the core lives in wasm linear memory, the mjs reads
tile state through the live `g.world` view (a step can grow memory and detach an earlier
view) and stages the treasury via `setTreasury` rather than writing a field.

| Artifact | What to drive & capture |
| --- | --- |
| `proof/title.png` | Load the built site → title state. Screenshot the full 1280×720 stage: `JUNCTION`, tagline `ZONE. CONNECT. GROW.`, menu `NEW CITY` / `HOW TO PLAY` (first highlighted), dim city slice behind. |
| `proof/gameplay.png` | `newCity(SEED)`; script a healthy city: zone R (left), C (centre), I (by the river); lay a road grid + one **rail line with two stations** along the busy corridor; place a **power plant + wires** and a **water source + pipes**; `advance(≈24)` months so districts **develop to tiers 1–3** (produced sprites), vehicles are pathing, and the **pollution haze** sits over industry. `centerOn` the developed core, ensure the full HUD (top vitals + bottom RCI + palette) reads, screenshot. |
| `proof/game-over.png` | From a developed city, `forceBankruptcy()` (tax→0 / strip income) or over-build networks; `advance` until the treasury crosses `DEBT_LIMIT` and the settle flips to **bankrupt**. Screenshot the bankruptcy screen with `PEAK POPULATION`, `SURVIVED N MONTHS`, `FINAL DEBT`, `TRY AGAIN`/`MENU`. |
| `proof/systems.webm` | `recordVideo` a few seconds: zone a fresh block and lay road/rail/utilities into it → watch it **develop** (construction dust puffing, buildings rising through tiers); vehicles pathing; then `setOverlay("traffic")` to show a corridor **congesting** (orange→red) and **ease** after the rail line pulls trips off it, with the **RCI meters** and **utility balances** visibly responding. |
| `proof/crisis.webm` | `recordVideo` the **budget pressure**: over-extend (or `setTax(0)`) so the per-period **balance goes negative** and the **treasury falls**, the **ALERT chip** shows (losing money / near debt limit / network over-drawn), sliding toward — ideally reaching — **bankruptcy**. Leave audio un-muted so the produced alert/ambient are captured. |

`scripts/proof.mjs` launches the preview server (or dev server), sets a 1280×720 viewport,
and writes each file to the exact `proof/…` path; `proof/` is an output committed beside the
build, not served by it.

---

## 7. Balance harness (`sim-core/tests/balance.rs`, native `cargo test`)

Because the `sim-core` crate compiles **natively** as well as to wasm, the balance goals are
asserted with plain `cargo test` — no browser, no wasm, no separate tsx harness. Each test
drives the real `Game` with a scripted "player" strategy (the same build the proof capture
uses) and asserts the economy behaves, validating the `§3` numbers rather than guessing them:

- **A competent build-out** (zone to demand, connect+serve before developing, add rail when
  a corridor congests, keep tax ~9%) must **grow population** and stay **solvent for many
  months** (well past when an over-builder is already bankrupt). Perpetual solvency is not
  a given — the economy is tuned so an over-wired city loses money each period (the core
  tension), so the assertion is a long viable window, not that the treasury never falls.
- **A careless over-builder** (lay networks far ahead of the tax base) must **go bankrupt**.
- **A neglecter** (strip income / stop growing) must eventually **go insolvent**.
- **Cutting a plant** must **abandon** the tiles that depended on it.
- Determinism: same seed + same script ⇒ identical month-by-month treasury/population.

The harness uses `Game` directly (no forked sim), so a tuning change is a one-line edit in
`sim-core/src/constants.rs` re-checked by re-running `cargo test` — then re-run
`npm run build:wasm` to refresh the committed wasm build input.
