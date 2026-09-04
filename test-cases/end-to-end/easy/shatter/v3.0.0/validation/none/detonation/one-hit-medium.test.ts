// detonation/one-hit-medium — a torpedo destroys a full-health Medium in one hit.
//
// specs/collision.md pairs a torpedo with a rock: "The rock is destroyed outright
// whatever its size or remaining health, and the torpedo is removed. The rock
// splits and scores exactly as a gun kill of the same rock would." specs/rocks.md
// gives a `medium` rock `ROCK_HEALTH.medium` (2) hits of armor against the gun and
// leaves two `small` fragments when it is destroyed.
//
// ITS OWN CHECK RATHER THAN A SECOND ARRANGEMENT INSIDE `one-hit-large`, because
// the two sizes are two edge cases of "whatever its size": a build could special-
// case the Large and leave the Medium chipping, and the grade should name which.
//
// The rock is posed at full health and that is asserted rather than assumed —
// specs/instrumentation.md has `addRock` place a rock "at full health for its
// size" — since afterwards there is no rock to read it from.
//
// Nothing here is a tolerance: the count of rocks left is exact.

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

/** Ticks of the fragments coming apart, recorded after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.4);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("takes a full-health Medium outright with one torpedo, leaving two Small", async () => {
  await startPlaying(harness);
  const parentId = await poseRock(
    harness,
    "medium",
    QUIET_GROUND.x,
    QUIET_GROUND.y,
  );
  const parent = requireRock(
    await harness.snapshot(),
    parentId,
    "one-hit-medium",
  );
  assertEqual(
    parent.health,
    ROCK_HEALTH.medium,
    "the posed Medium at full health (specs/instrumentation.md)",
  );

  const torpedo = await launchAt(harness, parent, inwardHeading(parent));
  const run = await driveTorpedo(harness, torpedo);

  await harness.advance(AFTERMATH_TICKS);
  await captureStill(harness, "detonation");

  assertTrue(
    run.hit,
    "the torpedo spent on the Medium it was flown into (specs/collision.md)",
  );
  assertUndefined(
    rockById(run.at, parentId),
    "the Medium destroyed outright by one torpedo (specs/collision.md)",
  );
  assertLength(
    rocksOfSize(run.at, "small"),
    2,
    "the two Small fragments a destroyed Medium leaves (specs/rocks.md)",
  );
  assertLength(
    run.at.rocks,
    2,
    "the field holding the two fragments and nothing else (specs/rocks.md)",
  );
});
