// Meltdown — instrumentation/poses-read-back-the-pointer-and-the-gate — the pointer's posed position and
// press state, and the world gate, read back as they were posed.
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
// the three pointer poses and the world gate.
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
// THE TWO ARE ONE ITEM BECAUSE THEY ARE THE SURFACE'S LAST TWO POSES, and neither
// is large enough to carry a point on its own: `pointer` is three numbers written
// by one of three calls, and `waveSpawning` is one boolean.
//
// THE GATE IS READ BOTH WAYS, and the `false` direction is the one every other
// group's `startRun` depends on: with it off "no unit arrives unless one is added"
// (specs/instrumentation.md), which is what keeps a posed floor posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** Where the posed press lands, in logical stage units. */
const PRESS_X = 1123;
const PRESS_Y = 77;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the pointer's posed position and press state, and the world gate", async () => {
  startRun(h);

  h.debug.setWaveSpawning(true);
  assertEqual(h.snapshot().waveSpawning, true, "setWaveSpawning(true)");
  h.debug.setWaveSpawning(false);
  assertEqual(h.snapshot().waveSpawning, false, "setWaveSpawning(false)");

  h.debug.pointerMove(PRESS_X, PRESS_Y);
  const moved = h.snapshot().pointer;
  assertEqual(moved.x, PRESS_X, "pointerMove: x");
  assertEqual(moved.y, PRESS_Y, "pointerMove: y");

  h.debug.pointerDown(PRESS_X, PRESS_Y);
  const pressed = h.snapshot().pointer;
  assertEqual(pressed.x, PRESS_X, "pointerDown: x");
  assertEqual(pressed.y, PRESS_Y, "pointerDown: y");
  assertEqual(pressed.down, true, "pointerDown: down");

  await h.advance(1);
  captureStill(h, "posed");

  h.debug.pointerUp();
  assertEqual(h.snapshot().pointer.down, false, "pointerUp: down");
});
