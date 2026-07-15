// Arc Foundry — the complete shared data model (the FROZEN CONTRACT).
//
// Arc Foundry is a faithful GemTD reskin (specs/overview.md): you place random-rolling
// electrical ROCKS from a scrap-press, KEEP EXACTLY ONE per level as a firing COMPONENT,
// and every rock you do not keep hardens into an inert BLOCKER (a 2×2 wall that never
// fires). You climb a five-rung QUALITY ladder (Scrap → Tuned → Charged → Primed →
// Tesla-Prime) by COMBINING matches, and buy UPGRADE QUALITY (Refinement) to bias rolls
// upward. Every component, candidate, and blocker is also a 2×2 WALL. The Load pathfinds
// the shortest OPEN route around the walls between consecutive waypoint PLATFORMS; a
// placement that would seal any segment or encircle a waypoint is refused (never-seal),
// and the floor re-paths live as walls change.
//
// This module holds every runtime TYPE the rest of the build reads; the fixed NUMBERS
// (stat tables, roll odds, the Refinement track, the three maps' coordinates, the
// economy, the difficulty table) live in constants.ts, which imports these types.
// Rendering, audio, and particles read this state and drain its event queues; the
// simulation itself is DOM-free and driven identically by the browser and the headless
// balance harness.

// ---- Kinds (the two orthogonal component axes, the Load, difficulty) -----------

// The five COMPONENT TYPES — an electrical part with a distinct firing identity and
// signature VFX (specs/towers.md). Kept distinct from the quality-TIER names so the two
// axes never collide.
export type ComponentType = "capacitor" | "coil" | "emitter" | "arcnode" | "discharge";

// The QUALITY tier on the five-rung ladder (specs/towers.md): 1 = Scrap, 2 = Tuned,
// 3 = Charged, 4 = Primed, 5 = Tesla-Prime. The power axis; combining climbs one rung.
export type Tier = 1 | 2 | 3 | 4 | 5;

// The Refinement level R on the UPGRADE QUALITY track (specs/build.md): 0..5. Higher R
// biases the stamp's QUALITY roll toward higher tiers. Persistent for the run.
export type Refinement = 0 | 1 | 2 | 3 | 4 | 5;

// Per-component targeting priority — which valid in-range unit it fires at
// (specs/towers.md, specs/controls.md). FIRST (default) is furthest along the waypoint
// chain, LAST the least far; NEAREST ranks by straight-line distance from the component;
// STRONGEST / WEAKEST by most / least remaining hit points.
export type TargetingMode = "first" | "last" | "nearest" | "strongest" | "weakest";

// The Load roster (specs/enemies.md): charge units seeking ground. `filament` is the
// flyer (ignores the maze, appears every 4th wave); `dynamo` is the boss (overload core,
// anchors milestone waves).
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
// the player may build on; `blocked` is a component / candidate / blocker footprint (a
// wall); `fixed` is a map's pre-placed housing (impassable AND never buildable);
// `waypoint` is a tile of a 4-tile waypoint platform (walkable but never buildable).
export type TileState = "open" | "blocked" | "fixed" | "waypoint";

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
// differs. The pathing chain is [entry, ...waypoints, collector], traversed in order;
// each waypoint coordinate is the ANCHOR of a 4-tile T-shaped platform (the extra tiles
// are derived in board.ts: (c−1,r), (c+1,r), and a stem (c, r±1) toward row 16).
export interface MapDef {
  id: string;
  name: string; // "The Substation" | "The Switchyard" | "The Transformer Yard"
  blurb: string;
  styleLabel: string; // the visual flow treatment ("SERPENTINE" / "BUSBAR" / "CHOKEPOINT")
  entry: TileCoord;
  entryEdge: MapEdge;
  waypoints: TileCoord[]; // WP1..WPk anchors, in order (each a 4-tile platform)
  collector: TileCoord;
  collectorEdge: MapEdge;
  housings: HousingRect[]; // fixed-blocked, never buildable (empty on Maps A/B)
}

