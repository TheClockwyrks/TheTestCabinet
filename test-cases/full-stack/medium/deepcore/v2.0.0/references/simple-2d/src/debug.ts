// Deepcore — the debugging and automation surface (specs/instrumentation.md).
//
// `createDebugApi()` builds it, `initialize` returns it beside the state it
// built as `[state, createDebugApi()]`, and the engine hands that same object
// back from `engine.debug` — the one way a caller reaches it. Nothing is
// installed on the page, the surface holds no state, and it is inert during
// normal play: nothing below runs until something calls it.
//
// EVERY OPERATION IS WRITTEN IN THE SHAPE OF `update`, because the engine holds
// the state by value and nothing holds a writable one. A POSE or a CONTROL takes
// the current state and returns the next — `setFuel(state, 40)` — and a caller
// drives it through `engine.apply((s) => debug.setFuel(s, 40))`; a READING takes
// the state and returns what it read — `snapshot(engine.state)`.
//
// A pose sets ONE thing and leaves the rest of the game as it stands; the game's
// own physics, drill, hazard, economy, and save rules then run from there exactly
// as they do in play, so nothing here fabricates an outcome. The controls are the
// named counterparts of the on-screen controls and run the very functions the
// panels run, which is why this module imports them rather than restating a rule.
//
// An argument outside the domain `specs/instrumentation.md` states for it fails
// loudly rather than leaving the caller to guess what the game did with it.

import {
  BAND_HEALTH,
  CAM_LEAD_MAX,
  CORE_TIMER,
  DEEPCORE_DEBUG_VERSION,
  DEFAULT_SEED,
  GEMSTONE_IDS,
  ITEM_IDS,
  MATERIALS,
  MAX_TIER,
  MODES,
  NOTICE_HAZARDS,
  ORE_IDS,
  PANELS,
  ROCKET_COMPONENTS,
  SCREENS,
  TILE_KINDS,
  TRACKS,
  WORLD_COLS,
  WORLD_SIZES,
} from "./constants";
import type {
  DeathCause,
  Facing,
  ItemId,
  MaterialId,
  Mode,
  NoticeHazard,
  OreId,
  PanelId,
  ScreenName,
  TileKind,
  TrackName,
  WorldSize,
  BandName,
} from "./constants";
import { placeCamera } from "./camera";
import { cutProgress } from "./drill";
import {
  buyFuel,
  buyRepair,
  buyUpgrade,
  dropOre,
  fillFuel,
  repairFull,
  sellCargo,
} from "./economy";
import { dismissNotice } from "./feedback";
import {
  cargoCap,
  depthMeters,
  liftLimitKg,
  loadKg,
  maxFuel,
  maxHull,
  overloaded,
  slotsUsed,
} from "./figures";
import {
  buildings,
  clearGroundItems,
  clearMine,
  regenerateMine,
  startLaunch,
  trySave,
} from "./flow";
import type { BuildingBox } from "./flow";
import { createInitialState, emptyCargo, emptyItems } from "./game";
import type { DeepcoreState, MaterialNode, ScanResult } from "./game";
import { buyItem, coreGround, jettisonCoreSample, useItem } from "./items";
import { menuItems } from "./menus";
import { isGrounded, minerCol, minerRow } from "./physics";
import { fabricate, nextComponent } from "./rocket";
import { clearSave as clearSaveSlot, hasSave } from "./save";
import { commit, draft, setDraftTile, tileAt as gridTileAt } from "./state";
import type { Draft } from "./state";
import { coreRowFor } from "./tuning";
import {
  freshCell,
  bandForRow,
  isMinableKind,
  makeMaterialTile,
  makeOreTile,
  tileMaxHealth,
} from "./world";
import type { DeepReadonly } from "ts-essentials";

/** The kinds `setTile` accepts. Ore and material cells have their own operations. */
const SETTABLE_KINDS: readonly TileKind[] = [
  "rock",
  "gas",
  "lava",
  "stone",
  "bedrock",
  "tunnel",
  "core",
];

/** Every mineral id, the ten ores then the three gemstones. */
const MINERAL_IDS: readonly OreId[] = [...ORE_IDS, ...GEMSTONE_IDS];

// ---- The shapes the readings report --------------------------------------

