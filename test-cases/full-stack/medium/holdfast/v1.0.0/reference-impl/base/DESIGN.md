# Holdfast — Reference implementation DESIGN

This is the implementation contract for the authored **reference build** of the
`holdfast` full-stack case, `base` variant (the standard frontier start). It is the
*correct*, ground-truth build the case is judged against — the analogue of the committed
`valence` reference implementation, and it mirrors that build's shape: plain **TypeScript**
rendering to a single **HTML5 canvas**, bundled with **Vite** (`base: "./"`), no backend,
no network at runtime, all assets **produced** during the build with the six on-`PATH`
tools and loaded via `import.meta.glob`. Particle effects play through
`@test-cabinet/particle-runtime`'s `/canvas` binding; audio through Web Audio.

Read this file with `ASSETS.md` (the produced-asset manifest) beside it. Every number and
color here is taken from the seeded specs (`specs/overview.md`, `world.md`, `settlers.md`,
`economy.md`, `combat.md`, `time.md`, `controls.md`, `flow.md`, `mode.md`, `assets.md`,
`proof.md`); where a spec pins a value, this document uses exactly that value, and where a
spec says "you tune it," this document fixes the tuning the reference ships. **All tuning
numbers live in `src/constants.ts`** so the simulation reads exactly as written here.

---

## 1. Game summary, win/lose, and the base start

**Holdfast** is a top-down colony survival-management sim. The player looks down on a
single bounded frontier map (soil, grass, rock, tree stands, ore veins) and directs a small
band of autonomous **settlers** — never controlling one directly — by **designating** work
(chop/mine), **placing build orders** (walls, doors, floors, beds, a stove, farm plots,
turrets), and **setting a work-priority grid**. Settlers pull jobs from a priority queue,
pathfind to them, and carry them out while their own **needs** (hunger, rest) and **mood**
drift. A **day/night cycle** turns; an escalating **threat director** sends **ranged raids**
that favor the dark. The colony must build defenses and a food chain faster than the raids
grow and the larder empties.

- **No win screen.** Holdfast is pure survival (`specs/flow.md`); the only measure is how
  long the colony endures.
- **Loss** is the sole end state: when the **last settler dies** — killed in a raid, bled
  out while downed, or starved — the colony is **lost**. The colony-lost screen shows
  **days survived** (the primary score) plus a secondary tally (raids repelled, raiders
  killed, structures built, peak population) and offers **RESTART** / **MENU**.
- **The base start** (`specs/mode-base.md`, main-menu entry `NEW COLONY`): **3 settlers**
  at a central **landing site** on open ground, a **modest stock of wood and a few meals**
  (`WOOD 120`, `ORE 0`, `CROPS 0`, `MEALS 8`), with tree stands and ore veins within reach.
  Raids follow the standard escalating curve; **raiders shoot from the open and take cover,
  come for the settlers and turrets, but do NOT break the colony's walls** — a well-built,
  fire-covered wall line holds them off. Everything else is the common specs, unmodified.

---

## 2. Core data model (`src/types.ts` + tile/enum types in `src/constants.ts`)

These interfaces are the contract every later module depends on. They are declared up
front; `sim.ts`, `jobs.ts`, `combat.ts`, `world.ts`, `pathfind.ts`, `render.ts`, and
`hud.ts` all read and write them.

### 2.1 World and tiles

```ts
// constants.ts — enums shared everywhere
// rock is impassable scenery + border
export type TerrainKind = "soil" | "grass" | "rock";
export type NodeKind = "tree" | "ore";
export type StructureKind =
  | "wall" | "door" | "floor" | "bed" | "stove" | "farm" | "turret";
// work-priority columns
export type WorkType = "gather" | "haul" | "build" | "cook" | "farm" | "fight";
```

```ts
// types.ts
export interface Tile {
  x: number; y: number;               // tile coords (0..59, 0..43)
  terrain: TerrainKind;
  // one node may sit on ground; blocks the tile until cleared
  node: ResourceNode | null;
  structure: Structure | null;        // one built structure; blocks per its kind
  designated: null | "chop" | "mine"; // active designation overlay on a node
  // Derived, recomputed by world.ts when the tile changes:
  walkable: boolean;                   // terrain walkable AND no blocking node/structure
  blocksSight: boolean;                // wall/door/rock block line of sight and fire
  givesCover: boolean;                 // wall/door: a shooter/target beside it is in cover
}

export interface ResourceNode {
  kind: NodeKind;
  // work remaining (seconds of work * skill), counts down
  hp: number;
  maxHp: number;
  claimedBy: number | null;            // settler id currently working it (one worker only)
  workAnim: number;                    // seconds, drives the dust puff cadence
}

export interface Structure {
  kind: StructureKind;
  tx: number; ty: number;
  // turret/wall integrity (raiders damage turrets in base)
  hp: number; maxHp: number;
  built: boolean;                      // false while a ghost/blueprint awaiting construction
  progress: number;                    // 0..1 construction progress
  costPaid: boolean;                   // material deducted at placement (see economy)
  // stove / farm / turret working state:
  // stove cooking, turret has a target (drives on/off sprite)
  active: boolean;
  cropStage: 0 | 1 | 2;                // farm: 0 empty/sown, 1 growing, 2 ripe
  growth: number;                      // farm: 0..1 toward ripe (advances in daylight)
  cooldown: number;                    // turret: seconds to next shot
  aim: number;                         // turret: heading toward current target (sprite rotation)
}
```

