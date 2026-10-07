// The design model: the factory being authored, the fixed Lattice constants it may
// draw from, footprint geometry, placement/collision rules, and the projection to a
// `scenario.json`.
//
// The entity shapes here are exactly the ones the case's scenario schema defines
// (`test-cases/performance/hard/lattice/v1.0.0/schemas/scenario.json`), so a
// `DesignEntity` *is* a scenario entity — export is a near-identity map. This file
// holds no simulation rules; those live in `lattice-core`, which the sim layer runs.
// It does mirror two contract facts the editor needs locally for instant feedback:
// the prototype tables (from `specs/prototypes.md`) and the multi-tile footprints.
// The wasm engine remains the authority — a layout it rejects will not simulate,
// however the local checks judged it.

/** A cardinal direction, matching the scenario `Dir`. Grid is x-right, y-down. */
export type Dir = "N" | "E" | "S" | "W";

export const DIRS: readonly Dir[] = ["E", "S", "W", "N"];

/** The belt tiers (a belt's `SPEED` is set by its tier). */
export const BELT_TIERS = ["slow", "fast", "express"] as const;
export type BeltTier = (typeof BELT_TIERS)[number];

/** Position units in one tile, mirroring `prototypes::TILE`. */
export const TILE = 256;

/**
 * Each tier's `SPEED` — the position units an unobstructed item advances per tick —
 * mirroring `prototypes::BELT_TIERS` in `lattice-core` (the 1×/2×/3× progression).
 * The engine owns the authoritative table; this copy exists so the editor can say
 * what a tier actually *does* rather than only naming it.
 */
export const BELT_TIER_SPEED: Record<BeltTier, number> = {
  slow: 32,
  // The reference speed: the inserter swing is tuned to it, so an item in a claw
  // travels at the same rate as one on a `fast` belt.
  fast: 64,
  express: 96,
};

/**
 * A tier written out with its speed — `"fast — 64 u/tick, 4 ticks/tile"` — so the
 * choice reads as a throughput decision rather than a recolour. `express` does not
 * divide the tile evenly, so its crossing time is shown approximate.
 */
export function beltTierLabel(tier: BeltTier): string {
  const speed = BELT_TIER_SPEED[tier];
  const ticks = TILE / speed;
  const crossing = Number.isInteger(ticks)
    ? `${ticks}`
    : `~${ticks.toFixed(1)}`;
  return `${tier} — ${speed} u/tick, ${crossing} ticks/tile`;
}

/** Which lane(s) of the downstream belt a source emits onto. */
export const LANES = ["left", "right", "both"] as const;
export type Lane = (typeof LANES)[number];

/**
 * Every item id v1 uses, in the engine's canonical index order (the order is part
 * of the canonical-bytes contract; a source may emit any of them). Raw materials
 * are the ores and coal; the rest are intermediates and craftable machines.
 */
export const ITEMS = [
  "iron-ore",
  "iron-plate",
  "iron-gear",
  "copper-ore",
  "copper-plate",
  "copper-cable",
  "circuit",
  "transport-belt",
  "fast-transport-belt",
  "express-transport-belt",
  "assembler",
  "fast-assembler",
  "express-assembler",
  "inserter",
  "fast-inserter",
  "express-inserter",
  "coal",
] as const;
export type Item = (typeof ITEMS)[number];

/**
 * Recipes that run on an **assembler** (every non-smelting recipe). The split is a
 * validation rule — a smelting recipe on an assembler is rejected — so the palette
 * only offers these for an assembler.
 */
export const ASSEMBLER_RECIPES = [
  "iron-gear",
  "copper-cable",
  "circuit",
  "transport-belt",
  "inserter",
  "assembler",
] as const;

/** Recipes that run on a **furnace** (the two smelting recipes; each burns a coal). */
export const FURNACE_RECIPES = ["iron-plate", "copper-plate"] as const;

/** One side of a recipe: an item and how many of it. */
export interface RecipeIO {
  item: Item;
  count: number;
}

/** A recipe's inputs, outputs, and craft cost — for showing what a machine needs. */
export interface Recipe {
  inputs: RecipeIO[];
  outputs: RecipeIO[];
  /** Ticks from craft start (inputs consumed) to finish (outputs deposited). */
  craft: number;
  smelting: boolean;
}

