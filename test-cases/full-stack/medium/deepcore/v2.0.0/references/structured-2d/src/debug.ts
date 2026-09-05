// Deepcore — the debugging and automation surface (specs/instrumentation.md).
//
// `createDebugApi` builds it, the game instance's `initialize` returns it, and
// the engine holds that same object and returns it from `engine.debug` — the one
// way a caller reaches it. Nothing is installed on the page, the surface holds no
// state, and it is inert during normal play: nothing below runs until something
// calls it.
//
// EVERY OPERATION ACTS ON THE LIVE GAME at the moment it is called, reaching the
// open world through the accessor the instance supplies — `engine.world` at the
// call — and takes only the parameters `specs/instrumentation.md` names for it. A
// POSE or a CONTROL arranges the running game and returns nothing; a READING
// returns plain data built at the call and changes nothing.
//
// A pose sets ONE thing and leaves the rest of the game as it stands; the game's
// own physics, drill, hazard, economy, and save rules then run from there exactly
// as they do in play, so nothing here fabricates an outcome. The controls are the
// named counterparts of the on-screen controls and run the very functions the
// panels run, which is why this module imports them rather than restating a rule.
//
// Deepcore runs in ONE WORLD for the whole session and every screen is a value of
// `screen`, so a pose that changes the screen takes effect at the call rather
// than riding a level transition. Each pose finishes by handing the engine's
// camera the projection the state is asking for, so a caller that reads the
// camera back never sees it a frame behind what it just posed.
//
// An argument outside the domain `specs/instrumentation.md` states for it fails
// loudly rather than leaving the caller to guess what the game did with it.

import type { World } from "@clockwyrks/structured-2d";
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
import { cameraCorner, placeCamera, syncCamera } from "./camera";
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
import type { Control } from "./controls";
import { controlsFor, menuControls } from "./controls";
import { clearEffects } from "./effects";
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
  clearMine,
  regenerateMine,
  resizeMine,
  startLaunch,
  trySave,
} from "./flow";
import type { BuildingBox } from "./flow";
import { deepcoreState, emptyCargo, emptyItems } from "./game";
import type { DeepcoreState, MaterialNode, ScanResult } from "./game";
import { buyItem, coreGround, jettisonCoreSample, useItem } from "./items";
import { menuItems } from "./menus";
import { isGrounded, minerCol, minerRow } from "./physics";
import { fabricate, nextComponent } from "./rocket";
import { clearSave as clearSaveSlot, hasSave } from "./save";
import { putTile, tileAt as gridTileAt } from "./state";
import { coreRowFor } from "./tuning";
import {
  freshCell,
  bandForRow,
  isMinableKind,
  makeMaterialTile,
  makeOreTile,
  tileMaxHealth,
} from "./world";

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

/** The control names `controlRect` takes, and what each one acts on. */
const CONTROL_SUBJECTS = {
  "drop-ore": "ore",
  "use-item": "item",
  jettison: "none",
  sell: "none",
  "buy-fuel": "none",
  "fill-fuel": "none",
  "buy-repair": "none",
  "repair-full": "none",
  "buy-upgrade": "track",
  "buy-item": "item",
  fabricate: "none",
  launch: "none",
  "dismiss-notice": "none",
  inventory: "none",
  pause: "none",
  mute: "none",
} as const;

/** Every control name, for the domain check. */
const CONTROL_NAMES = Object.keys(CONTROL_SUBJECTS) as ControlName[];

/** The action string the layout gives a control that takes no subject. */
const PLAIN_ACTIONS: Readonly<Record<string, string>> = {
  jettison: "jettison",
  sell: "sell",
  "buy-fuel": "buyfuel:increment",
  "fill-fuel": "buyfuel:full",
  "buy-repair": "buyrepair:increment",
  "repair-full": "buyrepair:full",
  fabricate: "fabricate",
  launch: "launch",
  "dismiss-notice": "notice:dismiss",
  inventory: "sys:inventory",
  pause: "sys:pause",
  mute: "sys:mute",
};

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

/** A hit region on the stage, in logical units. */
export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The on-screen controls `controlRect` reports, by their specified names. */
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

/** What a control acts on, or `null` for one that acts on nothing further. */
export type ControlSubject = OreId | ItemId | TrackName | null;

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
  elapsedSeconds: number;
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

/**
 * The debugging and automation surface.
 *
 * Every pose and every control acts on the live game and returns nothing; every
 * reading returns plain data built at the call and changes nothing.
 */
