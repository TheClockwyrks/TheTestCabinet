// Meltdown — instrumentation/poses-read-back-a-unit — a unit's position, hp, maximum hp,
// slow, slow timer and motion gate read back as they were posed.
//
// WHY THIS IS A POINT. specs/instrumentation.md says the snapshot carries every
// field an operation can set, "so every operation is verifiable by setting a value
// and reading it back". That round trip is what every other group in this suite
// stands on: a check poses a heat of 60 and then asserts what one second of
// cooling did to it, and if the pose never landed the check is measuring something
// it did not arrange. A pose that silently does nothing, or that lands on a field
// the snapshot does not report, is caught here and nowhere else.
//
// ONE GROUP OF STATE, BECAUSE EACH POSE IS INDEPENDENTLY BREAKABLE. A build whose
// only broken pose is `setUnitSlow` must lose one point rather than every pose it
// got right, so the surface's poses are read as six items —
// `instrumentation.poses-read-back-the-run`, `-the-figures`, `-the-build`,
// `-a-tower`, `-a-unit` and `-the-pointer-and-the-gate` — and this one reads
// the six poses that arrange ONE SURGE UNIT.
//
// WHAT IS ASSERTED. That the value POSED comes back. Not what the game does with
// it afterwards, and not that a rule fired: `setLives` triggers no game over,
// `setScore` pays no bonus, `setScreen` runs no entry effect — each of those is a
// point of its own.
//
// THE READING IS TAKEN FROM THE POSE ITSELF, before any frame runs. `snapshot` is
// a pure read of the state (specs/instrumentation.md), so a pose is readable the
// moment it is made — which is what makes this a check of the OPERATION rather
// than of what a frame did to its result.
//
// EVERY POSED VALUE IS DISTINGUISHING. No two fields carry the same number and none
// of them carries a default, so a build that reports one field where another was
// posed, or that reports a constant, reads as the wrong number rather than
// coincidentally right.
//
// `maxHp` IS POSED BEFORE `hp`, so the reading is of two poses rather than of one
// clamping the other.
//
// AND THE SLOW AND THE GATE READ BACK THE OTHER WAY, so neither is a field a build
// reports as a constant.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tileCenter,
  type Harness,
} from "../harness";
import { quietSite, readUnit } from "./ground";

/** The unit figures posed. */
const MAX_HP = 99;
const HP = 55;
const SLOW_FACTOR = 0.4;
const SLOW_TIMER = 1.25;

/**
 * How far a read-back figure may sit from the figure posed, in the unit of the
 * figure.
 *
 * The reading is taken with no frame advanced, so nothing has run between the pose
 * and it and the only difference a conformant build can introduce is the float it
 * stored the number in. Six decimal places is many orders of magnitude above that
 * and many orders below the smallest step any of these figures takes.
 */
const READBACK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports a unit's posed position, hp, slow and motion gate", async () => {
  startRun(h);
  h.debug.addUnit("mote", "left");
  const surge = h.snapshot().surge;
  assertEqual(surge.length, 1, "the units addUnit left on the floor");
  const unitId = surge[surge.length - 1].id;

  const at = tileCenter(quietSite(8).col, quietSite(8).row);
  h.debug.setUnitPosition(unitId, at.x, at.y);
  h.debug.setUnitMaxHp(unitId, MAX_HP);
  h.debug.setUnitHp(unitId, HP);
  h.debug.setUnitSlow(unitId, SLOW_FACTOR);
  h.debug.setUnitSlowTimer(unitId, SLOW_TIMER);
  h.debug.setUnitMotion(unitId, false);

  const unit = readUnit(h.snapshot(), unitId, "the posed unit");
  assertCloseTo(unit.x, at.x, READBACK_DIGITS, "setUnitPosition: x");
  assertCloseTo(unit.y, at.y, READBACK_DIGITS, "setUnitPosition: y");
  assertCloseTo(unit.hp, HP, READBACK_DIGITS, "setUnitHp");
  assertCloseTo(unit.maxHp, MAX_HP, READBACK_DIGITS, "setUnitMaxHp");
  assertCloseTo(unit.slowFactor, SLOW_FACTOR, READBACK_DIGITS, "setUnitSlow");
  assertCloseTo(
    unit.slowTimer,
    SLOW_TIMER,
    READBACK_DIGITS,
    "setUnitSlowTimer",
  );
  assertEqual(unit.motion, false, "setUnitMotion");

  await h.advance(1);
  captureStill(h, "posed");

  // The slow reads back off, and the motion gate reads back on.
  h.debug.setUnitSlow(unitId, 0);
  h.debug.setUnitSlowTimer(unitId, 0);
  h.debug.setUnitMotion(unitId, true);
  const back = readUnit(h.snapshot(), unitId, "the posed unit");
  assertEqual(back.slowFactor, 0, "setUnitSlow(0)");
  assertEqual(back.slowTimer, 0, "setUnitSlowTimer(0)");
  assertEqual(back.motion, true, "setUnitMotion(true)");
});
