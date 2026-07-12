// Midway — fixed constants: the stage, palette, park geometry, the ride/stall/scenery/
// staff CATALOGS, and the TUNE tuning table. Every number the specs pin (or leave to the
// author) lives here in one place, so the simulation reads exactly as written
// (specs/overview.md, specs/park.md, specs/guests.md, specs/rides.md, specs/economy.md,
// specs/flow.md) and one edit re-tunes the whole game. No logic beyond the tiny stat
// derivations the catalogs need.
//
// The model: a top-down park is a grid of TILES; the player lays PATH, places ATTRACTIONS
// (rides + stalls) and SCENERY on the grass, and hires STAFF. GUESTS arrive at the gate
// driven by DESIRES, spend from a wallet, and leave a review that moves the park RATING —
// which in turn sets the ARRIVAL RATE. That feedback loop is the game (specs/overview.md).

// ---- Stage & bands (specs/overview.md) -----------------------------------------
export const STAGE_W = 1280;
export const STAGE_H = 720;

export const TOP_HUD_H = 64; // top HUD: y in [0, 64], full width
export const BOTTOM_HUD_H = 64; // bottom HUD: y in [656, 720], full width
export const PARK_Y0 = TOP_HUD_H; // park view: y in [64, 656], full width, the camera
export const PARK_Y1 = STAGE_H - BOTTOM_HUD_H;

// ---- Park grid (specs/park.md — pinned) ----------------------------------------
export const TILE = 24; // one tile is 24 logical px (matches the produced 24x24 tiles)
export const COLS = 64;
export const ROWS = 44;
export const PLOT_W = COLS * TILE; // 1536
export const PLOT_H = ROWS * TILE; // 1056

// Camera zoom bounds (specs/controls.md — wheel zoom keeps the strips fixed).
export const ZOOM_MIN = 0.75;
export const ZOOM_MAX = 1.5;

// Fixed simulation timestep (specs/controls.md — a fixed tick; render interpolates).
// 10 ticks/s at 1x; the speed control (1|2|3) scales ticks/s.
export const FIXED_STEP = 0.1;

// ---- Palette (specs/overview.md — the canonical table) -------------------------
export const COL = {
  grass: "#4f8f4a",
  grassDark: "#2f7d3a", // dark tuft / foliage
  path: "#cdae7d",
  pathEdge: "#b2925f",
  water: "#37a0c4",
  waterHi: "#45c6f0",
  structure: "#8b93a7", // ride structure / track
  structureDark: "#6d7789", // tertiary / dark structure
  roof: "#e0603c", // stall / building roof
  foliage: "#2f7d3a",
  cash: "#5fce6e",
  cashDown: "#ff5a52",
  rating: "#ffcb52", // reputation / stars
  happiness: "#ffd24a", // happiness / mood
  thrill: "#c46bff",
  hunger: "#f59042", // hunger / food
  thirst: "#45c6f0", // thirst / drink
  guest: "#ff8fb0",
  alert: "#ff5a52", // alert / danger
  void: "#0f1626", // background / void (letterbox)
  panel: "#16202f", // panels / overlays
  text: "#f2efe8", // primary text
  text2: "#aeb6c6", // secondary text
  text3: "#6d7789", // tertiary text / hints
} as const;

export const FONT = `"SF Mono", "JetBrains Mono", "Fira Mono", "DejaVu Sans Mono", "Menlo", "Consolas", monospace`;

// ---- Kind enums (the catalog keys; runtime entity types live in types.ts) ------
export type TileKind = "grass" | "water" | "fence" | "gate" | "path";
export type RideKind = "carousel" | "coaster" | "drop_tower";
export type StallKind = "food" | "drink" | "souvenir" | "restroom";
export type SceneryKind = "tree" | "flowerbed" | "bench" | "lamp" | "fountain";
export type StaffKind = "janitor" | "mechanic" | "entertainer";
export type ToolKind = "path" | "build" | "staff" | "price" | "demolish";

// A guest's five decaying/reserve needs (specs/guests.md). thrill/hunger/thirst/bladder
// are 0..100 NEEDS (rise over time, satisfied by an attraction); energy is a 0..100
// RESERVE that falls with walking and is restored at a bench.
export type DesireKey = "thrill" | "hunger" | "thirst" | "bladder" | "energy";

// What a stall satisfies. Food/drink/restroom meet a decaying DESIRE; a souvenir is a
// happy-impulse WANT, not a desire bar — so the stall serve type is wider than DesireKey
// (specs/guests.md, ASSETS.md stall rows).
export type StallServe = DesireKey | "souvenir";

export const RIDE_ORDER: RideKind[] = ["carousel", "coaster", "drop_tower"];
export const STALL_ORDER: StallKind[] = ["food", "drink", "souvenir", "restroom"];
export const SCENERY_ORDER: SceneryKind[] = ["tree", "flowerbed", "bench", "lamp", "fountain"];
export const STAFF_ORDER: StaffKind[] = ["janitor", "mechanic", "entertainer"];
export const TOOL_ORDER: ToolKind[] = ["path", "build", "staff", "price", "demolish"];