export interface DeepcoreDebugApi {
  version: number;

  // Readings
  snapshot(): DeepcoreSnapshot;
  tileAt(col: number, row: number): TileRead;
  findTile(kind: TileKind): { col: number; row: number } | null;
  buildings(): BuildingBox[];
  menuItemRect(index: number): HitRect | null;
  controlRect(control: ControlName, subject: ControlSubject): HitRect | null;

  // Restoring the world
  reset(options?: { seed?: number }): void;
  generateMine(): void;
  clearMine(): void;
  clearCargo(): void;
  clearItems(): void;

  // Posing the mine
  setTile(col: number, row: number, kind: TileKind): void;
  setOreTile(col: number, row: number, ore: OreId): void;
  setMaterialTile(col: number, row: number, material: MaterialId): void;
  setTileHealth(col: number, row: number, health: number): void;
  placeCoreSample(col: number, row: number): void;

  // Posing the miner
  setMinerPosition(x: number, y: number): void;
  setMinerVelocity(vx: number, vy: number): void;
  setFacing(facing: Facing): void;
  setFuel(value: number): void;
  setHull(value: number): void;
  setMinerTravel(enabled: boolean): void;
  setMinerDrill(enabled: boolean): void;

  // Posing the expedition
  setScreen(screen: ScreenName): void;
  setPanel(panel: PanelId | null): void;
  setMenuIndex(index: number): void;
  setMode(mode: Mode): void;
  setWorldSize(size: WorldSize): void;
  setCredits(value: number): void;
  setTier(track: TrackName, tier: number): void;
  setCargo(ore: OreId, count: number): void;
  setMaterial(material: MaterialId, count: number): void;
  setCoreCarried(carried: boolean): void;
  setCoreTimer(seconds: number): void;
  setItemCount(item: ItemId, count: number): void;
  setRocketInstalled(count: number): void;
  setNoticeFired(hazard: NoticeHazard, fired: boolean): void;
  setCameraLead(lead: number): void;
  setElapsed(seconds: number): void;
  clearSave(): void;

