# Hollowdeep — reference implementation DESIGN

This is the **implementation contract** for the authored, ground-truth build of the
`hollowdeep` full-stack case — the analogue of the committed `valence` reference
implementation, and the *correct* build the case is judged against. It mirrors
valence's shape: plain **TypeScript** rendering to a single **Canvas 2D** stage,
bundled with **Vite** (`base: "./"`), no backend, and every sprite / animation /
particle system / sound **produced during the build** with the six on-`PATH` tools
and committed under `assets/` (see [`ASSETS.md`](ASSETS.md), derived from
`specs/assets.md`). The runtime only *loads* those files; the particle overlays play
live through **`@test-cabinet/particle-runtime`** (vendored under `vendor/` so a plain
`npm ci` resolves it outside the monorepo).

Read the eight system specs plus `specs/assets.md` and `specs/proof.md` first; this
document says **how** to build them and pins every tunable number in one place. Where a
number here and a spec disagree, the spec wins and this doc is corrected.

---

## 1. Game summary, win/lose, and the mode base

**Hollowdeep** is a side-view sealed-colony survival sim in the spirit of *Oxygen Not
Included*. You look at a cross-section of a sealed underground and keep a small crew of
**delvers** alive. You **dig** into dirt/ore/rock to open living space and mine ore,
**refine** ore into build **material**, and place **build orders** that delvers
construct — walls, floors, ladders, wires, machines, a fungus farm. The defining
pressure is the **air economy**: the colony opens with a finite pocket of breathable
**oxygen**; every delver breathes it and exhales **CO2**, both diffuse through the open
space (CO2 sinks, oxygen rises), and left alone the pocket sours and the crew
suffocates. Survival is a race to stand up **powered oxygen generation** (generator +
wire + diffuser) and a **food source** before the starting air runs out, then hold the
colony against its own consumption.

- **No win screen.** Survival is open-ended; the game measures **cycles survived**.
- **Loss.** The colony is **lost** when the **last delver dies** — every delver has
  suffocated (oxygen too thin or CO2 too toxic, health to zero) or **starved** (hunger
  maxed with no food). The **colony-lost** screen shows cycles survived + a secondary
  tally and offers RESTART / MENU.
- **Score** = cycles survived (primary) + tiles dug + material banked + delvers alive at
  the end. Not persisted between sessions.

**The mode base — `NEW COLONY`** (`specs/mode.md`, seeded to `specs/mode.md` by the
`base` variant). The standard survival start, isolated to `src/mode.ts`:

- **3 delvers** stand in a modest **opening cavern** already filled with a finite pocket
  of breathable oxygen (`START_OXYGEN` per open tile, near-zero CO2).
- A **modest starting stock of material** (`material: 30`) so the first buildings go up
  without waiting on the whole dig→refine chain; `ore: 0`, `food: 8`.
- **Ore seams** within reach in the surrounding rock.
- Uses every common system with no overrides. The main menu lists `NEW COLONY`, then
  `HOW TO PLAY`.

---

## 2. Tech stack, build, and files-on-disk

- **Language / render:** TypeScript, Canvas 2D, one `<canvas id="stage">`. Monospace
  system font stack (no downloaded web font). `imageSmoothingEnabled = false` +
  `image-rendering: pixelated` so the produced pixel art stays crisp.
- **Bundler:** Vite, `base: "./"`, `build.outDir: "dist"`. `npm run build` =
  `tsc --noEmit && vite build`. Output is a self-contained static site with `index.html`
  at the root of `dist/`, correct under any base path (per-run sub-path safe).
- **Install:** `npm ci` (a committed `package-lock.json` is required). `dependencies`:
  `@test-cabinet/particle-runtime` via `file:vendor/particle-runtime`. `devDependencies`:
  `playwright`, `typescript`, `vite`.
- **Stage fit:** `main.ts` letterboxes the fixed `1280×720` stage into the window,
  centered, correct on load before any input and at any DPR (mirror valence `resize()` +
  `setTransform`).

Directory shape (mirrors valence):

```
reference-impl/base/
  index.html  package.json  package-lock.json  tsconfig.json  vite.config.ts  .gitignore
  README.md   DESIGN.md   ASSETS.md
  src/            the game (§4)
  sim/            headless balance harness, dev-only, excluded from the build (§7)
  scripts/        gen-assets.sh (produce assets), proof.mjs (capture proofs)
  assets/         the produced sprites, frames, particle systems, audio (ASSETS.md)
  vendor/particle-runtime/   vendored prebuilt runtime
  proof/          the five committed proof artifacts (§8)
```

