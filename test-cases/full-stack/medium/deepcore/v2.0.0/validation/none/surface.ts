// Deepcore — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// `specs/instrumentation.md` fixes the surface an engineless build installs on
// `window.__deepcore` as soon as the game has initialized, and this module is that
// specification written down as types: the operations, their arguments, the
// snapshot shape, and the version. It is the ONLY description of the surface the
// validators read. The build implements the surface under whatever module it
// likes and declares its own types for it; nothing here imports them, and the
// harness reaches the object itself over the page's `window.__deepcore` alone. So
// a build whose surface departs from the specification is held against the
// specification, not against its own idea of what it wrote.
//
// EVERY OPERATION IS ASYNC HERE, AND NOWHERE IN THE SPECIFICATION. That is the
// one difference between this file and the operations as an engineless build
// writes them, and it belongs to the harness rather than to the case: a call
// crosses a process boundary into Chromium and comes back as a promise. Under the
// two engines the identical surface is declared without the promises, and the
// suites there are the same suites with the `await`s dropped.
//
// THE SURFACE IS ATOMIC BY DESIGN. Every pose sets one field, every reading
// returns one thing, and there is no operation that arranges a situation. So
// there is nothing here that opens a panel at a building, sinks a shaft, or walks
// the miner to a wall: a scenario is built from these operations, and where more
// than one check builds the same one it lives in `harness.ts`.

/* -------------------------------------------------------------------------- */
/* The vocabularies the operations take                                       */
/* -------------------------------------------------------------------------- */

import type {
  Band,
  Facing,
  Hazard,
  ItemId,
  Material,
  Mode,
  MinerState,
  Ore,
  Panel,
  RocketComponentId,
  Screen,
  TileKind,
  UpgradeTrack,
  WorldSize,
} from "./constants";

export type {
  Band,
  Facing,
  Hazard,
  ItemId,
  Material,
  Mode,
  MinerState,
  Ore,
  Panel,
  RocketComponentId,
  Screen,
  TileKind,
  UpgradeTrack,
  WorldSize,
};

/** The open panel, or `null` while none is open. */
export type OpenPanel = Panel | null;

/** How a death ended the expedition, as the summary reports it. */
export type DeathCause = "fuel-out" | "hull-destroyed" | "core-detonation";

/** Which way a cut is aimed. The drill never cuts upward. */
export type DrillDirection = "down" | "left" | "right";

/* -------------------------------------------------------------------------- */
/* What the readings return                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One cell's observable state, as `tileAt(col, row)` reports it.
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

/**
 * A hit region in the stage's logical units, as `menuItemRect` and `controlRect`
 * report one.
 *
 * `x` and `y` are the region's top-left corner and `w` and `h` its size: the
 * region a pointer or a touch contact drives that item or that control from
 * (`specs/instrumentation.md`, Readings). The layout is the build's, so this is
 * the only thing that says where the build put one.
 */
export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The on-screen controls `controlRect` reports a region for, by the names
 * `specs/instrumentation.md` fixes.
 *
 * Thirteen are the named counterparts of the operations under The controls, and
 * the last three are the ones the status bar carries.
 */
export type ControlName =
  | "drop-ore"
  | "use-item"
  | "jettison"
  | "sell"
  | "buy-fuel"
  | "fill-fuel"
  | "buy-repair"
  | "repair-full"
  | "buy-upgrade"
  | "buy-item"
  | "fabricate"
  | "launch"
  | "dismiss-notice"
  | "inventory"
  | "pause"
  | "mute";

/**
 * What a control acts on, where it acts on something further.
 *
 * `"drop-ore"` takes an ore or gemstone id, `"use-item"` and `"buy-item"` a field
 * supply's id, and `"buy-upgrade"` an upgrade track's name. Every other control
 * takes `null`.
 */
export type ControlSubject = Ore | ItemId | UpgradeTrack;