### 2.2 Settlers, raiders, jobs

```ts
// constants.ts
export type Skill = "chop" | "mine" | "build" | "cook" | "shoot" | "farm";
export type JobKind =
  | "chop" | "mine" | "haul" | "build" | "cook" | "sow" | "harvest"
  | "fight" | "tend" | "eat" | "sleep";
export type Activity =                 // what the roster shows a settler is doing
  | "idle" | "walk" | "chop" | "mine" | "haul" | "build" | "cook"
  | "farm" | "fight" | "tend" | "eat" | "sleep" | "flee" | "downed";
```

```ts
// types.ts
export interface Needs {
  hunger: number;   // 0 full .. 1 starving
  rest: number;     // 1 rested .. 0 exhausted
  mood: number;     // 0..1, derived each tick from needs + events
}

export interface Settler {
  id: number;
  name: string;
  x: number; y: number;               // pixel position (continuous, interpolated on render)
  facing: number;                     // heading radians, for sprite mirror/rotate
  health: number; maxHealth: number;  // 100
  needs: Needs;
  skills: Record<Skill, number>;      // 0..10; work-speed / hit multiplier via skillMul()
  job: Job | null;                    // the claimed job (null = seeking)
  path: PathNode[]; pathIdx: number;  // current route (tile centers)
  activity: Activity;
  animT: number;                      // seconds into the current cycle (frame = floor(animT*fps))
  carrying: null | { res: ResourceKind; amount: number }; // a haul in hand
  downed: boolean; bleed: number;     // downed + seconds of bleed-out remaining
  fireCooldown: number;               // combat cadence
  eventMood: number;                  // transient mood hit from grim events, decays
  moodBreak: boolean;                 // mood too low → refuses low-priority work / idles
  dead: boolean;
}

export interface Raider {
  id: number;
  x: number; y: number; facing: number;
  health: number; maxHealth: number;
  path: PathNode[]; pathIdx: number;
  targetId: number | null;            // settler/turret it is engaging
  fireCooldown: number;
  fleeing: boolean;                   // broke and heading off-map
  animT: number;
  dead: boolean;
}

export interface Job {
  kind: JobKind;
  tx: number; ty: number;             // work tile (adjacent-reachable tile is the walk target)
  targetId?: number;                  // settler to tend, structure to build, node id, etc.
  structure?: Structure;              // build/cook/farm target
  claimedBy: number | null;
  work: number;                       // seconds of work accumulated
  workNeeded: number;                 // seconds required at 1.0x skill
}

export interface PathNode { tx: number; ty: number; }
```

### 2.3 Resources, projectiles-as-tracers, effects, game state

```ts
// constants.ts
export type ResourceKind = "wood" | "ore" | "crops" | "meals";
```

```ts
// types.ts
export interface Stock { wood: number; ore: number; crops: number; meals: number; }

// A dropped resource pile on the ground (a gather result awaiting a haul).
export interface Drop {
  id: number; tx: number; ty: number; res: ResourceKind; amount: number;
}

// Combat is resolved on the tick; a shot is drawn as a brief tracer + muzzle/impact fx,
// not a slow homing projectile (see §6). This records the tracer to draw for ~120 ms.
export interface Tracer {
  x0: number; y0: number; x1: number; y1: number; life: number; hostile: boolean;
}

export type GameState = "title" | "howto" | "playing" | "paused" | "gameover";
export type Phase = "day" | "dusk" | "night" | "dawn";     // time-of-day phase (§7)

export type FxKind = "muzzle" | "blood" | "impact" | "fire" | "explosion" | "dust";
export interface FxEvent { kind: FxKind; x: number; y: number; }
export type Cue = "gunshot" | "hit" | "build" | "alarm";   // ambient + music handled apart

// A milestone / event toast (non-blocking notification, §8).
export interface Toast { text: string; life: number; }

export interface Clickable {
  x: number; y: number; w: number; h: number; action: string;
  payload?: string; disabled?: boolean;
}
```

### 2.4 Tool / build state and the mode config

```ts
// constants.ts
export type Tool = "none" | "designate" | "cancel" | "build";
export interface StartConfig {          // mode.ts exports MODE: StartConfig
  crew: number;                         // 3
  stock: Stock;                         // { wood:120, ore:0, crops:0, meals:8 }
  // deterministic world gen seed for the reference map
  mapSeed: number;
}
```

