// Wireworm — presentation/worm-distinct: the worm reads apart from the board
// and from the field.
//
// specs/overview.md's legibility table: "The worm reads apart from the board
// behind it and from a node of any charge." A worm the player cannot pick out
// of the field is a worm the player cannot cut, which is the whole game. The
// specification fixes no palette, so what is checked is DISTANCE: the colour a
// segment paints its tile against the colour a bare tile carries, and against
// the colour each of the four charge states paints.
//
// ALL THREE PARTS ARE READ. specs/assets.md draws a worm from three pairs of
// frames — head, body, tail — so a worm whose head reads apart from the field
// while its body vanishes into it fails the rule the table states. A worm of
// three segments is the shortest that has one of each, and each part's own tile
// is sampled.
//
// THE WORM IS POSED WITH ITS STEP OFF. This point is about what a segment looks
// like, not about where it goes, so the worm holds the tiles it was laid on and
// the reading is of the picture the check arranged. The four nodes sit four rows
// below it, far enough that no glow a build lays around a node reaches a
// segment's tile and lifts its reading, and the bare tile sampled for the board
// is at the far end of the worm's own row.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  chargeAt,
  colorDistance,
  createHarness,
  poseWorm,
  resetTo,
  sampleTile,
  startPlaying,
  wormById,
  type Harness,
} from "../harness";

/**
 * How far apart the worm and what is behind it must read, as a Euclidean RGB
 * distance out of the `441` an RGB cube is across. The case's figure, since the
 * specification states the rule and leaves the palette to the build.
 */
const DISTINCT_MIN = 40;

/** The row the worm is laid along, and the head's column. */
const WORM_ROW = 6;
const HEAD_COLUMN = 10;

/** The row the four charge states are posed on, four rows below the worm. */
const FIELD_ROW = 10;

/** The column each charge is posed in, six tiles apart so no glow overlaps. */
const FIELD_COLUMN = [6, 12, 18, 24] as const;

/** A bare tile at the far end of the worm's own row: the board behind it. */
const BARE_COLUMN = 34;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the worm apart from the board and from a node of any charge", async () => {
  resetTo(h);
  startPlaying(h);
  // Head, one body segment and a tail, trailing left behind the head.
  const worm = poseWorm(h, HEAD_COLUMN, WORM_ROW, 3);
  h.debug.setWormStepping(worm, false);
  for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
    h.debug.setNode(FIELD_COLUMN[charge], FIELD_ROW, charge);
  }
  await h.advance(1);
  // The worm over the board, with the whole charge ramp beneath it.
  captureStill(h, "worm");

  const snapshot = h.snapshot();
  const posed = wormById(snapshot, worm);
  assertEqual(posed?.segments.length, 3, "the worm posed holds three segments");

  const board = sampleTile(h, BARE_COLUMN, WORM_ROW);
  const field = FIELD_COLUMN.map((column, charge) => {
    assertEqual(
      chargeAt(snapshot, column, FIELD_ROW),
      charge,
      `the node posed at (${column}, ${FIELD_ROW}) holds charge ${charge}`,
    );
    return sampleTile(h, column, FIELD_ROW);
  });

  const parts = ["head", "body", "tail"] as const;
  posed?.segments.forEach((segment, index) => {
    const part = parts[index];
    const drawn = sampleTile(h, segment.c, segment.r);
    assertGreaterThan(
      colorDistance(drawn, board),
      DISTINCT_MIN,
      `the worm's ${part} to differ from the board behind it by more than ` +
        `${DISTINCT_MIN} of 441 (specs/overview.md: the worm reads apart from ` +
        `the board behind it); the bare tile at (${BARE_COLUMN}, ${WORM_ROW}) ` +
        `sampled rgb(${board.r.toFixed(0)}, ${board.g.toFixed(0)}, ` +
        `${board.b.toFixed(0)})`,
    );
    for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
      assertGreaterThan(
        colorDistance(drawn, field[charge]),
        DISTINCT_MIN,
        `the worm's ${part} to differ from a node at charge ${charge} by more ` +
          `than ${DISTINCT_MIN} of 441 (specs/overview.md: the worm reads ` +
          `apart from a node of any charge); that node sampled rgb(` +
          `${field[charge].r.toFixed(0)}, ${field[charge].g.toFixed(0)}, ` +
          `${field[charge].b.toFixed(0)})`,
      );
    }
  });
});