/**
 * The recipe table, mirroring `specs/prototypes.md`. Held here only so the editor
 * can show a machine's required inputs; the engine owns the authoritative copy.
 */
export const RECIPES: Record<string, Recipe> = {
  "iron-plate": {
    inputs: [
      { item: "iron-ore", count: 1 },
      { item: "coal", count: 1 },
    ],
    outputs: [{ item: "iron-plate", count: 1 }],
    craft: 32,
    smelting: true,
  },
  "copper-plate": {
    inputs: [
      { item: "copper-ore", count: 1 },
      { item: "coal", count: 1 },
    ],
    outputs: [{ item: "copper-plate", count: 1 }],
    craft: 32,
    smelting: true,
  },
  "iron-gear": {
    inputs: [{ item: "iron-plate", count: 2 }],
    outputs: [{ item: "iron-gear", count: 1 }],
    craft: 64,
    smelting: false,
  },
  "copper-cable": {
    inputs: [{ item: "copper-plate", count: 1 }],
    outputs: [{ item: "copper-cable", count: 2 }],
    craft: 32,
    smelting: false,
  },
  circuit: {
    inputs: [
      { item: "iron-plate", count: 1 },
      { item: "copper-cable", count: 3 },
    ],
    outputs: [{ item: "circuit", count: 1 }],
    craft: 96,
    smelting: false,
  },
  "transport-belt": {
    inputs: [
      { item: "iron-plate", count: 1 },
      { item: "iron-gear", count: 1 },
    ],
    outputs: [{ item: "transport-belt", count: 2 }],
    craft: 48,
    smelting: false,
  },
  inserter: {
    inputs: [
      { item: "iron-gear", count: 1 },
      { item: "circuit", count: 1 },
    ],
    outputs: [{ item: "inserter", count: 1 }],
    craft: 64,
    smelting: false,
  },
  assembler: {
    inputs: [
      { item: "transport-belt", count: 2 },
      { item: "circuit", count: 1 },
    ],
    outputs: [{ item: "assembler", count: 1 }],
    craft: 96,
    smelting: false,
  },
};

/**
 * The board dimensions the editor accepts, in cells.
 *
 * These live with the model rather than with the toolbar that types them, because
 * the same pair bounds the field, the Apply gate, and any other caller that has to
 * decide whether a size is a size at all.
 */
export const MIN_BOARD_DIM = 4;
export const MAX_BOARD_DIM = 120;

/**
 * Board-size presets matching the case's scored scenarios (`cases/*.json`), so a
 * design targets a real grid rather than a guessed one.
 */
export const GRID_PRESETS = [
  { name: "Small", width: 24, height: 12 },
  { name: "Medium", width: 48, height: 32 },
  { name: "Large", width: 72, height: 40 },
] as const;

/** The kinds of entity that can be placed, in palette order. */
export const ENTITY_KINDS = [
  "belt",
  "splitter",
  "lane-splitter",
  "inserter",
  "assembler",
  "furnace",
  "source",
  "sink",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Whether a kind carries a facing (`dir`). Assemblers and furnaces do not. */
export function isDirectional(kind: EntityKind): boolean {
  return kind !== "assembler" && kind !== "furnace";
}

/** The next facing, rotating clockwise (E→S→W→N→E). */
export function rotateCW(dir: Dir): Dir {
  const cw: Record<Dir, Dir> = { E: "S", S: "W", W: "N", N: "E" };
  return cw[dir];
}

/**
 * The per-kind options the palette carries — the fields that are not geometry:
 * the belt tier, and the source's item/lane/period, plus each machine's recipe.
 * Placing an entity of a given kind reads only the fields that kind needs.
 */
export interface ToolOptions {
  tier: BeltTier;
  item: Item;
  lane: Lane;
  period: number;
  assemblerRecipe: (typeof ASSEMBLER_RECIPES)[number];
  furnaceRecipe: (typeof FURNACE_RECIPES)[number];
}

/** The default tool options a fresh palette starts with. */
export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  tier: "fast",
  item: "iron-ore",
  lane: "both",
  period: 4,
  assemblerRecipe: "iron-gear",
  furnaceRecipe: "iron-plate",
};

