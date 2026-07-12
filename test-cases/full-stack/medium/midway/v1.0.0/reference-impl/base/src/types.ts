// Midway — the core data model (DESIGN.md §3). Every runtime entity the simulation and
// the renderer share. No logic, only types. Positions are in LOGICAL pixels (world space,
// one tile = TILE px); tile coordinates are {col,row} integers. The catalog KEY enums
// (TileKind, RideKind, ...) live in constants.ts; the runtime entity shapes live here.

import type {
  DesireKey,
  RideKind,
  SceneryKind,
  StaffKind,
  StallKind,
  StallServe,
  TileKind,
} from "./constants";

// ---- Grid & world --------------------------------------------------------------
export interface Tile {
  kind: TileKind;
  litter: number; // 0..1, path tiles only; raised by guests, cleared by janitors
  appeal: number; // 0..1, derived each rebuild from nearby scenery (park.md)
  connected: boolean; // path tile reachable from the gate (flood from gate)
  occupantId: number; // attraction/scenery id occupying this tile, or -1
  region: number; // path-graph connected-component id (for fast reachability)
}

export interface Cell {
  col: number;
  row: number;
}

export interface Camera {
  x: number; // top-left world px
  y: number;
  zoom: number; // ZOOM_MIN..ZOOM_MAX
}

export interface World {
  cols: number;
  rows: number; // COLS x ROWS (64 x 44)
  tiles: Tile[]; // row-major, length cols*rows
  gate: Cell; // the single entrance in the fence
  plaza: Cell[]; // pre-laid plaza path tiles at the gate
  camera: Camera;
}

// ---- Attractions (rides + stalls share the shape) ------------------------------
export type AttractionCategory = "ride" | "stall";
export type RideState = "idle" | "loading" | "running" | "unloading" | "broken";

export interface Attraction {
  id: number;
  category: AttractionCategory;
  kind: RideKind | StallKind; // catalog key
  col: number; // footprint top-left
  row: number;
  w: number; // footprint in tiles
  h: number;
  entrance: Cell; // the queue tile; must be path-adjacent
  connected: boolean; // entrance touches a gate-connected path
  price: number; // player-set ticket / sale price
  upkeep: number; // per-day cost (from catalog)
  // rides:
  capacity: number;
  rideDuration: number;
  thrill: number; // from catalog
  state: RideState;
  runTimer: number;
  loadTimer: number;
  riders: number[]; // guest ids aboard
  queue: number[]; // guest ids waiting, front = index 0
  breakdownAccum: number; // rises as it runs; > threshold -> break
  brokenTimer: number;
  inspectTimer: number; // seconds since last mechanic inspection
  // stalls:
  serves: StallServe; // hunger | thirst | souvenir(want) | bladder
  sellTimer: number;
  steam: boolean; // vents a steam loop while serving (food/drink)
  // shared bookkeeping:
  takings: number; // lifetime takings
  takingsWindow: number[]; // rolling recent takings for the panel
  animT: number; // ride animation phase (frozen when not running)
}

// ---- Guests (the signature system, guests.md) ----------------------------------
export type GuestState =
  | "entering"
  | "wandering"
  | "walking"
  | "queuing"
  | "riding"
  | "buying"
  | "resting"
  | "leaving";
export type GuestMood = "walk" | "happy" | "angry" | "eating"; // animation set
export type GuestTargetKind = "ride" | "stall" | "bench" | "gate" | "none";

export interface Guest {
  id: number;
  x: number; // world px (continuous, interpolated in render)
  y: number;
  tile: Cell;
  path: Cell[]; // current route
  pathIdx: number;
  speed: number; // px/sim-second
  facing: 1 | -1; // sprite flip
  desires: Record<DesireKey, number>; // thrill/hunger/thirst/bladder 0..100 (need),
  // energy 0..100 (reserve, falls with walking)
  thirstBoostTimer: number; // extra-thirst window after a ride
  bladderBoostTimer: number; // extra-bladder window after a drink
  wallet: number;
  happiness: number; // 0..100, the value everything moves
  admissionPaid: boolean;
  state: GuestState;
  mood: GuestMood; // which produced sheet
  animT: number; // frame timer
  targetId: number; // attraction id, or -1 for gate/bench/wander
  targetKind: GuestTargetKind;
  waitTimer: number; // seconds in the current queue (patience)
  actTimer: number; // riding/buying/resting countdown
  reviewGiven: boolean;
}

// ---- Staff (staff.md) ----------------------------------------------------------
export type StaffState = "idle" | "walking" | "working";
export interface StaffZone {
  col: number;
  row: number;
  w: number;
  h: number;
}
export interface Staff {
  id: number;
  kind: StaffKind; // janitor | mechanic | entertainer
  x: number;
  y: number;
  tile: Cell;
  path: Cell[];
  pathIdx: number;
  speed: number;
  facing: 1 | -1;
  state: StaffState;
  workTimer: number;
  targetId: number; // ride to repair / tile index to clean / -1
  zone: StaffZone | null; // null = roam
  wage: number;
  animT: number;
}

// ---- Scenery -------------------------------------------------------------------
export interface Scenery {
  id: number;
  kind: SceneryKind;
  col: number;
  row: number;
  w: number;
  h: number;
}

// ---- Economy -------------------------------------------------------------------
export interface Ledger {
  cash: number;
  dayIncome: number; // accumulating this day
  dayExpense: number;
  incomeRate: number; // last full day's rates (for the HUD trend)
  expenseRate: number;
  totalProfit: number;
  belowFloorTimer: number; // seconds under BANKRUPTCY_FLOOR
}

// ---- Events, state, UI ---------------------------------------------------------
export type FxKind = "fireworks" | "steam" | "sparkle" | "cleanup";
export interface FxEvent {
  kind: FxKind;
  x: number;
  y: number;
}
export type Cue = "coin" | "ding" | "alarm" | "crowd" | "music";

// A transient non-blocking on-screen notice (milestones, warnings).
export interface Notification {
  text: string;
  ttl: number; // sim-seconds remaining
  good: boolean; // milestone (good) vs warning
}

export type GameState = "title" | "howto" | "playing" | "paused" | "gameover";
export type SpeedSetting = 1 | 2 | 3;

// The active build/edit tool and its sub-selection.
export interface Tool {
  kind: import("./constants").ToolKind;
  buildRide: RideKind | null; // when placing a ride via Build
  buildStall: StallKind | null; // when placing a stall via Build
  buildScenery: SceneryKind | null; // when placing scenery via Build
  staffKind: StaffKind | null; // when hiring via Staff
}

export interface Clickable {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
  payload?: string;
  disabled?: boolean;
}