  // The controls
  dropOre(ore: OreId): void;
  sell(): void;
  buyFuel(): void;
  fillFuel(): void;
  buyRepair(): void;
  repairFull(): void;
  buyUpgrade(track: TrackName): void;
  buyItem(item: ItemId): void;
  useItem(item: ItemId): void;
  jettison(): void;
  fabricate(): void;
  launch(): void;
  save(): void;
  dismissNotice(): void;
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
export function readTile(
  state: DeepcoreState,
  col: number,
  row: number,
): TileRead {
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

/**
 * The whole observable state, as a plain object.
 *
 * Three of its figures are live reads rather than kept copies: `muted` is the
 * bus's own bit, mirrored onto the state each tick; `camera.x` and `camera.y` are
 * read off the engine's camera through `cameraCorner`; and `hasSave` is read off
 * the slot itself (specs/instrumentation.md).
 */
export function readSnapshot(
  world: World,
  state: DeepcoreState,
): DeepcoreSnapshot {
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
    elapsedSeconds: state.elapsedSeconds,
    hasSave: hasSave(),
    credits: state.credits,
    creditsEarned: state.creditsEarned,
    depthMeters: depthMeters(m),
    deepestDepthMeters: state.deepestDepthMeters,
    coreTimer: state.coreTimer,
    coreGround: ground,
    camera: { ...cameraCorner(world), lead: state.camLead },
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
  state: DeepcoreState,
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

/** A control's hit region, stripped of everything the drawing uses. */
function rectOf(c: Control): HitRect {
  return { x: c.x, y: c.y, w: c.w, h: c.h };
}

/**
 * The action string the layout gives the named control, with its subject
 * checked against the domain that control takes.
 */
function controlAction(name: ControlName, subject: unknown): string {
  const takes = CONTROL_SUBJECTS[name];
  if (takes === "none") {
    if (subject !== null && subject !== undefined) {
      fail(`controlRect() takes null for ${name}, got ${String(subject)}`);
    }
    return PLAIN_ACTIONS[name];
  }
  if (takes === "ore") {
    return `drop:${requireOneOf("controlRect", "subject", subject, MINERAL_IDS)}`;
  }
  if (takes === "track") {
    return `buy:${requireOneOf("controlRect", "subject", subject, TRACKS)}`;
  }
  const item = requireOneOf("controlRect", "subject", subject, ITEM_IDS);
  return name === "use-item" ? `useitem:${item}` : `buyitem:${item}`;
}

// ---- Building the surface ------------------------------------------------

/**
 * Build the surface over an accessor for the open world.
 *
 * It holds nothing: every operation reads the world — and the state it carries —
 * at the moment it is called, so the surface follows the live game for the life
 * of the engine.
 */
export function createDebugApi(world: () => World): DeepcoreDebugApi {
  const state = (): DeepcoreState => deepcoreState(world());

  /**
   * Run one pose against the live state, then hand the engine's camera the
   * projection the state is left asking for.
   */
  const pose = (apply: (d: DeepcoreState) => void): void => {
    const live = state();
    apply(live);
    syncCamera(world(), live);
  };

  /** A posable cell: any column, and any row from the first ground row down. */
  const cell = (
    op: string,
    d: DeepcoreState,
    col: unknown,
    row: unknown,
  ): { col: number; row: number } => ({
    col: requireInteger(op, "col", col, 0, WORLD_COLS - 1),
    row: requireInteger(op, "row", row, 1, d.coreRow),
  });

  /** A material node that stood in a cell is gone with the cell it was in. */
  const dropNodeAt = (d: DeepcoreState, col: number, row: number): void => {
    const node = d.nodes.find(
      (entry) => entry.col === col && entry.row === row,
    );
    if (node) node.collected = true;
  };

  return {
    version: DEEPCORE_DEBUG_VERSION,

    // ---- Readings ----

    snapshot: () => readSnapshot(world(), state()),

    tileAt(col, row) {
      requireNumber("tileAt", "col", col);
      requireNumber("tileAt", "row", row);
      return readTile(state(), col, row);
    },

    findTile(kind) {
      return findNearestTile(
        state(),
        requireOneOf("findTile", "kind", kind, TILE_KINDS),
      );
    },

    buildings: () => [...buildings()],

    menuItemRect(index) {
      const d = state();
      const items = menuControls(d);
      const at = requireInteger(
        "menuItemRect",
        "index",
        index,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      const item = items[at];
      return item ? rectOf(item) : null;
    },

    controlRect(control, subject) {
      const name = requireOneOf(
        "controlRect",
        "control",
        control,
        CONTROL_NAMES,
      );
      const action = controlAction(name, subject);
      const found = controlsFor(state()).find(
        (candidate) => candidate.action === action,
      );
      return found ? rectOf(found) : null;
    },

    // ---- Restoring the world ----

    /**
     * Every field the state owns back at its title-screen value, with the
     * generator seeded. `muted` is deliberately untouched — muting is a player
     * preference the engine owns — and so is the save slot, which outlives the
     * session; `clearSave` is what deletes it. The bursts on screen are not
     * state, so they are simply taken off.
     */
    reset(options) {
      const seed =
        options?.seed === undefined
          ? DEFAULT_SEED
          : requireInteger("reset", "seed", options.seed, 0, 0xffffffff);
      pose((d) => {
        d.restore({ seed });
        d.hasSave = hasSave();
        clearEffects();
      });
    },

    generateMine: () => pose((d) => regenerateMine(d)),

    clearMine: () => pose((d) => clearMine(d)),

    clearCargo: () =>
      pose((d) => {
        d.cargo = emptyCargo();
      }),

    clearItems: () =>
      pose((d) => {
        d.items = emptyItems();
      }),

    // ---- Posing the mine ----

    setTile(col, row, kind) {
      const at = cell("setTile", state(), col, row);
      const id = requireOneOf("setTile", "kind", kind, SETTABLE_KINDS);
      pose((d) => {
        dropNodeAt(d, at.col, at.row);
        putTile(
          d,
          at.col,
          at.row,
          freshCell(id, bandForRow(at.row, d.coreRow)),
        );
      });
    },

    setOreTile(col, row, ore) {
      const at = cell("setOreTile", state(), col, row);
      const id = requireOneOf("setOreTile", "ore", ore, MINERAL_IDS);
      pose((d) => {
        dropNodeAt(d, at.col, at.row);
        putTile(
          d,
          at.col,
          at.row,
          makeOreTile(bandForRow(at.row, d.coreRow), id),
        );
      });
    },

    setMaterialTile(col, row, material) {
      const at = cell("setMaterialTile", state(), col, row);
      const id = requireOneOf(
        "setMaterialTile",
        "material",
        material,
        MATERIALS,
      );
      pose((d) => {
        putTile(
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
          d.nodes.push(node);
        }
      });
    },

    setTileHealth(col, row, health) {
      const live = state();
      const at = cell("setTileHealth", live, col, row);
      const tile = gridTileAt(live.grid, at.col, at.row);
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
      pose((d) => {
        putTile(d, at.col, at.row, { ...tile, health: value });
      });
    },

    placeCoreSample(col, row) {
      const live = state();
      const at = cell("placeCoreSample", live, col, row);
      const tile = gridTileAt(live.grid, at.col, at.row);
      if (!tile || tile.kind !== "tunnel") {
        fail(
          `placeCoreSample() needs an open tunnel, and (${at.col}, ${at.row}) is not one`,
        );
      }
      if (live.coreTimer !== null) {
        fail("placeCoreSample() needs no Core Sample to be live");
      }
      pose((d) => {
        d.groundItems.push({ kind: "core-sample", col: at.col, row: at.row });
        d.coreTimer = CORE_TIMER;
      });
    },

    // ---- Posing the miner ----

    setMinerPosition(x, y) {
      const px = requireNumber("setMinerPosition", "x", x);
      const py = requireNumber("setMinerPosition", "y", y);
      pose((d) => {
        d.miner.x = px;
        d.miner.y = py;
      });
    },

    setMinerVelocity(vx, vy) {
      const dx = requireNumber("setMinerVelocity", "vx", vx);
      const dy = requireNumber("setMinerVelocity", "vy", vy);
      pose((d) => {
        d.miner.vx = dx;
        d.miner.vy = dy;
      });
    },

    setFacing(facing) {
      const id = requireOneOf("setFacing", "facing", facing, [
        "east",
        "west",
      ] as const);
      pose((d) => {
        d.miner.facing = id;
      });
    },

    setFuel(value) {
      const fuel = requireRange(
        "setFuel",
        "value",
        value,
        0,
        maxFuel(state().tiers),
      );
      pose((d) => {
        d.miner.fuel = fuel;
      });
    },

    setHull(value) {
      const hull = requireRange(
        "setHull",
        "value",
        value,
        0,
        maxHull(state().tiers),
      );
      pose((d) => {
        d.miner.hull = hull;
      });
    },

    setMinerTravel(enabled) {
      const on = requireBoolean("setMinerTravel", "enabled", enabled);
      pose((d) => {
        d.miner.travel = on;
      });
    },

    setMinerDrill(enabled) {
      const on = requireBoolean("setMinerDrill", "enabled", enabled);
      pose((d) => {
        d.miner.drill = on;
      });
    },

    // ---- Posing the expedition ----

    setScreen(screen) {
      const id = requireOneOf("setScreen", "screen", screen, SCREENS);
      pose((d) => {
        d.screen = id;
      });
    },

    setPanel(panel) {
      const id =
        panel === null
          ? null
          : requireOneOf("setPanel", "panel", panel, PANELS);
      pose((d) => {
        d.panel = id;
      });
    },

    setMenuIndex(index) {
      const top = Math.max(0, menuItems(state()).length - 1);
      const at = requireInteger("setMenuIndex", "index", index, 0, top);
      pose((d) => {
        d.menuIndex = at;
      });
    },

    setMode(mode) {
      const id = requireOneOf("setMode", "mode", mode, MODES);
      pose((d) => {
        d.mode = id;
      });
    },

    /**
     * The size, `coreRow`, and the depth the mine reaches.
     *
     * specs/instrumentation.md, Resizing the mine: the grid is resized onto the
     * new depth the way an array is resized. Every cell the two depths share
     * comes through untouched, rows past the new depth go with the nodes that
     * sat in them, rows the old depth did not reach open as an empty mine's, and
     * the Core chamber follows the new depth. Nothing is generated.
     */
    setWorldSize(size) {
      const id = requireOneOf("setWorldSize", "size", size, WORLD_SIZES);
      pose((d) => {
        d.worldSize = id;
        d.coreRow = coreRowFor(id);
        resizeMine(d);
      });
    },

    setCredits(value) {
      const credits = requireRange(
        "setCredits",
        "value",
        value,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      pose((d) => {
        d.credits = credits;
      });
    },

    setTier(track, tier) {
      const id = requireOneOf("setTier", "track", track, TRACKS);
      const rung = requireInteger("setTier", "tier", tier, 1, MAX_TIER[id]);
      pose((d) => {
        d.tiers[id] = rung;
        // Everything the tier defines follows from it, so only the two pools
        // that have a maximum need clamping back into range.
        d.miner.fuel = Math.min(d.miner.fuel, maxFuel(d.tiers));
        d.miner.hull = Math.min(d.miner.hull, maxHull(d.tiers));
      });
    },

    setCargo(ore, count) {
      const id = requireOneOf("setCargo", "ore", ore, MINERAL_IDS);
      const held = requireInteger(
        "setCargo",
        "count",
        count,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      pose((d) => {
        d.cargo[id] = held;
      });
    },

    setMaterial(material, count) {
      const id = requireOneOf("setMaterial", "material", material, MATERIALS);
      const held = requireInteger(
        "setMaterial",
        "count",
        count,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      pose((d) => {
        d.satchel[id] = held;
      });
    },

    setCoreCarried(carried) {
      const on = requireBoolean("setCoreCarried", "carried", carried);
      if (on && state().coreTimer !== null) {
        fail("setCoreCarried(true) needs no Core Sample to be live");
      }
      pose((d) => {
        if (on) {
          d.satchel.coreSample = true;
          d.coreTimer = CORE_TIMER;
        } else {
          d.satchel.coreSample = false;
          if (coreGround(d) === null) d.coreTimer = null;
        }
      });
    },

    setCoreTimer(seconds) {
      if (state().coreTimer === null) {
        fail("setCoreTimer() needs a live Core Sample");
      }
      const value = requireNumber("setCoreTimer", "seconds", seconds);
      if (value <= 0) {
        fail(`setCoreTimer() needs seconds above 0, got ${value}`);
      }
      pose((d) => {
        d.coreTimer = value;
      });
    },

    setItemCount(item, count) {
      const id = requireOneOf("setItemCount", "item", item, ITEM_IDS);
      const held = requireInteger(
        "setItemCount",
        "count",
        count,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      pose((d) => {
        d.items[id] = held;
      });
    },

    setRocketInstalled(count) {
      const n = requireInteger(
        "setRocketInstalled",
        "count",
        count,
        0,
        ROCKET_COMPONENTS.length,
      );
      pose((d) => {
        d.installed = ROCKET_COMPONENTS.slice(0, n).map(
          (component) => component.id,
        );
      });
    },

    setNoticeFired(hazard, fired) {
      const id = requireOneOf(
        "setNoticeFired",
        "hazard",
        hazard,
        NOTICE_HAZARDS,
      );
      const on = requireBoolean("setNoticeFired", "fired", fired);
      pose((d) => {
        d.noticesFired[id] = on;
      });
    },

    setCameraLead(lead) {
      const value = requireRange(
        "setCameraLead",
        "lead",
        lead,
        -CAM_LEAD_MAX,
        CAM_LEAD_MAX,
      );
      pose((d) => {
        d.camLead = value;
        placeCamera(d);
      });
    },

    setElapsed(seconds) {
      const value = requireRange(
        "setElapsed",
        "seconds",
        seconds,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      pose((d) => {
        d.elapsedSeconds = value;
      });
    },

    clearSave: () =>
      pose((d) => {
        clearSaveSlot();
        d.hasSave = hasSave();
      }),

    // ---- The controls ----

    dropOre(ore) {
      const id = requireOneOf("dropOre", "ore", ore, MINERAL_IDS);
      pose((d) => {
        dropOre(d, id);
      });
    },

    sell: () =>
      pose((d) => {
        sellCargo(d);
      }),

    buyFuel: () =>
      pose((d) => {
        buyFuel(d);
      }),

    fillFuel: () =>
      pose((d) => {
        fillFuel(d);
      }),

    buyRepair: () =>
      pose((d) => {
        buyRepair(d);
      }),

    repairFull: () =>
      pose((d) => {
        repairFull(d);
      }),

    buyUpgrade(track) {
      const id = requireOneOf("buyUpgrade", "track", track, TRACKS);
      pose((d) => {
        buyUpgrade(d, id);
      });
    },

    buyItem(item) {
      const id = requireOneOf("buyItem", "item", item, ITEM_IDS);
      pose((d) => {
        buyItem(d, id);
      });
    },

    useItem(item) {
      const id = requireOneOf("useItem", "item", item, ITEM_IDS);
      pose((d) => {
        useItem(d, id);
      });
    },

    jettison: () =>
      pose((d) => {
        jettisonCoreSample(d);
      }),

    fabricate: () =>
      pose((d) => {
        fabricate(d);
      }),

    launch: () =>
      pose((d) => {
        startLaunch(d);
      }),

    save: () =>
      pose((d) => {
        trySave(d);
      }),

    dismissNotice: () =>
      pose((d) => {
        dismissNotice(d);
      }),
  };
}
