// cascade/launch-cycles-foundations — the launch order cycles the four foundations.
//
// specs/victory.md fixes the order outright: "taking foundation 0, then 1, then
// 2, then 3, then 0 again". So the first four launches of a cascade take one card
// from each foundation, in index order, and this reads exactly those four.
//
// WHICH FOUNDATION A CARD CAME OFF IS READ FROM THE FOUNDATIONS, not from the
// card. A launch is the frame a new card appears in the flight, and the
// foundation that lost a card on that frame is the one it left. Reading the
// flyer's SUIT instead would be reading how this check happened to pose the board
// rather than the order the build launched in, and would pass a build that took
// every card off one pile so long as the suits lined up.
//
// The first four launches alone, and no more. A build that cycles the four
// foundations and then gets the skipping of an emptied one wrong is wrong about a
// different sentence of the same paragraph, and the walk down one foundation is
// `launch-takes-top-card`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { FOUNDATION_COUNT, LAUNCH_INTERVAL } from "../constants";
import { captureStill, startCascade, type Harness } from "../harness";
import { createFlightHarness, flightFrames, watchLaunches } from "./flight";

/** The foundations the first four launches must come off, in order. */
const EXPECTED_ORDER = [0, 1, 2, 3];

/**
 * How long the sweep may run for, in frames.
 *
 * The fourth launch falls three intervals after the first (specs/victory.md), so
 * two whole intervals past that is room for a build whose clock runs slow to
 * still be read rather than merely timed out.
 */
const MAX_FRAMES = flightFrames(LAUNCH_INTERVAL * (FOUNDATION_COUNT + 2));

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("takes the first four launches from the four foundations in turn", async () => {
  startCascade(harness);
  harness.debug.setTrailPainting(false);

  const launches = await watchLaunches(
    harness,
    MAX_FRAMES,
    (seen) => seen.length >= EXPECTED_ORDER.length,
  );
  captureStill(harness, "launches");

  assertDeepEqual(
    launches.slice(0, EXPECTED_ORDER.length).map((launch) => launch.foundation),
    EXPECTED_ORDER,
    "the foundations the first four launches came off, in order",
  );
});
