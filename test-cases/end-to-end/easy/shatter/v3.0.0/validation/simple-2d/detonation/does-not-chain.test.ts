// detonation/does-not-chain — a torpedo destroys ONLY the rock it strikes.
//
// `specs/collision.md` ends the torpedo-and-rock row with the clause this item
// exists for: "A torpedo destroys only the rock it strikes." The detonation is not
// a blast with a radius — whatever a build draws for it — and a rock standing
// beside the destroyed one is untouched by it: not chipped, not split, not scored.
//
// THE BYSTANDER STANDS TWENTY UNITS OFF THE DESTROYED ROCK'S SURFACE, which is
// inside anything a build would plausibly have drawn as a blast and far outside
// the contact `specs/collision.md` defines: two bodies touch when their centres
// are within the sum of their radii, and two Larges twenty units apart are `112`
// units centre to centre against a sum of `92`. So a build that spends its torpedo
// on every rock it can reach fails here, and one that resolves the single contact
// the specification defines passes.
//
// THE TORPEDO CANNOT REACH THE BYSTANDER ITSELF. It comes in along `+x` and the
// bystander is set square above the target, so no point of the flight is nearer
// than `112` units to the bystander's centre against a contact distance of
// `ROCK_RADIUS.large + TORPEDO_R` (52). What is graded is therefore the
// detonation's reach and not the weapon's aim.
//
// AND THE BYSTANDER IS READ AS A ROCK, NOT AS A COUNT: its id, its size and its
// health, all unchanged. A build that destroyed it and respawned something would
// leave a roster of the right length; this one names the rock that had to survive.
// Nothing here is a tolerance.

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
import { QUIET_GROUND, driveTorpedo, launchAt } from "./scenario";

/** The clear space between the two rocks' surfaces, as the review item states. */
const SURFACE_GAP = 20;

/** Their centres, then: two Large radii and the gap between them. */
const CENTRE_SEPARATION = 2 * ROCK_RADIUS.large + SURFACE_GAP;

/** The line the torpedo travels along: straight along `+x`, square to the pair. */
const SHOT_HEADING = 0;

/**
 * The rocks the field holds on the detonation tick: the bystander, and the two
 * Medium fragments the destroyed Large left (`specs/rocks.md`).
 */
const ROCKS_AFTER = 3;

/** Ticks of the fragments coming apart, run after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a Large twenty units off the destroyed one whole", async () => {
  startPlaying(h);
  const targetId = poseRock(h, "large", QUIET_GROUND.x, QUIET_GROUND.y);
  const bystanderId = poseRock(
    h,
    "large",
    QUIET_GROUND.x,
    QUIET_GROUND.y - CENTRE_SEPARATION,
  );
  const target = rockById(
    h.snapshot(),
    targetId,
    "the Large under the torpedo",
  );

  const torpedo = launchAt(
    h,
    { x: target.x, y: target.y, radius: ROCK_RADIUS.large },
    SHOT_HEADING,
  );
  const run = await driveTorpedo(h, torpedo);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "bystander");

  assertTrue(
    run.hit,
    "the torpedo spent on the Large it was flown into (specs/collision.md)",
  );
  assertEqual(
    run.at.rocks.some((rock) => rock.id === targetId),
    false,
    "the struck Large destroyed by the torpedo (specs/collision.md)",
  );

  const bystander = rockById(
    run.at,
    bystanderId,
    "the Large standing beside the one the torpedo took",
  );
  assertEqual(
    bystander.size,
    "large",
    "the bystander rock still whole, not split by the detonation " +
      "(specs/collision.md)",
  );
  assertEqual(
    bystander.health,
    ROCK_HEALTH.large,
    "the bystander rock still at full health, not chipped (specs/collision.md)",
  );
  assertLength(
    run.at.rocks,
    ROCKS_AFTER,
    "the bystander and the two fragments, and nothing destroyed twice " +
      "(specs/rocks.md)",
  );
});
