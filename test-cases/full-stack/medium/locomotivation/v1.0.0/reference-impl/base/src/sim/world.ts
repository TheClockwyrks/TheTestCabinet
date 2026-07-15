// Locomotivation — the rendering-free CORE SIMULATION model (specs/controls.md).
//
// This module owns the simulation STATE and its construction, plus the pure geometry
// helpers the stepper uses. It has NO canvas, DOM, or wall-clock dependency: the game
// and the Balance phase's headless harness both build a `SimState` here and advance it
// with `stepSim` (see `./step.ts`) on the fixed timestep, deterministically. Nothing in
// this file reads the clock or draws anything.

import {
  BULLET_LEN,
  BULLET_SPEED,
  COMMUTER_LEN,
  COMMUTER_SPEED,
  DISPENSER_REFILL,
  FREIGHT_LEN,
  FREIGHT_SPEED,
  SPRINT_MAX,
  TILE,
  VIEW_Y,
  WEIGHT_CRATE,
  WEIGHT_LOAD,
  WEIGHT_PARCEL,
} from "../constants";
import type {
  FreightColor,
  LastTrainCar,
  LevelDef,
  Orientation,
  PackageArchetype,
  TileCoord,
  TileKind,
  TrainDir,
  TrainKind,
  WeightClass,
} from "../types";

// ─── Small value types ──────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export type Facing = "down" | "up" | "left" | "right";

/** The worker's current animation cycle (selected from state; facing chosen separately). */
export type WorkerAnim = "idle" | "walk" | "sprint" | "carry" | "drop" | "squish";

/** High-level lifecycle of a single shift. */
export type SimPhase =
  | "playing" // the live shift
  | "dying" // brief squish beat before respawn
  | "respawning" // waiting out RESPAWN_DELAY
  | "won" // quota met (or last train boarded) — level complete
  | "lost" // a fail condition tripped
  | "boarding"; // rode the last train off-screen (a win variant, still animating)

/** Which fail condition ended the shift (specs/flow.md). */
export type FailReason = "out-of-time" | "out-of-lives" | "unique-lost";

// ─── Cargo instances ────────────────────────────────────────────────────────────────

/** A concrete package the worker can carry / that can rest in the world. */
export interface PackageInstance {
  id: string;
  color: FreightColor;
  weightClass: WeightClass;
  archetype: PackageArchetype;
  /** Def id it came from (unique/optional def, or the dispenser id). */
  originId: string;
}

/** A package resting on a tile in the world (a fixed unique/optional, or a dropped one). */
export interface GroundPackage {
  pkg: PackageInstance;
  at: TileCoord;
  pos: Vec2;
}

/** Numeric weight of a class in carry-capacity units. */
export function weightOf(cls: WeightClass): number {
  switch (cls) {
    case "parcel":
      return WEIGHT_PARCEL;
    case "crate":
      return WEIGHT_CRATE;
    case "load":
      return WEIGHT_LOAD;
  }
}

// ─── Trains ─────────────────────────────────────────────────────────────────────────

/** A live train on a track. Positions are along the lane's travel axis, in pixels. */
export interface TrainInstance {
  trackId: string;
  kind: TrainKind;
  orientation: Orientation;
  /** The live row (horizontal) or column (vertical) the body currently runs on. */
  line: number;
  dir: TrainDir;
  /** Leading-edge coordinate along the travel axis (px), monotonically advancing. */
  headPos: number;
  /** Body length along the axis (px). */
  length: number;
  /** Constant speed (px/s). */
  speed: number;
  /** nth train spawned on this track (0-based). */
  serial: number;
  /** True for the derived last train (rideable flat-tops; ends the level on board). */
  isLast?: boolean;
  /** The last train's explicit consist (front→back); present only when `isLast`. */
  consist?: LastTrainCar[];
  /** Set once the worker has been awarded a near-miss brush from this train. */
  nearMissed?: boolean;
}

// ─── Dispensers & levers (runtime) ──────────────────────────────────────────────────

export interface DispenserRuntime {
  ready: boolean;
  /** Seconds until a fresh package is ready after one is taken (0 when ready). */
  refillTimer: number;
}

export interface LeverRuntime {
  /** false = default branch, true = diverted to the siding. */
  thrown: boolean;
}

// ─── Worker ─────────────────────────────────────────────────────────────────────────

