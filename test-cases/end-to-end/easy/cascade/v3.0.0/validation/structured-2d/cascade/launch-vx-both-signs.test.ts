// cascade/launch-vx-both-signs — cards launch to both sides.
//
// specs/victory.md gives each launch's `vx` "a sign chosen with equal
// probability", so the sign varies from launch to launch and a cascade throws
// cards to the left and to the right. The magnitude is `launch-vx-magnitude`;
// what this refuses is a build that fixed the sign, or that took the sign from
// something other than a draw, and so sends every card the same way.
//
// THE DRAW IS TAKEN ALONE. specs/instrumentation.md has `drawLaunchVx` perform
// exactly the draw a launch performs and nothing else, so the sign is read off
// that operation rather than off a whole cascade: a few dozen draws cost a few
// dozen calls, where fifty-two launches took nine seconds of game time frame by
// frame.
//
// WHAT IS ASSERTED IS THAT THE SIGN VARIES. A small sample of draws is read and
// held to carry at least two distinct signs. "Equal probability" is a statement
// about a distribution, and a sample this size cannot decide one: any ratio a
// check demanded would fail some conformant builds by chance. What it CAN say is
// that a build which always returns the same sign is not drawing a sign at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { captureStill, type Harness } from "../harness";
import { createFlightHarness, drawLaunches, poseDrawnFlight } from "./flight";

/**
 * How many draws are read.
 *
 * A fair sign lands all one way over this many with probability `2 / 2^32`,
 * which is `2^-31`, under one in two thousand million: beyond six standard
 * deviations of a fair coin, so a conformant build never fails here by chance.
 */
const DRAW_COUNT = 32;

/** The sides a drawn `vx` carries its card to. */
const SIDE_COUNT = 2;

/** Which side a drawn `vx` sends its card. */
function sideOf(vx: number): "left" | "right" {
  return vx < 0 ? "left" : "right";
}

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws launch vx values of more than one sign over a small sample", async () => {
  harness.debug.reset();
  const speeds = drawLaunches(harness, DRAW_COUNT);

  await poseDrawnFlight(harness, speeds);
  captureStill(harness, "launches");

  const sides = new Set(speeds.map(sideOf));
  assertGreaterThanOrEqual(
    sides.size,
    SIDE_COUNT,
    `distinct signs among ${DRAW_COUNT} draws of drawLaunchVx(), which sent ` +
      `every card ${[...sides].join(", ")} (specs/victory.md)`,
  );
});
