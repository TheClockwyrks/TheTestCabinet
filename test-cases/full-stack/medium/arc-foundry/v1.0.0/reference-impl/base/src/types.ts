// Arc Foundry — the complete shared data model (the FROZEN CONTRACT).
//
// Arc Foundry is a GemTD reskin (specs/overview.md): you stamp random electrical
// COMPONENTS from a scrap-press, wall a maze with them through ORDERED WAYPOINTS, and
// climb a five-rung QUALITY ladder (Scrap → Tuned → Charged → Primed → Tesla-Prime) by
// COMBINING matches. Every stamped component — active or slagged — is also a 2×2 WALL.
// The Load pathfinds the shortest OPEN route around the walls between consecutive
// waypoints; a placement that would seal any segment is refused (never-seal), and the
// floor re-paths live as walls change.
//
// This module holds every runtime TYPE the rest of the build reads; the fixed NUMBERS
// (stat tables, roll odds, the three maps' coordinates, the economy, the difficulty
// table) live in constants.ts, which imports these types. Rendering, audio, and
// particles read this state and drain its event queues; the simulation itself is
// DOM-free and driven identically by the browser and the headless balance harness.

// ---- Kinds (the two orthogonal component axes, the Load, difficulty) -----------

// The five COMPONENT TYPES — an electrical part with a distinct firing identity and
// signature VFX (specs/towers.md). Kept distinct from the quality-TIER names so the two
// axes never collide.
export type ComponentType = "capacitor" | "coil" | "emitter" | "arcnode" | "discharge";

// The QUALITY tier on the five-rung ladder (specs/towers.md): 1 = Scrap, 2 = Tuned,
// 3 = Charged, 4 = Primed, 5 = Tesla-Prime. The power axis; combining climbs one rung.
export type Tier = 1 | 2 | 3 | 4 | 5;

// Per-component targeting priority — which valid in-range unit it fires at
// (specs/towers.md, specs/controls.md). FIRST (default) is furthest along the waypoint
// chain, LAST the least far; NEAREST ranks by straight-line distance from the component;
// STRONGEST / WEAKEST by most / least remaining hit points.
export type TargetingMode = "first" | "last" | "nearest" | "strongest" | "weakest";

// The Load roster (specs/enemies.md): charge units seeking ground. `filament` is the
// flyer (ignores the maze); `dynamo` is the boss (overload core, anchors milestone waves).
export type LoadType = "mote" | "spark" | "slug" | "cluster" | "filament" | "dynamo";

// The in-game difficulty (specs/modes.md): changes ONLY wave count and enemy HP scaling.
export type Difficulty = "easy" | "medium" | "hard";

// ---- Board: tiles, waypoints, maps ---------------------------------------------

export interface Pt {
  x: number;
  y: number;
}

// A tile address on the 50×33 grid (specs/board.md).
export interface TileCoord {
  col: number;
  row: number;
}

// A tile's build/walk state (specs/board.md). `open` is empty yard the Load crosses and
// the player may build on; `blocked` is a component or slag footprint (a wall the player
// can remove); `fixed` is a map's pre-placed housing (impassable AND never buildable).
export type TileState = "open" | "blocked" | "fixed";

// A board edge (or the center) an Entry / Collector / waypoint sits on, for layout.
export type MapEdge = "left" | "right" | "top" | "bottom" | "center";

// A fixed-blocked rectangle of tiles (Map C's transformer housings), inclusive on both
// ends (specs/board.md).
export interface HousingRect {
  col0: number;
  row0: number;
  col1: number;
  row1: number;
}

// A map's TOPOLOGY (specs/board.md): the ordered waypoint chain and any fixed housings.
// Every map plays the same campaign, economy, roster, and scaling — only the topology
// differs. The pathing chain is [entry, ...waypoints, collector], traversed in order.
export interface MapDef {
  id: string;
  name: string; // "The Substation" | "The Switchyard" | "The Transformer Yard"
  blurb: string;
  styleLabel: string; // the visual flow treatment ("SERPENTINE" / "BUSBAR" / "CHOKEPOINT")
  entry: TileCoord;
  entryEdge: MapEdge;
  waypoints: TileCoord[]; // WP1..WPk, in order
  collector: TileCoord;
  collectorEdge: MapEdge;
  housings: HousingRect[]; // fixed-blocked, never buildable (empty on Maps A/B)
}

// ---- Placed structures: active components and inert slag walls ------------------

// Fields common to everything placed on the yard — both active components and slag
// walls occupy a uniform 2×2 footprint anchored at (col, row) and are WALLS (specs/board.md).
export interface StructureBase {
  id: number;
  col: number; // top-left anchor tile of the 2×2 footprint
  row: number;
  invested: number; // the Charge this piece carries, for the sell refund (specs/towers.md)
  placedForWave: number; // the wave number whose approach this piece was placed during
  refundable: boolean; // full-refund window: true until placedForWave starts (specs/build.md)
}