export interface WorkerState {
  pos: Vec2;
  facing: Facing;
  anim: WorkerAnim;
  /** Seconds spent in the current anim (drives frame selection in render). */
  animTime: number;
  /** Carried packages in pickup order; drop pops the last (most-recent). */
  carried: PackageInstance[];
  /** Remaining sprint charge in seconds, 0..SPRINT_MAX. */
  sprintCharge: number;
  sprinting: boolean;
  moving: boolean;
  /** Seconds remaining on the brief set-down "drop" animation beat (0 when idle). */
  dropTimer: number;
  /** Accumulates walked distance to pace footstep cues/dust (specs/assets.md). */
  footstepPhase: number;
}

// ─── Transient per-step events (the render/audio/particle bridge) ───────────────────
// The core sim emits these each step; `game.ts` drains them to fire produced VFX/audio.
// Keeping them as data is how the sim stays rendering-free.

export type SimEvent =
  | { type: "pickup"; pos: Vec2 }
  | { type: "denied"; pos: Vec2 }
  | { type: "deliver"; color: FreightColor; pos: Vec2 }
  | { type: "drop"; pos: Vec2 }
  | { type: "cargo-destroyed"; pos: Vec2 }
  | { type: "death"; pos: Vec2 }
  | { type: "near-miss"; pos: Vec2 }
  | { type: "board"; pos: Vec2 }
  | { type: "lever"; leverId: string; pos: Vec2 }
  | { type: "quota-complete" }
  | { type: "last-train"; pos: Vec2 }
  | { type: "footstep"; pos: Vec2 };

// ─── Input (one frame of intent) ────────────────────────────────────────────────────

export interface SimInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  /** Edge-triggered by the caller: true only on the step the key went down. */
  pickup: boolean;
  drop: boolean;
  interact: boolean;
}

/** A zero input (nothing held) — the neutral frame. */
export function noInput(): SimInput {
  return { up: false, down: false, left: false, right: false, sprint: false, pickup: false, drop: false, interact: false };
}

// ─── The whole simulation state ─────────────────────────────────────────────────────

/** Score component tallies (specs/flow.md scoring). */
export interface ScoreParts {
  required: number;
  optional: number;
  nearMiss: number;
  lastTrain: number;
  time: number;
  lives: number;
}

export interface SimState {
  level: LevelDef;
  /** Terrain classified as tiles[row][col]. */
  tiles: TileKind[][];
  /** Seconds of sim elapsed (deterministic; not wall-clock). */
  time: number;
  /** Shift clock remaining (seconds). */
  clock: number;
  lives: number;
  phase: SimPhase;
  failReason?: FailReason;
  worker: WorkerState;
  trains: TrainInstance[];
  ground: GroundPackage[];
  dispensers: Record<string, DispenserRuntime>;
  levers: Record<string, LeverRuntime>;
  /** Per-unique delivered / lost flags, keyed by unique def id. */
  uniquesDelivered: Record<string, boolean>;
  uniquesLost: Record<string, boolean>;
  /** Required deliveries counted toward the quota, per color. */
  delivered: Record<FreightColor, number>;
  optionalsDelivered: number;
  nearMisses: number;
  score: number;
  /** The score broken into its components, for the Level Complete breakdown (specs/flow.md). */
  scoreParts: ScoreParts;
  /** Countdown after a death before respawn (seconds). */
  respawnTimer: number;
  /** Next serial to spawn per track id (0-based scheduling counter). */
  trackSerial: Record<string, number>;
  /** True once the required quota is fully satisfied (may keep playing for a last train). */
  quotaMet: boolean;
  /** The derived last train's spawn time (seconds), computed lazily; undefined until known. */
  lastTrainSpawnTime?: number;
  /** True once the derived last train has been spawned for this shift. */
  lastTrainSpawned: boolean;
  /** The last train the worker has boarded (rides off-screen), if any. */
  boardedTrain: TrainInstance | null;
  /** Worker x/y offset from the boarded car's leading edge, frozen at board time. */
  boardOffset: Vec2;
  events: SimEvent[];
}

// ─── Geometry helpers (pure) ────────────────────────────────────────────────────────

const CHAR_TO_TILE: Record<string, TileKind> = {
  ".": "ground",
  "=": "track",
  "!": "track",
  B: "bridge",
  o: "refuge",
  "~": "gap",
  "#": "wall",
};