---

## 3. Core data model (`src/types.ts`)

These are the contracts every later module reads. Coordinates: **tile** coords are
integers `(tx, ty)` in `[0,64)×[0,44)`; **world-pixel** coords are `tile * TILE`;
**screen** coords come from the camera transform (`world.ts`).

```ts
// ---- Tiles & the world ----------------------------------------------------------
export type TileKind =
  | "dirt" | "ore" | "rock" | "bedrock"     // solid natural (bedrock indestructible)
  | "open"                                   // dug / naturally-hollow space (holds gas)
  | "wall" | "floor" | "ladder" | "wire"     // built structure
  | "generator" | "diffuser" | "pump" | "refinery" | "farm"; // built machines/farm

export interface Tile {
  kind: TileKind;
  oxygen: number;   // gas amount, 0..GAS_CAPACITY (open-to-gas tiles only)
  co2: number;      // gas amount, 0..GAS_CAPACITY
  designated: boolean;        // marked for digging (dig job pending)
  ghost: BuildKind | null;    // pending build order on this tile (blueprint)
  ghostPaid: boolean;         // material has been committed to the ghost
  machineId: number;          // -1, or index into World.machines / farms
  oreRich: number;            // ore tiles: units of ore this tile yields (>=1); else 0
}

// world-pixel top-left + zoom
export interface Camera { x: number; y: number; zoom: number; }

export interface World {
  w: number; h: number;               // WORLD_W, WORLD_H (tiles)
  tiles: Tile[];                       // flat, index = ty*w + tx
  machines: Machine[];                 // placed generators/diffusers/pumps
  farms: Farm[];                       // placed fungus farms
  refineries: { tx: number; ty: number }[];
  camera: Camera;
}

// ---- Power ----------------------------------------------------------------------
export type MachineKind = "generator" | "diffuser" | "pump";
export interface Machine {
  id: number; kind: MachineKind; tx: number; ty: number;
  network: number;      // power-network id this machine attaches to (-1 = unattached)
  powered: boolean;     // its network met demand this tick
  running: boolean;     // powered AND has what it needs (fuel for a generator)
  fuel: number;         // generator only: ore-units buffered (burns over time)
  ventPhase: number;    // exhaust/steam animation accumulator
}

export interface Farm { tx: number; ty: number; growth: number; ripe: boolean; }

// ---- Delvers --------------------------------------------------------------------
export type DelverAct =
  | "idle" | "walk" | "dig" | "build" | "haul" | "refine" | "harvest"
  | "eat" | "rest" | "flee";
export type Anim = "walk" | "dig" | "carry" | "idle"; // which produced sheet plays
export type CarryKind = "ore" | "material" | "food" | null;

export interface Delver {
  id: number; name: string;
  px: number; py: number;      // continuous world-pixel position (smooth movement)
  tx: number; ty: number;      // current tile (floor of px/py)
  facing: 1 | -1;              // sprite mirror
  health: number;              // 0..HEALTH_MAX; suffocation lowers, good air recovers
  stamina: number;             // 0..STAMINA_MAX; work drains, rest recovers
  hunger: number;              // 0..HUNGER_MAX; rises over time; MAX = starving
  act: DelverAct; anim: Anim; animT: number;
  job: Job | null;
  path: { tx: number; ty: number }[]; pathI: number;
  carrying: CarryKind;
  workTimer: number;           // seconds of progress into the current action
  dead: boolean;
}

// ---- Jobs -----------------------------------------------------------------------
export type JobKind = "dig" | "build" | "haul" | "refine" | "harvest";
export interface Job {
  id: number; kind: JobKind;
  tx: number; ty: number;          // the tile the work is at
  building?: BuildKind;            // build jobs
  haul?: { what: CarryKind; toTx: number; toTy: number }; // haul jobs
  claimedBy: number | null;        // delver id, or null
  priorityBoost: boolean;          // player raised this designation ("do this now")
}

export type BuildKind =
  | "wall" | "floor" | "ladder" | "wire"
  | "generator" | "diffuser" | "pump" | "refinery" | "farm";

// ---- Game shell -----------------------------------------------------------------
export type GameState = "title" | "howto" | "playing" | "paused" | "gameover";
export type Tool = "dig" | "build" | "cancel";

export type FxKind = "dust" | "steam" | "oxygen" | "co2";
// one-shot/loop world-px
export interface FxEvent { kind: "dust" | "steam"; x: number; y: number; }
export type Cue = "dig" | "build" | "alarm" | "machine";
export interface Milestone { text: string; life: number; } // non-blocking toast

export interface Clickable {
  x: number; y: number; w: number; h: number; action: string;
  payload?: string; disabled?: boolean;
}
```

