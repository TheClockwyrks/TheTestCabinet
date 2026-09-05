// instrumentation/clear-trail — `clearTrail()` wipes the painted layer and zeroes
// its count, and leaves the cards in flight exactly where they are.
//
// THE RULE. `specs/instrumentation.md`, The cascade: `clearTrail()` "Clears the
// painted layer and sets `trailStamps` to `0`, leaving the flyers standing."
//
// WHY THE CASE NEEDS IT AT ALL, AND WHY IT IS ITS OWN POINT. The painted layer is
// "never cleared while the cascade runs" (`specs/victory.md`), so without this
// operation a scenario that wanted to read the table twice during one flight would
// be reading the first reading's paint the second time. Three points in the
// `cascade` group rest on it. `reset` clears the layer too, but `reset` also
// empties the flight, the table and the clock — the whole value of this operation
// is that it clears the layer AND NOTHING ELSE, which is the direction the last
// reading below takes.
//
// TWO CARDS ARE PUT IN FLIGHT, so "every flyer is still in flight" is a reading
// with a plural in it: a build that dropped the flight along with the layer, and
// one that kept only the last card, both fail here and are told apart by which id
// went missing.
//
// THE TABLE IS READ WHERE THE CARDS HAVE LEFT. Each card is posed at rest over its
// own footprint and driven right, and the rectangle read is the footprint it
// started on — painted by the card's first stamps and vacated long before the
// reading. So the pixels are the layer's, never the card's, and a card still being
// drawn cannot be mistaken for a stamp that survived. The cards stay clear of the
// floor and of both side edges for the whole span, so nothing bounces, nothing
// retires, and the only cascade rule this point leans on is the one it is about.
//
// THE COUNT IS READ WITH NO FRAME BETWEEN, because painting is left ON — the
// requirement is what `clearTrail` does, not what a gate does — and the very next
// frame stamps both cards again where they now are. That frame is run before the
// pixels are read, because a canvas shows what the last frame drew, and its two
// fresh stamps are four hundred units to the right of everything being read.
//
// WHAT THIS DOES NOT DECIDE. That a stamp is laid, or persists, or accumulates
// (`cascade/trail-persists`, `cascade/trail-accumulates`), that the painting can be
// gated (`instrumentation/trail-painting-gate-off`), or that `reset` clears the layer
// (`instrumentation/reset-clears-trail`).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import {
  CARD_H,
  CARD_W,
  FLOOR_Y,
  LAUNCH_VX_MAX,
  LAUNCH_VX_MIN,
  STAGE_W,
} from "../constants";
import {
  captureStill,
  createHarness,
  flyerById,
  framesFor,
  gridPoints,
  openTable,
  poseFlyer,
  type Harness,
  type Rect,
} from "../harness";

/** How long the two cards fly before the layer is cleared, in seconds. */
const SPAN_SECONDS = 0.5;

/**
 * The two cards, and the two rectangles the table is read over.
 *
 * Both sit left of `STOCK_X` (`224`), so `specs/table.md` puts nothing there on
 * any screen and a stamp is the only thing that can mark them. Both speeds lie
 * inside `[LAUNCH_VX_MIN, LAUNCH_VX_MAX]` (`[180, 420]`), the range
 * `specs/victory.md` draws a launched card's `vx` from, so neither card moves
 * faster than the game can ever launch one: the first at the top of that range
 * and the second at its midpoint. Each carries its card `150` units or more over
 * the span — over its own width — so each rectangle is bare of cards by the time
 * it is read, while both cards stay more than `800` units clear of the right edge
 * and, starting `480` and `320` above `FLOOR_Y` (`580`) with no downward speed of
 * their own and `225` units of fall to make in the span, clear of the floor
 * throughout.
 */
const CARDS = [
  { x: 100, y: 100, vx: LAUNCH_VX_MAX },
  { x: 100, y: 260, vx: (LAUNCH_VX_MIN + LAUNCH_VX_MAX) / 2 },
] as const;

/** How finely each rectangle is sampled: twelve points, none on an edge. */
const SAMPLE_COLS = 3;
const SAMPLE_ROWS = 4;

/** The twelve points of one card's start footprint. */
function footprintPoints(at: {
  x: number;
  y: number;
}): { x: number; y: number }[] {
  const rect: Rect = { x: at.x, y: at.y, w: CARD_W, h: CARD_H };
  return gridPoints(rect, SAMPLE_COLS, SAMPLE_ROWS);
}

/*
 * A PAINTED footprint only has to read DIFFERENTLY from the bare table, and how
 * far apart the two sit is not measured: `specs/overview.md` fixes no palette, so
 * that is the reviewer's. It is a precondition — what this point decides is the
 * reading after the clear — and rendering is deterministic, so any difference at
 * all is the paint.
 */

