// yard/build-beside-waypoint — the platform's own four tiles are the whole of the
// restriction, so the tiles around one are buildable like any other.
//
// `specs/yard.md` says it in as many words, and it is the half of the rule a
// build gets wrong by being careful: a protected zone dilated by one tile around
// each platform quietly removes twenty tiles of maze from every waypoint in the
// yard, and the player never learns why the wall would not go there. Every
// waypoint anchor sits at least four tiles inside every yard edge precisely so
// that a footprint fits beside an arm with a lane still open, so this is a
// placement the game owes.
//
// FOUR WAYS OF TOUCHING WITHOUT COVERING, which is what the item enumerates:
// hugging an arm, sitting on the anchor row beyond an arm, alongside the stem,
// and diagonally at a corner. Each is accepted, and each is checked to cover no
// platform tile before it is attempted, so the point is about acceptance rather
// than about the arithmetic of the anchors.
//
// The other direction, that a footprint covering a platform tile is refused, is
// the sibling point `no-build-on-waypoint`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FOOTPRINT, mapById, platformTiles } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  structureById,
  type Harness,
} from "../harness";

/** The platform the placements are laid against: mid-yard, above the centre. */
const WAYPOINT = 5;

/** Four anchors that touch that platform without covering a tile of it. */
const BESIDE = [
  { how: "hugging the left arm", col: 33, row: 13 },
  { how: "on the anchor row beyond the right arm", col: 38, row: 13 },
  { how: "alongside the stem", col: 37, row: 15 },
  { how: "diagonally at a corner", col: 34, row: 15 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts a placement that touches a platform without covering it", async () => {
  await openYard(h);
  const map = mapById((await h.snapshot()).map);
  const anchor = map.waypoints[WAYPOINT - 1]!;
  const covered = platformTiles(anchor.col, anchor.row);

  for (const beside of BESIDE) {
    // The anchor really is beside rather than on: none of its four tiles is one
    // of the platform's four.
    for (let dc = 0; dc < FOOTPRINT; dc += 1) {
      for (let dr = 0; dr < FOOTPRINT; dr += 1) {
        const on = covered.some(
          (tile) =>
            tile.col === beside.col + dc && tile.row === beside.row + dr,
        );
        assertEqual(
          on,
          false,
          `the anchor (${beside.col}, ${beside.row}) to cover no tile of the ` +
            `WP${WAYPOINT} platform at (${anchor.col}, ${anchor.row})`,
        );
      }
    }

    const before = (await h.snapshot()).structures.length;
    await h.debug.placeBlocker(beside.col, beside.row);
    const s = await h.snapshot();
    assertEqual(
      s.structures.length,
      before + 1,
      `a placement anchored at (${beside.col}, ${beside.row}), ` +
        `${beside.how} of the WP${WAYPOINT} platform at ` +
        `(${anchor.col}, ${anchor.row}), to be accepted: every Open tile that ` +
        `merely touches a platform is buildable (specs/yard.md)`,
    );
    const stood = structureById(s, s.structures[s.structures.length - 1]!.id);
    assertEqual(stood.col, beside.col, "the accepted anchor's col");
    assertEqual(stood.row, beside.row, "the accepted anchor's row");
  }

  await h.advance(1);
  await captureStill(h, "beside");
});
