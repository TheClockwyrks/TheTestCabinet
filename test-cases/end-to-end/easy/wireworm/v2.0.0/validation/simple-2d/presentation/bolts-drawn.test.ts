// presentation/bolts-drawn — a bolt in flight is drawn in its column.
//
// specs/overview.md's legibility table: "A bolt reads apart from the board along
// the column it is climbing." specs/assets.md seeds no art for a bolt and lists
// it among what "is rendered by the build", so what is asserted is that something
// is drawn where the bolt is and that it reads apart from the board — never a
// shape and never a colour, since specs/overview.md fixes no palette.
//
// WHERE THE BOLT IS, IS WHERE THE BOLT SAYS IT IS. The reading is taken about the
// centre `snapshot()` reports for the bolt after the frame that drew it, within
// half a tile on each axis, so a build whose bolt is drawn a column away from the
// one it is flying up is named here. Reading the reported centre rather than the
// posed one is what makes this a check on the drawing: a bolt climbs at
// `BOLT_SPEED` (`900` units per second, specs/cursor.md) and has moved by the time
// the frame is drawn.
//
// THE COMPARISON IS AGAINST A BOX OF THE SAME SHAPE, taken over bare board at the
// same height, so whatever the build rules or shades its board with is in both
// readings and only the bolt is in one of them.
//
// ONE BOLT, ALONE ON THE BOARD. `addBolt` puts it in flight and "It then travels
// and resolves its hit through the real shot code" (specs/instrumentation.md), so
// it is posed mid-board in an empty column with nothing above it to resolve
// against — the point is about the drawing, and a bolt that struck something
// would not be in flight to be drawn.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, tileCX } from "../constants";
import { assertGreaterThan, fail } from "../assert";
import {
  boltOf,
  captureStill,
  colorDistance,
  createHarness,
  poseBolt,
  startPlaying,
  type Harness,
} from "../harness";
import { litColor } from "./reading";

/**
 * How far the drawing may sit from the bolt's reported centre, in logical units.
 *
 * The review item's own tolerance: the bolt is drawn "within half a tile of its
 * reported centre", which is `TILE / 2` (`16`) on each axis. The box read is
 * exactly that box, so what is found in it is what was drawn within half a tile of
 * the centre and nothing else.
 */
const NEAR_MAX = TILE / 2;

/**
 * How far the bolt's box must read from bare board, in RGB distance on the 0–441
 * scale.
 *
 * `441` is the whole scale, `sqrt(3) * 255`. specs/overview.md requires a bolt to
 * "read apart from the board along the column it is climbing" and fixes no
 * colour, so the bar is what a measurement can honestly call a different colour
 * rather than a shade of the same one: 40 is under a tenth of the scale. It is
 * the figure every colour point in this group is set at.
 */
const APART_MIN = 40;

/** The tile the bolt is posed in flight over: mid-board, in an empty column. */
const BOLT_C = 20;
const BOLT_R = 10;

/** The column the board itself is read off: bare, and eight tiles away. */
const BARE_C = 28;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the bolt within half a tile of its reported centre, apart from the board", async () => {
  startPlaying(h);
  const id = poseBolt(h, BOLT_C, BOLT_R);
  await h.advance(1);
  captureStill(h, "bolt");

  const bolt = boltOf(h.snapshot(), id);
  if (bolt === null) {
    fail(
      `the bolt addBolt put in flight (id ${id}) still reported by snapshot() ` +
        "one frame later — it was posed mid-board in an empty column, with " +
        "nothing above it to resolve against (specs/cursor.md)",
      null,
    );
  }

  const apart = colorDistance(
    litColor(h, { x: bolt.x, y: bolt.y, half: NEAR_MAX }),
    litColor(h, { x: tileCX(BARE_C), y: bolt.y, half: NEAR_MAX }),
  );
  assertGreaterThan(
    apart,
    APART_MIN,
    `what is drawn within ${NEAR_MAX} units of the bolt's reported centre ` +
      `(${bolt.x}, ${bolt.y}), against a box of the same shape over bare ` +
      `board at the same height, in RGB distance out of 441 ` +
      "(specs/overview.md: a bolt reads apart from the board along the column " +
      "it is climbing)",
  );
});
