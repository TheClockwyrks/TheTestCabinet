// instrumentation/flyer-position-reads-back — the position `setFlyerPosition`
// poses is the position that flyer reports in `snapshot().flyers`.
//
// THE RULE. `specs/instrumentation.md`, The cascade: `setFlyerPosition(id, x, y)`
// "Sets that flyer's top-left", and the snapshot reports each flyer as
// `{ id, suit, rank, x, y, vx, vy }`. Every `x` and `y` the surface takes or
// reports is a card's TOP-LEFT in the stage's logical units.
//
// WHY IT IS A `broken` POINT. The `cascade` group poses one card in flight and
// reads where it went, so a build whose position does not read back leaves every
// one of those checks measuring a parabola that started somewhere else.
//
// THE POSED VALUES ARE NEITHER ROUND NOR THE VALUES `addFlyer` LEFT, so a build
// that ignores the pose reads back the position it already held rather than the
// one asked for, and the failure names the operation rather than the flyer.
//
// READ WITH NO FRAME BETWEEN THE POSE AND THE READING, because a frame would
// carry the card off the position it was just given and the check would be
// reading the update.
//
// WHAT THIS DOES NOT DECIDE. Where a card then FLIES, which is `cascade/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  flyerById,
  KING,
  openTable,
  poseFlyer,
  type Harness,
} from "../harness";

/** The card put in the flight. Which card it is decides nothing here. */
const FLYER_CARD = card("spades", KING);

/** Where the flyer starts, before it is moved away from there. */
const START = { x: 200, y: 200, vx: 0, vy: 0 };

/** The position posed onto it: neither round, and neither the value above. */
const FLYER_X = 617;
const FLYER_Y = 313;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the posed top-left back through snapshot", async () => {
  openTable(h);
  const id = poseFlyer(h, FLYER_CARD, START.x, START.y, START.vx, START.vy);

  h.debug.setFlyerPosition(id, FLYER_X, FLYER_Y);
  // Read before a frame runs: a frame would carry the card off the position it
  // was just given.
  const placed = flyerById(h.snapshot(), id);

  await h.advance(1);
  // Before the assertion, so a failing pose still leaves the picture of the
  // table it was applied to.
  captureStill(h, "posed");

  assertEqual(
    `${placed?.x},${placed?.y}`,
    `${FLYER_X},${FLYER_Y}`,
    `snapshot()'s top-left for flyer ${id} after setFlyerPosition(${id}, ` +
      `${FLYER_X}, ${FLYER_Y}) (specs/instrumentation.md)`,
  );
});
