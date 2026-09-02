// detonation/one-hit-large — a torpedo destroys a full-health Large in one hit.
//
// `specs/collision.md` pairs a torpedo with a rock: "The rock is destroyed
// outright whatever its size or remaining health, and the torpedo is removed. The
// rock splits and scores exactly as a gun kill of the same rock would."
// `specs/rocks.md` gives a `large` rock `ROCK_HEALTH.large` (3) hits of armor
// against the gun and leaves two `medium` fragments when it is destroyed.
//
// So the whole of this check is: a Large that a bullet would need three rounds to
// break is taken by ONE torpedo, and what it leaves is two Mediums. A build that
// resolves a torpedo the way it resolves a bullet — health down by one, the rock
// standing — fails here with the Large still on the field, which is the wrong
// model this item exists to name.
//
// THE ROCK IS POSED AT FULL HEALTH AND THAT IS ASSERTED, not assumed:
// `specs/instrumentation.md` has `addRock` place a rock "at full health for its
// size", so the armor the torpedo is being asked to ignore is really there. It is
// read before the shot rather than after, since afterwards there is no rock to
// read.
//
// The scenario stands on quiet ground and the torpedo comes in from the side
// facing away from the star, so nothing but the impact can end its flight (see
// `scenario.ts`). Nothing here is a tolerance: the count of rocks left is exact.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH, ROCK_RADIUS } from "../constants";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
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
 * Ticks of the fragments coming apart, run after the reading is taken.
 *
 * The still is the item's evidence, so it is kept AFTER the detonation has played
 * rather than on the frame the measurement fell on: at `TORPEDO_SCATTER` the two
 * Mediums are ninety-odd units apart by then and a reviewer can see two of them.
 * Nothing a check asserts is read from it.
 */
const AFTERMATH_TICKS = ticksFor(0.4);

/** The rocks the field holds afterwards: the two Mediums, and nothing else. */
const ROCKS_AFTER = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a full-health Large outright with one torpedo, leaving two Medium", async () => {
  startPlaying(h);
  const parentId = poseRock(h, "large", QUIET_GROUND.x, QUIET_GROUND.y);
  const parent = rockById(h.snapshot(), parentId, "the posed Large");
  assertEqual(
    parent.health,
    ROCK_HEALTH.large,
    "the posed Large at full health (specs/instrumentation.md)",
  );

  const torpedo = launchAt(
    h,
    { x: parent.x, y: parent.y, radius: ROCK_RADIUS.large },
    inwardHeading(parent),
  );
  const run = await driveTorpedo(h, torpedo);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "detonation");

  assertTrue(
    run.hit,
    "the torpedo spent on the Large it was flown into (specs/collision.md)",
  );
  assertEqual(
    run.at.rocks.some((rock) => rock.id === parentId),
    false,
    "the Large destroyed outright by one torpedo (specs/collision.md)",
  );
  assertLength(
    run.at.rocks.filter((rock) => rock.size === "medium"),
    2,
    "the two Medium fragments a destroyed Large leaves (specs/rocks.md)",
  );
  assertLength(
    run.at.rocks,
    ROCKS_AFTER,
    "the field holding the two fragments and nothing else (specs/rocks.md)",
  );
});
