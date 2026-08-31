// controls/release-stops-rotation — releasing a rotation key stops the
// deflector.
//
// specs/controls.md reads `left` and `right` as HELD values — "a held value,
// true while any of its keys is down" — and specs/deflector-and-ball.md moves
// the deflector only under them: "While `ArrowLeft` or `KeyA` is held, the
// center angle falls at `270` degrees per second" — no rule moves the angle
// while nothing is held. So on the ticks after the one held key is released,
// the center angle holds its value.
//
// One key, held then released, over an isolated session with nothing else on
// the field. Whether the hold TURNED the deflector is the rotation points'
// business; what is decided here, in one direction, is that the angle the
// release left is the angle the following ticks keep. The angle is a stored
// figure the idle ticks must not touch, so the tolerance is half a
// thousandth of a degree.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  advanceTicks,
  captureReplay,
  hold,
  isolate,
  openHarness,
  type Harness,
} from "../harness";

/** The one rotation key held, as `specs/controls.md` binds `left`. */
const KEY = BINDINGS.left[0];

/** Ticks the key is held, and ticks the angle is watched after release. */
const HELD_TICKS = 10;
const WATCHED_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("keeps the deflector's angle still on the ticks after release", async () => {
  const posed = await isolate(h);
  assertEqual(posed.screen, "playing", "the screen the key is held on");

  const { atRelease, after } = await captureReplay(h, "held", async () => {
    await hold(h, KEY, HELD_TICKS);
    const released = await h.snapshot();
    const watched = await advanceTicks(h, WATCHED_TICKS);
    return { atRelease: released, after: watched };
  });

  assertCloseTo(
    after.paddle.angleDeg,
    atRelease.paddle.angleDeg,
    3,
    `the center angle after ${WATCHED_TICKS} ticks with no key held`,
  );
});
