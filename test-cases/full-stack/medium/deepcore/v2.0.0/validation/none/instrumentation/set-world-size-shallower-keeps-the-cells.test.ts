// instrumentation/set-world-size-shallower-keeps-the-cells — a shallower size
// keeps every cell the old depth and the new one both hold.
//
// `specs/instrumentation.md`, Resizing the mine: "The grid is resized the way an
// array is resized, and every cell the two depths share comes through
// untouched", and a cell "above both the old and the new Core chamber" keeps
// "the same kind, band, ore, material, and remaining health".
//
// WHY THIS IS ITS OWN POINT, AND THE OTHER DIRECTION'S. Dropping the rows past
// the new depth and keeping the rows above it are two things a build gets right
// separately: one that empties the grid at the new depth drops every deep row
// and loses everything shallower with it, and a check that only read a dropped
// row would pass it. Growing and shrinking are separate code as well, so a build
// that keeps the mine on the way down can still lose it on the way up.
//
// AND THE BAND IS HALF OF IT. The same section: "A cell carries the band it was
// made with, so a cell that comes through a resize keeps its own band while the
// row it sits at may now fall in another one. Its health, its full health, and
// the band `tileAt` reports all follow the cell's own band." The two rows read
// here are chosen so the band the ROW falls in genuinely moves — the guard below
// refuses to run unless it does — so a cell still reporting its own band and its
// own band's full health is the specification's rule rather than an accident of
// where the bands happen to fall.
//
// ISOLATION. An empty mine at the deep size, holding only the cells this
// point poses, with both faculties gated so the miner neither falls into them
// nor cuts one.

import { afterEach, beforeEach, it } from "vitest";
import { coreRowFor, WORLD_COLS } from "../constants";
import { assertDeepEqual, assertEqual, fail } from "../assert";
import {
  bandOfRow,
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
  type TileRead,
} from "../harness";

/** The size the cells are posed at, and the shallower one the mine is taken to. */
const FROM = "marathon" as const;
const TO = "quick" as const;

/** A shallow row, in the same band at both depths. */
const SHALLOW_ROW = 3;

/** The two rows whose band moves when the depth does. Both survive the shrink. */
const MID_ROW = 100;
const DEEP_ROW = 240;

/** Every cell read back, posed or not: the terrain, the border, and the camp. */
const READ: readonly (readonly [number, number])[] = [
  [5, MID_ROW],
  [7, MID_ROW],
  [9, MID_ROW],
  [11, MID_ROW],
  [13, MID_ROW],
  [5, SHALLOW_ROW],
  [5, DEEP_ROW],
  [0, MID_ROW],
  [WORLD_COLS - 1, MID_ROW],
  [5, 0],
];

/**
 * Lay one of every kind a resize could destroy: an ore vein part-way cut, a
 * gas pocket, lava, an unbreakable boulder, and rock both whole and part-way
 * cut, at three depths.
 */
async function poseCells(h: Harness): Promise<void> {
  await h.debug.setOreTile(5, MID_ROW, "ferron");
  await h.debug.setTileHealth(5, MID_ROW, 1);
  await h.debug.setTile(7, MID_ROW, "lava");
  await h.debug.setTile(9, MID_ROW, "stone");
  await h.debug.setTile(11, MID_ROW, "gas");
  await h.debug.setTile(13, MID_ROW, "rock");
  await h.debug.setTileHealth(13, MID_ROW, 2);
  await h.debug.setTile(5, SHALLOW_ROW, "rock");
  await h.debug.setTile(5, DEEP_ROW, "rock");
  await h.debug.setTileHealth(5, DEEP_ROW, 3);
}

/** Read every cell of {@link READ} back, in order. */
async function readCells(h: Harness): Promise<TileRead[]> {
  const cells: TileRead[] = [];
  for (const [col, row] of READ) cells.push(await h.tileAt(col, row));
  return cells;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps every cell the two depths hold when the size is taken shallower", async () => {
  await openScene(h, { size: FROM });
  await pinMiner(h);
  await pinDrill(h);
  await poseCells(h);
  await h.advance(1);
  const deep = await h.snapshot();
  const before = await readCells(h);

  await h.debug.setWorldSize(TO);
  await h.advance(1);
  await captureStill(h, "kept");
  const shallow = await h.snapshot();

  assertEqual(
    deep.coreRow,
    coreRowFor(FROM),
    `specs/world.md: coreRow at ${FROM}`,
  );
  assertEqual(
    shallow.coreRow,
    coreRowFor(TO),
    `specs/world.md: coreRow at ${TO}`,
  );

  // The scenario is only worth reading if the bands really move under these
  // rows, so the cells that come through are answering with their own band
  // rather than with one the new depth would have given them anyway.
  for (const row of [MID_ROW, DEEP_ROW]) {
    if (bandOfRow(deep, row) === bandOfRow(shallow, row)) {
      fail(
        `a row whose band moves between ${FROM} and ${TO}`,
        `row ${row}, ${bandOfRow(deep, row)} at both`,
      );
    }
    if (row >= shallow.coreRow) {
      fail(`a row inside the ${TO} mine`, `row ${row}`);
    }
  }

  const after = await readCells(h);
  READ.forEach(([col, row], index) => {
    assertDeepEqual(
      after[index],
      before[index],
      `specs/instrumentation.md: the cell at (${col}, ${row}) comes through the resize untouched`,
    );
  });
});
