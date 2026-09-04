// instrumentation/poses-read-back-the-pointer-and-the-gate — the pointer's posed position and
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
// THE TWO ARE ONE ITEM BECAUSE THEY ARE THE SURFACE'S LAST TWO POSES, and neither
// is large enough to carry a point on its own: `pointer` is three numbers written
// by one of three calls, and `waveSpawning` is one boolean.
//
// THE MOVE IS POSED TO A SECOND TILE, so a build that reports only the press's
// position is caught. On the `playing` screen with nothing armed and nothing under
// the pointer, a release resolves to a deselection and nothing else
// (specs/controls.md), so what is left to read is the pointer itself.
//
// THE GATE IS READ BOTH WAYS, and the `false` direction is the one every other
// group's `startRun` depends on: with it off "no unit arrives unless one is added"
// (specs/instrumentation.md), which is what keeps a posed floor posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { tileCentre } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The floor tile the pointer is pressed on, and the one it moves to. */
const PRESS = { col: 40, row: 30 } as const;

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

it("reports the pointer's posed position and press state, and the world gate", async () => {
  startRun(h);

  h.debug.setWaveSpawning(true);
  assertEqual(h.snapshot().waveSpawning, true, "setWaveSpawning(true)");
  h.debug.setWaveSpawning(false);
  assertEqual(h.snapshot().waveSpawning, false, "setWaveSpawning(false)");

  const from = tileCentre(PRESS.col, PRESS.row);
  const to = tileCentre(PRESS.col + 3, PRESS.row - 2);

  h.debug.pointerDown(from.x, from.y);
  const pressed = h.snapshot().pointer;
  assertCloseTo(pressed.x, from.x, READBACK_DIGITS, "pointerDown: x");
  assertCloseTo(pressed.y, from.y, READBACK_DIGITS, "pointerDown: y");
  assertEqual(pressed.down, true, "pointerDown: the press state");

  await h.advance(1);
  captureStill(h, "posed");

  h.debug.pointerMove(to.x, to.y);
  const moved = h.snapshot();
  assertCloseTo(moved.pointer.x, to.x, READBACK_DIGITS, "pointerMove: x");
  assertCloseTo(moved.pointer.y, to.y, READBACK_DIGITS, "pointerMove: y");
  assertEqual(
    moved.pointer.down,
    true,
    "pointerMove leaves the press where it was",
  );

  h.debug.pointerUp();
  const released = h.snapshot();
  assertEqual(released.pointer.down, false, "pointerUp: the press state");
  assertCloseTo(
    released.pointer.x,
    to.x,
    READBACK_DIGITS,
    "pointerUp releases at the last reported position: x",
  );
  assertCloseTo(
    released.pointer.y,
    to.y,
    READBACK_DIGITS,
    "pointerUp releases at the last reported position: y",
  );
});