// ---- Ride catalog (specs/rides.md; footprints from ASSETS.md) ------------------
// Per-completed-run breakdown accrual (scaled by time-since-inspect in the sim). A ride
// breaks when its accumulator crosses 1.0, so these set the runs-between-breakdowns.
const BREAKDOWN = { low: 0.04, med: 0.08, high: 0.13 } as const;

export interface RideDef {
  kind: RideKind;
  label: string;
  sprite: string; // produced static-body sprite (assets/rides/<kind>.png)
  anim: string; // produced motion-frame prefix (assets/ride/<kind>/N.png)
  animFrames: number;
  w: number; // footprint in tiles
  h: number;
  cost: number; // build cost
  upkeep: number; // per-day upkeep
  price: number; // default ticket price (player-settable)
  capacity: number; // guests per run
  rideDuration: number; // sim-seconds a run lasts
  thrill: number; // thrill satisfied / happiness bump on unload
  breakdownRate: number; // accrual per completed run
}

export const RIDES: Record<RideKind, RideDef> = {
  carousel: {
    kind: "carousel", label: "CAROUSEL", sprite: "rides/carousel", anim: "ride/carousel", animFrames: 6,
    w: 3, h: 3, cost: 800, upkeep: 30, price: 3, capacity: 8, rideDuration: 6, thrill: 20, breakdownRate: BREAKDOWN.low,
  },
  coaster: {
    kind: "coaster", label: "COASTER", sprite: "rides/coaster", anim: "ride/coaster", animFrames: 4,
    w: 4, h: 3, cost: 1500, upkeep: 45, price: 6, capacity: 4, rideDuration: 8, thrill: 55, breakdownRate: BREAKDOWN.high,
  },
  drop_tower: {
    kind: "drop_tower", label: "DROP TOWER", sprite: "rides/drop_tower", anim: "ride/drop_tower", animFrames: 6,
    w: 2, h: 2, cost: 1200, upkeep: 35, price: 5, capacity: 6, rideDuration: 5, thrill: 45, breakdownRate: BREAKDOWN.med,
  },
};

// ---- Stall catalog (specs/rides.md; all 48x24 -> 2x1 footprint) ----------------
export interface StallDef {
  kind: StallKind;
  label: string;
  sprite: string; // produced body sprite (assets/stalls/<kind>.png)
  serves: StallServe;
  w: number;
  h: number;
  cost: number;
  upkeep: number;
  price: number;
  steam: boolean; // vents a steam loop while serving (food/drink)
}

export const STALLS: Record<StallKind, StallDef> = {
  food: { kind: "food", label: "FOOD", sprite: "stalls/food", serves: "hunger", w: 2, h: 1, cost: 350, upkeep: 12, price: 5, steam: true },
  drink: { kind: "drink", label: "DRINK", sprite: "stalls/drink", serves: "thirst", w: 2, h: 1, cost: 300, upkeep: 12, price: 3, steam: true },
  souvenir: { kind: "souvenir", label: "SOUVENIR", sprite: "stalls/souvenir", serves: "souvenir", w: 2, h: 1, cost: 300, upkeep: 10, price: 8, steam: false },
  restroom: { kind: "restroom", label: "RESTROOM", sprite: "stalls/restroom", serves: "bladder", w: 2, h: 1, cost: 250, upkeep: 8, price: 1, steam: false },
};

// ---- Scenery catalog (specs/park.md — raises nearby path appeal) ---------------
export interface SceneryDef {
  kind: SceneryKind;
  label: string;
  sprite: string; // produced sprite (assets/scenery/<kind>.png)
  w: number;
  h: number;
  cost: number;
  appeal: number; // 0..1 appeal contributed at the source tile
  radius: number; // tiles the appeal reaches (linear falloff)
  rest: boolean; // a bench also restores a tired guest's energy
}

export const SCENERY: Record<SceneryKind, SceneryDef> = {
  tree: { kind: "tree", label: "TREE", sprite: "scenery/tree", w: 1, h: 1, cost: 40, appeal: 0.25, radius: 3, rest: false },
  flowerbed: { kind: "flowerbed", label: "FLOWERBED", sprite: "scenery/flowerbed", w: 1, h: 1, cost: 30, appeal: 0.2, radius: 3, rest: false },
  bench: { kind: "bench", label: "BENCH", sprite: "scenery/bench", w: 1, h: 1, cost: 60, appeal: 0.15, radius: 2, rest: true },
  lamp: { kind: "lamp", label: "LAMP", sprite: "scenery/lamp", w: 1, h: 1, cost: 50, appeal: 0.15, radius: 3, rest: false },
  fountain: { kind: "fountain", label: "FOUNTAIN", sprite: "scenery/fountain", w: 2, h: 2, cost: 200, appeal: 0.5, radius: 4, rest: false },
};

// ---- Staff catalog (specs/staff.md) --------------------------------------------
export interface StaffDef {
  kind: StaffKind;
  label: string;
  sprite: string; // produced 4-frame walk prefix (assets/staff/<kind>/N.png)
  wage: number; // per-day wage
}

