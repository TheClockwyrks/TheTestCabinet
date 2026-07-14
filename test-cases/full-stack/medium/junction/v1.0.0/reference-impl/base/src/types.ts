// Junction — the shared runtime data model (DESIGN §2).
//
// The world is a STRUCT-OF-ARRAYS tile grid: dense typed arrays indexed by
// `idx = row * MAP_COLS + col` for the per-tile fields the sim sweeps every tick, plus a
// handful of object lists for placed sources and moving agents. This file is the contract
// every later module (world / graph / transit / utilities / economy / develop / sim /
// render) depends on, so it imports nothing — the enums and small unions live here and the
// tuning tables in `constants.ts` key off them.

// ---- Enums and small unions (DESIGN §2.1) --------------------------------------
export type Terrain = "earth" | "grass" | "water" | "hill"; // specs/map.md
export type ZoneKind = "res" | "com" | "ind"; // specs/map.md
export type NetKind = "road" | "rail" | "wire" | "pipe"; // per-tile carriers
export type Tier = 0 | 1 | 2 | 3; // 0 = empty lot, 1 low / 2 med / 3 high (specs/map.md)

export type Tool =
  | "zoneRes"
  | "zoneCom"
  | "zoneInd"
  | "road"
  | "rail"
  | "station"
  | "plant"
  | "wire"
  | "source"
  | "pipe"
  | "bulldoze"; // specs/controls.md

export type GameState = "title" | "howto" | "playing" | "paused" | "bankrupt";
export type Overlay = "none" | "traffic" | "utility" | "landvalue"; // specs/controls.md
export type VehicleKind = "car" | "truck" | "tram";
export type Cue = "build" | "chime" | "alert"; // produced audio events
export type FxKind = "haze" | "dust" | "fireworks"; // produced particle systems

// ---- Object lists on the World / Game (DESIGN §2.3) ----------------------------

// A power plant or water source: a 2×2 footprint anchored at its top-left tile, feeding one
// connected component of its carrier with a fixed capacity.
export interface Source {
  id: number;
  kind: "plant" | "source";
  col: number;
  row: number; // top-left tile
  capacity: number; // POWER_PLANT_CAP / WATER_SOURCE_CAP
  supplied: number; // demand actually met this tick (for the over-draw read)
  net: number; // connected-component id it feeds
}

// A visible agent on the network (specs/transit.md). Renders interpolated along `path`.
export interface Vehicle {
  id: number;
  kind: VehicleKind;
  path: number[]; // tile indices, origin → destination
  seg: number; // current segment index into `path`
  t: number; // 0..1 along the current segment (interpolated render)
  speed: number; // px/s, scaled down by the congestion on its tile
  angle: number; // heading, for sprite rotation
  animT: number; // seconds alive (drives the tram sheet)
}

// A milestone fires exactly once (fireworks one-shot + chime), specs/flow.md.
export interface Milestone {
  id: string;
  label: string;
}

// A brief, non-blocking HUD toast (specs/flow.md).
export interface Notification {
  text: string;
  age: number; // seconds shown so far
  ttl: number; // seconds to live
  tone: "info" | "good" | "alert";
}

// An animated traffic signal at a road junction.
export interface Signal {
  col: number;
  row: number;
  phase: number; // 0..1 cycle position (drives the 4-frame signal sheet)
}

// ---- Aggregate / economy state (DESIGN §2.4) -----------------------------------

// RCI demand, −100..+100 (d = industrial demand).
export interface Rci {
  r: number;
  c: number;
  d: number;
}

export interface Budget {
  treasury: number; // $ (may be negative, down to DEBT_LIMIT)
  income: number; // last settled period, $/month
  upkeep: number; // last settled period, $/month
  balance: number; // income − upkeep
  taxRate: number; // TAX_DEFAULT.., set by the player
}

export interface GameStats {
  population: number;
  jobs: number;
  shops: number;
  peakPopulation: number;
  power: { supply: number; demand: number }; // top-strip balance + shortfall flag
  water: { supply: number; demand: number };
  monthsSurvived: number; // whole budget periods elapsed
}

// The in-game clock (HUD renders `MMM YYYY`).
export interface Clock {
  month: number; // 0..11
  year: number;
}

// ---- Presentation intents (queues drained by main.ts, DESIGN §2.5) -------------

// A particle event queued by the sim for the renderer to spawn — never touched by the sim
// directly (it owns no canvas). `strength` scales the burst / haze intensity.
export interface FxEvent {
  kind: FxKind;
  x: number;
  y: number;
  strength: number;
}

// A HUD hit-target returned by the renderer for the input layer to test against.
export interface Clickable {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
  payload?: string;
  disabled?: boolean;
}
