// Arc Foundry — the build's debug and automation surface, as types. CASE-PROVIDED.
//
// `specs/instrumentation.md` is the contract, and this file is that contract
// written as TypeScript. Nothing here is imported from the build: the build
// declares its own type for the surface its game instance's `initialize` returns
// — the `D` of its `GameInstance<D>` — and what a check holds it to is the
// SPECIFICATION rather than whatever the build wrote. So the surface is DECLARED
// here, and `harness.ts` reads no other description of it — a build whose surface
// departs from the specification is held against the specification, and a check
// reaching for a missing operation fails on the point that needed it.
//
// WHAT IS IMPORTED, AND FROM WHERE. The identifier vocabularies below — the
// screens, the phases, the eight component types, the twelve combination towers,
// the five targeting priorities, the panel, menu and status actions — come from
// `./constants`, this project's own transcription of the figures the specs fix.
// They are NOT read out of the build's `src/constants.ts`: that module is seeded
// into the workspace but it sits in the build's tree, and a check that took its
// vocabulary from there would be holding the build to whatever the build's tree
// happened to say. The build's `src/game.ts` is imported by the harness for one
// thing only: the game object the engine is constructed over.
//
// HOW THE SURFACE IS DRIVEN. Directly. Each operation is a method acting on the
// LIVE world at the moment of the call — the instance holds the engine, and
// `engine.world` follows transitions — so a POSE takes only the arguments its own
// entry names, arranges the running game through the systems play uses, and
// returns nothing (`setCharge(500)`, `placeRock(10, 10)`), and a READING takes
// nothing and returns plain data built at the call (`snapshot()`,
// `panelButtons()`). No wrapper stands between a check and the object the build
// returned: a check writes `h.debug.setCharge(500)` and `h.debug.snapshot()`
// against the surface itself. `version` is a plain number.
//
// The surface names no state type, because the game's state lives in the
// framework objects the engine owns and the surface is the one value the build
// hands back. `harness.ts` parameterizes the engine with the type declared here,
// so `engine.debug` is the whole route from a check to the build's
// implementation.
//
// Arc Foundry runs in ONE world for the whole session and every screen is a value
// of the snapshot's `screen` field (specs/instrumentation.md), so a pose that
// changes the screen takes effect at the call rather than riding a level
// transition: a check poses and reads, with no frame in between.
//
// WHAT IS NOT HERE, AND WHY. The clock and the input operations. Under an engine
// they are the engine's: `engine.advance` moves the clock, and a key or a pointer
// press is an event dispatched at the engine's own surface, which the game reads
// through the actions it registered. `specs/instrumentation.md` says so, and a
// build that installed clock or input operations on its surface is not asked for
// them and never has them called.

import type {
  ComboId,
  ComponentType,
  DifficultyId,
  MapId,
  MenuAction,
  PanelAction,
  PhaseName,
  PressControl as PressAction,
  ScreenName,
  SpawnType,
  StatusControl as StatusAction,
  StructureKind,
  TargetingPriority,
  Tier,
} from "./constants";