/** One cell's observable state. */
export interface TileRead {
  kind: TileKind;
  band: BandName | null;
  ore: OreId | null;
  material: MaterialId | null;
  health: number | null;
  maxHealth: number | null;
}

/** The whole observable state, as `snapshot` reports it. */
export interface DeepcoreSnapshot {
  version: number;
  screen: ScreenName;
  panel: PanelId | null;
  mode: Mode;
  worldSize: WorldSize;
  coreRow: number;
  menuIndex: number;
  muted: boolean;
  simTime: number;
  hasSave: boolean;
  credits: number;
  creditsEarned: number;
  depthMeters: number;
  deepestDepthMeters: number;
  coreTimer: number | null;
  coreGround: { col: number; row: number } | null;
  camera: { x: number; y: number; lead: number };
  miner: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    col: number;
    row: number;
    facing: Facing;
    state: DeepcoreState["miner"]["state"];
    grounded: boolean;
    travel: boolean;
    drill: boolean;
    fuel: number;
    maxFuel: number;
    hull: number;
    maxHull: number;
    overloaded: boolean;
    drilling: null | {
      col: number;
      row: number;
      dir: "down" | "left" | "right";
      progress: number;
    };
  };
  cargo: {
    slotsUsed: number;
    slotCap: number;
    loadKg: number;
    liftLimitKg: number;
    ore: Record<string, number>;
  };
  satchel: { resonite: number; cryenite: number; coreSample: boolean };
  tiers: Record<TrackName, number>;
  items: Record<ItemId, number>;
  rocket: {
    installed: string[];
    nextComponent: string | null;
  };
  scanner: {
    locked: boolean;
    target: MaterialId | null;
    dirX: number;
    dirY: number;
    distanceTiles: number | null;
  };
  notice: null | { hazard: NoticeHazard; shown: boolean };
  noticesFired: { gas: boolean; lava: boolean };
  summary: null | {
    deepestDepthMeters: number;
    creditsEarned: number;
    elapsedSeconds: number;
    mode: Mode;
    componentsInstalled: number;
    deathCause: DeathCause | null;
  };
}

/** A state as every operation is handed it. */
type Read = DeepReadonly<DeepcoreState>;

/** The debugging and automation surface. */
export interface DeepcoreDebugApi {
  version: number;

  // Readings
  snapshot(state: Read): DeepcoreSnapshot;
  tileAt(state: Read, col: number, row: number): TileRead;
  findTile(state: Read, kind: TileKind): { col: number; row: number } | null;
  buildings(state: Read): BuildingBox[];

  // Restoring the world
  reset(state: Read, options?: { seed?: number }): DeepcoreState;
  generateMine(state: Read): DeepcoreState;
  clearMine(state: Read): DeepcoreState;
  clearGroundItems(state: Read): DeepcoreState;
  clearCargo(state: Read): DeepcoreState;
  clearItems(state: Read): DeepcoreState;

  // Posing the mine
  setTile(state: Read, col: number, row: number, kind: TileKind): DeepcoreState;
  setOreTile(state: Read, col: number, row: number, ore: OreId): DeepcoreState;
  setMaterialTile(
    state: Read,
    col: number,
    row: number,
    material: MaterialId,
  ): DeepcoreState;
  setTileHealth(
    state: Read,
    col: number,
    row: number,
    health: number,
  ): DeepcoreState;
  placeCoreSample(state: Read, col: number, row: number): DeepcoreState;

  // Posing the miner
  setMinerPosition(state: Read, x: number, y: number): DeepcoreState;
  setMinerVelocity(state: Read, vx: number, vy: number): DeepcoreState;
  setFacing(state: Read, facing: Facing): DeepcoreState;
  setFuel(state: Read, value: number): DeepcoreState;
  setHull(state: Read, value: number): DeepcoreState;
  setMinerTravel(state: Read, enabled: boolean): DeepcoreState;
  setMinerDrill(state: Read, enabled: boolean): DeepcoreState;

