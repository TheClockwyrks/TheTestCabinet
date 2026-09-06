// Arc Foundry — the build's debug and automation surface, as types. CASE-PROVIDED.
//
// `specs/instrumentation.md` is the contract, and this file is that contract
// written as TypeScript. Nothing here is imported from a build: an engineless run
// seeds no `src/` at all, so there is no module for a check to import, and a
// harness typed against whatever the build happened to declare would be typed
// against the thing it is grading. So the surface is DECLARED here, from the
// specification, and the harness reads no other description of it.
//
// TWO SHAPES OF THE SAME SURFACE. `FoundryDebugApi` is the surface as the build
// installs it: plain, synchronous operations on `window.__foundry`. Everything
// crossing into the page is asynchronous, though, so what the harness hands a
// check is {@link Driven}`<FoundryDebugApi>` — the same operations, each
// answering a promise. That is the whole of the difference between a suite here
// and its counterpart under an engine.

import type {
  ComboId,
  ComponentType,
  DifficultyId,
  MapId,
  MenuAction,
  PanelAction,
  Phase,
  PressAction,
  Screen,
  SpawnType,
  StatusAction,
  StructureKind,
  Targeting,
} from "./constants";

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__foundry";

/** The version the surface reports (`FOUNDRY_DEBUG_VERSION`). */
export const FOUNDRY_DEBUG_VERSION = 5;

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, including the two clock operations and the five input operations that
 * exist only here.
 *
 * A build missing any of them cannot be driven at all, so the harness reports the
 * absence once, as the build's own fault, rather than throwing a `TypeError`
 * inside whichever check reached for it first.
 */
export const REQUIRED_OPS = [
  // The clock.
  "setAutoStep",
  "advance",
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
  // Input.
  "pointerMove",
  "pointerDown",
  "pointerUp",
  "touchStart",
  "touchMove",
  "touchEnd",
  "keyDown",
  "keyUp",
] as const;

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
 * of a reported, non-disabled rectangle activates it. Because `specs/ui.md` fixes
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
 * Its `action` is one of `PRESS_ACTIONS`. The refinement control's `disabled`
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
 * The surface as the build installs it on `window.__foundry`.
 *
 * Every operation is atomic: it sets one thing, reads one thing, or moves the
 * clock. A pose sets one thing and leaves the rest of the game as it stands, so a
 * caller that wants several things arranged makes several calls. A pose that
 * stands for a control a player operates commits through that same control, so it
 * is REFUSED wherever the control is refused; an argument outside its stated
 * domain THROWS instead.
 */
export interface FoundryDebugApi {
  version: number;

  /* The clock. */
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

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
  setOverlay(overlay: "combos" | "damage", open: boolean): void;

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

  /* Input. */
  pointerMove(x: number, y: number): void;
  pointerDown(x: number, y: number): void;
  pointerUp(): void;
  touchStart(x: number, y: number): void;
  touchMove(x: number, y: number): void;
  touchEnd(): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
}

/**
 * The same surface reached from outside the page: every operation answers a
 * promise, and the plain `version` field is dropped, because a value cannot be
 * read across the boundary without a crossing of its own (the harness's `probe`
 * reads it).
 */
export type Driven<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown
    ? K
    : never]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<R>
    : never;
};

/** The surface as a check drives it. */
export type DrivenFoundryDebugApi = Driven<FoundryDebugApi>;
