# Midway — reference implementation DESIGN

This is the implementation contract for the engineers building the authored,
ground-truth reference for the `midway` **full-stack** case (`base` variant — the
*New Park* start). It is the analogue of the committed `valence` reference
implementation and must mirror its shape and quality: plain **TypeScript** rendering
to a single **HTML5 canvas**, bundled with **Vite** (`base: "./"`), no backend, no
network, no API keys, everything in the built bundle. Every sprite, animation,
particle effect, and sound is a file **produced during the build** with the six
on-`PATH` tools and committed under `assets/` (see `ASSETS.md`); at runtime the game
only *loads* those committed files.

Read this alongside the seeded specs — it never contradicts them. Where a spec pins a
value this document repeats it; where the specs leave a choice (`overview.md` "Free
choices": plot size and entrance, the full ride/stall/scenery set, how the park reads),
this document fixes the concrete numbers the reference uses. Those numbers live in one
place in code, `src/constants.ts`, exactly as valence's do.

---

## 1. Game summary

Midway is a top-down theme-park tycoon sim. You look **down** on a fenced grass plot
and grow it into a park: lay the **paths** guests walk, place and price the **rides**
they queue for and the **stalls** they buy from, hire the **staff** (janitors,
mechanics, entertainers) who keep it clean and running, and keep a desire-driven crowd
happy. The engine is one feedback loop the player can watch turning:

> happy guests lift the **rating** → a high rating lifts the **arrival rate** at the
> gate → more guests spend more money → which funds a bigger, better park that keeps
> guests happy. Run it in reverse — overprice, let rides break and litter pile up — and
> happiness, rating, arrivals, and cash all slide, and the park spirals into the red.

There is **no victory screen**. The run is open-ended and measured by **days
operated** (plus peak guests, park rating, total profit). The only end is
**bankruptcy**.

### Win / lose

- **No win state.** A solvent park runs forever; the "score" is how long and how well.
- **Lose = bankruptcy.** The park is lost when **cash falls below the bankruptcy floor
  (`BANKRUPTCY_FLOOR = −2000`) and stays below it past a short grace period
  (`GRACE_SECONDS = 20` sim-seconds)** — a brief dip is survivable, a sustained loss is
  fatal. On loss the game enters the **park-closed** state showing days operated + the
  secondary tally, with **TRY AGAIN** / **MENU**.

### Mode base (the *New Park* start — `specs/mode.md`)

`src/mode.ts` isolates the start, exactly as valence's `mode.ts` isolates its campaign.
The `base` variant is `NEW PARK`: a fresh green plot, the entrance gate + a small paved
plaza already down, `START_CASH = 4000` opening balance (a starting loan), **no rides
or stalls, no staff**. Every common system (`park.md`…`flow.md`) runs with no overrides.
`MODE.weather = false` for base; the `downpour` sibling flips a single flag and layers
the weather system on top — base does not implement weather, but the `Mode` interface
reserves the field so the sibling is a config change, not a rewrite.

---

## 2. src/ module breakdown

The split mirrors valence (`constants`/`types`/`mode`/`board`→`park`/`sim`/`render`/
`assets`/`audio`/`particles`/`input`/`menus`/`main`). Every module below is a
`src/*.ts` file. The **contracts** (`constants.ts`, `types.ts`) come first because every
later module depends on them; write them first and freeze them.

| File | Responsibility | Key exports |
| --- | --- | --- |
| `constants.ts` | Every pinned number and color: stage geometry, palette (`COL`), font, tile size + plot dims, the ride/stall/scenery/staff **catalogs**, and the `TUNE` tuning table (§4). No logic. | `STAGE_W/H`, `TOP_HUD_H`, `BOTTOM_HUD_H`, `PARK_Y0/Y1`, `TILE`, `COLS`, `ROWS`, `FIXED_STEP`, `COL`, `FONT`, `RIDES`, `STALLS`, `SCENERY`, `STAFF`, `TUNE`, enums `TileKind`, `RideKind`, `StallKind`, `SceneryKind`, `StaffKind`, `ToolKind`, `DesireKey` |
| `types.ts` | The **core data model** (§3): every runtime interface — `World`, `Tile`, `Guest`, `Staff`, `Attraction`, `Camera`, `Ledger`, particle/sound event types, `GameState`, `Tool`, `Clickable`. No logic, only types. | all interfaces + `GameState`, `FxKind`, `Cue`, `Clickable` |
| `mode.ts` | The start config, isolated (§1). | `Mode` interface, `MODE` const |
| `rng.ts` | Seeded deterministic RNG (mulberry32), so the sim and the balance harness reproduce. | `RNG` class (`float()`, `int(n)`, `chance(p)`, `pick(arr)`, `range(a,b)`) |
| `park.ts` | The park **grid + camera + graph** (valence's `board.ts`). Builds the plot (§3.1), the gate/plaza, tile legality, path connectivity flood from the gate, appeal accumulation from scenery, and **pathfinding** (BFS over the 4-connected walkable graph, memoized per target). Camera clamp/zoom. | `makeWorld(mode)`, `tileAt`, `inBounds`, `isWalkable`, `canPlacePath`, `canPlaceFootprint`, `recomputeConnectivity(world)`, `recomputeAppeal(world)`, `findPath(world, from, to)`, `nearestPathTile`, `clampCamera`, `worldToScreen`/`screenToWorld` |
| `guests.ts` | Pure guest AI helpers (`specs/guests.md`): desire decay/growth, `chooseAction` (weigh pressing desires against reachable+affordable targets), price-vs-value judgment, happiness deltas, queue-tolerance + patience. Called by `sim.ts`; holds no state. | `stepDesires`, `chooseAction`, `perceivedValue`, `judgePrice`, `applyHappiness`, `queueTolerance`, `shouldLeave` |
| `rides.ts` | Pure ride/stall cycle helpers (`specs/rides.md`): the load→run→unload state machine, throughput, breakdown accrual + repair, stall sale + litter emission. Called by `sim.ts`. | `stepAttraction`, `tryLoad`, `accrueBreakdown`, `beginRepair`, `sellAt`, `throughputOf` |
| `staff.ts` | Pure staff behaviour (`specs/staff.md`): janitor litter-seek + clear (+ cleanup puff), mechanic inspect-on-patrol + repair-broken, entertainer roaming mood aura; assignment (zone vs roam). Called by `sim.ts`. | `stepStaff`, `assignZone`, `wageBill`, `findLitterTarget`, `findBrokenRide` |
| `economy.ts` | The money **ledger + accounting** (`specs/economy.md`): per-day upkeep + wages charge, income tallies, rolling income/expense rate for the trend, bankruptcy timer. | `Ledger` helpers `earn`, `spend`, `chargeDaily`, `rates`, `bankruptcyStep` |
| `rating.ts` | The reputation loop (`specs/flow.md`): compute the rating target from avg happiness + cleanliness + variety/reliability, ease the live rating toward it, and derive the **arrival rate** from the rating. Small but load-bearing — it closes the loop. | `computeRatingTarget`, `arrivalRateFor`, `easeRating` |
| `sim.ts` | The **`Game` class** — the orchestrator (valence's `sim.ts`). Owns `World`, `guests[]`, `staff[]`, `attractions[]`, `scenery[]`, the `Ledger`, `rating`, day clock, active `Tool`/selection, `state`, milestones, and the `fxQueue`/`sndQueue`. `fixedStep(dt)` advances everything on the tick; the tool/command methods mutate the park. | `Game` class: `fixedStep`, arrivals/spawn, `layPath`, `placeAttraction`, `placeScenery`, `hireStaff`, `assignStaff`, `setPrice`, `demolish`, `selectAt`, `cycleSpeed`, `togglePause`, `restart`, plus `fxQueue`, `sndQueue`, `pointerX/Y`, `state` |
| `assets.ts` | Load the **produced** files through Vite `import.meta.glob` (page-relative under any base path). Maps sprite names → `HTMLImageElement`, animation prefixes → frame arrays, `fx/*.system.json` → `ParticleSystem`, `audio/*.wav` → URL. | `loadAssets()` → `Assets` ( `sprite(name)`, `frames(prefix)`, `guest`, `ride`, `staff`, `fx`, `audioUrl` ) |
| `audio.ts` | Web Audio playback (`specs/assets.md` "Audio"): decode the produced `.wav`s on first gesture, play cues on events, loop the crowd hum + carnival music, mute toggle, no autostart. Direct copy of valence's `Audio` class shape. | `Audio` class (`resume`, `play(cue)`, `toggleMute`, `muted`) |
| `particles.ts` | Play the produced particle systems live via `@test-cabinet/particle-runtime`'s `/canvas` binding. **One-shots** (fireworks, cleanup puff) simulated on an offscreen canvas and composited; **loops** (steam, sparkle) held while a stall/ride is active and stopped when idle/broken. | `Particles` class (`spawnOneShot`, `ensureLoop`, `stopLoop`, `update`, `draw`) |
| `input.ts` | Pointer + keyboard capture, drag state (for the path tool), wheel (zoom), viewport→logical mapping. Valence's `input.ts` plus drag + wheel. | `Input` class (`attach`, `pointerLogical`, `clicks`, `drag`, `wheel`, `keys`, `setViewport`, `drain`) |
| `menus.ts` | One source of truth for each menu's items so `render` draws them and keyboard nav drives the same list. | `menuItems(state, game)` |
| `main.ts` | Bootstrap: load assets, fit the fixed 1280×720 stage (letterboxed, centered, crisp at any DPR and on load), wire input, run the fixed-step loop, route clicks/keys to tools & menus, expose `window.__midway` dev hooks for the proof script. | `main()` |

Two dev-only trees mirror valence and are **excluded from the build**:

- `sim/` — a headless deterministic **balance harness** (`npx tsx sim/run.ts`): drives a
  battery of scripted managers and checks the balance goals — a greedy/overpriced or
  unstaffed park must go bankrupt; competent build-path→ride→price→staff play must stay
  solvent and grow the rating. Reuses `park.ts`/`guests.ts`/`rides.ts`/`economy.ts`/
  `rating.ts` headlessly. Files: `sim/README.md`, `sim/harness.ts`, `sim/managers.ts`,
  `sim/run.ts`.
- `scripts/gen-assets.sh` — reproduces the produced assets with the on-`PATH` tools
  (the record of how `assets/` was made; see `ASSETS.md`).
- `scripts/proof.mjs` — captures the `proof/` artifacts with the project-local
  Playwright (§7).

---

## 3. Core data model (`types.ts`)

Define these up front; they are the contract every later module depends on. Positions
are in **logical pixels** (world space, tile = `TILE` px); tile coordinates are
`{col,row}` integers.

```ts
// ---- Grid & world -----------------------------------------------------------
export type TileKind = "grass" | "water" | "fence" | "gate" | "path";

export interface Tile {
  kind: TileKind;
  litter: number;        // 0..1, path tiles only; raised by guests, cleared by janitors
  appeal: number;        // 0..1, derived each rebuild from nearby scenery (park.md)
  connected: boolean;    // path tile reachable from the gate (flood from gate)
  occupantId: number;    // attraction/scenery id occupying this tile, or -1
  region: number;        // path-graph connected-component id (for fast reachability)
}

// top-left world px, zoom 0.75..1.5
export interface Camera { x: number; y: number; zoom: number; }

export interface World {
  cols: number; rows: number;         // COLS x ROWS (64 x 44)
  tiles: Tile[];                       // row-major, length cols*rows
  gate: { col: number; row: number }; // the single entrance in the fence
  plaza: { col: number; row: number }[]; // pre-laid plaza path tiles at the gate
  camera: Camera;
}

// ---- Attractions (rides + stalls share the shape) ---------------------------
export type AttractionCategory = "ride" | "stall";
export type RideState = "idle" | "loading" | "running" | "unloading" | "broken";

export interface Attraction {
  id: number;
  category: AttractionCategory;
  kind: RideKind | StallKind;          // catalog key
  col: number; row: number;            // footprint top-left
  w: number; h: number;                // footprint in tiles
  entrance: { col: number; row: number }; // the queue tile; must be path-adjacent
  connected: boolean;                  // entrance touches a gate-connected path
  price: number;                       // player-set ticket / sale price
  upkeep: number;                      // per-day cost (from catalog)
  // rides:
  capacity: number; rideDuration: number; thrill: number; // from catalog
  state: RideState; runTimer: number; loadTimer: number;
  riders: number[];                    // guest ids aboard
  queue: number[];                     // guest ids waiting, front = index 0
  breakdownAccum: number;              // rises as it runs; > threshold -> break
  brokenTimer: number; inspectTimer: number;
  // stalls:
  serves: DesireKey;                   // hunger | thirst | souvenir(want) | bladder
  sellTimer: number;
  // shared bookkeeping:
  takings: number; takingsWindow: number[]; // rolling recent takings for the panel
  animT: number;                       // ride animation phase (frozen when not running)
}

// ---- Guests (the signature system, guests.md) -------------------------------
export type DesireKey = "thrill" | "hunger" | "thirst" | "bladder" | "energy";
export type GuestState =
  | "entering" | "wandering" | "walking" | "queuing"
  | "riding" | "buying" | "resting" | "leaving";
export type GuestMood = "walk" | "happy" | "angry" | "eating"; // animation set

export interface Guest {
  id: number;
  x: number; y: number;                // world px (continuous, interpolated in render)
  tile: { col: number; row: number };
  path: { col: number; row: number }[]; pathIdx: number; // current route
  speed: number;                       // px/sim-second
  facing: 1 | -1;                      // sprite flip
  desires: Record<DesireKey, number>;  // thrill/hunger/thirst/bladder 0..100 (need),
                                       // energy 0..100 (reserve, falls with walking)
  wallet: number;
  happiness: number;                   // 0..100, the value everything moves
  admissionPaid: boolean;
  state: GuestState;
  mood: GuestMood; animT: number;      // which produced sheet + frame timer
  targetId: number;                    // attraction id, or -1 for gate/bench/wander
  targetKind: "ride" | "stall" | "bench" | "gate" | "none";
  waitTimer: number;                   // seconds in the current queue (patience)
  actTimer: number;                    // riding/buying/resting countdown
  reviewGiven: boolean;
}

// ---- Staff (staff.md) -------------------------------------------------------
export type StaffState = "idle" | "walking" | "working";
export interface Staff {
  id: number;
  kind: StaffKind;                     // janitor | mechanic | entertainer
  x: number; y: number; tile: { col: number; row: number };
  path: { col: number; row: number }[]; pathIdx: number; speed: number; facing: 1 | -1;
  state: StaffState; workTimer: number;
  targetId: number;                    // ride to repair / tile index to clean / -1
  zone: { col: number; row: number; w: number; h: number } | null; // null = roam
  wage: number; animT: number;
}

// ---- Scenery ----------------------------------------------------------------
export interface Scenery {
  id: number; kind: SceneryKind; col: number; row: number; w: number; h: number;
}

// ---- Economy ----------------------------------------------------------------
export interface Ledger {
  cash: number;
  dayIncome: number; dayExpense: number;   // accumulating this day
  incomeRate: number; expenseRate: number; // last full day's rates (for the HUD trend)
  totalProfit: number;
  belowFloorTimer: number;                 // seconds under BANKRUPTCY_FLOOR
}

// ---- Events, state, UI ------------------------------------------------------
export type FxKind = "fireworks" | "steam" | "sparkle" | "cleanup";
export interface FxEvent { kind: FxKind; x: number; y: number; }
export type Cue = "coin" | "ding" | "alarm" | "crowd" | "music";

export type GameState = "title" | "howto" | "playing" | "paused" | "gameover";
export type ToolKind = "path" | "build" | "staff" | "price" | "demolish";
export interface Clickable {
  x: number; y: number; w: number; h: number; action: string;
  payload?: string; disabled?: boolean;
}
```

The `Game` (`sim.ts`) holds: `world`, `guests`, `staff`, `attractions`, `scenery`,
`ledger`, `rating` (0..100, live) + `ratingTarget`, `day` + `dayT`, `peakGuests`,
`tool` + `buildKind`/`staffKind`, `selectedId`, `state`, `paused`, `speed` (1|2|3),
`milestones` (set of fired ids), `notifications[]` (text + ttl), `fxQueue`, `sndQueue`,
`pointerX/Y`, `rng`.

### 3.1 The plot (fixes `overview.md` "Free choices")

`COLS = 64`, `ROWS = 44`, `TILE = 24` (pinned by `park.md`) → plot 1536×1056 px, larger
than the 1280×592 park view, so it pans. The outer ring (col 0/63, row 0/43) is
`fence`. The **gate** is a single `gate` tile in the bottom fence at `col 32, row 43`;
a pre-laid **plaza** of `path` runs inward from it: a 3-wide stub up to `row 40`, so on
load the player can start laying path immediately. Some **water** is pre-placed as one
small pond (a ~4×3 block near col 12,row 10) to constrain layout, per `park.md`. On
load the camera centers on the gate + plaza (`park.md`).

---

## 4. Tuning table (`TUNE` in `constants.ts`)

Every number the specs leave to the author, fixed here. These are the reference values
the balance harness is tuned against; keep them in `TUNE` so one edit re-tunes.

**Time & sim.** `FIXED_STEP = 0.1` (10 ticks/s at 1×; `speed` ∈ {1,2,3} scales
ticks/s). `DAY_SECONDS = 60` sim-seconds/day. Upkeep + wages charged once per day.

**Economy.** `START_CASH = 4000`. `BANKRUPTCY_FLOOR = −2000`, `GRACE_SECONDS = 20`.
Path tile `5`. Build cost: carousel `800`, coaster `1500`, drop-tower `1200`; food
`350`, drink `300`, souvenir `300`, restroom `250`; tree `40`, flowerbed `30`, bench
`60`, lamp `50`, fountain `200`. Demolish refund `50%` of build cost (state in README).
Upkeep/day: carousel `30`, coaster `45`, drop-tower `35`; food `12`, drink `12`,
souvenir `10`, restroom `8`; scenery `0`. Wages/day: janitor `40`, mechanic `60`,
entertainer `45`. Repair fee `40` per repair.

**Default prices.** Admission `8`; carousel `3`, coaster `6`, drop-tower `5`; food `5`,
drink `3`, souvenir `8`, restroom `1`.

**Guests.** Wallet `20..40` (rng). Admission balk: enter only if
`ratingFairness ≥ price/wallet` heuristic (`judgePrice`). Desire growth/day: thrill
`+9`, hunger `+7`, thirst `+8` (`+4` extra for 20 s after a ride), bladder `+6` (`+6`
extra for 30 s after a drink). Energy falls `−1.5` per tile walked; a bench restores to
`~90`. Happiness starts `70`; leaves-angry below `20`; content-to-leave when `wallet <
6` or all desires satisfied. Queue balk when `queueLen > 4 + happiness/12`; patience
`30` s before bailing a line (losing happiness while waiting). Move speed `~34` px/s.

**Rides.** capacity / rideDuration(s) / thrill / breakdown-rate:
carousel `8 / 6 / 20 / low`, coaster `4 / 8 / 55 / high`, drop-tower `6 / 5 / 45 /
med`. Load time `1.5` s. Breakdown: `breakdownAccum += ratePerRun` each completed run,
scaled `×(1 + timeSinceInspect/120)`; break when it crosses `1.0`; repair takes `6` s
of a mechanic on-site; a mechanic patrol inspection resets `inspectTimer` and shaves
accum.

**Stalls.** Serve time `2` s; a sale meets its desire (`−60` need), emits litter
`+0.15` on 2–3 nearby path tiles, adds a steam loop for food/drink while serving.

**Rating & arrivals.** `ratingTarget = 0.60·avgHappiness + 0.22·cleanliness +
0.18·(variety·reliability)` (all 0..100). `rating` eases toward target at `~8`/day.
`cleanliness = 100·(1 − avgLitter)`. `variety` scales with distinct connected ride
kinds (0,1,2,3+ → 30/60/85/100); `reliability` drops with broken rides.
`arrivalRate = lerp(0.4, 24)` guests/day across rating 20→95, `0` below rating 12;
concurrent-guest cap `220`.

**Staff cadence.** Janitor clears a litter tile in `1.2` s (throws a cleanup puff),
seeks the highest-litter reachable tile in its zone/roam. Mechanic prioritizes broken
rides, else patrols inspecting. Entertainer roams; guests within `~72` px gain
`+6`/s happiness.

**Milestones.** first ride open, first stall open, first 5-star day, `50` guests at
once, `100` / `200` days operated → brief non-blocking notification; the 5-star and
guest-count milestones also fire a **fireworks** one-shot over the park.

---

## 5. Render & HUD layout (`render.ts`), and the state machine

### Stage & camera

Fixed **1280×720** logical stage, uniform-scaled to the window and letterboxed with
`COL.void` (`#0f1626`), centered, crisp on load before any input at any DPR — the
`main.ts` `resize()` + `setTransform` pattern is copied from valence verbatim. Three
horizontal bands (`overview.md`): **top HUD** `y∈[0,64]`, **park view** `y∈[64,656]`
(full width, the camera), **bottom HUD** `y∈[656,720]`. Only the park view shows
tiles; the two strips are always fully drawn over any world content. The park view is
clipped to its rect and drawn under `camera` (pan clamped to plot bounds; wheel zoom
0.75..1.5 keeps the whole stage fitted and the strips fixed).

`render(ctx, game, assets, particles) → Clickable[]` returns the frame's hit regions
(same contract as valence) so `main.ts` routes clicks against exactly what was drawn.

### Park view drawing order

1. Ground: every visible tile from produced `tiles/` sprites (grass, water, fence,
   gate), nearest-neighbor (`imageSmoothingEnabled = false`).
2. Paths: the flush-tiling produced `path` sprite, choosing straight/corner/junction by
   4-neighbor mask; litter drawn as a small overlay whose density tracks `tile.litter`;
   unconnected path tinted faintly.
3. Attractions: the produced ride/stall body sprite at its footprint; **rides overlay
   the produced ride animation frames while `state==="running"/"loading"`** and freeze
   on frame 0 when idle/broken; a **broken** ride shows the produced `alert` icon + a
   red flash; an **unconnected** attraction shows a "no path" flag. Steam loop over
   running food/drink stalls, sparkle loop over running rides (via `particles.ts`).
4. Scenery from produced `scenery/` sprites.
5. Guests: produced guest sheets, the frame set chosen by `mood` (walk/happy/angry/
   eating), advanced on `animT`, flipped by `facing`; drawn sorted by `y` for overlap.
   Staff drawn from their produced sheets, visibly distinct.
6. Queue read: a short line of the queued guests along the entrance + a count badge.
7. Particle one-shots (fireworks, cleanup puffs) composited last, over the park.
8. Tool feedback (all in code): path-drag preview + running cost, build ghost tinted
   legal/illegal, hovered-tile cursor, selection highlight ring.

### Top HUD (`y∈[0,64]`) — park vitals (all in code; icons are produced sprites)

Left→right, each with its produced icon + a **shape/label** so it reads without color
alone (`overview.md`): **cash** (signed figure, `#5fce6e`/`#ff5a52`, with an
up/down **trend arrow** from `incomeRate−expenseRate`); **guests** (count + guest
icon); **rating** (a **5-star** row filled from `rating`, `#ffcb52`); **happiness** (a
**mood face** + worded label — GRIM/OK/HAPPY — from avg happiness, `#ffd24a`); **day**
(counter); **speed** (`▶`/`▶▶`/`▶▶▶` or ‖ when paused). Right edge: **alert** chips
(ride broken, litter high, cash low) in `#ff5a52` with the alert icon.

### Bottom HUD (`y∈[656,720]`) — build palette + context panel

Left: the **tool bar** — Path, Build, Staff, Price, Demolish — each a button with its
produced tool glyph; the active tool is highlighted, and Build/Staff expand a row of
item chips (rides/stalls/scenery; janitor/mechanic/entertainer) with cost + build
glyph. Right (`context panel`): the selected tool's options **or** the selected
object's details — an attraction's price (± steppers), queue length, and rolling
takings; a guest's desire bars + mood + wallet (the inspector); or the staff roster +
total wage bill. A mute `♪` toggle sits in a corner.

### State machine

```
title ──NEW PARK──▶ playing ──Esc──▶ paused ──Resume──▶ playing
  │                    │  ▲              ├─Restart─▶ playing (fresh)
  └──HOW TO PLAY──▶ howto              └─Quit────▶ title
                                     playing ──bankrupt──▶ gameover ──TRY AGAIN─▶ playing
                                                                    └─MENU──────▶ title
```

- **title**: `MIDWAY` + tagline + vertical menu `NEW PARK`, `HOW TO PLAY`; a dim,
  slowly-panning slice of a lively park behind the menu for atmosphere.
- **howto**: controls, the build→place→price→staff loop, guest desires, the
  rating→arrivals feedback, the goal; BACK.
- **playing**: the live park + full HUD; sim runs at `speed`, or frozen by the in-place
  `Space` pause (board stays interactive) — distinct from the Esc menu.
- **paused**: Esc overlay (Resume / Restart / Quit to menu) over a frozen park.
- **gameover**: park-closed — days operated (large) + peak guests, final rating, total
  profit; TRY AGAIN / MENU.

Menus are mouse-operable and `↑`/`↓`(or `W`/`S`)+`Enter`/`Space`; `Esc` backs out
(`controls.md`). Speed `1`/`2`/`3` (or `F`), `Space` in-place pause, `M` mute, arrows/
WASD pan, drag pan, wheel zoom.

---

## 6. Simulation order (`Game.fixedStep(dt)`)

Fixed order each tick, so the loop is reproducible (valence's `fixedStep` shape):

1. **Day clock**: `dayT += dt`; on day rollover, charge upkeep + wages
   (`economy.chargeDaily`), snapshot income/expense rates, bump `day`, fire day
   milestones.
2. **Arrivals**: accumulate `arrivalRateFor(rating)`; spawn a guest at the gate if
   under the concurrent cap; the guest pays admission (or **balks** by `judgePrice`) and
   gets a wallet.
3. **Guests**: `stepDesires` → for a free guest `chooseAction` (strongest reachable +
   affordable desire; else wander/rest/leave) → `findPath` to the target entrance →
   move along the path; queue/ride/buy/rest transitions; happiness deltas from appeal,
   litter, entertainer, queue waits, price judgments; drop litter while walking/eating;
   depart at the gate leaving a good/bad **review** (feeds rating). Set `mood` for the
   render sheet.
4. **Attractions**: `stepAttraction` — rides load→run→unload (charge the ticket on
   board, `coin` cue; `ding` on run start; thrill+happiness on unload), grow/shed the
   queue, accrue + trigger breakdowns (`alarm` cue, drain the queue); stalls sell on
   cadence (`coin`, litter, steam loop).
5. **Staff**: `stepStaff` — janitors seek+clear litter (`cleanup` puff), mechanics
   repair broken / inspect on patrol, entertainers roam boosting nearby mood.
6. **Rating**: recompute `ratingTarget`, ease `rating` toward it; recompute
   cleanliness/variety/reliability inputs.
7. **Economy**: fold the tick's income/expense; `bankruptcyStep` — if
   `cash < BANKRUPTCY_FLOOR` grow `belowFloorTimer`, else reset; on
   `belowFloorTimer > GRACE_SECONDS` → `state = "gameover"`.
8. Update `peakGuests`, milestone checks, notification TTLs, and drain nothing (the
   render loop drains `fxQueue`/`sndQueue`).

Connectivity + appeal are recomputed (`park.ts`) whenever a path/attraction/scenery is
added or removed, not every tick, and pathfinding results are memoized per target and
invalidated on those edits.

---

## 7. Proof plan (`scripts/proof.mjs` → `proof/`)

Serve the **built** `dist/` under a non-root sub-path (`/runs/demo/build`, proving
base-path safety), drive the game via `window.__midway` dev hooks with the
project-local Playwright + Chromium, assert **zero** console/request errors, and write
each artifact to the exact `specs/proof.md` path. The dev API (inert during normal
play, mirroring valence's `__valence`):

```
window.__midway = {
  game,
  audio,
  newPark(),                       // start the base park (state -> playing)
  devGrant(cash),                  // set cash
  devDay(n),                       // jump the day counter
  devArrivals(on),                 // force/suppress the arrival stream
  layPath([[c,r]...]),             // lay a run of path tiles
  place(kind, col, row),           // place a ride/stall (snaps entrance to path)
  scenery(kind, col, row),
  hire(kind, col, row),            // hire+place a staff member
  setPrice(id|kind, price),
  spawnGuests(n),                  // inject n guests at the gate
  breakRide(id?),                  // force a breakdown
  litter(col,row,amt),             // add litter for the janitor demo
  fireworks(),                     // trigger the milestone one-shot
  setState(s),
}
```

| Artifact | What to drive & capture |
| --- | --- |
| `proof/title.png` | `goto` the base-path URL, settle, move the pointer off the menu; screenshot the title with **every** menu item (`NEW PARK`, `HOW TO PLAY`) visible. Click once to satisfy the audio-gesture, assert it decodes without error. |
| `proof/gameplay.png` | `newPark`; `devGrant(9000)`; script a lively park — `layPath` a plaza spine + branches, `place` at least a carousel + coaster + a food + a drink + a restroom (entrances on path), sprinkle `scenery`, `hire` a janitor + a mechanic; `spawnGuests(60)`; let the sim run until guests fan across the paths (queue formed at a ride, a stall serving with steam, a ride running with sparkle) and the HUD reads live vitals; screenshot the full 1280×720 stage — busy paths (produced guest anim), animating ride + steam/sparkle, scenery, and the full top+bottom HUD. |
| `proof/game-over.png` | `newPark`; build a thin, overpriced park; `devGrant(-1900)`; suppress arrivals / raise costs so cash sits below the floor; run past `GRACE_SECONDS` until `state==="gameover"`; screenshot the park-closed screen with **days operated** shown. |
| `proof/systems.webm` | Record `recordVideo` 1280×720. `newPark`; `devGrant(9000)`; build a park with a coaster (higher breakdown), a food stall, a queue-drawing layout, a janitor + a mechanic; `spawnGuests`; then over a few seconds: guests enter and path to the ride, a **queue forms and the ride loads/runs/unloads**, a **stall sale** (coin cue), `breakRide()` then the **mechanic pathfinds over and repairs** it, and `litter()` then the **janitor clears it** (cleanup puff). ~7–8 s. |
| `proof/downturn.webm` | Record. `newPark`; build a modest park, then drive the **downturn**: `setPrice` everything far above value (and/or `breakRide` + pile `litter`), so happiness and the rating visibly fall, `arrivalRateFor` drops the stream, cash bleeds red, and — ideally — it reaches bankruptcy. Let the produced audio (alarm on low cash / broken ride, music bed) play so it is captured. ~7–8 s. |

`proof.mjs` also runs **functional assertions** (like valence's): a guest actually
queues+rides+pays, a stall sale credits cash, a breakdown+repair completes, a janitor
lowers a tile's litter, raising prices lowers rating and arrivals, and the bankruptcy
end state is reachable — exits non-zero (`PROBLEMS DETECTED`) if any fails or any
console error occurred, so the reference is self-verifying.

---

## 8. Build, config, and packaging (mirror valence exactly)

- `package.json`: `type: module`; scripts `dev` (`vite --host`), `build`
  (`tsc --noEmit && vite build`), `preview`; deps `@test-cabinet/particle-runtime`
  (the seeded `file:` dep — vendored under `vendor/` so a plain `npm ci` resolves it),
  devDeps `playwright`, `typescript`, `vite`. **Commit `package-lock.json`** (`npm ci`
  requires it).
- `vite.config.ts`: `base: "./"`, `build.outDir: "dist"` — every emitted URL
  page-relative, so `dist/` runs under any sub-path.
- `index.html`: a single `<canvas id="stage">`, `image-rendering: pixelated`, module
  script `src/main.ts`, `COL.void` page background.
- `tsconfig.json`: strict, ES2020, bundler resolution — copy valence's.
- `README.md`: what the game is, install/dev/build/preview, the controls, the refund
  and restroom-fee choices, and the produced-assets note (`specs/assets.md`).
- `npm ci && npm run build` must emit the complete static site into `dist/` with
  `index.html` at its root and **no** invocation of the asset tools (assets are
  pre-committed).