  // Posing the expedition
  setScreen(state: Read, screen: ScreenName): DeepcoreState;
  setPanel(state: Read, panel: PanelId | null): DeepcoreState;
  setMenuIndex(state: Read, index: number): DeepcoreState;
  setMode(state: Read, mode: Mode): DeepcoreState;
  setWorldSize(state: Read, size: WorldSize): DeepcoreState;
  setCredits(state: Read, value: number): DeepcoreState;
  setTier(state: Read, track: TrackName, tier: number): DeepcoreState;
  setCargo(state: Read, ore: OreId, count: number): DeepcoreState;
  setMaterial(state: Read, material: MaterialId, count: number): DeepcoreState;
  setCoreCarried(state: Read, carried: boolean): DeepcoreState;
  setCoreTimer(state: Read, seconds: number): DeepcoreState;
  setItemCount(state: Read, item: ItemId, count: number): DeepcoreState;
  setRocketInstalled(state: Read, count: number): DeepcoreState;
  setNoticeFired(
    state: Read,
    hazard: NoticeHazard,
    fired: boolean,
  ): DeepcoreState;
  setCameraLead(state: Read, lead: number): DeepcoreState;
  clearSave(state: Read): DeepcoreState;

  // The controls
  dropOre(state: Read, ore: OreId): DeepcoreState;
  sell(state: Read): DeepcoreState;
  buyFuel(state: Read): DeepcoreState;
  fillFuel(state: Read): DeepcoreState;
  buyRepair(state: Read): DeepcoreState;
  repairFull(state: Read): DeepcoreState;
  buyUpgrade(state: Read, track: TrackName): DeepcoreState;
  buyItem(state: Read, item: ItemId): DeepcoreState;
  useItem(state: Read, item: ItemId): DeepcoreState;
  jettison(state: Read): DeepcoreState;
  fabricate(state: Read): DeepcoreState;
  launch(state: Read): DeepcoreState;
  save(state: Read): DeepcoreState;
  dismissNotice(state: Read): DeepcoreState;
}

// ---- Argument checking ---------------------------------------------------

function fail(message: string): never {
  throw new RangeError(`Deepcore: ${message}`);
}

