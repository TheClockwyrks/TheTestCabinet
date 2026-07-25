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

/** The kinds of entity that can be placed, in palette order. */
export const ENTITY_KINDS = [
  "belt",
  "splitter",
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
    case "splitter": {
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
 * Project a design to a scenario. The entities are already the scenario shape, so
 * this only wraps them with the grid, a run length, and a snapshot schedule.
 *
 * `ticks`/`snapshots` are **preview/placeholder** values: this tool designs the
 * layout, and the scored run length and grading checkpoints are set later when the
 * real case is wired. The snapshot schedule here is a simple even split, kept valid
 * (strictly ascending, each `> 0` and `<= ticks`) so the engine accepts it.
 */
export function toScenario(design: Design, ticks: number): Scenario {
  return {
    version: SCENARIO_VERSION,
    grid: { ...design.grid },
    ticks,
    snapshots: snapshotSchedule(ticks),
    entities: design.entities,
  };
}

/** Four evenly spaced checkpoints ending at `ticks` (deduped, strictly ascending). */
function snapshotSchedule(ticks: number): number[] {
  if (ticks <= 0) return [];
  const quarters = [1, 2, 3, 4].map((q) => Math.floor((ticks * q) / 4));
  const seen = new Set<number>();
  const out: number[] = [];
  for (const t of quarters) {
    if (t > 0 && t <= ticks && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.length > 0 ? out : [ticks];
}

/** The exportable JSON text for a design (pretty-printed, trailing newline). */
export function exportJson(design: Design, ticks: number): string {
  return `${JSON.stringify(toScenario(design, ticks), null, 2)}\n`;
}
