// controls/held-values-apply-to-every-tick — a frame's held values apply to
// every tick it consumes.
//
// WHAT THIS DECIDES. One thing: a held value is sampled once per frame and
// applied to EVERY tick that frame consumes, so a frame worth three ticks
// with `ArrowRight` held moves the lamplighter three ticks' worth. That a
// frame of 0.05 s consumes exactly three ticks is decided under
// instrumentation (frame-consumes-whole-ticks), and the rate of one held
// tick under lamplighter/move-speed; this point is that the SAME sample
// reaches all three.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Moving the lamplighter"): "On `playing`, the four
//   movement actions are read as held values, sampled once per frame and
//   applied to every tick that frame consumes."
//   specs/instrumentation.md ("A render-free core"): "On `playing`, each
//   frame's delta time joins the accumulator, every whole `TICK_DT` in it is
//   consumed as a tick", with `TICK_DT` `1 / 60`, so a frame of 0.05 s is
//   three ticks (0.05 × 60 = 3, and "a remainder whose magnitude is below
//   `TICK_EPSILON` is `0`").
//   specs/world.md ("Movement"): `right` is `(1, 0)`, "The velocity is that
//   direction times `moveSpeed`, and each tick the position advances by the
//   velocity times `TICK_DT`", with `moveSpeed` `MOVE_SPEED` (`180`) while no
//   Bellows is held. Three ticks are therefore 3 × 180 / 60 = 9 units along
//   `+x`, the figure the item states.
//   specs/instrumentation.md ("What the runtime provides instead"): "a clock
//   of any other length poses a partial frame", which is how the frame under
//   test is driven: `frameOf(0.05)` swaps a 50 ms clock in for one frame.
//
// THE DRIVE. An isolated run (`isolate`: the empty night, every driver switch
// off, no passive held, so `moveSpeed` is `MOVE_SPEED`), the lamplighter at
// the fresh run's origin, read back before the frame. `ArrowRight` goes down,
// ONE frame of 0.05 s runs, and the key is released. A build that applied the
// sample to the first tick alone lands at 3, one that re-read the keyboard
// between ticks reads whatever it read, and one that moved once per frame
// lands at 3 as well; only three ticks at the held value reach 9.
//
// THE TOLERANCE. `MOTION_TOLERANCE` (1e-6 units, constants.ts): three
// integrations of an exact product, far under the 3-unit step that separates
// the verdict from the nearest wrong answer.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { MOTION_TOLERANCE, MOVE_SPEED, TICK_DT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The one frame's worth of delta time: the figure the item names. */
const FRAME_SECONDS = 0.05;

/** The whole ticks that frame consumes under the tick rule: 0.05 × 60. */
const TICKS_IN_FRAME = 3;

/** What three held ticks cover along `+x`: 3 × 180 / 60 = 9 units. */
const EXPECTED_DX = TICKS_IN_FRAME * MOVE_SPEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the lamplighter 9 units when one 0.05 s frame runs with ArrowRight held", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is run on");
  assertEqual(
    posed.run.moveSpeed,
    MOVE_SPEED,
    "moveSpeed with no Bellows held",
  );

  h.holdKey("ArrowRight");
  let after;
  try {
    after = await h.frameOf(FRAME_SECONDS);
  } finally {
    h.releaseKey("ArrowRight");
  }
  captureStill(h, "frame");

  assertWithin(
    after.run.player.x - posed.run.player.x,
    EXPECTED_DX,
    MOTION_TOLERANCE,
    `player.x moved by one ${FRAME_SECONDS} s frame with ArrowRight held`,
  );
});