`priorityBoost` + the per-kind priority order (`jobs.ts`, §4) realize the controls-spec
"dig this now" / "builds before digs" requirement.

---

## 4. `src/` modules

Every file, its responsibility, and its key exports. The dependency order is roughly
`constants → types → rng → world → worldgen/gas/power/pathfind → jobs/economy/delvers →
sim → assets/audio/particles → render/input/menus/mode → main`.

| File | Responsibility | Key exports |
| --- | --- | --- |
| `constants.ts` | Stage geometry, palette, and **every tuning number** (§5); `TileKind`/`BuildKind` and tile-property predicates. | `STAGE_W/H`, `TOP_HUD_H`, `BOTTOM_HUD_Y`, `TILE`, `WORLD_W/H`, `FIXED_STEP`, `SPEEDS`, `CYCLE_SECONDS`, `COL`, `FONT`, all `GAS_*`/`POWER_*`/`DELVER_*`/`ECON_*` constants, `BUILD_COST`, `DIG_TIME`, `isSolid()`, `isOpenToGas()`, `blocksGas()`, `isWalkSurface()`, `canDig()`, `isBuilt()` |
| `types.ts` | The core data model (§3). | all interfaces/types above |
| `rng.ts` | mulberry32 PRNG (worldgen + jitter). Copy valence `rng.ts` verbatim. | `Rng` |
| `world.ts` | The grid container + accessors + tile-property queries + the **camera** (clamp to world bounds, tile↔pixel↔screen transforms, `centerOn`). No sim logic. | `idx()`, `tileAt()`, `inBounds()`, `neighbors4()`, `clampCamera()`, `worldToScreen()`, `screenToTile()`, `centerCameraOn()` |
| `worldgen.ts` | Build the starting `World` from the mode: bedrock border (cols 0/`w-1`, bottom row, top 2 cap rows), a dirt/rock body, **ore seams** as contiguous runs, a carved **opening cavern** whose open tiles are seeded with the oxygen pocket, and the 3 delver spawn tiles. Deterministic from a seed. | `generateWorld(mode, seed)`, `CAVERN` params |
| `gas.ts` | The **signature** system. `stepGas(world, dt)`: 4-connected diffusion of oxygen and CO2 independently (move `DIFFUSE_FRACTION` of each edge difference, capped at `GAS_CAPACITY`, conserving total), plus gentle **buoyancy** (bias vertical transfer: CO2 down, oxygen up by `BUOYANCY`). `breathe(delver, tile, dt)`: consume oxygen / exhale CO2. `breathableAt(tile)`: `oxygen >= O2_BREATHE_MIN && co2 <= CO2_TOXIC_MAX`. Machine emission/pumping is applied here via `emitOxygen()`/`pumpGas()` called by `power.ts`/`sim.ts`. | `stepGas`, `breathe`, `breathableAt`, `emitOxygen`, `pumpGas`, `avgOxygen`, `lowestOxygen`, `avgCo2` |
| `power.ts` | `rebuildNetworks(world)`: flood-fill maximal edge-connected **wire** components into networks, attach each generator/machine adjacent-to-or-on a wire; sum **supply** (running generators) vs **demand** (diffusers/pumps); set each machine `powered`/`running`; flag **brownout** (demand > supply → every machine on that network stops). `stepPower(world, dt)`: burn generator fuel, apply diffuser oxygen output and pump transfer for running machines. | `rebuildNetworks`, `stepPower`, `NetworkStat[]` (supply/demand/brownout for the HUD) |
| `pathfind.ts` | BFS/A* over the **walkable + climbable** graph: a node is a floor/ladder tile or an open tile standing on a solid/floor/wall below; edges are horizontal steps between adjacent stand tiles, up/down through a ladder, single-tile terrain step-ups, and falls through open space. `findPath(world, from, to)`, and `reachableAdjacent(world, tile, from)` (the stand tile a delver digs a marked tile from — delvers dig **inward from open space**). | `findPath`, `reachableAdjacent`, `nearestBreathable(world, from)`, `isWalkable(world, tx, ty)` |
| `jobs.ts` | The **priority queue**: enqueue/cancel/claim/release/dedupe jobs; the per-kind `PRIORITY` order (need-driven states preempt in `delvers.ts`) and the "builds before digs" toggle + `priorityBoost`. | `JobBoard` (add/cancel/claimBest/release), `PRIORITY`, `orderJobs()` |
| `economy.ts` | Resource stocks (`ore`/`material`/`food`), the ore→material **refine** rule, build-order **placement legality** + material cost + construction completion (ghost → finished tile, updates gas/power/walk graph), **farm** growth + harvest, generator refuel accounting. | `Stocks`, `canPlace()`, `placeGhost()`, `completeBuild()`, `refineStep()`, `growFarms()`, `harvest()`, `BUILD_COST` re-export |
| `sim.ts` | The **`Game` class** — the spine. Owns `world`, `delvers`, `stocks`, `jobs`, gas/power state, `state`/`speed`/`paused`, `cycle`/`cycleClock`, `score`, selection + active `tool`/`buildKind`, and the drained event queues. `fixedStep(dt)` order: **gas → power → economy (refine/grow) → delvers (needs, jobs, movement, actions) → suffocation/starvation → cycle clock → loss check → milestones**. Tools: `markDig`/`dragDig`, `placeBuild`, `cancelAt`, `cyclePriority`. Speed/pause, `startColony(mode)`, `restart()`, dev hooks for the proof script. | `Game`, `Game.fixedStep`, tool + control methods, `fxQueue`/`sndQueue`/`milestones` |
| `assets.ts` | Load the **produced** files via Vite import globs (page-relative under any base). Sprites (`../assets/**/*.png`), fx systems (`../assets/fx/*.system.json`), audio (`../assets/audio/*.wav`). Copies valence's loader shape: `sprite(name)`, delver frame arrays, `fx`, `audioUrl`. | `loadAssets()`, `Assets` (`sprite`, `delver: Record<Anim, HTMLImageElement[]>`, `fx`, `audioUrl`) |
| `audio.ts` | Web Audio playback — copy valence `audio.ts` structure: resume on first gesture, decode clips, `play(cue)` for dig/build/alarm, loop the **machine hum** and the **music bed**, `toggleMute()`. No autostart before a gesture. | `Audio` |
| `particles.ts` | Plays the produced particle systems through `@test-cabinet/particle-runtime`'s canvas binding. Two parts: (a) **`GasOverlay`** — tiles the `oxygen_haze` and `co2_plume` systems over the visible open tiles, spawning/scaling each by that tile's concentration (dense haze in breathable rooms, thick plume in low CO2 tunnels), driven from `world` each frame; (b) **`Bursts`** — one-shot `dig_dust` at a mined tile and looping `machine_steam` at each running machine's vent (mirror valence `particles.ts`). | `GasOverlay` (update/draw from world+camera), `Bursts` (spawn/update/draw) |
| `render.ts` | **All drawing**, in the palette: the camera'd tile world (produced tile sprites, flush tiling), dig designations / build ghosts / hovered-tile cursor / priority marks, machines (produced sprites + glow when running), the gas overlay composite, delvers from the **produced sheets** (pick the `Anim` for the `DelverAct`, advance frames on a timer, mirror by `facing`), the full **HUD dashboard** (top vitals strip + bottom roster & palette, §6), milestone toasts, and every menu/state screen. Returns the frame's `Clickable[]`. | `render()`, `setRenderTime`, `setMenuIndex`, `setMuted` |
| `input.ts` | Mouse + keyboard capture; pointer→logical mapping via the live fit transform; drag state for the **dig rectangle** and **camera pan**; **wheel zoom**; optional **edge-scroll**. Copy valence `input.ts` and add drag-rect + wheel. | `Input` (`attach`, `clicks`, `keys`, `drag`, `wheel`, `pointerLogical`, `setViewport`, `drain`) |
| `menus.ts` | The item list per menu state (title/howto/paused/gameover), single source for renderer + keyboard nav. | `menuItems(state, game)`, `MenuItem` |
| `mode.ts` | The `NEW COLONY` start config (§1) — the one file the start is isolated to. | `MODE`, `ColonyMode` |
| `main.ts` | Bootstrap: load assets, construct `Audio`/`GasOverlay`/`Bursts`/`Game`/`Input`, `resize()` letterbox, the **fixed-step loop** (`acc += dt*speed; while(acc>=FIXED_STEP) game.fixedStep()`), input routing, drain `sndQueue`→audio and `fxQueue`→bursts, expose `window.__hollowdeep` dev API for the proof script. | (entry) |
| `vite-env.d.ts` | `/// <reference types="vite/client" />`. | — |