/** One surface building's footprint in world units, as `buildings()` reports it. */
export interface BuildingBox {
  id: string;
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
 * The whole observable state, as `snapshot()` returns it.
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
  /** `false` while the caller clocks the game. Engineless builds alone. */
  autoStep: boolean;
  muted: boolean;
  /** Accumulated game time, in seconds, on every screen. */
  simTime: number;
  /** The expedition's own clock, in seconds. Rests at `0` until one begins. */
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
 * The surface, as a check drives it: every operation the specification requires,
 * each crossing into the page and so each a promise.
 *
 * `version` is the exception, because it is a plain number on the surface rather
 * than an operation; the harness reads it through `probe` instead of here.
 */
export interface DeepcoreDebugApi {
  /* ---- Readings. Every one is pure and changes nothing. ---- */

  snapshot(): Promise<DeepcoreSnapshot>;
  tileAt(col: number, row: number): Promise<TileRead>;
  /** The nearest cell of that kind to the miner, or `null` where the mine holds none. */
  findTile(kind: TileKind): Promise<CellRef | null>;
  buildings(): Promise<BuildingBox[]>;
  /**
   * The hit region of item `index` on the menu the current screen shows.
   *
   * `null` on `in-mine`, which shows no menu, and where `index` names no item of
   * the menu the current screen shows.
   */
  menuItemRect(index: number): Promise<HitRect | null>;
  /**
   * The hit region of one on-screen control, for the ore, upgrade track, or
   * field supply it acts on where it takes one, and `null` where it does not.
   *
   * `null` while the control is not drawn, including while the panel that
   * carries it is closed.
   */
  controlRect(
    control: ControlName,
    subject: ControlSubject | null,
  ): Promise<HitRect | null>;

  /* ---- The clock. Engineless builds alone: nothing else owns the loop. ---- */

  /** Take the game off real time, and give it back. */
  setAutoStep(enabled: boolean): Promise<void>;
  /**
   * Run `frames` whole frames covering `seconds` of game time, each an update
   * followed by a render. `frames` defaults to `1`.
   */
  advance(seconds: number, frames?: number): Promise<void>;

  /* ---- Input. A key put down stays down until it is let up. ---- */

  keyDown(code: string): Promise<void>;
  keyUp(code: string): Promise<void>;

  /* ---- Restoring the world ---- */

  /**
   * Restore the whole observable state to its title-screen value, and seed the
   * generator. `muted`, `autoStep`, and the save slot are untouched; every held
   * key is released.
   */
  reset(options?: { seed?: number }): Promise<void>;
  /**
   * Bring every reading this surface reports into agreement with the world as it
   * stands, without advancing anything.
   *
   * A build is free to work a derived reading out at the read or to keep it as a
   * stored copy, and this is what brings a stored copy back into agreement after
   * a pose: the miner's `grounded`, its `col` and `row`, `depthMeters`,
   * `overloaded`, the cargo's `slotsUsed`, and the scanner's lock all follow from
   * the miner, the grid, the cargo and the tiers. It moves no clock, runs no
   * system, fires nothing, and moves nothing to make a reading agree. Calling it
   * twice leaves the same state as calling it once.
   */
  reconcile(): Promise<void>;
  /** Regenerate the grid at the current world size, leaving everything else. */
  generateMine(): Promise<void>;
  /** Open every playable cell below `row 0` and above the Core chamber. */
  clearMine(): Promise<void>;
  /** Empty the cargo bay, selling nothing. */
  clearCargo(): Promise<void>;
  /** Set the held count of all six field supplies to `0`, using nothing. */
  clearItems(): Promise<void>;

  /* ---- Posing the mine ---- */

  /** One cell's kind, at that band's full health where the kind is minable. */
  setTile(col: number, row: number, kind: TileKind): Promise<void>;
  /** One cell to an ore vein holding `ore`, at its band's full health. */
  setOreTile(col: number, row: number, ore: Ore): Promise<void>;
  /** One cell to a material node, at its band's full health. */
  setMaterialTile(col: number, row: number, material: Material): Promise<void>;
  /** One minable cell's remaining health, above `0` and at most `BAND_HEALTH`. */
  setTileHealth(col: number, row: number, health: number): Promise<void>;
  /** A jettisoned Core Sample on an open tunnel cell, its timer at `CORE_TIMER`. */
  placeCoreSample(col: number, row: number): Promise<void>;

  /* ---- Posing the miner ---- */