// An ACTIVE component: fires automatically at its type/quality stats AND walls
// (specs/towers.md). Its head rotates to face the target; each shot is a travelling
// projectile / arc that carries the hit on impact.
export interface Component extends StructureBase {
  kind: "component";
  type: ComponentType;
  tier: Tier;
  targeting: TargetingMode; // "first" by default
  cooldown: number; // seconds until it may fire again
  fireAnim: number; // seconds since last shot (drives the firing sheet / muzzle)
  aimAngle: number; // the head's heading — tracks the current target
}

// A SLAG wall: an inert fused-scrap lump — walls but never fires (specs/build.md).
export interface SlagWall extends StructureBase {
  kind: "slag";
}

// Everything on the yard the maze is built from.
export type Structure = Component | SlagWall;

// ---- The Load (units) ----------------------------------------------------------

// A live unit of the Load (specs/enemies.md). It spawns at Entry, traverses the waypoint
// chain in order, and grounds out (leaks) at the Collector. `flies` units ignore the maze
// and straight-line through the waypoints (specs/board.md §3.6).
export interface Unit {
  id: number;
  type: LoadType;
  flies: boolean;
  hp: number;
  maxHp: number;
  speed: number; // logical px/s (does not scale with wave)
  bounty: number; // Charge + score paid on kill
  leak: number; // Grid Integrity cost if it grounds out
  radius: number; // visual/collision radius (logical px)
  x: number; // current position in logical-pixel space
  y: number;
  wpIndex: number; // index into the full chain [E, WP1…WPk, C] of the node it heads to next
  route: Pt[]; // the current leg's tile-center route around the walls (empty for flyers)
  routeStep: number; // index of the next node in `route`
  progress: number; // scalar "how far along the chain" for first/last targeting
  animT: number; // seconds alive (charge-cycle / boss wobble frame)
  hitFlash: number; // seconds since last hit (a brief flash)
  dead: boolean;
}

// ---- Projectiles ---------------------------------------------------------------

// A shot in flight (specs/towers.md). A component launches one toward its target; it
// travels and applies the component's effect on IMPACT (never a hitscan). It carries a
// snapshot of the firing component's shot so the effect is faithful even if the component
// is later sold or combined, and misses harmlessly if its target is gone.
export interface Projectile {
  id: number;
  type: ComponentType; // which component fired it (sprite + effect)
  tier: Tier; // for VFX intensity escalation
  dmg: number;
  x: number;
  y: number;
  angle: number; // heading, for the sprite's rotation
  speed: number;
  targetId: number; // the homed unit
  // Shot-shape snapshot (from CompStats).
  splash: number; // Arc-Node: area-of-effect radius on impact (0 = single target)
  chain: number; // Coil: extra leaps after the primary hit (0 = no chain)
  chainRange: number; // Coil: max jump distance between hit units
  chainFalloff: number; // Coil: damage multiplier applied per leap
  hitIds: number[]; // units already struck (so a chain does not re-hit one)
  dead: boolean;
}

// ---- Waves ---------------------------------------------------------------------

export interface SpawnEvent {
  atMs: number; // when in the wave this unit is released from the Entry
  type: LoadType;
}

export interface Wave {
  wave: number; // 1-based wave number
  events: SpawnEvent[];
  durationMs: number;
  types: LoadType[]; // distinct types present, in preview order (the next-wave preview)
  hasBoss: boolean; // a Dynamo anchors this (milestone) wave
}

// ---- Game state machine, presentation events, UI hit-testing -------------------

// The reachable game states (specs/flow.md, specs/modes.md). `playing` covers both the
// build phase and a live wave (see Phase); `paused` is the Esc overlay MENU (distinct
// from the in-place pause, which is a boolean on the game state). `defeat` is Overload.
export type GameState =
  | "title"
  | "mapselect"
  | "difficultyselect"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "defeat";

export type Phase = "build" | "wave";

// The produced electrical particle systems, fired at each event (specs/assets.md — THE
// HEADLINE). A firing effect's intensity escalates with the component's quality tier.
export type FxKind =
  | "buildspark" // a component is stamped from the press
  | "combine" // two components combine into a higher tier
  | "arcbolt" // a Capacitor / Discharge Rig fires its single bolt
  | "chain" // a Coil fires and chains between hit units
  | "spray" // an Emitter fires its fast spark fan
  | "ring" // an Arc-Node's shot lands (expanding discharge ring)
  | "impact" // any projectile / arc hits a unit
  | "death" // a unit dies (much larger for the Dynamo)
  | "leak" // a unit grounds out at the Collector
  | "muzzle"; // a small glow at a firing head

// A queued particle burst. Point effects use (x, y); a segment effect (arc bolt / a chain
// leap) also carries the far end (x2, y2). `tier` drives the quality escalation; `big`
// flags the Dynamo's oversized death discharge.
export interface FxEvent {
  kind: FxKind;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  tier?: Tier;
  big?: boolean;
}

// The produced sound cues (specs/assets.md "Audio"). Music is looped separately.
export type Cue = "stamp" | "zap" | "chain" | "discharge" | "combine" | "kill" | "leak" | "slag";

// A hit-testable UI region emitted by the renderer and routed by the input layer.
export interface Clickable {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
  payload?: string;
  disabled?: boolean;
}
