// presentation/bolts-drawn — a bolt in flight is drawn in its column.
//
// specs/overview.md's legibility table: "A bolt reads apart from the board along
// the column it is climbing." specs/assets.md seeds no art for a bolt and lists
// it among what "is rendered by the build", so what is asserted is that something
// is drawn where the bolt is — never a shape and never a colour, since
// specs/overview.md fixes no palette.
//
// WHERE THE BOLT IS, IS WHERE THE BOLT SAYS IT IS. The reading is taken about the
// centre `snapshot()` reports for the bolt after the frame that drew it, within
// half a tile on each axis, so a build whose bolt is drawn a column away from the
// one it is flying up is named here. Reading the reported centre rather than the
// posed one is what makes this a check on the drawing: a bolt climbs at
// `BOLT_SPEED` (`900` units per second, specs/cursor.md) and has moved by the time
// the frame is drawn.
//
// THE CONTROL IS THE SAME BOX OF THE SAME BOARD WITH THE BOLT TAKEN OFF IT.
// specs/overview.md leaves the board's look entirely to the build, so a box held
// against some other tile's colour would read a build's own ruling or texture as
// a bolt. Held against itself, the only thing that can move is what the bolt
// drew, and a build that etched a trace through that box is compared against its
// own trace.
//
// NO FIGURE IS ASSERTED. `getImageData` returns the bytes that are there, so a
// box the bolt drew nothing into comes back byte-identical to itself and measures
// exactly `0`. How brightly the bolt reads against the board is appearance, and
// the reviewer's from the captured still.
//
// ONE BOLT, ALONE ON THE BOARD. `addBolt` puts it in flight and "It then travels
// and resolves its hit through the real shot code" (specs/instrumentation.md), so
// it is posed mid-board in an empty column with nothing above it to resolve
// against — the point is about the drawing, and a bolt that struck something
// would not be in flight to be drawn. Taking it off with `clearBolts` leaves the
// same empty board behind.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../constants";
import { assertGreaterThan, assertLength, fail } from "../assert";
import {
  boltOf,
  captureStill,
  createHarness,
  poseBolt,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far the drawing may sit from the bolt's reported centre, in logical units.
 *
 * The review item's own tolerance: the bolt is drawn "within half a tile of its
 * reported centre", which is `TILE / 2` (`16`) on each axis. The box read is
 * exactly that box, so what is found in it is what was drawn within half a tile of
 * the centre and nothing else.
 */
const NEAR_MAX = TILE / 2;

/** The tile the bolt is posed in flight over: mid-board, in an empty column. */
const BOLT_C = 20;
const BOLT_R = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Every device pixel of the square of `half` logical units about `(x, y)`. */
function readBox(x: number, y: number, half: number): Uint8ClampedArray {
  const from = h.device(x - half, y - half);
  const to = h.device(x + half, y + half);
  return h.ctx.getImageData(
    from.x,
    from.y,
    Math.max(1, to.x - from.x),
    Math.max(1, to.y - from.y),
  ).data;
}

/** How far the furthest pixel of one reading moved against the other. */
function furthestMove(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let furthest = 0;
  const length = Math.min(before.length, after.length);
  for (let at = 0; at + 2 < length; at += 4) {
    const moved = Math.hypot(
      after[at] - before[at],
      after[at + 1] - before[at + 1],
      after[at + 2] - before[at + 2],
    );
    if (moved > furthest) furthest = moved;
  }
  return furthest;
}

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
    return;
  }

  const drawn = readBox(bolt.x, bolt.y, NEAR_MAX);

  // The same box of the same board with the bolt taken off it: the control every
  // pixel of the reading above is held against.
  h.debug.clearBolts();
  await h.advance(1);
  assertLength(h.snapshot().bolts, 0, "the board is left with no bolt");
  const bare = readBox(bolt.x, bolt.y, NEAR_MAX);

  assertGreaterThan(
    furthestMove(bare, drawn),
    0,
    `what is drawn within ${NEAR_MAX} units of the bolt's reported centre ` +
      `(${bolt.x}, ${bolt.y}) to differ from what that same box of the board ` +
      "carries with no bolt on it (specs/overview.md: a bolt reads apart from " +
      "the board along the column it is climbing)",
  );
});