  /** The top-left corner of the miner's box, in world units. Changes no cell. */
  setMinerPosition(x: number, y: number): Promise<void>;
  setMinerVelocity(vx: number, vy: number): Promise<void>;
  setFacing(facing: Facing): Promise<void>;
  setFuel(value: number): Promise<void>;
  setHull(value: number): Promise<void>;
  /** Whether the miner's body moves. Everything else about it carries on. */
  setMinerTravel(enabled: boolean): Promise<void>;
  /** Whether the miner's drill cuts. Everything else about it carries on. */
  setMinerDrill(enabled: boolean): Promise<void>;

  /* ---- Posing the expedition ---- */

  setScreen(screen: Screen): Promise<void>;
  setPanel(panel: OpenPanel): Promise<void>;
  setMenuIndex(index: number): Promise<void>;
  setMode(mode: Mode): Promise<void>;
  /**
   * The size and with it `coreRow`, resizing the mine onto the new depth rather
   * than emptying or regenerating it (`specs/instrumentation.md`, Resizing the
   * mine).
   *
   * Every cell the two depths share comes through untouched, with its own kind,
   * band, ore, material, and remaining health, and a buried material node above
   * the new Core chamber is kept with it. Rows past the new Core chamber are gone
   * with their rows; rows the old depth did not reach open as an empty mine holds
   * them at that depth, bedrock across columns `0` and `31` and open tunnel
   * across the playable columns, carrying the band the new depth gives the row;
   * the row at the new `coreRow` becomes the Core chamber, bedrock across the row
   * with the Core at `CORE_COL`; and the row that was the old Core chamber, where
   * the size gets deeper, opens as an ordinary row. It generates nothing.
   */
  setWorldSize(size: WorldSize): Promise<void>;
  setCredits(value: number): Promise<void>;
  /** One track's tier. Fuel and hull held are clamped to the new maxima. */
  setTier(track: UpgradeTrack, tier: number): Promise<void>;
  /** Units of one ore in the bay, ignoring the slot cap. */
  setCargo(ore: Ore, count: number): Promise<void>;
  setMaterial(material: Material, count: number): Promise<void>;
  /** `true` puts a Sample in the satchel at `CORE_TIMER` and requires none live. */
  setCoreCarried(carried: boolean): Promise<void>;
  /** Seconds left on the live Sample's timer, above `0`. Requires one live. */
  setCoreTimer(seconds: number): Promise<void>;
  setItemCount(item: ItemId, count: number): Promise<void>;
  /** How many components are installed, `0` through `5`, in checklist order. */
  setRocketInstalled(count: number): Promise<void>;
  /** Whether the one-time notice has already been raised. It raises no card. */
  setNoticeFired(hazard: Hazard, fired: boolean): Promise<void>;
  /** The carried lead, within `[-CAM_LEAD_MAX, CAM_LEAD_MAX]`. */
  setCameraLead(lead: number): Promise<void>;
  /**
   * The expedition's elapsed time, at least `0`: the clock `elapsedSeconds`
   * reports and the summary shows. It moves no other clock and advances nothing.
   */
  setElapsed(seconds: number): Promise<void>;
  clearSave(): Promise<void>;
  /** The audio mute toggle. Engineless builds alone. */
  setMuted(muted: boolean): Promise<void>;

  /* ---- The controls: the named counterparts of the on-screen ones ---- */

  /** Discard one unit of that ore. The unit is lost. */
  dropOre(ore: Ore): Promise<void>;
  sell(): Promise<void>;
  buyFuel(): Promise<void>;
  fillFuel(): Promise<void>;
  buyRepair(): Promise<void>;
  repairFull(): Promise<void>;
  buyUpgrade(track: UpgradeTrack): Promise<void>;
  buyItem(item: ItemId): Promise<void>;
  useItem(item: ItemId): Promise<void>;
  jettison(): Promise<void>;
  fabricate(): Promise<void>;
  launch(): Promise<void>;
  save(): Promise<void>;
  dismissNotice(): Promise<void>;
}

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, including the clock and input operations that exist only here.
 *
 * The harness probes for these before it drives anything, so a build that
 * installed a partial surface fails the points that reach for it naming what is
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
  // The clock
  "setAutoStep",
  "advance",
  // Input
  "keyDown",
  "keyUp",
  // Restoring the world
  "reset",
  "reconcile",
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
  "setMuted",
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