The live `Game` (in `sim.ts`) owns: `tiles: Tile[]` (60×44 row-major), `settlers`,
`raiders`, `drops`, `tracers`, `structures` index, `jobs: Job[]` (the open queue),
`stock: Stock`, `state`, `phase`, `time` (day clock), `day`, `speed`, `paused`, camera
(`camX, camY`), `tool`/`buildKind`/`selectedSettlerId`, the threat director state, the
`fxQueue: FxEvent[]` and `sndQueue: Cue[]` drained by `main.ts`, and the score tally.

---

## 3. Constants & tuning table (`src/constants.ts`)

Every value below is fixed in `constants.ts`. Grouped as the file is.

### 3.1 Stage, grid, camera

| Const | Value | Source |
| --- | --- | --- |
| `STAGE_W × STAGE_H` | `1280 × 720` | overview.md |
| `TOP_H` (top HUD) | `64` (`y∈[0,64]`) | overview.md |
| `BOT_Y` (bottom HUD top) | `656` (`y∈[656,720]`) | overview.md |
| `VIEW` (colony view) | `x∈[0,1280]`, `y∈[64,656]` | overview.md |
| `TILE` | `24` px | world.md |
| `COLS × ROWS` | `60 × 44` (world `1440 × 1056` px) | world.md |
| `BORDER` | outer 1-tile ring = `rock` (sealed) | world.md |
| `CAM_PAN` | `520` px/s (keyboard/edge pan) | controls.md |
| `ZOOM_LEVELS` | `[0.85, 1.0, 1.3]` (wheel), default `1.0` | controls.md |
| `EDGE_SCROLL` | `24` px margin near view edges | controls.md |

Camera is clamped so the world border sits flush at an edge; on load it centers on the
landing site. Zoom keeps both HUD strips fixed and the full stage fitted.

### 3.2 Simulation clock and time-of-day

| Const | Value | Notes |
| --- | --- | --- |
| `FIXED_STEP` | `0.1` s (**10 ticks/s**, "a handful") | fixed tick, render interpolates (controls.md) |
| `SPEEDS` | `[1, 2, 3]` (keys `1/2/3`, HUD buttons) | scale ticks/real-sec; `Space` pauses ticks |
| `DAY_SECONDS` | `90` s at 1× (`900` ticks) | one full day/night cycle (time.md) |
| Phase split (`time` 0..1) | `dawn [0,0.10) · day [0.10,0.50) · dusk [0.50,0.60) · night [0.60,1.0)` | ~60% lit, ~40% dark |
| Start of run | Day 1, `time = 0.05` (dawn) | opening scramble in daylight |
| `NIGHT_DARKEN` | overlay alpha ramps `0 → 0.55` toward mid-night; never black-out | keep legible (time.md, overview.md) |

### 3.3 Needs and mood (per real second at 1×)

| Const | Value | Meaning |
| --- | --- | --- |
| `HUNGER_RISE` | `1/135` /s (≈1.5 days to starving) | hunger climbs while awake |
| `EAT_THRESHOLD` | `0.70` | at/above, a settler seeks a meal (if any in stock) |
| `EAT_TIME` | `2.0` s | consumes **1 meal**, resets hunger to 0 |
| `STARVE_HP` | `6` hp/s once `hunger ≥ 1.0` | starvation drains health → death |
| `REST_DRAIN_DAY` | `1/150` /s | rest falls while working by day |
| `REST_NIGHT_MUL` | `×1.7` at night | drains faster after dark (time.md) |
| `SLEEP_REST_BED` | `+1/40` /s | recover in a bed |
| `SLEEP_REST_GROUND` | `+1/70` /s | recover on the ground (slower, mood hit) |
| `SLEEP_TRIGGER` | rest `≤0.28` any time; `≤0.55` at night (preference) | goes to sleep |
| `SLEEP_WAKE` | rest `≥0.95` | wakes |
| Mood base | `0.70` start; recomputed each tick | 0..1 |
| Mood penalties | hungry −`0.25`, exhausted −`0.25`, slept-on-ground −`0.08`, in-combat −`0.15`, ally-downed −`0.10`, ally-died −`0.20` (decays) | settlers.md |
| Mood comforts | has own bed +`0.08`, fed & rested +`0.10`, on-floor room +`0.05` | settlers.md |
| `MOOD_SLOW` | mood `<0.30` → work speed ×`0.5`, refuses priority-1 (lowest) work | degraded behavior |
| `MOOD_BREAK` | mood `<0.15` → idles ("wandering, upset") until it recovers | extreme |

### 3.4 Skills

`skillMul(level) = 0.5 + 0.09 * level` (lvl 0 → 0.5×, lvl 5 → 0.95×, lvl 10 → 1.4×). Shooting
skill also adds `+0.03 * level` to base hit chance. Skills **improve slowly with use**
(`+0.02` level per completed job of that kind, capped at 10) — stated in README. The three
starting settlers have distinct standout skills so they are **not interchangeable**:

| Settler | Standout skills (lvl) | Weak at |
| --- | --- | --- |
| **Mira** | mine 6, build 6 | cook 1 |
| **Cole** | chop 6, shoot 6 | farm 1 |
| **Sela** | cook 6, farm 6 | shoot 1 |

