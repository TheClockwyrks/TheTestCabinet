// Arc Foundry — the build's debug and automation surface, as types. CASE-PROVIDED.
//
// `specs/instrumentation.md` is the contract, and this file is that contract
// written as TypeScript. Nothing here is imported from the build: the build
// declares its own type for the surface its `initialize` returns, and what a
// check holds it to is the SPECIFICATION rather than whatever the build wrote.
// So the surface is DECLARED here, and `harness.ts` reads no other description of
// it — a build whose surface departs from the specification is held against the
// specification, and a check reaching for a missing operation fails on the point
// that needed it.
//
// WHAT IS IMPORTED, AND WHY THAT IS NOT THE SAME THING. The identifier
// vocabularies below — the screens, the phases, the eight component types, the
// twelve combination towers, the five targeting priorities, the panel, menu and
// status actions — come from `./constants`, this project's own transcription of
// the seeded specification. Nothing here reads the build's own figure module: a
// vocabulary taken from the tree under test would hold whatever that tree says,
// and the check would grade nothing. The build's `src/game.ts` is imported
// by the harness for one thing only: the game object the engine is constructed
// over.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface holds no state of its own and nothing on it mutates
// anything. Every operation is written in the shape of the game's `update`: a
// POSE takes the current state and returns the next (`setCharge(state, 500)`,
// `placeRock(state, 10, 10)`), and a READING takes the current state and returns
// what it read (`snapshot(state)`, `panelButtons(state)`). A caller drives a pose
// through `engine.apply((s) => debug.setCharge(s, 500))` — the engine stores what
// the pose returned, and the next frame's `update` receives it — and a reading
// against `engine.state`. `version` is a plain number.
//
// The surface is generic over the build's state type, because this module imports
// no state type of the build's: `harness.ts` binds it to the `FoundryState` the
// build declared, and the `Driver` there is what gives the checks the imperative
// reading (`h.debug.setCharge(500)`, `h.debug.snapshot()`) over the pure shape
// declared here.
//
// WHAT IS NOT HERE, AND WHY. The clock and the input operations. Under an engine
// they are the engine's: `engine.advance` moves the clock, and a key or a pointer
// press is an event dispatched at the engine's own surface, which the game reads
// through the actions it registered. `specs/instrumentation.md` says so, and a
// build that installed clock or input operations on its surface is not asked for
// them and never has them called.

import type { DeepReadonly } from "ts-essentials";
import type {
  ComboId,
  ComponentType,
  DifficultyId,
  IngredientState,
  MapId,
  MenuAction,
  PanelAction,
  PhaseName,
  PressControl as PressAction,
  ScreenName,
  SpawnType,
  StatusControl as StatusAction,
  StatusReadoutName,
  StructureKind,
  TargetingPriority,
  Tier,
} from "./constants";

export { FOUNDRY_DEBUG_VERSION } from "./constants";
export type {
  ComboId,
  ComponentType,
  DifficultyId,
  IngredientState,
  MapId,
  MenuAction,
  PanelAction,
  SpawnType,
  StatusAction,
  StatusReadoutName,
  StructureKind,
  Tier,
};

/** The eight screens the game is a state machine over. */
export type Screen = ScreenName;

/** The three phases of a live run. Off the yard there is no phase. */
export type Phase = PhaseName;

/** The five targeting priorities, in the order the control cycles them. */
export type Targeting = TargetingPriority;

/** Which read-only overlay `setOverlay` opens or closes. */
export type OverlayName = "combos" | "damage";

/* -------------------------------------------------------------------------- */
/* The readings                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One control of the build panel's inspector or of a menu screen.
 *
 * `x`, `y`, `w` and `h` are its rectangle on the 1280 x 720 stage, and the
 * rectangle is the control's real hit region: a press and a release at the center
 * of a reported, non-disabled rectangle activates it. Because `specs/hud.md` fixes
 * each menu's content and navigation rather than its layout, this is how a check
 * finds a choice without knowing where it was drawn.
 */
export interface ControlButton {
  action: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  disabled: boolean;
}

/** An inspector action control. Its `action` is one of `PANEL_ACTIONS`. */
export interface PanelButton extends ControlButton {
  action: PanelAction;
}

/**
 * One of the build panel's own two controls, drawn above the inspector.
 *
 * Its `action` is one of `PRESS_CONTROLS`. The refinement control's `disabled`
 * follows the refinement track alone and the press control's follows the stamp
 * allowance and the phase, so neither reads the selection.
 */
export interface PressButton extends ControlButton {
  action: PressAction;
}

/** A menu choice. Its `action` is one of `MENU_ACTIONS`. */
export interface MenuButton extends ControlButton {
  action: MenuAction;
}

