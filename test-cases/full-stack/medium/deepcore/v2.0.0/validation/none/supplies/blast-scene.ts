// Deepcore — the scene the field-supply checks share.
//
// Not a suite: a `.ts` beside the suites, which the project never collects. It
// arranges what several checks arrange identically and decides nothing.
//
// WHAT AN EXPLOSIVES CHECK NEEDS. `specs/items.md` centres both blocks "on the
// miner's cell", so the world a check poses is solid rock for several cells in
// every direction with the miner's own cell open and the miner standing in it.
// The pad is four cells wide, so the ring immediately outside a `5x5` block is
// still rock and a check can read that the blast stopped where the specification
// says it stops.
//
// The miner's cell is READ BACK from the snapshot rather than assumed: the block
// is centred on the cell the game says the miner is in, so the check grades the
// blast rather than the build's idea of which cell that is.
//
// BOTH FACULTIES ARE HELD OFF. A blast opens the ground out from under the miner
// and a gas pocket inside it shoves the miner away at `GAS_KNOCKBACK`, so a miner
// free to move falls out of the scenario it was posed in; and no check here is
// about the drill, so a key held for any other reason must not bore through the
// block. `specs/instrumentation.md` fixes both gates, and everything else about
// the miner — damage above all — carries on under them.

import {
  fillBlock,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type CellRef,
  type Harness,
  type TileKind,
  type TileRead,
} from "../harness";

/** The column the scene is built around. */
export const BLAST_COL = 10;

/** The miner's own cell, high in the topsoil: plain rock, nothing else near it. */
export const SHALLOW_ROW = 19;

/**
 * The miner's own cell for the gas checks, well inside the rockbed.
 *
 * `specs/world.md` places gas from the rockbed down, so a pocket a check poses
 * sits in a band that really holds them and the damage read back is the damage
 * that depth really deals.
 */
export const GAS_ROW = 150;

/** How far out from the miner's cell the scene is filled with rock. */
export const PAD = 4;

/** Cells at a Chebyshev distance of exactly `radius` from `centre`. */
export function ringCells(centre: CellRef, radius: number): CellRef[] {
  const cells: CellRef[] = [];
  for (let dr = -radius; dr <= radius; dr += 1) {
    for (let dc = -radius; dc <= radius; dc += 1) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) === radius) {
        cells.push({ col: centre.col + dc, row: centre.row + dr });
      }
    }
  }
  return cells;
}

/** Every cell of the square block of `radius` centred on `centre`. */
export function blockCells(centre: CellRef, radius: number): CellRef[] {
  const cells: CellRef[] = [];
  for (let dr = -radius; dr <= radius; dr += 1) {
    for (let dc = -radius; dc <= radius; dc += 1) {
      cells.push({ col: centre.col + dc, row: centre.row + dr });
    }
  }
  return cells;
}

/** Read a run of cells, in the order given. */
export async function readCells(
  h: Harness,
  cells: readonly CellRef[],
): Promise<TileRead[]> {
  const read: TileRead[] = [];
  for (const cell of cells) read.push(await h.tileAt(cell.col, cell.row));
  return read;
}

/** Fill the pad back in with solid rock, leaving the miner's cell open. */
export async function layRockAround(
  h: Harness,
  centre: CellRef,
  kind: TileKind = "rock",
): Promise<void> {
  await fillBlock(
    h,
    {
      fromCol: centre.col - PAD,
      toCol: centre.col + PAD,
      fromRow: centre.row - PAD,
      toRow: centre.row + PAD,
    },
    kind,
  );
  await h.debug.setTile(centre.col, centre.row, "tunnel");
}

/**
 * Open a scene with the miner standing in a pocket of solid rock, and report the
 * cell the game says it is in.
 *
 * The miner stands ON the cell below its own, which is what `standOn` means and
 * what puts its box in `cellRow`.
 */
export async function openBlastScene(
  h: Harness,
  cellRow: number = SHALLOW_ROW,
): Promise<CellRef> {
  await openScene(h);
  await layRockAround(h, { col: BLAST_COL, row: cellRow });
  await standOn(h, BLAST_COL, cellRow + 1);
  await pinMiner(h);
  await pinDrill(h);
  const { miner } = await h.snapshot();
  return { col: miner.col, row: miner.row };
}

/** Open a scene at the camp, where the miner stands above the ground line. */
export async function openCampScene(h: Harness): Promise<void> {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);
}

/** Frames run after a blast so the recording carries the aftermath. */
export const AFTERMATH_FRAMES = 30;
