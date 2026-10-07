// Meltdown — instrumentation/poses-read-back-a-unit — a unit's position, hp, maximum hp,
// slow, slow timer and motion gate read back as they were posed.
//
// WHY THIS IS A POINT. `specs/instrumentation.md` says the snapshot carries every
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
// point of its own. Every value below is read back on the same frame it was posed,
// before anything has had a chance to run.
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
import { tileCX, tileCY } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseWalker,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/** Distinguishing values: none of them a figure `addUnit` releases a unit at. */
const POSED = {
  hp: 137,
  maxHp: 486,
  slow: 0.42,
  slowTimer: 1.125,
} as const;

/**
 * How close a posed float must read back, in decimal places for
 * {@link assertCloseTo}: within `5e-7`.
 *
 * A pose is a write and a read of one number, so the only difference a conformant
 * build can introduce is the float's own representation. This is not a tolerance
 * on behaviour; nothing here runs a rule.
 */
const EXACT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports a unit's posed position, hp, slow and motion gate", async () => {
  await startRun(h);
  const id = await poseWalker(h, "hulk", "left");
  const at = freeSite(2);

  await h.debug.setUnitPosition(id, tileCX(at.col), tileCY(at.row));
  await h.debug.setUnitMaxHp(id, POSED.maxHp);
  await h.debug.setUnitHp(id, POSED.hp);
  await h.debug.setUnitSlow(id, POSED.slow);
  await h.debug.setUnitSlowTimer(id, POSED.slowTimer);
  await h.debug.setUnitMotion(id, false);

  const posed = requireUnit(await h.snapshot(), id, "the posed Hulk");
  assertCloseTo(posed.x, tileCX(at.col), EXACT, "setUnitPosition's x");
  assertCloseTo(posed.y, tileCY(at.row), EXACT, "setUnitPosition's y");
  assertEqual(posed.col, at.col, "the tile the posed centre falls in");
  assertEqual(posed.row, at.row, "the tile the posed centre falls in");
  assertCloseTo(posed.hp, POSED.hp, EXACT, "setUnitHp");
  assertCloseTo(posed.maxHp, POSED.maxHp, EXACT, "setUnitMaxHp");
  assertCloseTo(posed.slowFactor, POSED.slow, EXACT, "setUnitSlow");
  assertCloseTo(posed.slowTimer, POSED.slowTimer, EXACT, "setUnitSlowTimer");
  assertEqual(posed.motion, false, "setUnitMotion(false)");

  await h.advance(1);
  await captureStill(h, "posed");

  // The slow reads back off, and the motion gate reads back on.
  await h.debug.setUnitSlow(id, 0);
  await h.debug.setUnitSlowTimer(id, 0);
  await h.debug.setUnitMotion(id, true);
  const back = requireUnit(await h.snapshot(), id, "the posed Hulk");
  assertEqual(back.slowFactor, 0, "setUnitSlow(0)");
  assertEqual(back.slowTimer, 0, "setUnitSlowTimer(0)");
  assertEqual(back.motion, true, "setUnitMotion(true)");
});