export { FOUNDRY_DEBUG_VERSION } from "./constants";
export type {
  ComboId,
  ComponentType,
  DifficultyId,
  MapId,
  MenuAction,
  PanelAction,
  SpawnType,
  StatusAction,
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

/**
 * The status bar's reads, as `specs/instrumentation.md` names them.
 *
 * The four the bar always carries, then the two `specs/hud.md` shows only while
 * they apply: the `PAUSED` read and the finale's `OVERLOAD` read.
 */
export type ReadoutName =
  | "charge"
  | "integrity"
  | "wave"
  | "maze-length"
  | "paused"
  | "overload";

/** The three states `specs/hud.md` fixes for a recipe's ingredient. */
export type IngredientState = "selected" | "owned" | "missing";

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
 * One of the status bar's READS — what it draws that is not a control.
 *
 * `specs/hud.md` fixes the bar's reads and their left-to-right order and leaves
 * each one's rectangle to the build, so this is how a check finds a read without
 * knowing where it was drawn. `charge`, `integrity`, `wave` and `maze-length` are
 * the four the bar always carries; `paused` and `overload` are the two conditional
 * reads, present only on the frames the bar is drawing them.
 *
 * The rectangle is where the read is drawn, so a pointer standing at its center is
 * over it — which is what the maze-length hover of `specs/controls.md` acts on.
 */
export interface StatusReadout {
  readout: ReadoutName;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One ingredient cell the recipe book drew.
 *
 * `specs/hud.md` requires every ingredient of every recipe to be drawn in one of
 * three states, told apart at a glance, and leaves the book's layout to the build.
 * So the build reports which cell it drew where and in which state, and a check
 * decides the state from the report and the "at a glance" half from the pixels
 * inside the reported rectangle.
 *
 * `combo` is the recipe's combination tower and `ingredient` that ingredient's
 * index within the recipe, counted from `0` in the order `specs/combinations.md`
 * lists it, so a recipe naming the same type twice is still two cells.
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
  /** The wave's clear-and-pay resolution is held by `setWaveHold`. */
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
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose acts on the live world at the moment it is called and returns
 * nothing; each reading takes nothing and returns plain data built at the call,
 * changing nothing.
 *
 * Every operation is ATOMIC: it sets one thing or reads one thing. A pose sets one
 * thing and leaves the rest of the game as it stands, so a caller that wants
 * several things arranged makes several calls, in the order it wants them. A pose
 * that stands for a control a player operates commits through that same control,
 * so it is REFUSED wherever the control is refused; an argument outside its stated
 * domain THROWS instead.
 */
export interface FoundryDebugApi {
  version: number;

  /* Readings. */
  snapshot(): FoundrySnapshot;
  panelButtons(): PanelButton[];
  pressControls(): PressButton[];
  menuButtons(): MenuButton[];
  statusControls(): StatusControl[];
  statusReadouts(): StatusReadout[];
  recipeEntries(): RecipeEntry[];

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
  waveCount(type: SpawnType): number;

  /**
   * One press roll at the current refinement level, exactly as a dropped rock
   * rolls. It lands nothing, spends nothing, and leaves an armed roll standing.
   */
  rollPress(): PressRoll;

  /* The run. */
  reset(): void;
  setMap(map: MapId): void;
  setDifficulty(difficulty: DifficultyId): void;
  startRun(): void;
  setScreen(screen: Screen): void;
  setMenuIndex(index: number): void;
  setPhase(phase: Phase): void;
  setWaveHold(held: boolean): void;
  setPaused(paused: boolean): void;
  setSpeed(multiplier: number): void;
  setOverlay(overlay: OverlayName, open: boolean): void;

  /* Resources and progress. */
  setCharge(amount: number): void;
  setIntegrity(amount: number): void;
  setRefinement(level: number): void;
  setWave(n: number): void;
  setStamps(n: number): void;

  /* Structures. */
  clearStructures(): void;
  setNextRoll(type: ComponentType, quality: number): void;
  clearNextRoll(): void;
  clearHeld(): void;
  placeRock(col: number, row: number): void;
  placeComponent(
    type: ComponentType,
    quality: number,
    col: number,
    row: number,
  ): void;
  placeCombo(combo: ComboId, col: number, row: number): void;
  placeBlocker(col: number, row: number): void;
  select(id: number): void;
  clearSelection(): void;
  addToCombineSet(id: number): void;
  clearCombineSet(): void;
  keep(id: number): void;
  downgrade(id: number): void;
  combine(id: number): void;
  dismantle(id: number): void;
  setTargeting(id: number, priority: Targeting): void;
  setComboLevel(id: number, level: number): void;
  setNextCrit(id: number, crit: boolean): void;
  clearNextCrit(id: number): void;
  upgradeQuality(): void;
  upgradeCombo(id: number): void;

  /* The Load. */
  clearUnits(): void;
  clearProjectiles(): void;
  spawnUnit(type: SpawnType): void;
  setUnitPosition(id: number, x: number, y: number): void;
  setUnitWaypoint(id: number, index: number): void;
  setUnitHp(id: number, hp: number): void;
  setUnitSlow(id: number, amount: number, seconds: number): void;
  setUnitBurn(id: number, dps: number, seconds: number): void;
  setUnitFrozen(id: number, frozen: boolean): void;
}

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the world, so the specification names them: a check that
 * sweeps the surface (`instrumentation/surface-complete`) calls a reading for its
 * value and a pose for its effect.
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
 * `instrumentation/surface-complete` reflects over, and a build missing any of
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
  "setPhase",
  "setWaveHold",
  "setPaused",
  "setSpeed",
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