function requireNumber(op: string, name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${op}() needs a finite number for ${name}, got ${String(value)}`);
  }
  return value;
}

function requireRange(
  op: string,
  name: string,
  value: unknown,
  lo: number,
  hi: number,
): number {
  const n = requireNumber(op, name, value);
  if (n < lo || n > hi) {
    fail(`${op}() needs ${name} within [${lo}, ${hi}], got ${n}`);
  }
  return n;
}

function requireInteger(
  op: string,
  name: string,
  value: unknown,
  lo: number,
  hi: number,
): number {
  const n = requireNumber(op, name, value);
  if (!Number.isInteger(n)) {
    fail(`${op}() needs a whole number for ${name}, got ${n}`);
  }
  if (n < lo || n > hi) {
    fail(`${op}() needs ${name} within [${lo}, ${hi}], got ${n}`);
  }
  return n;
}

function requireBoolean(op: string, name: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    fail(`${op}() needs a boolean for ${name}, got ${String(value)}`);
  }
  return value;
}

function requireOneOf<T extends string>(
  op: string,
  name: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(
      `${op}() needs ${name} to be one of ${allowed.join(", ")}, got ${String(value)}`,
    );
  }
  return value as T;
}

// ---- The readings --------------------------------------------------------

/** One cell's observable state. A cell outside the grid reads as bedrock. */
export function readTile(state: Read, col: number, row: number): TileRead {
  const tile = gridTileAt(state.grid, col, row);
  if (!tile) {
    return {
      kind: "bedrock",
      band: null,
      ore: null,
      material: null,
      health: null,
      maxHealth: null,
    };
  }
  const minable = isMinableKind(tile.kind);
  const inBands = row >= 1 && row < state.coreRow;
  const max = tileMaxHealth(tile);
  return {
    kind: tile.kind,
    band: inBands ? tile.band : null,
    ore: tile.ore,
    material: tile.material,
    health: minable ? (tile.health ?? max) : null,
    maxHealth: minable ? max : null,
  };
}

/** The whole observable state, as a plain object. */
export function readSnapshot(state: Read): DeepcoreSnapshot {
  const m = state.miner;

  let drilling: DeepcoreSnapshot["miner"]["drilling"] = null;
  if (m.drilling) {
    const tile = gridTileAt(state.grid, m.drilling.col, m.drilling.row);
    drilling = {
      col: m.drilling.col,
      row: m.drilling.row,
      dir: m.drilling.dir,
      progress: tile ? cutProgress(tile) : 0,
    };
  }

  const ore: Record<string, number> = {};
  for (const id of MINERAL_IDS) {
    if (state.cargo[id] > 0) ore[id] = state.cargo[id];
  }

  const ground = coreGround(state);
  const next = nextComponent(state.installed);
  const scan: ScanResult = state.scan;

  return {
    version: DEEPCORE_DEBUG_VERSION,
    screen: state.screen,
    panel: state.panel,
    mode: state.mode,
    worldSize: state.worldSize,
    coreRow: state.coreRow,
    menuIndex: state.menuIndex,
    muted: state.muted,
    simTime: state.simTime,
    hasSave: hasSave(),
    credits: state.credits,
    creditsEarned: state.creditsEarned,
    depthMeters: depthMeters(m),
    deepestDepthMeters: state.deepestDepthMeters,
    coreTimer: state.coreTimer,
    coreGround: ground,
    camera: { x: state.camX, y: state.camY, lead: state.camLead },
    miner: {
      x: m.x,
      y: m.y,
      vx: m.vx,
      vy: m.vy,
      col: minerCol(m),
      row: minerRow(m),
      facing: m.facing,
      state: m.state,
      grounded: isGrounded(state.grid, m),
      travel: m.travel,
      drill: m.drill,
      fuel: m.fuel,
      maxFuel: maxFuel(state.tiers),
      hull: m.hull,
      maxHull: maxHull(state.tiers),
      overloaded: overloaded(state.cargo, state.tiers),
      drilling,
    },
    cargo: {
      slotsUsed: slotsUsed(state.cargo),
      slotCap: cargoCap(state.tiers),
      loadKg: loadKg(state.cargo),
      liftLimitKg: liftLimitKg(state.tiers),
      ore,
    },
    satchel: {
      resonite: state.satchel.resonite,
      cryenite: state.satchel.cryenite,
      coreSample: state.satchel.coreSample,
    },
    tiers: { ...state.tiers },
    items: { ...state.items },
    rocket: {
      installed: ROCKET_COMPONENTS.filter((component) =>
        state.installed.includes(component.id),
      ).map((component) => component.id),
      nextComponent: next ? next.id : null,
    },
    scanner: {
      locked: scan.locked,
      target: scan.target,
      dirX: scan.dirX,
      dirY: scan.dirY,
      distanceTiles: scan.distanceTiles,
    },
    notice: state.notice
      ? { hazard: state.notice.hazard, shown: state.notice.shown }
      : null,
    noticesFired: { ...state.noticesFired },
    summary: state.summary ? { ...state.summary } : null,
  };
}

/** The cell of that kind nearest the miner, or `null` where the mine holds none. */
export function findNearestTile(
  state: Read,
  kind: TileKind,
): { col: number; row: number } | null {
  const mc = minerCol(state.miner);
  const mr = minerRow(state.miner);
  let best: { col: number; row: number } | null = null;
  let bestD = Infinity;
  for (let r = 0; r < state.grid.length; r += 1) {
    const line = state.grid[r];
    for (let c = 0; c < line.length; c += 1) {
      if (line[c].kind !== kind) continue;
      const d = (c - mc) * (c - mc) + (r - mr) * (r - mr);
      if (d < bestD) {
        bestD = d;
        best = { col: c, row: r };
      }
    }
  }
  return best;
}

// ---- Building the surface ------------------------------------------------

/**
 * Build the surface. It holds nothing: every operation is handed the state it
 * poses or reads, and returns the next state or what it read.
 */
export function createDebugApi(): DeepcoreDebugApi {
  /** A posable cell: any column, and any row from the first ground row down. */
  const cell = (
    op: string,
    state: Read,
    col: unknown,
    row: unknown,
  ): { col: number; row: number } => ({
    col: requireInteger(op, "col", col, 0, WORLD_COLS - 1),
    row: requireInteger(op, "row", row, 1, state.coreRow),
  });

  /** Run a transition over a draft, and close it. */
  const pose = (state: Read, apply: (d: Draft) => void): DeepcoreState => {
    const d = draft(state);
    apply(d);
    return commit(d);
  };

  /** A material node that stood in a cell is gone with the cell it was in. */
  const dropNodeAt = (d: Draft, col: number, row: number): void => {
    const node = d.nodes.find(
      (entry) => entry.col === col && entry.row === row,
    );
    if (node) node.collected = true;
  };

  return {
    version: DEEPCORE_DEBUG_VERSION,

    // ---- Readings ----

    snapshot: (state) => readSnapshot(state),

    tileAt(state, col, row) {
      requireNumber("tileAt", "col", col);
      requireNumber("tileAt", "row", row);
      return readTile(state, col, row);
    },

    findTile(state, kind) {
      return findNearestTile(
        state,
        requireOneOf("findTile", "kind", kind, TILE_KINDS),
      );
    },

    buildings: () => [...buildings()],

    // ---- Restoring the world ----

    reset(state, options) {
      const seed =
        options?.seed === undefined
          ? DEFAULT_SEED
          : requireInteger("reset", "seed", options.seed, 0, 0xffffffff);
      // `muted` is a player preference the engine owns, and the save slot
      // outlives the session, so neither is touched (specs/instrumentation.md).
      return createInitialState(state.assets, {
        seed,
        muted: state.muted,
        hasSave: hasSave(),
      });
    },

    generateMine: (state) => pose(state, (d) => regenerateMine(d)),

    clearMine: (state) => pose(state, (d) => clearMine(d)),

    clearGroundItems: (state) => pose(state, (d) => clearGroundItems(d)),

    clearCargo: (state) =>
      pose(state, (d) => {
        d.cargo = emptyCargo();
      }),

    clearItems: (state) =>
      pose(state, (d) => {
        d.items = emptyItems();
      }),

    // ---- Posing the mine ----

    setTile(state, col, row, kind) {
      const at = cell("setTile", state, col, row);
      const id = requireOneOf("setTile", "kind", kind, SETTABLE_KINDS);
      return pose(state, (d) => {
        dropNodeAt(d, at.col, at.row);
        setDraftTile(
          d,
          at.col,
          at.row,
          freshCell(id, bandForRow(at.row, d.coreRow)),
        );
      });
    },

    setOreTile(state, col, row, ore) {
      const at = cell("setOreTile", state, col, row);
      const id = requireOneOf("setOreTile", "ore", ore, MINERAL_IDS);
      return pose(state, (d) => {
        dropNodeAt(d, at.col, at.row);
        setDraftTile(
          d,
          at.col,
          at.row,
          makeOreTile(bandForRow(at.row, d.coreRow), id),
        );
      });
    },

    setMaterialTile(state, col, row, material) {
      const at = cell("setMaterialTile", state, col, row);
      const id = requireOneOf(
        "setMaterialTile",
        "material",
        material,
        MATERIALS,
      );
      return pose(state, (d) => {
        setDraftTile(
          d,
          at.col,
          at.row,
          makeMaterialTile(bandForRow(at.row, d.coreRow), id),
        );
        // The scanner targets the node list, so the posed node joins it.
        const existing = d.nodes.find(
          (node) => node.col === at.col && node.row === at.row,
        );
        if (existing) {
          existing.material = id;
          existing.collected = false;
        } else {
          const node: MaterialNode = {
            material: id,
            col: at.col,
            row: at.row,
            collected: false,
          };
          d.nodes.push({ ...node });
        }
      });
    },

    setTileHealth(state, col, row, health) {
      const at = cell("setTileHealth", state, col, row);
      const tile = gridTileAt(state.grid, at.col, at.row);
      if (!tile || !isMinableKind(tile.kind)) {
        fail(
          `setTileHealth() needs a minable cell, and (${at.col}, ${at.row}) is not one`,
        );
      }
      const max = BAND_HEALTH[tile.band];
      const value = requireNumber("setTileHealth", "health", health);
      if (value <= 0 || value > max) {
        fail(`setTileHealth() needs health within (0, ${max}], got ${value}`);
      }
      return pose(state, (d) => {
        setDraftTile(d, at.col, at.row, { ...tile, health: value });
      });
    },

    placeCoreSample(state, col, row) {
      const at = cell("placeCoreSample", state, col, row);
      const tile = gridTileAt(state.grid, at.col, at.row);
      if (!tile || tile.kind !== "tunnel") {
        fail(
          `placeCoreSample() needs an open tunnel, and (${at.col}, ${at.row}) is not one`,
        );
      }
      if (state.coreTimer !== null) {
        fail("placeCoreSample() needs no Core Sample to be live");
      }
      return pose(state, (d) => {
        d.groundItems.push({
          kind: "core-sample",
          col: at.col,
          row: at.row,
        });
        d.coreTimer = CORE_TIMER;
      });
    },

    // ---- Posing the miner ----

    setMinerPosition(state, x, y) {
      const px = requireNumber("setMinerPosition", "x", x);
      const py = requireNumber("setMinerPosition", "y", y);
      return pose(state, (d) => {
        d.miner.x = px;
        d.miner.y = py;
      });
    },

    setMinerVelocity(state, vx, vy) {
      const dx = requireNumber("setMinerVelocity", "vx", vx);
      const dy = requireNumber("setMinerVelocity", "vy", vy);
      return pose(state, (d) => {
        d.miner.vx = dx;
        d.miner.vy = dy;
      });
    },

    setFacing(state, facing) {
      const id = requireOneOf("setFacing", "facing", facing, [
        "east",
        "west",
      ] as const);
      return pose(state, (d) => {
        d.miner.facing = id;
      });
    },

    setFuel(state, value) {
      const fuel = requireRange(
        "setFuel",
        "value",
        value,
        0,
        maxFuel(state.tiers),
      );
      return pose(state, (d) => {
        d.miner.fuel = fuel;
      });
    },

    setHull(state, value) {
      const hull = requireRange(
        "setHull",
        "value",
        value,
        0,
        maxHull(state.tiers),
      );
      return pose(state, (d) => {
        d.miner.hull = hull;
      });
    },

    setMinerTravel(state, enabled) {
      const on = requireBoolean("setMinerTravel", "enabled", enabled);
      return pose(state, (d) => {
        d.miner.travel = on;
      });
    },

    setMinerDrill(state, enabled) {
      const on = requireBoolean("setMinerDrill", "enabled", enabled);
      return pose(state, (d) => {
        d.miner.drill = on;
      });
    },

    // ---- Posing the expedition ----

    setScreen(state, screen) {
      const id = requireOneOf("setScreen", "screen", screen, SCREENS);
      return pose(state, (d) => {
        d.screen = id;
      });
    },

    setPanel(state, panel) {
      const id =
        panel === null
          ? null
          : requireOneOf("setPanel", "panel", panel, PANELS);
      return pose(state, (d) => {
        d.panel = id;
      });
    },

    setMenuIndex(state, index) {
      const top = Math.max(0, menuItems(state).length - 1);
      const at = requireInteger("setMenuIndex", "index", index, 0, top);
      return pose(state, (d) => {
        d.menuIndex = at;
      });
    },

    setMode(state, mode) {
      const id = requireOneOf("setMode", "mode", mode, MODES);
      return pose(state, (d) => {
        d.mode = id;
      });
    },

    setWorldSize(state, size) {
      const id = requireOneOf("setWorldSize", "size", size, WORLD_SIZES);
      return pose(state, (d) => {
        d.worldSize = id;
        d.coreRow = coreRowFor(id);
      });
    },

    setCredits(state, value) {
      const credits = requireRange(
        "setCredits",
        "value",
        value,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      return pose(state, (d) => {
        d.credits = credits;
      });
    },

    setTier(state, track, tier) {
      const id = requireOneOf("setTier", "track", track, TRACKS);
      const rung = requireInteger("setTier", "tier", tier, 1, MAX_TIER[id]);
      return pose(state, (d) => {
        d.tiers[id] = rung;
        // Everything the tier defines follows from it, so only the two pools
        // that have a maximum need clamping back into range.
        d.miner.fuel = Math.min(d.miner.fuel, maxFuel(d.tiers));
        d.miner.hull = Math.min(d.miner.hull, maxHull(d.tiers));
      });
    },

    setCargo(state, ore, count) {
      const id = requireOneOf("setCargo", "ore", ore, MINERAL_IDS);
      const held = requireInteger(
        "setCargo",
        "count",
        count,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      return pose(state, (d) => {
        d.cargo[id] = held;
      });
    },

    setMaterial(state, material, count) {
      const id = requireOneOf("setMaterial", "material", material, MATERIALS);
      const held = requireInteger(
        "setMaterial",
        "count",
        count,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      return pose(state, (d) => {
        d.satchel[id] = held;
      });
    },

    setCoreCarried(state, carried) {
      const on = requireBoolean("setCoreCarried", "carried", carried);
      if (on && state.coreTimer !== null) {
        fail("setCoreCarried(true) needs no Core Sample to be live");
      }
      return pose(state, (d) => {
        if (on) {
          d.satchel.coreSample = true;
          d.coreTimer = CORE_TIMER;
        } else {
          d.satchel.coreSample = false;
          if (coreGround(d) === null) d.coreTimer = null;
        }
      });
    },

    setCoreTimer(state, seconds) {
      if (state.coreTimer === null) {
        fail("setCoreTimer() needs a live Core Sample");
      }
      const value = requireNumber("setCoreTimer", "seconds", seconds);
      if (value <= 0) {
        fail(`setCoreTimer() needs seconds above 0, got ${value}`);
      }
      return pose(state, (d) => {
        d.coreTimer = value;
      });
    },

    setItemCount(state, item, count) {
      const id = requireOneOf("setItemCount", "item", item, ITEM_IDS);
      const held = requireInteger(
        "setItemCount",
        "count",
        count,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      return pose(state, (d) => {
        d.items[id] = held;
      });
    },

    setRocketInstalled(state, count) {
      const n = requireInteger(
        "setRocketInstalled",
        "count",
        count,
        0,
        ROCKET_COMPONENTS.length,
      );
      return pose(state, (d) => {
        d.installed = ROCKET_COMPONENTS.slice(0, n).map(
          (component) => component.id,
        );
      });
    },

    setNoticeFired(state, hazard, fired) {
      const id = requireOneOf(
        "setNoticeFired",
        "hazard",
        hazard,
        NOTICE_HAZARDS,
      );
      const on = requireBoolean("setNoticeFired", "fired", fired);
      return pose(state, (d) => {
        d.noticesFired[id] = on;
      });
    },

    setCameraLead(state, lead) {
      const value = requireRange(
        "setCameraLead",
        "lead",
        lead,
        -CAM_LEAD_MAX,
        CAM_LEAD_MAX,
      );
      return pose(state, (d) => {
        d.camLead = value;
        placeCamera(d);
      });
    },

    clearSave: (state) =>
      pose(state, (d) => {
        clearSaveSlot();
        d.hasSave = hasSave();
      }),

    // ---- The controls ----

    dropOre(state, ore) {
      const id = requireOneOf("dropOre", "ore", ore, MINERAL_IDS);
      return pose(state, (d) => {
        dropOre(d, id);
      });
    },

    sell: (state) =>
      pose(state, (d) => {
        sellCargo(d);
      }),

    buyFuel: (state) =>
      pose(state, (d) => {
        buyFuel(d);
      }),

    fillFuel: (state) =>
      pose(state, (d) => {
        fillFuel(d);
      }),

    buyRepair: (state) =>
      pose(state, (d) => {
        buyRepair(d);
      }),

    repairFull: (state) =>
      pose(state, (d) => {
        repairFull(d);
      }),

    buyUpgrade(state, track) {
      const id = requireOneOf("buyUpgrade", "track", track, TRACKS);
      return pose(state, (d) => {
        buyUpgrade(d, id);
      });
    },

    buyItem(state, item) {
      const id = requireOneOf("buyItem", "item", item, ITEM_IDS);
      return pose(state, (d) => {
        buyItem(d, id);
      });
    },

    useItem(state, item) {
      const id = requireOneOf("useItem", "item", item, ITEM_IDS);
      return pose(state, (d) => {
        useItem(d, id);
      });
    },

    jettison: (state) =>
      pose(state, (d) => {
        jettisonCoreSample(d);
      }),

    fabricate: (state) =>
      pose(state, (d) => {
        fabricate(d);
      }),

    launch: (state) =>
      pose(state, (d) => {
        startLaunch(d);
      }),

    save: (state) =>
      pose(state, (d) => {
        trySave(d);
      }),

    dismissNotice: (state) =>
      pose(state, (d) => {
        dismissNotice(d);
      }),
  };
}
