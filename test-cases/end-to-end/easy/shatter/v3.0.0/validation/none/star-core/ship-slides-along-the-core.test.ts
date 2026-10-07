// star-core/ship-slides-along-the-core — the core holds the ship off at arm's
// length, and never nearer.
//
// THE RULE. `specs/collision.md`, the slide: on contact "The ship's centre is
// pushed back out along the direction from the star's centre to the ship, to a
// distance of `CORE_R + SHIP_R` (`44`) from `(STAR_X, STAR_Y)`." That is the
// standoff, and it is the first of the four points the slide is graded on. This one
// reads the standoff alone: what the contact does to the ship's VELOCITY is
// `ship-keeps-its-tangential-speed` and `ship-loses-its-inward-speed`, and what it
// does to the FACING is `ship-keeps-its-facing`, so a build that holds the ship off
// correctly and mishandles its motion fails those and passes this.
//
// WHAT IS READ. The nearest the ship's centre came to the star's centre over the
// whole passage, which for a build that answers the rule is exactly `44`. Reading
// the nearest approach rather than the position on one chosen tick is what makes
// the reading independent of WHEN a build resolves the contact — a build sweeping
// the tick's whole path as `specs/collision.md` allows resolves a tick earlier than
// a build testing where the tick ended, and both are conformant — and it is also
// what catches a build that pushes the ship out and then lets it sink back in over
// the ticks that follow.
//
// AND IT IS MEASURED AGAINST THE PATH, NOT THE SAMPLES. The ship covers a unit and
// two thirds a tick, and its nearest point to the star lies between two samples
// rather than on one, so a reading taken at the samples alone reports it further out
// than it got — the wrong direction for a check hunting a build that let it in too
// far. `closestApproach` measures to the line between consecutive samples.
//
// THE WRONG MODELS, AND WHAT EACH READS. A build with no core rule at all carries
// the ship through to {@link IMPACT_PARAMETER} (`26`), eighteen units inside the
// bound. A build that holds the ship off at the core's own radius rather than at the
// core plus the ship's reads `30`. A build that stops the ship dead where it touched
// reads whatever it had penetrated to. A build that reflects the ship and one that
// zeroes its velocity both read `44` and pass here, which is right: what separates
// those two is the velocity, and the two items that read it separate them.
//
// WHY ONE UNIT. The item's own figure, and an honest one: a build answering the
// rule computes `44` exactly, and the only reading between `43` and `45` a
// specification-following build can produce is the third of a unit the ship travels
// between the sample that ends outside and the one the contact resolved on. Nothing
// else on the field can move it — the well never pulls the ship, no key is held, and
// `startPlaying` has emptied the field and shut both world gates.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  CLEARANCE,
  driveIntoTheCore,
  poseTheApproach,
  STANDOFF_TICKS,
} from "./contact";

/** The one unit the item allows around `CORE_R + SHIP_R`. See the header. */
const STANDOFF_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never lets the ship's centre nearer the star's than CORE_R + SHIP_R", async () => {
  await startPlaying(h);
  await poseTheApproach(h);

  const passage = await captureReplay(h, "slide", () =>
    driveIntoTheCore(h, STANDOFF_TICKS),
  );

  assertLessThanOrEqual(
    Math.abs(passage.closest - CLEARANCE),
    STANDOFF_TOLERANCE,
    `how far the nearest point of the ship's path stood from the star's centre, against the ${CLEARANCE} the slide holds it at (specs/collision.md)`,
  );
});
