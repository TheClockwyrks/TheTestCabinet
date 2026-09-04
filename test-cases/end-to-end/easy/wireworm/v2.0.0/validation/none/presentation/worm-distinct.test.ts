// Wireworm — presentation/worm-distinct: the worm reads apart from the board and
// from the field.
//
// specs/overview.md's legibility table: "The worm reads apart from the board
// behind it and from a node of any charge." A worm the player cannot pick out of
// the field is a worm the player cannot cut, which is the whole game. The
// specification fixes no palette, so what is checked is DISTANCE: the colour a
// segment paints its tile against the colour a bare tile of the same row
// carries, and against the colour each of the four charge states paints.
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
//
// The colour of a segment, of a node and of the bare board is the colour of its
// LIT MARK, read as `presentation/reading` explains, so a body and the ground
// behind it are compared like with like.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { CHARGE_MAX } from "../constants";
import {
  captureStill,
  chargeAt,
  colorDistance,
  createHarness,
  poseWorm,
  startPlaying,
  wormById,
  type Harness,
  type Rgb,
} from "../harness";
import { litTile, rgb } from "./reading";

/**
 * How far apart the worm and what is behind it must read, as a Euclidean RGB
 * distance out of the `441` an RGB cube is across. The case's figure, since the
 * specification states the rule and leaves the palette to the build: `40` is
 * about a tenth of the space, which is the least a player reads at a glance.
 */
const DISTINCT_MIN = 40;

/** The row the worm is laid along, the head's column, and its length. */
const WORM_ROW = 6;
const HEAD_COLUMN = 10;
const WORM_LENGTH = 3;

/** The row the four charge states are posed on, four rows below the worm. */
const FIELD_ROW = 10;

/** The column each charge is posed in, six tiles apart so no glow overlaps. */
const FIELD_COLUMN = [6, 12, 18, 24] as const;

/** A bare tile at the far end of the worm's own row: the board behind it. */
const BARE_COLUMN = 34;

/** The part of the chain each segment index is, head first. */
const PARTS = ["head", "body", "tail"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the worm apart from the board and from a node of any charge", async () => {
  await startPlaying(h);
  // Head, one body segment and a tail, trailing left behind the head.
  const worm = await poseWorm(h, {
    c: HEAD_COLUMN,
    r: WORM_ROW,
    length: WORM_LENGTH,
    stepping: false,
  });
  for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
    await h.debug.setNode(FIELD_COLUMN[charge], FIELD_ROW, charge);
  }
  await h.advance(1);
  // The worm over the board, with the whole charge ramp beneath it.
  await captureStill(h, "worm");

  const snapshot = await h.snapshot();
  const posed = wormById(snapshot, worm);
  assertEqual(
    posed?.segments.length,
    WORM_LENGTH,
    "the worm posed holds three segments, so it has a head, a body and a tail",
  );

  const board = await litTile(h, BARE_COLUMN, WORM_ROW);
  const field: Rgb[] = [];
  for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
    const column = FIELD_COLUMN[charge];
    assertEqual(
      chargeAt(snapshot, column, FIELD_ROW),
      charge,
      `the node posed at (${column}, ${FIELD_ROW}) holds charge ${charge}`,
    );
    field.push(await litTile(h, column, FIELD_ROW));
  }

  for (const [index, segment] of (posed?.segments ?? []).entries()) {
    const part = PARTS[index];
    const drawn = await litTile(h, segment.c, segment.r);
    assertGreaterThan(
      colorDistance(drawn, board),
      DISTINCT_MIN,
      `the worm's ${part} to differ from the board behind it by more than ` +
        `${DISTINCT_MIN} of 441 (specs/overview.md: the worm reads apart from ` +
        `the board behind it); the bare tile at (${BARE_COLUMN}, ${WORM_ROW}) ` +
        `sampled ${rgb(board)} and the ${part} sampled ${rgb(drawn)}`,
    );
    for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
      assertGreaterThan(
        colorDistance(drawn, field[charge]),
        DISTINCT_MIN,
        `the worm's ${part} to differ from a node at charge ${charge} by ` +
          `more than ${DISTINCT_MIN} of 441 (specs/overview.md: the worm ` +
          `reads apart from a node of any charge); that node sampled ` +
          `${rgb(field[charge])} and the ${part} sampled ${rgb(drawn)}`,
      );
    }
  }
});