---

## 5. Constants & tuning table (`src/constants.ts`)

Every number the specs leave to the implementer, pinned in one place and validated by
the `sim/` harness (§7). Palette is **exactly** `specs/overview.md`.

### Stage / world / time

| Const | Value | Note |
| --- | --- | --- |
| `STAGE_W`,`STAGE_H` | 1280, 720 | fixed 16:9 stage |
| `TOP_HUD_H` | 64 | top vitals strip `y∈[0,64]` |
| `BOTTOM_HUD_Y` | 656 | bottom strip `y∈[656,720]`; colony view `y∈[64,656]` |
| `TILE` | 24 | logical px per tile |
| `WORLD_W`,`WORLD_H` | 64, 44 | tiles → world px 1536×1056 (larger than the view → camera) |
| bedrock border | cols 0 & 63, row 43, rows 0–1 cap | indestructible seal |
| `FIXED_STEP` | 1/20 s | 20 Hz fixed tick, render interpolates delver `px/py` |
| `SPEEDS` | [1, 2, 3] | speed multipliers; pause = ticks halt |
| `CYCLE_SECONDS` | 30 | sim-seconds per **cycle** (the colony "day") |
| camera `zoom` | default 1.4, min 1.0, max 2.2 | wheel zoom; whole stage stays fitted |