/** Construct a placeable entity of `kind` at `(x, y)` from a facing and options. */
export function makeEntity(
  kind: EntityKind,
  x: number,
  y: number,
  dir: Dir,
  opts: ToolOptions,
): DesignEntity {
  switch (kind) {
    case "belt":
      return { type: "belt", x, y, dir, tier: opts.tier };
    case "splitter":
      return { type: "splitter", x, y, dir };
    case "lane-splitter":
      return { type: "lane-splitter", x, y, dir };
    case "inserter":
      return { type: "inserter", x, y, dir };
    case "assembler":
      return { type: "assembler", x, y, recipe: opts.assemblerRecipe };
    case "furnace":
      return { type: "furnace", x, y, recipe: opts.furnaceRecipe };
    case "source":
      return {
        type: "source",
        x,
        y,
        dir,
        item: opts.item,
        lane: opts.lane,
        period: opts.period,
      };
    case "sink":
      return { type: "sink", x, y, dir };
  }
}

// --- Entities --------------------------------------------------------------

/** A two-lane transport belt, one tile, facing `dir`, of belt `tier`. */
export interface BeltEntity {
  type: "belt";
  x: number;
  y: number;
  dir: Dir;
  tier: BeltTier;
}

/** A two-tile balancer anchored at `(x, y)`, facing `dir`. */
export interface SplitterEntity {
  type: "splitter";
  x: number;
  y: number;
  dir: Dir;
}

/**
 * A two-tile **unzip** splitter anchored at `(x, y)`, facing `dir`. Same footprint as
 * a splitter, but it takes a single input (the belt behind its anchor) and routes each
 * of that belt's lanes to an output belt by lane, so only the outer lanes of the two
 * outputs carry items.
 */
export interface LaneSplitterEntity {
  type: "lane-splitter";
  x: number;
  y: number;
  dir: Dir;
}

/** A swing arm: picks from the tile behind, drops on the tile in front (`dir`). */
export interface InserterEntity {
  type: "inserter";
  x: number;
  y: number;
  dir: Dir;
}

/** A 3×3 crafting machine running a non-smelting `recipe`. */
export interface AssemblerEntity {
  type: "assembler";
  x: number;
  y: number;
  recipe: (typeof ASSEMBLER_RECIPES)[number];
}

/** A 2×2 coal-fired smelter running a smelting `recipe`. */
export interface FurnaceEntity {
  type: "furnace";
  x: number;
  y: number;
  recipe: (typeof FURNACE_RECIPES)[number];
}

/** An infinite test source emitting `item` onto `lane` every `period` ticks. */
export interface SourceEntity {
  type: "source";
  x: number;
  y: number;
  dir: Dir;
  item: Item;
  lane: Lane;
  period: number;
}

/** A test sink that consumes and counts every item that reaches it. */
export interface SinkEntity {
  type: "sink";
  x: number;
  y: number;
  dir: Dir;
}

export type DesignEntity =
  | BeltEntity
  | SplitterEntity
  | LaneSplitterEntity
  | InserterEntity
  | AssemblerEntity
  | FurnaceEntity
  | SourceEntity
  | SinkEntity;

/**
 * The whole design. `entities` is kept in placement order because the scenario
 * contract reads that order as output order — appending on place and splicing on
 * delete preserves it, and export emits it verbatim.
 */
export interface Design {
  grid: { width: number; height: number };
  entities: DesignEntity[];
}

// --- Footprints ------------------------------------------------------------

/** A grid tile as an `"x,y"` key. */
export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Every tile an entity covers, resolved exactly as `specs/prototypes.md` and the
 * scenario schema describe:
 * - belt / inserter / source / sink: the single anchor tile;
 * - splitter: the anchor plus one step **perpendicular-clockwise** of `dir` — for
 *   an E/W splitter `(x, y+1)`, for an N/S splitter `(x+1, y)`;
 * - assembler: the 3×3 block `(x..x+3, y..y+3)`;
 * - furnace: the 2×2 block `(x..x+2, y..y+2)`.
 */
export function footprint(entity: DesignEntity): [number, number][] {
  const { x, y } = entity;
  switch (entity.type) {
    case "splitter":
    case "lane-splitter": {
      const second: [number, number] =
        entity.dir === "E" || entity.dir === "W" ? [x, y + 1] : [x + 1, y];
      return [[x, y], second];
    }
    case "assembler":
      return block(x, y, 3, 3);
    case "furnace":
      return block(x, y, 2, 2);
    default:
      return [[x, y]];
  }
}

