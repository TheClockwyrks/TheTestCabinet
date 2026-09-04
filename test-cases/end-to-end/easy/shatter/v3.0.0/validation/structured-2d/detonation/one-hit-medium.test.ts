// detonation/one-hit-medium — a torpedo destroys a full-health Medium in one hit.
//
// `specs/collision.md` pairs a torpedo with a rock: "The rock is destroyed
// outright whatever its size or remaining health, and the torpedo is removed. The
// rock splits and scores exactly as a gun kill of the same rock would."
// `specs/rocks.md` gives a `medium` rock `ROCK_HEALTH.medium` (2) hits of armor
// against the gun and leaves two `small` fragments when it is destroyed.
//
// ITS OWN CHECK RATHER THAN A SECOND ARRANGEMENT INSIDE `one-hit-large`, because
// the two sizes are two edge cases of "whatever its size": a build could special-
// case the Large and leave the Medium chipping, and the grade should name which.
//
// The rock is posed at full health and that is asserted rather than assumed —
// `specs/instrumentation.md` has `addRock` place a rock "at full health for its
// size" — since afterwards there is no rock to read it from.
//
// Nothing here is a tolerance: the count of rocks left is exact.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH, ROCK_RADIUS } from "../constants";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
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

/** Ticks of the fragments coming apart, run after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.4);

/** The rocks the field holds afterwards: the two Smalls, and nothing else. */
const ROCKS_AFTER = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a full-health Medium outright with one torpedo, leaving two Small", async () => {
  startPlaying(h);
  const parentId = poseRock(h, "medium", QUIET_GROUND.x, QUIET_GROUND.y);
  const parent = requireRock(h.snapshot(), parentId, "the posed Medium");
  assertEqual(
    parent.health,
    ROCK_HEALTH.medium,
    "the posed Medium at full health (specs/instrumentation.md)",
  );

  const torpedo = launchAt(
    h,
    { x: parent.x, y: parent.y, radius: ROCK_RADIUS.medium },
    inwardHeading(parent),
  );
  const run = await driveTorpedo(h, torpedo);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "detonation");

  assertTrue(
    run.hit,
    "the torpedo spent on the Medium it was flown into (specs/collision.md)",
  );
  assertEqual(
    run.at.rocks.some((rock) => rock.id === parentId),
    false,
    "the Medium destroyed outright by one torpedo (specs/collision.md)",
  );
  assertLength(
    run.at.rocks.filter((rock) => rock.size === "small"),
    2,
    "the two Small fragments a destroyed Medium leaves (specs/rocks.md)",
  );
  assertLength(
    run.at.rocks,
    ROCKS_AFTER,
    "the field holding the two fragments and nothing else (specs/rocks.md)",
  );
});
