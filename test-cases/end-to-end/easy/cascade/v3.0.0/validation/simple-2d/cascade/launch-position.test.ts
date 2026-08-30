// cascade/launch-position — a card launches from its foundation's anchor.
//
// specs/victory.md fixes the first row of the launch table: a launched card's
// top-left is "the anchor of the foundation it launched from, as specs/table.md
// fixes it". So the card enters the flight squared on the pile it left, and only
// then starts moving: "A card launched in a frame takes no motion in that frame",
// which is why the position read at the end of the launching frame is the anchor
// itself and not the anchor plus a frame of travel.
//
// THE ANCHOR IS THE ONE THE CARD ACTUALLY CAME OFF. The foundation that lost a card
// on the launching frame is what names the anchor, so a build that launches the four
// foundations in some other order is decided by `launch-cycles-foundations` and
// still passes this if it launches each card from where that card was.

import { afterEach, beforeEach, it } from "vitest";
import { LAUNCH_INTERVAL } from "../../src/constants";
import { assertCloseTo, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  pileTopLeft,
  startCascade,
  type Harness,
} from "../harness";
import { watchLaunches } from "./flight";

/**
 * How exactly the top-left must sit on the anchor, as decimal places.
 *
 * The anchor is a whole number of logical units the build is handed in
 * `src/constants.ts`, and a card launched in a frame has not moved, so this is not a
 * tolerance on a measurement: it is room for the last bits of a float that was
 * copied rather than computed. A card placed anywhere else misses by units.
 */
const ANCHOR_DIGITS = 3;

/** Two intervals of room, so a slow clock is read rather than timed out. */
const MAX_FRAMES = framesFor(LAUNCH_INTERVAL * 3);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("puts a launched card's top-left on its foundation's anchor", async () => {
  startCascade(harness);
  harness.debug.setTrailPainting(false);

  const launches = await watchLaunches(
    harness,
    MAX_FRAMES,
    (seen) => seen.length >= 1,
  );
  captureStill(harness, "launch");

  assertGreaterThanOrEqual(
    launches.length,
    1,
    "cards launched by a running cascade, which this point needs one of",
  );
  const [launch] = launches;
  assertGreaterThanOrEqual(
    launch.foundation,
    0,
    "the foundation the launched card came off",
  );

  const anchor = pileTopLeft("foundation", launch.foundation);
  assertCloseTo(
    launch.flyer.x,
    anchor.x,
    ANCHOR_DIGITS,
    `the launched card's left edge, off foundation ${launch.foundation}`,
  );
  assertCloseTo(
    launch.flyer.y,
    anchor.y,
    ANCHOR_DIGITS,
    `the launched card's top edge, off foundation ${launch.foundation}`,
  );
});
