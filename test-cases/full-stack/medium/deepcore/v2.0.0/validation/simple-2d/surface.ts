// Deepcore — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// `specs/instrumentation.md` fixes the surface a build's `initialize` returns
// beside its state, as the pair `[state, debug]`, and this module is that
// specification written down as types: the operations, their arguments, the
// snapshot shape, and the version. It is the ONLY description of the surface the
// validators read. The build implements the surface under whatever module it
// likes and declares its own types for it; nothing here imports them, and the
// harness reaches the object itself through `engine.debug` alone. So a build
// whose surface departs from the specification is held against the
// specification, not against its own idea of what it wrote.
//
// EVERY OPERATION TAKES THE STATE FIRST. That is the one difference between this
// file and its counterpart under the engineless project next door, and it belongs
// to the engine rather than to the case: the engine holds the state by value and
// hands every reader a `DeepReadonly` view, so nothing on the surface holds a
// writable state. A POSE takes the current state and returns the next one
// (`setFuel(state, 40)`), and a READING takes the current state and returns what
// it read (`snapshot(state)`). A caller drives a pose through
// `engine.apply((s) => debug.setFuel(s, 40))` and a reading against
// `engine.state`. `harness.ts` is what gives a check the imperative reading of
// that — `h.debug.setFuel(40)`, `h.debug.snapshot()` — so the suites here and the
// engineless ones next door are the same suites.
//
// THE SNAPSHOT SHAPE IS IDENTICAL UNDER EVERY ENGINE, by design: that is what
// makes a score under one comparable with a score under another. What this
// engine's surface does NOT carry is the clock, the keyboard, and the mute
// toggle, because the engine owns all three: there is no `setAutoStep`, no
// `advance`, no `keyDown`/`keyUp`/`press`, and no `setMuted`.
//
// THE SURFACE IS ATOMIC BY DESIGN. Every pose sets one field, every reading
// returns one thing, and there is no operation that arranges a situation. So
// there is nothing here that opens a panel at a building, sinks a shaft, or walks
// the miner to a wall: a scenario is built from these operations, and where more
// than one check builds the same one it lives in `harness.ts`.

import type { DeepReadonly } from "ts-essentials";

/* -------------------------------------------------------------------------- */
/* The vocabularies the operations take                                       */
/* -------------------------------------------------------------------------- */
//
// Read back off this project's own `constants.ts`, which transcribes each of these
// lists from the specification that fixes it, so the vocabulary a check names is
// the vocabulary the specification named. Nothing of the BUILD's is imported here
// — `src/constants.ts`, `src/game.ts`, and whatever module a build writes its
// surface in are all out of reach of this file.

import type {
  BandName,
  ComponentId,
  ControlName,
  DeathCause as DeathCauseId,
  Facing,
  ItemId,
  MaterialId,
  MinerState,
  Mode,
  NoticeHazard,
  OreId,
  PanelId,
  ScreenName,
  TileKind,
  TrackName,
  WorldSize,
} from "./constants";

/** One of the four depth bands. */
export type Band = BandName;
/** One of the ten ores or three gemstones, by id. */
export type Ore = OreId;
/** One of the two exotic materials. */
export type Material = MaterialId;
/** One of the eight screens. */
export type Screen = ScreenName;
/** One of the six panels. */
export type Panel = PanelId;
/** One of the seven upgrade tracks. */
export type UpgradeTrack = TrackName;
/** One of the five rocket components, by id. */
export type RocketComponentId = ComponentId;
/** One of the two hazards a one-time notice is raised for. */
export type Hazard = NoticeHazard;
/** One of the sixteen on-screen controls `controlRect` reports a region for. */
export type Control = ControlName;
export type { ControlName };
/**
 * What a control acts on: an ore, a field supply, an upgrade track, or nothing.
 *
 * A control that acts on nothing further takes `null`.
 */
export type ControlSubject = OreId | ItemId | TrackName | null;
/** How a death ended the expedition, as the summary reports it. */
export type DeathCause = DeathCauseId;

