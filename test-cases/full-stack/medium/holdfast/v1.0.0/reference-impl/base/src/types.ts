// Holdfast — the core runtime data model (DESIGN §2). These interfaces are the contract
// every later module depends on: sim.ts, jobs.ts, combat.ts, world.ts, pathfind.ts,
// render.ts, and hud.ts all read and write them. The enum/union vocabulary lives in
// constants.ts; the entity/state shapes live here.

import type {
  Activity,
  JobKind,
  NodeKind,
  ResourceKind,
  Skill,
  StructureKind,
  TerrainKind,
} from "./constants";

// ---- 2.1 World and tiles -------------------------------------------------------
export interface Tile {
  x: number;
  y: number; // tile coords (0..COLS-1, 0..ROWS-1)
  terrain: TerrainKind;
  node: ResourceNode | null; // one node may sit on the ground; blocks the tile until cleared
  structure: Structure | null; // one built structure; blocks per its kind
  designated: null | "chop" | "mine"; // active designation overlay on a node
  // Derived, recomputed by world.ts when the tile changes:
  walkable: boolean; // terrain walkable AND no blocking node/structure
  blocksSight: boolean; // wall/door/rock block line of sight and fire
  givesCover: boolean; // wall/door: a shooter/target beside it is in cover
}

export interface ResourceNode {
  kind: NodeKind;
  hp: number; // work remaining (seconds of work), counts down as it is worked
  maxHp: number;
  claimedBy: number | null; // settler id currently working it (one worker only)
  workAnim: number; // seconds, drives the dust-puff cadence
}

export interface Structure {
  kind: StructureKind;
  tx: number;
  ty: number;
  hp: number;
  maxHp: number; // turret/wall integrity (raiders damage turrets in base)
  built: boolean; // false while a ghost/blueprint awaiting construction
  progress: number; // 0..1 construction progress
  costPaid: boolean; // material deducted at placement (see economy)
  // stove / farm / turret working state:
  active: boolean; // stove cooking, turret has a target (drives the on/off sprite)
  cropStage: 0 | 1 | 2; // farm: 0 empty/sown, 1 growing, 2 ripe
  growth: number; // farm: 0..1 toward ripe (advances in daylight)
  cooldown: number; // turret: seconds to next shot
  aim: number; // turret: heading toward current target (sprite rotation)
}

// ---- 2.2 Settlers, raiders, jobs -----------------------------------------------
export interface Needs {
  hunger: number; // 0 full .. 1 starving
  rest: number; // 1 rested .. 0 exhausted
  mood: number; // 0..1, derived each tick from needs + events
}

export interface Settler {
  id: number;
  name: string;
  x: number;
  y: number; // pixel position (continuous, interpolated on render)
  facing: number; // heading radians, for sprite mirror/rotate
  health: number;
  maxHealth: number; // 100
  needs: Needs;
  skills: Record<Skill, number>; // 0..10; work-speed / hit multiplier via skillMul()
  job: Job | null; // the claimed job (null = seeking)
  path: PathNode[];
  pathIdx: number; // current route (tile centers)
  activity: Activity;
  animT: number; // seconds into the current cycle (frame = floor(animT*fps))
  carrying: null | { res: ResourceKind; amount: number }; // a haul in hand
  downed: boolean;
  bleed: number; // seconds of bleed-out remaining
  fireCooldown: number; // combat cadence
  eventMood: number; // transient mood hit from grim events, decays
  moodBreak: boolean; // mood too low → refuses low-priority work / idles
  bedId: number | null; // the structure id of an owned bed (mood comfort), if any
  dead: boolean;
}

export interface Raider {
  id: number;
  x: number;
  y: number;
  facing: number;
  health: number;
  maxHealth: number;
  path: PathNode[];
  pathIdx: number;
  targetId: number | null; // settler/turret it is engaging
  fireCooldown: number;
  fleeing: boolean; // broke and heading off-map
  animT: number;
  dead: boolean;
}

export interface Job {
  kind: JobKind;
  tx: number;
  ty: number; // work tile (adjacent-reachable tile is the walk target)
  targetId?: number; // settler to tend, structure to build, node id, etc.
  structure?: Structure; // build/cook/farm target
  claimedBy: number | null;
  work: number; // seconds of work accumulated
  workNeeded: number; // seconds required at 1.0× skill
}

export interface PathNode {
  tx: number;
  ty: number;
}

// ---- 2.3 Resources, tracers, effects, game state -------------------------------
export interface Stock {
  wood: number;
  ore: number;
  crops: number;
  meals: number;
}

// A dropped resource pile on the ground (a gather result awaiting a haul).
export interface Drop {
  id: number;
  tx: number;
  ty: number;
  res: ResourceKind;
  amount: number;
}

// Combat is resolved on the tick; a shot is drawn as a brief tracer + muzzle/impact fx,
// not a slow homing projectile. This records the tracer to draw for ~120 ms.
export interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number;
  hostile: boolean;
}

export type GameState = "title" | "howto" | "playing" | "paused" | "gameover";
export type Phase = "day" | "dusk" | "night" | "dawn"; // time-of-day phase

export type FxKind = "muzzle" | "blood" | "impact" | "fire" | "explosion" | "dust";
export interface FxEvent {
  kind: FxKind;
  x: number; // world pixel position
  y: number;
}
export type Cue = "gunshot" | "hit" | "build" | "alarm"; // ambient + music handled apart

// A milestone / event toast (non-blocking notification).
export interface Toast {
  text: string;
  life: number;
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
