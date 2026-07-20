// Locomotivation — shared data types for the yard, cargo, trains, and levels.
//
// These describe the LEVEL DATA (authored in `levels.ts`, tuned by the Balance phase)
// and the runtime sim entities. They are rendering-free: the core sim (src/sim/*) and a
// headless harness both build on these; `render.ts`/`hud.ts` read them but the types
// carry no canvas/DOM references.

// ─── Tiles (specs/world.md) ────────────────────────────────────────────────────────

/** The tile kinds a level's terrain grid is built from. */
export type TileKind =
  | "ground" // safe gravel/grass floor (default)
  | "track" // a rail lane — safe except when a train overlaps it
  | "bridge" // a track that is the only crossing over a gap
  | "refuge" // a safe pocket a train never enters
  | "wall" // impassable scenery
  | "gap"; // impassable void/water

/** Orientation of a track/bridge lane. */
export type Orientation = "horizontal" | "vertical";

// ─── Cargo (specs/cargo.md) ────────────────────────────────────────────────────────

export type FreightColor = "red" | "blue" | "green" | "amber";

/** Weight class → its weight is resolved from constants (Parcel 30 / Crate 55 / Load 80). */
export type WeightClass = "parcel" | "crate" | "load";

/** What happens when a package is lost decides its archetype. */
export type PackageArchetype =
  | "unique" // one-of-a-kind, required; loss FAILS the level
  | "dispenser" // replenishing quota source
  | "optional"; // score only

/** A tile coordinate in grid space. */
export interface TileCoord {
  col: number;
  row: number;
}

/** A dispenser station: emits packages of one color+class, drives a quota of `count`. */
export interface DispenserDef {
  id: string;
  at: TileCoord;
  color: FreightColor;
  weight: WeightClass;
  /** How many of this color must be delivered to satisfy this dispenser's quota. */
  quota: number;
}

/** A color-matched delivery pad. */
export interface DropZoneDef {
  id: string;
  at: TileCoord;
  color: FreightColor;
}

/** A fixed unique-package spawn (loss fails the level). */
export interface UniquePackageDef {
  id: string;
  at: TileCoord;
  color: FreightColor;
  weight: WeightClass;
}

/** A fixed optional (score-only) package spawn. */
export interface OptionalPackageDef {
  id: string;
  at: TileCoord;
  color: FreightColor;
  weight: WeightClass;
}

// ─── Trains (specs/trains.md) ──────────────────────────────────────────────────────

export type TrainKind = "freight" | "commuter" | "bullet";

/** Travel direction along a lane. Horizontal lanes use "east"/"west"; vertical use
 *  "south"/"north". */
export type TrainDir = "east" | "west" | "south" | "north";

/** A scheduled train lane: trains enter at `phase + n*period` and run end to end. */
export interface TrackDef {
  id: string;
  orientation: Orientation;
  /** The fixed row (horizontal) or column (vertical) the lane runs along. */
  line: number;
  kind: TrainKind;
  dir: TrainDir;
  /** Seconds between successive trains entering the level edge. */
  period: number;
  /** Seconds before the first train enters. */
  phase: number;
  /** Optional siding line the lever diverts subsequent trains onto (specs/trains.md). */
  sidingLine?: number;
  /** The lever that controls this track's routing, if any. */
  leverId?: string;
}

/** A junction lever that flips which branch subsequent trains on `trackId` take. */
export interface LeverDef {
  id: string;
  at: TileCoord;
  trackId: string;
}

/** A crossing signal beside a track (telegraphs the approaching train). */
export interface SignalDef {
  id: string;
  at: TileCoord;
  trackId: string;
}

/** The three telegraph states a crossing signal shows (specs/trains.md). */
export type SignalState = "clear" | "warning" | "danger";

// ─── Last train (specs/trains.md) ──────────────────────────────────────────────────

/** A rideable/lethal car in the last-train consist, front-to-back. */
export type LastTrainCar =
  | "engine" // lethal
  | "boxcar" // lethal
  | "flat-top" // rideable (regular length)
  | "flat-top-half"; // rideable (half length)

/** The optional derived last-train capstone (specs/trains.md, specs/flow.md). */
export interface LastTrainDef {
  /** The track lane the last train runs on (its `line` and `orientation`). */
  orientation: Orientation;
  line: number;
  dir: TrainDir;
  kind: TrainKind; // decides its speed
  /** Consist, front (leading edge) to back. */
  consist: LastTrainCar[];
}

// ─── Level (specs/levels.md) ───────────────────────────────────────────────────────

/** A required-quota entry the HUD tracks (derived from dispensers + uniques). */
export interface QuotaLine {
  color: FreightColor;
  /** Total required deliveries of this color (dispenser quota + unique count). */
  required: number;
}

/** A whole level as DATA — the Balance phase edits this array in `levels.ts`. */
export interface LevelDef {
  id: number;
  name: string;
  /** `GRID_ROWS` strings of `GRID_COLS` chars each, using the terrain legend. */
  terrain: string[];
  spawn: TileCoord;
  dispensers: DispenserDef[];
  dropZones: DropZoneDef[];
  uniques: UniquePackageDef[];
  optionals: OptionalPackageDef[];
  tracks: TrackDef[];
  levers: LeverDef[];
  signals: SignalDef[];
  refuges: TileCoord[];
  /** Shift clock in seconds. */
  clock: number;
  /** Always 3 (specs/flow.md), kept as data for tuning symmetry. */
  lives: number;
  /** The required quota (dispenser counts + unique deliveries), per color. */
  quota: QuotaLine[];
  /** The optional derived last-train capstone, if this level offers one. */
  lastTrain?: LastTrainDef;
}
