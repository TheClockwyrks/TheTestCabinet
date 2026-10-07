// paddle/arrow-left-rotates — while ArrowLeft is held on the playing screen,
// the deflector's center angle falls tick over tick.
//
// specs/deflector-and-ball.md: "While `ArrowLeft` or `KeyA` is held, the center
// angle falls at `270` degrees per second". specs/controls.md binds `left` to
// `ArrowLeft`, read as a held value, and has `playing` answer it. What is
// decided here is the DIRECTION under ArrowLeft alone: every held tick moves
// the center angle toward falling angles, read wrap-aware. The rate figure is
// `paddle/rotation-speed` and the second binding is `paddle/key-a-rotates`, so
// a build with a wrong rate or a dead KeyA loses those points, not this one.
//
// THE WORLD IS THE DEFLECTOR ALONE: an isolated playing field holding no ball,
// no target, and no pod, so nothing but the deflector answers the held key.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan } from "../assert";
import {
  angularOffset,
  captureReplay,
  isolate,
  openHarness,
  type Harness,
} from "../harness";
import { anglesUnderHold } from "./readings";

/** Enough held ticks to read a direction, well short of the wrap at 0. */
const HELD_TICKS = 12;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("falls tick over tick while ArrowLeft is held", async () => {
  const posed = isolate(h);

  const angles = await captureReplay(h, "arrow-left-hold", () =>
    anglesUnderHold(h, "ArrowLeft", HELD_TICKS),
  );

  let previous = posed.paddle.angleDeg;
  for (const [tick, angle] of angles.entries()) {
    assertLessThan(
      angularOffset(previous, angle),
      0,
      `the center angle's move on held tick ${tick + 1}`,
    );
    previous = angle;
  }
});
