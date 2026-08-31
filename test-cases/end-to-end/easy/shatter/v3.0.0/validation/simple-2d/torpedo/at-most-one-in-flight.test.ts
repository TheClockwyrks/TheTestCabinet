// torpedo/at-most-one-in-flight — a second torpedo is refused while one is up.
//
// `specs/weapons.md`, "The charge": "At most one torpedo is in flight at a time.
// While one is up, the key launches nothing whatever the charge reads."
//
// THE CHARGE IS POSED FULL, AND THAT IS WHAT MAKES THIS A DIFFERENT ITEM FROM
// `no-launch-while-recharging`. A launch spends the charge, so a torpedo in flight
// normally comes with an empty charge, and the recharge rule alone would account
// for the refusal — no build could fail the two items differently. With
// `setTorpedoCharge(1)` the only rule left that can refuse the press is this one,
// and the "whatever the charge reads" half of the sentence is what is being read.
//
// THE TORPEDO IN FLIGHT IS PLACED, NOT FIRED. `addTorpedo` puts one up "in flight,
// travelling at `TORPEDO_SPEED` along `heading`, with a full `TORPEDO_LIFE`"
// (`specs/instrumentation.md`), which is the one operation this requirement needs
// and it leaves the charge alone — so the scenario is one torpedo up and a full
// charge, which is exactly the sentence's own condition, reached without a launch
// having happened at all. Its guidance is shut off and the field is empty, so
// nothing can steer it into anything over the four ticks the two presses cost.
//
// TWO READINGS, AND THE SECOND IS WHAT MAKES THE FIRST MEAN ANYTHING. With the one
// torpedo taken off the field through `removeTorpedo` and the charge posed full
// again, the same press launches one. Without it a build that ignores the binding
// altogether would pass the first by doing nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  torpedoesOf,
  type Harness,
} from "../harness";
import {
  COLUMN,
  HEADING_DOWN,
  poseShip,
  poseStraight,
  pressTorpedo,
  removeTorpedo,
  setCharge,
} from "./scene";

/** The charge posed for both presses: full, so only the one-in-flight rule refuses. */
const FULL_CHARGE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a launch while a torpedo is up, and allows one once the field is clear", async () => {
  startPlaying(h);
  poseShip(h);

  // One torpedo up, well away from the ship and from the star, and a full charge.
  const up = poseStraight(h, COLUMN.x, COLUMN.y, HEADING_DOWN);
  setCharge(h, FULL_CHARGE);

  const refused = await pressTorpedo(h);
  // The one torpedo up, with the launch refused.
  captureStill(h, "refused");

  assertLength(
    torpedoesOf(refused),
    1,
    "the torpedo roster still holding exactly the one torpedo that was up, " +
      "after a press taken with the charge posed full (specs/weapons.md: at " +
      "most one torpedo is in flight at a time; while one is up, the key " +
      "launches nothing whatever the charge reads)",
  );

  // The press the rule no longer refuses: the control that says the build answers
  // to this binding at all, and that the torpedo up is what refused the first.
  removeTorpedo(h, up);
  setCharge(h, FULL_CHARGE);
  const allowed = await pressTorpedo(h);

  assertLength(
    torpedoesOf(allowed),
    1,
    "exactly one torpedo launched by the same press once the field held none " +
      "(specs/weapons.md, specs/controls.md: one launch per press)",
  );
});
