// visibility/shield-absent-while-inactive — no shield, no ring at radius 92.
//
// WHAT THE SPECIFICATION FIXES. `specs/field.md` makes the shield ring a
// circle "present while the shield is active", and the review item reads the
// second half of that sentence: "With no shield active no shield ring is
// drawn, so a player never reads protection that is not there."
//
// THE WORLD THIS POSES, AND THE THREE FRAMES. An isolated `playing` field and
// nothing more: `reset` restores the boot state, so no shield is active — the
// snapshot's `effects.shieldActive` confirms it — and one tick renders the
// bare band. `setShield(true)` and another tick render the band WITH the ring,
// which is the control: a band that does not move when the shield goes up is a
// band this reading cannot decide anything on. `setShield(false)` and a third
// tick render it again, and that frame must have put the band back where the
// bare one left it.
//
// THE TOLERANCE. Both readings are counts of the twenty columns (see
// `visibility/shield-band.ts`), held to the same figure from either side: the
// raised ring must move MORE than `ABSENCE_MAX_COLUMNS` of them, and the
// cleared frame must leave no more than that many moved against the bare
// frame.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import {
  ABSENCE_MAX_COLUMNS,
  movedColumns,
  shieldBandColumns,
} from "./shield-band";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws no shield ring while no shield is active", async () => {
  const posed = isolate(h);
  assertEqual(
    posed.effects.shieldActive,
    false,
    "the posed field's shield, inactive after a reset",
  );
  await h.tick(1);
  captureStill(h, "shield-inactive");
  const bare = shieldBandColumns(h);

  h.debug.setShield(true);
  await h.tick(1);
  const raised = shieldBandColumns(h);
  assertGreaterThan(
    movedColumns(raised, bare),
    ABSENCE_MAX_COLUMNS,
    "the columns of the radius-92 band the raised shield's ring moved — the " +
      "control this reading rests on, which the cleared frame must undo",
  );

  h.debug.setShield(false);
  await h.tick(1);
  const cleared = shieldBandColumns(h);
  assertLessThanOrEqual(
    movedColumns(cleared, bare),
    ABSENCE_MAX_COLUMNS,
    "the columns of the radius-92 band still moved against the bare field " +
      "once the shield is inactive again",
  );
});