### Palette (`COL`) — from `specs/overview.md`

`void #12100c`, `dirt #4a3524`, `oreVein #d9a441`, `rock #2b2620`, `open #191410`,
`built #566073`, `ladderWire #c9862f`, `oxygen #47e0c8`, `co2 #b6c24a`, `power #ffcb52`,
`food #7cd45a`, `suit #e08a3c`, `alert #ff5a52`, `panel #1b1712`, `text #ece6db`,
`text2 #a89e8d`, `text3 #6b6355`. `FONT` = a system monospace stack (no web font).

### Gas (`specs/gas.md`)

| Const | Value | Note |
| --- | --- | --- |
| `GAS_CAPACITY` | 100 | per-tile soft cap, each gas |
| `START_OXYGEN` | 82 | oxygen in each cavern open tile at start |
| `START_CO2` | 3 | trace CO2 at start |
| `DIFFUSE_FRACTION` | 0.12 | fraction of an edge difference moved per tick (stable, no overshoot) |
| `BUOYANCY` | 0.05 | extra vertical bias: CO2 down, oxygen up (gentle) |
| `O2_BREATHE_MIN` | 22 | below this oxygen → cannot breathe |
| `CO2_TOXIC_MAX` | 55 | above this CO2 → cannot breathe |
| `DELVER_O2_RATE` | 1.4 /s | oxygen a delver consumes from its tile |
| `DELVER_CO2_RATE` | 1.1 /s | CO2 a delver exhales into its tile |
| `DIFFUSER_O2_OUT` | 16 /s | oxygen a running diffuser adds (its tile + open 4-neighbors, split) |
| `PUMP_RATE` | 22 /s | gas a running pump moves intake→output tile |

### Power (`specs/power.md`)

| Const | Value | Note |
| --- | --- | --- |
| `GEN_SUPPLY` | 20 W | a fueled, running generator's output |
| `GEN_FUEL_BURN` | 1 ore / 12 s | generator burns hauled **ore** as fuel |
| `GEN_FUEL_MAX` | 6 | ore-units the generator buffers |
| `DIFFUSER_DEMAND` | 12 W | |
| `PUMP_DEMAND` | 6 W | one generator (20W) runs a diffuser+pump; a 2nd machine browns out → build a 2nd generator |

The **refinery is operated, not powered** (a delver runs it — this realizes the
"operate a machine" job) so first refining works before power is up; the sequence is
`dig ore → refine (operated) → build generator + wire + diffuser → power → oxygen`.
State this in the README.

### Delvers (`specs/delvers.md`)