(All unlisted skills start at level 3.)

### 3.5 Work times (seconds at 1.0× skill) & yields

| Job | Time | Yield / effect |
| --- | --- | --- |
| `chop` a tree | `2.0` | clears tile → **+8 wood** dropped at node |
| `mine` an ore | `5.0` | clears tile → **+6 ore** dropped at node (slower than chop, world.md) |
| `haul` a drop | walk + `0.4` pickup | carries a drop to the **stockpile** → stock += amount |
| `build` | per-structure (below) | ghost → finished structure, **dust** puff |
| `cook` at stove | `4.0` | **4 crops → 3 meals** (stock) |
| `sow` a farm | `1.0` | plot → growing (stage 1) |
| `harvest` a ripe farm | `2.0` | **+6 crops** dropped at plot; plot resets to sown |
| `tend` a downed ally | walk + `2.0` | stabilizes (stops bleed; ally recovers, §6) |

### 3.6 Structures — cost, build time, blocking (README-stated)

| Structure | Cost | Build s | Blocks move | Cover | Sight | HP | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `wall` | 5 wood | 2.0 | yes | yes | blocks | 120 | raiders don't attack in base |
| `door` | 8 wood | 2.0 | no (settlers pass) | yes | blocks | 80 | raiders avoid; closes the line |
| `floor` | 2 wood | 1.0 | no | no | clear | — | +move speed ×1.15, small mood |
| `bed` | 15 wood | 3.0 | no | no | clear | — | faster rest, +mood; one owner |
| `stove` | 25 wood, 5 ore | 5.0 | yes | no | clear | — | cook station |
| `farm` | 6 wood | 2.0 | no | no | clear | — | best on grass (grows faster) |
| `turret` | 35 wood, 25 ore | 6.0 | yes | yes | blocks | 140 | auto ranged defense (§6) |

Material is deducted **at placement** (`costPaid`); if the colony lacks it, placement is
**refused** with a clear message (README-stated). Cancelling a ghost refunds nothing spent
(none is, since it's deducted at placement — so cancel **refunds the full cost**;
README-stated). Illegal placements (off-ground, on rock/node, a door not in a wall line, a
turret with no field of fire) are refused with a red ghost.

### 3.7 Combat

| Const | Value |
| --- | --- |
| Settler `HEALTH` | 100; walk speed `42` px/s (×skillMul(none)? no — ×move mods) |
| Settler shot | range `120`, fireRate `0.9`/s, dmg `12`, baseHit `0.62` |
| Turret shot | range `168`, fireRate `1.4`/s, dmg `10`, hit `0.70`, HP `140` |
| Raider | HP `40 + 3·day`; range `110`, fireRate `0.8`/s, dmg `10`, hit `0.55`, speed `34` px/s |
| `COVER_MULT` | `0.4` (incoming hit chance ×0.4 when target is in cover) |
| Range falloff | `1.0` within 50% range → `0.6` at max range |
| Hit clamp | `[0.05, 0.95]` |
| Downed | health ≤0 → downed; `BLEED = 45` s; tend stabilizes, ally recovers to 25 hp then rejoins |
| Raid break | when ≥`60%` of a wave is dead, survivors flee to nearest edge and despawn |

**Cover** rule (tile granularity): a target is in cover vs a shooter if the tile one step
from the target **toward** the shooter carries a cover-giving structure (wall/door). **Line
of sight**: a supercover tile walk from shooter to target; any `blocksSight` tile
(wall/door/rock) between them blocks the shot entirely.

### 3.8 Threat director (`combat.ts`)

| Const | Value |
| --- | --- |
| First raid | `raidTimer` starts at `2.0` days (first lands early Day 3) |
| Interval | `clamp(1.6 − 0.09·raidsSoFar, 0.7, 1.6)` days after each raid |
| Night bias | if a raid would land by day, with prob `0.7` nudge it to the coming dusk/night |
| Announce lead | `12` s warning banner + `alarm` cue before raiders spawn |
| Wealth `W` | `10·aliveSettlers + Σ structureWealth + 0.5·(wood+ore) + 1·crops + 2·meals` |
| structureWealth | wall 3, door 4, floor 1, bed 8, stove 20, farm 6, turret 40 |
| Threat points `P` | `40 + 20·day + 0.05·W` |
| Raider count | `clamp(round(P / 28), 2, 24)`, split across 1–2 edge spawn points |

### 3.9 Palette (`COL`, exactly `specs/overview.md`)

`void #14110d · soil #5a4632 · grass #6a7638 · rock #38332c · tree #3f6b3a · ore #c9a24a ·
built #8a6a44 · floor #4a3f30 · settler #4f93c9 · raider #c0473f · food #7cc45a ·
wood #b98b4e · health #e05a6a · alert #ff5a52 · panel #1b1712 · text #ece6db ·
text2 #a89e8d · text3 #6b6355`. `FONT` = system **monospace** stack (no web font).

