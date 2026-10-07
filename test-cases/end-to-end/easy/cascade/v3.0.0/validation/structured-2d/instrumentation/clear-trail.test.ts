// instrumentation/clear-trail — the painted layer is emptied on demand, and the
// cards in flight stay up.
//
// THE RULE. specs/instrumentation.md, under The cascade: "`clearTrail()` —
// Clears the painted layer and sets `trailStamps` to `0`, leaving the flyers
// standing." specs/victory.md is why an operation for it exists at all: the
// layer is never cleared while the cascade runs, so the felt ends buried, and a
// check that wants to look at the table under a running flight has no other way
// to see it.
//
// TWO READINGS, BECAUSE THE COUNT AND THE LAYER ARE TWO THINGS. `trailStamps`
// is a declared field (specs/state.md) and the layer is the drawing resource
// beside it, so a build that zeroes the counter and blits the old surface
// anyway passes the first reading and fails the second. A THIRD reading is what
// separates this operation from `reset`: the cards in flight are still in
// flight afterwards, by id.
//
// THE BAND READ IS BARE FELT ON AN EMPTY TABLE, AND THE CARD IS NEVER IN IT
// WHEN IT IS READ. The thirteen empty-slot marks specs/table.md fixes end at
// `y = 320` and the HUD strip begins at `y = 680`, so `y = 340` to `y = 540`
// across the middle-left of the table carries nothing. The card is posed to the
// LEFT of the band and carried out to its RIGHT, so it stands outside the probe
// both when the band is read before the flight and when it is read after the
// clearing — and the stamp the frame after the clearing lays down falls outside
// it too.
//
// THE BAND IS REALLY PAINTED FIRST, and that is asserted: a clearing read over
// a layer nothing had stamped would pass on a build that never painted at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { LAUNCH_VX_MAX } from "../constants";
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
 * and out to its right at `LAUNCH_VX_MAX`, the fastest a launched card may travel
 * (specs/victory.md draws `vx` uniformly from `[LAUNCH_VX_MIN, LAUNCH_VX_MAX]`):
 * `x` runs from `150` to `570` over the second, and a card is `100` wide, so its
 * footprint clears the band's `280..480` at both ends of the reading.
 */
const FLYER = {
  spec: card("hearts", KING),
  x: 150,
  y: 400,
  vx: LAUNCH_VX_MAX,
  vy: 0,
};

/** How long the card is left painting. */
const FLIGHT_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties the layer and the count, and leaves every card still in flight", async () => {
  openTable(h);
  h.debug.setScreen("won");
  const flyerId = poseFlyer(
    h,
    FLYER.spec,
    FLYER.x,
    FLYER.y,
    FLYER.vx,
    FLYER.vy,
  );

  // The band before the flight, with the card outside it.
  await h.drawFrame();
  const clean = regionPixels(h, PROBE);

  await h.advanceSeconds(FLIGHT_SECONDS);
  const painted = h.snapshot();
  assertGreaterThan(
    painted.trailStamps,
    0,
    `stamps the card left over ${FLIGHT_SECONDS} s of flight, which is what ` +
      "clearTrail then has to empty (specs/victory.md)",
  );
  await h.drawFrame();
  assertGreaterThan(
    pixelsChanged(clean, regionPixels(h, PROBE)),
    0,
    "pixels the flight changed in the probed band, which is what clearTrail " +
      "then has to empty (specs/victory.md)",
  );

  // The clearing under test, read with no frame between.
  h.debug.clearTrail();
  const cleared = h.snapshot();

  await h.drawFrame();
  captureStill(h, "cleared");

  assertEqual(
    cleared.trailStamps,
    0,
    "stamps reported on the painted layer after clearTrail " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    pixelsChanged(clean, regionPixels(h, PROBE)),
    0,
    "pixels differing from the unpainted table in the probed band after " +
      "clearTrail: it clears the painted layer (specs/instrumentation.md)",
  );
  assertDeepEqual(
    cleared.flyers.map((flyer) => flyer.id),
    [flyerId],
    "the cards still in flight after clearTrail, by id: it leaves the flyers " +
      "standing (specs/instrumentation.md)",
  );
});
