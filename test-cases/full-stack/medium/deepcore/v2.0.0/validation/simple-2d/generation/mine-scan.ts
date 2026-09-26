// generation — reading a whole generated mine in one crossing. SHARED HELPER.
//
// Not a suite: nothing here decides a review point, and vitest never collects a
// file that is not named `*.test.ts`. What it is, is the one reading a generation
// check cannot take a cell at a time.
//
// WHY THE SCAN EXISTS. `specs/world.md` states every generation rule as a property
// of a WHOLE BAND — where each kind may and may not appear, that no band is sealed
// across its width, that exactly one node sits in it — and a band at the Standard
// size is 125 rows of 30 columns. Every check that reads one walks the same grid,
// so the walk is written once: one pass calls the build's own `tileAt` on every
// cell and hands back the kinds as one string per row plus the ore and material
// cells as short lists.
//
// Nothing here poses anything, and nothing here reads the build's own modules. The
// reading is the same `tileAt` `specs/instrumentation.md` fixes, taken in bulk, and
// a build whose surface is missing it fails the check that reached for it naming
// what the specification requires.

import { PLAYABLE_COL_MAX, PLAYABLE_COL_MIN, WORLD_COLS } from "../constants";
import { fail } from "../assert";
import {
  bandAtFraction,
  depthFraction,
  minerXOn,
  minerYOn,
  openExpedition,
  pinDrill,
  pinMiner,
  placeAt,
  type Band,
  type Harness,
  type TileKind,
  type WorldSize,
} from "../harness";

/**
 * The five kinds `specs/world.md`'s tile table marks minable: the kinds that
 * carry a health and fall to the drill.
 */
export const MINABLE_TILE_KINDS: readonly TileKind[] = [
  "rock",
  "ore",
  "material",
  "gas",
  "lava",
];

/* -------------------------------------------------------------------------- */
/* Reading a whole mine                                                       */
/* -------------------------------------------------------------------------- */

/** One character per tile kind, so a row of the grid is one string. */
export const KIND_CHAR: Readonly<Record<TileKind, string>> = {
  rock: "r",
  ore: "o",
  material: "m",
  gas: "g",
  lava: "l",
  stone: "s",
  bedrock: "b",
  tunnel: "t",
  core: "c",
};

/** The kind a scanned character stands for, or `null` for one no kind claims. */
export function kindOfChar(char: string): TileKind | null {
  for (const kind of Object.keys(KIND_CHAR) as TileKind[]) {
    if (KIND_CHAR[kind] === char) return kind;
  }
  return null;
}

/** One ore cell, as the scan found it. */
export interface OreCell {
  col: number;
  row: number;
  ore: string;
}

/** One material node, as the scan found it. */
export interface MaterialCell {
  col: number;
  row: number;
  material: string;
}

/** A whole mine, read off the build's own `tileAt`. */
export interface MineScan {
  /** The deepest row: the Core chamber. */
  coreRow: number;
  /**
   * One string per row from `0` to `coreRow`, each `WORLD_COLS` characters, so
   * `rows[row][col]` is the kind character of `(col, row)`.
   */
  rows: string[];
  /** Every cell whose kind is `ore`, with the ore it holds. */
  ores: OreCell[];
  /** Every cell whose kind is `material`, with the material it holds. */
  materials: MaterialCell[];
}

/**
 * Read the whole grid, from `row 0` to the Core chamber, through the build's
 * `tileAt`.
 *
 * The `coreRow` comes off the snapshot rather than from the size, because the
 * grid the build generated is the one being measured.
 */
export function scanMine(h: Harness): MineScan {
  const { coreRow } = h.snapshot();
  const rows: string[] = [];
  const ores: OreCell[] = [];
  const materials: MaterialCell[] = [];
  for (let row = 0; row <= coreRow; row += 1) {
    let line = "";
    for (let col = 0; col < WORLD_COLS; col += 1) {
      const tile = h.tileAt(col, row);
      const kind = String(tile?.kind);
      line += (KIND_CHAR as Record<string, string>)[kind] ?? "?";
      if (kind === "ore" && typeof tile.ore === "string") {
        ores.push({ col, row, ore: tile.ore });
      }
      if (kind === "material" && typeof tile.material === "string") {
        materials.push({ col, row, material: tile.material });
      }
    }
    rows.push(line);
  }
  return { coreRow, rows, ores, materials };
}

/** The kind of one cell of a scan, or `null` for a character no kind claims. */
export function kindAt(
  scan: MineScan,
  col: number,
  row: number,
): TileKind | null {
  const line = scan.rows[row];
  if (line === undefined || col < 0 || col >= line.length) return null;
  return kindOfChar(line[col]);
}

/** The band a minable row of this mine falls in. */
export function bandOf(scan: MineScan, row: number): Band {
  return bandAtFraction(depthFraction(row, scan.coreRow));
}