---

## 4. `src/` module breakdown

Modeled on valence's split (`constants` / `types` / `board`→`world` / `sim` / `assets` /
`audio` / `particles` / `render` / `input` / `main`), extended for holdfast's larger system
set. Every file:

| File | Responsibility | Key exports |
| --- | --- | --- |
| `constants.ts` | The tuning table of §3: stage/grid/camera, clock, needs, skills, work times, `STRUCTURES` def table, combat + threat constants, `COL` palette, `FONT`, and all enum/union types. Single source of every pinned number. | `STAGE_W`, `TILE`, `COLS`, `COL`, `FONT`, `FIXED_STEP`, `SPEEDS`, `DAY_SECONDS`, `STRUCTURES`, `SETTLER_ARCHETYPES`, `skillMul()`, plus enums (`TerrainKind`, `StructureKind`, `WorkType`, `Skill`, `JobKind`, `ResourceKind`, `Tool`). |
| `types.ts` | The core data model of §2 (runtime entity/state interfaces). | `Tile`, `ResourceNode`, `Structure`, `Settler`, `Raider`, `Job`, `Needs`, `Drop`, `Tracer`, `Stock`, `FxEvent`, `Cue`, `Toast`, `Clickable`, `GameState`, `Phase`, `PathNode`. |
| `rng.ts` | Seeded deterministic RNG (mulberry32), as valence's — used for world gen and combat rolls so the reference map and the sim harness are reproducible. | `class RNG { next(); range(a,b); int(n); chance(p); pick(arr) }` |
| `world.ts` | The tile world: **generation** of the base map from `MODE.mapSeed` (border rock, interior outcrops, grass belt, tree stands, ore veins, landing site, edge spawn points), tile accessors and `recompute()` of derived `walkable/blocksSight/givesCover`, tile↔pixel/tile↔index math, the **camera** (pan/clamp/zoom, world→screen transform), and **line-of-sight** / **cover** helpers. Analogue of `board.ts`. | `generateWorld(seed)`, `tileAt`, `idx`, `worldToScreen`, `screenToTile`, `clampCamera`, `lineOfSight(a,b)`, `inCover(target, shooter)`, `EDGE_SPAWNS`. |
| `pathfind.ts` | Grid **A\*** over the walkable graph (4/8-connected), returning tile paths; a reachability check and the "nearest reachable tile adjacent to a work tile" helper. Cached/invalidated when the walkable graph changes (a wall built, a door, a node cleared). | `findPath(world, from, to)`, `reachableAdjacent(world, from, workTile)`, `isReachable(...)`. |
| `jobs.ts` | The **job system**: scan the world each tick to (re)generate open jobs from designations, build ghosts, ripe farms, cook opportunities (crops≥threshold & idle stove), dropped piles needing a haul, and downed allies needing a tend; **assignment** — a free settler takes the highest-priority job it is *allowed* (work-priority grid), *able* (skill/kind), and *able to reach*, with no two settlers claiming the same job; and **work progress** per `JobKind` (accumulate work × skill × mood, apply the yield on completion). | `regenJobs(game)`, `assignJob(game, settler)`, `advanceJob(game, settler, dt)`, `WORK_OF: Record<JobKind, WorkType>`. |
| `combat.ts` | The **threat director** (schedule via §3.8, announce, spawn raiders at edges, escalate by day+wealth), raider AI (pathfind toward settlers/turrets, take cover, shoot), **shooting resolution** for settlers/turrets/raiders (range + LoS + cover + skill → hit roll → damage + tracer + fx + cue), **downed/bleed-out/tend**, raid break/flee, and repel bookkeeping. | `class Threat { update(dt); announce(); spawnRaid(n) }`, `resolveShooting(game, dt)`, `updateDowned(game, dt)`, `computeWealth(game)`. |
| `sim.ts` | The **`Game` class** — the orchestrator. Owns all entity lists + stock + camera + tool/build state + score. `fixedStep(dt)` runs the tick in order: day/night clock → needs & mood → job regen → per-settler (need override → job/assignment → path/move → work) → farms/stoves growth → threat director → shooting → downed → drops/tracers/toasts → cull dead → **loss check**. Also the command surface the input layer calls: `designate`, `cancel`, `placeGhost`, `canPlace`, `selectSettler`, `setPriority`, `cycleSpeed`, `togglePause`, `startBase`, `restart`. Drains into `fxQueue`/`sndQueue`. | `class Game`, `MODE` consumption, `fixedStep`, `designateRect`, `placeGhost`, `setPriority`, state transitions, `score`. |
| `mode.ts` | The base **start config** (`MODE: StartConfig`) and the main-menu entry text (`NEW COLONY`). | `MODE`, `MENU_ENTRY`. |
| `assets.ts` | Load the **produced** assets via `import.meta.glob` (page-relative, `?url`): terrain/node/structure/item/icon PNGs, the settler/raider sheet frames (grouped `settler/walk/0..3` …), the `assets/fx/*.system.json` particle systems, and the `assets/audio/*.wav`. Exposes typed getters mirroring valence's `Assets`. | `loadAssets(): Promise<Assets>`, `Assets { sprite(name), frames(prefix,n), fx, audioUrl }`. |
| `audio.ts` | Web Audio playback of the produced `.wav`s: decode on first gesture, play cue buffers on events, loop `music` and the `ambient` bed, **duck/lift** music when a raid lands, `mute` toggle, no autostart. Copied in shape from valence's `audio.ts`. | `class Audio { resume(); play(cue); setRaid(active); toggleMute() }`. |
| `particles.ts` | The **`Bursts`** manager: play each produced `system.json` live through `ParticleCanvasPlayer` (`@test-cabinet/particle-runtime/canvas`) on its own offscreen canvas, composited over the board at the event's world position; one-shots (`muzzle/blood/impact/explosion/dust`) spawned at events, the `fire` loop played while its condition holds. Copied in shape from valence's `particles.ts`. | `class Bursts { spawn(ev); update(dt); draw(ctx, cam) }`. |
| `input.ts` | Collect pointer (move/click/drag/right-click/wheel) and keyboard into per-frame queues; map screen→logical with the live fit transform. Same shape as valence's `input.ts`. | `class Input { attach(); drain(); pointerLogical; wheel; drag }`. |
| `render.ts` | All **canvas drawing**: fit transform, the camera view of the tile world (terrain/nodes/structures via produced sprites, nearest-neighbor), designation overlays and build ghosts, settlers/raiders from the produced sheets (facing via mirror/rotate, cycle by activity), tracers, the `Bursts` composite, the **day/night lighting overlay**, selection + cover cursor, and dispatch to `hud.ts` / `screens.ts`. Returns the frame's `Clickable[]`. | `render(ctx, game, assets, bursts): Clickable[]`, `setRenderTime`, `setMuted`, `setMenuIndex`. |
| `hud.ts` | The **in-code HUD dashboard** (drawn by `render.ts`): the **top strip** (stock readouts with produced icons, colony state, day/time clock + speed, and the prominent threat/raid warning), the **bottom strip** (settler **roster** cards + **build palette / tool bar**), and the **work-priority grid** panel. Emits its `Clickable[]` regions. | `drawTopHud`, `drawBottomHud`, `drawWorkGrid`, `drawTooltip`. |
| `screens.ts` | The menu/overlay **state screens**: title + main menu (`NEW COLONY`, `HOW TO PLAY`), how-to-play, the `Esc` pause overlay (Resume/Restart/Quit to menu), and the colony-lost screen (days survived + tally, RESTART/MENU). | `drawTitle`, `drawHowto`, `drawPause`, `drawGameOver`. |
| `menus.ts` | The menu-item list per state (labels + actions) for keyboard/pointer selection. | `menuItems(state, game): MenuItem[]`. |
| `main.ts` | Bootstrap: load assets, **fit** the 1280×720 stage (letterbox/center, crisp at any DPR, correct on load), wire input, run the fixed-timestep loop (accumulator scaled by speed, frozen when paused/off-play), drain `fxQueue`/`sndQueue`, route clicks/keys to `Game`, and expose the `window.__holdfast` debug hooks for the proof script (§9). Same shape as valence's `main.ts`. | `main()`. |
| `vite-env.d.ts` | Vite client types. | — |

