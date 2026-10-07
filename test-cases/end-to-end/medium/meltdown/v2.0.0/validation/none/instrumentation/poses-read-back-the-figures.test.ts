// Meltdown — instrumentation/poses-read-back-the-figures — the money, the lives, the score,
// the wave, the build timer, the pending count and the speed read back as they
// were posed.
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
// the seven poses that say WHERE THE RUN STANDS.
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
// NONE OF THE SEVEN IS A FIGURE ANY ROW OPENS ON, so a build whose pose does
// nothing reads back the value `startRun` left rather than the value posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** Distinguishing values: no two the same, and not one of them a default. */
const POSED = {
  money: 4137,
  lives: 13,
  score: 6821,
  wave: 7,
  buildTimer: 9.25,
  wavePending: 21,
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

it("reports the run's figures as they were posed", async () => {
  await startRun(h);

  await h.debug.setMoney(POSED.money);
  await h.debug.setLives(POSED.lives);
  await h.debug.setScore(POSED.score);
  await h.debug.setWave(POSED.wave);
  await h.debug.setBuildTimer(POSED.buildTimer);
  await h.debug.setWavePending(POSED.wavePending);
  await h.debug.setSpeed(2);

  const s = await h.snapshot();
  assertEqual(s.money, POSED.money, "setMoney");
  assertEqual(s.lives, POSED.lives, "setLives");
  assertEqual(s.score, POSED.score, "setScore");
  assertEqual(s.wave, POSED.wave, "setWave");
  assertCloseTo(s.buildTimer, POSED.buildTimer, EXACT, "setBuildTimer");
  assertEqual(s.wavePending, POSED.wavePending, "setWavePending");
  assertEqual(s.speed, 2, "setSpeed");

  // And the speed reads back the other way too, so it is not a field reported as
  // a constant.
  await h.debug.setSpeed(1);
  assertEqual((await h.snapshot()).speed, 1, "setSpeed(1)");

  await h.advance(1);
  await captureStill(h, "posed");
});