function block(x: number, y: number, w: number, h: number): [number, number][] {
  const tiles: [number, number][] = [];
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) tiles.push([x + dx, y + dy]);
  return tiles;
}

// --- Placement -------------------------------------------------------------

/** The set of tiles occupied by the design's entities, for collision tests. */
export function occupancy(design: Design): Set<string> {
  const set = new Set<string>();
  for (const e of design.entities)
    for (const [tx, ty] of footprint(e)) set.add(tileKey(tx, ty));
  return set;
}

/** Whether every tile of `entity`'s footprint is inside the grid. */
export function inBounds(entity: DesignEntity, grid: Design["grid"]): boolean {
  return footprint(entity).every(
    ([tx, ty]) => tx >= 0 && ty >= 0 && tx < grid.width && ty < grid.height,
  );
}

/**
 * Whether `entity` can be placed: in bounds and not overlapping anything already
 * occupied. `occupied` is the design's current occupancy (pass it in so a caller
 * placing many belts in a drag does not rebuild it per tile). This is the local,
 * instant gate; the wasm engine is the final authority on validity.
 */
export function canPlace(
  entity: DesignEntity,
  grid: Design["grid"],
  occupied: Set<string>,
): boolean {
  if (!inBounds(entity, grid)) return false;
  return footprint(entity).every(([tx, ty]) => !occupied.has(tileKey(tx, ty)));
}

/** The index of the entity whose footprint covers `(x, y)`, or -1 if none. */
export function entityAt(design: Design, x: number, y: number): number {
  const key = tileKey(x, y);
  // Last-placed wins if two ever overlapped (they should not), matching what a
  // click visually lands on.
  for (let i = design.entities.length - 1; i >= 0; i--) {
    if (
      footprint(design.entities[i]!).some(([tx, ty]) => tileKey(tx, ty) === key)
    )
      return i;
  }
  return -1;
}

// --- Resizing --------------------------------------------------------------

/**
 * A component a shrink took off the board, and where it sat in the design's order.
 *
 * A resize used to DELETE whatever no longer fitted, and the designer has no undo,
 * so a board typed a digit too small took the layout with it. Nothing is deleted
 * now: a component that falls outside is set aside, keeping its slot in the order,
 * and the board growing back over it puts it back.
 */
export interface AsideEntity {
  /** Its index in the full ordered list (board + set aside) when it was set aside. */
  at: number;
  entity: DesignEntity;
}

/** What a resize did: the new board, what is still set aside, and what moved. */
export interface ResizeResult {
  design: Design;
  aside: AsideEntity[];
  /** How many components this resize took off the board. */
  setAside: number;
  /** How many it put back on it. */
  restored: number;
}

/**
 * Resize the board without losing anything.
 *
 * The set-aside components are merged back into the order they were taken from
 * first, so the result is judged as one list and placement order — which the
 * canonical state is keyed on — survives a shrink-and-grow round trip. Then:
 *
 * - a component already on the board keeps its place if it still fits, and is set
 *   aside if it does not;
 * - a set-aside component comes back only where it both fits AND its tiles are
 *   free, since the board may have been built on while it was away. One that is
 *   blocked stays aside rather than evicting what is standing there.
 *
 * `at` is recorded against the merged list, so a component set aside and restored
 * with no other edits in between lands exactly where it was. Placing or deleting
 * components while others are set aside shifts the slots, so a later restore lands
 * near — not necessarily at — the original index; the export is re-read by the
 * oracle after any layout change, which is the step that settles the order.
 */
export function resizeBoard(
  design: Design,
  aside: readonly AsideEntity[],
  width: number,
  height: number,
): ResizeResult {
  const grid = { width, height };
  const merged = mergeAside(design.entities, aside);

  // Everything staying on the board reserves its tiles before any restore is
  // considered, so a returning component can never displace a standing one.
  const occupied = new Set<string>();
  for (const slot of merged) {
    if (!slot.wasAside && inBounds(slot.entity, grid))
      reserve(occupied, slot.entity);
  }

  const entities: DesignEntity[] = [];
  const nextAside: AsideEntity[] = [];
  let setAside = 0;
  let restored = 0;

  merged.forEach((slot, index) => {
    const { entity, wasAside } = slot;
    if (!wasAside) {
      if (inBounds(entity, grid)) {
        entities.push(entity);
      } else {
        nextAside.push({ at: index, entity });
        setAside++;
      }
      return;
    }
    if (canPlace(entity, grid, occupied)) {
      reserve(occupied, entity);
      entities.push(entity);
      restored++;
    } else {
      nextAside.push({ at: index, entity });
    }
  });

  return { design: { grid, entities }, aside: nextAside, setAside, restored };
}

