// instrumentation/poses-read-back-a-unit — a unit's position, hp, maximum hp,
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
// THE WHOLE READING IS TAKEN FROM THE POSE ITSELF, before any frame runs.
// `snapshot` is a pure read of the state (specs/instrumentation.md), so a pose is
// readable the moment it is made. Reading at the pose is what makes this a check
// of the OPERATION rather than of what a frame did to its result.
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
import { tileCentre } from "../geometry";
import {
  captureStill,
  createHarness,
  poseWalker,
  startRun,
  unitOf,
  type Harness,
} from "../harness";

/** The unit figures posed, each off the value `addUnit` releases a unit at. */
const UNIT = {
  tile: { col: 33, row: 25 },
  maxHp: 1234,
  hp: 777,
  slowFactor: 0.4,
  slowTimer: 1.25,
} as const;

/**
 * How close a posed number must read back, as decimal places.
 *
 * Six places is `5e-7`. A pose is an assignment rather than an integration:
 * nothing between the call and the read may change the value at all, so the only
 * slack a conforming build can need is the representation of the literal itself.
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
  const id = poseWalker(h, "hulk", "left");
  const at = tileCentre(UNIT.tile.col, UNIT.tile.row);

  h.debug.setUnitPosition(id, at.x, at.y);
  h.debug.setUnitMaxHp(id, UNIT.maxHp);
  h.debug.setUnitHp(id, UNIT.hp);
  h.debug.setUnitSlow(id, UNIT.slowFactor);
  h.debug.setUnitSlowTimer(id, UNIT.slowTimer);
  h.debug.setUnitMotion(id, false);

  // Its centre is what `setUnitPosition` takes and what the snapshot reports
  // (specs/instrumentation.md, The operations).
  const unit = unitOf(h.snapshot(), id);
  assertCloseTo(unit.x, at.x, READBACK_DIGITS, "setUnitPosition: x");
  assertCloseTo(unit.y, at.y, READBACK_DIGITS, "setUnitPosition: y");
  assertCloseTo(unit.hp, UNIT.hp, READBACK_DIGITS, "setUnitHp");
  assertCloseTo(unit.maxHp, UNIT.maxHp, READBACK_DIGITS, "setUnitMaxHp");
  assertCloseTo(
    unit.slowFactor,
    UNIT.slowFactor,
    READBACK_DIGITS,
    "setUnitSlow",
  );
  assertCloseTo(
    unit.slowTimer,
    UNIT.slowTimer,
    READBACK_DIGITS,
    "setUnitSlowTimer",
  );
  assertEqual(unit.motion, false, "setUnitMotion");

  await h.advance(1);
  captureStill(h, "posed");

  // The slow reads back off, and the motion gate reads back on.
  h.debug.setUnitSlow(id, 0);
  h.debug.setUnitSlowTimer(id, 0);
  h.debug.setUnitMotion(id, true);
  const back = unitOf(h.snapshot(), id);
  assertEqual(back.slowFactor, 0, "setUnitSlow(0)");
  assertEqual(back.slowTimer, 0, "setUnitSlowTimer(0)");
  assertEqual(back.motion, true, "setUnitMotion(true)");
});
