// Wick — instrumentation/set-passive: with no passive held,
// `setPassive(0, "bellows", 2)` reads back `passives` as Bellows at level 2
// and `moveSpeed` 216 from the next read.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setPassive(slot, id, level)`): "Puts passive `id`, a `PassiveId`, at
// `level` in `slot` ... `maxHp`, `armor`, `moveSpeed`, `pickupRadius`, and
// every multiplier follow from the next read." `moveSpeed` is "`MOVE_SPEED`
// (`180`) `× (1 + BELLOWS_SPEED_PER_LEVEL` (`0.1`) `×` the Bellows level
// held`)`", 216 at level 2, read to `FLOAT_TOL` as a product of exact figures.
//
// WHY THE WORLD IS POSED AS IT IS. No passive held, so slot 0 is the appending
// slot and the derived figure is the pose's alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNear } from "../assert";
import { FLOAT_TOL, moveSpeedOf } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses a passive, and the derived stat follows on the next read", async () => {
  const posed = await isolate(h);
  assertLength(posed.run.passives, 0, "the passives before the pose");

  await h.debug.setPassive(0, "bellows", LEVEL);
  const after = await h.snapshot();
  await captureStill(h, "posed");
  assertDeepEqual(
    after.run.passives,
    [{ id: "bellows", level: LEVEL }],
    "the passives after the pose",
  );
  assertNear(
    after.run.moveSpeed,
    moveSpeedOf({ bellows: LEVEL }),
    FLOAT_TOL,
    "moveSpeed with Bellows 2",
  );
});
