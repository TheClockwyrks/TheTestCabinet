// Deepcore — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// `specs/instrumentation.md` fixes the surface the game instance's `initialize`
// returns, and this module is that specification written down as types: the
// operations, their arguments, the snapshot shape, and the version. It is the
// ONLY description of the surface the validators read. The build implements the
// surface under whatever module it likes and declares its own type for it — the
// `D` of its `GameInstance<D>`; nothing here imports it, and the harness reaches
// the object itself through `engine.debug` alone. So a build whose surface
// departs from the specification is held against the specification, not against
// its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. Directly. Each operation is a method that acts on
// the live game at the moment of the call, through the same systems play uses: a
// POSE or a CONTROL takes only the arguments its heading names, arranges the
// running game, and returns NOTHING (`setFuel(40)`, `sell()`), and a READING
// takes only the arguments its heading names and returns plain data built at the
// call (`snapshot()`, `tileAt(col, row)`). No state is threaded through any of
// them: the world is the engine's, the state is the world's, and the surface
// reaches both at each call. So a check writes `h.debug.setFuel(40)` and
// `h.debug.snapshot()` with nothing in between, and `harness.ts` holds the object
// the build returned rather than a wrapper over it.
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

/* -------------------------------------------------------------------------- */
/* The vocabularies the operations take                                       */
/* -------------------------------------------------------------------------- */
//
// Read off `constants.ts`, this project's own transcription of the seeded
// specification, so the vocabulary a check names is the vocabulary the SPECS
// state rather than the one a build's tree happens to hold. Nothing of the
// BUILD's is imported here — `src/constants.ts`, `src/game.ts`, and whatever
// module a build writes its surface in are all out of reach of this file.

import type {
  BandName,
  ComponentId,
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
 * A hit region on the stage, in the stage's LOGICAL units, as `menuItemRect` and
 * `controlRect` report one.
 *
 * `x` and `y` are the region's top-left corner and `w` and `h` its size: the
 * region a pointer or a touch contact drives that item or that control from.
 * `specs/overview.md` hands the layout to the build, so this is how a build
 * reports where it put each one and a check aims at what the build drew rather
 * than at a coordinate the specification never stated.
 */
export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The on-screen controls `controlRect` reports, by the names
 * `specs/instrumentation.md` gives them.
 *
 * Each is the named counterpart of one of the controls under The controls, or
 * one of the three the status bar carries.
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
 * What a control acts on: an ore, a field supply, an upgrade track, or nothing.
 *
 * A control that acts on nothing further takes `null`.
 */
export type ControlSubject = Ore | ItemId | UpgradeTrack | null;

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
   * The expedition's own clock, in seconds: the elapsed time the summary
   * reports. It rests at `0` until an expedition begins.
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
  nextTeleportHeight: number | null;
  nextTeleportSpeed: number | null;
  summary: SummaryView | null;
}

/* -------------------------------------------------------------------------- */
/* The operations                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose and each control acts on the live game and returns nothing — the
 * instance holds the engine, `engine.world` is the world open at the call, and
 * the game runs in one world for the whole session, so a pose that changes the
 * screen takes effect at the call rather than riding a level transition. Each
 * reading returns plain data built at the call and changes nothing.
 *
 * The surface names no state type, because there is no state to name: nothing
 * here imports the build, and the build's own state class is reached — where a
 * check needs it at all — off `world.state` rather than through this file.
 */
export interface DeepcoreDebugApi {
  /** `DEEPCORE_DEBUG_VERSION`, a plain number rather than an operation. */
  version: number;

  /* ---- Readings. Every one is pure and changes nothing. ---- */

  snapshot(): DeepcoreSnapshot;
  tileAt(col: number, row: number): TileRead;
  /** The nearest cell of that kind to the miner, or `null` where the mine holds none. */
  findTile(kind: TileKind): CellRef | null;
  buildings(): BuildingBox[];
  /**
   * The hit region of item `index` on the menu the current screen shows.
   *
   * `null` on `in-mine`, which shows no menu, and where `index` names no item of
   * the menu the current screen shows.
   */
  menuItemRect(index: number): HitRect | null;
  /**
   * The hit region of the on-screen control `control`, for the ore, upgrade
   * track, or field supply `subject` where the control takes one and `null`
   * where it acts on nothing further.
   *
   * `null` while the control is not drawn, including while the panel that
   * carries it is closed.
   */
  controlRect(control: ControlName, subject: ControlSubject): HitRect | null;

  /* ---- Restoring the world ---- */

  /**
   * Restore the whole observable state to its title-screen value. The save slot is untouched, and so is the engine's mute bit.
   */
  reset(): void;
  /** Regenerate the grid at the current world size, leaving everything else. */
  generateMine(): void;
  /** Open every playable cell below `row 0` and above the Core chamber. */
  clearMine(): void;
  /** Empty the cargo bay, selling nothing. */
  clearCargo(): void;
  /** Set the held count of all six field supplies to `0`, using nothing. */
  clearItems(): void;

