// presentation/worm-distinct — the worm reads apart from the board and the nodes.
//
// specs/overview.md's legibility table: "The worm reads apart from the board
// behind it and from a node of any charge". That is what this point decides, and
// only that: the third clause of the same row — that the head, the body and the
// tail are told apart — is a different requirement, and the three
// `*-from-sprite` points are what hold a build to the three frame pairs
// specs/assets.md gives those parts.
//
// EVERY PART OF THE WORM IS READ, because the requirement is about the worm and a
// worm is head, body and tail. A build whose head blazes and whose body is the
// colour of the board has not made the worm read apart from the board; the
// failure names which segment collapsed.
//
// THE COMPARISON IS AGAINST WHAT ELSE IS ON THIS BOARD, never against a colour
// this check chose: specs/overview.md fixes no palette. The board is read off a
// bare tile in the worm's own row, so a build that draws its board with a
// gradient or a vignette is read where the worm is; the four charge states are
// posed on a row of their own, four tiles apart, so a node's glow cannot reach
// its neighbour.
//
// THE WORM IS POSED WITH ITS STEP HELD. Colour is not a faculty: this point
// exercises none of the worm's behaviour, so `setWormStepping(id, false)` leaves
// it standing on the tiles it was posed on and the reading is of a body at a
// known place. The board is otherwise the empty, quiet one `startPlaying` opens.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX } from "../../src/constants";
import { assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  headOf,
  lastWorm,
  poseWorm,
  startPlaying,
  tailOf,
  type Harness,
} from "../harness";
import { litTile } from "./reading";

/**
 * How far the worm must read from the board and from a node, in RGB distance on
 * the 0–441 scale.
 *
 * `441` is the whole scale, `sqrt(3) * 255`. specs/overview.md requires the worm
 * to "read apart" and fixes no colour, so the bar is what a measurement can
 * honestly call a different colour rather than a shade of the same one: 40 is
 * under a tenth of the scale, comfortably below anything legible. It is the
 * figure every colour point in this group is set at.
 */
const APART_MIN = 40;

/** The row the worm is posed on, and the row the four charge states are on. */
const WORM_ROW = 10;
const NODE_ROW = 4;

/** The worm: head at this tile, three segments, heading right. */
const HEAD_C = 20;
const WORM_LENGTH = 3;

/** The tile the board itself is read off: bare, in the worm's own row. */
const BARE_C = 32;

/** The four charge states, each on its own tile four tiles along. */
const CHARGES = [0, 1, 2, CHARGE_MAX];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every segment apart from the board and from a node of any charge", async () => {
  startPlaying(h);
  CHARGES.forEach((charge, i) => {
    h.debug.setNode(12 + 4 * i, NODE_ROW, charge);
  });
  const id = poseWorm(h, HEAD_C, WORM_ROW, WORM_LENGTH);
  h.debug.setWormStepping(id, false);
  await h.advance(1);
  captureStill(h, "worm");

  const worm = lastWorm(h.snapshot());
  assertLength(
    worm.segments,
    WORM_LENGTH,
    `the segments the posed worm still holds: a head from addWorm and ` +
      `${WORM_LENGTH - 1} appended behind it, none of which anything has ` +
      "removed (specs/instrumentation.md)",
  );
  const parts = [
    { name: "head", tile: headOf(worm) },
    { name: "body", tile: worm.segments[1] },
    { name: "tail", tile: tailOf(worm) },
  ];
  const board = litTile(h, BARE_C, WORM_ROW);
  const nodes = CHARGES.map((charge, i) => ({
    charge,
    color: litTile(h, 12 + 4 * i, NODE_ROW),
  }));

  for (const part of parts) {
    const color = litTile(h, part.tile.c, part.tile.r);
    assertGreaterThan(
      colorDistance(color, board),
      APART_MIN,
      `the worm's ${part.name}, on tile (${part.tile.c}, ${part.tile.r}), ` +
        `against the bare board tile (${BARE_C}, ${WORM_ROW}) in its own row, ` +
        "in RGB distance out of 441 (specs/overview.md: the worm reads apart " +
        "from the board behind it)",
    );
    for (const node of nodes) {
      assertGreaterThan(
        colorDistance(color, node.color),
        APART_MIN,
        `the worm's ${part.name} against a node at charge ${node.charge}, in ` +
          "RGB distance out of 441 (specs/overview.md: the worm reads apart " +
          "from a node of any charge)",
      );
    }
  }
});