/**
 * A status-bar control: the same geometry, and a `state` reporting the value the
 * control currently reads rather than whether it can be activated.
 *
 * `combos`, `damage`, `pause` and `mute` read a boolean; `speed` reads the live
 * multiplier, one of `1`, `2`, `4`, `8`.
 */
export interface StatusControl {
  action: StatusAction;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  state: boolean | number;
}

/**
 * One of the status bar's READS, as `statusReadouts` reports it.
 *
 * `specs/hud.md` fixes what the bar shows and the order it shows it in and leaves
 * every rectangle to the build, and a read is not a control, so `statusControls`
 * carries none of them. `specs/instrumentation.md` therefore has the build report
 * each read's own rectangle here, with the same guarantee a control's carries: it
 * is where the read is drawn, so a pointer standing at its center is over it —
 * which is what the maze-length hover of `specs/controls.md` acts on.
 *
 * `label` is the text as drawn, so a check reads the figure the way a player does.
 */
export interface StatusReadout {
  readout: StatusReadoutName;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One ingredient cell the recipe book drew, as `recipeEntries` reports it.
 *
 * `combo` is the combination tower whose recipe the cell belongs to, and
 * `ingredient` is that ingredient's index within the recipe, counted from `0` in
 * the order `specs/combinations.md` lists it — so a recipe calling for the same
 * type and quality twice is still two cells a check can tell apart. `type` and
 * `quality` are the ingredient's own, and `state` is one of the three
 * `specs/hud.md` fixes.
 *
 * The rectangle is where the book drew the cell, so whatever the build draws to
 * tell the state apart at a glance is inside it.
 */
export interface RecipeEntry {
  combo: ComboId;
  ingredient: number;
  type: ComponentType;
  quality: number;
  state: IngredientState;
  x: number;
  y: number;
  w: number;
  h: number;
}

/* -------------------------------------------------------------------------- */
/* The snapshot                                                               */
/* -------------------------------------------------------------------------- */

/** One live unit of the Load, as the snapshot reports it. */
export interface UnitView {
  id: number;
  type: SpawnType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** The current speed, after any slow. */
  speed: number;
  /** The roster speed, before any slow. */
  baseSpeed: number;
  flying: boolean;
  /** Travel held by `setUnitFrozen`, and nothing else held with it. */
  frozen: boolean;
  /** The checkpoint it is heading for, 1..7, where 7 is the collector. */
  waypointIndex: number;
  /** The remaining route length to that checkpoint, in TILES. */
  progress: number;
  slowFactor: number;
  slowUntil: number;
  burnDps: number;
  burnUntil: number;
  /** The Overload Dynamo alone. */
  invincible: boolean;
}

/** One structure on the yard: a candidate, a component, a tower, or a blocker. */
export interface StructureView {
  id: number;
  kind: StructureKind;
  /** A component type or a combination tower id; `null` for a blocker. */
  type: ComponentType | ComboId | null;
  /** 1..5 for a base structure; `null` otherwise. */
  quality: number | null;
  /** 0..3 for a combination tower; `null` otherwise. */
  level: number | null;
  col: number;
  row: number;
  cx: number;
  cy: number;
  range: number;
  /** The effective per-shot damage, INCLUDING any aura buff, unrounded. */
  damage: number;
  fireRate: number;
  targeting: Targeting | null;
  /** The firing head's rotation, in radians. */
  heading: number;
  firing: boolean;
  kills: number;
  damageDealt: number;
  auraRadius: number;
  auraBonus: number;
  abilities: string[];
  /** The crit outcome `setNextCrit` armed for its next shot, or `null`. */
  nextCrit: boolean | null;
}

/** One projectile in flight. */
export interface ProjectileView {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: string;
  heading: number;
  damage: number;
  targetId: number | null;
}

/** A waypoint of the map's chain, in the order its number gives. */
export interface WaypointView {
  index: number;
  col: number;
  row: number;
}

/** The rock on the cursor. Never `null`: it reports `active: false` instead. */
export interface HeldView {
  active: boolean;
  col: number;
  row: number;
  legal: boolean;
}

/** The exact component the next placed rock will roll, or `null`. */
export interface NextRollView {
  type: ComponentType;
  quality: number;
}

/** What one press roll decided, as `rollPress` returns it. */
export interface PressRoll {
  type: ComponentType;
  quality: number;
}

/**
 * The state a snapshot reports, as `specs/instrumentation.md` documents it.
 *
 * The shape is fixed and every field is present on every screen: a field the
 * current screen does not use reports its resting value rather than going
 * missing. So a check reads a field without first asking which screen it is on.
 */
export interface FoundrySnapshot {
  version: number;
  screen: Screen;
  /** `null` off the yard. */
  phase: Phase | null;
  menuIndex: number;
  /** The in-place pause. The screen stays `playing`. */
  paused: boolean;
  map: MapId;
  difficulty: DifficultyId;
  wave: number;
  totalWaves: number;
  waveActive: boolean;
  /** The wave's clear-and-pay resolution held by `setWaveHold`. */
  waveHeld: boolean;
  charge: number;
  integrity: number;
  refinement: number;
  /** The live five-tier roll odds, summing to 1. */
  qualityOdds: number[];
  nextRoll: NextRollView | null;
  stampsLeft: number;
  speed: number;
  muted: boolean;
  overlays: { combos: boolean; damage: boolean };
  /** The ground route through the chain, in tiles. */
  mazeLength: number;
  /** Damage tallied on the Overload Dynamo. */
  mazeRating: number;
  selected: number | null;
  combineSet: number[];
  /** The pointer position the game last read, in logical units. */
  pointer: { x: number; y: number };
  held: HeldView;
  entry: { col: number; row: number };
  collector: { col: number; row: number };
  waypoints: WaypointView[];
  units: UnitView[];
  structures: StructureView[];
  projectiles: ProjectileView[];
  /** The simulation clock, in seconds. */
  simTime: number;
}

/* -------------------------------------------------------------------------- */
/* The operations                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The surface a build returns beside its state from `initialize`, over the
 * build's own state type `S`.
 *
 * Each pose is a transition — the current state in, the next state out — and each
 * reading is a function of the current state. None of them touches the state it
 * was handed: `DeepReadonly<S>` is the view the engine hands out, and the compiler
 * is what says a pose returns a new value rather than mutating.
 *
 * Every operation is ATOMIC: it sets one thing or reads one thing. A pose sets one
 * thing and leaves the rest of the game as it stands, so a caller that wants
 * several things arranged makes several calls, in the order it wants them. A pose
 * that stands for a control a player operates commits through that same control,
 * so it is REFUSED wherever the control is refused; an argument outside its stated
 * domain THROWS instead.
 */
export interface FoundryDebugApi<S = unknown> {
  version: number;