/** One component in the merged ordering, and whether it was off the board. */
interface Slot {
  entity: DesignEntity;
  wasAside: boolean;
}

/** The board's components and the set-aside ones as one list in placement order. */
function mergeAside(
  entities: readonly DesignEntity[],
  aside: readonly AsideEntity[],
): Slot[] {
  const slots: Slot[] = entities.map((entity) => ({ entity, wasAside: false }));
  // Ascending, so each insert lands before the ones recorded after it.
  for (const { at, entity } of [...aside].sort((a, b) => a.at - b.at)) {
    slots.splice(Math.min(Math.max(at, 0), slots.length), 0, {
      entity,
      wasAside: true,
    });
  }
  return slots;
}

/** Mark every tile an entity covers as taken. */
function reserve(occupied: Set<string>, entity: DesignEntity): void {
  for (const [tx, ty] of footprint(entity)) occupied.add(tileKey(tx, ty));
}

// --- Scenario projection ---------------------------------------------------

/** The scenario wire version this tool emits (matches `SCENARIO_VERSION`). */
export const SCENARIO_VERSION = 1;

/** A scenario ready to load into the engine or export. */
export interface Scenario {
  version: number;
  grid: { width: number; height: number };
  ticks: number;
  snapshots: number[];
  entities: DesignEntity[];
}

/**
 * A scenario's timeline: how long it runs and the ticks it is checksummed at.
 *
 * This is kept separate from the layout, and carried around rather than recomputed,
 * because a SCORED scenario's schedule is load-bearing and not derivable: the case
 * grades at quarter/half/end plus two ticks inside the browser-playback window
 * (`1250`/`2500`). Opening such a file and saving it back must return that schedule
 * untouched, so nothing here silently regenerates one.
 */
export interface Timeline {
  ticks: number;
  snapshots: number[];
}

/**
 * Project a design to a scenario. The entities are already the scenario shape, so
 * this only wraps them with the grid and the timeline.
 *
 * Key order matters: it is chosen to match the committed scenarios exactly, so
 * opening one and saving it back with no edits rewrites the identical bytes.
 */
export function toScenario(design: Design, timeline: Timeline): Scenario {
  return {
    version: SCENARIO_VERSION,
    grid: { ...design.grid },
    ticks: timeline.ticks,
    snapshots: [...timeline.snapshots],
    entities: design.entities,
  };
}

/**
 * A placeholder timeline for a design that did not come from a file: four evenly
 * spaced checkpoints ending at `ticks`. Valid (strictly ascending, each in
 * `1..=ticks`) so the engine accepts it, but it is NOT a scored schedule — wiring a
 * fresh design into the case means setting the real one.
 */
export function defaultTimeline(ticks: number): Timeline {
  if (ticks <= 0) return { ticks, snapshots: [] };
  const seen = new Set<number>();
  const snapshots: number[] = [];
  for (const q of [1, 2, 3, 4]) {
    const t = Math.floor((ticks * q) / 4);
    if (t > 0 && t <= ticks && !seen.has(t)) {
      seen.add(t);
      snapshots.push(t);
    }
  }
  return { ticks, snapshots: snapshots.length > 0 ? snapshots : [ticks] };
}

/**
 * Why `timeline` would be rejected by `Scenario::parse`, or `null` if it is fine.
 * The engine requires at least one snapshot, strictly ascending, each within
 * `1..=ticks` — so shortening a run below a committed checkpoint is an error to
 * surface before a save, not after.
 */