/** Parse a terrain grid (row strings) into a tiles[row][col] matrix. */
export function parseTerrain(terrain: string[]): TileKind[][] {
  return terrain.map((row, r) =>
    [...row].map((ch, c) => {
      const kind = CHAR_TO_TILE[ch];
      if (!kind) throw new Error(`Unknown terrain char "${ch}" at (${c},${r})`);
      return kind;
    }),
  );
}

/** Pixel center of a tile (col,row). */
export function tileCenter(coord: TileCoord): Vec2 {
  return { x: coord.col * TILE + TILE / 2, y: VIEW_Y + coord.row * TILE + TILE / 2 };
}

/** The tile column/row a pixel position falls in (may be out of bounds). */
export function tileAtPixel(pos: Vec2): TileCoord {
  return { col: Math.floor(pos.x / TILE), row: Math.floor((pos.y - VIEW_Y) / TILE) };
}

/** Tile kind at (col,row), or "wall" for out-of-bounds (bounds block the worker). */
export function tileKindAt(state: SimState, col: number, row: number): TileKind {
  if (row < 0 || row >= state.tiles.length || col < 0 || col >= state.tiles[0].length) return "wall";
  return state.tiles[row][col];
}

/** Whether a tile kind is walkable by the worker (specs/world.md). */
export function isWalkable(kind: TileKind): boolean {
  return kind === "ground" || kind === "track" || kind === "bridge" || kind === "refuge";
}

// ─── World construction ─────────────────────────────────────────────────────────────

const COLORS: FreightColor[] = ["red", "blue", "green", "amber"];

/**
 * Build the initial `SimState` for a level. Pure and deterministic: places the worker at
 * the spawn, lays out the fixed unique/optional packages as ground cargo, primes each
 * dispenser ready, sets levers to their default branch, and zeroes all progress. The
 * dynamic systems (movement, trains, collision, cargo, clock, win/fail) are advanced by
 * `stepSim` — this function only establishes t=0.
 */
export function buildWorld(level: LevelDef): SimState {
  const tiles = parseTerrain(level.terrain);

  const worker: WorkerState = {
    pos: tileCenter(level.spawn),
    facing: "down",
    anim: "idle",
    animTime: 0,
    carried: [],
    sprintCharge: SPRINT_MAX,
    sprinting: false,
    moving: false,
    dropTimer: 0,
    footstepPhase: 0,
  };

  const ground: GroundPackage[] = [];
  for (const u of level.uniques) {
    ground.push(makeGroundPackage(u.id, u.color, u.weight, "unique", u.id, u.at));
  }
  for (const o of level.optionals) {
    ground.push(makeGroundPackage(o.id, o.color, o.weight, "optional", o.id, o.at));
  }

  const dispensers: Record<string, DispenserRuntime> = {};
  for (const d of level.dispensers) dispensers[d.id] = { ready: true, refillTimer: 0 };

  const levers: Record<string, LeverRuntime> = {};
  for (const l of level.levers) levers[l.id] = { thrown: false };

  const uniquesDelivered: Record<string, boolean> = {};
  const uniquesLost: Record<string, boolean> = {};
  for (const u of level.uniques) {
    uniquesDelivered[u.id] = false;
    uniquesLost[u.id] = false;
  }

  const delivered = {} as Record<FreightColor, number>;
  for (const c of COLORS) delivered[c] = 0;

  const trackSerial: Record<string, number> = {};
  for (const t of level.tracks) trackSerial[t.id] = 0;

  return {
    level,
    tiles,
    time: 0,
    clock: level.clock,
    lives: level.lives,
    phase: "playing",
    worker,
    trains: [],
    ground,
    dispensers,
    levers,
    uniquesDelivered,
    uniquesLost,
    delivered,
    optionalsDelivered: 0,
    nearMisses: 0,
    score: 0,
    scoreParts: { required: 0, optional: 0, nearMiss: 0, lastTrain: 0, time: 0, lives: 0 },
    respawnTimer: 0,
    trackSerial,
    quotaMet: false,
    lastTrainSpawned: false,
    boardedTrain: null,
    boardOffset: { x: 0, y: 0 },
    events: [],
  };
}

function makeGroundPackage(
  id: string,
  color: FreightColor,
  weightClass: WeightClass,
  archetype: PackageArchetype,
  originId: string,
  at: TileCoord,
): GroundPackage {
  return { pkg: { id, color, weightClass, archetype, originId }, at, pos: tileCenter(at) };
}

