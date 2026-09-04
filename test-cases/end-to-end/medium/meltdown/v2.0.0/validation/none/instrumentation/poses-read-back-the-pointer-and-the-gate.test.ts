// Meltdown — instrumentation/poses-read-back-the-pointer-and-the-gate — the pointer's posed position and
// press state, and the world gate, read back as they were posed.
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
// the three pointer poses and the world gate.
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
// THE TWO ARE ONE ITEM BECAUSE THEY ARE THE SURFACE'S LAST TWO POSES, and neither
// is large enough to carry a point on its own: `pointer` is three numbers written
// by one of three calls, and `waveSpawning` is one boolean.
//
// THE POINTER IS READ AFTER A FRAME. `specs/instrumentation.md` says `pointer`
// "mirrors the position the pointer input reports ... refreshed in every update",
// so the reading is taken on the frame that delivers each pose rather than before
// one has run.
//
// THE GATE IS READ BOTH WAYS, and the `false` direction is the one every other
// group's `startRun` depends on: with it off "no unit arrives unless one is
// added" (`specs/instrumentation.md`), which is what keeps a posed floor posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import { tileCX, tileCY } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

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

it("reports the pointer's posed position and press state, and the world gate", async () => {
  await startRun(h);
  const at = freeSite(3);
  const point = { x: tileCX(at.col), y: tileCY(at.row) };

  await h.debug.setWaveSpawning(true);
  assertEqual((await h.snapshot()).waveSpawning, true, "setWaveSpawning(true)");
  await h.debug.setWaveSpawning(false);
  assertEqual(
    (await h.snapshot()).waveSpawning,
    false,
    "setWaveSpawning(false)",
  );

  await h.debug.pointerMove(point.x, point.y);
  await h.advance(1);
  const moved = (await h.snapshot()).pointer;
  assertCloseTo(moved.x, point.x, EXACT, "pointerMove's x");
  assertCloseTo(moved.y, point.y, EXACT, "pointerMove's y");
  assertEqual(moved.down, false, "the pointer is not pressed after a move");

  await h.debug.pointerDown(point.x, point.y);
  await h.advance(1);
  // The floor the whole of this point posed, at the moment the press is held.
  await captureStill(h, "posed");
  const pressed = (await h.snapshot()).pointer;
  assertCloseTo(pressed.x, point.x, EXACT, "pointerDown's x");
  assertCloseTo(pressed.y, point.y, EXACT, "pointerDown's y");
  assertEqual(pressed.down, true, "pointerDown");

  await h.debug.pointerUp();
  await h.advance(1);
  const released = (await h.snapshot()).pointer;
  assertEqual(released.down, false, "pointerUp");
  // Released at the last reported position, so the position is unchanged.
  assertDeepEqual(
    { x: released.x, y: released.y },
    { x: point.x, y: point.y },
    "pointerUp releases where the pointer stood",
  );
});