  /* Readings. */
  snapshot(state: DeepReadonly<S>): FoundrySnapshot;
  panelButtons(state: DeepReadonly<S>): PanelButton[];
  pressControls(state: DeepReadonly<S>): PressButton[];
  menuButtons(state: DeepReadonly<S>): MenuButton[];
  statusControls(state: DeepReadonly<S>): StatusControl[];
  statusReadouts(state: DeepReadonly<S>): StatusReadout[];
  recipeEntries(state: DeepReadonly<S>): RecipeEntry[];

  /**
   * How many units of `type` the LIVE wave releases across the whole of its
   * schedule, those it has already released and those still to come
   * (specs/instrumentation.md).
   *
   * The wave's OWN schedule — the sequence of releases the spawner is working
   * through — so a unit that has died, leaked or been swept away by `clearUnits`
   * goes on counting, and the figure does not move across the wave. `0` for every
   * type with no wave running and on a wave the driver's hold on the spawner
   * opened, whose schedule is empty; `overload` reads `0` always.
   */
  waveCount(state: DeepReadonly<S>, type: SpawnType): number;

  /**
   * One press roll at the current refinement level, exactly as a dropped rock
   * rolls. It lands nothing, spends nothing, and leaves an armed roll standing.
   */
  rollPress(state: DeepReadonly<S>): PressRoll;

  /* The run. */
  reset(state: DeepReadonly<S>): S;
  setMap(state: DeepReadonly<S>, map: MapId): S;
  setDifficulty(state: DeepReadonly<S>, difficulty: DifficultyId): S;
  startRun(state: DeepReadonly<S>): S;
  setScreen(state: DeepReadonly<S>, screen: Screen): S;
  setMenuIndex(state: DeepReadonly<S>, index: number): S;
  setPaused(state: DeepReadonly<S>, paused: boolean): S;
  setSpeed(state: DeepReadonly<S>, multiplier: number): S;
  setPhase(state: DeepReadonly<S>, phase: Phase): S;
  setWaveHold(state: DeepReadonly<S>, held: boolean): S;
  setOverlay(state: DeepReadonly<S>, overlay: OverlayName, open: boolean): S;

  /* Resources and progress. */
  setCharge(state: DeepReadonly<S>, amount: number): S;
  setIntegrity(state: DeepReadonly<S>, amount: number): S;
  setRefinement(state: DeepReadonly<S>, level: number): S;
  setWave(state: DeepReadonly<S>, n: number): S;
  setStamps(state: DeepReadonly<S>, n: number): S;