Supporting (mirrors valence, dev-only, excluded from the build):

- `scripts/gen-assets.sh` — produces every asset in `ASSETS.md` with the on-`PATH` tools
  (resolving them from `PATH` or `/cargo-target/the-test-cabinet/release`). Re-runnable.
- `scripts/proof.mjs` — captures the five `proof/` artifacts with project-local Playwright
  via the `window.__holdfast` hooks (§9).
- `sim/` — an optional headless deterministic **balance harness** (`npx tsx sim/run.ts`)
  asserting the survival goals: a do-nothing colony is overrun within a few raids; a
  competent controller (gather → wall + turret + food chain → man the wall) survives
  past a target day count. Same role as valence's `sim/`.
- `vendor/particle-runtime/` — vendored prebuilt `@test-cabinet/particle-runtime` so a plain
  `npm ci` resolves it outside the monorepo (as valence does).

---

## 5. Render / HUD layout (1280×720)

```
┌───────────────────────────────────────────────────────────── y=0
│ TOP HUD  y∈[0,64]                                                    (hud.ts drawTopHud)
│  [wood▮ ore▮ crops▮ meals▮]   [☖3 living · ⚠hungry/hurt flags]   [Day 4  ◐dusk  2×]
│                    « RAID INCOMING — 8s »  (alert banner, pulsing, when active)
├───────────────────────────────────────────────────────────── y=64
│ COLONY VIEW  y∈[64,656]  (render.ts — camera on the 60×44 tile world)
│   terrain sprites · tree/ore nodes · walls/doors/floors/beds/stove/farm/turret sprites
│   designation overlays · build ghosts · settlers (blue, helmet) · raiders (red)
│   tracers + muzzle/blood/impact/dust/fire/explosion particle bursts
│   day/night lighting overlay · selection ring · cover hint · hovered-tile cursor
├───────────────────────────────────────────────────────────── y=656
│ BOTTOM HUD  y∈[656,720]                                              (hud.ts drawBottomHud)
│  ROSTER (left): [Mira ▸mine | hun▮ rest▮ mood▮ hp▮]  [Cole …]  [Sela …]
│  PALETTE (right): [designate][cancel] [wall][door][floor][bed][stove][farm][turret]
│                    [WORK GRID] [❚❚/▶ speed 1·2·3] [mute]
└───────────────────────────────────────────────────────────── y=720
```

