// torpedo/no-launch-while-recharging — the binding does nothing on a part charge.
//
// `specs/weapons.md`, "The charge": "The torpedo key does nothing while the charge
// is below `1`." `specs/instrumentation.md` gives that rule an address —
// `setTorpedoCharge(fraction)` "sets the stored charge, a number from `0` to `1`" —
// so the recharge can be posed at a point rather than waited out, and the binding
// driven there.
//
// TWO READINGS, AND THE SECOND IS WHAT MAKES THE FIRST MEAN ANYTHING. With the
// charge posed half full a press adds no torpedo; with the same pose taken to full
// the same press adds one. Without the second reading a build that ignores the
// binding altogether, or whose `setTorpedoCharge` does nothing at all, would pass
// the first by doing nothing — the failure this pairing exists to catch. Without
// the first, a build with no charge gate would pass. The two together say the gate
// is the charge and nothing else.
//
// HALF, RATHER THAN SOME FIGURE THE SPECIFICATION FIXES. The rule is "below 1", so
// the number posed is the check's to choose, and a half is nowhere near the
// boundary in either direction: it is neither the `0` a launch leaves behind nor
// the `1` that opens the gate, so a build that reads its gate as "not empty" fails
// as loudly as one that has no gate at all.
//
// THE CHARGE IS POSED AGAIN BEFORE THE SECOND PRESS. `specs/weapons.md` says only
// that a press below full "does nothing"; it does not say what such a press leaves
// the charge reading, so the allowed press is given its own full pose rather than
// leaning on the refused one having changed nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  torpedoesOf,
  type Harness,
} from "../harness";
import { poseShip, pressTorpedo, setCharge } from "./scene";

/** The part charge the gate is posed at: half full (`specs/instrumentation.md`). */
const PART_CHARGE = 0.5;

/** The charge that opens the gate, the one figure `specs/weapons.md` fixes. */
const FULL_CHARGE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("launches nothing from a half charge and launches one once the charge is full", async () => {
  startPlaying(h);
  poseShip(h);

  setCharge(h, PART_CHARGE);
  const refused = await pressTorpedo(h);
  // The half-charged ship, with nothing launched.
  captureStill(h, "refused");

  assertLength(
    torpedoesOf(refused),
    0,
    `no torpedo launched by a press taken with the charge at ${PART_CHARGE} ` +
      "(specs/weapons.md: the torpedo key does nothing while the charge is " +
      "below 1)",
  );

  // The press the gate no longer refuses: the control that says the build answers
  // to this binding at all, and that the charge is what refused the first.
  setCharge(h, FULL_CHARGE);
  const allowed = await pressTorpedo(h);

  assertLength(
    torpedoesOf(allowed),
    1,
    "exactly one torpedo launched by the same press with the charge posed at " +
      `${FULL_CHARGE} (specs/weapons.md, specs/controls.md: one launch per press)`,
  );
});
