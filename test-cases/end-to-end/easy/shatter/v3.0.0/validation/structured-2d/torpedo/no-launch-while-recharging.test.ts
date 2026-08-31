// torpedo/no-launch-while-recharging — the key does nothing on a part-filled bar.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The charge: "The torpedo key does
// nothing while the charge is below `1`." This item decides that refusal and only
// it: the charge is posed HALF FULL, so the ship is neither spent nor ready, and
// the only rule that can refuse the press is the one under test.
//
// WHY HALF AND NOT NEARLY EMPTY. A bar at `0.5` is as far from `0` as it is from
// `1`, so a build that gates on "the charge is non-zero" launches and fails here,
// and so does one that rounds a nearly-full bar up to ready. A build that gates on
// `charge >= 1` refuses, which is the specification's own condition.
//
// THE OTHER REFUSAL IS A DIFFERENT ITEM. `torpedo/at-most-one-in-flight` poses the
// charge FULL and a torpedo already up, so the recharge rule cannot account for
// what it reads. Between them, a build that implements one refusal and not the
// other loses exactly one point.
//
// THE POSE IS ASSERTED BEFORE THE PRESS. `setTorpedoCharge(0.5)` is what makes
// this scenario the one the item describes, so the charge is read back first: a
// build whose pose did not take would be refusing for a reason this check never
// arranged, and the failure names the operation rather than the rule.
//
// NOTHING IS ON THE FIELD. `startPlaying` empties every roster and shuts both
// world gates, so the reading — an empty torpedo roster — has one possible cause.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  tapAction,
  torpedoesOf,
  type Harness,
} from "../harness";
import {
  POSED_CHARGE_SLACK,
  TORPEDO_ACTION,
  requireCharge,
  requireReady,
} from "./scenario";

/** The part-filled bar the press is made on. See the note above on why it is half. */
const POSED_CHARGE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("launches nothing when the torpedo key is pressed on a half-filled charge", async () => {
  startPlaying(h);
  h.debug.setTorpedoCharge?.(POSED_CHARGE);

  const posed = h.snapshot();
  assertLessThanOrEqual(
    Math.abs(
      requireCharge(posed, "the charge the press is made on") - POSED_CHARGE,
    ),
    POSED_CHARGE_SLACK,
    `setTorpedoCharge(${POSED_CHARGE}) to leave the charge half full, which ` +
      "is the state this item's refusal is about (specs/instrumentation.md)",
  );
  assertEqual(
    requireReady(posed, "the readiness on a half-filled charge"),
    false,
    "torpedoReady to read false on a charge below 1, which " +
      "specs/instrumentation.md makes true exactly when the charge is 1",
  );

  await tapAction(h, TORPEDO_ACTION);
  const after = h.snapshot();
  // The half-charged ship with nothing launched.
  captureStill(h, "refused");

  assertLength(
    torpedoesOf(after),
    0,
    "no torpedo in flight after the torpedo key was pressed on a charge of " +
      `${POSED_CHARGE} — the key does nothing while the charge is below 1 ` +
      "(specs/weapons.md)",
  );
});