export type { Facing, ItemId, MinerState, Mode, TileKind, WorldSize };

/** The open panel, or `null` while none is open. */
export type OpenPanel = Panel | null;

/** Which way a cut is aimed. The drill never cuts upward. */
export type DrillDirection = "down" | "left" | "right";

/* -------------------------------------------------------------------------- */
/* What the readings return                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One cell's observable state, as `tileAt(state, col, row)` reports it.
 *
 * `band` is `null` for a cell outside the four bands; `ore` is set on an ore cell
 * and `material` on a material node, both `null` otherwise; `health` and
 * `maxHealth` are `null` for a cell that is not minable. A cell outside the grid
 * reads as `bedrock` with every other field `null`.
 */
export interface TileRead {
  kind: TileKind;
  band: Band | null;
  ore: Ore | null;
  material: Material | null;
  health: number | null;
  maxHealth: number | null;
}

/** One surface building's footprint in world units, as `buildings()` reports it. */
export interface BuildingBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A hit region in the stage's logical units, as `menuItemRect` and `controlRect`
 * report one.
 *
 * `x` and `y` are the region's top-left corner and `w` and `h` its size: the
 * region a pointer or a touch contact drives that item or that control from
 * (`specs/controls.md`). The layout is the build's, so this is how the build
 * reports where it put each one.
 */
export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A cell address, as `findTile` and `coreGround` report one. */
export interface CellRef {
  col: number;
  row: number;
}

/** The cut in progress, or `null` while the drill is not cutting. */
export interface DrillingView {
  col: number;
  row: number;
  dir: DrillDirection;
  /** `0` to `1` as the target cell's health drains. */
  progress: number;
}

/** The miner, as the snapshot reports it. */
export interface MinerView {
  /** The top-left of the miner's box, in world units. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  col: number;
  row: number;
  facing: Facing;
  state: MinerState;
  grounded: boolean;
  /** The two faculties, each held on its own. */
  travel: boolean;
  drill: boolean;
  fuel: number;
  maxFuel: number;
  hull: number;
  maxHull: number;
  /** Derived: the load fraction is `1` or more. */
  overloaded: boolean;
  drilling: DrillingView | null;
}

/** The cargo bay: slots limit what is picked up, weight whether it can be lifted. */
export interface CargoView {
  slotsUsed: number;
  slotCap: number;
  loadKg: number;
  liftLimitKg: number;
  /** Held ore and gemstones by id, nonzero entries only. */
  ore: Partial<Record<Ore, number>>;
}

/** The satchel: the two exotic materials and the Core Sample, none of them cargo. */
export interface SatchelView {
  resonite: number;
  cryenite: number;
  coreSample: boolean;
}

/** One tier per upgrade track. */
export type TiersView = Record<UpgradeTrack, number>;

/** One held count per field supply. */
export type ItemsView = Record<ItemId, number>;

/** The rocket checklist. */
export interface RocketView {
  installed: RocketComponentId[];
  nextComponent: RocketComponentId | null;
}

/**
 * The scanner's lock.
 *
 * `locked` is `false`, with the direction zero and the distance `null`, whenever
 * nothing needed is in range — which is also when the indicator is hidden.
 */
export interface ScannerView {
  locked: boolean;
  target: Material | null;
  dirX: number;
  dirY: number;
  distanceTiles: number | null;
}

/**
 * The hazard notice card, or `null` while none is armed or on screen.
 *
 * `shown` is `true` only while the card is drawn, so it is `false` over the
 * `NOTICE_DELAY` between the hit and the card appearing.
 */
export interface NoticeView {
  hazard: Hazard;
  shown: boolean;
}

/** The expedition summary, `null` until the expedition ends. */
export interface SummaryView {
  deepestDepthMeters: number;
  creditsEarned: number;
  elapsedSeconds: number;
  mode: Mode;
  componentsInstalled: number;
  deathCause: DeathCause | null;
}

