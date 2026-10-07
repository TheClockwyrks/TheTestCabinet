// detonation/destroys-the-saucer — a torpedo and the saucer: both removed, and it scores.
//
// specs/collision.md pairs a torpedo with the saucer: "Both are removed, and the
// saucer scores." specs/scoring.md fixes the figure at `SCORE_SAUCER` (200), paid
// once on the destruction whatever destroyed the body — the same figure the gun's
// bullet is paid for the same kill.
//
// A SEPARATE PAIR FROM THE ROCK, and so a separate item: a torpedo carries a rule
// for rocks that has no counterpart here (destroyed outright whatever its health,
// splitting into two), and a build that resolves torpedoes against the rock roster
// alone flies straight through the saucer and fails only here.
//
// THE SAUCER IS POSED WITH ALL THREE FACULTIES OFF. specs/saucer.md gives it a
// weave, a turn away from the core and an aimed gun; none of the three is part of
// what this item decides, and each would move the reading — a travelling saucer is
// no longer where the torpedo was aimed, and a firing one puts bullets on the
// field the still would then be full of. What is left is a body standing on quiet
// ground and one torpedo flown into it, which is exactly the pair.
//
// Nothing here is a tolerance: the saucer is gone or it is not, and
// specs/scoring.md fixes a whole number.
//
// THE STILL IS THE DETONATION TICK ITSELF, which is what the review item asks for
// ("the field the instant the torpedo took the saucer").

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import { SCORE_SAUCER } from "../constants";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  saucerTarget,
  startPlaying,
  type Harness,
} from "../harness";
import {
  QUIET_GROUND,
  driveTorpedo,
  inwardHeading,
  launchAt,
} from "./scenario";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("removes the saucer and the torpedo and pays SCORE_SAUCER", async () => {
  await startPlaying(harness);
  await poseSaucer(harness, QUIET_GROUND.x, QUIET_GROUND.y, {
    vx: 0,
    vy: 0,
    mind: false,
    gun: false,
    travel: false,
  });
  const saucer = requireSaucer(await harness.snapshot(), "destroys-the-saucer");

  const target = saucerTarget(saucer);
  const torpedo = await launchAt(harness, target, inwardHeading(target));
  const run = await driveTorpedo(harness, torpedo);

  await captureStill(harness, "kill");

  assertTrue(
    run.hit,
    "the torpedo spent on the saucer it was flown into (specs/collision.md)",
  );
  assertNull(
    run.at.saucer,
    "the saucer removed by the torpedo that struck it (specs/collision.md)",
  );
  assertEqual(
    run.at.score,
    SCORE_SAUCER,
    "the figure a destroyed saucer pays, whatever destroyed it (specs/scoring.md)",
  );
});
