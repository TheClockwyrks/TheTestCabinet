// hazards/lava-does-not-spread — a pool holds the cells it was made in.
//
// `specs/hazards.md` closes the lava rules with the one a player plans around:
// "Lava does not flow or spread, so a route around a pool can be planned." So a
// pool is posed in the deepstone, every cell of the neighbourhood around it is
// recorded, a long span of game time is run, and every cell is read back. A
// build whose lava crept would turn a neighbouring rock cell to lava; one whose
// lava drained would empty a cell of the pool.
//
// The miner is nowhere near it: both faculties are gated and it is left at the
// camp where a `reset` puts it, so nothing in the scene can drill, blast or
// disturb a cell. The only thing running is time.
//
// A minute of game time in sixty frames. Every rate here is integrated against
// the frame's delta, so a minute is a minute however it is divided, and lava
// that spread on a timer or a tick would have had a minute to do it in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  fillBlock,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
  type TileRead,
} from "../harness";
import { bandRow, HAZARD_COL } from "./scene";

/** The pool: three columns wide and two rows deep. */
const POOL_COLS = 3;
const POOL_ROWS = 2;

/** How far around the pool the neighbourhood reaches. */
const MARGIN = 2;

/** The span the world is left alone for, and the frames it is run in. */
const SECONDS = 60;
const FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every cell of the neighbourhood, read one at a time. */
async function readAround(
  fromCol: number,
  toCol: number,
  fromRow: number,
  toRow: number,
): Promise<{ key: string; tile: TileRead }[]> {
  const cells: { key: string; tile: TileRead }[] = [];
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let col = fromCol; col <= toCol; col += 1) {
      cells.push({ key: `(${col}, ${row})`, tile: await h.tileAt(col, row) });
    }
  }
  return cells;
}

it("leaves every cell of a pool and its neighbourhood as it was posed", async () => {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);
  const row = bandRow(await h.snapshot(), "deepstone");

  const pool = {
    fromCol: HAZARD_COL,
    toCol: HAZARD_COL + POOL_COLS - 1,
    fromRow: row,
    toRow: row + POOL_ROWS - 1,
  };
  // Rock around it, so a cell turning to lava is a change rather than a cell
  // that was already open being filled in.
  await fillBlock(
    h,
    {
      fromCol: pool.fromCol - MARGIN,
      toCol: pool.toCol + MARGIN,
      fromRow: pool.fromRow - MARGIN,
      toRow: pool.toRow + MARGIN,
    },
    "rock",
  );
  await fillBlock(h, pool, "lava");

  const before = await readAround(
    pool.fromCol - MARGIN,
    pool.toCol + MARGIN,
    pool.fromRow - MARGIN,
    pool.toRow + MARGIN,
  );
  const lavaCells = before.filter((c) => c.tile.kind === "lava").length;
  assertEqual(lavaCells, POOL_COLS * POOL_ROWS, "specs/instrumentation.md");

  const after = await captureReplay(h, "still", async () => {
    await h.advanceSeconds(SECONDS, FRAMES);
    return readAround(
      pool.fromCol - MARGIN,
      pool.toCol + MARGIN,
      pool.fromRow - MARGIN,
      pool.toRow + MARGIN,
    );
  });

  for (let i = 0; i < before.length; i += 1) {
    assertEqual(
      after[i].tile.kind,
      before[i].tile.kind,
      `specs/hazards.md, the cell ${before[i].key} after ${SECONDS} seconds`,
    );
  }
});