export function timelineError(timeline: Timeline): string | null {
  const { ticks, snapshots } = timeline;
  if (!Number.isInteger(ticks) || ticks < 1) return "ticks must be at least 1";
  if (snapshots.length === 0) return "needs at least one snapshot tick";
  let previous = 0;
  for (const t of snapshots) {
    if (!Number.isInteger(t) || t < 1)
      return `snapshot ${t} must be at least 1`;
    if (t > ticks) return `snapshot ${t} is past the run's ${ticks} ticks`;
    if (t <= previous) return `snapshots must ascend (${previous} then ${t})`;
    previous = t;
  }
  return null;
}

/** The exportable JSON text for a design (pretty-printed, trailing newline). */
export function exportJson(design: Design, timeline: Timeline): string {
  return `${JSON.stringify(toScenario(design, timeline), null, 2)}\n`;
}

// --- Reading a scenario back -----------------------------------------------

/**
 * Parse a `scenario.json` into a design and its timeline — the inverse of
 * `toScenario`, for opening a committed scenario to edit.
 *
 * Entities are REBUILT through the same shapes `makeEntity` produces rather than
 * passed through, so an opened file is normalised into the editor's model and a
 * save emits the canonical field order. Placement order is preserved exactly: the
 * scenario contract reads it as the order of the canonical state, so shuffling it
 * would change every checksum.
 *
 * Throws with a specific reason on anything it cannot read — a silently half-loaded
 * factory would be far worse than a refusal.
 */
export function fromScenario(value: unknown): {
  design: Design;
  timeline: Timeline;
} {
  const root = asRecord(value, "scenario");
  const version = asNumber(root.version, "version");
  if (version !== SCENARIO_VERSION) {
    throw new Error(
      `unsupported scenario version ${version} (this tool writes ${SCENARIO_VERSION})`,
    );
  }
  const grid = asRecord(root.grid, "grid");
  const width = asNumber(grid.width, "grid.width");
  const height = asNumber(grid.height, "grid.height");
  if (width < 1 || height < 1) throw new Error("grid must be at least 1×1");

  const rawEntities = root.entities;
  if (!Array.isArray(rawEntities)) throw new Error("entities must be an array");

  const entities = rawEntities.map((entity, i) => {
    try {
      return parseEntity(entity);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`entities[${i}]: ${detail}`);
    }
  });

  const rawSnapshots = root.snapshots;
  if (!Array.isArray(rawSnapshots))
    throw new Error("snapshots must be an array");
  const timeline: Timeline = {
    ticks: asNumber(root.ticks, "ticks"),
    snapshots: rawSnapshots.map((t, i) => asNumber(t, `snapshots[${i}]`)),
  };

  return { design: { grid: { width, height }, entities }, timeline };
}

/** One entity, rebuilt into the editor's shape with its fields checked. */
function parseEntity(value: unknown): DesignEntity {
  const e = asRecord(value, "entity");
  const type = asString(e.type, "type");
  const x = asNumber(e.x, "x");
  const y = asNumber(e.y, "y");

  switch (type) {
    case "belt":
      return { type, x, y, dir: asDir(e.dir), tier: asTier(e.tier) };
    case "splitter":
    case "lane-splitter":
    case "inserter":
    case "sink":
      return { type, x, y, dir: asDir(e.dir) };
    case "assembler":
      return {
        type,
        x,
        y,
        recipe: asMember(e.recipe, ASSEMBLER_RECIPES, "recipe"),
      };
    case "furnace":
      return {
        type,
        x,
        y,
        recipe: asMember(e.recipe, FURNACE_RECIPES, "recipe"),
      };
    case "source":
      return {
        type,
        x,
        y,
        dir: asDir(e.dir),
        item: asMember(e.item, ITEMS, "item"),
        lane: asMember(e.lane, LANES, "lane"),
        period: asNumber(e.period, "period"),
      };
    default:
      throw new Error(`unknown entity type ${JSON.stringify(type)}`);
  }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${what} must be a number`);
  }
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} must be a string`);
  return value;
}

function asDir(value: unknown): Dir {
  return asMember(value, DIRS, "dir");
}

function asTier(value: unknown): BeltTier {
  return asMember(value, BELT_TIERS, "tier");
}

/** A string field constrained to one of `allowed`, named in the error. */
function asMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
  what: string,
): T {
  const text = asString(value, what);
  const found = allowed.find((option) => option === text);
  if (found === undefined) {
    throw new Error(
      `${what} ${JSON.stringify(text)} is not one of ${allowed.join(", ")}`,
    );
  }
  return found;
}
