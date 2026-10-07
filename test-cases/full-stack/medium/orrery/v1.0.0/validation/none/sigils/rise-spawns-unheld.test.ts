// sigils/rise-spawns-unheld — nothing is holding what a rise delivers.
//
// THE RULE. "the reagent appears: one new mote per pattern mote and one filament
// per pattern filament, at the placed pose, UNHELD" (`specs/sigils.md`, Rises and
// sets), where "unheld: no gripper holds any mote of the mote's constellation".
// A gripper's hold is not something a mote can be delivered into: "Every gripper
// of every part whose instruction is `grab` closes" at step 3 of a cycle
// (`specs/simulation.md`), and the boundary that delivers a reagent is step 5.
//
// THE CONFIGURATION. A rise whose reagent is one mote on `(0, 0)`, and a length 1
// `arm` whose gripper stands ON that footprint hex when the reagent appears: the
// arm is anchored one hex east at rotation `3` — `DIRS[3]` is `(-1, 0)`, toward the
// west (`specs/field.md`) — so its one gripper, at "`base + length * DIRS[d]`"
// (`specs/parts.md`), is exactly where the mote lands. The arm's tape is empty,
// "which every part rests on" (`specs/instrumentation.md`), so no `grab` ever runs
// and the gripper neither moves nor closes.
//
// THE VERDICT. The mote is delivered onto that hex — so the gripper really was over
// the footprint at the moment of the delivery — and the run reports NO GRIP at all:
// not for that gripper, not for that part, and not anywhere on the field.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  moteAt,
  openBareRun,
  placePart,
  placeRise,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("delivers a reagent under a resting gripper without that gripper holding it", async () => {
  // BARE's one reagent is a single mote on (0, 0), so the footprint is one hex.
  await openBareRun(h, { challenge: BARE });
  await placeRise(h, 0, ORIGIN, 0);
  const arm = await placePart(h, "arm", at(ORIGIN.q + 1, ORIGIN.r), 3);

  const posed = await h.snapshot();
  assertLength(
    posed.sim?.motes ?? [],
    0,
    "the field is empty, so the rise's footprint is vacant",
  );
  assertLength(
    posed.sim?.grips ?? [],
    0,
    "the arm was placed holding nothing, and no grab has run",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "unheld");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a rise that delivers raises no fault, so the run is still live",
  );
  const delivered = moteAt(after, ORIGIN);
  assertNotNull(
    delivered,
    "the reagent lands on the footprint hex the gripper is resting over",
  );
  assertNull(
    heldBy(after, arm, 3),
    "the gripper over the footprint hex is holding nothing",
  );
  assertLength(
    gripsOf(after, arm),
    0,
    "the arm reports no holding gripper at all",
  );
  assertLength(
    after.sim?.grips ?? [],
    0,
    "a spawned reagent is unheld, and it is the only thing on the field",
  );
});