/**
 * The whole observable state, as `snapshot(state)` returns it.
 *
 * The shape is fixed and every field is present on every screen: a field the
 * current screen does not use reports its resting value rather than going
 * missing.
 */
export interface DeepcoreSnapshot {
  version: number;
  screen: Screen;
  panel: OpenPanel;
  mode: Mode;
  worldSize: WorldSize;
  /** The deepest row at the current world size. */
  coreRow: number;
  /** The screen's highlighted menu item, from `0`; rests at `0` on `in-mine`. */
  menuIndex: number;
  /** The game's readable copy of the engine's mute bit, refreshed every update. */
  muted: boolean;
  /** Accumulated game time, in seconds, on every screen. */
  simTime: number;
  /**
   * The expedition's own clock, in seconds. It rests at `0` until an expedition
   * begins, and the summary's `elapsedSeconds` is the value it holds when the
   * expedition ends.
   */
  elapsedSeconds: number;
  hasSave: boolean;
  credits: number;
  creditsEarned: number;
  depthMeters: number;
  deepestDepthMeters: number;
  /** Seconds left on a live Core Sample, else `null`. */
  coreTimer: number | null;
  coreGround: CellRef | null;
  camera: {
    /** The world point drawn at the viewport corner. */
    x: number;
    y: number;
    /** The carried vertical lead, positive downward. */
    lead: number;
  };
  miner: MinerView;
  cargo: CargoView;
  satchel: SatchelView;
  tiers: TiersView;
  items: ItemsView;
  rocket: RocketView;
  scanner: ScannerView;
  notice: NoticeView | null;
  noticesFired: { gas: boolean; lava: boolean };
  summary: SummaryView | null;
}

/* -------------------------------------------------------------------------- */
/* The operations                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The surface a build returns beside its state from `initialize`, over the
 * build's own state type `S`.
 *
 * Each pose and each control is a transition — the current state in, the next
 * state out — and each reading is a reading of the current state. None of them
 * touches the state it was handed: `DeepReadonly<S>` is the view the engine hands
 * out, and the compiler is what says a pose returns a new value rather than
 * mutating one.
 *
 * The surface is generic over the build's state type because this module imports
 * nothing of the build: `harness.ts` binds it to the state the build declared,
 * and the `Driver` there is what gives the checks the imperative reading over the
 * pure shape declared here.
 */
export interface DeepcoreDebugApi<S = unknown> {
  /** `DEEPCORE_DEBUG_VERSION`, a plain number rather than an operation. */
  version: number;

  /* ---- Readings. Every one is pure and changes nothing. ---- */

  snapshot(state: DeepReadonly<S>): DeepcoreSnapshot;
  tileAt(state: DeepReadonly<S>, col: number, row: number): TileRead;
  /** The nearest cell of that kind to the miner, or `null` where the mine holds none. */
  findTile(state: DeepReadonly<S>, kind: TileKind): CellRef | null;
  buildings(state: DeepReadonly<S>): BuildingBox[];
  /**
   * The hit region of item `index` on the menu the current screen shows, and
   * `null` on `in-mine` or where `index` names no item of that menu.
   */
  menuItemRect(state: DeepReadonly<S>, index: number): HitRect | null;
  /**
   * The hit region of the on-screen control `control`, for the ore, upgrade
   * track, or field supply `subject` where the control takes one and `null`
   * where it takes none. `null` while the control is not drawn, including while
   * the panel that carries it is closed.
   */
  controlRect(
    state: DeepReadonly<S>,
    control: Control,
    subject: string | null,
  ): HitRect | null;

  /* ---- Restoring the world ---- */