| Const | Value | Note |
| --- | --- | --- |
| `DELVER_COUNT` | 3 | starting crew |
| `HEALTH_MAX` | 100 | |
| `SUFFOCATE_DMG` | 9 /s | health lost while unbreathable |
| `O2_RECOVER` | 6 /s | health regained in breathable air |
| `STAMINA_MAX` | 100 | |
| `WORK_DRAIN` | 3.5 /s | stamina lost while working |
| `REST_RECOVER` | 14 /s | stamina regained while resting |
| `REST_BELOW`,`REST_UNTIL` | 15, 75 | rest when stamina < 15, until 75 |
| `HUNGER_MAX` | 100 | MAX = starving |
| `HUNGER_RATE` | 0.85 /s | ~65 in ≈2.5 cycles, MAX in ≈4 cycles |
| `EAT_ABOVE` | 65 | eat when hunger > 65 and food in stock (consumes 1 food, resets hunger) |
| `STARVE_DMG` | 4 /s | health lost while hunger = MAX and no food |
| `WALK_SPEED` | 2.4 tiles/s | |
| `CLIMB_SPEED` | 1.8 tiles/s | vertical on ladders |

### Economy (`specs/economy.md`) & digging (`specs/world.md`)

| Const | Value | Note |
| --- | --- | --- |
| start `stocks` | material 30, ore 0, food 8 | from `MODE` |
| `DIG_TIME` | dirt 1.5 s, ore 3.0 s, rock 6.0 s | bedrock: cannot dig |
| dig yield | dirt 0, ore 1 ore, rock 0 | ore added to stock (hauled model optional; state in README) |
| `REFINE_RATIO` | 2 ore → 1 material | |
| `REFINE_TIME` | 4 s | operated refinery job |
| `BUILD_TIME` | 2.5 s | per placed order |
| `BUILD_COST` (material) | wall 2, floor 1, ladder 1, wire 1, generator 8, diffuser 10, pump 8, refinery 6, farm 5 | ghost waits if unaffordable; no partial refund (state in README) |
| `FARM_GROW_TIME` | 22 s | time to ripen |
| `HARVEST_YIELD` | 3 food | per harvest; plot resets to grow again |

Numbers are tuned so a **competent** player just gets life support up in time and a
**careless** one loses (§7 goal checks).

---

## 6. Render / HUD layout and the state machine

**Colony view** = `y∈[64,656]`, full width (`1280×592`). A **camera** onto the larger
world: `world.camera` is a world-pixel top-left + `zoom`; `render` draws only the
integer tile region visible, tiles at `TILE*zoom` on screen, clamped to world bounds
(the sealed border sits flush at an edge). On load the camera is `centerCameraOn` the
opening cavern. Tiles draw from the produced sprites (§ASSETS), flush; **open** tiles
draw the interior-backing sprite so dug space reads as a lit interior, not a hole.
Delvers draw from the produced sheets. The **gas overlay** (`GasOverlay`) composites the
produced oxygen-haze / CO2-plume particle systems over the open tiles, scaled by
concentration, additively — legible over the tiles beneath.

**Top HUD strip `y∈[0,64]`** (vitals, drawn in code; small icons are produced sprites):
left→right — **OXYGEN** (icon + average% and lowest% of open-tile oxygen, tinted, goes
red on alert) · **CO2** (icon + average) · **POWER** (per-network supply vs demand bar +
a bold **BROWNOUT** flag) · **STOCKS** (ore / material / food icons + counts) · **CYCLE**
(clock + cycle number) · **SPEED** (1×/2×/3× / ❚❚) · a prominent **ALERT** when oxygen is
critical or the colony is starving.

**Bottom HUD strip `y∈[656,720]`**: **left** — the **delver roster**, one card per living
delver: name + three mini-bars (health/oxygen, stamina, hunger) + its current action
word. **right** — the **build palette / tool bar**: the **DIG** tool, then a building
button per `BuildKind` (wall, floor, ladder, wire, generator, diffuser, pump, refinery,
farm) using its produced sprite as the glyph, then the **CANCEL** tool and a **PRIORITY**
toggle ("builds before digs"). Exactly one tool is active; its cursor/preview makes it
obvious. Illegal build placements are refused with a red cursor.

