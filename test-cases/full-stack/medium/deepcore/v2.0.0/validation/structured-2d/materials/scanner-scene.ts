// Deepcore — the world the nine scanner checks are posed in. CASE-PROVIDED.
//
// `specs/mining.md` measures the scanner's lock "in tiles as the straight-line
// distance between the miner's cell and the node's cell", so every scanner point
// needs the same three things: a mine holding no material node but the one the
// point is about, a miner that stays where it was put, and a way to say where a
// node sits RELATIVE to the miner's own cell rather than at an absolute address.
//
// The miner's cell is read back from the snapshot rather than derived here,
// because how a build maps a continuous position onto a cell is the build's:
// `specs/character.md` fixes only that the position is continuous and not
// snapped to the grid. Taking the cell from the snapshot and the distance from
// the same snapshot is what makes the reading the specification's rule rather
// than an assumption about where the box's centre falls.

import { SCANNER_TIERS } from "../constants";
import { fail } from "../assert";
import {
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type CellRef,
  type DeepcoreSnapshot,
  type Harness,
  type Material,
} from "../harness";

/**
 * The range `specs/upgrades.md` gives a scanner tier, in tiles.
 *
 * The table there has three rows and only the last two carry a number: tier 1 is
 * "no scanner at all", which `../constants` spells as a `null` entry. A point
 * about a RANGE names one of the two tiers that has one, so a `null` here is the
 * check asking for a range that does not exist rather than a fact about a build.
 */
export function scannerRange(tier: number): number {
  const range = SCANNER_TIERS[tier - 1];
  if (typeof range !== "number") {
    fail(`a scanner range specs/upgrades.md states for tier ${tier}`, range);
  }
  return range;
}

/** The column the miner is posed in: clear of both border columns. */
export const MINER_COL = 8;

/** The row the miner stands on, so its box occupies the row above it. */
export const MINER_ROW = 12;

/**
 * Open a mine holding nothing, stand the miner still in it, and set the scanner
 * tier the point is about.
 *
 * Both faculties are gated: this is a point about what the scanner REPORTS, so
 * the miner neither travels out of the pose nor bores through the node it is
 * looking at. `openScene` leaves the mine empty, so the only material nodes in
 * the world are the ones the point poses.
 */
export function openScanner(h: Harness, tier: number): void {
  openScene(h);
  pinMiner(h);
  pinDrill(h);
  h.debug.setTier("scanner", tier);
  standOn(h, MINER_COL, MINER_ROW);
}

/** Put a material node at a cell, replacing whatever stood there. */
export function poseNode(h: Harness, cell: CellRef, material: Material): void {
  h.debug.setMaterialTile(cell.col, cell.row, material);
}

/** Take a posed node off its cell, leaving open tunnel. */
export function clearNode(h: Harness, cell: CellRef): void {
  h.debug.setTile(cell.col, cell.row, "tunnel");
}

/** The cell the snapshot says the miner is in. */
export function minerCell(snapshot: DeepcoreSnapshot): CellRef {
  return { col: snapshot.miner.col, row: snapshot.miner.row };
}

/** The straight-line distance between two cells, in tiles. */
export function cellDistance(a: CellRef, b: CellRef): number {
  return Math.hypot(a.col - b.col, a.row - b.row);
}

/**
 * Run one frame and read the state back.
 *
 * The scanner's lock is derived from where the miner and the node are, and
 * `specs/instrumentation.md` lists it among the fields that are derived rather
 * than stored. So a pose is read after a frame has run, rather than in the
 * instant between the pose and the next tick, and a build that recomputes the
 * lock on its own tick is read where the specification's value has settled
 * rather than where one design happens to write it.
 */
export async function settled(h: Harness): Promise<DeepcoreSnapshot> {
  await h.advance(1);
  return h.snapshot();
}