  /**
   * Restore the whole observable state to its title-screen value, and seed the
   * generator. The save slot is untouched, and so is the engine's mute bit.
   */
  reset(state: DeepReadonly<S>, options?: { seed?: number }): S;
  /** Regenerate the grid at the current world size, leaving everything else. */
  generateMine(state: DeepReadonly<S>): S;
  /** Open every playable cell below `row 0` and above the Core chamber. */
  clearMine(state: DeepReadonly<S>): S;
  /** Empty the cargo bay, selling nothing. */
  clearCargo(state: DeepReadonly<S>): S;
  /** Set the held count of all six field supplies to `0`, using nothing. */
  clearItems(state: DeepReadonly<S>): S;

  /* ---- Posing the mine ---- */

  /** One cell's kind, at that band's full health where the kind is minable. */
  setTile(state: DeepReadonly<S>, col: number, row: number, kind: TileKind): S;
  /** One cell to an ore vein holding `ore`, at its band's full health. */
  setOreTile(state: DeepReadonly<S>, col: number, row: number, ore: Ore): S;
  /** One cell to a material node, at its band's full health. */
  setMaterialTile(
    state: DeepReadonly<S>,
    col: number,
    row: number,
    material: Material,
  ): S;
  /** One minable cell's remaining health, above `0` and at most `BAND_HEALTH`. */
  setTileHealth(
    state: DeepReadonly<S>,
    col: number,
    row: number,
    health: number,
  ): S;
  /** A jettisoned Core Sample on an open tunnel cell, its timer at `CORE_TIMER`. */
  placeCoreSample(state: DeepReadonly<S>, col: number, row: number): S;

  /* ---- Posing the miner ---- */

  /** The top-left corner of the miner's box, in world units. Changes no cell. */
  setMinerPosition(state: DeepReadonly<S>, x: number, y: number): S;
  setMinerVelocity(state: DeepReadonly<S>, vx: number, vy: number): S;
  setFacing(state: DeepReadonly<S>, facing: Facing): S;
  setFuel(state: DeepReadonly<S>, value: number): S;
  setHull(state: DeepReadonly<S>, value: number): S;
  /** Whether the miner's body moves. Everything else about it carries on. */
  setMinerTravel(state: DeepReadonly<S>, enabled: boolean): S;
  /** Whether the miner's drill cuts. Everything else about it carries on. */
  setMinerDrill(state: DeepReadonly<S>, enabled: boolean): S;

  /* ---- Posing the expedition ---- */

  setScreen(state: DeepReadonly<S>, screen: Screen): S;
  setPanel(state: DeepReadonly<S>, panel: OpenPanel): S;
  setMenuIndex(state: DeepReadonly<S>, index: number): S;
  setMode(state: DeepReadonly<S>, mode: Mode): S;
  /**
   * The size and with it `coreRow`, resizing the mine onto the new depth the way
   * an array is resized rather than emptying or regenerating it
   * (`specs/instrumentation.md`, Resizing the mine).
   *
   * Every cell the two depths share comes through untouched, keeping its own
   * kind, band, ore, material, and remaining health, and a buried material node
   * above the new Core chamber comes through with its cell. Rows past the new
   * Core chamber go with their rows. Rows the old depth did not reach open as an
   * empty mine holds them at that depth, and the row at the new `coreRow`
   * becomes the Core chamber. It generates nothing.
   */
  setWorldSize(state: DeepReadonly<S>, size: WorldSize): S;
  setCredits(state: DeepReadonly<S>, value: number): S;
  /** One track's tier. Fuel and hull held are clamped to the new maxima. */
  setTier(state: DeepReadonly<S>, track: UpgradeTrack, tier: number): S;
  /** Units of one ore in the bay, ignoring the slot cap. */
  setCargo(state: DeepReadonly<S>, ore: Ore, count: number): S;
  setMaterial(state: DeepReadonly<S>, material: Material, count: number): S;
  /** `true` puts a Sample in the satchel at `CORE_TIMER` and requires none live. */
  setCoreCarried(state: DeepReadonly<S>, carried: boolean): S;
  /** Seconds left on the live Sample's timer, above `0`. Requires one live. */
  setCoreTimer(state: DeepReadonly<S>, seconds: number): S;
  setItemCount(state: DeepReadonly<S>, item: ItemId, count: number): S;
  /** How many components are installed, `0` through `5`, in checklist order. */
  setRocketInstalled(state: DeepReadonly<S>, count: number): S;
  /** Whether the one-time notice has already been raised. It raises no card. */
  setNoticeFired(state: DeepReadonly<S>, hazard: Hazard, fired: boolean): S;
  /** The carried lead, within `[-CAM_LEAD_MAX, CAM_LEAD_MAX]`. */
  setCameraLead(state: DeepReadonly<S>, lead: number): S;
  /**
   * The expedition's elapsed time, at least `0`: the clock `elapsedSeconds`
   * reports and the summary shows. It moves no other clock and advances nothing.
   */
  setElapsed(state: DeepReadonly<S>, seconds: number): S;
  clearSave(state: DeepReadonly<S>): S;

