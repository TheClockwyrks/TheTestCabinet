// instrumentation/reset-clears-trail — `reset()` empties the painted layer as
// well as the count of what is on it.
//
// THE RULE. specs/instrumentation.md has `reset` clear the painted layer and
// set `trailStamps` to `0`. specs/victory.md is what makes the layer worth
// clearing: it is a persistent surface the cards in flight stamp themselves
// onto, never cleared while the cascade runs, so a game reset after a cascade
// would otherwise open on a table buried under the last one.
//
// TWO READINGS, BECAUSE THE COUNT AND THE LAYER ARE TWO THINGS. `trailStamps`
// is a declared field (specs/state.md) and the layer is the drawing resource
// beside it, so a build that zeroes the counter and blits the old surface
// anyway passes the first reading and fails the second. That split is what
// makes this an instrumentation point rather than a drawing one: a build that
// paints correctly and never clears fails here and at
// `instrumentation/clear-trail`, `instrumentation/trail-painting-gate-off` and
// `deal.deal-clears-trail`, and nowhere else.
//
// THE LAYER IS READ AS PIXELS, AGAINST THE SAME TABLE DRAWN BEFORE ANY PAINTING.
// The probe is a band of felt that carries no pile: the thirteen empty-slot
// marks specs/table.md fixes end at `y = 320` (a column's first card is
// `140` tall from `y = 180`) and the HUD strip begins at `y = 680`, so
// `y = 340` to `y = 540` across the middle-left of the table is bare table on
// an empty board. The flyer is posed to fly through exactly that band. Both
// frames are the `playing` screen showing an empty table one drawn frame after
// a `reset`, so both are at the same `simTime` — `reset` restores it to `0` —
// and the only thing that can differ between them is the painted layer.
//
// THE READING IS TAKEN ON `playing`, NOT ON THE TITLE SCREEN `reset` LEAVES.
// What a build draws behind its title screen is its own business
// (specs/screens.md permits the table to show dimmed, or not at all), so the
// screen is posed back to the table the layer would be blitted onto. `setScreen`
// changes no other field.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  KING,
  captureStill,
  card,
  createHarness,
  openTable,
  pixelsChanged,
  poseFlyer,
  regionPixels,
  type Harness,
} from "../harness";

/**
 * The band of felt the reading is taken from: below the empty-slot marks, which
 * end at `y = 320`, and above the HUD strip at `y = 680` (specs/table.md).
 */
const PROBE = { x: 280, y: 340, w: 200, h: 200 };

/**
 * The card in flight, posed to the LEFT of the probe band and carried across it
 * and out to its right, so the stamps it leaves fall inside the band.
 */
const FLYER = { spec: card("hearts", KING), x: 150, y: 400, vx: 500, vy: 0 };

/** How long the flyer is left to paint. */
const FLIGHT_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports no stamp and leaves the table clean after a cascade has painted it", async () => {
  // The clean table the reading is taken against.
  openTable(h);
  await h.drawFrame();
  const clean = regionPixels(h, PROBE);

  // A cascade painting the table: the flyer flies and stamps by the game's own
  // rules (specs/victory.md).
  h.debug.setScreen("won");
  poseFlyer(h, FLYER.spec, FLYER.x, FLYER.y, FLYER.vx, FLYER.vy);
  await h.advanceSeconds(FLIGHT_SECONDS);

  const painted = h.snapshot();
  assertGreaterThan(
    painted.trailStamps,
    0,
    `stamps a card in flight left over ${FLIGHT_SECONDS} s, which is what ` +
      "the reset then has to clear (specs/victory.md)",
  );
  await h.drawFrame();
  assertGreaterThan(
    pixelsChanged(clean, regionPixels(h, PROBE)),
    0,
    "pixels the flight changed in the probed band, which is what the reset " +
      "then has to clear (specs/victory.md)",
  );

  // The reset under test, read with no frame between.
  h.debug.reset();
  const after = h.snapshot();
  assertEqual(
    after.trailStamps,
    0,
    "stamps reported on the painted layer after reset " +
      "(specs/instrumentation.md)",
  );

  // The table the layer would be blitted onto, drawn again.
  h.debug.setScreen("playing");
  await h.drawFrame();
  captureStill(h, "cleared");

  assertEqual(
    pixelsChanged(clean, regionPixels(h, PROBE)),
    0,
    "pixels differing from the clean table in the probed band after reset: " +
      "reset clears the painted layer, so the felt the cascade buried is " +
      "back (specs/instrumentation.md)",
  );
});
