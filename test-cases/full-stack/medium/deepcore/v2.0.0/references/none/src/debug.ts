// Deepcore — the debugging and automation surface installed on `window.__deepcore`
// (specs/instrumentation.md).
//
// Every operation is a reading, a pose of one value, or one of the named controls.
// A pose sets one thing and leaves the rest of the game as it stands; the game's own
// physics, drill, hazard, economy, and save rules then run from there exactly as they
// do in play, so nothing here fabricates an outcome. The controls are the named
// counterparts of the on-screen controls and run the same functions the panels do,
// which is why this module imports them rather than restating any rule.
//
// The clock and the keyboard are the exception, because nothing outside this build
// owns them: `setAutoStep` and `advance` reach the runtime's loop, and `keyDown`,
// `keyUp`, and `press` dispatch real key events at the page, so an injected key flows
// through the very handling the physical keyboard feeds.

import {
  BAND_HEALTH,
  CAM_LEAD_MAX,
  CORE_TIMER,
  DEEPCORE_DEBUG_VERSION,
  DEFAULT_SEED,
  ITEM_IDS,
  ORE_IDS,
  ROCKET_COMPONENTS,
  UPGRADE_TRACKS,
  WORLD_COLS,
  coreRowFor,
  maxTierFor,
} from "./constants";
import type { WorldSize } from "./constants";
import {
  buyFuel,
  buyRepair,
  buyUpgrade,
  dropOre,
  fillFuel,
  repairFull,
  sellCargo,
} from "./economy";
import { buyItem, useItem } from "./items";
import { menuItems } from "./menus";
import { clearSave as clearSaveSlot } from "./save";
import { fabricate } from "./rocket";
import { isMinableKind, setCell } from "./world";
import type { BuildingBox, DeepcoreSnapshot, Game, TileRead } from "./game";
import type { Input } from "./input";
import type {
  Facing,
  Hazard,
  ItemId,
  Mode,
  OpenPanel,
  Ore,
  Panel,
  Screen,
  TileKind,
  UpgradeTrack,
} from "./types";

/** The window property the surface is installed on. */
export const DEEPCORE_HANDLE = "__deepcore";

/** The kinds `setTile` accepts. Ore and material cells have operations of their own. */
const SETTABLE_KINDS: readonly TileKind[] = [
  "rock",
  "gas",
  "lava",
  "stone",
  "bedrock",
  "tunnel",
  "core",
];

const SCREENS: readonly Screen[] = [
  "title",
  "mode-select",
  "size-select",
  "how-to-play",
  "in-mine",
  "paused",
  "victory",
  "game-over",
];

const PANELS: readonly Panel[] = [
  "fuel-depot",
  "ore-market",
  "upgrade-shop",
  "supply-depot",
  "launch-pad",
  "inventory",
];

const WORLD_SIZES: readonly WorldSize[] = ["quick", "standard", "marathon"];

/**
 * The runtime's clock, as the surface reaches it. Structural on purpose: `main.ts`
 * satisfies it without knowing this file exists, and a test can hand the surface a
 * clock of its own.
 */
export interface DebugClock {
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames: number): void;
}

/** What the surface is built over. */
export interface DebugContext {
  game: Game;
  input: Input;
  clock: DebugClock;
  /** Run this frame's queued edge input at once, as the loop does each frame. */
  drainEdges(): void;
}

/** The debugging and automation surface. */
export interface DeepcoreDebugApi {
  version: number;

  // Readings
  snapshot(): DeepcoreSnapshot;
  tileAt(col: number, row: number): TileRead;
  findTile(kind: TileKind): { col: number; row: number } | null;
  buildings(): BuildingBox[];

  // The clock
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

  // Input
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;

  // Restoring the world
  reset(options?: { seed?: number }): void;
  generateMine(): void;
  clearMine(): void;
  clearGroundItems(): void;
  clearCargo(): void;
  clearItems(): void;