/** Nominal length (px) of a scheduled train of `kind` (specs/trains.md). */
export function nominalTrainLength(kind: TrainKind): number {
  switch (kind) {
    case "freight":
      return FREIGHT_LEN;
    case "commuter":
      return COMMUTER_LEN;
    case "bullet":
      return BULLET_LEN;
  }
}

/** Nominal speed (px/s) of a kind (specs/trains.md). */
export function trainSpeed(kind: TrainKind): number {
  switch (kind) {
    case "freight":
      return FREIGHT_SPEED;
    case "commuter":
      return COMMUTER_SPEED;
    case "bullet":
      return BULLET_SPEED;
  }
}

/** Per-kind length (px) of ONE car in an explicit consist (the last train, specs/trains.md). */
export function carUnitLength(kind: TrainKind): number {
  switch (kind) {
    case "freight":
      return 80; // 2 tiles — chunky freight cars
    case "commuter":
      return 60;
    case "bullet":
      return 45;
  }
}

/** Length (px) of a single last-train car piece. Half-length flat-tops are half a unit. */
export function carPieceLength(kind: TrainKind, piece: LastTrainCar): number {
  const unit = carUnitLength(kind);
  return piece === "flat-top-half" ? unit / 2 : unit;
}

/** Total consist length (px) of a last train, summed over its car pieces. */
export function consistLength(kind: TrainKind, consist: LastTrainCar[]): number {
  return consist.reduce((sum, piece) => sum + carPieceLength(kind, piece), 0);
}

/** Axis a lane runs along, for readability at call sites. */
export function laneIsHorizontal(dir: TrainDir): boolean {
  return dir === "east" || dir === "west";
}

/** An axis-aligned box in logical-pixel stage space. */
export interface AABB {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Whether two AABBs overlap (touching edges count as overlap). */
export function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

/** Center-to-center along-axis pixel span of a lane's line coordinate. */
export function laneCenter(orientation: Orientation, line: number): number {
  return orientation === "horizontal" ? VIEW_Y + line * TILE + TILE / 2 : line * TILE + TILE / 2;
}

/** The worker's collision footprint box, centered on its feet. */
export function workerBox(pos: Vec2, halfW: number, halfH: number): AABB {
  return { x0: pos.x - halfW, y0: pos.y - halfH, x1: pos.x + halfW, y1: pos.y + halfH };
}

/**
 * The full body box of a train (all cars) for broad-phase tests and rendering. `headPos`
 * is the distance the leading edge has travelled from the entry edge.
 */
export function trainBody(t: TrainInstance, viewW: number, viewH: number, halfBand: number): AABB {
  if (t.orientation === "horizontal") {
    const cy = laneCenter("horizontal", t.line);
    if (t.dir === "east") {
      const head = t.headPos; // leading edge x (grows rightward)
      return { x0: head - t.length, y0: cy - halfBand, x1: head, y1: cy + halfBand };
    }
    const head = viewW - t.headPos; // leading edge x (moves leftward)
    return { x0: head, y0: cy - halfBand, x1: head + t.length, y1: cy + halfBand };
  }
  const cx = laneCenter("vertical", t.line);
  if (t.dir === "south") {
    const head = VIEW_Y + t.headPos;
    return { x0: cx - halfBand, y0: head - t.length, x1: cx + halfBand, y1: head };
  }
  const head = VIEW_Y + viewH - t.headPos;
  return { x0: cx - halfBand, y0: head, x1: cx + halfBand, y1: head + t.length };
}

/** The leading edge coordinate (x for horizontal, y for vertical) of a train. */
export function trainLeadingEdge(t: TrainInstance, viewW: number, viewH: number): number {
  if (t.orientation === "horizontal") return t.dir === "east" ? t.headPos : viewW - t.headPos;
  return t.dir === "south" ? VIEW_Y + t.headPos : VIEW_Y + viewH - t.headPos;
}

/** Sign of travel along the axis: +1 for east/south, −1 for west/north. */
export function travelSign(dir: TrainDir): number {
  return dir === "east" || dir === "south" ? 1 : -1;
}

/** Refill delay after a dispenser package is taken. */
export const DISPENSER_REFILL_SECONDS = DISPENSER_REFILL;
