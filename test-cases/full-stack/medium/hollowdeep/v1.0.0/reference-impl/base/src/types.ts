// Hollowdeep — the core data model (DESIGN §3).
//
// These are the contracts every later module reads. Coordinates: TILE coords are
// integers (tx, ty) in [0,WORLD_W)×[0,WORLD_H); WORLD-PIXEL coords are tile * TILE;
// SCREEN coords come from the camera transform (world.ts). The gameplay/render/sim
// slices build on exactly these shapes, so they compose without re-deriving them.

// ---- Tiles & the world ----------------------------------------------------------
export type TileKind =
  | "dirt"
  | "ore"
  | "rock"
  | "bedrock" // solid natural (bedrock indestructible)
  | "open" // dug / naturally-hollow space (holds gas)
  | "wall"
  | "floor"
  | "ladder"
  | "wire" // built structure
  | "generator"
  | "diffuser"
  | "pump"
  | "refinery"
  | "farm"; // built machines/farm

export interface Tile {
  kind: TileKind;
  oxygen: number; // gas amount, 0..GAS_CAPACITY (open-to-gas tiles only)
  co2: number; // gas amount, 0..GAS_CAPACITY
  designated: boolean; // marked for digging (dig job pending)
  ghost: BuildKind | null; // pending build order on this tile (blueprint)
  ghostPaid: boolean; // material has been committed to the ghost
  machineId: number; // -1, or index into World.machines / farms
  oreRich: number; // ore tiles: units of ore this tile yields (>=1); else 0
}

export interface Camera {
  x: number; // world-pixel top-left
  y: number;
  zoom: number;
}

export interface World {
  w: number; // WORLD_W, WORLD_H (tiles)
  h: number;
  tiles: Tile[]; // flat, index = ty*w + tx
  machines: Machine[]; // placed generators/diffusers/pumps
  farms: Farm[]; // placed fungus farms
  refineries: { tx: number; ty: number }[];
  camera: Camera;
}

// ---- Power ----------------------------------------------------------------------
export type MachineKind = "generator" | "diffuser" | "pump";
export interface Machine {
  id: number;
  kind: MachineKind;
  tx: number;
  ty: number;
  network: number; // power-network id this machine attaches to (-1 = unattached)
  powered: boolean; // its network met demand this tick
  running: boolean; // powered AND has what it needs (fuel for a generator)
  fuel: number; // generator only: ore-units buffered (burns over time)
  ventPhase: number; // exhaust/steam animation accumulator
}

export interface Farm {
  tx: number;
  ty: number;
  growth: number; // seconds of growth accumulated
  ripe: boolean;
}

// ---- Delvers --------------------------------------------------------------------
export type DelverAct =
  | "idle"
  | "walk"
  | "dig"
  | "build"
  | "haul"
  | "refine"
  | "harvest"
  | "eat"
  | "rest"
  | "flee";
export type Anim = "walk" | "dig" | "carry" | "idle"; // which produced sheet plays
export type CarryKind = "ore" | "material" | "food" | null;

export interface Delver {
  id: number;
  name: string;
  px: number; // continuous world-pixel position (smooth movement)
  py: number;
  tx: number; // current tile (floor of px/py)
  ty: number;
  facing: 1 | -1; // sprite mirror
  health: number; // 0..HEALTH_MAX; suffocation lowers, good air recovers
  stamina: number; // 0..STAMINA_MAX; work drains, rest recovers
  hunger: number; // 0..HUNGER_MAX; rises over time; MAX = starving
  act: DelverAct;
  anim: Anim;
  animT: number;
  job: Job | null;
  path: { tx: number; ty: number }[];
  pathI: number;
  carrying: CarryKind;
  workTimer: number; // seconds of progress into the current action
  dead: boolean;
}

// ---- Jobs -----------------------------------------------------------------------
export type JobKind = "dig" | "build" | "haul" | "refine" | "harvest";
export interface Job {
  id: number;
  kind: JobKind;
  tx: number; // the tile the work is at
  ty: number;
  building?: BuildKind; // build jobs
  haul?: { what: CarryKind; toTx: number; toTy: number }; // haul jobs
  claimedBy: number | null; // delver id, or null
  priorityBoost: boolean; // player raised this designation ("do this now")
}

export type BuildKind =
  | "wall"
  | "floor"
  | "ladder"
  | "wire"
  | "generator"
  | "diffuser"
  | "pump"
  | "refinery"
  | "farm";

// ---- Game shell -----------------------------------------------------------------
export type GameState = "title" | "howto" | "playing" | "paused" | "gameover";
export type Tool = "dig" | "build" | "cancel";

// Particle overlays and one-shot bursts (particles.ts). The two GAS overlays are driven
// from tile concentration (oxygen/co2); the two BURSTS are events (dust at a mined tile,
// steam at a running machine's vent).
export type FxKind = "dust" | "steam" | "oxygen" | "co2";
export interface FxEvent {
  kind: "dust" | "steam";
  x: number; // world-pixel
  y: number;
}

// Sound cues (audio.ts). dig/build/alarm are one-shots; "machine" is the looping hum.
export type Cue = "dig" | "build" | "alarm" | "machine";

export interface Milestone {
  text: string;
  life: number; // non-blocking toast; seconds remaining
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