**State machine** (`GameState`): `title` → (`NEW COLONY`) → `playing`; `title` ↔ `howto`;
`playing` → `Esc` → `paused` (Resume / Restart / Quit to menu, field frozen behind);
`playing` → last delver dies → `gameover` (cycles survived + secondary tally, RESTART /
MENU). `Space` = in-place pause (ticks halt, board interactive); `1/2/3` or a HUD button
= speed; `M` = mute. Menus operable by pointer and `↑/↓`+`Enter`. Milestones (first
diffuser online, first harvest, every 5 cycles) surface as brief non-blocking toasts.

---

## 7. Balance harness (`sim/`, dev-only, excluded from the build)

Mirror valence: a headless, deterministic harness that drives the exact `Game` from
`../src` with no DOM, so a colony strategy maps to one reproducible result
(cycles-survived). `tsconfig` `include: ["src"]` keeps it out of the bundle.

- `harness.ts` — `newColony(mode)`, `runScenario(strategy, maxCycles)`, and
  placement/dig/queue helpers that drive `Game` only through its input-free control API.
- `strategies.ts` — the controller battery.
- `run.ts` — the report + PASS/FAIL goal checks.
- `README.md` — how to run (`npx tsx sim/run.ts`) and the tuning loop (edit
  `src/constants.ts` → re-run → re-sync specs).

**Goal checks** (what "balanced" means for the survival pressure):

1. **do-nothing loses** — no oxygen generation → the pocket sours, crew **suffocates**
   within a bounded number of cycles.
2. **air-only, no farm loses** — oxygen held but no food → crew **starves**.
3. **farm-only, no air loses** — fed but the pocket sours → **suffocates**.
4. **no-power diffuser loses** — a diffuser placed but never wired/generated stays dead
   (brownout / unattached), so air still runs out.
5. **competent (dig ore → refine → generator + wire + diffuser + farm, manage CO2) survives**
   many cycles — the intended win path.

---

## 8. Proof plan (`specs/proof.md` → `proof/`, captured by `scripts/proof.mjs`)

Playwright serves the **built** `dist/` under a non-root sub-path (`/runs/demo/build`,
proving base-path safety), drives the game via `window.__hollowdeep` dev hooks, asserts
no console/request errors, and writes each artifact to the exact path. Dev API on
`window.__hollowdeep`: `{ game, audio, startColony(), digRect(x0,y0,x1,y1),
place(kind,tx,ty), grant({ore,material,food}), fillCavern(o2), sealAndSpend(), setSpeed(n),
tick(n) }`.

| Path | What to drive & capture |
| --- | --- |
| `proof/title.png` | Load; move pointer off the menu; screenshot the **title** with both items visible (`NEW COLONY`, `HOW TO PLAY`). Click once so audio decodes; assert no error. |
| `proof/gameplay.png` | `startColony()`; `grant` a little material; `digRect` a small room + a downward tunnel; `place` a generator + wires + a **diffuser** + a refinery + a **farm**; `grant` fuel ore; run `tick`s until the diffuser is **running** (steam venting), delvers are mid-task (produced sheets), and the gas overlay shows **oxygen** high in the room and **CO2** pooled low in the tunnel. Screenshot with the **full HUD** (top vitals + bottom roster & palette). |
| `proof/game-over.png` | `startColony()`; `sealAndSpend()` (no oxygen generation, delvers keep breathing) + `setSpeed(3)`; run `tick`s until `game.state === "gameover"`; screenshot the **colony-lost** screen showing **cycles survived**. |
| `proof/systems.webm` | ~6–8 s at 1×: queue a **dig**, a delver walks to it and **mines** it (**dig dust** puffs), the tile **opens** and yields **ore**; a delver **refines** ore→material and **builds** a placed order; a powered **diffuser** runs (steam) and the **gas overlay visibly responds** as the space opens / air is added. |
| `proof/survival.webm` | ~7 s at 2×, audio unmuted: the air **trending down** / a room souring with the **low-oxygen alert** lit, and a delver in danger **fleeing toward better air** (or the colony reaching its loss state). |

---

## 9. Asset production & the environment constraint

`scripts/gen-assets.sh` produces **every** committed asset with the six on-`PATH` tools
(`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `music`) — see [`ASSETS.md`](ASSETS.md)
for the full manifest (exact output paths, tool, canvas/frame count, palette, purpose).
**In this environment the baked `sfx-sample` pack and the `music` instrument bank are
empty**, so all SFX are authored with **`sfx-synth`** and the music bed with **`music`
using synth-waveform tracks** (`define-track` with a waveform name, not a bank
instrument) — exactly as valence did. The build never invokes the tools; `npm run build`
bundles the committed files.
