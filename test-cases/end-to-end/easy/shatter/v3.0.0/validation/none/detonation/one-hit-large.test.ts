// detonation/one-hit-large — a torpedo destroys a full-health Large in one hit.
//
// specs/collision.md pairs a torpedo with a rock: "The rock is destroyed outright
// whatever its size or remaining health, and the torpedo is removed. The rock
// splits and scores exactly as a gun kill of the same rock would." specs/rocks.md
// gives a `large` rock `ROCK_HEALTH.large` (3) hits of armor against the gun and
// leaves two `medium` fragments when it is destroyed.
//
// So the whole of this check is: a Large that a bullet would need three rounds to
// break is taken by ONE torpedo, and what it leaves is two Mediums. A build that
// resolves a torpedo the way it resolves a bullet — health down by one, the rock
// standing — fails here with the Large still on the field, which is the wrong
// model this item exists to name.
//
// THE ROCK IS POSED AT FULL HEALTH AND THAT IS ASSERTED, not assumed:
// specs/instrumentation.md has `addRock` place a rock "at full health for its
// size", so the armor the torpedo is being asked to ignore is really there. It is
// read before the shot rather than after, since afterwards there is no rock to
// read.
//
// The scenario stands on quiet ground and the torpedo comes in from the side
// facing away from the star, so nothing but the impact can end its flight (see
// scenario.ts). Nothing here is a tolerance: the count of rocks left is exact.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertTrue,
  assertUndefined,
} from "../assert";
import { ROCK_HEALTH } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  rockById,
  rocksOfSize,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  QUIET_GROUND,
  driveTorpedo,
  inwardHeading,
  launchAt,
} from "./scenario";

/**
 * Ticks of the fragments coming apart, recorded after the reading is taken.
 *
 * The still is the item's evidence, so it is kept AFTER the detonation has played
 * rather than on the frame the measurement fell on: at `TORPEDO_SCATTER` the two
 * Mediums are ninety-odd units apart by then and a reviewer can see two of them.
 */
const AFTERMATH_TICKS = ticksFor(0.4);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("takes a full-health Large outright with one torpedo, leaving two Medium", async () => {
  await startPlaying(harness);
  const parentId = await poseRock(
    harness,
    "large",
    QUIET_GROUND.x,
    QUIET_GROUND.y,
  );
  const parent = requireRock(
    await harness.snapshot(),
    parentId,
    "one-hit-large",
  );
  assertEqual(
    parent.health,
    ROCK_HEALTH.large,
    "the posed Large at full health (specs/instrumentation.md)",
  );

  const torpedo = await launchAt(harness, parent, inwardHeading(parent));
  const run = await driveTorpedo(harness, torpedo);

  await harness.advance(AFTERMATH_TICKS);
  await captureStill(harness, "detonation");

  assertTrue(
    run.hit,
    "the torpedo spent on the Large it was flown into (specs/collision.md)",
  );
  assertUndefined(
    rockById(run.at, parentId),
    "the Large destroyed outright by one torpedo (specs/collision.md)",
  );
  assertLength(
    rocksOfSize(run.at, "medium"),
    2,
    "the two Medium fragments a destroyed Large leaves (specs/rocks.md)",
  );
  assertLength(
    run.at.rocks,
    2,
    "the field holding the two fragments and nothing else (specs/rocks.md)",
  );
});
