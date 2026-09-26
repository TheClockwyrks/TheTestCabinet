// yard/footprint-covers-four — a structure occupies exactly the four tiles
// `col`..`col + 1` by `row`..`row + 1`, and no others.
//
// The footprint is what makes a structure a wall, so its extent is what the maze
// is built out of. A build that blocks one tile leaves the maze porous and every
// route figure short; a build that blocks a three-by-three refuses placements
// that `specs/yard.md` permits and boxes the player in. Both are read the same
// way: the four anchors whose footprints overlap this one are refused, and the
// first anchor clear of it is accepted.
//
// The clear anchor is `(col + 2, row)`, which is where the next footprint starts
// with no gap at all — so a build that blocks one tile too many fails on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FOOTPRINT } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standBlocker,
  structureById,
  type Harness,
} from "../harness";

/** A clear anchor in the middle of the Substation, well off every platform. */
const AT = { col: 20, row: 10 };

/** The four anchors whose 2 by 2 footprint shares a tile with the one at `AT`. */
const OVERLAPPING = [
  { col: AT.col - 1, row: AT.row },
  { col: AT.col + 1, row: AT.row },
  { col: AT.col, row: AT.row - 1 },
  { col: AT.col, row: AT.row + 1 },
];

/** The first anchor clear of it: the next footprint along, with no gap. */
const BESIDE = { col: AT.col + FOOTPRINT, row: AT.row };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses every overlapping anchor and accepts the one beside it", async () => {
  await openYard(h);
  const standing = await standBlocker(h, AT.col, AT.row);
  const before = (await h.snapshot()).structures.length;

  for (const anchor of OVERLAPPING) {
    await h.debug.placeBlocker(anchor.col, anchor.row);
    const s = await h.snapshot();
    assertEqual(
      s.structures.length,
      before,
      `the yard to stay at ${before} structures after a placement anchored at ` +
        `(${anchor.col}, ${anchor.row}), whose footprint shares a tile with ` +
        `the structure anchored at (${AT.col}, ${AT.row})`,
    );
  }

  // The standing structure is untouched by the refusals.
  const held = structureById(await h.snapshot(), standing);
  assertEqual(held.col, AT.col, "the standing structure's col after refusals");
  assertEqual(held.row, AT.row, "the standing structure's row after refusals");

  // And the first anchor whose footprint clears it is accepted.
  await standBlocker(h, BESIDE.col, BESIDE.row);
  await h.advance(1);
  await captureStill(h, "footprint");

  assertEqual(
    (await h.snapshot()).structures.length,
    before + 1,
    `the yard to carry one more structure after a placement anchored at ` +
      `(${BESIDE.col}, ${BESIDE.row}), the first anchor clear of a 2 by 2 ` +
      `footprint at (${AT.col}, ${AT.row})`,
  );
});