- **Top strip** draws the four **stock** readouts with produced 16×16 icons (`wood`, `ore`,
  `crops`, `meals`); a **colony state** cluster (living-settler count with the settler icon,
  and warning glyphs when anyone is hungry / exhausted / hurt); the **day + time-of-day
  clock** (day number + a small phase dial/label) and current **speed**; and — most
  prominently — the **threat/raid warning** banner (alert color, pulsing) with the count-down
  when a raid is incoming and a "RAID" state while it is underway.
- **Colony view** is the camera. Terrain, nodes, and structures are the produced `draw`
  sprites blitted at `TILE·zoom`, `imageSmoothingEnabled = false`. Settlers/raiders are the
  produced `draw-sheet` cycles, frame chosen by `activity` and `animT`, facing by mirror/
  rotate. Designations show a corner-bracket overlay; ghosts a translucent sprite (red if
  illegal). The **day/night overlay** is a cooling blue multiply whose alpha follows `time`
  (never fully black); the colony's built lights and muzzle flashes read through it.
- **Bottom strip** left: one **roster card** per living settler — name, four thin need
  bars (hunger, rest, mood, health in the health color), current activity label, and
  standout skills on hover/selection. Right: the **build palette / tool bar** —
  designate, cancel, and each structure (produced glyph + name + cost, greyed if
  unaffordable) — plus a **WORK GRID** button, the speed/pause controls, and mute.
- **Work-priority grid** panel (opened from the bottom HUD): rows = settlers,
  columns = `Gather · Haul · Build · Cook · Farm · Fight`; each cell cycles priority
  `0 (off) .. 4` on click. Settlers pull jobs respecting it (§4 `jobs.ts`).

**Game-state machine** (`GameState`):

```
 title ──NEW COLONY──▶ playing ──last settler dies──▶ gameover ──RESTART──▶ playing
   │                     │  ▲                                        └─MENU──▶ title
   └──HOW TO PLAY──▶ howto│  │Esc(menu)                     playing: Space = in-place pause
        └──Esc/back──┘    ▼  │                                       1/2/3 = speed
                        paused (Resume / Restart / Quit to menu)
```

`playing` runs the sim at `speed`, frozen while `paused` or during the `Esc` overlay
(`state==="paused"`). The in-place `Space` pause freezes ticks without a menu (board stays
interactive: pan, read HUD, set the grid, place designations/ghosts). `Esc` opens the
overlay menu (also freezes); in any menu, `Esc` goes back.

---

## 6. Tick order (the fixed step, `Game.fixedStep(dt)`)

Deterministic order every tick (`dt = FIXED_STEP`, called `speed` times per real second):

1. **Clock** — advance `time` by `dt/DAY_SECONDS`; roll over → `day++`, update `phase`.
2. **Needs & mood** — hunger up, rest down (×night), recompute mood from needs + decaying
   event mood; set `moodBreak`.
3. **Job regen** (`jobs.regenJobs`) — rebuild the open-job set from designations, ghosts,
   ripe farms, cook opportunities, drops, and downed allies.
4. **Per settler** — if a **need is critical** (starving-hungry with meals, or exhausted)
   or a **raid is live** (drop tools to fight/flee), that overrides the job queue; else
   claim/keep a job (`assignJob`), pathfind, move along the path (speed ×floor/mood), and
   **advance the claimed job** (`advanceJob`) when at the work tile.
5. **Structures** — farm growth (advances only in daylight; grass plots faster), stove
   `active` while a cook job runs, turret target acquisition + `aim`.
6. **Threat director** (`combat.Threat.update`) — tick the raid timer; announce; spawn a
   raid at edge points when due; escalate by `day` + `computeWealth`.
7. **Shooting** (`combat.resolveShooting`) — settlers, turrets, and raiders fire on cadence
   at valid in-range, in-LoS targets; roll hit (range × skill × cover); apply damage; push
   a `Tracer`, a `muzzle`+`blood`/`impact` fx, and a `gunshot`/`hit` cue.
8. **Downed / bleed / tend** (`combat.updateDowned`) — bleed timers; deaths; tends stabilize.
9. **Drops / tracers / toasts** — decay lifetimes; hauls consumed into stock.
10. **Cull dead**; **milestones** (first turret, first raid repelled, N days) as toasts.
11. **Loss check** — if no living settler remains → `state = "gameover"`, freeze the score
    (days survived + tally).

