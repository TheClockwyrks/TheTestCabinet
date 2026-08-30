// press/spends-one-stamp — a drop that lands spends exactly one stamp, and a drop
// that is refused spends none.
//
// `specs/scrap-press.md` puts the roll on the landing rather than on the pull,
// and the stamp with it: placing a rock spends one, and a placement that fails
// any condition is refused with no stamp spent. The two halves are one
// requirement seen from either side, and both are read here on the same yard —
// the second drop is refused because it lands on the first drop's own footprint,
// which is a placement the player can attempt at any moment during a build phase.
//
// A build that charges the stamp when the press is pulled loses one to every
// illegal footprint the player brushes past; one that charges nothing at all has
// a build phase with no limit in it.

import { afterEach, beforeEach, it } from "vitest";

import { STAMPS_PER_LEVEL } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** Where the accepted drop lands, and where the refused one is attempted. */
const AT = { col: 20, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes one stamp for a landed drop and none for a refused one", async () => {
  openYard(h);
  assertEqual(
    h.snapshot().stampsLeft,
    STAMPS_PER_LEVEL,
    "the stamps a build phase opens with",
  );

  h.debug.placeRock(AT.col, AT.row);
  const landed = h.snapshot();
  assertEqual(landed.structures.length, 1, "the structures a landed drop left");
  assertEqual(
    landed.stampsLeft,
    STAMPS_PER_LEVEL - 1,
    `the stamps left after one drop landed at (${AT.col}, ${AT.row})`,
  );

  // The same footprint again: its tiles are no longer Open and it carries a
  // candidate rather than a blocker, so the placement is refused.
  h.debug.placeRock(AT.col, AT.row);
  const refused = h.snapshot();
  await h.advance(1);
  captureStill(h, "stamps");

  assertEqual(
    refused.structures.length,
    1,
    `the structures after a second drop onto the occupied footprint at ` +
      `(${AT.col}, ${AT.row})`,
  );
  assertEqual(
    refused.stampsLeft,
    STAMPS_PER_LEVEL - 1,
    "the stamps left after a refused drop, which spends none",
  );
});