  /* ---- The controls: the named counterparts of the on-screen ones ---- */

  /** Discard one unit of that ore. The unit is lost. */
  dropOre(state: DeepReadonly<S>, ore: Ore): S;
  sell(state: DeepReadonly<S>): S;
  buyFuel(state: DeepReadonly<S>): S;
  fillFuel(state: DeepReadonly<S>): S;
  buyRepair(state: DeepReadonly<S>): S;
  repairFull(state: DeepReadonly<S>): S;
  buyUpgrade(state: DeepReadonly<S>, track: UpgradeTrack): S;
  buyItem(state: DeepReadonly<S>, item: ItemId): S;
  useItem(state: DeepReadonly<S>, item: ItemId): S;
  jettison(state: DeepReadonly<S>): S;
  fabricate(state: DeepReadonly<S>): S;
  launch(state: DeepReadonly<S>): S;
  save(state: DeepReadonly<S>): S;
  dismissNotice(state: DeepReadonly<S>): S;
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
  "tileAt",
  "findTile",
  "buildings",
  "menuItemRect",
  "controlRect",
] as const satisfies readonly (keyof DeepcoreDebugApi)[];

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine.
 *
 * The clock, the keyboard, and the mute toggle are deliberately absent: the
 * engine owns all three, so the engineless project's `setAutoStep`, `advance`,
 * `keyDown`, `keyUp`, `press`, and `setMuted` have no counterpart here.
 *
 * The harness probes for these before it drives anything, so a build that
 * returned a partial surface fails the points that reach for it naming what is
 * missing, rather than throwing a `TypeError` several frames into a scenario.
 */
export const REQUIRED_OPS = [
  // Readings
  "snapshot",
  "tileAt",
  "findTile",
  "buildings",
  "menuItemRect",
  "controlRect",
  // Restoring the world
  "reset",
  "generateMine",
  "clearMine",
  "clearCargo",
  "clearItems",
  // Posing the mine
  "setTile",
  "setOreTile",
  "setMaterialTile",
  "setTileHealth",
  "placeCoreSample",
  // Posing the miner
  "setMinerPosition",
  "setMinerVelocity",
  "setFacing",
  "setFuel",
  "setHull",
  "setMinerTravel",
  "setMinerDrill",
  // Posing the expedition
  "setScreen",
  "setPanel",
  "setMenuIndex",
  "setMode",
  "setWorldSize",
  "setCredits",
  "setTier",
  "setCargo",
  "setMaterial",
  "setCoreCarried",
  "setCoreTimer",
  "setItemCount",
  "setRocketInstalled",
  "setNoticeFired",
  "setCameraLead",
  "setElapsed",
  "clearSave",
  // The controls
  "dropOre",
  "sell",
  "buyFuel",
  "fillFuel",
  "buyRepair",
  "repairFull",
  "buyUpgrade",
  "buyItem",
  "useItem",
  "jettison",
  "fabricate",
  "launch",
  "save",
  "dismissNotice",
] as const satisfies readonly (keyof DeepcoreDebugApi)[];
