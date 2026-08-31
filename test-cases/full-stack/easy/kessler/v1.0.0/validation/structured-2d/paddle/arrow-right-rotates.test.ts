// paddle/arrow-right-rotates — while ArrowRight is held on the playing screen,
// the deflector's center angle rises tick over tick.
//
// specs/deflector-and-ball.md: "while `ArrowRight` or `KeyD` is held, it rises
// at `270` degrees per second". specs/controls.md binds `right` to
// `ArrowRight`, read as a held value, and has `playing` answer it. What is
// decided here is the DIRECTION under ArrowRight alone: every held tick moves
// the center angle toward rising angles, read wrap-aware. The rate figure is
// `paddle/rotation-speed` and the second binding is `paddle/key-d-rotates`, so
// a build with a wrong rate or a dead KeyD loses those points, not this one.
//
// THE WORLD IS THE DEFLECTOR ALONE: an isolated playing field holding no ball,
// no target, and no pod, so nothing but the deflector answers the held key.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  angularOffset,
  captureReplay,
  isolate,
  openHarness,
  type Harness,
} from "../harness";
import { anglesUnderHold } from "./readings";

/** Enough held ticks to read a direction, well short of the wrap at 360. */
const HELD_TICKS = 12;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rises tick over tick while ArrowRight is held", async () => {
  const posed = isolate(h);

  const angles = await captureReplay(h, "arrow-right-hold", () =>
    anglesUnderHold(h, "ArrowRight", HELD_TICKS),
  );

  let previous = posed.paddle.angleDeg;
  for (const [tick, angle] of angles.entries()) {
    assertGreaterThan(
      angularOffset(previous, angle),
      0,
      `the center angle's move on held tick ${tick + 1}`,
    );
    previous = angle;
  }
});