Rendering interpolates settler/raider pixel positions between ticks for smooth motion.

---

## 7. Day/night, farming, and their coupling

- `phase` drives the lighting overlay and the schedule: settlers **sleep by preference at
  night** and rest drains faster after dark; the colony naturally works by day.
- **Farm growth advances only in daylight** (`phase` = dawn/day/dusk), faster on `grass`
  than `soil` (README-stated) — so the day/night cycle sets the farm's rhythm.
- **Raids favor the night** (§3.8 night bias): a night raid catches a tired, half-asleep
  crew in the dark — visibly nastier than a day raid — so the player watches the clock and
  posts the guard before dusk. Every raid is announced regardless of hour.

---

## 8. Milestones & scoring

Non-blocking `Toast`s: `first turret online`, `first raid repelled`, `Day 5 / 10 / 15 …
survived`. Score at loss: **days survived** (primary, `day` + fractional `time`) plus a
secondary tally — **raids repelled**, **raiders killed**, **structures built**, **peak
population** — shown on the colony-lost screen. Not persisted between sessions.

---

## 9. Proof plan (`scripts/proof.mjs`, exact paths from `specs/proof.md`)

`main.ts` exposes `window.__holdfast` for deterministic driving (inert in normal play), the
analogue of valence's `window.__valence`:

```ts
window.__holdfast = {
  game, audio,
  startBase(),                       // enter playing on the base start
  setState(s),                       // force a GameState
  camTo(tx, ty),                     // center camera on a tile
  designate(kind, tx0, ty0, tx1, ty1), // rectangle chop/mine designation
  build(kind, tx, ty),               // place a ghost (and mark it prebuilt for setup)
  grant(res, n),                     // add to a stock (setup)
  setPriority(settlerId, work, p),   // poke the work grid
  advance(seconds),                  // run N sim-seconds fast (setup fast-forward)
  triggerRaid(n?),                   // announce + spawn a raid now
  forcePhase("night"),               // jump the clock to a phase
  hurtSettler(id, dmg), killAll(),   // drive toward the loss state
};
```

| Proof path | What it drives / captures |
| --- | --- |
| `proof/title.png` | Load the built site; stay on `title`. Capture the full stage — title `HOLDFAST`, tagline, and the menu (`NEW COLONY`, `HOW TO PLAY`) all visible. |
| `proof/gameplay.png` | `startBase()`, then set up a working colony: `advance()` a couple of days with a scripted controller (or `build(...)` a wall run, a stove, a farm, a turret, and `grant` modest stock), leave settlers mid-work, `camTo` the base. Capture the live in-colony frame — produced terrain/node/structure sprites, animated settlers, and the full HUD (top vitals + bottom roster & palette). |
| `proof/game-over.png` | From a short-lived colony, `killAll()` (or `triggerRaid` an overwhelming wave and let it resolve) so the last settler dies; capture the colony-lost screen with **days survived** shown. |
| `proof/colony.webm` | `recordVideo` ~6 s of the **economy**: `designate("chop", …)` and a `mine`, a settler walks to a node and works it (dust puffing), the node clears and drops wood/ore, a haul carries it to the stockpile, a build consumes it, and a farm/stove produces food. |
| `proof/raid.webm` | `recordVideo` ~6 s of a **raid**: `forcePhase("night")` then `triggerRaid()` — the warning banner + `alarm`, raiders entering and advancing, settler/turret fire with produced **muzzle flash** and **impact/blood** particles, a settler taking **cover** behind a wall, and ideally a settler **downed** or the colony reaching its loss state. Let the produced audio play if it is captured. |

Both clips are native `.webm` from Playwright `recordVideo`; screenshots are PNG of the
full fitted `1280×720` stage, framed as the reference mockups are. Files land at exactly the
paths above and are committed alongside the build (not served by it).

---

## 10. Build & load rules (non-negotiable)

- Node project, `package.json` at root, `package-lock.json` committed. `npm ci` then
  `npm run build` (`tsc --noEmit && vite build`) produces a self-contained static site into
  `dist/` with a root `index.html`. Vite `base: "./"` so every JS/CSS/asset URL is
  **page-relative** — the build must run under a per-run sub-path with **no 404s** (self-check:
  serve `dist/` from a non-root path). **Never** a root-absolute `/assets/…` URL; all assets
  load through `import.meta.glob(..., { query: "?url" })`.
- Assets are **produced once** with the tools and committed under `assets/`; the build never
  invokes the tools. `@test-cabinet/particle-runtime` is the only runtime dependency; audio
  and particles play as in §4. A `README.md` documents the game, install/dev/build commands,
  the controls, and every README-stated design choice flagged above (structure costs,
  refund-on-cancel, daylight-only farming, hauling model, skill growth, single designate
  tool that reads the node under it, door LoS/cover behavior).