// ---- Placed structures: components, candidates, blockers ------------------------

// Fields common to everything placed on the yard. Components, candidates, and blockers
// all occupy a uniform 2×2 footprint anchored at (col, row) and are WALLS (specs/board.md).
export interface StructureBase {
  id: number;
  col: number; // top-left anchor tile of the 2×2 footprint
  row: number;
}

// An ACTIVE component: fires automatically at its type/quality stats AND walls
// (specs/towers.md). Its head rotates to face the target; each shot is a travelling
// projectile / arc that carries the hit on impact. Created only by KEEPing a candidate or
// by a COMBINE (specs/build.md). Permanent — there is no selling.
export interface Component extends StructureBase {
  kind: "component";
  type: ComponentType;
  tier: Tier;
  targeting: TargetingMode; // "first" by default
  cooldown: number; // seconds until it may fire again
  fireAnim: number; // seconds since last shot (drives the firing sheet / muzzle)
  aimAngle: number; // the head's heading — tracks the current target
  kills: number; // units this component has destroyed (inspector tally, specs/towers.md)
  damageDealt: number; // total damage this component has applied (inspector tally)
}

// A CANDIDATE: a rock placed THIS build phase that has rolled a random type + quality and
// is eligible to be kept or combined this level only (specs/build.md). Walls its footprint
// but does not fire (there are no units on the floor during the build phase). At wave
// start every un-harvested candidate hardens into a Blocker.
export interface Candidate extends StructureBase {
  kind: "candidate";
  type: ComponentType;
  tier: Tier;
}

// A BLOCKER: an inert fused-scrap rock — walls but never fires (specs/build.md). The maze
// material. A future stamp may be dropped onto a blocker to reroll it into a candidate.
export interface Blocker extends StructureBase {
  kind: "blocker";
}

// Everything on the yard the maze is built from.
export type Structure = Component | Candidate | Blocker;

// The level's single harvest choice (specs/build.md): what the SEND resolves into the one
// new/upgraded firing component. `keep` promotes a candidate; `combine` merges a candidate
// with a partner (another candidate or an existing component of the same type + tier) one
// tier higher, consuming the partner — whose footprint HARDENS INTO A BLOCKER so the maze wall
// is preserved (a combine never opens a hole). Reversible until SEND.
export type Harvest =
  | { mode: "none" }
  | { mode: "keep"; id: number }
  | { mode: "combine"; id: number; partnerId: number };

// ---- The Load (units) ----------------------------------------------------------

// A live unit of the Load (specs/enemies.md). It spawns at Entry, traverses the waypoint
// chain in order, and grounds out (leaks) at the Collector. `flies` units ignore the maze
// and straight-line through the waypoints (specs/board.md).
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
// is later combined, and misses harmlessly if its target is gone.
export interface Projectile {
  id: number;
  sourceId: number; // the firing component's id, so kills/damage attribute back to it
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
  hasAir: boolean; // a Filament contingent is present (every 4th wave)
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

// A level is a BUILD phase (untimed; you place rocks, keep, combine, upgrade quality)
// then a WAVE phase (the Load runs; building is disabled). specs/flow.md.
export type Phase = "build" | "wave";

// The produced electrical particle systems, fired at each event (specs/assets.md — THE
// HEADLINE). A firing effect's intensity escalates with the component's quality tier.
export type FxKind =
  | "buildspark" // a rock is placed / a candidate revealed at the press
  | "combine" // a combine resolves into a higher tier (also reused for a KEEP flourish)
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
// `settle` is the rock-settle thunk played when unkept candidates harden into blockers at
// wave start (it replaces the old "slag" cue).
export type Cue = "stamp" | "zap" | "chain" | "discharge" | "combine" | "kill" | "leak" | "settle";

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
