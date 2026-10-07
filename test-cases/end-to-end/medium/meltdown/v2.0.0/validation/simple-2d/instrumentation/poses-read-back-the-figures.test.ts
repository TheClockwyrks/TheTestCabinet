// instrumentation/poses-read-back-the-figures — the money, the lives, the score, the
// wave, the build timer, the pending count and the speed read back as posed.
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
// the seven poses that say WHERE THE RUN STANDS.
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

/** The run figures posed, each unmistakable for any other. */
const RUN = {
  money: 4321,
  lives: 46,
  score: 90210,
  wave: 13,
  buildTimer: 7.25,
  wavePending: 9,
  speed: 2,
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

it("reports the run's figures as they were posed", async () => {
  startRun(h);

  h.debug.setMoney(RUN.money);
  h.debug.setLives(RUN.lives);
  h.debug.setScore(RUN.score);
  h.debug.setWave(RUN.wave);
  h.debug.setBuildTimer(RUN.buildTimer);
  h.debug.setWavePending(RUN.wavePending);
  h.debug.setSpeed(RUN.speed);

  const s = h.snapshot();
  assertEqual(s.money, RUN.money, "setMoney");
  assertEqual(s.lives, RUN.lives, "setLives");
  assertEqual(s.score, RUN.score, "setScore");
  assertEqual(s.wave, RUN.wave, "setWave");
  assertCloseTo(s.buildTimer, RUN.buildTimer, READBACK_DIGITS, "setBuildTimer");
  assertEqual(s.wavePending, RUN.wavePending, "setWavePending");
  assertEqual(s.speed, RUN.speed, "setSpeed");

  // And the speed reads back the other way too, so it is not a field reported as
  // a constant.
  h.debug.setSpeed(1);
  assertEqual(h.snapshot().speed, 1, "setSpeed(1)");

  await h.advance(1);
  captureStill(h, "posed");
});