  // Posing the mine
  setTile(col: number, row: number, kind: TileKind): void;
  setOreTile(col: number, row: number, ore: Ore): void;
  setMaterialTile(
    col: number,
    row: number,
    material: "resonite" | "cryenite",
  ): void;
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
  setScreen(screen: Screen): void;
  setPanel(panel: OpenPanel): void;
  setMenuIndex(index: number): void;
  setMode(mode: Mode): void;
  setWorldSize(size: WorldSize): void;
  setCredits(value: number): void;
  setTier(track: UpgradeTrack, tier: number): void;
  setCargo(ore: Ore, count: number): void;
  setMaterial(material: "resonite" | "cryenite", count: number): void;
  setCoreCarried(carried: boolean): void;
  setCoreTimer(seconds: number): void;
  setItemCount(item: ItemId, count: number): void;
  setRocketInstalled(count: number): void;
  setNoticeFired(hazard: Hazard, fired: boolean): void;
  setCameraLead(lead: number): void;
  clearSave(): void;
  setMuted(muted: boolean): void;

  // The controls
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

// ---------------------------------------------------------------------------
// Argument checking. An argument outside its stated domain fails loudly rather
// than leaving the caller to guess what the game did with it.
// ---------------------------------------------------------------------------

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
  if (n < lo || n > hi)
    fail(`${op}() needs ${name} within [${lo}, ${hi}], got ${n}`);
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
  if (!Number.isInteger(n))
    fail(`${op}() needs a whole number for ${name}, got ${n}`);
  if (n < lo || n > hi)
    fail(`${op}() needs ${name} within [${lo}, ${hi}], got ${n}`);
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

/** Install the surface on `window.__deepcore`. */
export function installDebugApi(ctx: DebugContext): DeepcoreDebugApi {
  const { game, input, clock, drainEdges } = ctx;

  /** A posable cell: any column, and any row from the first ground row to the Core. */
  const cell = (
    op: string,
    col: unknown,
    row: unknown,
  ): { col: number; row: number } => ({
    col: requireInteger(op, "col", col, 0, WORLD_COLS - 1),
    row: requireInteger(op, "row", row, 1, game.coreRow),
  });

  /** Set one cell to a fresh tile of a kind, at its band's full health where minable. */
  const placeTile = (col: number, row: number, kind: TileKind): void => {
    // A material node that stood here is gone with the cell it was in.
    const node = game.nodes.find((n) => n.col === col && n.row === row);
    if (node) node.collected = true;
    setCell(game.grid, col, row, kind, game.coreRow);
  };

  const api: DeepcoreDebugApi = {
    version: DEEPCORE_DEBUG_VERSION,

    // ---- Readings ----

    snapshot: () => game.snapshot(),

    tileAt(col, row) {
      requireInteger("tileAt", "col", col, -Infinity, Infinity);
      requireInteger("tileAt", "row", row, -Infinity, Infinity);
      return game.tileAt(col, row);
    },

    findTile(kind) {
      const k = requireOneOf("findTile", "kind", kind, [
        "rock",
        "ore",
        "material",
        "gas",
        "lava",
        "stone",
        "bedrock",
        "tunnel",
        "core",
      ] as const);
      return game.findTile(k);
    },

    buildings: () => game.buildings(),

    // ---- The clock ----

    setAutoStep(enabled) {
      clock.setAutoStep(requireBoolean("setAutoStep", "enabled", enabled));
    },

    advance(seconds, frames = 1) {
      const s = requireNumber("advance", "seconds", seconds);
      if (s < 0)
        fail(`advance() needs a non-negative number of seconds, got ${s}`);
      const n = requireInteger(
        "advance",
        "frames",
        frames,
        1,
        Number.MAX_SAFE_INTEGER,
      );
      clock.advance(s, n);
    },

    // ---- Input ----

    keyDown(code) {
      if (typeof code !== "string" || !code)
        fail("keyDown() needs a KeyboardEvent.code");
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code, bubbles: true }),
      );
      // Apply any edge action at once, so a caller need not wait for a frame.
      drainEdges();
    },

    keyUp(code) {
      if (typeof code !== "string" || !code)
        fail("keyUp() needs a KeyboardEvent.code");
      window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
    },

    press(code) {
      api.keyDown(code);
      api.keyUp(code);
    },

    // ---- Restoring the world ----

    reset(options) {
      const seed =
        options?.seed === undefined
          ? DEFAULT_SEED
          : requireInteger("reset", "seed", options.seed, 0, 0xffffffff);
      input.releaseAll();
      game.reset(seed);
    },

    generateMine() {
      game.regenerateMine();
    },

    clearMine() {
      game.clearMine();
    },

    clearGroundItems() {
      game.groundItems = [];
      game.coreTimer = game.satchel.coreSample ? game.coreTimer : null;
    },

    clearCargo() {
      for (const id of ORE_IDS) game.cargo[id] = 0;
    },

    clearItems() {
      for (const id of ITEM_IDS) game.items[id] = 0;
    },

    // ---- Posing the mine ----

    setTile(col, row, kind) {
      const at = cell("setTile", col, row);
      placeTile(
        at.col,
        at.row,
        requireOneOf("setTile", "kind", kind, SETTABLE_KINDS),
      );
    },

    setOreTile(col, row, ore) {
      const at = cell("setOreTile", col, row);
      const id = requireOneOf("setOreTile", "ore", ore, ORE_IDS);
      placeTile(at.col, at.row, "ore");
      game.grid[at.row]![at.col]!.ore = id;
    },

    setMaterialTile(col, row, material) {
      const at = cell("setMaterialTile", col, row);
      const id = requireOneOf("setMaterialTile", "material", material, [
        "resonite",
        "cryenite",
      ] as const);
      placeTile(at.col, at.row, "material");
      game.grid[at.row]![at.col]!.material = id;
      // The scanner targets the node list, so the posed node joins it.
      const existing = game.nodes.find(
        (n) => n.col === at.col && n.row === at.row,
      );
      if (existing) {
        existing.material = id;
        existing.collected = false;
      } else {
        game.nodes.push({
          material: id,
          col: at.col,
          row: at.row,
          collected: false,
        });
      }
    },

    setTileHealth(col, row, health) {
      const at = cell("setTileHealth", col, row);
      const tile = game.grid[at.row]?.[at.col];
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
      tile.health = value;
    },

    placeCoreSample(col, row) {
      const at = cell("placeCoreSample", col, row);
      const tile = game.grid[at.row]?.[at.col];
      if (!tile || tile.kind !== "tunnel") {
        fail(
          `placeCoreSample() needs an open tunnel, and (${at.col}, ${at.row}) is not one`,
        );
      }
      if (game.coreTimer !== null)
        fail("placeCoreSample() needs no Core Sample to be live");
      game.groundItems.push({ kind: "core-sample", col: at.col, row: at.row });
      game.coreTimer = CORE_TIMER;
    },

    // ---- Posing the miner ----

    setMinerPosition(x, y) {
      game.miner.x = requireNumber("setMinerPosition", "x", x);
      game.miner.y = requireNumber("setMinerPosition", "y", y);
    },

    setMinerVelocity(vx, vy) {
      game.miner.vx = requireNumber("setMinerVelocity", "vx", vx);
      game.miner.vy = requireNumber("setMinerVelocity", "vy", vy);
    },

    setFacing(facing) {
      game.miner.facing = requireOneOf("setFacing", "facing", facing, [
        "east",
        "west",
      ] as const);
    },

    setFuel(value) {
      game.miner.fuel = requireRange(
        "setFuel",
        "value",
        value,
        0,
        game.maxFuel(),
      );
    },

    setHull(value) {
      game.miner.hull = requireRange(
        "setHull",
        "value",
        value,
        0,
        game.maxHull(),
      );
    },

    setMinerTravel(enabled) {
      game.miner.travel = requireBoolean("setMinerTravel", "enabled", enabled);
    },

    setMinerDrill(enabled) {
      game.miner.drill = requireBoolean("setMinerDrill", "enabled", enabled);
    },

    // ---- Posing the expedition ----

    setScreen(screen) {
      game.screen = requireOneOf("setScreen", "screen", screen, SCREENS);
    },

    setPanel(panel) {
      if (panel === null) {
        game.panel = null;
        return;
      }
      game.panel = requireOneOf("setPanel", "panel", panel, PANELS);
    },

    setMenuIndex(index) {
      const items = menuItems(game).length;
      const top = Math.max(0, items - 1);
      game.menuIndex = requireInteger("setMenuIndex", "index", index, 0, top);
    },

    setMode(mode) {
      game.mode = requireOneOf("setMode", "mode", mode, [
        "standard",
        "hardcore",
      ] as const);
    },

    /**
     * The size, `coreRow`, and the mine the new depth leaves.
     *
     * specs/instrumentation.md: a grid laid out for the old depth cannot
     * describe a mine at the new one, so the mine is emptied to the new depth
     * exactly as `clearMine` leaves it. Nothing is generated.
     */
    setWorldSize(size) {
      const id = requireOneOf("setWorldSize", "size", size, WORLD_SIZES);
      game.worldSize = id;
      game.coreRow = coreRowFor(id);
      game.clearMine();
    },

    setCredits(value) {
      game.credits = requireRange(
        "setCredits",
        "value",
        value,
        0,
        Number.MAX_SAFE_INTEGER,
      );
    },

    setTier(track, tier) {
      const id = requireOneOf("setTier", "track", track, UPGRADE_TRACKS);
      game.tiers[id] = requireInteger(
        "setTier",
        "tier",
        tier,
        1,
        maxTierFor(id),
      );
      // Everything the tier defines follows from it, so only the two pools that have
      // a maximum need clamping back into range.
      game.miner.fuel = Math.min(game.miner.fuel, game.maxFuel());
      game.miner.hull = Math.min(game.miner.hull, game.maxHull());
    },

    setCargo(ore, count) {
      const id = requireOneOf("setCargo", "ore", ore, ORE_IDS);
      game.cargo[id] = requireInteger(
        "setCargo",
        "count",
        count,
        0,
        Number.MAX_SAFE_INTEGER,
      );
    },

    setMaterial(material, count) {
      const id = requireOneOf("setMaterial", "material", material, [
        "resonite",
        "cryenite",
      ] as const);
      game.satchel[id] = requireInteger(
        "setMaterial",
        "count",
        count,
        0,
        Number.MAX_SAFE_INTEGER,
      );
    },

    setCoreCarried(carried) {
      if (requireBoolean("setCoreCarried", "carried", carried)) {
        if (game.coreTimer !== null)
          fail("setCoreCarried(true) needs no Core Sample to be live");
        game.satchel.coreSample = true;
        game.coreTimer = CORE_TIMER;
      } else {
        game.satchel.coreSample = false;
        if (game.coreGround() === null) game.coreTimer = null;
      }
    },

    setCoreTimer(seconds) {
      if (game.coreTimer === null)
        fail("setCoreTimer() needs a live Core Sample");
      const value = requireNumber("setCoreTimer", "seconds", seconds);
      if (value <= 0)
        fail(`setCoreTimer() needs seconds above 0, got ${value}`);
      game.coreTimer = value;
    },

    setItemCount(item, count) {
      const id = requireOneOf("setItemCount", "item", item, ITEM_IDS);
      game.items[id] = requireInteger(
        "setItemCount",
        "count",
        count,
        0,
        Number.MAX_SAFE_INTEGER,
      );
    },

    setRocketInstalled(count) {
      const n = requireInteger(
        "setRocketInstalled",
        "count",
        count,
        0,
        ROCKET_COMPONENTS.length,
      );
      game.installed = new Set(ROCKET_COMPONENTS.slice(0, n).map((c) => c.id));
    },

    setNoticeFired(hazard, fired) {
      const id = requireOneOf("setNoticeFired", "hazard", hazard, [
        "gas",
        "lava",
      ] as const);
      game.noticesFired[id] = requireBoolean("setNoticeFired", "fired", fired);
    },

    setCameraLead(lead) {
      game.camLead = requireRange(
        "setCameraLead",
        "lead",
        lead,
        -CAM_LEAD_MAX,
        CAM_LEAD_MAX,
      );
    },

    clearSave() {
      clearSaveSlot();
    },

    setMuted(muted) {
      game.muted = requireBoolean("setMuted", "muted", muted);
    },

    // ---- The controls ----

    dropOre(ore) {
      dropOre(game, requireOneOf("dropOre", "ore", ore, ORE_IDS));
    },

    sell() {
      sellCargo(game);
    },

    buyFuel() {
      buyFuel(game);
    },

    fillFuel() {
      fillFuel(game);
    },

    buyRepair() {
      buyRepair(game);
    },

    repairFull() {
      repairFull(game);
    },

    buyUpgrade(track) {
      buyUpgrade(
        game,
        requireOneOf("buyUpgrade", "track", track, UPGRADE_TRACKS),
      );
    },

    buyItem(item) {
      buyItem(game, requireOneOf("buyItem", "item", item, ITEM_IDS));
    },

    useItem(item) {
      useItem(game, requireOneOf("useItem", "item", item, ITEM_IDS));
    },

    jettison() {
      game.jettisonCoreSample();
    },

    fabricate() {
      fabricate(game);
    },

    launch() {
      game.startLaunch();
    },

    save() {
      game.trySave();
    },

    dismissNotice() {
      game.dismissNotice();
    },
  };

  (window as unknown as Record<string, unknown>)[DEEPCORE_HANDLE] = api;
  return api;
}