export const STAFF: Record<StaffKind, StaffDef> = {
  janitor: { kind: "janitor", label: "JANITOR", sprite: "staff/janitor", wage: 40 },
  mechanic: { kind: "mechanic", label: "MECHANIC", sprite: "staff/mechanic", wage: 60 },
  entertainer: { kind: "entertainer", label: "ENTERTAINER", sprite: "staff/entertainer", wage: 45 },
};

// ---- Tuning table (specs/§4 of DESIGN.md; each number the specs leave to the author) --
// Grouped so one edit re-tunes; the balance harness (sim/) is tuned against these.
export const TUNE = {
  fixedStep: FIXED_STEP, // 0.1 sim-seconds per tick
  daySeconds: 60, // sim-seconds per day; upkeep + wages charged once per day

  economy: {
    startCash: 4000, // opening balance (a starting loan); mirrored in MODE.startCash
    bankruptcyFloor: -2000, // cash below this starts the grace timer
    graceSeconds: 20, // sustained-below-floor seconds before the park closes
    pathCost: 5, // per path tile laid
    demolishRefund: 0.5, // fraction of build cost refunded on demolish
    repairFee: 40, // per completed mechanic repair
    admission: 8, // default gate admission price (player-settable)
  },

  guests: {
    walletMin: 20, // starting wallet range (rng)
    walletMax: 40,
    // desire GROWTH per day (thrill/hunger/thirst/bladder rise; energy handled separately)
    desireGrowth: { thrill: 9, hunger: 7, thirst: 8, bladder: 6 } as Record<Exclude<DesireKey, "energy">, number>,
    thirstAfterRide: { amount: 4, seconds: 20 }, // extra thirst for a while after a ride
    bladderAfterDrink: { amount: 6, seconds: 30 }, // extra bladder for a while after a drink
    energyPerTile: 1.5, // energy lost per tile walked
    benchRestore: 90, // energy a bench rest restores toward
    startHappiness: 70, // happiness a guest enters with
    leaveAngryBelow: 20, // happiness under which a guest storms out
    contentWalletBelow: 6, // wallet under which a satisfied guest heads home content
    queueBalkBase: 4, // will not join a queue longer than base + happiness*perHappy
    queueBalkPerHappy: 1 / 12,
    patience: 30, // sim-seconds waiting in a line before bailing (losing happiness)
    speed: 34, // move speed (logical px/sim-second)
    saleReduce: 60, // a stall sale drops the served need by this
    // happiness deltas (per sim-second unless noted)
    rideHappyBase: 8, // gained on ride unload, + thrill*rideHappyPerThrill
    rideHappyPerThrill: 0.2,
    buyHappy: 5, // gained on a stall purchase (one-off)
    restHappy: 6, // per second resting on a bench
    litterPenalty: 3, // per second standing on a fully-littered path tile (scaled by litter)
    appealBonus: 2, // per second on a fully-appealing tile (scaled by appeal)
    queueWaitPenalty: 1.5, // per second still queued past patience
    entertainerBoost: 6, // per second within an entertainer's radius
    overpricePenalty: 8, // one-off when balking a too-pricey target
    reviewSpan: 40, // review = happiness centered on this (feeds the rating)
  },

  rides: {
    loadTime: 1.5, // sim-seconds to load a run
    repairTime: 6, // mechanic on-site seconds to fix a broken ride
    breakThreshold: 1.0, // breakdownAccum crosses this -> broken
    inspectAgeScale: 120, // accrual x (1 + timeSinceInspect / inspectAgeScale)
    inspectShave: 0.35, // fraction of accrued breakdown a patrol inspection removes
  },

  stalls: {
    serveTime: 2, // sim-seconds per sale
    litterAdd: 0.15, // litter added to nearby path tiles per sale
    litterTilesMin: 2, // sale litters 2..3 nearby path tiles
    litterTilesMax: 3,
  },

  staff: {
    janitorClearTime: 1.2, // seconds to clear a litter tile (throws a cleanup puff)
    entertainerRadius: 72, // mood-aura radius (logical px)
  },

  rating: {
    wHappy: 0.6, // ratingTarget = wHappy*avgHappiness + wClean*cleanliness + wVariety*(variety*reliability)/100
    wClean: 0.22,
    wVariety: 0.18,
    ease: 8, // rating eases toward target at ~8 per day
    // variety by distinct connected ride kinds: 0,1,2,3+ -> ladder
    varietyLadder: [30, 60, 85, 100],
    arrivalMin: 0.4, // guests/day at the low rating anchor
    arrivalMax: 24, // guests/day at the high rating anchor
    ratingLo: 20, // low arrival anchor
    ratingHi: 95, // high arrival anchor
    arrivalCutoff: 12, // no arrivals below this rating
    concurrentCap: 220, // max guests in the park at once
  },

  milestones: {
    guestCount: 50, // "50 guests at once" milestone (fires fireworks)
    days: [100, 200], // day-count milestones
  },

  camera: {
    zoomMin: ZOOM_MIN,
    zoomMax: ZOOM_MAX,
    zoomDefault: 1.0,
  },
};