  /* ---- Posing the mine ---- */

  /** One cell's kind, at that band's full health where the kind is minable. */
  setTile(col: number, row: number, kind: TileKind): void;
  /** One cell to an ore vein holding `ore`, at its band's full health. */
  setOreTile(col: number, row: number, ore: Ore): void;
  /** One cell to a material node, at its band's full health. */
  setMaterialTile(col: number, row: number, material: Material): void;
  /** One minable cell's remaining health, above `0` and at most `BAND_HEALTH`. */
  setTileHealth(col: number, row: number, health: number): void;
  /** A jettisoned Core Sample on an open tunnel cell, its timer at `CORE_TIMER`. */
  placeCoreSample(col: number, row: number): void;

  /* ---- Posing the miner ---- */

  /** The top-left corner of the miner's box, in world units. Changes no cell. */
  setMinerPosition(x: number, y: number): void;
  setMinerVelocity(vx: number, vy: number): void;
  setFacing(facing: Facing): void;
  setFuel(value: number): void;
  setHull(value: number): void;
  /** Whether the miner's body moves. Everything else about it carries on. */
  setMinerTravel(enabled: boolean): void;
  /** Whether the miner's drill cuts. Everything else about it carries on. */
  setMinerDrill(enabled: boolean): void;

  /* ---- Posing the expedition ---- */

  setScreen(screen: Screen): void;
  setPanel(panel: OpenPanel): void;
  setMenuIndex(index: number): void;
  setMode(mode: Mode): void;
  /**
   * The size and with it `coreRow`, RESIZING the mine onto the new depth rather
   * than emptying or regenerating it, exactly as `specs/instrumentation.md`'s
   * "Resizing the mine" states it cell by cell: every cell the two depths share
   * comes through untouched with its own kind, band, ore, material, and health;
   * a row past the new Core chamber is gone with its row, and a buried material
   * node with it; a row the old depth did not reach opens as an empty mine holds
   * it at that depth; the row at the new `coreRow` becomes the Core chamber. It
   * generates nothing, so a caller that wants terrain at a new depth follows it
   * with `generateMine`.
   */
  setWorldSize(size: WorldSize): void;
  setCredits(value: number): void;
  /** One track's tier. Fuel and hull held are clamped to the new maxima. */
  setTier(track: UpgradeTrack, tier: number): void;
  /** Units of one ore in the bay, ignoring the slot cap. */
  setCargo(ore: Ore, count: number): void;
  setMaterial(material: Material, count: number): void;
  /** `true` puts a Sample in the satchel at `CORE_TIMER` and requires none live. */
  setCoreCarried(carried: boolean): void;
  /** Seconds left on the live Sample's timer, above `0`. Requires one live. */
  setCoreTimer(seconds: number): void;
  setItemCount(item: ItemId, count: number): void;
  /** How many components are installed, `0` through `5`, in checklist order. */
  setRocketInstalled(count: number): void;
  /** Whether the one-time notice has already been raised. It raises no card. */
  setNoticeFired(hazard: Hazard, fired: boolean): void;
  /** The carried lead, within `[-CAM_LEAD_MAX, CAM_LEAD_MAX]`. */
  setCameraLead(lead: number): void;
  /**
   * The expedition's elapsed time, in seconds, at least `0` — the clock the
   * summary reports. It advances nothing else.
   */
  setElapsed(seconds: number): void;
  clearSave(): void;

  /* ---- Posing the Quantum Teleporter ---- */

  /**
   * The height, in tiles above the camp ground, the next Quantum Teleporter use
   * places the miner at, from `1` to `8`, or `null` to leave it to the draw.
   */
  setNextTeleportHeight(tiles: number | null): void;
  /**
   * The downward speed, in units per second, the next Quantum Teleporter use
   * gives the miner, from `150` to `700`, or `null` to leave it to the draw.
   */
  setNextTeleportSpeed(speed: number | null): void;

  /* ---- The controls: the named counterparts of the on-screen ones ---- */

  /** Discard one unit of that ore. The unit is lost. */
  dropOre(ore: Ore): void;
  sell(): void;
  buyFuel(): void;
  fillFuel(): void;
  buyRepair(): void;
  repairFull(): void;
  buyUpgrade(track: UpgradeTrack): void;
  buyItem(item: ItemId): void;
  useItem(item: ItemId): void;
  jettison(): void;
  fabricate(): void;
  launch(): void;
  save(): void;
  dismissNotice(): void;
}

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the world, so the specification names them: a check that
 * sweeps the surface calls a reading for its value and a pose for its effect.
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
  // Posing the Quantum Teleporter
  "setNextTeleportHeight",
  "setNextTeleportSpeed",
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
