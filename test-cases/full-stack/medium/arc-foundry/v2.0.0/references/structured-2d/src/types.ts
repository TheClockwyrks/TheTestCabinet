// Arc Foundry — the working shapes the simulation advances.
//
// Everything here is data: the records a step edits, and nothing else. There is no
// class, no method, and nothing that reaches outside itself. The state that HOLDS them
// is `FoundryState` in `src/state.ts`, the one live object the world carries; the
// arithmetic over these records lives in `src/sim.ts`, the grid and the pathing in
// `src/board.ts`, and the drawing in `src/render.ts`, so the simulation runs with no
// canvas, no clock, and no input — which is what lets a scenario advance it a counted
// number of steps and read the result.
//
// The geometric records are `readonly` throughout, because a route, a chain, a
// footprint, and a composed wave are BUILT rather than edited: a step replaces one
// wholesale rather than writing into it. The records a step does edit — a unit, a shot,
// a structure — carry plainly mutable fields, and a step writes them in place.
//
// The vocabulary — the eight base types, the twelve towers, the six Load types, the
// three maps, the eight screens — is `src/constants.ts`, and is not restated here.

import type {
  ComboId,
  ComponentType,
  EffectName,
  LoadType,
  TargetingPriority,
} from "./constants";

/**
 * A point on the stage, in logical units.
 *
 * Immutable, as every geometric record below is: a route, a chain, and a footprint are
 * BUILT rather than edited, so a frame replaces them wholesale and a copy of the world
 * can carry them across untouched.
 */
export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** A tile of the yard grid. */
export interface TileRef {
  readonly col: number;
  readonly row: number;
}

/**
 * What a tile is, for drawing and for placement.
 *
 * `open` is empty yard: the Load crosses it and a structure may stand on it. `blocked`
 * is a structure's footprint. `fixed` is a map's housing, which is impassable and never
 * buildable. `waypoint` is a tile of a waypoint platform, which is walkable and never
 * buildable.
 */
export type TileState = "open" | "blocked" | "fixed" | "waypoint";

// ---- Structures ----------------------------------------------------------

/** What every structure carries: an identity and the anchor of its footprint. */
export interface StructureBase {
  id: number;
  /** The top-left tile of the `FOOTPRINT` by `FOOTPRINT` block. */
  col: number;
  row: number;
}

/**
 * A permanent firing structure: a base component, or a combination tower.
 *
 * `combo` set makes it a tower, whose power axis is `comboLevel` rather than
 * `quality`; `quality` then holds `MAX_QUALITY` as a sentinel and drives nothing.
 */
export interface Component extends StructureBase {
  kind: "component";
  /** For a tower, the initiating ingredient's type, which tints the mount alone. */
  type: ComponentType;
  quality: number;
  combo?: ComboId;
  /** `0` through `COMBO_MAX_LEVEL` for a tower; `0` for a base component. */
  comboLevel: number;
  targeting: TargetingPriority;
  /** Seconds until it may fire again. */
  cooldown: number;
  /** Seconds since its last shot, which drives the firing cycle. */
  fireAnim: number;
  /** The head's heading, in radians. */
  aimAngle: number;
  kills: number;
  damageDealt: number;
  /** The summed external aura on it, recomputed whenever the yard changes. */
  auraBonus: number;
}

/** A rock placed this build phase, which has rolled a type and a quality. */
export interface Candidate extends StructureBase {
  kind: "candidate";
  type: ComponentType;
  quality: number;
}

/** An inert fused-scrap rock. It walls and never fires. */
export interface Blocker extends StructureBase {
  kind: "blocker";
}

export type Structure = Component | Candidate | Blocker;

/**
 * The build phase's single harvest, resolved as it launches the wave.
 *
 * A combine resolves the instant it is committed, so the only thing left to settle here
 * is the one keep.
 */
export type Harvest =
  { readonly mode: "none" } | { readonly mode: "keep"; readonly id: number };

// ---- The Load ------------------------------------------------------------

/** One live unit of the Load. */
export interface Unit {
  id: number;
  type: LoadType;
  flies: boolean;
  hp: number;
  maxHp: number;
  /** The roster speed, in logical units per second. It never scales with the wave. */
  speed: number;
  bounty: number;
  leak: number;
  /** The drawn radius, in logical units. */
  radius: number;
  x: number;
  y: number;
  /**
   * Where it stood when the current simulation step began, so the renderer draws
   * between that and `(x, y)`. Written by the step and read by the renderer, never the
   * other way about.
   */
  prevX: number;
  prevY: number;
  /** The checkpoint it is heading for, indexing `[entry, WP1..WP6, collector]`. */
  wpIndex: number;
  /** The current leg's route around the walls, as tile centers. Empty for a flyer. */
  route: readonly Pt[];
  routeStep: number;
  /** The remaining route to that checkpoint, in tiles. */
  progress: number;
  /** Seconds alive, which drives its idle cycle. */
  animT: number;
  /** Seconds since it was last struck. */
  hitFlash: number;
  /** The effective-speed multiplier while slowed. `1` is unslowed. */
  slowFactor: number;
  slowUntil: number;
  burnDps: number;
  burnUntil: number;
  /** The structure a burn's ticks are credited to; `0` for a posed burn. */
  burnSourceId: number;
  /** The finale's Overload Dynamo, whose health never falls. */
  invincible: boolean;
  /** The surface's per-unit travel hold. Never set by play. */
  frozen: boolean;
  dead: boolean;
}

// ---- Projectiles ---------------------------------------------------------

/**
 * A shot in flight.
 *
 * It carries a copy of the firing structure's shot, so the effect it lands is faithful
 * even if that structure is combined away while the shot travels.
 */
export interface Projectile {
  id: number;
  /** The firing structure, so a kill and its damage are credited back to it. */
  sourceId: number;
  type: ComponentType;
  quality: number;
  combo?: ComboId;
  dmg: number;
  x: number;
  y: number;
  /** The interpolation window, as on a unit. */
  prevX: number;
  prevY: number;
  angle: number;
  speed: number;
  targetId: number;
  splash: number;
  chain: number;
  chainRange: number;
  chainFalloff: number;
  slowAmt: number;
  slowDur: number;
  burnFrac: number;
  burnDur: number;
  isCrit: boolean;
  /** The units already struck, so a chain or a splash never hits one twice. */
  hitIds: number[];
  dead: boolean;
}

// ---- Waves ---------------------------------------------------------------

export interface SpawnEvent {
  /** When in the wave the unit is released, in milliseconds. */
  readonly atMs: number;
  readonly type: LoadType;
}

/** A composed wave. Built once and never edited, so it is carried rather than copied. */
export interface Wave {
  readonly wave: number;
  readonly events: readonly SpawnEvent[];
  readonly durationMs: number;
  /** The distinct types present, in roster order, for the next-wave preview. */
  readonly types: readonly LoadType[];
  readonly hasBoss: boolean;
  readonly hasAir: boolean;
}

// ---- Presentation events -------------------------------------------------

/**
 * A queued particle burst.
 *
 * A point effect uses `(x, y)`; a segment effect, an arc bolt or a chain leap, also
 * carries its far end. `quality` escalates a firing burst and `big` flags the oversized
 * discharge a Dynamo's death and an apex tower's shot throw.
 */
export interface FxEvent {
  readonly kind: EffectName;
  readonly x: number;
  readonly y: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly quality?: number;
  readonly big?: boolean;
}