/**
 * The largest colour distance a CLEARED point may show against the same point
 * read before anything was painted, out of `441`.
 *
 * `8`. Both readings are the same build drawing a table the specification makes
 * bare in both, so the only distance between them is the rasterizer's own; this
 * is that noise floor with room to spare, and a stamp of a whole card cannot hide
 * inside it.
 */
const CLEAN_DISTANCE = 8;

/** Each point set read in turn, one crossing into the page per set. */
async function readSets(
  harness: Harness,
  sets: readonly { x: number; y: number }[][],
): Promise<[number, number, number, number][][]> {
  const read: [number, number, number, number][][] = [];
  for (const set of sets) read.push(await harness.pixels(set));
  return read;
}

/** The colour distance between two sampled pixels. */
function distance(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the painted layer and its count, leaving every flyer in flight", async () => {
  for (const spec of CARDS) {
    if (
      spec.y > FLOOR_Y ||
      spec.x + spec.vx * SPAN_SECONDS + CARD_W > STAGE_W ||
      spec.vx * SPAN_SECONDS < CARD_W
    ) {
      throw new RangeError(
        `cascade: a card posed at (${spec.x}, ${spec.y}) with vx ${spec.vx} ` +
          `does not both clear its own footprint and stay clear of the edges ` +
          `over ${SPAN_SECONDS} s`,
      );
    }
  }

  // ---- The bare table -------------------------------------------------------

  await openTable(h);
  // The screen the cascade runs on, so a card in flight is drawn and a stamp has
  // somewhere to land (`specs/screens.md`, `specs/victory.md`). The table under
  // it is empty and nothing launches, so the two posed cards are the whole of
  // the world.
  await h.debug.setScreen("won");
  await h.debug.setLaunching(false);
  await h.advance(1);

  const points = CARDS.map((spec) => footprintPoints(spec));
  const bare = await readSets(h, points);

  // ---- Two cards, and the paint they leave -----------------------------------

  const ids: number[] = [];
  for (const spec of CARDS) {
    ids.push(await poseFlyer(h, { x: spec.x, y: spec.y, vx: spec.vx, vy: 0 }));
  }
  await h.advance(framesFor(SPAN_SECONDS));

  const flying = await h.snapshot();
  const marked = await readSets(h, points);

  // ---- The clear ------------------------------------------------------------

  await h.debug.clearTrail();
  // Read with no frame between: painting is on, so the next frame stamps both
  // cards again where they now are.
  const cleared = await h.snapshot();

  // One frame, so the canvas shows the cleared layer rather than the last frame
  // that drew before it. Its two fresh stamps land where the cards are now,
  // hundreds of units right of every point read below.
  await h.advance(1);
  // Before the assertions, so a layer that was not cleared still leaves the
  // picture of the table it left.
  await captureStill(h, "cleared");
  const after = await readSets(h, points);
  const still = await h.snapshot();

  // ---- The readings ---------------------------------------------------------

  assertGreaterThan(
    flying.trailStamps,
    0,
    `snapshot().trailStamps after ${SPAN_SECONDS} s of flight — a flight that ` +
      `stamped nothing would leave nothing for clearTrail to clear`,
  );
  for (const [index, spec] of CARDS.entries()) {
    assertGreaterThan(
      Math.max(
        ...marked[index].map((pixel, at) => distance(pixel, bare[index][at])),
      ),
      0,
      `the largest colour distance across the ${points[index].length} points ` +
        `of the footprint the card posed at (${spec.x}, ${spec.y}) flew off, ` +
        `against the same points read before it was posed — that footprint has ` +
        `to have been painted for a reading of a cleared one to mean anything`,
    );
  }

  assertEqual(
    cleared.trailStamps,
    0,
    "snapshot().trailStamps after clearTrail(), which sets it to 0 " +
      "(specs/instrumentation.md)",
  );

  for (const [index, spec] of CARDS.entries()) {
    assertLessThanOrEqual(
      Math.max(
        ...after[index].map((pixel, at) => distance(pixel, bare[index][at])),
      ),
      CLEAN_DISTANCE,
      `the largest colour distance across the ${points[index].length} points ` +
        `of the footprint the card posed at (${spec.x}, ${spec.y}) painted, ` +
        `after clearTrail(), against the same points read before anything was ` +
        `painted — clearTrail clears the painted layer itself, not only the ` +
        `count of what is on it (specs/instrumentation.md)`,
    );
  }

  // And the cards it must not have taken with it.
  assertLength(
    still.flyers,
    CARDS.length,
    "the cards in flight after clearTrail(), which leaves the flyers standing " +
      "(specs/instrumentation.md)",
  );
  for (const [index, id] of ids.entries()) {
    assertEqual(
      flyerById(still, id) !== undefined,
      true,
      `whether the card posed at (${CARDS[index].x}, ${CARDS[index].y}) as ` +
        `flyer ${id} is still in flight after clearTrail(), which leaves the ` +
        `flyers standing (specs/instrumentation.md)`,
    );
  }
});