  /* Structures. */
  clearStructures(state: DeepReadonly<S>): S;
  setNextRoll(state: DeepReadonly<S>, type: ComponentType, quality: number): S;
  clearNextRoll(state: DeepReadonly<S>): S;
  clearHeld(state: DeepReadonly<S>): S;
  placeRock(state: DeepReadonly<S>, col: number, row: number): S;
  placeComponent(
    state: DeepReadonly<S>,
    type: ComponentType,
    quality: number,
    col: number,
    row: number,
  ): S;
  placeCombo(
    state: DeepReadonly<S>,
    combo: ComboId,
    col: number,
    row: number,
  ): S;
  placeBlocker(state: DeepReadonly<S>, col: number, row: number): S;
  select(state: DeepReadonly<S>, id: number): S;
  clearSelection(state: DeepReadonly<S>): S;
  addToCombineSet(state: DeepReadonly<S>, id: number): S;
  clearCombineSet(state: DeepReadonly<S>): S;
  keep(state: DeepReadonly<S>, id: number): S;
  downgrade(state: DeepReadonly<S>, id: number): S;
  combine(state: DeepReadonly<S>, id: number): S;
  dismantle(state: DeepReadonly<S>, id: number): S;
  setTargeting(state: DeepReadonly<S>, id: number, priority: Targeting): S;
  setComboLevel(state: DeepReadonly<S>, id: number, level: number): S;
  setNextCrit(state: DeepReadonly<S>, id: number, crit: boolean): S;
  clearNextCrit(state: DeepReadonly<S>, id: number): S;
  upgradeQuality(state: DeepReadonly<S>): S;
  upgradeCombo(state: DeepReadonly<S>, id: number): S;

  /* The Load. */
  clearUnits(state: DeepReadonly<S>): S;
  clearProjectiles(state: DeepReadonly<S>): S;
  spawnUnit(state: DeepReadonly<S>, type: SpawnType): S;
  setUnitPosition(state: DeepReadonly<S>, id: number, x: number, y: number): S;
  setUnitWaypoint(state: DeepReadonly<S>, id: number, index: number): S;
  setUnitHp(state: DeepReadonly<S>, id: number, hp: number): S;
  setUnitSlow(
    state: DeepReadonly<S>,
    id: number,
    amount: number,
    seconds: number,
  ): S;
  setUnitBurn(
    state: DeepReadonly<S>,
    id: number,
    dps: number,
    seconds: number,
  ): S;
  setUnitFrozen(state: DeepReadonly<S>, id: number, frozen: boolean): S;
}

/**
 * The operations that READ the state rather than replace it.
 *
 * A driver over the surface needs to know which members to call with the current
 * state and hand the result back, and which to run through `engine.apply`; the
 * surface's shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = [
  "snapshot",
  "panelButtons",
  "pressControls",
  "menuButtons",
  "statusControls",
  "statusReadouts",
  "recipeEntries",
  "waveCount",
  "rollPress",
] as const;

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine.
 *
 * The clock and the input operations are absent by design: the engine owns both,
 * so the specification puts neither on the surface. This list is what
 * `instrumentation/surface-present` reflects over, and a build missing any of
 * them fails there by name rather than throwing a `TypeError` inside whichever
 * check reached for it first.
 */
export const REQUIRED_OPS = [
  // Readings.
  "snapshot",
  "panelButtons",
  "pressControls",
  "menuButtons",
  "statusControls",
  "statusReadouts",
  "recipeEntries",
  "waveCount",
  "rollPress",
  // The run.
  "reset",
  "setMap",
  "setDifficulty",
  "startRun",
  "setScreen",
  "setMenuIndex",
  "setPaused",
  "setSpeed",
  "setPhase",
  "setWaveHold",
  "setOverlay",
  // Resources and progress.
  "setCharge",
  "setIntegrity",
  "setRefinement",
  "setWave",
  "setStamps",
  // Structures.
  "clearStructures",
  "setNextRoll",
  "clearNextRoll",
  "clearHeld",
  "placeRock",
  "placeComponent",
  "placeCombo",
  "placeBlocker",
  "select",
  "clearSelection",
  "addToCombineSet",
  "clearCombineSet",
  "keep",
  "downgrade",
  "combine",
  "dismantle",
  "setTargeting",
  "setComboLevel",
  "setNextCrit",
  "clearNextCrit",
  "upgradeQuality",
  "upgradeCombo",
  // The Load.
  "clearUnits",
  "clearProjectiles",
  "spawnUnit",
  "setUnitPosition",
  "setUnitWaypoint",
  "setUnitHp",
  "setUnitSlow",
  "setUnitBurn",
  "setUnitFrozen",
] as const;