/** The first and last minable row of each band, as the specification divides them. */
export function bandRows(
  coreRow: number,
): Record<Band, { from: number; to: number }> {
  const spans = {} as Record<Band, { from: number; to: number }>;
  for (let row = 1; row <= coreRow - 1; row += 1) {
    const band = bandAtFraction(depthFraction(row, coreRow));
    const span = spans[band];
    if (span === undefined) spans[band] = { from: row, to: row };
    else span.to = row;
  }
  return spans;
}

/** What one band of one mine holds. */
export interface BandTally {
  band: Band;
  from: number;
  to: number;
  /**
   * Every playable cell of the band: `PLAYABLE_COL_MIN` through
   * `PLAYABLE_COL_MAX` over its rows. This is the denominator every density in
   * `specs/world.md` is a share of — the field generation had to fill.
   */
  cells: number;
  /** How many of those cells hold each kind. */
  kinds: Record<TileKind, number>;
}

/** Count the kinds of every playable cell of one band. */
export function tallyBand(scan: MineScan, band: Band): BandTally {
  const { from, to } = bandRows(scan.coreRow)[band];
  const kinds = Object.fromEntries(
    (Object.keys(KIND_CHAR) as TileKind[]).map((kind) => [kind, 0]),
  ) as Record<TileKind, number>;
  let cells = 0;
  for (let row = from; row <= to; row += 1) {
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
      const kind = kindAt(scan, col, row);
      if (kind === null) {
        fail(
          `every cell of the grid to report one of the nine tile kinds specs/world.md names`,
          `tileAt(${col}, ${row}) reported a kind the specification does not list`,
        );
      }
      kinds[kind] += 1;
      cells += 1;
    }
  }
  return { band, from, to, cells, kinds };
}

/**
 * Whether a route runs from any cell of `fromRow` to any cell of `toRow` across
 * cells `passable` admits, moving orthogonally and staying within the rows given.
 */
export function routeExists(
  scan: MineScan,
  fromRow: number,
  toRow: number,
  passable: (kind: TileKind) => boolean,
): boolean {
  const seen = new Set<number>();
  const queue: { col: number; row: number }[] = [];
  const admit = (col: number, row: number): void => {
    if (row < fromRow || row > toRow) return;
    if (col < PLAYABLE_COL_MIN || col > PLAYABLE_COL_MAX) return;
    const key = row * WORLD_COLS + col;
    if (seen.has(key)) return;
    const kind = kindAt(scan, col, row);
    if (kind === null || !passable(kind)) return;
    seen.add(key);
    queue.push({ col, row });
  };
  for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
    admit(col, fromRow);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const { col, row } = queue[head];
    if (row === toRow) return true;
    admit(col + 1, row);
    admit(col - 1, row);
    admit(col, row + 1);
    admit(col, row - 1);
  }
  return false;
}

/** Every cell a route from `start` reaches across cells `passable` admits. */
export function reachableFrom(
  scan: MineScan,
  start: { col: number; row: number },
  passable: (kind: TileKind) => boolean,
): Set<number> {
  const seen = new Set<number>();
  const queue: { col: number; row: number }[] = [];
  const admit = (col: number, row: number): void => {
    if (row < 1 || row > scan.coreRow - 1) return;
    if (col < PLAYABLE_COL_MIN || col > PLAYABLE_COL_MAX) return;
    const key = row * WORLD_COLS + col;
    if (seen.has(key)) return;
    const kind = kindAt(scan, col, row);
    if (kind === null || !passable(kind)) return;
    seen.add(key);
    queue.push({ col, row });
  };
  admit(start.col, start.row);
  for (let head = 0; head < queue.length; head += 1) {
    const { col, row } = queue[head];
    admit(col + 1, row);
    admit(col - 1, row);
    admit(col, row + 1);
    admit(col, row - 1);
  }
  return seen;
}

/** The key `reachableFrom` records a cell under. */
export function cellKey(col: number, row: number): number {
  return row * WORLD_COLS + col;
}

/* -------------------------------------------------------------------------- */
/* Opening a generated mine, and looking at it                                */
/* -------------------------------------------------------------------------- */

/**
 * Generate a fresh mine at `size` and read the whole grid back.
 *
 * The expedition is opened through the surface rather than through the menus, so
 * a build with a broken title screen still has its generation graded.
 */
export function generatedMine(h: Harness, size?: WorldSize): MineScan {
  openExpedition(h, { size });
  return scanMine(h);
}

/**
 * Point the view at a cell and run the frames that draw it, so the still a check
 * captures shows the part of the mine the check measured.
 *
 * The miner is placed and then held, because a miner put down inside solid rock
 * is lodged there until the game's own collision resolves it, and what the
 * picture is of is the ground rather than the prospector. The drill is held with
 * it so that nothing is cut while the frames run.
 */
export async function look(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  placeAt(h, minerXOn(col), minerYOn(row));
  pinMiner(h);
  pinDrill(h);
  await h.advance(2);
}
